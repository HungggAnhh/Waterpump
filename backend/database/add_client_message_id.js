// backend/database/add_client_message_id.js
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

    console.log("⚡ Đang thêm cột client_message_id vào bảng 'messages'...");
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(100);
    `);

    console.log("⚡ Đang tạo UNIQUE INDEX cho client_message_id để loại bỏ trùng lặp...");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_message_id 
      ON messages (client_message_id) 
      WHERE client_message_id IS NOT NULL;
    `);

    console.log("👉 Đã thiết lập cột client_message_id và Unique Index.");

    await client.query('COMMIT');
    console.log("🎉 MIGRATION HOÀN TẤT THÀNH CÔNG!");

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra khi chạy migration. Chi tiết lỗi:", err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
