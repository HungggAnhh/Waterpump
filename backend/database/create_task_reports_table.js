// backend/database/create_task_reports_table.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Migration cho task_reports...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Start Transaction
    await client.query('BEGIN');

    console.log("⚡ Đang thực thi truy vấn di trú (Migration)...");

    // 1. Tạo bảng task_reports
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_reports (
        id BIGSERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_type VARCHAR(50) NOT NULL DEFAULT 'progress', -- 'progress', 'issue', 'material_request', 'completion'
        content TEXT NOT NULL,
        progress_percent INT NOT NULL CHECK (progress_percent >= 0 AND progress_percent <= 100),
        attachments JSONB DEFAULT '[]'::jsonb, -- Store list of uploaded files: [{url: "...", type: "...", name: "..."}]
        daily_report_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✔️ Đã tạo bảng task_reports.");

    // 2. Tạo chỉ mục tối ưu
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_reports_task_user ON task_reports(task_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_task_reports_date ON task_reports(daily_report_date);
    `);
    console.log("✔️ Đã tạo chỉ mục tối ưu cho task_reports.");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION TẠO BẢNG TASK_REPORTS THÀNH CÔNG!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi xảy ra, đã ROLLBACK. Chi tiết lỗi:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration();
