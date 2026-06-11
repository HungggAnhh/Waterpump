// backend/database/migrate_workspaces_v2.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Phase 3 Migration...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Bắt đầu transaction
    await client.query('BEGIN');

    console.log("⚡ Đang tạo các bảng mới và cập nhật cấu trúc bảng cho workspaces...");

    // 1. Tạo bảng workspaces (nếu chưa có)
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        description TEXT NULL,
        icon        VARCHAR(50) DEFAULT 'folder',
        color       VARCHAR(50) DEFAULT '#3b82f6',
        avatar_url  TEXT NULL,
        is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng workspaces.");

    // 1.1 Đảm bảo cấu trúc cột của workspaces nếu bảng đã tồn tại trước đó
    await client.query(`
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT NULL;
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'folder';
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT '#3b82f6';
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log("👉 Đã đồng bộ cột cho bảng workspaces.");

    // 2. Tạo bảng workspace_members (nếu chưa có)
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_members (
        id           SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role         VARCHAR(50) DEFAULT 'member', -- 'owner', 'admin', 'member'
        joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT unique_workspace_user UNIQUE (workspace_id, user_id)
      );
    `);
    console.log("👉 Đã tạo bảng workspace_members.");

    // 3. Thay đổi cấu trúc bảng tasks để bổ sung workspace_id và is_archived (nếu chưa có)
    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log("👉 Đã thêm các cột workspace_id và is_archived vào bảng tasks.");

    // 4. Đồng bộ bảng task_comments: đảm bảo cột content TEXT tồn tại và cột comment có giá trị mặc định/bị thay đổi
    await client.query(`
      ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS content TEXT NULL;
    `);
    // Copy dữ liệu cũ từ comment sang content nếu có và content bị null
    await client.query(`
      UPDATE task_comments SET content = comment WHERE content IS NULL AND comment IS NOT NULL;
    `);
    // Đặt content NOT NULL nếu thích hợp, nhưng ở đây ta chỉ cần đảm bảo có content để tránh lỗi
    await client.query(`
      ALTER TABLE task_comments ALTER COLUMN content SET DATA TYPE TEXT;
    `);
    console.log("👉 Đã đồng bộ cột content cho bảng task_comments.");

    // 5. Tạo bảng task_attachments (nếu chưa có)
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id          SERIAL PRIMARY KEY,
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        file_url    TEXT NOT NULL,
        file_type   VARCHAR(50) NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng task_attachments.");

    // 6. Đảm bảo bảng task_activities có đầy đủ cột cần thiết
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_activities (
        id          SERIAL PRIMARY KEY,
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action      VARCHAR(100) NOT NULL, -- 'created', 'status_changed', 'priority_changed', 'deadline_updated', 'assigned', 'archived', 'deleted'
        old_value   TEXT NULL,
        new_value   TEXT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã đảm bảo bảng task_activities.");

    // 7. Tạo bảng notifications (nếu chưa có)
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       VARCHAR(255) NOT NULL,
        body        TEXT NOT NULL,
        type        VARCHAR(50) NOT NULL, -- 'task_assigned', 'task_completed', 'task_overdue', 'workspace_invite'
        data        JSONB NULL,
        is_read     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng notifications.");

    // Seed Workspace mặc định số 1 nếu chưa có
    await client.query(`
      INSERT INTO workspaces (id, name, description, icon, color, created_by)
      VALUES (1, 'Dự Án Chung 🚀', 'Không gian mặc định chứa toàn bộ các công việc công ty.', 'briefcase', '#1d4ed8', (SELECT id FROM users ORDER BY id ASC LIMIT 1))
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log("👉 Đã thêm workspace mặc định ID 1.");

    // Gán tất cả task hiện tại chưa thuộc workspace nào vào workspace mặc định ID 1
    await client.query(`
      UPDATE tasks SET workspace_id = 1 WHERE workspace_id IS NULL;
    `);
    console.log("👉 Đã liên kết tất cả task cũ vào workspace ID 1.");

    // Thêm tất cả users hiện có vào workspace mặc định với vai trò thích hợp
    // Admin thì cho làm admin hoặc owner, user thường cho làm member
    const usersRes = await client.query('SELECT id, role FROM users');
    for (const row of usersRes.rows) {
      const wRole = row.role === 'admin' ? 'owner' : 'member';
      await client.query(`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (1, $1, $2)
        ON CONFLICT (workspace_id, user_id) DO NOTHING;
      `, [row.id, wRole]);
    }
    console.log("👉 Đã gán tất cả thành viên vào workspace ID 1.");

    // Khởi tạo/Cập nhật các chuỗi sequence ID tự động tăng để tránh xung đột
    await client.query(`SELECT setval('workspaces_id_seq', COALESCE((SELECT MAX(id) FROM workspaces), 1));`);
    await client.query(`SELECT setval('workspace_members_id_seq', COALESCE((SELECT MAX(id) FROM workspace_members), 1));`);
    await client.query(`SELECT setval('task_attachments_id_seq', COALESCE((SELECT MAX(id) FROM task_attachments), 1));`);
    await client.query(`SELECT setval('notifications_id_seq', COALESCE((SELECT MAX(id) FROM notifications), 1));`);

    // Standardize status & priority tags inside task table
    // Chuyển status 'pending' thành 'todo' theo chuẩn hóa mới
    await client.query(`UPDATE tasks SET status = 'todo' WHERE status = 'pending';`);
    console.log("👉 Đã chuẩn hóa trạng thái task cũ từ 'pending' sang 'todo'.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION PHASE 3 THÀNH CÔNG RỰC RỠ!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi Migration Phase 3, đã ROLLBACK. Chi tiết lỗi:", err.message);
    throw err;
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration().catch(err => {
  console.error("❌ Migration thất bại:", err.message);
  process.exit(1);
});
