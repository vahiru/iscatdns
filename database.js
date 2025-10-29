const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function initializeDatabase() {
    try {
        const db = await open({
            filename: './database.db',
            driver: sqlite3.Database
        });

        // --- users table modifications ---
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Add role column if not exists
        await db.all(`
            PRAGMA table_info(users);
        `).then(columns => {
            if (!columns.some(col => col.name === 'role')) {
                return db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';`);
            }
        });
        // Add email column if not exists
        await db.all(`
            PRAGMA table_info(users);
        `).then(columns => {
            if (!columns.some(col => col.name === 'email')) {
                return db.exec(`ALTER TABLE users ADD COLUMN email TEXT;`);
            }
        });
        // Add telegram_user_id column if not exists
        await db.all(`
            PRAGMA table_info(users);
        `).then(async columns => {
            if (!columns.some(col => col.name === 'telegram_user_id')) {
                await db.exec(`ALTER TABLE users ADD COLUMN telegram_user_id TEXT;`);
                await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users (telegram_user_id);`);
            }
        });

        // Add telegram_bind_token columns if they don't exist
        await db.all(`PRAGMA table_info(users)`).then(async columns => {
            if (!columns.some(col => col.name === 'telegram_bind_token')) {
                await db.exec(`ALTER TABLE users ADD COLUMN telegram_bind_token TEXT;`);
            }
            if (!columns.some(col => col.name === 'telegram_bind_token_expires_at')) {
                await db.exec(`ALTER TABLE users ADD COLUMN telegram_bind_token_expires_at DATETIME;`);
            }
        });

        // Add email verification columns if they don't exist
        await db.all(`PRAGMA table_info(users)`).then(async columns => {
            if (!columns.some(col => col.name === 'is_verified')) {
                await db.exec(`ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE;`);
            }
            if (!columns.some(col => col.name === 'email_verification_token')) {
                await db.exec(`ALTER TABLE users ADD COLUMN email_verification_token TEXT;`);
            }
            if (!columns.some(col => col.name === 'email_verification_token_expires_at')) {
                await db.exec(`ALTER TABLE users ADD COLUMN email_verification_token_expires_at DATETIME;`);
            }
        });

        // Add password reset columns if they don't exist
        await db.all(`PRAGMA table_info(users)`).then(async columns => {
            if (!columns.some(col => col.name === 'password_reset_token')) {
                await db.exec(`ALTER TABLE users ADD COLUMN password_reset_token TEXT;`);
            }
            if (!columns.some(col => col.name === 'password_reset_token_expires_at')) {
                await db.exec(`ALTER TABLE users ADD COLUMN password_reset_token_expires_at DATETIME;`);
            }
        });

        // --- dns_records table (with migration) ---
        const dnsRecordsInfo = await db.all("PRAGMA table_info(dns_records);").catch(() => []);
        const idColumn = dnsRecordsInfo.find(col => col.name === 'id');

        if (idColumn && idColumn.type === 'INTEGER') {
            console.log("Migrating dns_records table schema (INTEGER -> TEXT). This will delete existing records.");
            await db.exec('DROP TABLE dns_records;');
            console.log("Old dns_records table dropped.");
        }

        await db.exec(`
            CREATE TABLE IF NOT EXISTS dns_records (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                ttl INTEGER DEFAULT 3600,
                proxied BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);

        // --- subdomain_applications table (with migration) ---
        const appInfo = await db.all("PRAGMA table_info(subdomain_applications);").catch(() => []);
        const targetIdColumn = appInfo.find(col => col.name === 'target_dns_record_id');

        if (targetIdColumn && targetIdColumn.type === 'INTEGER') {
            console.log("Migrating subdomain_applications table schema (target_dns_record_id INTEGER -> TEXT). This will delete existing applications.");
            await db.exec('DROP TABLE subdomain_applications;');
            console.log("Old subdomain_applications table dropped.");
        }

        await db.exec(`
            CREATE TABLE IF NOT EXISTS subdomain_applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                request_type TEXT NOT NULL, -- 'create' or 'update'
                target_dns_record_id TEXT, -- NULL for 'create', references dns_records.id for 'update'
                subdomain TEXT NOT NULL,
                record_type TEXT NOT NULL, -- 'A' or 'CNAME'
                record_value TEXT NOT NULL,
                purpose TEXT,
                status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'expired'
                admin_notes TEXT,
                voting_deadline_at DATETIME NOT NULL,
                telegram_message_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (target_dns_record_id) REFERENCES dns_records(id) ON DELETE SET NULL
            );
        `);

        // --- application_votes table ---
        await db.exec(`
            CREATE TABLE IF NOT EXISTS application_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                application_id INTEGER NOT NULL,
                admin_telegram_user_id TEXT NOT NULL,
                vote_type TEXT NOT NULL, -- 'approve' or 'deny'
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (application_id, admin_telegram_user_id),
                FOREIGN KEY (application_id) REFERENCES subdomain_applications(id) ON DELETE CASCADE
            );
        `);

        // --- abuse_reports table ---
        await db.exec(`
            CREATE TABLE IF NOT EXISTS abuse_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subdomain TEXT NOT NULL,
                reason TEXT NOT NULL,
                details TEXT,
                reporter_ip TEXT,
                status TEXT NOT NULL DEFAULT 'new', -- 'new', 'acknowledged', 'resolved', 'ignored'
                telegram_message_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log("Database initialized successfully.");
        return db;
    } catch (error) {
        console.error("Failed to initialize database:", error);
        process.exit(1);
    }
}

module.exports = initializeDatabase;
