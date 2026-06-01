// backend/database/migrate_advanced_chat.js
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

    // Bắt đầu một Transaction
    await client.query('BEGIN');

    console.log("⚡ 1. Đang thêm các cột mới vào bảng 'messages'...");
    
    // Thêm các cột cho tính năng Trả lời, Chỉnh sửa, Thu hồi, Xóa, Chuyển tiếp
    await client.query(`
      ALTER TABLE messages 
        ADD COLUMN IF NOT EXISTS reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS recalled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS recalled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS forwarded BOOLEAN DEFAULT FALSE;
    `);
    console.log("✔️ Đã thêm các cột nâng cao vào bảng messages thành công.");

    console.log("⚡ 2. Đang tạo bảng 'message_reactions' (Thả cảm xúc)...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reaction VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(message_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
    `);
    console.log("✔️ Đã tạo bảng message_reactions thành công.");

    console.log("⚡ 3. Đang tạo bảng 'pinned_messages' (Ghim tin nhắn)...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS pinned_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        pinned_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pinned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(conversation_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pinned_conv ON pinned_messages(conversation_id);
    `);
    console.log("✔️ Đã tạo bảng pinned_messages thành công.");

    console.log("⚡ 4. Đang tạo bảng 'deleted_messages' (Xóa chỉ mình tôi)...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS deleted_messages (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(message_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_deleted_msgs_user ON deleted_messages(user_id);
    `);
    console.log("✔️ Đã tạo bảng deleted_messages thành công.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION NÂNG CẤP CHAT THÀNH CÔNG VÀ AN TOÀN!");

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
