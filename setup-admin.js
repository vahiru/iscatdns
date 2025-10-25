const initializeDatabase = require('./database.js');

async function assignAdminRole(username) {
    if (!username) {
        console.error('错误: 请提供一个用户名。');
        console.log('用法: node setup-admin.js <username>');
        return;
    }

    const db = await initializeDatabase();

    try {
        const user = await db.get('SELECT * FROM users WHERE username = ?', username);
        if (!user) {
            console.error(`错误: 未找到用户名为 "${username}" 的用户。`);
            return;
        }

        if (user.role === 'admin') {
            console.log(`用户 "${username}" 已经是管理员了，无需操作。`);
            return;
        }

        await db.run('UPDATE users SET role = ? WHERE id = ?', 'admin', user.id);
        console.log(`✅ 成功！用户 "${username}" 现在是管理员了。`);

    } catch (error) {
        console.error('提升管理员时出错:', error);
    } finally {
        await db.close();
    }
}

const username = process.argv[2];
assignAdminRole(username);
