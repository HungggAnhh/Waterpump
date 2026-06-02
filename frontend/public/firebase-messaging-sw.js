// frontend/public/firebase-messaging-sw.js

// Import standard Firebase SDK v9 Compatibility libraries
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC7cj239QmskW3cWmTBPKp4zDNvnrx43eE",
  authDomain: "teamflow-pwa.firebaseapp.com",
  projectId: "teamflow-pwa",
  storageBucket: "teamflow-pwa.firebasestorage.app",
  messagingSenderId: "881187267874",
  appId: "1:881187267874:web:1a472ef6ee269f5f23f17b",
  measurementId: "G-8F5GLB5YJF"
};

// Initialize Firebase App compat
firebase.initializeApp(firebaseConfig);

// Initialize Firebase Messaging compat
const messaging = firebase.messaging();

// Native Push Event Listener (Đảm bảo hoạt động 100% trên cả Mobile và PC/Desktop)
// Bọc toàn bộ quá trình xử lý trong event.waitUntil() để giữ Service Worker sống cho đến khi hiển thị xong thông báo
self.addEventListener('push', (event) => {
  console.log('[firebase-messaging-sw.js] Nhận sự kiện push native:', event);

  let data = {};
  let notificationTitle = 'Thông báo mới';
  let notificationBody = '';
  let notificationType = 'general';
  let tag = 'general-notification';

  if (event.data) {
    try {
      const payload = event.data.json();
      console.log('[firebase-messaging-sw.js] Dữ liệu sự kiện push (JSON):', payload);
      
      // Nếu tin nhắn có khối notification tiêu chuẩn (thường do Firebase SDK/Trình duyệt hiển thị tự động ngoài nền),
      // bỏ qua hiển thị thủ công để chống trùng lặp (tránh hiển thị thông báo kép).
      if (payload.notification || (payload.webpush && payload.webpush.notification)) {
        console.log('[firebase-messaging-sw.js] Phát hiện khối notification tiêu chuẩn. Bỏ qua hiển thị thủ công.');
        return;
      }

      data = payload.data || {};
      notificationTitle = data.title || 'Thông báo mới';
      notificationBody = data.body || '';
      notificationType = data.type || 'general';
      tag = data.tag || (notificationType === 'chat' ? 'chat-group' : (notificationType === 'task' ? 'task-group' : 'general-notification'));
    } catch (e) {
      console.warn('[firebase-messaging-sw.js] Lỗi parse JSON payload push, chuyển sang text:', e);
      notificationBody = event.data.text() || '';
    }
  }

  const notificationOptions = {
    body: notificationBody,
    icon: 'icon-192.png', // Sử dụng đường dẫn tương đối để tránh lỗi 404 trên các môi trường cục bộ/Electron
    badge: 'icon-192.png', // Sử dụng đường dẫn tương đối
    requireInteraction: true, // Giữ thông báo hiển thị cho đến khi tắt hoặc tương tác
    vibrate: notificationType === 'call'
      ? [500, 200, 500, 200, 500, 200, 500, 200, 500, 200, 500]
      : [200, 100, 200],
    data: {
      url: data.click_action || data.url || '/',
      ...data
    },
    tag: tag,
  };

  if (notificationType === 'call') {
    notificationOptions.actions = [
      { action: 'answer', title: 'Trả lời 📞' },
      { action: 'decline', title: 'Từ chối ❌' }
    ];
  }

  console.log(`💻 [firebase-messaging-sw.js] Đang hiển thị thông báo [${notificationType}] - Title: "${notificationTitle}"`);

  // BẮT BUỘC TRÊN PC/DESKTOP: Bọc showNotification trong event.waitUntil để hệ điều hành không kill luồng Service Worker nửa chừng
  event.waitUntil(
    self.registration.showNotification(notificationTitle, notificationOptions)
  );
});// Handle click action on Notification to redirect or open window
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Click thông báo:', event);
  
  // Close the notification bubble
  event.notification.close();

  const action = event.action;
  if (action === 'decline') {
    console.log('[firebase-messaging-sw.js] Người dùng bấm Từ chối cuộc gọi.');
    return;
  }

  // Get the target URL (relative path from backend, e.g. /chat/123 or /tasks)
  let targetUrl = event.notification.data?.url || '/';

  // Trích xuất phần đường dẫn tương đối (relative path + query)
  let relativeUrl = targetUrl;
  if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
    try {
      const parsed = new URL(targetUrl);
      relativeUrl = parsed.pathname + parsed.search;
    } catch (e) {
      console.error('[firebase-messaging-sw.js] Lỗi parse targetUrl:', e);
    }
  }

  // Ép trình duyệt mở trang chủ kèm tham số query ?redirect để tránh lỗi Vercel 404
  const redirectUrl = new URL('/?redirect=' + encodeURIComponent(relativeUrl), self.location.origin).href;

  console.log('[firebase-messaging-sw.js] Điều hướng gián tiếp qua trang chủ:', redirectUrl);

  event.waitUntil(
    // Match existing windows/clients of the application
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Nếu có tab ứng dụng đang mở, điều hướng tab đó về trang chủ với query ?redirect và focus
      if (windowClients.length > 0) {
        const client = windowClients[0];
        if ('navigate' in client) {
          client.focus();
          return client.navigate(redirectUrl);
        }
      }

      // 2. Nếu không có tab nào đang mở, mở một tab mới hoàn toàn với query ?redirect
      if (self.clients.openWindow) {
        return self.clients.openWindow(redirectUrl);
      }
    })
  );
});
