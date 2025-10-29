const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const {
    getApplicationApprovedEmail,
    getApplicationRejectedEmail,
    getApplicationExpiredEmail,
    sendEmail
} = require('./post_office');

let bot;
let db;
let cfApi;
let PARENT_DOMAIN;
let TELEGRAM_GROUP_CHAT_ID;

// --- Helper Functions ---
async function getApplicationDetails(applicationId) {
    return await db.get(`
        SELECT sa.*, u.username, u.email
        FROM subdomain_applications sa
        JOIN users u ON sa.user_id = u.id
        WHERE sa.id = ?
    `, applicationId);
}

async function getVotesForApplication(applicationId) {
    return await db.all("SELECT admin_telegram_user_id, vote_type FROM application_votes WHERE application_id = ?", applicationId);
}

async function getTelegramUsername(telegramUserId) {
    const user = await db.get("SELECT username FROM users WHERE telegram_user_id = ?", telegramUserId);
    return user ? user.username : `Unknown Admin (${telegramUserId})`;
}

async function formatApplicationMessage(application, votes = []) {
    const fullDomain = application.subdomain;
    const deadline = new Date(application.voting_deadline_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const approveVotes = votes.filter(v => v.vote_type === 'approve');
    const denyVotes = votes.filter(v => v.vote_type === 'deny');

    const approveVoterUsernames = await Promise.all(approveVotes.map(v => getTelegramUsername(v.admin_telegram_user_id)));
    const denyVoterUsernames = await Promise.all(denyVotes.map(v => getTelegramUsername(v.admin_telegram_user_id)));

    return `
*${application.request_type === 'create' ? '新域名申请' : '域名更新请求'}*
----------------------------------------
*申请人*: ${application.username}
*域名*: \`${fullDomain}\`
*类型*: \`${application.record_type}\`
*值*: \`${application.record_value}\`
*用途*: ${application.purpose || '无'}
*状态*: ${application.status}
*投票截止*: ${deadline}

*赞成票*: ${approveVotes.length} (${approveVoterUsernames.join(', ') || '无'})
*反对票*: ${denyVotes.length} (${denyVoterUsernames.join(', ') || '无'})
`;
}

async function processApplication(applicationId, decisionReason, finalStatus) {
    const app = await getApplicationDetails(applicationId);
    if (!app || app.status !== 'pending') return; // Already processed

    await db.run("UPDATE subdomain_applications SET status = ?, admin_notes = ? WHERE id = ?", finalStatus, decisionReason, applicationId);
    
    const user = await db.get("SELECT email FROM users WHERE id = ?", app.user_id);
    if (!user) return;

    if (finalStatus === 'approved') {
        try {
            if (app.request_type === 'create') {
                const fullDomain = `${app.subdomain}.${PARENT_DOMAIN}`;
                const cfPayload = { type: app.record_type, name: fullDomain, content: app.record_value, ttl: 3600, proxied: false };
                const { data: cfResponse } = await cfApi.post('dns_records', cfPayload);
                await db.run('INSERT INTO dns_records (id, user_id, type, name, content) VALUES (?, ?, ?, ?, ?)', cfResponse.result.id, app.user_id, app.record_type, fullDomain, app.record_value);
            } else if (app.request_type === 'update') {
                const oldRecord = await db.get("SELECT * FROM dns_records WHERE id = ?", app.target_dns_record_id);
                if (oldRecord) {
                    const fullDomain = `${app.subdomain}.${PARENT_DOMAIN}`;
                    const cfPayload = { type: app.record_type, name: fullDomain, content: app.record_value, ttl: 3600, proxied: false };
                    await cfApi.put(`dns_records/${oldRecord.id}`, cfPayload);
                    await db.run('UPDATE dns_records SET type = ?, name = ?, content = ? WHERE id = ?', app.record_type, fullDomain, app.record_value, app.target_dns_record_id);
                }
            }
            await sendEmail(user.email, `您的域名申请已批准: ${app.subdomain}`, getApplicationApprovedEmail(app.subdomain));
        } catch (error) {
            console.error(`Cloudflare API op failed for approved app ${app.id}:`, error.response ? error.response.data : error.message);
            await db.run("UPDATE subdomain_applications SET status = 'error', admin_notes = ? WHERE id = ?", "Cloudflare操作失败", app.id);
            await sendEmail(user.email, `您的域名申请处理失败: ${app.subdomain}`, getApplicationRejectedEmail(app.subdomain, "后台Cloudflare操作失败，请联系管理员。"));
            decisionReason = "❌ 投票通过但Cloudflare操作失败！";
        }
    } else if (finalStatus === 'rejected') {
        await sendEmail(user.email, `您的域名申请已被拒绝: ${app.subdomain}`, getApplicationRejectedEmail(app.subdomain, decisionReason));
    } else if (finalStatus === 'expired') {
        await sendEmail(user.email, `您的域名申请已过期: ${app.subdomain}`, getApplicationExpiredEmail(app.subdomain));
    }

    const votes = await getVotesForApplication(app.id);
    const originalMessage = await formatApplicationMessage(app, votes);
    const finalMessage = originalMessage.replace(`*状态*: pending`, `*状态*: ${finalStatus}`) + `\n\n*处理结果: ${decisionReason}*`;
    if (app.telegram_message_id) {
        await editTelegramMessage(TELEGRAM_GROUP_CHAT_ID, app.telegram_message_id, finalMessage, {}); // Remove buttons
    }
    console.log(`Application ${app.id} processed with status: ${finalStatus}`);
}

// --- Bot Action Handlers ---
async function handleVote(callbackQuery) {
    const fromId = callbackQuery.from.id.toString();
    const [_, voteType, applicationIdStr] = callbackQuery.data.split('_');
    const applicationId = parseInt(applicationIdStr);

    const application = await getApplicationDetails(applicationId);
    if (!application || application.status !== 'pending') {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "此申请已处理或不存在。", show_alert: true });
    }

    if (new Date() > new Date(application.voting_deadline_at)) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "投票已截止。", show_alert: true });
    }

    const admin = await db.get("SELECT * FROM users WHERE telegram_user_id = ? AND role = 'admin'", fromId);
    if (!admin) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "您不是管理员或未绑定Telegram账号。", show_alert: true });
    }

    try {
        await db.run(
            'INSERT OR REPLACE INTO application_votes (application_id, admin_telegram_user_id, vote_type) VALUES (?, ?, ?)',
            applicationId, fromId, voteType
        );

        const votes = await getVotesForApplication(applicationId);
        const approveVotesCount = votes.filter(v => v.vote_type === 'approve').length;
        const denyVotesCount = votes.filter(v => v.vote_type === 'deny').length;

        // Fast-track logic
        if (approveVotesCount >= 2) {
            await processApplication(applicationId, `快速通道批准 (赞成: ${approveVotesCount}, 反对: ${denyVotesCount})`, 'approved');
            return bot.answerCallbackQuery(callbackQuery.id, { text: "已快速批准此申请。" });
        }
        if (denyVotesCount >= 2) {
            await processApplication(applicationId, `快速通道拒绝 (赞成: ${approveVotesCount}, 反对: ${denyVotesCount})`, 'rejected');
            return bot.answerCallbackQuery(callbackQuery.id, { text: "已快速拒绝此申请。" });
        }

        // Update message if not fast-tracked
        const messageText = await formatApplicationMessage(application, votes);
        await editTelegramMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id, messageText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👍 赞成', callback_data: `vote_approve_${application.id}` }],
                    [{ text: '👎 反对', callback_data: `vote_deny_${application.id}` }]
                ]
            }
        });

        bot.answerCallbackQuery(callbackQuery.id, { text: `您已投出“${voteType === 'approve' ? '赞成' : '反对'}”票。` });

    } catch (error) {
        console.error("Error handling vote:", error);
        bot.answerCallbackQuery(callbackQuery.id, { text: "处理投票时发生错误。", show_alert: true });
    }
}

