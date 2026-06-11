// backend/database/add_retention_columns.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Migration cho retention columns...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Start Transaction
    await client.query('BEGIN');

    const tables = ['messages', 'task_attachments', 'task_reports', 'task_comments'];

    for (const table of tables) {
      console.log(`⚡ Đang thêm cột retention vào bảng ${table}...`);
      await client.query(`
        ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS file_deleted_at TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS file_deleted_reason TEXT NULL;
      `);
      console.log(`✔️ Đã đồng bộ cột cho bảng ${table}.`);
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION RETENTION COLUMNS THÀNH CÔNG!");

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
