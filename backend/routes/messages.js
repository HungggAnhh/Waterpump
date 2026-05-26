// backend/routes/messages.js
const express = require('express');
const { query } = require('../config/supabase');
const router = express.Router();

// GET /api/messages?conversation_id=X&page=1&limit=30
router.get('/', async (req, res) => {
  const conversationId = parseInt(req.query.conversation_id);
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 30;

  if (!conversationId || conversationId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Thiếu mã cuộc hội thoại (conversation_id) hợp lệ.' });
  }

  const offset = (page - 1) * limit;

  try {
    const result = await query(
      `SELECT
         m.id, m.conversation_id, m.sender_id,
         u.name   AS sender_name,
         u.avatar AS sender_avatar,
         m.message, m.type, m.file_url, m.created_at
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.id DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );

    const formatted = result.rows.map(msg => ({
      id:              parseInt(msg.id),
      conversation_id: parseInt(msg.conversation_id),
      sender_id:       parseInt(msg.sender_id),
      sender_name:     msg.sender_name,
      sender_avatar:   msg.sender_avatar,
      message:         msg.message,
      type:            msg.type,
      file_url:        msg.file_url,
      created_at:      new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      raw_time:        msg.created_at,
    }));

    return res.status(200).json({
      status:   'success',
      data:     formatted,
      page,
      limit,
      has_more: formatted.length === limit,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi truy vấn tin nhắn: ' + err.message });
  }
});

// POST /api/messages — gửi tin nhắn qua HTTP (fallback, chủ yếu Socket.IO)
router.post('/', async (req, res) => {
  const { conversation_id, sender_id, message, type = 'text', file_url = null } = req.body;

  if (!conversation_id || !sender_id || !message) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ: conversation_id, sender_id và message.' });
  }

  try {
    const insertRes = await query(
      'INSERT INTO messages (conversation_id, sender_id, message, type, file_url) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [parseInt(conversation_id), parseInt(sender_id), message, type, file_url]
    );

    const msgId = insertRes.rows[0].id;

    const userRes = await query('SELECT name, avatar FROM users WHERE id = $1 LIMIT 1', [sender_id]);
    const user = userRes.rows[0] || {};

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
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi lưu tin nhắn: ' + err.message });
  }
});

module.exports = router;
