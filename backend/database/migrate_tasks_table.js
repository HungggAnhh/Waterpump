// backend/database/migrate_tasks_table.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Migration...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Bắt đầu một Transaction
    await client.query('BEGIN');

    console.log("⚡ Đang thực hiện các thay đổi cấu trúc bảng (ALTER TABLE)...");

    // 1. Chuyển đổi kiểu dữ liệu cột status và priority từ ENUM sang VARCHAR(50) để tăng tính linh hoạt
    await client.query(`
      ALTER TABLE tasks ALTER COLUMN status TYPE VARCHAR(50);
      ALTER TABLE tasks ALTER COLUMN priority TYPE VARCHAR(50);
    `);
    console.log("👉 Đã chuyển đổi status và priority thành VARCHAR(50).");

    // 2. Đổi tên cột assignee_id -> assigned_to (kiểm tra sự tồn tại trước khi đổi tên)
    const checkAssigneeId = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='tasks' AND column_name='assignee_id';
    `);
    if (checkAssigneeId.rows.length > 0) {
      await client.query(`ALTER TABLE tasks RENAME COLUMN assignee_id TO assigned_to;`);
      console.log("👉 Đã đổi tên assignee_id thành assigned_to.");
    }

    // 3. Đổi tên cột due_date -> deadline (kiểm tra sự tồn tại trước khi đổi tên)
    const checkDueDate = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='tasks' AND column_name='due_date';
    `);
    if (checkDueDate.rows.length > 0) {
      await client.query(`ALTER TABLE tasks RENAME COLUMN due_date TO deadline;`);
      console.log("👉 Đã đổi tên due_date thành deadline.");
    }

    // 4. Thêm các cột mới phục vụ nghiệp vụ chi tiết (nếu chưa tồn tại)
    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);
    console.log("👉 Đã thêm các cột mới: assigned_by, progress, completed, completed_at, is_deleted, updated_at.");

    // 5. Cập nhật dữ liệu cũ tương thích với các quy định mới
    // - Đổi status 'todo' sang 'pending'
    await client.query(`UPDATE tasks SET status = 'pending' WHERE status = 'todo';`);
    // - Thiết lập completed = TRUE và completed_at cho các task có status là 'completed'
    await client.query(`UPDATE tasks SET completed = TRUE, completed_at = NOW() WHERE status = 'completed';`);
    // - Với các task chưa hoàn tất, đặt completed = FALSE
    await client.query(`UPDATE tasks SET completed = FALSE WHERE status != 'completed';`);
    console.log("👉 Đã cập nhật và chuẩn hóa dữ liệu cũ.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION THÀNH CÔNG VÀ AN TOÀN!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
