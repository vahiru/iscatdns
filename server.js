
require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const initializeDatabase = require('./database.js');
const fs = require('fs');

// New modules
const initializeBot = require('./bot.js');
const { initializeEmailTransporter, getApplicationConfirmationEmail, sendEmail, getVerificationEmail } = require('./post_office.js');

// --- 基本配置 ---
const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;
const VOTING_DURATION_HOURS = 12; // 投票持续时间

// --- Cloudflare API 配置 ---
const {
    CLOUDFLARE_ZONE_ID,
    CLOUDFLARE_API_TOKEN,
    PARENT_DOMAIN,
    TURNSTILE_SECRET_KEY,
    TURNSTILE_SITE_KEY,
    SESSION_SECRET,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_GROUP_CHAT_ID,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_SECURE // Add SMTP_SECURE
} = process.env;

if (!CLOUDFLARE_ZONE_ID || !CLOUDFLARE_API_TOKEN || !PARENT_DOMAIN || !TURNSTILE_SECRET_KEY || !TURNSTILE_SITE_KEY || !SESSION_SECRET || !TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_CHAT_ID || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.error("FATAL: .env 文件缺少必要的凭证。请检查所有 Cloudflare, 会话, Telegram 和 SMTP 密钥。");
    process.exit(1);
}

const cfApi = axios.create({
    baseURL: `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/`,
    headers: { 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }
});

