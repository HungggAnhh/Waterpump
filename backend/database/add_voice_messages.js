// backend/database/add_voice_messages.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    await client.query('BEGIN');

    console.log("⚡ Đang thêm các cột đính kèm rộng rãi vào bảng 'messages'...");
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_duration INTEGER;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime_type VARCHAR(100);
    `);

    console.log("👉 Đã tạo các cột attachment_url, attachment_duration, attachment_mime_type.");

    await client.query('COMMIT');
    console.log("🎉 MIGRATION THÀNH CÔNG!");

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
