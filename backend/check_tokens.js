require('dotenv').config({ path: __dirname + '/.env' });
const { query } = require('./config/supabase');

async function checkTokens() {
  try {
    console.log("🔍 Đang truy vấn danh sách FCM Push Tokens trong CSDL...");
    const tokensRes = await query(
      `SELECT t.*, u.name, u.role FROM user_push_tokens t 
       LEFT JOIN users u ON t.user_id = u.id 
       ORDER BY t.updated_at DESC`
    );
    console.log(`✅ Tìm thấy ${tokensRes.rows.length} token(s):`);
    tokensRes.rows.forEach((row, i) => {
      console.log(`[${i+1}] User ID: ${row.user_id} (${row.name || 'Không rõ'}, Vai trò: ${row.role})`);
      console.log(`    Token: ${row.fcm_token.substring(0, 30)}...`);
      console.log(`    Thiết bị: ${row.device_type} | Cập nhật: ${row.updated_at}`);
    });
  } catch (err) {
    console.error("❌ Lỗi truy vấn FCM tokens:", err.message);
  }
}

checkTokens();
