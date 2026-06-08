// backend/database/create_task_views_table.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Migration cho task_views...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Start Transaction
    await client.query('BEGIN');

    console.log("⚡ Đang thực thi truy vấn di trú (Migration)...");

    // 1. Tạo bảng task_views
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_views (
        id BIGSERIAL PRIMARY KEY,
        task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        first_viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(task_id, user_id)
      );
    `);
    console.log("✔️ Đã tạo bảng task_views.");

    // 2. Tạo chỉ mục tối ưu
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_views_task_user ON task_views(task_id, user_id);
    `);
    console.log("✔️ Đã tạo chỉ mục tối ưu cho task_views.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION TẠO BẢNG TASK_VIEWS THÀNH CÔNG!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