// --- 主函数 ---
async function main() {
    const db = await initializeDatabase();

    // Initialize Email Transporter
    initializeEmailTransporter({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT),
        secure: SMTP_SECURE === 'true', // Use boolean for secure
        user: SMTP_USER,
        pass: SMTP_PASS,
    });

    // Initialize Telegram Bot
    const botFunctions = initializeBot(db, cfApi, PARENT_DOMAIN, TELEGRAM_GROUP_CHAT_ID, TELEGRAM_BOT_TOKEN);
    const { sendApplicationNotification, sendAbuseReportNotification, editTelegramMessage } = botFunctions;


    // --- 中间件设置 ---
    app.use(express.json()); // 解析 API 的 JSON 请求体
    app.use(express.urlencoded({ extended: false })); // 解析 HTML 表单
    app.use(cookieParser());
    app.use(session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: { secure: process.env.NODE_ENV === 'production' } // 在生产环境中应使用 secure cookie
    }));

    // --- 自定义中间件 ---
    const verifyTurnstile = async (req, res, next) => {
        const token = req.body['cf-turnstile-response'];
        if (!token) {
            return res.status(400).send("缺少人机验证令牌。");
        }

        try {
            const response = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', new URLSearchParams({
                secret: TURNSTILE_SECRET_KEY,
                response: token,
                remoteip: req.ip
            }));

            if (response.data.success) {
                next();
            } else {
                res.status(403).send("人机验证失败。");
            }
        } catch (error) {
            res.status(500).send("人机验证服务出错。");
        }
    };

    // Middleware to check if user is logged in and set session user details
    app.use(async (req, res, next) => {
        if (req.session.userId) {
            const user = await db.get("SELECT id, username, role, email FROM users WHERE id = ?", req.session.userId);
            if (user) {
                req.user = user; // Attach user object to request
                req.session.isLoggedIn = true;
                req.session.username = user.username;
                req.session.userRole = user.role;
            } else {
                // User not found, clear session
                req.session.destroy(() => {});
                req.session.isLoggedIn = false;
            }
        } else {
            req.session.isLoggedIn = false;
        }
        next();
    });

    // Admin middleware
    const isAdmin = (req, res, next) => {
        if (req.session.isLoggedIn && req.session.userRole === 'admin') {
            next();
        } else {
            res.status(403).json({ message: '无权访问。' });
        }
    };

    // --- 公共路由 (无需登录) ---

    // 认证页面 (HTML) - 这些页面本身不需要登录
    app.get('/login', (req, res) => {
        if (req.session.isLoggedIn) return res.redirect('/'); // 如果已登录，直接跳转到主页
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    });

    app.get('/register', (req, res) => {
        if (req.session.isLoggedIn) return res.redirect('/'); // 如果已登录，直接跳转到主页
        res.sendFile(path.join(__dirname, 'public', 'register.html'));
    });

    app.post('/register', verifyTurnstile, async (req, res) => {
        const { username, password, email } = req.body;
        if (!username || !password || !email) {
            return res.status(400).json({ message: "用户名、密码和邮箱不能为空。" });
        }

        try {
            const existingUser = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', username, email);
            if (existingUser && existingUser.is_verified) {
                return res.status(409).json({ message: "用户名或邮箱已被注册。" });
            }

            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            const verificationToken = require('crypto').randomBytes(32).toString('hex');
            const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            if (existingUser) { // User exists but is not verified, update them
                await db.run(
                    'UPDATE users SET password = ?, email = ?, email_verification_token = ?, email_verification_token_expires_at = ?, is_verified = FALSE WHERE id = ?',
                    hashedPassword, email, verificationToken, tokenExpiresAt.toISOString(), existingUser.id
                );
            } else { // New user
                await db.run(
                    'INSERT INTO users (username, password, email, email_verification_token, email_verification_token_expires_at) VALUES (?, ?, ?, ?, ?)',
                    username, hashedPassword, email, verificationToken, tokenExpiresAt.toISOString()
                );
            }

            const domain = `${req.protocol}://${req.get('host')}`;
            const emailBody = getVerificationEmail(verificationToken, domain);
            await sendEmail(email, "欢迎！请验证您的邮箱地址", emailBody);

            res.status(200).json({ message: "注册成功！我们已向您的邮箱发送了一封验证邮件，请点击邮件中的链接以激活您的账户。" });

        } catch (error) {
            console.error("注册失败:", error);
            res.status(500).json({ message: "服务器内部错误。" });
        }
    });

    app.get('/verify-email', async (req, res) => {
        const { token } = req.query;
        if (!token) {
            return res.status(400).send("无效的验证链接。");
        }

        try {
            const user = await db.get('SELECT * FROM users WHERE email_verification_token = ? AND datetime(email_verification_token_expires_at) > datetime("now")', token);

            if (!user) {
                return res.status(400).send("验证链接无效或已过期。请尝试重新注册或登录以重新发送验证邮件。");
            }

            await db.run(
                'UPDATE users SET is_verified = TRUE, email_verification_token = NULL, email_verification_token_expires_at = NULL WHERE id = ?',
                user.id
            );

            res.redirect('/login?message=Email%20verified!%20You%20can%20now%20log%20in.');

        } catch (error) {
            console.error("邮箱验证失败:", error);
            res.status(500).send("服务器内部错误。");
        }
    });

    app.post('/login', verifyTurnstile, async (req, res) => {
        const { username, password } = req.body;
        try {
            const user = await db.get('SELECT * FROM users WHERE username = ?', username);

            if (!user || !await bcrypt.compare(password, user.password)) {
                return res.status(401).json({ message: "用户名或密码不正确。" });
            }

            if (!user.is_verified) {
                return res.status(403).json({ message: "您的账户尚未激活，请检查您的邮箱中的验证链接。" });
            }

            req.session.isLoggedIn = true;
            req.session.username = user.username;
            req.session.userId = user.id;
            req.session.userRole = user.role;
            res.status(200).json({ success: true, redirect: '/dashboard' });

        } catch (error) {
            console.error("登录失败:", error);
            res.status(500).json({ message: "服务器内部错误。" });
        }
    });

    app.post('/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) {
                console.error("登出失败:", err);
                return res.status(500).send("无法登出。");
            }
            res.redirect('/login');
        });
    });

    // 获取 Turnstile Site Key (无需登录)
    app.get('/api/turnstile-sitekey', (req, res) => {
        res.status(200).json({ siteKey: TURNSTILE_SITE_KEY });
    });

    // 获取背景图片列表 (无需登录)
    app.get('/api/background-images', (req, res) => {
        const imagesDir = path.join(__dirname, 'public', 'images');
        fs.readdir(imagesDir, (err, files) => {
            if (err) {
                console.error("Error reading images directory:", err);
                return res.status(500).json({ message: '无法获取背景图片列表。' });
            }
            const imageFiles = files.filter(file => {
                return /\.(jpg|jpeg|png|gif|webp)$/i.test(file);
            });
            res.status(200).json({ images: imageFiles });
        });
    });

    // Public abuse report page
    app.get('/report-abuse', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'report-abuse.html'));
    });

    // Public API for abuse report submission
    app.post('/api/report-abuse', verifyTurnstile, async (req, res) => {
        const { subdomain, reason, details } = req.body;
        if (!subdomain || !reason) {
            return res.status(400).json({ message: '子域名和举报原因不能为空。' });
        }
        try {
            const result = await db.run(
                'INSERT INTO abuse_reports (subdomain, reason, details, reporter_ip) VALUES (?, ?, ?, ?)',
                subdomain, reason, details, req.ip
            );
            const reportId = result.lastID;
            const newReport = await db.get("SELECT * FROM abuse_reports WHERE id = ?", reportId);
            await sendAbuseReportNotification(newReport);
            res.status(201).json({ message: '举报已提交，感谢您的反馈。' });
        } catch (error) {
            console.error("提交滥用举报失败:", error);
            res.status(500).json({ message: '提交举报失败。' });
        }
    });

    app.use(express.static('public')); // 确保所有静态文件（CSS, JS, 图片等）在任何受保护的路由之前被提供

    // 主页路由 - 根据登录状态重定向
    app.get('/', (req, res) => {
        if (req.session.isLoggedIn) {
            res.redirect('/dashboard');
        } else {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    });

    // 仪表盘路由 - 需要登录
    app.get('/dashboard', (req, res) => {
        if (req.session.isLoggedIn) {
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        } else {
            res.redirect('/login');
        }
    });

    // Get current user details (for frontend to check role)
    app.get('/api/user/me', (req, res) => {
        if (req.user) {
            res.status(200).json({ id: req.user.id, username: req.user.username, role: req.user.role, email: req.user.email });
        } else {
            res.status(401).json({ message: '未登录。' });
        }
    });

    // --- 登录保护中间件 ---
    // 任何在此之后定义的路由都需要登录
    app.use((req, res, next) => {
        if (req.session.isLoggedIn) {
            next();
        } else {
            // 如果是 API 请求，返回 401。否则，重定向到登录页。
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ message: '未认证' });
            }
            res.redirect('/login');
        }
    });

    // --- 受保护路由 (需要登录) ---

    const getFullDomain = (subdomain) => {
        if (subdomain === '@' || subdomain === '') {
            return PARENT_DOMAIN.toLowerCase();
        }
        return `${subdomain}.${PARENT_DOMAIN}`.toLowerCase();
    };

    // 获取用户自己的 DNS 记录
    app.get('/api/dns/records', async (req, res) => {
        try {
            const userDnsRecords = await db.all('SELECT * FROM dns_records WHERE user_id = ?', req.session.userId);
            res.status(200).json(userDnsRecords);
        } catch (error) {
            console.error("获取用户 DNS 记录失败:", error);
            res.status(500).json({ message: '获取 DNS 记录失败。' });
        }
    });

    // 获取用户自己的申请记录
    app.get('/api/applications', async (req, res) => {
        try {
            const userApplications = await db.all('SELECT * FROM subdomain_applications WHERE user_id = ? ORDER BY created_at DESC', req.session.userId);
            res.status(200).json(userApplications);
        } catch (error) {
            console.error("获取用户申请记录失败:", error);
            res.status(500).json({ message: '获取申请记录失败。' });
        }
    });

    // 提交新的 DNS 记录申请
    app.post('/api/dns/records', async (req, res) => {
        const { type, name, content, purpose } = req.body;
        if (!type || !name || !content) {
            return res.status(400).json({ message: '类型、名称和内容不能为空。' });
        }
        if (type !== 'A' && type !== 'CNAME') {
            return res.status(400).json({ message: '只支持 A 和 CNAME 记录类型。' });
        }

        const fullDomain = getFullDomain(name);
        const votingDeadline = new Date(Date.now() + VOTING_DURATION_HOURS * 60 * 60 * 1000);

        try {
            const result = await db.run(
                'INSERT INTO subdomain_applications (user_id, request_type, subdomain, record_type, record_value, purpose, voting_deadline_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                req.session.userId, 'create', fullDomain, type, content, purpose, votingDeadline.toISOString()
            );
            const applicationId = result.lastID;
            const newApplication = await db.get("SELECT sa.*, u.username, u.email FROM subdomain_applications sa JOIN users u ON sa.user_id = u.id WHERE sa.id = ?", applicationId);

            await sendApplicationNotification(newApplication);
            await sendEmail(req.user.email, `您的域名申请已提交: ${fullDomain}`, getApplicationConfirmationEmail(fullDomain, purpose));

            res.status(202).json({ message: '域名创建申请已提交，等待管理员审批。' });
        } catch (error) {
            console.error("提交域名创建申请失败:", error);
            res.status(500).json({ message: '提交申请失败。' });
        }
    });

    // 提交更新 DNS 记录申请
    app.put('/api/dns/records/:id', async (req, res) => {
        const { id } = req.params; // id of the dns_records entry
        const { type, name, content, purpose } = req.body;
        if (!type || !name || !content) {
            return res.status(400).json({ message: '类型、名称和内容不能为空。' });
        }
        if (type !== 'A' && type !== 'CNAME') {
            return res.status(400).json({ message: '只支持 A 和 CNAME 记录类型。' });
        }

        try {
            // Verify record belongs to user
            const existingRecord = await db.get('SELECT * FROM dns_records WHERE id = ? AND user_id = ?', id, req.session.userId);
            if (!existingRecord) {
                return res.status(403).json({ message: '无权修改此记录或记录不存在。' });
            }

            const fullDomain = getFullDomain(name);
            const votingDeadline = new Date(Date.now() + VOTING_DURATION_HOURS * 60 * 60 * 1000);

            const result = await db.run(
                'INSERT INTO subdomain_applications (user_id, request_type, target_dns_record_id, subdomain, record_type, record_value, purpose, voting_deadline_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                req.session.userId, 'update', id, fullDomain, type, content, purpose, votingDeadline.toISOString()
            );
            const applicationId = result.lastID;
            const newApplication = await db.get("SELECT sa.*, u.username, u.email FROM subdomain_applications sa JOIN users u ON sa.user_id = u.id WHERE sa.id = ?", applicationId);

            await sendApplicationNotification(newApplication);
            await sendEmail(req.user.email, `您的域名更新申请已提交: ${fullDomain}`, getApplicationConfirmationEmail(fullDomain, purpose));

            res.status(202).json({ message: '域名更新申请已提交，等待管理员审批。' });
        } catch (error) {
            console.error("提交域名更新申请失败:", error);
            res.status(500).json({ message: '提交申请失败。' });
        }
    });

    // 删除 DNS 记录 (无需审批)
    app.delete('/api/dns/records/:id', async (req, res) => {
        const { id } = req.params;
        try {
            // 验证记录是否属于当前用户
            const record = await db.get('SELECT * FROM dns_records WHERE id = ? AND user_id = ?', id, req.session.userId);
            if (!record) {
                return res.status(403).json({ message: '无权删除此记录或记录不存在。' });
            }

            // 先在 Cloudflare 删除记录
            await cfApi.delete(`dns_records/${record.id}`); // Use record.id which is Cloudflare ID
            // 然后删除数据库中的记录
            await db.run('DELETE FROM dns_records WHERE id = ?', id);
            res.status(204).send(); // No Content
        } catch (error) {
            console.error("Cloudflare API 删除 DNS 记录失败:", error.response ? error.response.data : error.message);
            res.status(500).json({ message: '删除 DNS 记录失败。' });
        }
    });

    // --- Admin Routes (需要登录且为管理员) ---
    app.get('/api/admin/users', isAdmin, async (req, res) => {
        try {
            const users = await db.all("SELECT id, username, email, role, telegram_user_id, created_at FROM users");
            res.status(200).json(users);
        } catch (error) {
            console.error("获取所有用户失败:", error);
            res.status(500).json({ message: '获取用户列表失败。' });
        }
    });

    app.get('/api/admin/dns-records', isAdmin, async (req, res) => {
        try {
            const records = await db.all("SELECT dr.*, u.username FROM dns_records dr JOIN users u ON dr.user_id = u.id");
            res.status(200).json(records);
        } catch (error) {
            console.error("获取所有 DNS 记录失败:", error);
            res.status(500).json({ message: '获取 DNS 记录列表失败。' });
        }
    });

    app.get('/api/admin/applications', isAdmin, async (req, res) => {
        try {
            const applications = await db.all("SELECT sa.*, u.username, u.email FROM subdomain_applications sa JOIN users u ON sa.user_id = u.id ORDER BY sa.created_at DESC");
            res.status(200).json(applications);
        } catch (error) {
            console.error("获取所有申请失败:", error);
            res.status(500).json({ message: '获取申请列表失败。' });
        }
    });

    app.get('/api/admin/abuse-reports', isAdmin, async (req, res) => {
        try {
            const reports = await db.all("SELECT * FROM abuse_reports ORDER BY created_at DESC");
            res.status(200).json(reports);
        } catch (error) {
            console.error("获取所有滥用举报失败:", error);
            res.status(500).json({ message: '获取举报列表失败。' });
        }
    });

    app.post('/api/admin/users/:id/set-role', isAdmin, async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;
        if (role !== 'admin' && role !== 'user') {
            return res.status(400).json({ message: '无效的角色。' });
        }
        try {
            await db.run('UPDATE users SET role = ? WHERE id = ?', role, id);
            res.status(200).json({ message: `用户 ${id} 的角色已更新为 ${role}。` });
        } catch (error) {
            console.error("更新用户角色失败:", error);
            res.status(500).json({ message: '更新用户角色失败。' });
        }
    });

    app.post('/api/user/me/generate-bind-token', async (req, res) => {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ message: '只有管理员才能生成令牌。' });
        }

        const token = require('crypto').randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

        try {
            await db.run(
                'UPDATE users SET telegram_bind_token = ?, telegram_bind_token_expires_at = ? WHERE id = ?',
                token, expiresAt.toISOString(), req.user.id
            );
            res.status(200).json({ token: token, expires_at: expiresAt.toISOString() });
        } catch (error) {
            console.error("生成绑定令牌失败:", error);
            res.status(500).json({ message: '生成令牌失败。' });
        }
    });

    // Admin actions for abuse reports from web panel
    app.post('/api/admin/abuse-reports/:id/acknowledge', isAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const report = await db.get("SELECT * FROM abuse_reports WHERE id = ?", id);
            if (!report) return res.status(404).json({ message: '举报不存在。' });

            await db.run("UPDATE abuse_reports SET status = 'acknowledged' WHERE id = ?", id);
            const updatedReport = await db.get("SELECT * FROM abuse_reports WHERE id = ?", id);
            if (updatedReport.telegram_message_id) {
                // Trigger bot to update message
                await editTelegramMessage(TELEGRAM_GROUP_CHAT_ID, updatedReport.telegram_message_id, `*‼️ 滥用举报 ‼️*\n----------------------------------------\n*被举报域名*: \`${updatedReport.subdomain}\`\n*举报原因*: ${updatedReport.reason}\n*详细描述*: ${updatedReport.details || '无'}\n*举报人IP*: ${updatedReport.reporter_ip || '未知'}\n*状态*: ${updatedReport.status} (已由管理员受理)\n`, {
                    inline_keyboard: [
                        [{ text: '⚡️ 暂停域名', callback_data: `suspend_${id}` }],
                        [{ text: '🙈 忽略', callback_data: `ignore_${id}` }]
                    ]
                });
            }
            res.status(200).json({ message: '举报已受理。' });
        } catch (error) {
            console.error("受理举报失败:", error);
            res.status(500).json({ message: '受理举报失败。' });
        }
    });

    app.post('/api/admin/abuse-reports/:id/suspend', isAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const report = await db.get("SELECT * FROM abuse_reports WHERE id = ?", id);
            if (!report) return res.status(404).json({ message: '举报不存在。' });

            const dnsRecord = await db.get("SELECT * FROM dns_records WHERE name = ?", getFullDomain(report.subdomain));
            if (dnsRecord) {
                await cfApi.delete(`dns_records/${dnsRecord.id}`);
                await db.run("DELETE FROM dns_records WHERE id = ?", dnsRecord.id);
                await db.run("UPDATE abuse_reports SET status = 'resolved' WHERE id = ?", id);
                const updatedReport = await db.get("SELECT * FROM abuse_reports WHERE id = ?", id);
                if (updatedReport.telegram_message_id) {
                    await editTelegramMessage(TELEGRAM_GROUP_CHAT_ID, updatedReport.telegram_message_id, `*‼️ 滥用举报 ‼️*\n----------------------------------------\n*被举报域名*: \`${updatedReport.subdomain}\`\n*举报原因*: ${updatedReport.reason}\n*详细描述*: ${updatedReport.details || '无'}\n*举报人IP*: ${updatedReport.reporter_ip || '未知'}\n*状态*: ${updatedReport.status} (域名已暂停)\n`, { inline_keyboard: [] });
                }
                res.status(200).json({ message: `域名 ${report.subdomain} 已暂停。` });
            } else {
                res.status(404).json({ message: `未找到域名 ${report.subdomain} 的DNS记录，无法暂停。` });
            }
        } catch (error) {
            console.error("暂停域名失败:", error.response ? error.response.data : error.message);
            res.status(500).json({ message: '暂停域名失败。' });
        }
    });

    app.post('/api/admin/abuse-reports/:id/ignore', isAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const report = await db.get("SELECT * FROM abuse_reports WHERE id = ?", id);
            if (!report) return res.status(404).json({ message: '举报不存在。' });

            await db.run("UPDATE abuse_reports SET status = 'ignored' WHERE id = ?", id);
            const updatedReport = await db.get("SELECT * FROM abuse_reports WHERE id = ?", id);
            if (updatedReport.telegram_message_id) {
                await editTelegramMessage(TELEGRAM_GROUP_CHAT_ID, updatedReport.telegram_message_id, `*‼️ 滥用举报 ‼️*\n----------------------------------------\n*被举报域名*: \`${updatedReport.subdomain}\`\n*举报原因*: ${updatedReport.reason}\n*详细描述*: ${updatedReport.details || '无'}\n*举报人IP*: ${updatedReport.reporter_ip || '未知'}\n*状态*: ${updatedReport.status} (已忽略)\n`, { inline_keyboard: [] });
            }
            res.status(200).json({ message: '举报已忽略。' });
        } catch (error) {
            console.error("忽略举报失败:", error);
            res.status(500).json({ message: '忽略举报失败。' });
        }
    });

    // --- 启动服务器 ---
    app.listen(PORT, () => {
        console.log(`🐾 服务器正在 http://localhost:${PORT} 上可爱地运行...`);
    });
}

main();
