// backend/routes/conversations.js
const express = require('express');
const { query, pool } = require('../config/supabase');
const router = express.Router();

// GET /api/conversations?user_id=X
router.get('/', async (req, res) => {
  const userId = parseInt(req.query.user_id);

  if (!userId || userId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Thiếu mã người dùng (user_id) hợp lệ.' });
  }

  const client = await pool.connect();
  try {
    // Tự động tạo direct conversation với tất cả users chưa có
    const otherUsers = await client.query(
      "SELECT id FROM users WHERE id != $1 AND status = 'active'",
      [userId]
    );

    for (const other of otherUsers.rows) {
      const check = await client.query(
        `SELECT cu1.conversation_id
         FROM conversation_users cu1
         JOIN conversation_users cu2 ON cu1.conversation_id = cu2.conversation_id
         JOIN conversations c ON cu1.conversation_id = c.id
         WHERE c.type = 'direct' AND cu1.user_id = $1 AND cu2.user_id = $2
         LIMIT 1`,
        [userId, other.id]
      );

      if (check.rows.length === 0) {
        try {
          await client.query('BEGIN');
          const convRes = await client.query(
            "INSERT INTO conversations (name, type) VALUES (NULL, 'direct') RETURNING id"
          );
          const convId = convRes.rows[0].id;
          await client.query(
            'INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1,$2),($1,$3)',
            [convId, userId, other.id]
          );
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK');
        }
      }
    }

    // Lấy danh sách conversations
    const convsResult = await client.query(
      `SELECT
         c.id, c.name, c.type, c.created_at,
         m.message   AS lastmessage,
         m.type      AS lastmessagetype,
         m.created_at AS lastmessagetime,
         m.sender_id  AS lastmessagesenderid
       FROM conversations c
       JOIN conversation_users cu ON c.id = cu.conversation_id
       LEFT JOIN messages m ON m.id = (
         SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
       )
       WHERE cu.user_id = $1
       ORDER BY COALESCE(m.created_at, c.created_at) DESC`,
      [userId]
    );

    const resultData = [];

    for (const conv of convsResult.rows) {
      const membersResult = await client.query(
        `SELECT cu.user_id, u.name, u.avatar, u.role, u.email
         FROM conversation_users cu
         JOIN users u ON cu.user_id = u.id
         WHERE cu.conversation_id = $1`,
        [conv.id]
      );
      const members = membersResult.rows;
      const otherMembers = members.filter(m => parseInt(m.user_id) !== userId);

      let convName   = conv.name;
      let convAvatar = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=150&h=150&q=80';
      let otherUser  = null;

      if (conv.type === 'direct') {
        if (otherMembers.length > 0) {
          otherUser  = otherMembers[0];
          convName   = otherUser.name;
          convAvatar = otherUser.avatar;
        } else {
          convName   = 'Tài khoản của bạn';
          convAvatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80';
        }
      }

      resultData.push({
        id:              String(conv.id),
        name:            convName,
        avatar:          convAvatar,
        type:            conv.type,
        lastMessage:     conv.lastmessage     || '',
        lastMessageType: conv.lastmessagetype || 'text',
        time:            conv.lastmessagetime ? new Date(conv.lastmessagetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        rawTime:         conv.lastmessagetime || conv.created_at,
        unreadCount:     0,
        online:          false,
        members,
        otherUser,
      });
    }

    return res.status(200).json({ status: 'success', data: resultData });
  } catch (err) {
    console.error('conversations GET error:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi truy vấn cuộc trò chuyện: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /api/conversations — tạo hoặc lấy direct conversation
router.post('/', async (req, res) => {
  const { user_id, recipient_id } = req.body;

  if (!user_id || !recipient_id) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ user_id và recipient_id.' });
  }

  const userId      = parseInt(user_id);
  const recipientId = parseInt(recipient_id);

  if (userId === recipientId) {
    return res.status(400).json({ status: 'error', message: 'Không thể tạo cuộc trò chuyện với chính mình.' });
  }

  const client = await pool.connect();
  try {
    const check = await client.query(
      `SELECT cu1.conversation_id
       FROM conversation_users cu1
       JOIN conversation_users cu2 ON cu1.conversation_id = cu2.conversation_id
       JOIN conversations c ON cu1.conversation_id = c.id
       WHERE c.type = 'direct' AND cu1.user_id = $1 AND cu2.user_id = $2
       LIMIT 1`,
      [userId, recipientId]
    );

    if (check.rows.length > 0) {
      return res.status(200).json({
        status: 'success',
        conversation_id: String(check.rows[0].conversation_id),
        message: 'Sử dụng cuộc hội thoại đã tồn tại.'
      });
    }

    await client.query('BEGIN');
    const convRes = await client.query(
      "INSERT INTO conversations (name, type) VALUES (NULL, 'direct') RETURNING id"
    );
    const convId = convRes.rows[0].id;
    await client.query(
      'INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1,$2),($1,$3)',
      [convId, userId, recipientId]
    );
    await client.query('COMMIT');

    return res.status(201).json({
      status: 'success',
      conversation_id: String(convId),
      message: 'Tạo cuộc trò chuyện cá nhân mới thành công.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi tạo cuộc hội thoại: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
