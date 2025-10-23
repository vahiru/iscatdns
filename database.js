const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function initializeDatabase() {
    try {
        const db = await open({
            filename: './database.db',
            driver: sqlite3.Database
        });

        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add dns_records table
        await db.exec(`
            CREATE TABLE IF NOT EXISTS dns_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        
        console.log("Database initialized successfully.");
        return db;
    } catch (error) {
        console.error("Failed to initialize database:", error);
        process.exit(1);
    }
}

module.exports = initializeDatabase;
