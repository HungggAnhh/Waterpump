// backend/config/supabase.js
// Kết nối Supabase PostgreSQL bằng pg Pool (dùng trong Express server)
const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase yêu cầu SSL
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ Supabase DB pool error:', err.message);
});

// Helper: query shorthand
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
