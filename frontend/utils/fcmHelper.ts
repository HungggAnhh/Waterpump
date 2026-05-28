// frontend/utils/fcmHelper.ts
import { Platform } from 'react-native';
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';
import { API_BASE_URL } from '../constants/Config';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC7cj239QmskW3cWmTBPKp4zDNvnrx43eE",
  authDomain: "teamflow-pwa.firebaseapp.com",
  projectId: "teamflow-pwa",
  storageBucket: "teamflow-pwa.firebasestorage.app",
  messagingSenderId: "881187267874",
  appId: "1:881187267874:web:1a472ef6ee269f5f23f17b",
  measurementId: "G-8F5GLB5YJF"
};

// VAPID Cloud Messaging Key (Key trong tin nhắn đám mây)
const VAPID_KEY = "BCyaQQAci_QT3BdeDkc8ZG3ekK6otRPYCNMUjwbCrPr7Hi5qGD9eEbdUYpmrSXBCXx7fTuGh3DhjCKqhYcPgSXE";

/**
 * Đăng ký Push Token lên Backend Node.js/Supabase
 */
async function registerTokenOnBackend(token: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/users/register-push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcmToken: token,
        deviceType: 'pwa_web'
      })
    });

    const result = await response.json();
    if (response.ok && result.status === 'success') {
      console.log('✅ [fcmHelper] Đăng ký FCM token trên backend thành công!');
    } else {
      console.error('❌ [fcmHelper] Đăng ký FCM token thất bại:', result.message);
    }
  } catch (error) {
    console.error('❌ [fcmHelper] Lỗi khi gọi API đăng ký FCM token:', error);
  }
}

// Biến cờ (flag) toàn cục trong phiên chạy để chống trùng lặp và lặp re-render vô hạn
let isFCMRegisteringOrRegistered = false;

/**
 * Xin quyền thông báo và lấy FCM Token
 */
export async function requestAndRegisterFCM() {
  // Chỉ thực hiện trên trình duyệt Web (PWA)
  if (Platform.OS !== 'web') {
    console.log('[fcmHelper] Bỏ qua đăng ký FCM do không phải môi trường Web.');
    return;
  }

  if (isFCMRegisteringOrRegistered) {
    console.log('[fcmHelper] Đăng ký FCM đã hoàn thành hoặc đang được xử lý. Bỏ qua để chống vòng lặp vô hạn.');
    return;
  }
  isFCMRegisteringOrRegistered = true;

  // Kiểm tra hỗ trợ của Trình duyệt cho Service Worker và Notifications
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[fcmHelper] Trình duyệt này không hỗ trợ Service Worker hoặc Push Notifications.');
    return;
  }

  try {
    // 1. Xin quyền thông báo trình duyệt
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      console.warn('[fcmHelper] Quyền nhận thông báo bị từ chối.');
      return;
    }

    console.log('[fcmHelper] Quyền nhận thông báo đã được cấp. Đang lấy FCM Token...');

    // 2. Khởi tạo Firebase Client
    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);

    // 3. Đăng ký và đảm bảo Service Worker đang hoạt động
    // Sử dụng đường dẫn tương đối để tương thích tốt với Electron cục bộ hoặc subdirectory
    const registration = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    console.log('[fcmHelper] Service Worker đã được đăng ký thành công!');

    // 4. Lấy FCM Token từ Firebase SDK
    const fcmToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (fcmToken) {
      console.log('🎫 [fcmHelper] Lấy FCM token thành công:', fcmToken);
      // 5. Gửi lên backend để lưu trữ
      await registerTokenOnBackend(fcmToken);
    } else {
      console.warn('[fcmHelper] Không thể lấy FCM Token. Kiểm tra quyền hoặc cấu hình.');
      isFCMRegisteringOrRegistered = false; // Reset cờ khi thất bại để cho phép thử lại
    }
  } catch (error) {
    console.error('❌ [fcmHelper] Lỗi trong quá trình xin quyền & lấy FCM token:', error);
    isFCMRegisteringOrRegistered = false; // Reset cờ khi gặp lỗi để cho phép thử lại
  }
}
