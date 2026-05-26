// backend/socket/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());

// API kiểm tra trạng thái hoạt động của server
app.get('/status', (req, res) => {
  res.json({ status: "running", service: "Socket.IO Production Server", port: 3000 });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Cấu hình kết nối MySQL Pool trực tiếp trên XAMPP
const dbPool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'App-Assign tasks',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Lưu trữ danh sách người dùng đang trực tuyến (Map userId -> userDetail)
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Thiết bị mới kết nối: ${socket.id}`);

  // 1. Đăng ký trạng thái ONLINE toàn cục khi đăng nhập thành công
  socket.on('join', (user) => {
    if (user && user.id) {
      socket.userId = user.id;
      onlineUsers.set(user.id, {
        socketId: socket.id,
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        role: user.role
      });
      
      // Cho socket gia nhập phòng cá nhân của user đó (Bắt buộc để nhận tin nhắn realtime mọi lúc mọi nơi)
      const personalRoom = `user_${user.id}`;
      socket.join(personalRoom);
      console.log(`🟢 ${user.name} đang ONLINE và đã gia nhập phòng cá nhân: ${personalRoom}`);
      
      // Phát danh sách người dùng online tới toàn bộ hệ thống
      io.emit('update_online_users', Array.from(onlineUsers.values()));
    }
  });

  // 2. Tham gia phòng chat cụ thể (Join Room)
  socket.on('join_room', (data) => {
    const { conversation_id, user_id } = data;
    if (conversation_id) {
      const room = `room_${conversation_id}`;
      socket.join(room);
      console.log(`👤 User ID: ${user_id} đã tham gia phòng: ${room}`);
    }
  });

  // 3. Rời khỏi phòng chat cụ thể (Leave Room)
  socket.on('leave_room', (data) => {
    const { conversation_id, user_id } = data;
    if (conversation_id) {
      const room = `room_${conversation_id}`;
      socket.leave(room);
      console.log(`👤 User ID: ${user_id} đã rời phòng: ${room}`);
    }
  });

  // 4. Nhận tin nhắn từ một client, ghi trực tiếp vào MySQL và emit cho các thành viên trong room
  socket.on('send_message', async (data) => {
    const { conversation_id, sender_id, message, type = 'text', file_url = null } = data;
    
    if (!conversation_id || !sender_id || !message) {
      console.error("⚠️ send_message lỗi: Thiếu tham số bắt buộc.");
      return;
    }

    const room = `room_${conversation_id}`;
    console.log(`💬 Nhận tin nhắn trong phòng [${room}] từ User ID: ${sender_id}: ${message}`);

    try {
      // Ghi trực tiếp tin nhắn vào MySQL CSDL
      const [insertResult] = await dbPool.query(
        "INSERT INTO messages (conversation_id, sender_id, message, type, file_url) VALUES (?, ?, ?, ?, ?)",
        [conversation_id, sender_id, message, type, file_url]
      );
      
      const messageId = insertResult.insertId;

      // Lấy thông tin chi tiết của sender từ bảng users
      const [userRows] = await dbPool.query(
        "SELECT name, avatar FROM users WHERE id = ? LIMIT 1",
        [sender_id]
      );
      
      if (userRows.length > 0) {
        const sender = userRows[0];
        
        const now = new Date();
        const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const messageObject = {
          id: messageId,
          conversation_id: parseInt(conversation_id),
          sender_id: parseInt(sender_id),
          sender_name: sender.name,
          sender_avatar: sender.avatar,
          message: message,
          type: type,
          file_url: file_url,
          created_at: formattedTime,
          raw_time: now.toISOString()
        };

        // Lấy danh sách tất cả thành viên trong cuộc hội thoại này từ CSDL để phát tin nhắn
        const [memberRows] = await dbPool.query(
          "SELECT user_id FROM conversation_users WHERE conversation_id = ?",
          [conversation_id]
        );

        console.log(`👥 Thành viên cuộc hội thoại [${conversation_id}]:`, memberRows.map(m => m.user_id));

        // Phát tin nhắn tới từng thành viên (kể cả người gửi để cập nhật UI đồng bộ) qua phòng cá nhân của họ
        memberRows.forEach(member => {
          const memberRoom = `user_${member.user_id}`;
          io.to(memberRoom).emit('receive_message', messageObject);
          console.log(`🚀 Đã chuyển tiếp tin nhắn tới phòng cá nhân: ${memberRoom}`);
        });
      }

    } catch (err) {
      console.error("❌ Lỗi CSDL khi lưu tin nhắn qua Socket:", err);
      socket.emit('error_message', { message: "Không thể gửi tin nhắn. Lỗi hệ thống." });
    }
  });

  // 5. Chỉ báo đang gõ chữ (Typing Indicator) phân lập theo phòng chat
  socket.on('typing', (data) => {
    const { conversation_id, user_id, user_name } = data;
    if (conversation_id) {
      const room = `room_${conversation_id}`;
      // Gửi tín hiệu đến tất cả mọi người trong phòng ngoại trừ người gõ
      socket.to(room).emit('user_typing', {
        conversation_id: conversation_id,
        userId: user_id,
        userName: user_name,
        isTyping: true
      });
    }
  });

  socket.on('stop_typing', (data) => {
    const { conversation_id, user_id } = data;
    if (conversation_id) {
      const room = `room_${conversation_id}`;
      socket.to(room).emit('user_typing', {
        conversation_id: conversation_id,
        userId: user_id,
        isTyping: false
      });
    }
  });

  // 6. Ngắt kết nối (Disconnect)
  socket.on('disconnect', () => {
    if (socket.userId) {
      const user = onlineUsers.get(socket.userId);
      if (user) {
        console.log(`🔴 ${user.name} đã OFFLINE.`);
        onlineUsers.delete(socket.userId);
        
        // Phát lại danh sách online mới
        io.emit('update_online_users', Array.from(onlineUsers.values()));
      }
    }
    console.log(`🔌 Thiết bị đã ngắt kết nối: ${socket.id}`);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Máy chủ Socket.IO Realtime đang hoạt động trên cổng ${PORT}`);
});
