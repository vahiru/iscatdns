require('dotenv').config();
const initializeDatabase = require('./database.js');
const bcrypt = require('bcrypt');
const { initializeEmailTransporter, getVerificationEmail, sendEmail } = require('./post_office.js');

const SALT_ROUNDS = 10;

// --- Helper Functions ---
function printUsage() {
    console.log(`
ISC DNS Maintenance Tool

Usage: node maintenance-tool.js <command> [args...]

Commands:
  Application Management:
    expire-old-apps [YYYY-MM-DD]    - Expire all pending applications created before a certain date (defaults to today).
    force-approve <app_id>          - Force approve an application.
    force-reject <app_id> [reason]  - Force reject an application with an optional reason.

  User Management:
    list-users                      - List all users.
    set-role <username> <role>      - Set a user's role ('admin' or 'user').
    set-password <username> <new_pw> - Force set a new password for a user.
    resend-verification <username>  - Resend verification email to an unverified user.
    `);
}

// --- Main Logic ---
async function main() {
    const [,, command, ...args] = process.argv;

    if (!command) {
        printUsage();
        return;
    }

    const db = await initializeDatabase();

    // Initialize email transporter for resend-verification
    if (command === 'resend-verification') {
        initializeEmailTransporter({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT),
            secure: process.env.SMTP_SECURE === 'true',
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        });
    }

    console.log(`Executing command: ${command} with args: ${args.join(' ')}`);

    try {
        switch (command) {
            case 'list-users': {
                const users = await db.all('SELECT id, username, email, role, is_verified FROM users');
                console.table(users);
                break;
            }

            case 'set-role': {
                const [username, role] = args;
                if (!username || !role || !['admin', 'user'].includes(role)) {
                    return console.error('Usage: set-role <username> <role>');
                }
                const result = await db.run('UPDATE users SET role = ? WHERE username = ?', role, username);
                if (result.changes === 0) {
                    return console.log(`User "${username}" not found.`);
                }
                console.log(`✅ User "${username}" role updated to "${role}".`);
                break;
            }

            case 'set-password': {
                const [username, newPassword] = args;
                if (!username || !newPassword) {
                    return console.error('Usage: set-password <username> <new_password>');
                }
                const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
                const result = await db.run('UPDATE users SET password = ? WHERE username = ?', hashedPassword, username);
                if (result.changes === 0) {
                    return console.log(`User "${username}" not found.`);
                }
                console.log(`✅ Password for user "${username}" has been changed.`);
                break;
            }

            case 'resend-verification': {
                const [username] = args;
                if (!username) {
                    return console.error('Usage: resend-verification <username_or_email>');
                }
                const user = await db.get('SELECT * FROM users WHERE (username = ? OR email = ?) AND is_verified = FALSE', username, username);
                if (!user) {
                    return console.log(`User "${username}" not found or is already verified.`);
                }

                const verificationToken = require('crypto').randomBytes(32).toString('hex');
                const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

                await db.run('UPDATE users SET email_verification_token = ?, email_verification_token_expires_at = ? WHERE id = ?', verificationToken, tokenExpiresAt.toISOString(), user.id);
                
                // This assumes the server is running on localhost. For production, you might need a configured domain.
                const domain = process.env.PARENT_DOMAIN ? `http://${process.env.PARENT_DOMAIN}` : 'http://localhost:3000'; 
                const emailBody = getVerificationEmail(verificationToken, domain);
                await sendEmail(user.email, "请重新验证您的邮箱地址", emailBody);

                console.log(`✅ Verification email resent to ${user.email} for user "${user.username}".`);
                break;
            }

            case 'expire-old-apps': {
                let date = args[0] ? new Date(args[0]) : new Date();
                if (isNaN(date)) {
                    return console.error('Invalid date format. Please use YYYY-MM-DD.');
                }
                const dateString = date.toISOString().split('T')[0] + ' 23:59:59';

                const result = await db.run(
                    `UPDATE subdomain_applications SET status = 'expired', admin_notes = 'Expired by maintenance tool' WHERE status = 'pending' AND created_at < ?`,
                    dateString
                );
                console.log(`✅ Expired ${result.changes} old pending applications created before ${dateString}.`);
                break;
            }

            // NOTE: force-approve and force-reject are not implemented yet as they require the full processApplication logic from bot.js
            // This would require significant refactoring to avoid code duplication.
            // For now, these actions are best handled via the Telegram bot or direct database modification if absolutely necessary.
            case 'force-approve':
            case 'force-reject':
                console.log('This feature is not yet implemented. Please use the Telegram bot for approvals/rejections.');
                break;

            default:
                console.log(`Unknown command: ${command}`);
                printUsage();
        }
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        if (db) {
            await db.close();
        }
    }
}

main();
