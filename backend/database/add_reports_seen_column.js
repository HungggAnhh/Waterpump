// backend/database/add_reports_seen_column.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Migration cho task_reports...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Start Transaction
    await client.query('BEGIN');

    console.log("⚡ Đang thêm cột is_seen_by_admin vào bảng task_reports...");

    // 1. Thêm cột is_seen_by_admin vào bảng task_reports nếu chưa tồn tại
    await client.query(`
      ALTER TABLE task_reports
      ADD COLUMN IF NOT EXISTS is_seen_by_admin BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log("✔️ Đã thêm cột is_seen_by_admin.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION THÀNH CÔNG!");

  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
