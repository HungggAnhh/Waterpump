// frontend/test-realtime.js
const io = require('socket.io-client');

const SOCKET_URL = 'http://localhost:3000';
const CONVERSATION_ID = 7; // Nhóm haha
const USER_A_ID = 1; // User A (Admin)
const USER_B_ID = 4; // User B (Phúc)

console.log('🔌 [TEST] Khởi tạo các socket kết nối...');

// 1. Tạo kết nối cho User A
const socketA = io(SOCKET_URL, { forceNew: true, transports: ['websocket'] });
// 2. Tạo kết nối cho User B
const socketB = io(SOCKET_URL, { forceNew: true, transports: ['websocket'] });

let socketAConnected = false;
let socketBConnected = false;

function checkConnectionsAndRun() {
  if (socketAConnected && socketBConnected) {
    console.log('🟢 [TEST] Cả hai User A và User B đã kết nối và tham gia hệ thống!');
    
    // Giả lập User A đang xem phòng chat
    console.log(`🔌 [TEST] User A join_room: room_${CONVERSATION_ID}`);
    socketA.emit('join_room', { conversation_id: CONVERSATION_ID, user_id: USER_A_ID });

    // Giả lập User B gửi tin nhắn qua socket sau 1 giây
    setTimeout(() => {
      console.log(`📤 [TEST] User B (ID: ${USER_B_ID}) đang emit 'send_message' qua socket...`);
      socketB.emit('send_message', {
        conversation_id: CONVERSATION_ID,
        sender_id: USER_B_ID,
        message: `Realtime Socket-to-Socket test message at ${new Date().toLocaleTimeString()}`,
        type: 'text'
      });
    }, 1000);
  }
}

// Thiết lập User A
socketA.on('connect', () => {
  console.log('🟢 [TEST] Socket User A connected. socket.id:', socketA.id);
  socketA.emit('join', { id: USER_A_ID, name: 'Admin User A', role: 'admin' });
  socketAConnected = true;
  checkConnectionsAndRun();
});

socketA.on('receive_message', (msg) => {
  console.log('📥 [TEST:RECEIVE] >>> USER A NHẬN ĐƯỢC TIN NHẮN REALTIME THÀNH CÔNG! <<<');
  console.log('📥 [TEST:RECEIVE] Content:', msg.message);
  console.log('📥 [TEST:RECEIVE] Sender:', msg.sender_name);
  
  // Gửi sự kiện đã xem
  console.log(`📤 [TEST] User A emit 'seen_message' cho message ID: ${msg.id}`);
  socketA.emit('seen_message', {
    conversation_id: CONVERSATION_ID,
    message_id: msg.id,
    user_id: USER_A_ID
  });
});

socketA.on('conversation_seen', (data) => {
  console.log('📥 [TEST:RECEIVE_SEEN] User A nhận xác nhận conversation_seen:', data);
  cleanup();
  process.exit(0);
});

// Thiết lập User B
socketB.on('connect', () => {
  console.log('🟢 [TEST] Socket User B connected. socket.id:', socketB.id);
  socketB.emit('join', { id: USER_B_ID, name: 'Phúc User B', role: 'user' });
  socketBConnected = true;
  checkConnectionsAndRun();
});

function cleanup() {
  console.log('🧹 [TEST] Dọn dẹp kết nối.');
  socketA.disconnect();
  socketB.disconnect();
}

// Timeout đề phòng treo script
setTimeout(() => {
  console.log('⚠️ [TEST] Hết thời gian chờ (Timeout 10s).');
  cleanup();
  process.exit(1);
}, 10000);