// --- External Functions for server.js and cron job ---
async function sendApplicationNotification(application) {
    const messageText = await formatApplicationMessage(application);
    const reply_markup = {
        inline_keyboard: [
            [{ text: '👍 赞成', callback_data: `vote_approve_${application.id}` }],
            [{ text: '👎 反对', callback_data: `vote_deny_${application.id}` }]
        ]
    };
    const sentMessage = await bot.sendMessage(TELEGRAM_GROUP_CHAT_ID, messageText, { parse_mode: 'Markdown', reply_markup });
    await db.run("UPDATE subdomain_applications SET telegram_message_id = ? WHERE id = ?", sentMessage.message_id, application.id);
}

async function editTelegramMessage(chatId, messageId, text, options = {}) {
    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...options
        });
    } catch (error) {
        if (!error.message.includes('message is not modified')) {
            console.error("Error editing Telegram message:", error.message);
        }
    }
}

// --- Scheduled Task (The new Decision Maker) ---
function startCronJobs() {
    cron.schedule('* * * * *', async () => {
        console.log('Running cron job: processing finished applications...');
        const applicationsToProcess = await db.all(`
            SELECT * FROM subdomain_applications
            WHERE status = 'pending' AND datetime(voting_deadline_at) < datetime("now")
        `);

        for (const app of applicationsToProcess) {
            const votes = await getVotesForApplication(app.id);
            const approveVotes = votes.filter(v => v.vote_type === 'approve').length;
            const denyVotes = votes.filter(v => v.vote_type === 'deny').length;

            if (votes.length === 0) {
                await processApplication(app.id, "投票超时，无人投票。", 'expired');
            } else if (approveVotes > denyVotes) {
                await processApplication(app.id, `投票结束 (赞成: ${approveVotes}, 反对: ${denyVotes})`, 'approved');
            } else { // denyVotes >= approveVotes
                await processApplication(app.id, `投票结束 (赞成: ${approveVotes}, 反对: ${denyVotes})`, 'rejected');
            }
        }
    });
}

