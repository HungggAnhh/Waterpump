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

// Background message handler
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Đã nhận tin nhắn chạy ngầm: ', payload);

  const notificationTitle = payload.notification?.title || 'Thông báo mới';
  
  // Extract custom notification data
  const data = payload.data || {};
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    requireInteraction: true, // Keep notification active on screen
    vibrate: [200, 100, 200],
    data: {
      url: data.click_action || data.url || '/',
      ...data
    },
    // Set a tag to group notifications and avoid cluttering
    tag: data.tag || 'general-notification',
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle click action on Notification to redirect or open window
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Click thông báo:', event);
  
  // Close the notification bubble
  event.notification.close();

  // Get the target URL
  let targetUrl = event.notification.data?.url || '/';

  // Chuyển đổi đường dẫn tương đối thành URL tuyệt đối chuẩn xác dựa trên origin hiện tại (tránh lỗi Vercel 404 và lỗi clients.openWindow)
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = new URL(targetUrl, self.location.origin).href;
  }

  console.log('[firebase-messaging-sw.js] Điều hướng tới URL tuyệt đối:', targetUrl);

  event.waitUntil(
    // Match existing windows/clients of the application
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Chuẩn hóa URL trước khi so sánh (loại bỏ dấu gạch chéo cuối nếu có)
      const cleanTargetUrl = targetUrl.replace(/\/$/, '');

      // 1. Nếu có tab nào đang mở đúng trang này rồi, thì focus trực tiếp vào tab đó
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        const cleanClientUrl = client.url.replace(/\/$/, '');
        if (cleanClientUrl === cleanTargetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      
      // 2. Nếu có tab ứng dụng đang mở (nhưng ở trang khác), điều hướng tab đó đến URL mong muốn và focus
      if (windowClients.length > 0) {
        const client = windowClients[0];
        if ('navigate' in client) {
          client.focus();
          return client.navigate(targetUrl);
        }
      }

      // 3. Nếu không có tab nào đang mở, mở một tab mới hoàn toàn
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
