// backend/config/firebaseAdmin.js
const admin = require('firebase-admin');
const { query } = require('./supabase');

// Initialize Firebase Admin SDK
try {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'teamflow-pwa';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Chuẩn hóa và làm sạch Private Key từ biến môi trường (xử lý triệt để dấu nháy và ký tự escape trên Render)
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) {
    privateKey = privateKey.trim();
    // 1. Loại bỏ các dấu nháy kép hoặc đơn bao bọc chuỗi (lỗi cực kỳ phổ biến khi dán trên dashboard Render)
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
      privateKey = privateKey.slice(1, -1);
    }
    // 2. Tự động sửa lỗi typo \A (mất chữ 'n' trong \n) để khôi phục định dạng
    privateKey = privateKey.replace(/\\A/g, '\nA');
    // 3. Thay thế các ký tự escape \n thành xuống dòng thực tế
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  if (clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    console.log("🔥 [firebaseAdmin] Đã khởi tạo Firebase Admin SDK thành công bằng service account credentials!");
  } else {
    // Fallback: Khởi tạo mặc định nếu chạy trên Google Cloud, hoặc in cảnh báo
    console.warn("⚠️ [firebaseAdmin] Thiếu FIREBASE_CLIENT_EMAIL hoặc FIREBASE_PRIVATE_KEY trong .env.");
    console.warn("⚠️ [firebaseAdmin] Đang khởi tạo bằng Application Default Credentials...");
    admin.initializeApp();
  }
} catch (error) {
  console.error("❌ [firebaseAdmin] Lỗi khởi tạo Firebase Admin SDK:", error.message);
  console.error("💡 Vui lòng thiết lập FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL và FIREBASE_PRIVATE_KEY trong file .env");
}

/**
 * Gửi thông báo Web Push qua FCM
 * 
 * @param {string} targetFCMToken FCM Web Token của người nhận
 * @param {string} title Tiêu đề thông báo
 * @param {string} body Nội dung thông báo
 * @param {string} dataUrl Đường dẫn PWA ứng dụng cần điều hướng khi click
 */
async function sendPWAPushNotification(targetFCMToken, title, body, dataUrl = '/', type = 'general') {
  if (!targetFCMToken) {
    console.warn("⚠️ [firebaseAdmin] Bỏ qua gửi thông báo: Token nhận vào trống.");
    return { success: false, error: "Empty token" };
  }

  // BỔ SUNG AN TOÀN KHÔNG CRASH: Kiểm tra nếu Firebase Admin chưa khởi tạo ứng dụng nào thành công
  if (!admin || !admin.apps || admin.apps.length === 0) {
    console.warn("⚠️ [firebaseAdmin] Bỏ qua gửi thông báo: Firebase Admin chưa được khởi tạo thành công (Thiếu Credentials).");
    return { success: false, error: "Firebase Admin App not initialized" };
  }

  // Cấu hình payload tin nhắn chứa cả khối notification chuẩn và data
  const message = {
    token: targetFCMToken,
    // Khối dữ liệu đi kèm hỗ trợ việc điều hướng và xử lý sự kiện
    data: {
      type: type,
      title: title,
      body: body,
      click_action: dataUrl,
      url: dataUrl,
      tag: `${type}-notification-` + Date.now()
    },
    // Cấu hình cụ thể cho Web Push (bao gồm độ ưu tiên)
    webpush: {
      headers: {
        Urgency: "high",
      }
    },
    // BỔ SUNG CẤU HÌNH ANDROID: Độ ưu tiên cao nhất kể cả khi đang ở chế độ ngủ (Doze Mode)
    android: {
      priority: 'high'
    },
    // BỔ SUNG CẤU HÌNH IOS (APNS): Đẩy tin tức thì, tự động đổ chuông và đánh thức thiết bị
    apns: {
      headers: {
        'apns-priority': '10', // 10 = gửi ngay lập tức, đánh thức thiết bị đang ở chế độ ngủ sâu
      },
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          'content-available': 1 // Đánh thức Service Worker trên nền iOS để hiển thị thông báo
        }
      }
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(`🚀 [firebaseAdmin] Đã gửi thông báo thành công tới token [${targetFCMToken.substring(0, 15)}...]:`, response);
    return { success: true, response };
  } catch (error) {
    console.error(`❌ [firebaseAdmin] Lỗi gửi thông báo tới token [${targetFCMToken.substring(0, 15)}...]:`, error.code || error.message);
    
    // BỔ SUNG QUAN TRỌNG: Tự động xóa token lỗi/hết hạn khỏi Database
    const isExpiredToken = 
      error.code === 'messaging/registration-token-not-registered' || 
      error.code === 'messaging/invalid-registration-token' ||
      error.message?.includes('registration-token-not-registered') ||
      error.message?.includes('invalid-registration-token');

    if (isExpiredToken) {
      console.log(`🧹 [firebaseAdmin] Phát hiện FCM Token hết hạn hoặc không hợp lệ. Đang dọn dẹp khỏi CSDL...`);
      try {
        const deleteRes = await query('DELETE FROM user_push_tokens WHERE fcm_token = $1', [targetFCMToken]);
        console.log(`✅ [firebaseAdmin] Đã dọn dẹp xong ${deleteRes.rowCount} token lỗi khỏi bảng user_push_tokens.`);
      } catch (dbErr) {
        console.error('❌ [firebaseAdmin] Không thể xóa token lỗi khỏi CSDL:', dbErr.message);
      }
    }

    return { success: false, error: error.message };
  }
}

module.exports = {
  admin,
  sendPWAPushNotification
};
