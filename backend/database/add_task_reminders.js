// backend/database/add_task_reminders.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để thêm cột reminder...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Bắt đầu một Transaction
    await client.query('BEGIN');

    console.log("⚡ Đang thêm các cột phục vụ tính năng hối thúc (reminder_interval, last_reminded_at)...");

    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_interval VARCHAR(50) DEFAULT NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ DEFAULT NULL;
    `);

    console.log("👉 Đã thêm thành công các cột reminder_interval và last_reminded_at.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION THÀNH CÔNG RỰC RỠ!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
