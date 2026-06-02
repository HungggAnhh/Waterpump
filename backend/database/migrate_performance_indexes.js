// backend/database/migrate_performance_indexes.js
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

    console.log("⚡ 1. Đang tạo các chỉ mục tối ưu hóa cho bảng 'tasks'...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_page_id ON tasks(page_id);
    `);
    console.log("✔️ Đã tạo index trên bảng tasks.");

    console.log("⚡ 2. Đang tạo các chỉ mục tối ưu hóa cho bảng 'messages'...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_id ON messages(conversation_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
    `);
    console.log("✔️ Đã tạo index trên bảng messages.");

    console.log("⚡ 3. Đang tạo các chỉ mục tối ưu hóa cho bảng 'pinned_messages'...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pinned_messages_composite ON pinned_messages(conversation_id, message_id);
    `);
    console.log("✔️ Đã tạo index trên bảng pinned_messages.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 DI TRÚ CHỈ MỤC HIỆU NĂNG THÀNH CÔNG!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra khi di trú, đã ROLLBACK. Chi tiết lỗi:", err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
