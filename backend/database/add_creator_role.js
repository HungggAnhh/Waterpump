// backend/database/add_creator_role.js
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

    console.log("⚡ Đang thêm cột 'creator_role' vào bảng 'tasks' nếu chưa tồn tại...");

    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS creator_role VARCHAR(50) DEFAULT 'admin';
    `);

    console.log("👉 Đã đảm bảo cột 'creator_role' tồn tại thành công.");

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
