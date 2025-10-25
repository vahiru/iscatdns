const nodemailer = require('nodemailer');

let transporter;

// Initialize Nodemailer transporter
function initializeEmailTransporter(smtpConfig) {
    transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure, // true for 465, false for other ports
        auth: {
            user: smtpConfig.user,
            pass: smtpConfig.pass,
        },
    });
}

// Function to send an email
async function sendEmail(to, subject, htmlContent) {
    if (!transporter) {
        console.error("Email transporter not initialized. Call initializeEmailTransporter first.");
        return;
    }

    const fromAddress = process.env.SMTP_FROM_ADDRESS || transporter.options.auth.user;

    try {
        let info = await transporter.sendMail({
            from: `"ISCAT DNS" <${fromAddress}>`, // sender address
            to: to, // list of receivers
            subject: subject, // Subject line
            html: htmlContent, // html body
        });
        console.log("Message sent: %s", info.messageId);
        return true;
    } catch (error) {
        console.error("Error sending email:", error);
        return false;
    }
}

// Specific email templates
function getApplicationConfirmationEmail(subdomain, purpose) {
    return `
        <h1>您的二级域名申请已提交</h1>
        <p>您已成功提交了对 <strong>${subdomain}</strong> 的二级域名申请。</p>
        <p>申请用途: ${purpose}</p>
        <p>我们的管理团队正在审核您的请求。一旦有更新，您将收到通知。</p>
        <p>感谢您的耐心等待！</p>
    `;
}

function getApplicationApprovedEmail(subdomain) {
    return `
        <h1>您的二级域名申请已批准！</h1>
        <p>恭喜！您对 <strong>${subdomain}</strong> 的二级域名申请已获得批准。</p>
        <p>DNS记录已成功创建/更新。您现在可以使用您的新域名了。</p>
        <p>如果您有任何疑问，请联系管理员。</p>
    `;
}

function getApplicationRejectedEmail(subdomain, reason = "未说明") {
    return `
        <h1>您的二级域名申请未获批准</h1>
        <p>很抱歉通知您，您对 <strong>${subdomain}</strong> 的二级域名申请未能获得批准。</p>
        <p>原因: ${reason}</p>
        <p>如果您认为这是一个错误，或者有任何疑问，请联系管理员。</p>
    `;
}

function getApplicationExpiredEmail(subdomain) {
    return `
        <h1>您的二级域名申请已过期</h1>
        <p>很抱歉通知您，您对 <strong>${subdomain}</strong> 的二级域名申请因未在规定时间内获得足够票数而自动作废。</p>
        <p>如果您仍然需要此域名，请重新提交申请。</p>
        <p>如果您有任何疑问，请联系管理员。</p>
    `;
}

function getVerificationEmail(token, domain) {
    const verificationLink = `${domain}/verify-email?token=${token}`;
    return `
        <h1>欢迎！请验证您的邮箱地址</h1>
        <p>感谢您注册 is-cute.cat 域名服务。请点击下方链接来激活您的账户：</p>
        <p><a href="${verificationLink}">${verificationLink}</a></p>
        <p>此链接将在1小时后失效。</p>
        <p>如果您没有注册，请忽略此邮件。</p>
    `;
}

module.exports = {
    initializeEmailTransporter,
    sendEmail,
    getApplicationConfirmationEmail,
    getApplicationApprovedEmail,
    getApplicationRejectedEmail,
    getApplicationExpiredEmail,
    getVerificationEmail
};