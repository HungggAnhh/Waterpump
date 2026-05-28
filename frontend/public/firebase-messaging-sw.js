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
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    // Match existing windows/clients of the application
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open at the target URL, focus it
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      
      // If we have any open windows, we can navigate one of them, otherwise open a new window
      if (windowClients.length > 0) {
        const client = windowClients[0];
        if ('navigate' in client) {
          client.focus();
          return client.navigate(targetUrl);
        }
      }

      // If no clients, open a new tab/window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
