require('dotenv').config({ path: __dirname + '/.env' });
const { query } = require('./config/supabase');
const { sendPWAPushNotification } = require('./config/firebaseAdmin');

async function testPush() {
  try {
    console.log("🔍 Đang tìm token của người dùng Hùng Anh (User ID: 5)...");
    const tokensRes = await query(
      'SELECT fcm_token FROM user_push_tokens WHERE user_id = 5'
    );
    
    if (tokensRes.rows.length === 0) {
      console.warn("⚠️ Không tìm thấy FCM token nào cho Hùng Anh (User ID 5) trong CSDL!");
      return;
    }

    console.log(`✅ Tìm thấy ${tokensRes.rows.length} token(s). Đang gửi thử thông báo...`);
    for (const row of tokensRes.rows) {
      const token = row.fcm_token;
      console.log(`➡️ Đang gửi tới token: ${token.substring(0, 20)}...`);
      const result = await sendPWAPushNotification(
        token,
        "🧪 Thông báo thử nghiệm",
        "Đây là tin nhắn kiểm tra hệ thống thông báo đẩy PWA gửi từ backend!",
        "/workspace/1",
        "general"
      );
      console.log("📊 Kết quả gửi:", result);
    }
  } catch (err) {
    console.error("❌ Lỗi trong quá trình test push:", err.stack || err.message);
  }
}

testPush();