// --- Initialization ---
function initializeBot(database, cloudflareApi, parentDomain, telegramGroupChatId, botToken) {
    db = database;
    cfApi = cloudflareApi;
    PARENT_DOMAIN = parentDomain;
    TELEGRAM_GROUP_CHAT_ID = telegramGroupChatId;
    bot = new TelegramBot(botToken, { polling: true });

    bot.setMyCommands([
        { command: 'start', description: '显示欢迎信息' },
        { command: 'help', description: '获取帮助' },
        { command: 'bind', description: '绑定您的Telegram账户: /bind <token>' },
    ]);

    bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "欢迎使用 is-cute.cat DNS 管理机器人！"));
    bot.onText(/\/help/, (msg) => bot.sendMessage(msg.chat.id, "您可以使用 /bind <token> 命令来绑定您的账户。"));

    bot.onText(/\/bind\s*(.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id.toString();
        const token = match[1];

        if (msg.chat.type !== 'private') {
            return bot.sendMessage(chatId, "为了您的账户安全，请私聊我进行绑定操作。");
        }

        try {
            const user = await db.get('SELECT * FROM users WHERE telegram_bind_token = ? AND datetime(telegram_bind_token_expires_at) > datetime("now")', token);
            if (!user) {
                return bot.sendMessage(chatId, "无效或已过期的令牌。请在网站上重新生成。");
            }

            await db.run('UPDATE users SET telegram_user_id = ?, telegram_bind_token = NULL, telegram_bind_token_expires_at = NULL WHERE id = ?', telegramId, user.id);
            bot.sendMessage(chatId, `✅ 成功！您的Telegram账户已成功绑定到网站账户: ${user.username}`);

        } catch (error) {
            console.error("绑定账户时出错:", error);
            bot.sendMessage(chatId, "绑定过程中发生错误，请联系管理员。");
        }
    });

    bot.on('callback_query', async (callbackQuery) => {
        if (callbackQuery.data.startsWith('vote_')) {
            await handleVote(callbackQuery);
        }
    });

    // Debugging: Log all non-command messages
    bot.on('message', (msg) => {
        if (!msg.text.startsWith('/')) {
            console.log('Bot received non-command message:', JSON.stringify(msg, null, 2));
        }
    });

    startCronJobs();

    console.log("Telegram Bot initialized and cron jobs started.");
    return {
        sendApplicationNotification,
        editTelegramMessage
    };
}

module.exports = initializeBot;

