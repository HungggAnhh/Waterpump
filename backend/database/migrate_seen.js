// backend/database/migrate_seen.js
const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

async function migrate() {
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

    console.log("⚡ Đang thực thi truy vấn di trú (Migration)...");
    
    // 1. Thêm cột last_seen_message_id vào bảng conversation_users
    await client.query(`
      ALTER TABLE conversation_users
      ADD COLUMN IF NOT EXISTS last_seen_message_id INT REFERENCES messages(id) ON DELETE SET NULL;
    `);
    console.log("✔️ Đã thêm cột last_seen_message_id (nếu chưa có).");

    // 2. Thêm cột last_seen_at vào bảng conversation_users
    await client.query(`
      ALTER TABLE conversation_users
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
    `);
    console.log("✔️ Đã thêm cột last_seen_at (nếu chưa có).");

    // 3. Tạo index tối ưu hóa cho bảng messages (conversation_id, id)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_id
      ON messages(conversation_id, id);
    `);
    console.log("✔️ Đã tạo chỉ mục idx_messages_conversation_id_id.");

    // 4. Tạo index tối ưu hóa cho bảng conversation_users (user_id, conversation_id)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversation_users_user
      ON conversation_users(user_id, conversation_id);
    `);
    console.log("✔️ Đã tạo chỉ mục idx_conversation_users_user.");

    console.log("🎉 DI TRÚ DỮ LIỆU THÀNH CÔNG!");
  } catch (err) {
    console.error("❌ Lỗi khi thực thi Migration:", err.message);
  } finally {
    await client.end();
  }
}

migrate();
