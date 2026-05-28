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
// Khởi tạo Firebase Admin SDK ngay khi khởi động Server
require('./config/firebaseAdmin');

// ─── Routes ──────────────────────────────────────────────────────
const authRoutes          = require('./routes/auth');
const usersRoutes         = require('./routes/users');
const conversationsRoutes = require('./routes/conversations');
const messagesRoutes      = require('./routes/messages');
const uploadRoutes        = require('./routes/upload');
const tasksRoutes         = require('./routes/tasks');

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
app.use('/api/conversations', conversationsRoutes);
app.use('/api/messages',      messagesRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/tasks',         tasksRoutes);

// Health check
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    service: 'Express + Socket.IO + Supabase',
    port: process.env.PORT || 3000,
    env: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
      SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || '(not set, default: media)',
      DATABASE_URL: !!process.env.DATABASE_URL,
    }
  });
});

// ─── HTTP + Socket.IO Server ──────────────────────────────────────
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Chia sẻ instance socket.io cho các Express routes
app.set('io', io);

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
        'INSERT INTO messages (conversation_id, sender_id, message, type, file_url) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
        [parseInt(conversation_id), parseInt(sender_id), message, type, file_url]
      );
      const messageId = insertRes.rows[0].id;
      const createdAt = insertRes.rows[0].created_at;

      // Lấy thông tin sender
      const userRes = await query(
        'SELECT name, avatar FROM users WHERE id = $1 LIMIT 1',
        [parseInt(sender_id)]
      );
      const sender = userRes.rows[0] || {};

      const messageObject = {
        id:              parseInt(messageId),
        conversation_id: parseInt(conversation_id),
        sender_id:       parseInt(sender_id),
        sender_name:     sender.name,
        sender_avatar:   sender.avatar,
        message,
        type,
        file_url,
        created_at:      createdAt, // Server database timestamp (ISO Timestamptz)
        sender_info: {
          id:     parseInt(sender_id),
          name:   sender.name,
          avatar: sender.avatar,
        }
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

      // Gửi Push Notification cho các thành viên khác trong phòng chat (chạy bất đồng bộ)
      (async () => {
        try {
          const senderName = sender.name || 'Người dùng';
          // Lọc danh sách người nhận (loại trừ chính người gửi)
          const otherMembers = memberRes.rows.filter(m => m.user_id !== parseInt(sender_id));
          
          if (otherMembers.length > 0) {
            const memberIds = otherMembers.map(m => m.user_id);
            // Lấy các FCM tokens của các thành viên này
            const tokensRes = await query(
              'SELECT user_id, fcm_token FROM user_push_tokens WHERE user_id = ANY($1)',
              [memberIds]
            );

            if (tokensRes.rows.length > 0) {
              const { sendPWAPushNotification } = require('./config/firebaseAdmin');
              
              const title = `💬 Tin nhắn mới từ ${senderName}`;
              let body = message;
              if (type === 'image') body = '📷 [Hình ảnh]';
              else if (type === 'file') body = '📁 [Tệp tin]';
              
              if (body.length > 100) {
                body = body.substring(0, 100) + '...';
              }

              const dataUrl = `/chat/${conversation_id}`; // Đường dẫn trực tiếp vào phòng chat trên PWA

              console.log(`📡 Phát hiện ${tokensRes.rows.length} thiết bị nhận thông báo tin nhắn mới từ User ID ${sender_id}`);
              for (const row of tokensRes.rows) {
                await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'chat');
              }
            }
          }
        } catch (pushErr) {
          console.error('⚠️ [socket] Lỗi gửi push notification cho tin nhắn:', pushErr.message);
        }
      })();

    } catch (err) {
      console.error('❌ Lỗi lưu tin nhắn Supabase:', err.message);
      socket.emit('error_message', { message: 'Không thể gửi tin nhắn. Lỗi hệ thống.' });
    }
  });

  // 4.5 Nhận sự kiện đã xem tin nhắn (seen_message) để cập nhật DB và đồng bộ đa thiết bị
  socket.on('seen_message', async ({ conversation_id, user_id, message_id }) => {
    if (!conversation_id || !user_id || !message_id) {
      return;
    }

    console.log(`[SERVER:SEEN_MESSAGE_RECEIVED] User ${user_id} reported viewing msg ${message_id} in conversation ${conversation_id}`);

    try {
      // Step 5: Nghiêm ngặt kiểm tra tin nhắn tồn tại và không phải do chính người xem gửi
      const msgCheck = await query(
        'SELECT sender_id FROM messages WHERE id = $1 AND conversation_id = $2 LIMIT 1',
        [parseInt(message_id), parseInt(conversation_id)]
      );
      
      if (msgCheck.rows.length === 0) {
        console.log(`[SERVER:SEEN_MESSAGE_VALIDATION] Message ${message_id} does not exist in conversation ${conversation_id}`);
        return;
      }
      
      const senderId = msgCheck.rows[0].sender_id;
      if (senderId === parseInt(user_id)) {
        console.log(`[SERVER:SEEN_MESSAGE_VALIDATION] User ${user_id} cannot seen their own message ${message_id}`);
        return;
      }

      // Cập nhật database: last_seen_message_id và last_seen_at
      await query(
        `UPDATE conversation_users
         SET last_seen_message_id = $1, last_seen_at = NOW()
         WHERE conversation_id = $2 AND user_id = $3`,
        [parseInt(message_id), parseInt(conversation_id), parseInt(user_id)]
      );

      console.log(`[SERVER:LAST_SEEN_UPDATED] Database updated for User ${user_id} in conversation ${conversation_id} to message ${message_id}`);

      // Đồng bộ hóa đa thiết bị cho tất cả socket của cùng người dùng này
      console.log(`[SERVER:MULTI_DEVICE_SYNC] Broadcasting conversation_seen to user_${user_id}`);
      io.to(`user_${user_id}`).emit('conversation_seen', {
        conversation_id: parseInt(conversation_id),
        message_id: parseInt(message_id)
      });

    } catch (err) {
      console.error('❌ Lỗi xử lý seen_message socket:', err.message);
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
