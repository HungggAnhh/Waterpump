// backend/database/migrate_approval_workflow.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Enterprise Approval Workflow Migration...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Bắt đầu một Transaction
    await client.query('BEGIN');

    console.log("⚡ Đang thêm các cột mới phục vụ quy trình Phê duyệt Enterprise...");

    // 1. Thêm các cột mới (nếu chưa tồn tại)
    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50) DEFAULT 'pending';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision_note TEXT NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision_count INTEGER DEFAULT 0;
    `);
    console.log("👉 Đã đảm bảo các cột: approval_status, approved_by, approved_at, revision_note, revision_count.");

    // 2. Chuyển đổi và chuẩn hóa dữ liệu cũ
    // - Đặt approval_status = 'completed' cho các task đã hoàn thành
    await client.query(`
      UPDATE tasks 
      SET approval_status = 'completed',
          approved_at = COALESCE(updated_at, created_at, NOW())
      WHERE completed = TRUE OR status = 'completed';
    `);
    console.log("👉 Đã cập nhật approval_status = 'completed' cho các task đã hoàn thành.");

    // - Đặt approval_status = 'in_progress' cho các task đang thực hiện nhưng chưa hoàn thành
    await client.query(`
      UPDATE tasks 
      SET approval_status = 'in_progress' 
      WHERE (status = 'in_progress') AND (completed = FALSE OR completed IS NULL);
    `);
    console.log("👉 Đã cập nhật approval_status = 'in_progress' cho các task đang làm.");

    // - Đặt approval_status = 'pending' cho các task còn lại
    await client.query(`
      UPDATE tasks 
      SET approval_status = 'pending' 
      WHERE approval_status IS NULL OR (approval_status NOT IN ('completed', 'in_progress'));
    `);
    console.log("👉 Đã đặt approval_status = 'pending' cho tất cả các nhiệm vụ chưa bắt đầu.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION PHÊ DUYỆT DOANH NGHIỆP THÀNH CÔNG RỰC RỠ!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi Migration, đã ROLLBACK. Chi tiết lỗi:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
