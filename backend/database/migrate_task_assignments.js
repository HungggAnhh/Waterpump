// backend/database/migrate_task_assignments.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Migration cho task_assignments...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Bắt đầu một Transaction
    await client.query('BEGIN');

    console.log("⚡ Đang thực thi truy vấn di trú (Migration)...");

    // 1. Tạo bảng task_assignments lưu phân công đa người nhận
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_assignments (
        task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       VARCHAR(50) NOT NULL DEFAULT 'todo',
        assigned_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        started_at   TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (task_id, user_id)
      );
    `);
    console.log("✔️ Đã tạo bảng task_assignments.");

    // 2. Tạo các chỉ mục tối ưu
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_assignments_task ON task_assignments(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_assignments_user ON task_assignments(user_id, status);
    `);
    console.log("✔️ Đã tạo chỉ mục tối ưu cho task_assignments.");

    // 3. Nới lỏng ràng buộc NOT NULL của workspace_id và page_id trong bảng tasks
    await client.query(`
      ALTER TABLE tasks ALTER COLUMN workspace_id DROP NOT NULL;
      ALTER TABLE tasks ALTER COLUMN page_id DROP NOT NULL;
    `);
    console.log("✔️ Đã gỡ bỏ ràng buộc NOT NULL cho workspace_id và page_id trong bảng tasks.");

    // 4. Thêm cột conversation_id vào bảng tasks
    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE;
    `);
    console.log("✔️ Đã thêm cột conversation_id vào bảng tasks.");

    // 5. Thêm cột task_id vào bảng messages
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
    `);
    console.log("✔️ Đã thêm cột task_id vào bảng messages.");

    // 6. Di trú dữ liệu hiện tại từ bảng tasks sang bảng task_assignments
    await client.query(`
      INSERT INTO task_assignments (task_id, user_id, status, assigned_by, started_at, completed_at, updated_at)
      SELECT id, assigned_to, status, created_by,
             CASE WHEN status = 'in_progress' OR status = 'completed' THEN created_at ELSE NULL END,
             CASE WHEN completed = TRUE THEN completed_at ELSE NULL END,
             updated_at
      FROM tasks
      WHERE assigned_to IS NOT NULL
      ON CONFLICT (task_id, user_id) DO NOTHING;
    `);
    console.log("✔️ Đã di trú phân công công việc hiện có sang bảng task_assignments.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION DI TRÚ NHIỆM VỤ NHÓM THÀNH CÔNG VÀ AN TOÀN!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
