// backend/database/create_push_tokens_table.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function createPushTokensTable() {
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

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS user_push_tokens (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        fcm_token TEXT NOT NULL UNIQUE,
        device_type VARCHAR(50) DEFAULT 'pwa_web',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `;

    console.log("⚡ Đang tạo bảng 'user_push_tokens' nếu chưa tồn tại...");
    await client.query(createTableSQL);
    console.log("🎉 KHỞI TẠO BẢNG user_push_tokens THÀNH CÔNG!");
  } catch (err) {
    console.error("❌ Lỗi khi khởi tạo bảng:", err.message);
  } finally {
    await client.end();
  }
}

createPushTokensTable();
