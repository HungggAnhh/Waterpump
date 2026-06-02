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
const activeCalls = new Map(); // tracks active calling sessions: userId <-> peerId (bidirectional)

// Helper functions to prevent String vs Number mismatch in activeCalls Map
const getCallSession = (userId) => userId ? activeCalls.get(String(userId)) : null;
const setCallSession = (userId, session) => userId && activeCalls.set(String(userId), session);
const hasCallSession = (userId) => userId ? activeCalls.has(String(userId)) : false;
const deleteCallSession = (userId) => userId && activeCalls.delete(String(userId));

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

      // Kiểm tra nếu user này đang có một phiên cuộc gọi đang đổ chuông chờ (chưa kết nối)
      const session = getCallSession(user.id);
      
      if (session && !session.startTime) {
        console.log(`📡 [RESILIENCE] Phát hiện user ${user.id} vừa online và có cuộc gọi đang chờ từ ${session.peerId}. Gửi incoming_call hối thúc...`);
        const caller = onlineUsers.get(session.peerId) || onlineUsers.get(Number(session.peerId)) || onlineUsers.get(String(session.peerId));
        const callerInfo = {
          id: session.peerId,
          name: caller ? caller.name : 'Đồng nghiệp',
          avatar: caller ? caller.avatar : null
        };
        
        socket.emit('incoming_call', {
          callerInfo,
          callType: session.callType,
          fromUserId: session.peerId,
          conversationId: session.conversationId
        });
      }
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
    const { conversation_id, sender_id, message, type = 'text', file_url = null, reply_to = null, forwarded = false } = data;

    if (!conversation_id || !sender_id || !message) {
      console.error('⚠️ send_message: thiếu tham số');
      return;
    }

    console.log(`💬 room_${conversation_id} | User ${sender_id}: ${message.substring(0, 50)}`);

    try {
      // Lưu vào Supabase PostgreSQL
      const insertRes = await query(
        'INSERT INTO messages (conversation_id, sender_id, message, type, file_url, reply_to, forwarded) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at',
        [parseInt(conversation_id), parseInt(sender_id), message, type, file_url, reply_to ? parseInt(reply_to) : null, !!forwarded]
      );
      const messageId = insertRes.rows[0].id;
      const createdAt = insertRes.rows[0].created_at;

      // Lấy thông tin sender
      const userRes = await query(
        'SELECT name, avatar FROM users WHERE id = $1 LIMIT 1',
        [parseInt(sender_id)]
      );
      const sender = userRes.rows[0] || {};

      // Lấy thông tin tin nhắn gốc được trích dẫn (Reply Quote) nếu có
      let replyToMessage = null;
      if (reply_to) {
        const parentRes = await query(
          `SELECT m.id, m.message, m.type, m.file_url, m.recalled, u.name AS sender_name
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id = $1 LIMIT 1`,
          [parseInt(reply_to)]
        );
        if (parentRes.rows.length > 0) {
          const parent = parentRes.rows[0];
          replyToMessage = {
            id: parseInt(parent.id),
            sender_name: parent.sender_name,
            message: parent.recalled ? "Tin nhắn đã được thu hồi" : parent.message,
            type: parent.type,
            file_url: parent.file_url,
            recalled: !!parent.recalled
          };
        }
      }

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
        raw_time:        createdAt,
        reply_to:        reply_to ? parseInt(reply_to) : null,
        reply_to_message: replyToMessage,
        forwarded:       !!forwarded,
        reactions:       [],
        sender_info: {
          id:     parseInt(sender_id),
          name:   sender.name,
          avatar: sender.avatar,
        }
      };

      // Kiểm tra tự động khôi phục cuộc trò chuyện Direct cho thành viên đã xóa
      const convCheck = await query(
        'SELECT type FROM conversations WHERE id = $1 LIMIT 1',
        [parseInt(conversation_id)]
      );
      const isDirect = convCheck.rows.length > 0 && convCheck.rows[0].type === 'direct';

      if (isDirect) {
        const currentParticipants = await query(
          'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
          [parseInt(conversation_id)]
        );
        
        if (currentParticipants.rows.length === 1) {
          // Find the exact other participant in this direct conversation
          const matchingRes = await query(
            `SELECT u.id 
             FROM users u
             WHERE u.id != $1 AND u.status = 'active'
               AND EXISTS (
                 SELECT 1 
                 FROM conversations c
                 WHERE c.id = $2 AND c.type = 'direct'
                   AND (
                     EXISTS (
                       SELECT 1 FROM conversation_users cu1 
                       JOIN conversation_users cu2 ON cu1.conversation_id = cu2.conversation_id
                       WHERE cu1.conversation_id = c.id AND cu1.user_id = $1 AND cu2.user_id = u.id
                     )
                     OR (
                       EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $1)
                       AND NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = u.id)
                       AND (
                         EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = u.id)
                         OR EXISTS (SELECT 1 FROM deleted_messages dm JOIN messages m ON dm.message_id = m.id WHERE m.conversation_id = c.id AND dm.user_id = u.id)
                       )
                     )
                     OR (
                       EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = u.id)
                       AND NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $1)
                       AND (
                         EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = $1)
                         OR EXISTS (SELECT 1 FROM deleted_messages dm JOIN messages m ON dm.message_id = m.id WHERE m.conversation_id = c.id AND dm.user_id = $1)
                       )
                     )
                     OR (
                       NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $1)
                       AND NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = u.id)
                       AND (
                         EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND (m.sender_id = $1 OR m.sender_id = u.id))
                         OR EXISTS (SELECT 1 FROM deleted_messages dm JOIN messages m ON dm.message_id = m.id WHERE m.conversation_id = c.id AND (dm.user_id = $1 OR dm.user_id = u.id))
                       )
                     )
                   )
               )
             LIMIT 1`,
            [parseInt(sender_id), parseInt(conversation_id)]
          );
          
          let missingUserId = matchingRes.rows.length > 0 ? matchingRes.rows[0].id : null;
          
          if (missingUserId) {
            console.log(`[RESTORE] Recreating missing conversation_users row for user ${missingUserId} in conv ${conversation_id}`);
            await query(
              'INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [parseInt(conversation_id), parseInt(missingUserId)]
            );
            
            io.to(`user_${missingUserId}`).emit('conversation_restored', {
              conversation_id: String(conversation_id)
            });
          }
        }
      }

      // Phát tới tất cả thành viên phòng chat qua phòng cá nhân
      const memberRes = await query(
        'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
        [parseInt(conversation_id)]
      );

      memberRes.rows.forEach(({ user_id }) => {
        io.to(`user_${user_id}`).emit('receive_message', messageObject);
        console.log('[SERVER] Sent receive_message to room:', `user_${user_id}`);
        console.log('[SERVER] roomId (conversation_id):', conversation_id);
        console.log('[SERVER] message.id:', messageId);
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

  // ─── Signaling Voice & Video Call Helpers ───────────────────────
  
  // Helper lưu lịch sử cuộc gọi trực tiếp vào cơ sở dữ liệu Supabase
  const saveCallLog = async (conversationId, senderId, messageText) => {
    if (!conversationId) return;
    try {
      const insertRes = await query(
        'INSERT INTO messages (conversation_id, sender_id, message, type) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
        [parseInt(conversationId), parseInt(senderId), messageText, 'call']
      );
      const messageId = insertRes.rows[0].id;
      const createdAt = insertRes.rows[0].created_at;

      // Lấy thông tin sender
      const userRes = await query(
        'SELECT name, avatar FROM users WHERE id = $1 LIMIT 1',
        [parseInt(senderId)]
      );
      const sender = userRes.rows[0] || {};

      const messageObject = {
        id:              parseInt(messageId),
        conversation_id: parseInt(conversationId),
        sender_id:       parseInt(senderId),
        sender_name:     sender.name,
        sender_avatar:   sender.avatar,
        message:         messageText,
        type:            'call',
        created_at:      createdAt,
        raw_time:        createdAt,
        reactions:       [],
        sender_info: {
          id:     parseInt(senderId),
          name:   sender.name,
          avatar: sender.avatar,
        }
      };

      // Phát tới tất cả thành viên phòng chat qua phòng cá nhân của họ
      const memberRes = await query(
        'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
        [parseInt(conversationId)]
      );

      memberRes.rows.forEach(({ user_id }) => {
        io.to(`user_${user_id}`).emit('receive_message', messageObject);
      });
      console.log(`📝 [SERVER:CALL_LOG] Lưu lịch sử cuộc gọi thành công: "${messageText}"`);
    } catch (err) {
      console.error('❌ [SERVER:CALL_LOG] Lỗi lưu cuộc gọi vào CSDL:', err.message);
    }
  };

  const formatCallDuration = (secs) => {
    const mins = Math.floor(secs / 60);
    const remain = secs % 60;
    if (mins > 0) {
      return `${mins} phút ${remain} giây`;
    }
    return `${remain} giây`;
  };

  // ─── Signaling Voice & Video Call Events ───────────────────────
  
  // 1. Caller bắt đầu cuộc gọi tới Receiver
  socket.on('call_user', ({ toUserId, callerInfo, callType, conversationId }) => {
    console.log(`📞 [CALL_USER] ${socket.userId} (${callerInfo?.name}) đang gọi tới ${toUserId} (Kiểu: ${callType}, Room: ${conversationId})`);
    
    // Ghi nhận cuộc gọi vào map activeCalls với các thông tin phiên
    setCallSession(socket.userId, {
      peerId: toUserId,
      conversationId: conversationId || null,
      callType,
      startTime: null
    });
    setCallSession(toUserId, {
      peerId: socket.userId,
      conversationId: conversationId || null,
      callType,
      startTime: null
    });

    // Luôn gửi cuộc gọi Push Notification FCM độ ưu tiên cao nhất để đánh thức thiết bị (kể cả khi tắt màn hình)
    (async () => {
      try {
        const tokensRes = await query(
          'SELECT fcm_token FROM user_push_tokens WHERE user_id = $1',
          [parseInt(toUserId)]
        );

        if (tokensRes.rows.length > 0) {
          const { sendPWAPushNotification } = require('./config/firebaseAdmin');
          const title = `Cuộc gọi đến từ ${callerInfo?.name || 'Đồng nghiệp'}`;
          const body = `Đang gọi ${callType === 'video' ? 'Video' : 'Thoại'} cho bạn...`;
          const dataUrl = `/chat/${conversationId}`;

          console.log(`📡 [CALL_PUSH] Phát gửi cuộc gọi push tới ${tokensRes.rows.length} thiết bị nhận.`);
          for (const row of tokensRes.rows) {
            await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'call');
          }
        }
      } catch (pushErr) {
        console.error('⚠️ [socket] Lỗi gửi push cuộc gọi:', pushErr.message);
      }
    })();

    // Kiểm tra xem receiver có online không (Robust check cho cả String và Number keys)
    const targetUser = onlineUsers.get(toUserId) || onlineUsers.get(Number(toUserId)) || onlineUsers.get(String(toUserId));
    if (!targetUser) {
      console.log(`⚠️ [CALL_USER] User ${toUserId} ngoại tuyến. Đã gửi thông báo đẩy hối thúc.`);
      socket.emit('call_ringing_offline', { toUserId });
      return;
    }

    // Gửi thông báo cuộc gọi đến receiver trực tiếp qua socket nếu đang online
    io.to(`user_${toUserId}`).emit('incoming_call', {
      callerInfo,
      callType,
      fromUserId: socket.userId,
      conversationId
    });
  });

  // 2. Receiver chấp nhận cuộc gọi
  socket.on('accept_call', ({ toUserId }) => {
    console.log(`📞 [ACCEPT_CALL] User ${socket.userId} chấp nhận cuộc gọi từ ${toUserId}`);
    
    // Cập nhật thời điểm bắt đầu cuộc gọi để tính toán Duration khi kết thúc
    const callerSession = getCallSession(toUserId);
    const receiverSession = getCallSession(socket.userId);
    const now = Date.now();
    if (callerSession) callerSession.startTime = now;
    if (receiverSession) receiverSession.startTime = now;

    io.to(`user_${toUserId}`).emit('call_accepted');
  });

  // 3. Receiver từ chối cuộc gọi
  socket.on('reject_call', ({ toUserId }) => {
    console.log(`📞 [REJECT_CALL] User ${socket.userId} từ chối cuộc gọi từ ${toUserId}`);
    
    // Ghi nhận cuộc gọi nhỡ khi từ chối
    const session = getCallSession(socket.userId);
    if (session) {
      const msgText = session.callType === 'video' ? '🎥 Cuộc gọi video nhỡ' : '📞 Cuộc gọi thoại nhỡ';
      saveCallLog(session.conversationId, toUserId, msgText); // Người gọi (toUserId) là sender log nhỡ
      
      deleteCallSession(socket.userId);
      deleteCallSession(toUserId);
    }
    
    io.to(`user_${toUserId}`).emit('call_rejected');
  });

  // 4. Trao đổi WebRTC Offer
  socket.on('offer', ({ toUserId, offer }) => {
    io.to(`user_${toUserId}`).emit('offer', { offer });
  });

  // 5. Trao đổi WebRTC Answer
  socket.on('answer', ({ toUserId, answer }) => {
    io.to(`user_${toUserId}`).emit('answer', { answer });
  });

  // 6. Trao đổi WebRTC ICE Candidates
  socket.on('ice_candidate', ({ toUserId, candidate }) => {
    io.to(`user_${toUserId}`).emit('ice_candidate', { candidate });
  });

  // 7. Kết thúc cuộc gọi
  socket.on('end_call', ({ toUserId }) => {
    console.log(`📞 [END_CALL] User ${socket.userId} kết thúc cuộc gọi với ${toUserId}`);
    
    const session = getCallSession(socket.userId);
    if (session) {
      if (session.startTime) {
        // Cuộc gọi thành công, tính toán thời lượng cuộc gọi
        const durationSecs = Math.floor((Date.now() - session.startTime) / 1000);
        const durText = formatCallDuration(durationSecs);
        const msgText = session.callType === 'video' 
          ? `🎥 Cuộc gọi video hoàn tất (${durText})` 
          : `📞 Cuộc gọi thoại hoàn tất (${durText})`;
        
        saveCallLog(session.conversationId, socket.userId, msgText);
      } else {
        // Cuộc gọi nhỡ (người gọi chủ động tắt khi chưa liên lạc được)
        const msgText = session.callType === 'video' ? '🎥 Cuộc gọi video nhỡ' : '📞 Cuộc gọi thoại nhỡ';
        saveCallLog(session.conversationId, socket.userId, msgText);
      }

      deleteCallSession(socket.userId);
      if (toUserId) {
        deleteCallSession(toUserId);
        io.to(`user_${toUserId}`).emit('call_ended');
      }
    } else {
      console.warn(`⚠️ [END_CALL] Không tìm thấy phiên hoạt động cho User ${socket.userId} trong activeCalls. Kích hoạt cúp máy dự phòng cho đối phương.`);
      // Ngay cả khi không tìm thấy phiên trong map, vẫn gửi call_ended dự phòng cho đối phương để giao diện cúp máy đồng bộ
      if (toUserId) {
        io.to(`user_${toUserId}`).emit('call_ended');
      }
    }
  });

  // 8. Ngắt kết nối
  socket.on('disconnect', () => {
    if (socket.userId) {
      // Resilience Handler: Nếu đang trong cuộc gọi, tự động lưu log và treo máy đầu bên kia
      if (hasCallSession(socket.userId)) {
        const session = getCallSession(socket.userId);
        const peerId = session.peerId;
        console.log(`🚨 [RESILIENCE] User ${socket.userId} ngắt kết nối đột ngột khi đang gọi. Tự động kết thúc cuộc gọi với User ${peerId}`);
        
        if (session.startTime) {
          const durationSecs = Math.floor((Date.now() - session.startTime) / 1000);
          const durText = formatCallDuration(durationSecs);
          const msgText = session.callType === 'video' 
            ? `🎥 Cuộc gọi video hoàn tất (${durText})` 
            : `📞 Cuộc gọi thoại hoàn tất (${durText})`;
          saveCallLog(session.conversationId, socket.userId, msgText);
        } else {
          const msgText = session.callType === 'video' ? '🎥 Cuộc gọi video nhỡ' : '📞 Cuộc gọi thoại nhỡ';
          saveCallLog(session.conversationId, socket.userId, msgText);
        }

        io.to(`user_${peerId}`).emit('call_ended');
        deleteCallSession(socket.userId);
        deleteCallSession(peerId);
      }

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

// ─── Recurring Task Reminders Scheduler (Runs every 1 minute) ──────
const startReminderScheduler = () => {
  console.log("⏰ [scheduler] Bắt đầu khởi chạy tiến trình nhắc việc tự động...");
  setInterval(async () => {
    try {
      // Tìm các công việc:
      // 1. Chưa hoàn thành (completed = FALSE)
      // 2. Không bị xóa (is_deleted = FALSE)
      // 3. Có độ ưu tiên cao (priority = 'high')
      // 4. Có khoảng cách nhắc nhở (reminder_interval IS NOT NULL)
      // 5. Được gán cho một người (assigned_to IS NOT NULL)
      const tasksRes = await query(`
        SELECT t.*, u.name AS assignee_name
        FROM tasks t
        JOIN users u ON t.assigned_to = u.id
        WHERE t.completed = FALSE 
          AND t.is_deleted = FALSE 
          AND t.priority = 'high' 
          AND t.reminder_interval IS NOT NULL 
          AND t.assigned_to IS NOT NULL
      `);

      if (tasksRes.rows.length === 0) return;

      const now = new Date();
      const { sendPWAPushNotification } = require('./config/firebaseAdmin');

      for (const task of tasksRes.rows) {
        // Mốc thời gian gần đây nhất gửi reminder. Nếu chưa gửi bao giờ thì dùng created_at.
        const baseTime = task.last_reminded_at ? new Date(task.last_reminded_at) : new Date(task.created_at);
        const diffMs = now.getTime() - baseTime.getTime();
        const diffMinutes = diffMs / (1000 * 60);

        let isDue = false;
        let reminderText = '';

        if (task.reminder_interval === 'hourly') {
          // Gửi mỗi giờ (60 phút)
          if (diffMinutes >= 60) {
            isDue = true;
            reminderText = 'mỗi giờ';
          }
        } else if (task.reminder_interval === 'daily') {
          // Gửi mỗi ngày (24 giờ = 1440 phút)
          if (diffMinutes >= 1440) {
            isDue = true;
            reminderText = 'mỗi ngày';
          }
        }

        if (isDue) {
          console.log(`⏰ [scheduler] Phát hiện công việc ID ${task.id} đến lịch hối thúc [${task.reminder_interval}] cho User ${task.assigned_to}`);
          
          // Lấy FCM tokens của assignee
          const tokensRes = await query(
            'SELECT fcm_token FROM user_push_tokens WHERE user_id = $1',
            [task.assigned_to]
          );

          if (tokensRes.rows.length > 0) {
            const title = `🚨 [HỐI THÚC NHẮC HẸN]`;
            const body = `Công việc gấp chưa hoàn thành! Sếp nhắc bạn thực hiện [nhắc ${reminderText}]: "${task.title}"`;
            const dataUrl = `/workspace/${task.workspace_id}`;
            for (const row of tokensRes.rows) {
              await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
            }
          }

          // Cập nhật last_reminded_at trong CSDL để tránh gửi lặp
          await query(
            'UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1',
            [task.id]
          );
        }
      }
    } catch (err) {
      console.error('❌ [scheduler] Lỗi hệ thống trong tiến trình nhắc việc tự động:', err.message);
    }
  }, 60000); // 60000 ms = 1 phút
};

startReminderScheduler();

// ─── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server đang chạy trên cổng ${PORT}`);
  console.log(`📡 REST API:  http://localhost:${PORT}/api/`);
  console.log(`🔌 Socket.IO: ws://localhost:${PORT}`);
  console.log(`💾 Database:  Supabase PostgreSQL\n`);
});
