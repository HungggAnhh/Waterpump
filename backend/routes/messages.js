// backend/routes/messages.js
const express = require('express');
const { query } = require('../config/supabase');
const router = express.Router();

// Helper: Broadcast realtime socket event to all members of a conversation via their personal rooms
const broadcastToConversation = async (io, conversationId, eventName, payload) => {
  if (!io) return;
  try {
    const memberRes = await query(
      'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
      [parseInt(conversationId)]
    );
    memberRes.rows.forEach(({ user_id }) => {
      io.to(`user_${user_id}`).emit(eventName, payload);
    });
  } catch (err) {
    console.error(`❌ [routes/messages] Lỗi khi broadcast ${eventName}:`, err.message);
  }
};

// GET /api/messages?conversation_id=X&user_id=Y&page=1&limit=30
router.get('/', async (req, res) => {
  const conversationId = parseInt(req.query.conversation_id);
  const userId = parseInt(req.query.user_id);
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 30;

  if (!conversationId || conversationId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Thiếu mã cuộc hội thoại (conversation_id) hợp lệ.' });
  }

  const offset = (page - 1) * limit;

  try {
    // Lấy tin nhắn (lọc tin nhắn bị ẩn 'deleted_messages' cho user hiện tại và tin nhắn bị xóa cứng cho mọi người)
    const result = await query(
      `SELECT
         m.id, m.conversation_id, m.sender_id,
         u.name   AS sender_name,
         u.avatar AS sender_avatar,
         m.message, m.type, m.file_url, m.created_at,
         m.reply_to, m.edited, m.edited_at, m.recalled, m.recalled_by, m.recalled_at, m.forwarded,
         m.deleted,
         (SELECT EXISTS(SELECT 1 FROM deleted_messages WHERE message_id = m.id AND user_id = $2)) AS deleted_for_me
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
         AND ($2::integer IS NULL OR NOT EXISTS(SELECT 1 FROM deleted_messages WHERE message_id = m.id AND user_id = $2))
       ORDER BY m.id DESC
       LIMIT $3 OFFSET $4`,
      [conversationId, userId || null, limit, offset]
    );

    const formatted = result.rows.map(msg => ({
      id:              parseInt(msg.id),
      conversation_id: parseInt(msg.conversation_id),
      sender_id:       parseInt(msg.sender_id),
      sender_name:     msg.sender_name,
      sender_avatar:   msg.sender_avatar,
      message:         msg.recalled ? "Tin nhắn đã được thu hồi" : msg.message,
      type:            msg.type,
      file_url:        msg.file_url,
      created_at:      new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      raw_time:        msg.created_at,
      reply_to:        msg.reply_to ? parseInt(msg.reply_to) : null,
      edited:          !!msg.edited,
      edited_at:       msg.edited_at,
      recalled:        !!msg.recalled,
      recalled_by:     msg.recalled_by ? parseInt(msg.recalled_by) : null,
      recalled_at:     msg.recalled_at,
      forwarded:       !!msg.forwarded,
      deleted:         !!msg.deleted,
      deleted_for_me:  !!msg.deleted_for_me
    }));

    const messageIds = formatted.map(m => m.id);

    // Lấy thông tin cảm xúc (Reactions)
    let reactionsMap = {};
    if (messageIds.length > 0) {
      const reactionsRes = await query(
        `SELECT mr.message_id, mr.user_id, mr.reaction, u.name AS user_name
         FROM message_reactions mr
         JOIN users u ON mr.user_id = u.id
         WHERE mr.message_id = ANY($1)`,
        [messageIds]
      );
      reactionsRes.rows.forEach(row => {
        const mId = parseInt(row.message_id);
        if (!reactionsMap[mId]) {
          reactionsMap[mId] = [];
        }
        reactionsMap[mId].push({
          user_id: parseInt(row.user_id),
          user_name: row.user_name,
          reaction: row.reaction
        });
      });
    }

    // Lấy thông tin tin nhắn được trích dẫn (Reply Quote)
    const parentIds = formatted.map(m => m.reply_to).filter(Boolean);
    let parentMsgsMap = {};
    if (parentIds.length > 0) {
      const parentsRes = await query(
        `SELECT m.id, m.message, m.type, m.file_url, m.recalled, u.name AS sender_name
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.id = ANY($1)`,
        [parentIds]
      );
      parentsRes.rows.forEach(row => {
        const mId = parseInt(row.id);
        parentMsgsMap[mId] = {
          id: mId,
          sender_name: row.sender_name,
          message: row.recalled ? "Tin nhắn đã được thu hồi" : row.message,
          type: row.type,
          file_url: row.file_url,
          recalled: !!row.recalled
        };
      });
    }

    // Gắn reactions và reply_to_message vào từng tin nhắn
    const finalData = formatted.map(msg => ({
      ...msg,
      reactions: reactionsMap[msg.id] || [],
      reply_to_message: msg.reply_to ? parentMsgsMap[msg.reply_to] || null : null
    }));

    return res.status(200).json({
      status:   'success',
      data:     finalData,
      page,
      limit,
      has_more: finalData.length === limit,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi truy vấn tin nhắn: ' + err.message });
  }
});

// POST /api/messages — gửi tin nhắn qua HTTP (fallback, chủ yếu dùng Socket.IO)
router.post('/', async (req, res) => {
  const { conversation_id, sender_id, message, type = 'text', file_url = null, reply_to = null, forwarded = false } = req.body;

  if (!conversation_id || !sender_id || !message) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ: conversation_id, sender_id và message.' });
  }

  try {
    const insertRes = await query(
      'INSERT INTO messages (conversation_id, sender_id, message, type, file_url, reply_to, forwarded) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [parseInt(conversation_id), parseInt(sender_id), message, type, file_url, reply_to ? parseInt(reply_to) : null, !!forwarded]
    );

    const msgId = insertRes.rows[0].id;

    // Auto-restore logic for direct conversation
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
          console.log(`[RESTORE HTTP] Recreating missing conversation_users row for user ${missingUserId} in conv ${conversation_id}`);
          await query(
            'INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [parseInt(conversation_id), parseInt(missingUserId)]
          );
          
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${missingUserId}`).emit('conversation_restored', {
              conversation_id: String(conversation_id)
            });
          }
        }
      }
    }

    const userRes = await query('SELECT name, avatar FROM users WHERE id = $1 LIMIT 1', [sender_id]);
    const user = userRes.rows[0] || {};

    // Gửi Push Notification cho các thành viên khác trong phòng chat (chạy bất đồng bộ)
    (async () => {
      try {
        const senderName = user.name || 'Người dùng';
        const memberRes = await query(
          'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
          [parseInt(conversation_id)]
        );
        const otherMembers = memberRes.rows.filter(m => m.user_id !== parseInt(sender_id));
        
        if (otherMembers.length > 0) {
          const memberIds = otherMembers.map(m => m.user_id);
          const tokensRes = await query(
            'SELECT user_id, fcm_token FROM user_push_tokens WHERE user_id = ANY($1)',
            [memberIds]
          );

          if (tokensRes.rows.length > 0) {
            const { sendPWAPushNotification } = require('../config/firebaseAdmin');
            
            const title = `💬 Tin nhắn mới từ ${senderName}`;
            let body = message;
            if (type === 'image') body = '📷 [Hình ảnh]';
            else if (type === 'file') body = '📁 [Tệp tin]';
            
            if (body.length > 100) {
              body = body.substring(0, 100) + '...';
            }

            const dataUrl = `/chat/${conversation_id}`;

            console.log(`📡 [http-msg] Phát hiện ${tokensRes.rows.length} thiết bị nhận thông báo từ User ID ${sender_id}`);
            for (const row of tokensRes.rows) {
              await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'chat');
            }
          }
        }
      } catch (pushErr) {
        console.error('⚠️ [messages] Lỗi gửi push notification cho tin nhắn:', pushErr.message);
      }
    })();

    return res.status(201).json({
      status: 'success',
      data: {
        id:              parseInt(msgId),
        conversation_id: parseInt(conversation_id),
        sender_id:       parseInt(sender_id),
        sender_name:     user.name,
        sender_avatar:   user.avatar,
        message,
        type,
        file_url,
        created_at:      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        raw_time:        new Date().toISOString(),
        reply_to:        reply_to ? parseInt(reply_to) : null,
        forwarded:       !!forwarded,
        reactions:       []
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi lưu tin nhắn: ' + err.message });
  }
});

// POST /api/messages/:id/reaction (Thả/Bỏ cảm xúc)
router.post('/:id/reaction', async (req, res) => {
  const messageId = parseInt(req.params.id);
  const { user_id, reaction } = req.body;

  if (!messageId || !user_id || !reaction) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin thả cảm xúc.' });
  }

  try {
    const msgCheck = await query('SELECT conversation_id FROM messages WHERE id = $1 LIMIT 1', [messageId]);
    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tin nhắn.' });
    }
    const convId = msgCheck.rows[0].conversation_id;

    // Kiểm tra xem đã thả reaction này chưa
    const checkReact = await query(
      'SELECT reaction FROM message_reactions WHERE message_id = $1 AND user_id = $2 LIMIT 1',
      [messageId, user_id]
    );

    let eventName = 'reaction_added';
    if (checkReact.rows.length > 0) {
      if (checkReact.rows[0].reaction === reaction) {
        // Trùng -> Bỏ cảm xúc (Delete)
        await query(
          'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
          [messageId, user_id]
        );
        eventName = 'reaction_removed';
      } else {
        // Khác -> Cập nhật (Update)
        await query(
          'UPDATE message_reactions SET reaction = $1 WHERE message_id = $2 AND user_id = $3',
          [reaction, messageId, user_id]
        );
      }
    } else {
      // Thêm mới
      await query(
        'INSERT INTO message_reactions (message_id, user_id, reaction) VALUES ($1, $2, $3)',
        [messageId, user_id, reaction]
      );
    }

    // Thống kê Reactions
    const summaryRes = await query(
      `SELECT mr.reaction, COUNT(*)::int AS count
       FROM message_reactions mr
       WHERE mr.message_id = $1
       GROUP BY mr.reaction`,
      [messageId]
    );

    const allReactionsRes = await query(
      `SELECT mr.user_id, mr.reaction, u.name AS user_name
       FROM message_reactions mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = $1`,
      [messageId]
    );

    const reactionsSummary = summaryRes.rows;
    const allReactions = allReactionsRes.rows.map(r => ({
      user_id: parseInt(r.user_id),
      user_name: r.user_name,
      reaction: r.reaction
    }));

    const io = req.app.get('io');
    if (io) {
      await broadcastToConversation(io, convId, eventName, {
        message_id: messageId,
        conversation_id: convId,
        user_id: parseInt(user_id),
        reaction,
        reactions_summary: reactionsSummary,
        reactions: allReactions
      });
    }

    return res.status(200).json({
      status: 'success',
      message: eventName === 'reaction_added' ? 'Thả cảm xúc thành công.' : 'Bỏ cảm xúc thành công.',
      data: {
        message_id: messageId,
        conversation_id: convId,
        reaction,
        reactions_summary: reactionsSummary,
        reactions: allReactions
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi thả cảm xúc: ' + err.message });
  }
});

// PUT /api/messages/:id (Chỉnh sửa tin nhắn)
router.put('/:id', async (req, res) => {
  const messageId = parseInt(req.params.id);
  const { user_id, message } = req.body;

  if (!messageId || !user_id || !message) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin chỉnh sửa.' });
  }

  try {
    const msgCheck = await query('SELECT sender_id, conversation_id FROM messages WHERE id = $1 LIMIT 1', [messageId]);
    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tin nhắn.' });
    }

    const msg = msgCheck.rows[0];
    if (parseInt(msg.sender_id) !== parseInt(user_id)) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền chỉnh sửa tin nhắn này.' });
    }

    await query(
      'UPDATE messages SET message = $1, edited = TRUE, edited_at = NOW() WHERE id = $2',
      [message, messageId]
    );

    const io = req.app.get('io');
    if (io) {
      await broadcastToConversation(io, msg.conversation_id, 'message_edited', {
        id: messageId,
        conversation_id: msg.conversation_id,
        message,
        edited: true,
        edited_at: new Date().toISOString()
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Chỉnh sửa tin nhắn thành công.',
      data: {
        id: messageId,
        conversation_id: msg.conversation_id,
        message,
        edited: true
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi chỉnh sửa tin nhắn: ' + err.message });
  }
});

// POST /api/messages/:id/pin (Ghim tin nhắn)
router.post('/:id/pin', async (req, res) => {
  const messageId = parseInt(req.params.id);
  const { user_id, conversation_id } = req.body;

  if (!messageId || !user_id || !conversation_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin ghim tin nhắn.' });
  }

  try {
    const msgCheck = await query('SELECT id FROM messages WHERE id = $1 LIMIT 1', [messageId]);
    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tin nhắn.' });
    }

    // Đếm số lượng tin nhắn đã ghim trong phòng chat
    const countRes = await query(
      'SELECT COUNT(*)::int AS count FROM pinned_messages WHERE conversation_id = $1',
      [conversation_id]
    );
    const count = countRes.rows[0].count;

    // Giới hạn ghim tối đa 10
    if (count >= 10) {
      const oldestRes = await query(
        'SELECT message_id FROM pinned_messages WHERE conversation_id = $1 ORDER BY pinned_at ASC LIMIT 1',
        [conversation_id]
      );
      if (oldestRes.rows.length > 0) {
        const oldestMsgId = oldestRes.rows[0].message_id;
        await query(
          'DELETE FROM pinned_messages WHERE conversation_id = $1 AND message_id = $2',
          [conversation_id, oldestMsgId]
        );
        
        // Phát socket thông báo tự động bỏ ghim
        const io = req.app.get('io');
        if (io) {
          await broadcastToConversation(io, conversation_id, 'message_unpinned', {
            message_id: oldestMsgId,
            conversation_id: conversation_id,
            auto_removed: true
          });
        }
      }
    }

    await query(
      `INSERT INTO pinned_messages (conversation_id, message_id, pinned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, message_id) DO NOTHING`,
      [conversation_id, messageId, user_id]
    );

    const pinDetailRes = await query(
      `SELECT pm.*, m.message, m.type, m.file_url, m.recalled, u.name AS pinned_by_name
       FROM pinned_messages pm
       JOIN messages m ON pm.message_id = m.id
       JOIN users u ON pm.pinned_by = u.id
       WHERE pm.message_id = $1 AND pm.conversation_id = $2`,
      [messageId, conversation_id]
    );
    const pinDetail = pinDetailRes.rows[0];

    if (pinDetail) {
      pinDetail.message = pinDetail.recalled ? "Tin nhắn đã được thu hồi" : pinDetail.message;
    }

    const io = req.app.get('io');
    if (io) {
      await broadcastToConversation(io, conversation_id, 'message_pinned', {
        message_id: messageId,
        conversation_id: conversation_id,
        pinned_by: user_id,
        pin_info: pinDetail
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Ghim tin nhắn thành công.',
      data: pinDetail
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi ghim tin nhắn: ' + err.message });
  }
});

// DELETE /api/messages/:id/pin (Bỏ ghim tin nhắn)
router.delete('/:id/pin', async (req, res) => {
  const messageId = parseInt(req.params.id);
  const conversationId = parseInt(req.query.conversation_id);

  if (!messageId || !conversationId) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin bỏ ghim tin nhắn.' });
  }

  try {
    await query(
      'DELETE FROM pinned_messages WHERE conversation_id = $1 AND message_id = $2',
      [conversationId, messageId]
    );

    const io = req.app.get('io');
    if (io) {
      await broadcastToConversation(io, conversationId, 'message_unpinned', {
        message_id: messageId,
        conversation_id: conversationId
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Bỏ ghim tin nhắn thành công.',
      data: {
        message_id: messageId,
        conversation_id: conversationId
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi bỏ ghim tin nhắn: ' + err.message });
  }
});

// DELETE /api/messages/:id/everyone (Xóa với tất cả)
router.delete('/:id/everyone', async (req, res) => {
  const messageId = parseInt(req.params.id);
  const userId = parseInt(req.query.user_id || req.body.user_id);

  if (!messageId || !userId) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin xóa tin nhắn.' });
  }

  try {
    const msgCheck = await query('SELECT sender_id, conversation_id FROM messages WHERE id = $1 LIMIT 1', [messageId]);
    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tin nhắn.' });
    }

    const msg = msgCheck.rows[0];
    const userRoleCheck = await query('SELECT role FROM users WHERE id = $1 LIMIT 1', [userId]);
    const userRole = userRoleCheck.rows[0]?.role;

    if (parseInt(msg.sender_id) !== userId && userRole !== 'admin') {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xóa tin nhắn này.' });
    }

    await query(
      'UPDATE messages SET deleted = TRUE, deleted_by = $1, deleted_at = NOW() WHERE id = $2',
      [userId, messageId]
    );

    // Cũng xóa khỏi danh sách ghim nếu tin này đang ghim
    await query('DELETE FROM pinned_messages WHERE message_id = $1', [messageId]);

    const io = req.app.get('io');
    if (io) {
      await broadcastToConversation(io, msg.conversation_id, 'message_deleted', {
        id: messageId,
        conversation_id: msg.conversation_id
      });
      // Phát sự kiện bỏ ghim đi kèm nếu có
      await broadcastToConversation(io, msg.conversation_id, 'message_unpinned', {
        message_id: messageId,
        conversation_id: msg.conversation_id
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Xóa tin nhắn với tất cả thành công.',
      data: {
        id: messageId,
        conversation_id: msg.conversation_id
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi xóa tin nhắn: ' + err.message });
  }
});

// DELETE /api/messages/:id/me (Xóa chỉ mình tôi)
router.delete('/:id/me', async (req, res) => {
  const messageId = parseInt(req.params.id);
  const userId = parseInt(req.query.user_id || req.body.user_id);

  if (!messageId || !userId) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin xóa chỉ mình tôi.' });
  }

  try {
    const msgCheck = await query('SELECT conversation_id FROM messages WHERE id = $1 LIMIT 1', [messageId]);
    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tin nhắn.' });
    }

    await query(
      `INSERT INTO deleted_messages (message_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [messageId, userId]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('message_deleted_for_me', {
        id: messageId,
        conversation_id: msgCheck.rows[0].conversation_id
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Xóa tin nhắn chỉ mình tôi thành công.',
      data: {
        id: messageId,
        conversation_id: msgCheck.rows[0].conversation_id
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi xóa chỉ mình tôi: ' + err.message });
  }
});

// POST /api/messages/:id/recall (Thu hồi tin nhắn)
router.post('/:id/recall', async (req, res) => {
  const messageId = parseInt(req.params.id);
  const { user_id } = req.body;

  if (!messageId || !user_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin thu hồi.' });
  }

  try {
    const msgCheck = await query('SELECT sender_id, conversation_id FROM messages WHERE id = $1 LIMIT 1', [messageId]);
    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tin nhắn.' });
    }

    const msg = msgCheck.rows[0];
    if (parseInt(msg.sender_id) !== parseInt(user_id)) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền thu hồi tin nhắn này.' });
    }

    await query(
      'UPDATE messages SET recalled = TRUE, recalled_by = $1, recalled_at = NOW() WHERE id = $2',
      [user_id, messageId]
    );

    const io = req.app.get('io');
    if (io) {
      await broadcastToConversation(io, msg.conversation_id, 'message_recalled', {
        id: messageId,
        conversation_id: msg.conversation_id,
        recalled: true,
        message: "Tin nhắn đã được thu hồi"
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Thu hồi tin nhắn thành công.',
      data: {
        id: messageId,
        conversation_id: msg.conversation_id
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi thu hồi tin nhắn: ' + err.message });
  }
});

// GET /api/conversations/:id/pinned (Lấy danh sách tin nhắn ghim)
router.get('/conversations/:id/pinned', async (req, res) => {
  const conversationId = parseInt(req.params.id);

  if (!conversationId) {
    return res.status(400).json({ status: 'error', message: 'Thiếu mã cuộc hội thoại.' });
  }

  try {
    const result = await query(
      `SELECT pm.*, m.message, m.type, m.file_url, m.recalled, u.name AS pinned_by_name
       FROM pinned_messages pm
       JOIN messages m ON pm.message_id = m.id
       JOIN users u ON pm.pinned_by = u.id
       WHERE pm.conversation_id = $1
       ORDER BY pm.pinned_at DESC`,
      [conversationId]
    );

    const formatted = result.rows.map(row => ({
      id:              parseInt(row.id),
      conversation_id: parseInt(row.conversation_id),
      message_id:      parseInt(row.message_id),
      pinned_by:       parseInt(row.pinned_by),
      pinned_by_name:  row.pinned_by_name,
      pinned_at:       row.pinned_at,
      message:         row.recalled ? "Tin nhắn đã được thu hồi" : row.message,
      type:            row.type,
      file_url:        row.file_url,
      recalled:        !!row.recalled
    }));

    return res.status(200).json({
      status: 'success',
      data: formatted
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi truy vấn tin nhắn ghim: ' + err.message });
  }
});

module.exports = router;
