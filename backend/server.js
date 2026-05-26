// backend/server.js
// ================================================================
// Server Express + Socket.IO duy nhất — kết nối thẳng Supabase
// Thay thế hoàn toàn XAMPP/PHP
// PORT 3000 (Socket.IO) + /api/* (REST API)
// ================================================================

// Cấu hình DNS ưu tiên IPv4 để tăng tính ổn định kết nối với cơ sở dữ liệu trên môi trường IPv4-only
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');

const { query } = require('./config/supabase');

// ─── Routes ──────────────────────────────────────────────────────
const authRoutes          = require('./routes/auth');
const usersRoutes         = require('./routes/users');
const tasksRoutes         = require('./routes/tasks');
const conversationsRoutes = require('./routes/conversations');
const messagesRoutes      = require('./routes/messages');
const uploadRoutes        = require('./routes/upload');

// ─── Express App ─────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files (fallback khi chưa dùng Supabase Storage)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── API Routes ───────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         usersRoutes);
app.use('/api/tasks',         tasksRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/messages',      messagesRoutes);
app.use('/api/upload',        uploadRoutes);

// Health check
app.get('/status', (req, res) => {
  res.json({ status: 'running', service: 'Express + Socket.IO + Supabase', port: process.env.PORT || 3000 });
});

// ─── HTTP + Socket.IO Server ──────────────────────────────────────
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── Online Users Map ─────────────────────────────────────────────
const onlineUsers = new Map(); // userId → userDetail

// ─── Socket.IO Events ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Kết nối mới: ${socket.id}`);

  // 1. Đăng ký online
  socket.on('join', (user) => {
    if (user?.id) {
      socket.userId = user.id;
      onlineUsers.set(user.id, { socketId: socket.id, id: user.id, name: user.name, avatar: user.avatar, role: user.role });

      socket.join(`user_${user.id}`);
      console.log(`🟢 ${user.name} ONLINE → phòng user_${user.id}`);

      io.emit('update_online_users', Array.from(onlineUsers.values()));
    }
  });

  // 2. Vào phòng chat
  socket.on('join_room', ({ conversation_id, user_id }) => {
    if (conversation_id) {
      socket.join(`room_${conversation_id}`);
      console.log(`👤 User ${user_id} → room_${conversation_id}`);
    }
  });

  // 3. Rời phòng chat
  socket.on('leave_room', ({ conversation_id, user_id }) => {
    if (conversation_id) {
      socket.leave(`room_${conversation_id}`);
      console.log(`👤 User ${user_id} ← room_${conversation_id}`);
    }
  });

  // 4. Gửi & lưu tin nhắn vào Supabase
  socket.on('send_message', async (data) => {
    const { conversation_id, sender_id, message, type = 'text', file_url = null } = data;

    if (!conversation_id || !sender_id || !message) {
      console.error('⚠️ send_message: thiếu tham số');
      return;
    }

    console.log(`💬 room_${conversation_id} | User ${sender_id}: ${message.substring(0, 50)}`);

    try {
      // Lưu vào Supabase PostgreSQL
      const insertRes = await query(
        'INSERT INTO messages (conversation_id, sender_id, message, type, file_url) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [parseInt(conversation_id), parseInt(sender_id), message, type, file_url]
      );
      const messageId = insertRes.rows[0].id;

      // Lấy thông tin sender
      const userRes = await query(
        'SELECT name, avatar FROM users WHERE id = $1 LIMIT 1',
        [parseInt(sender_id)]
      );
      const sender = userRes.rows[0] || {};

      const now = new Date();
      const messageObject = {
        id:              parseInt(messageId),
        conversation_id: parseInt(conversation_id),
        sender_id:       parseInt(sender_id),
        sender_name:     sender.name,
        sender_avatar:   sender.avatar,
        message,
        type,
        file_url,
        created_at:      now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        raw_time:        now.toISOString(),
      };

      // Phát tới tất cả thành viên phòng chat qua phòng cá nhân
      const memberRes = await query(
        'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
        [parseInt(conversation_id)]
      );

      memberRes.rows.forEach(({ user_id }) => {
        io.to(`user_${user_id}`).emit('receive_message', messageObject);
        console.log(`🚀 → user_${user_id}`);
      });

    } catch (err) {
      console.error('❌ Lỗi lưu tin nhắn Supabase:', err.message);
      socket.emit('error_message', { message: 'Không thể gửi tin nhắn. Lỗi hệ thống.' });
    }
  });

  // 5. Typing indicator
  socket.on('typing', ({ conversation_id, user_id, user_name }) => {
    if (conversation_id) {
      socket.to(`room_${conversation_id}`).emit('user_typing', {
        conversation_id, userId: user_id, userName: user_name, isTyping: true
      });
    }
  });

  socket.on('stop_typing', ({ conversation_id, user_id }) => {
    if (conversation_id) {
      socket.to(`room_${conversation_id}`).emit('user_typing', {
        conversation_id, userId: user_id, isTyping: false
      });
    }
  });

  // 6. Ngắt kết nối
  socket.on('disconnect', () => {
    if (socket.userId) {
      const user = onlineUsers.get(socket.userId);
      if (user) {
        console.log(`🔴 ${user.name} OFFLINE`);
        onlineUsers.delete(socket.userId);
        io.emit('update_online_users', Array.from(onlineUsers.values()));
      }
    }
    console.log(`🔌 Ngắt kết nối: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server đang chạy trên cổng ${PORT}`);
  console.log(`📡 REST API:  http://localhost:${PORT}/api/`);
  console.log(`🔌 Socket.IO: ws://localhost:${PORT}`);
  console.log(`💾 Database:  Supabase PostgreSQL\n`);
});
