# 数据库维护文档

本文档提供了对本项目使用的 SQLite 数据库进行维护的指南。

## 1. 数据库结构概览

数据库文件为 `database.db`。它包含以下几个表：

### `users`

存储用户信息。

- `id`: INTEGER, PRIMARY KEY, AUTOINCREMENT - 用户唯一ID
- `username`: TEXT, NOT NULL, UNIQUE - 用户名
- `password`: TEXT, NOT NULL - 哈希后的密码
- `role`: TEXT, DEFAULT 'user' - 用户角色 ('user' 或 'admin')
- `email`: TEXT - 用户邮箱
- `is_verified`: BOOLEAN, DEFAULT FALSE - 邮箱是否已验证
- `email_verification_token`: TEXT - 邮箱验证令牌
- `email_verification_token_expires_at`: DATETIME - 邮箱验证令牌过期时间
- `password_reset_token`: TEXT - 密码重置令牌
- `password_reset_token_expires_at`: DATETIME - 密码重置令牌过期时间
- `telegram_user_id`: TEXT, UNIQUE - 绑定的 Telegram 用户 ID
- `telegram_bind_token`: TEXT - Telegram 绑定令牌
- `telegram_bind_token_expires_at`: DATETIME - Telegram 绑定令牌过期时间
- `created_at`: DATETIME, DEFAULT CURRENT_TIMESTAMP - 用户创建时间

### `dns_records`

存储用户创建的 DNS 记录。

- `id`: TEXT, PRIMARY KEY - Cloudflare DNS 记录 ID
- `user_id`: INTEGER, NOT NULL - 关联的 `users.id`
- `type`: TEXT, NOT NULL - DNS 记录类型 (e.g., 'A', 'CNAME')
- `name`: TEXT, NOT NULL - 完整的域名
- `content`: TEXT, NOT NULL - DNS 记录的值
- `ttl`: INTEGER, DEFAULT 3600 - TTL (Time To Live)
- `proxied`: BOOLEAN, DEFAULT FALSE - 是否开启 Cloudflare 代理
- `created_at`: DATETIME, DEFAULT CURRENT_TIMESTAMP - 记录创建时间

### `subdomain_applications`

存储用户申请子域名的记录。

- `id`: INTEGER, PRIMARY KEY, AUTOINCREMENT - 申请的唯一ID
- `user_id`: INTEGER, NOT NULL - 关联的 `users.id`
- `request_type`: TEXT, NOT NULL - 请求类型 ('create' 或 'update')
- `target_dns_record_id`: TEXT - 更新请求所针对的 `dns_records.id`
- `subdomain`: TEXT, NOT NULL - 申请的完整域名
- `record_type`: TEXT, NOT NULL - 记录类型
- `record_value`: TEXT, NOT NULL - 记录值
- `purpose`: TEXT - 申请用途
- `status`: TEXT, NOT NULL, DEFAULT 'pending' - 申请状态 ('pending', 'approved', 'rejected', 'expired', 'error')
- `admin_notes`: TEXT - 管理员备注
- `voting_deadline_at`: DATETIME, NOT NULL - 投票截止时间
- `telegram_message_id`: TEXT - 关联的 Telegram 消息 ID
- `created_at`: DATETIME, DEFAULT CURRENT_TIMESTAMP - 申请创建时间

### `application_votes`

存储管理员对申请的投票。

- `id`: INTEGER, PRIMARY KEY, AUTOINCREMENT - 投票的唯一ID
- `application_id`: INTEGER, NOT NULL - 关联的 `subdomain_applications.id`
- `admin_telegram_user_id`: TEXT, NOT NULL - 投票的管理员 Telegram ID
- `vote_type`: TEXT, NOT NULL - 投票类型 ('approve' 或 'deny')
- `created_at`: DATETIME, DEFAULT CURRENT_TIMESTAMP - 投票创建时间

### `abuse_reports`

存储滥用举报。

- `id`: INTEGER, PRIMARY KEY, AUTOINCREMENT - 举报的唯一ID
- `subdomain`: TEXT, NOT NULL - 被举报的子域名
- `reason`: TEXT, NOT NULL - 举报原因
- `details`: TEXT - 详细信息
- `reporter_ip`: TEXT - 举报人 IP 地址
- `status`: TEXT, NOT NULL, DEFAULT 'new' - 举报状态 ('new', 'acknowledged', 'resolved', 'ignored')
- `telegram_message_id`: TEXT - 关联的 Telegram 消息 ID
- `created_at`: DATETIME, DEFAULT CURRENT_TIMESTAMP - 举报创建时间

## 2. 备份与恢复

### 备份

由于数据库是单个文件，备份非常简单。只需复制 `database.db` 文件即可。

```bash
# 建议在执行备份前先停止应用服务
cp /path/to/your/project/database.db /path/to/your/backups/database.db.backup-$(date +%Y%m%d%H%M%S)
```

### 恢复

恢复数据库同样简单，只需将备份文件复制回原位。

```bash
# 建议在执行恢复前先停止应用服务
cp /path/to/your/backups/database.db.backup-YYYYMMDDHHMMSS /path/to/your/project/database.db
```

## 3. 数据清理

定期清理旧数据有助于保持数据库的性能。

### 清理已处理的申请

删除超过30天且状态为 `expired`, `rejected`, `approved` 或 `error` 的申请记录。`application_votes` 表中的相关投票会因外键约束被级联删除。

```sql
DELETE FROM subdomain_applications
WHERE status IN ('expired', 'rejected', 'approved', 'error')
  AND created_at < date('now', '-30 days');
```

### 清理已处理的滥用举报

删除超过90天且状态为 `resolved` 或 `ignored` 的举报记录。

```sql
DELETE FROM abuse_reports
WHERE status IN ('resolved', 'ignored')
  AND created_at < date('now', '-90 days');
```

## 4. 常见问题与故障排除

### 数据库锁定 (Database is locked)

- **原因**: 多个进程或线程同时尝试写入数据库。
- **解决方案**:
    1.  确保只运行一个应用实例。
    2.  如果问题持续，检查是否有其他进程（如手动的 `sqlite3` 命令行会话）正在访问数据库文件。

### 数据库损坏 (Database corruption)

- **原因**: 应用或服务器异常关闭，导致写入操作未完成。
- **解决方案**:
    1.  从最新的备份中恢复数据库。
    2.  尝试使用 SQLite 的 `.recover` 命令来恢复数据到一个新的数据库文件：
        ```bash
        sqlite3 database.db ".recover" | sqlite3 new_database.db
        ```

### 性能问题

- **原因**: 查询缓慢，通常是由于缺少索引。
- **解决方案**:
    1.  分析慢查询。
    2.  为经常用于 `WHERE` 子句、`JOIN` 条件和 `ORDER BY` 的列添加索引。

    本项目已为 `users.telegram_user_id` 创建了唯一索引。根据需要，可以考虑为以下列添加索引：
    - `subdomain_applications(status, voting_deadline_at)`
    - `dns_records(user_id)`
    - `abuse_reports(status)`

    **添加索引的示例 SQL 命令:**
    ```sql
    CREATE INDEX IF NOT EXISTS idx_applications_status_deadline ON subdomain_applications (status, voting_deadline_at);
    ```
