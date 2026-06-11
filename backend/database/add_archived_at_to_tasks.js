// backend/database/add_archived_at_to_tasks.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Migration...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    await client.query('BEGIN');

    // Thêm cột archived_at nếu chưa có
    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;
    `);
    console.log("👉 Đã thêm cột archived_at vào bảng tasks.");

    // Đồng bộ dữ liệu: task đã is_archived=TRUE nhưng chưa có archived_at -> set = completed_at
    await client.query(`
      UPDATE tasks
      SET archived_at = COALESCE(completed_at, NOW())
      WHERE is_archived = TRUE AND archived_at IS NULL;
    `);
    console.log("👉 Đã đồng bộ archived_at cho các task đã lưu trữ.");

    // Tạo index để tăng hiệu suất truy vấn retention job
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(is_archived, completed_at);
    `);
    console.log("👉 Đã tạo index idx_tasks_archived.");

    await client.query('COMMIT');
    console.log("🎉 MIGRATION THÀNH CÔNG!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
