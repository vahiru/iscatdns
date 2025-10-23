
require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const initializeDatabase = require('./database.js');
const fs = require('fs'); // Add fs module

// --- 基本配置 ---
const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

// --- Cloudflare API 配置 ---
const { CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN, PARENT_DOMAIN, TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY, SESSION_SECRET } = process.env;

if (!CLOUDFLARE_ZONE_ID || !CLOUDFLARE_API_TOKEN || !PARENT_DOMAIN || !TURNSTILE_SECRET_KEY || !TURNSTILE_SITE_KEY || !SESSION_SECRET) {
    console.error("FATAL: .env 文件缺少必要的凭证。请检查所有 Cloudflare 和会话密钥。");
    process.exit(1);
}

const cfApi = axios.create({
    baseURL: `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/`,
    headers: { 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }
});


// --- 主函数 ---
async function main() {
    const db = await initializeDatabase();

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

    // --- 公共路由 (无需登录) ---

    // 认证页面 (HTML) - 这些页面本身不需要登录
    app.get('/login', (req, res) => {
        if (req.session.isLoggedIn) return res.redirect('/'); // 如果已登录，直接跳转到主页
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    });
    // 获取 Turnstile Site Key (无需登录)
    app.get('/api/turnstile-sitekey', (req, res) => {
        res.status(200).json({ siteKey: TURNSTILE_SITE_KEY });
    });

    // 检查登录状态 (无需登录)
    app.get('/api/check-login-status', (req, res) => {
        res.status(200).json({ isLoggedIn: req.session.isLoggedIn || false });
    });

    // 认证 API (POST)
    app.get('/register', (req, res) => {
        if (req.session.isLoggedIn) return res.redirect('/'); // 如果已登录，直接跳转到主页
        res.sendFile(path.join(__dirname, 'public', 'register.html'));
    });

    app.post('/register', verifyTurnstile, async (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).send("用户名和密码不能为空。");
        }
        try {
            const existingUser = await db.get('SELECT * FROM users WHERE username = ?', username);
            if (existingUser) {
                return res.status(409).send("用户名已存在。");
            }
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            await db.run('INSERT INTO users (username, password) VALUES (?, ?)', username, hashedPassword);
            res.redirect('/login');
        } catch (error) {
            res.status(500).send("服务器内部错误。");
        }
    });

    app.post('/login', verifyTurnstile, async (req, res) => {
        const { username, password } = req.body;
        try {
            const user = await db.get('SELECT * FROM users WHERE username = ?', username);
            if (user && await bcrypt.compare(password, user.password)) {
                req.session.isLoggedIn = true;
                req.session.username = user.username;
                req.session.userId = user.id; // Store user ID
                res.redirect('/dashboard');
            } else {
                res.status(401).send("用户名或密码不正确。");
            }
        } catch (error) {
            res.status(500).send("服务器内部错误。");
        }
    });

    app.post('/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) {
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

    // Cloudflare API 路由
    const getFullDomain = (subdomain) => {
        if (subdomain === '@' || subdomain === '') {
            return PARENT_DOMAIN.toLowerCase();
        }
        return `${subdomain}.${PARENT_DOMAIN}`.toLowerCase();
    };

    // 获取所有 DNS 记录
    app.get('/api/dns/records', async (req, res) => {
        try {
            // 从数据库获取用户创建的 DNS 记录
            const userDnsRecords = await db.all('SELECT * FROM dns_records WHERE user_id = ?', req.session.userId);
            // 假设 Cloudflare API 返回的记录也需要过滤或合并，这里简化为只返回用户创建的记录
            // 如果需要从 Cloudflare 获取所有记录并过滤，则需要更复杂的逻辑
            res.status(200).json(userDnsRecords);
        } catch (error) {
            console.error("获取用户 DNS 记录失败:", error);
            res.status(500).json({ message: '获取 DNS 记录失败。' });
        }
    });

    // 添加 DNS 记录
    app.post('/api/dns/records', async (req, res) => {
        const { type, name, content, ttl = 3600, proxied = false } = req.body;
        if (!type || !name || !content) {
            return res.status(400).json({ message: '类型、名称和内容不能为空。' });
        }

        const fullDomain = getFullDomain(name);
        try {
            // 先在 Cloudflare 创建记录
            const cfPayload = { type, name: fullDomain, content, ttl, proxied };
            const { data: cfResponse } = await cfApi.post('dns_records', cfPayload);

            // 然后将记录信息保存到数据库，并关联用户ID
            await db.run(
                'INSERT INTO dns_records (user_id, type, name, content, ttl, proxied) VALUES (?, ?, ?, ?, ?, ?)',
                req.session.userId, type, fullDomain, content, ttl, proxied
            );
            res.status(201).json(cfResponse.result);
        } catch (error) {
            console.error("Cloudflare API 添加 DNS 记录失败:", error.response ? error.response.data : error.message);
            res.status(500).json({ message: '添加 DNS 记录失败。' });
        }
    });

    // 更新 DNS 记录
    app.put('/api/dns/records/:id', async (req, res) => {
        const { id } = req.params;
        const { type, name, content, ttl = 3600, proxied = false } = req.body;
        if (!type || !name || !content) {
            return res.status(400).json({ message: '类型、名称和内容不能为空。' });
        }

        try {
            // 验证记录是否属于当前用户
            const record = await db.get('SELECT * FROM dns_records WHERE id = ? AND user_id = ?', id, req.session.userId);
            if (!record) {
                return res.status(403).json({ message: '无权修改此记录或记录不存在。' });
            }

            const fullDomain = getFullDomain(name);
            // 先在 Cloudflare 更新记录
            const cfPayload = { type, name: fullDomain, content, ttl, proxied };
            const { data: cfResponse } = await cfApi.put(`dns_records/${id}`, cfPayload);

            // 然后更新数据库中的记录
            await db.run(
                'UPDATE dns_records SET type = ?, name = ?, content = ?, ttl = ?, proxied = ? WHERE id = ?',
                type, fullDomain, content, ttl, proxied, id
            );
            res.status(200).json(cfResponse.result);
        } catch (error) {
            console.error("Cloudflare API 更新 DNS 记录失败:", error.response ? error.response.data : error.message);
            res.status(500).json({ message: '更新 DNS 记录失败。' });
        }
    });

    // 删除 DNS 记录
    app.delete('/api/dns/records/:id', async (req, res) => {
        const { id } = req.params;
        try {
            // 验证记录是否属于当前用户
            const record = await db.get('SELECT * FROM dns_records WHERE id = ? AND user_id = ?', id, req.session.userId);
            if (!record) {
                return res.status(403).json({ message: '无权删除此记录或记录不存在。' });
            }

            // 先在 Cloudflare 删除记录
            await cfApi.delete(`dns_records/${id}`);

            // 然后删除数据库中的记录
            await db.run('DELETE FROM dns_records WHERE id = ?', id);
            res.status(204).send(); // No Content
        } catch (error) {
            console.error("Cloudflare API 删除 DNS 记录失败:", error.response ? error.response.data : error.message);
            res.status(500).json({ message: '删除 DNS 记录失败。' });
        }
    });

    // 兼容旧的 set-ip 和 delegate 路由 (可选，如果不再需要可以删除)
    app.post('/api/set-ip', async (req, res) => {
        const { subdomain, ip } = req.body;
        if (!subdomain || !ip) return res.status(400).json({ message: '子域名和 IP 不能为空。' });
        
        const fullDomain = getFullDomain(subdomain);
        try {
            const { data } = await cfApi.get('dns_records', { params: { name: fullDomain, type: 'A' } });
            const payload = { type: 'A', name: fullDomain, content: ip, ttl: 3600, proxied: false };
            if (data.result.length > 0) {
                await cfApi.put(`dns_records/${data.result[0].id}`, payload);
            } else {
                await cfApi.post('dns_records', payload);
            }
            res.status(200).json({ message: `成功！已将 ${fullDomain} 指向 ${ip}。` });
        } catch (error) {
            console.error("Cloudflare API set-ip 失败:", error.response ? error.response.data : error.message);
            res.status(500).json({ message: 'Cloudflare API 操作失败。' });
        }
    });

    app.post('/api/delegate', async (req, res) => {
        const { subdomain, nameservers } = req.body;
        if (!subdomain || !nameservers || nameservers.length === 0) return res.status(400).json({ message: '子域名和 NS 不能为空。' });

        const fullDomain = getFullDomain(subdomain);
        try {
            const { data } = await cfApi.get('dns_records', { params: { name: fullDomain } });
            const conflicting = data.result.filter(r => ['A', 'AAAA', 'CNAME', 'NS'].includes(r.type));
            for (const record of conflicting) {
                await cfApi.delete(`dns_records/${record.id}`);
            }
            for (const ns of nameservers) {
                await cfApi.post('dns_records', { type: 'NS', name: fullDomain, content: ns, ttl: 3600 });
            }
            res.status(200).json({ message: `成功！已将 ${fullDomain} 委派给: ${nameservers.join(', ')}。` });
        } catch (error) {
            console.error("Cloudflare API delegate 失败:", error.response ? error.response.data : error.message);
            res.status(500).json({ message: 'Cloudflare API 操作失败。' });
        }
    });

    // --- 启动服务器 ---
    app.listen(PORT, () => {
        console.log(`🐾 服务器正在 http://localhost:${PORT} 上可爱地运行...`);
    });
}

main();
