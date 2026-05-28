// backend/database/migrate_phase2_tables.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Phase 2 Migration...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Bắt đầu transaction
    await client.query('BEGIN');

    console.log("⚡ Đang tạo các bảng mới cho hoạt động (task_activities) và bình luận (task_comments)...");

    // 1. Tạo bảng task_activities
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_activities (
        id          SERIAL PRIMARY KEY,
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action      VARCHAR(100) NOT NULL, -- 'created', 'status_changed', 'priority_changed', 'deadline_updated', 'assigned', 'deleted'
        old_value   TEXT NULL,
        new_value   TEXT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng task_activities.");

    // 2. Tạo bảng task_comments
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id          SERIAL PRIMARY KEY,
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment     TEXT NOT NULL,
        file_url    VARCHAR(500) NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng task_comments.");

    // 3. Tạo các chỉ mục (Indexes) để tăng hiệu suất truy vấn
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activities_task ON task_activities(task_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id, id DESC);
    `);
    console.log("👉 Đã thiết lập các Index idx_activities_task và idx_comments_task.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION PHASE 2 THÀNH CÔNG RỰC RỠ!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi Migration Phase 2, đã ROLLBACK. Chi tiết lỗi:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
