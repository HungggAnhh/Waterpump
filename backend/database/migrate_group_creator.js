// backend/database/migrate_group_creator.js
const { pool } = require('../config/supabase');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("🚀 Bắt đầu di chuyển cơ sở dữ liệu: Thêm cột 'created_by' vào bảng 'conversations'...");
    
    // 1. Thêm cột created_by liên kết tới bảng users
    await client.query(`
      ALTER TABLE conversations 
      ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
    `);
    console.log("✔️ Đã thêm cột 'created_by' (nếu chưa có).");

    // 2. Cập nhật các nhóm hiện tại để Admin (id = 1) làm người tạo (tránh bị null)
    await client.query(`
      UPDATE conversations 
      SET created_by = 1 
      WHERE type = 'group' AND created_by IS NULL;
    `);
    console.log("✔️ Đã đặt người tạo mặc định cho các nhóm chat hiện tại.");

    console.log("🎉 Di chuyển cơ sở dữ liệu thành công!");
  } catch (error) {
    console.error("❌ Lỗi di chuyển cơ sở dữ liệu:", error.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
