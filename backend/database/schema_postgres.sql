-- =============================================================================
-- backend/database/schema_postgres.sql
-- PostgreSQL schema cho Supabase — chạy file này trong Supabase SQL Editor
-- =============================================================================

-- Xóa bảng cũ nếu cần reset (thứ tự phải đúng do foreign key)
DROP TABLE IF EXISTS messages           CASCADE;
DROP TABLE IF EXISTS conversation_users CASCADE;
DROP TABLE IF EXISTS conversations      CASCADE;
DROP TABLE IF EXISTS tasks              CASCADE;
DROP TABLE IF EXISTS users              CASCADE;

-- Drop custom types nếu tồn tại (để chạy lại an toàn)
DROP TYPE IF EXISTS user_role       CASCADE;
DROP TYPE IF EXISTS user_status     CASCADE;
DROP TYPE IF EXISTS task_status     CASCADE;
DROP TYPE IF EXISTS task_priority   CASCADE;
DROP TYPE IF EXISTS conv_type       CASCADE;
DROP TYPE IF EXISTS message_type    CASCADE;

-- =============================================================================
-- Custom ENUM types (PostgreSQL dùng CREATE TYPE thay vì inline ENUM)
-- =============================================================================
CREATE TYPE user_role     AS ENUM ('admin', 'user');
CREATE TYPE user_status   AS ENUM ('active', 'inactive');
CREATE TYPE task_status   AS ENUM ('todo', 'in_progress', 'completed');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE conv_type     AS ENUM ('direct', 'group');
CREATE TYPE message_type  AS ENUM ('text', 'image', 'file');

-- =============================================================================
-- 1. Bảng Users
-- =============================================================================
CREATE TABLE users (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(100) UNIQUE NOT NULL,
    password   VARCHAR(255) NOT NULL,
    avatar     VARCHAR(500) NULL,
    role       user_role   NOT NULL DEFAULT 'user',
    status     user_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. Bảng Tasks
-- =============================================================================
CREATE TABLE tasks (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    description TEXT NULL,
    status      task_status   NOT NULL DEFAULT 'todo',
    priority    task_priority NOT NULL DEFAULT 'medium',
    due_date    DATE NULL,
    assignee_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    created_by  INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    boss_checked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 3. Bảng Conversations
-- =============================================================================
CREATE TABLE conversations (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NULL,
    type       conv_type NOT NULL DEFAULT 'direct',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 4. Bảng Conversation Users (liên kết nhiều-nhiều)
-- =============================================================================
CREATE TABLE conversation_users (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

-- =============================================================================
-- 5. Bảng Messages
-- =============================================================================
CREATE TABLE messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    message         TEXT NOT NULL,
    type            message_type NOT NULL DEFAULT 'text',
    file_url        VARCHAR(500) NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index tối ưu truy vấn tin nhắn theo phòng chat
CREATE INDEX idx_messages_conv_id ON messages(conversation_id, id DESC);

-- =============================================================================
-- 6. Seed Data — dữ liệu mẫu
-- Mật khẩu: "password123" — hash bcrypt
-- =============================================================================
INSERT INTO users (id, name, email, password, avatar, role, status) VALUES
(1, 'Admin',        'pm@company.com',       '$2b$10$LR6LJOjxM6OT6jMT4HPvt.tMZOQHV66fiQlIAfr8BRPEL4mjuzDr.',
 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80', 'admin', 'active'),
(2, 'Chưa đặt tên', 'dev@company.com',      '$2b$10$LR6LJOjxM6OT6jMT4HPvt.tMZOQHV66fiQlIAfr8BRPEL4mjuzDr.',
 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150&q=80', 'user',  'active'),
(3, 'Chưa đặt tên', 'designer@company.com', '$2b$10$LR6LJOjxM6OT6jMT4HPvt.tMZOQHV66fiQlIAfr8BRPEL4mjuzDr.',
 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&h=150&q=80', 'user',  'active');

-- Reset SERIAL sequence sau khi INSERT với ID cụ thể
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

INSERT INTO tasks (id, title, description, status, priority, due_date, assignee_id, created_by, boss_checked) VALUES
(1, 'Cài viber',                            'Cài đặt Viber cho đội ngũ kỹ thuật',                                          'in_progress', 'medium', '2026-05-28', 2, 1, FALSE),
(2, 'thiết kế phần quản lý sản xuất vi phun sương', 'Thiết kế cấu trúc bảng quản lý hệ thống máy vi phun sương',           'completed',   'high',   '2026-05-27', 3, 1, TRUE),
(3, 'mai show a xem bảng thiết kế mô phỏng giống như yêu cầu của a', 'Chuẩn bị file trình chiếu 3D mockup hoàn thiện',    'completed',   'high',   '2026-05-26', 3, 1, FALSE),
(4, 'Chat nội bộ',                          'Module chat thời gian thực sử dụng Socket.IO',                                 'in_progress', 'high',   '2026-05-28', 2, 1, FALSE),
(5, 'Notion giao việc',                     'Thiết kế trang giao việc dạng Notion Table trên App di động',                  'in_progress', 'medium', '2026-05-28', 1, 1, FALSE),
(6, 'tính năng trang sản xuất, thống kê lượng hàng cần', 'Tối giản hóa và tối ưu giao diện thống kê sản phẩm',            'completed',   'medium', '2026-05-29', 2, 1, FALSE),
(7, 'chat nội bộ, giao việc, nếu a có việc gấp lúc giao việc a bấm vô, nó sẽ push và báo đt liên tục', 'Nút báo động đỏ đẩy notification liên tục cho việc gấp', 'todo', 'high', '2026-06-02', 1, 1, FALSE),
(8, 'ví dụ Phúc nó hoàn tất rồi, mà a ko bik đã check chưa, e thêm nút như sếp đã check', 'Nhấn nút sếp đã duyệt để dòng công việc tự động tối màu', 'todo', 'medium', '2026-06-03', 2, 1, FALSE);

SELECT setval('tasks_id_seq', (SELECT MAX(id) FROM tasks));

INSERT INTO conversations (id, name, type) VALUES
(1, 'Nhóm Dự Án App-Assign', 'group'),
(2, NULL, 'direct');

SELECT setval('conversations_id_seq', (SELECT MAX(id) FROM conversations));

INSERT INTO conversation_users (conversation_id, user_id) VALUES
(1, 1), (1, 2), (1, 3),
(2, 1), (2, 2);

INSERT INTO messages (id, conversation_id, sender_id, message, type) VALUES
(1, 1, 1, 'Chào cả nhóm, chúng ta bắt đầu triển khai dự án App-Assign tasks nhé!', 'text'),
(2, 1, 3, 'Em đã hoàn thành xong bản phác thảo giao diện trên Stitch rồi ạ.', 'text'),
(3, 1, 2, 'Vâng anh, em đang bắt đầu dựng DB và viết API PHP.', 'text'),
(4, 2, 1, 'Chào em, DB chat em đã dựng xong chưa?', 'text'),
(5, 2, 2, 'Em đã dựng xong các bảng conversations, conversation_users và messages rồi anh ạ.', 'text');

SELECT setval('messages_id_seq', (SELECT MAX(id) FROM messages));
