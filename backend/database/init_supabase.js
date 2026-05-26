// backend/database/init_supabase.js
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function initDatabase() {
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

    // Đọc file schema
    const schemaPath = path.join(__dirname, 'schema_postgres.sql');
    console.log(`📖 Đang đọc schema tại: ${schemaPath}`);
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log("⚡ Đang khởi tạo các bảng và nạp dữ liệu mẫu lên Supabase...");
    // Thực thi toàn bộ script SQL (pg hỗ trợ chạy multi-statement bằng dấu chấm phẩy)
    await client.query(sql);
    
    console.log("🎉 KHỞI TẠO CƠ SỞ DỮ LIỆU SUPABASE THÀNH CÔNG!");
    console.log("Bảng đã tạo: users, tasks, conversations, conversation_users, messages.");
    console.log("Dữ liệu mẫu đã được nạp đầy đủ.");
  } catch (err) {
    console.error("❌ Lỗi khi khởi tạo CSDL:", err.message);
  } finally {
    await client.end();
  }
}

initDatabase();
