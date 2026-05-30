// backend/config/supabase.js
// Kết nối Supabase PostgreSQL bằng pg Pool (dùng trong Express server)
const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase yêu cầu SSL
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Tăng lên 10 giây để tránh lỗi timeout do mạng chậm trên môi trường đám mây
  keepAlive: true, // Kích hoạt TCP Keep-Alive để giữ kết nối thông suốt, tránh bị ngắt âm thầm
  keepAliveInitialDelayMillis: 10000, // Tự động gửi gói tin thăm dò sau 10 giây
});

pool.on('error', (err) => {
  console.error('❌ Supabase DB pool error:', err.message);
});

// Helper: query shorthand
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
