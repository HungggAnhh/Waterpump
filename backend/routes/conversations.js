// backend/routes/conversations.js
const express = require('express');
const { pool } = require('../config/supabase');
const router = express.Router();

// GET /api/conversations?user_id=X - Lấy danh sách hội thoại
router.get('/', async (req, res) => {
  const userId = parseInt(req.query.user_id);

  if (!userId || userId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Thiếu mã người dùng (user_id) hợp lệ.' });
  }

  const client = await pool.connect();
  try {
    // Auto-creation of empty direct conversations is removed to allow deleted conversations to remain deleted.
    // Empty conversations will only be created when a user explicitly starts a new chat thread or when a message is sent.

    // Lấy danh sách conversations (cả direct và group) cùng unread count và danh sách thành viên trong 1 query duy nhất (Tránh N+1)
    const convsResult = await client.query(
      `SELECT
         c.id, c.name, c.type, c.created_at, c.created_by,
         m.id        AS lastmessageid,
         m.message   AS lastmessage,
         m.type      AS lastmessagetype,
         m.created_at AS lastmessagetime,
         m.sender_id  AS lastmessagesenderid,
         cu.last_seen_message_id,
         (
           SELECT COUNT(*)::int
           FROM messages msg
           WHERE msg.conversation_id = c.id
             AND msg.id > COALESCE(cu.last_seen_message_id, 0)
             AND msg.sender_id != $1
             AND msg.id NOT IN (
               SELECT message_id FROM deleted_messages WHERE user_id = $1
             )
         ) AS unread_count,
         (
            SELECT json_agg(json_build_object(
              'user_id', u.id,
              'name', u.name,
              'avatar', u.avatar,
              'role', u.role,
              'email', u.email,
              'last_seen_message_id', cu_inner.last_seen_message_id
            ))
           FROM conversation_users cu_inner
           JOIN users u ON cu_inner.user_id = u.id
           WHERE cu_inner.conversation_id = c.id
         ) AS members
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
      const members = conv.members || [];
      const otherMembers = members.filter(m => parseInt(m.user_id) !== userId);

      let convName   = conv.name;
      let convAvatar = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=150&h=150&q=80'; // Avatar mặc định cho nhóm
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
        time:            conv.lastmessagetime ? new Date(conv.lastmessagetime).toISOString() : '',
        rawTime:         conv.lastmessagetime || conv.created_at,
        updated_at:      conv.lastmessagetime || conv.created_at,
        unreadCount:     conv.unread_count || 0,
        lastSeenMessageId: conv.last_seen_message_id ? parseInt(conv.last_seen_message_id) : null,
        lastMessageId:   conv.lastmessageid ? parseInt(conv.lastmessageid) : null,
        lastMessageSenderId: conv.lastmessagesenderid ? parseInt(conv.lastmessagesenderid) : null,
        online:          false,
        createdBy:       conv.created_by ? String(conv.created_by) : null,
        members:         members.map(m => ({
          user_id: parseInt(m.user_id),
          name: m.name,
          avatar: m.avatar,
          role: m.role,
          email: m.email,
          last_seen_message_id: m.last_seen_message_id ? parseInt(m.last_seen_message_id) : null
        })),
        otherUser:       otherUser ? {
          user_id: parseInt(otherUser.user_id),
          name: otherUser.name,
          avatar: otherUser.avatar,
          role: otherUser.role,
          email: otherUser.email
        } : null,
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

// POST /api/conversations — tạo hoặc lấy direct conversation cá nhân
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
      `SELECT c.id
       FROM conversations c
       WHERE c.type = 'direct'
         AND (
           EXISTS (
             SELECT 1 FROM conversation_users cu1 
             JOIN conversation_users cu2 ON cu1.conversation_id = cu2.conversation_id
             WHERE cu1.conversation_id = c.id AND cu1.user_id = $1 AND cu2.user_id = $2
           )
           OR (
             EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $1)
             AND NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $2)
             AND (
               EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = $2)
               OR EXISTS (SELECT 1 FROM deleted_messages dm JOIN messages m ON dm.message_id = m.id WHERE m.conversation_id = c.id AND dm.user_id = $2)
             )
           )
           OR (
             EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $2)
             AND NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $1)
             AND (
               EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = $1)
               OR EXISTS (SELECT 1 FROM deleted_messages dm JOIN messages m ON dm.message_id = m.id WHERE m.conversation_id = c.id AND dm.user_id = $1)
             )
           )
           OR (
             NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $1)
             AND NOT EXISTS (SELECT 1 FROM conversation_users cu WHERE cu.conversation_id = c.id AND cu.user_id = $2)
             AND (
               EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND (m.sender_id = $1 OR m.sender_id = $2))
               OR EXISTS (SELECT 1 FROM deleted_messages dm JOIN messages m ON dm.message_id = m.id WHERE m.conversation_id = c.id AND (dm.user_id = $1 OR dm.user_id = $2))
             )
           )
         )
       LIMIT 1`,
      [userId, recipientId]
    );

    if (check.rows.length > 0) {
      const convId = check.rows[0].id;
      
      // Make sure BOTH users are in conversation_users now (restore them if deleted)
      await client.query('BEGIN');
      const insertUser1 = await client.query(
        "INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1",
        [convId, userId]
      );
      const insertUser2 = await client.query(
        "INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1",
        [convId, recipientId]
      );
      await client.query('COMMIT');
      
      const io = req.app.get('io');
      if (io) {
        if (insertUser1.rows.length > 0) {
          io.to(`user_${userId}`).emit('conversation_restored', { conversation_id: String(convId) });
        }
        if (insertUser2.rows.length > 0) {
          io.to(`user_${recipientId}`).emit('conversation_restored', { conversation_id: String(convId) });
        }
      }

      return res.status(200).json({
        status: 'success',
        conversation_id: String(convId),
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

// POST /api/conversations/group — tạo nhóm trò chuyện mới
router.post('/group', async (req, res) => {
  const { name, user_ids, creator_id } = req.body;

  if (!name || !name.trim() || !user_ids || !Array.isArray(user_ids) || user_ids.length === 0 || !creator_id) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ tên nhóm, danh sách user_ids và creator_id.' });
  }

  const creatorId = parseInt(creator_id);
  const client = await pool.connect();
  try {
    // Kiểm tra quyền: Chỉ admin mới được tạo nhóm
    const creatorRes = await client.query(
      "SELECT role FROM users WHERE id = $1 LIMIT 1",
      [creatorId]
    );
    const creator = creatorRes.rows[0];
    if (!creator || creator.role !== 'admin') {
      return res.status(403).json({ status: 'error', message: 'Chỉ có Quản trị viên (Admin) mới có quyền tạo nhóm trò chuyện.' });
    }

    await client.query('BEGIN');
    
    // 1. Tạo conversations dạng group
    const convRes = await client.query(
      "INSERT INTO conversations (name, type, created_by) VALUES ($1, 'group', $2) RETURNING id",
      [name.trim(), creatorId]
    );
    const convId = convRes.rows[0].id;

    // 2. Liên kết các thành viên vào conversation_users
    const uniqueUserIds = Array.from(new Set([creatorId, ...user_ids.map(id => parseInt(id))]));
    for (const uId of uniqueUserIds) {
      await client.query(
        "INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1, $2)",
        [convId, uId]
      );
    }

    await client.query('COMMIT');

    // 3. Thông báo qua socket.io cho các thành viên
    const io = req.app.get('io');
    if (io) {
      uniqueUserIds.forEach(uId => {
        io.to(`user_${uId}`).emit('group_added_notify', {
          conversation_id: String(convId),
          name: name.trim(),
          type: 'group'
        });
      });
    }

    return res.status(201).json({
      status: 'success',
      conversation_id: String(convId),
      message: 'Tạo nhóm trò chuyện thành công.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Lỗi khi tạo nhóm:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi tạo nhóm: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /api/conversations/members — Thêm thành viên vào nhóm
router.post('/members', async (req, res) => {
  const { conversation_id, user_id, user_ids, requester_id } = req.body;

  if (!conversation_id || (!user_id && (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0)) || !requester_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin cuộc hội thoại, thành viên hoặc người yêu cầu.' });
  }

  const convId = parseInt(conversation_id);
  const reqId = parseInt(requester_id);
  const targetUserIds = Array.isArray(user_ids) ? user_ids.map(id => parseInt(id)) : [parseInt(user_id)];

  const client = await pool.connect();
  try {
    // 1. Kiểm tra nhóm chat và quyền hạn của requester
    const convRes = await client.query(
      "SELECT id, name, type, created_by FROM conversations WHERE id = $1 LIMIT 1",
      [convId]
    );

    if (convRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy cuộc trò chuyện.' });
    }

    const conversation = convRes.rows[0];
    if (conversation.type !== 'group') {
      return res.status(400).json({ status: 'error', message: 'Chỉ có thể thêm thành viên vào nhóm trò chuyện.' });
    }

    const requesterRes = await client.query(
      "SELECT role FROM users WHERE id = $1 LIMIT 1",
      [reqId]
    );
    const requester = requesterRes.rows[0];

    const isCreator = parseInt(conversation.created_by) === reqId;
    const isAdmin = requester && requester.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền quản lý thành viên trong nhóm này.' });
    }

    const addedUsers = [];
    const duplicatedUserIds = [];

    await client.query('BEGIN');

    for (const targetUserId of targetUserIds) {
      // 2. Tránh thêm trùng lặp
      const checkDup = await client.query(
        "SELECT 1 FROM conversation_users WHERE conversation_id = $1 AND user_id = $2 LIMIT 1",
        [convId, targetUserId]
      );

      if (checkDup.rows.length > 0) {
        duplicatedUserIds.push(targetUserId);
        continue;
      }

      // 3. Thực hiện thêm thành viên
      await client.query(
        "INSERT INTO conversation_users (conversation_id, user_id) VALUES ($1, $2)",
        [convId, targetUserId]
      );

      // Lấy thông tin thành viên vừa thêm để trả về và phát socket
      const targetUserRes = await client.query(
        "SELECT id, name, avatar, role, email FROM users WHERE id = $1 LIMIT 1",
        [targetUserId]
      );
      
      if (targetUserRes.rows.length > 0) {
        addedUsers.push(targetUserRes.rows[0]);
      }
    }

    await client.query('COMMIT');

    // 4. Phát tín hiệu realtime qua socket.io
    const io = req.app.get('io');
    if (io && addedUsers.length > 0) {
      addedUsers.forEach(targetUser => {
        io.to(`room_${convId}`).emit('member_added', {
          conversation_id: String(convId),
          user: {
            user_id: targetUser.id,
            name: targetUser.name,
            avatar: targetUser.avatar,
            role: targetUser.role,
            email: targetUser.email
          }
        });

        // Báo cho chính user để refresh inbox list
        io.to(`user_${targetUser.id}`).emit('group_added_notify', {
          conversation_id: String(convId),
          name: conversation.name,
          type: 'group'
        });
      });
    }

    // Nếu là thêm đơn lẻ mà đã trùng lặp thì trả về lỗi 409
    if (!Array.isArray(user_ids) && duplicatedUserIds.length > 0) {
      return res.status(409).json({ status: 'error', message: 'Người này đã là thành viên của nhóm.' });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Thêm thành viên vào nhóm thành công.',
      added_users: addedUsers.map(u => ({
        user_id: u.id,
        name: u.name,
        avatar: u.avatar,
        role: u.role,
        email: u.email
      })),
      duplicated_user_ids: duplicatedUserIds
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Lỗi khi thêm thành viên:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /api/conversations/members/remove — Xóa thành viên khỏi nhóm
router.post('/members/remove', async (req, res) => {
  const { conversation_id, user_id, requester_id } = req.body;

  if (!conversation_id || !user_id || !requester_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin cuộc trò chuyện, thành viên cần xóa hoặc người thực hiện.' });
  }

  const convId = parseInt(conversation_id);
  const targetUserId = parseInt(user_id);
  const reqId = parseInt(requester_id);

  if (targetUserId === reqId) {
    return res.status(400).json({ status: 'error', message: 'Trưởng nhóm không thể tự xóa mình. Vui lòng chọn rời nhóm nếu muốn.' });
  }

  const client = await pool.connect();
  try {
    // 1. Kiểm tra nhóm chat và quyền
    const convRes = await client.query(
      "SELECT id, type, created_by FROM conversations WHERE id = $1 LIMIT 1",
      [convId]
    );

    if (convRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy cuộc trò chuyện.' });
    }

    const conversation = convRes.rows[0];
    if (conversation.type !== 'group') {
      return res.status(400).json({ status: 'error', message: 'Chỉ có thể xóa thành viên khỏi nhóm trò chuyện.' });
    }

    const requesterRes = await client.query(
      "SELECT role FROM users WHERE id = $1 LIMIT 1",
      [reqId]
    );
    const requester = requesterRes.rows[0];

    const isCreator = parseInt(conversation.created_by) === reqId;
    const isAdmin = requester && requester.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền quản lý thành viên trong nhóm này.' });
    }

    // Tránh xóa người tạo nhóm
    if (targetUserId === parseInt(conversation.created_by)) {
      return res.status(400).json({ status: 'error', message: 'Không thể xóa Trưởng nhóm khỏi cuộc trò chuyện.' });
    }

    // 2. Thực hiện xóa thành viên
    const deleteRes = await client.query(
      "DELETE FROM conversation_users WHERE conversation_id = $1 AND user_id = $2",
      [convId, targetUserId]
    );

    if (deleteRes.rowCount === 0) {
      return res.status(400).json({ status: 'error', message: 'Thành viên này không có mặt trong cuộc trò chuyện.' });
    }

    // 3. Phát realtime socket
    const io = req.app.get('io');
    if (io) {
      io.to(`room_${convId}`).emit('member_removed', {
        conversation_id: String(convId),
        user_id: targetUserId
      });

      // Phát sự kiện group_kicked cho chính user để đuổi client ra ngoài
      io.to(`user_${targetUserId}`).emit('group_kicked', {
        conversation_id: String(convId),
        message: 'Bạn đã bị xóa khỏi nhóm trò chuyện này.'
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Xóa thành viên khỏi nhóm trò chuyện thành công.'
    });
  } catch (err) {
    console.error('Lỗi khi xóa thành viên:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /api/conversations/rename — Đổi tên nhóm
router.post('/rename', async (req, res) => {
  const { conversation_id, name, requester_id } = req.body;

  if (!conversation_id || !name || !name.trim() || !requester_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin đổi tên nhóm.' });
  }

  const convId = parseInt(conversation_id);
  const newName = name.trim();
  const reqId = parseInt(requester_id);

  const client = await pool.connect();
  try {
    // 1. Kiểm tra quyền đổi tên
    const convRes = await client.query(
      "SELECT id, type, created_by FROM conversations WHERE id = $1 LIMIT 1",
      [convId]
    );

    if (convRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhóm trò chuyện.' });
    }

    const conversation = convRes.rows[0];
    if (conversation.type !== 'group') {
      return res.status(400).json({ status: 'error', message: 'Chỉ có thể đổi tên nhóm trò chuyện.' });
    }

    const requesterRes = await client.query(
      "SELECT role FROM users WHERE id = $1 LIMIT 1",
      [reqId]
    );
    const requester = requesterRes.rows[0];

    const isCreator = parseInt(conversation.created_by) === reqId;
    const isAdmin = requester && requester.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền đổi tên nhóm trò chuyện này.' });
    }

    // 2. Thực hiện cập nhật tên nhóm
    await client.query(
      "UPDATE conversations SET name = $1 WHERE id = $2",
      [newName, convId]
    );

    // 3. Phát socket realtime
    const io = req.app.get('io');
    if (io) {
      // Báo cho các client đang mở room này
      io.to(`room_${convId}`).emit('group_updated', {
        conversation_id: String(convId),
        name: newName
      });

      // Báo cho toàn bộ thành viên cập nhật inbox sidebar
      const membersResult = await client.query(
        "SELECT user_id FROM conversation_users WHERE conversation_id = $1",
        [convId]
      );
      membersResult.rows.forEach(({ user_id }) => {
        io.to(`user_${user_id}`).emit('conversation_updated_name', {
          conversation_id: String(convId),
          name: newName
        });
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Thay đổi tên nhóm trò chuyện thành công.',
      name: newName
    });
  } catch (err) {
    console.error('Lỗi khi đổi tên nhóm:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /api/conversations/leave — Tự rời khỏi nhóm
router.post('/leave', async (req, res) => {
  const { conversation_id, user_id } = req.body;

  if (!conversation_id || !user_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin cuộc hội thoại hoặc thành viên rời nhóm.' });
  }

  const convId = parseInt(conversation_id);
  const targetUserId = parseInt(user_id);

  const client = await pool.connect();
  try {
    // 1. Kiểm tra nhóm chat
    const convRes = await client.query(
      "SELECT id, type, created_by FROM conversations WHERE id = $1 LIMIT 1",
      [convId]
    );

    if (convRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhóm trò chuyện.' });
    }

    const conversation = convRes.rows[0];
    if (conversation.type !== 'group') {
      return res.status(400).json({ status: 'error', message: 'Chỉ có thể rời khỏi cuộc trò chuyện nhóm.' });
    }

    const isCreator = parseInt(conversation.created_by) === targetUserId;

    // Lấy danh sách thành viên hiện tại
    const membersRes = await client.query(
      "SELECT user_id FROM conversation_users WHERE conversation_id = $1",
      [convId]
    );
    const members = membersRes.rows.map(m => parseInt(m.user_id));

    if (!members.includes(targetUserId)) {
      return res.status(400).json({ status: 'error', message: 'Bạn không có mặt trong nhóm trò chuyện này.' });
    }

    // 2. Chuyển nhượng quyền Trưởng nhóm nếu Trưởng nhóm hiện tại rời đi
    let newCreatorId = null;
    if (isCreator && members.length > 1) {
      // Tìm thành viên tiếp theo làm trưởng nhóm
      const nextCreator = members.find(mId => mId !== targetUserId);
      if (nextCreator) {
        newCreatorId = nextCreator;
        await client.query(
          "UPDATE conversations SET created_by = $1 WHERE id = $2",
          [newCreatorId, convId]
        );
        console.log(`[LEAVE_GROUP] Transferred creator role of conv ${convId} from ${targetUserId} to ${newCreatorId}`);
      }
    }

    // 3. Thực hiện xóa thành viên khỏi nhóm
    await client.query(
      "DELETE FROM conversation_users WHERE conversation_id = $1 AND user_id = $2",
      [convId, targetUserId]
    );

    // 4. Phát socket realtime
    const io = req.app.get('io');
    if (io) {
      // Báo các thành viên còn lại
      io.to(`room_${convId}`).emit('member_removed', {
        conversation_id: String(convId),
        user_id: targetUserId
      });

      if (newCreatorId) {
        io.to(`room_${convId}`).emit('creator_transferred', {
          conversation_id: String(convId),
          created_by: String(newCreatorId)
        });
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Rời khỏi nhóm trò chuyện thành công.',
      transferred_creator: newCreatorId ? String(newCreatorId) : null
    });
  } catch (err) {
    console.error('Lỗi khi rời nhóm:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/conversations/:id — Xóa cuộc hội thoại (xóa liên kết user khỏi conversations)
router.delete('/:id', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  const userId = parseInt(req.query.user_id);

  if (!conversationId || !userId) {
    return res.status(400).json({ status: 'error', message: 'Thiếu mã cuộc hội thoại hoặc mã người dùng.' });
  }

  const client = await pool.connect();
  try {
    // 1. Verify current user belongs to conversation
    const userInConvRes = await client.query(
      "SELECT 1 FROM conversation_users WHERE conversation_id = $1 AND user_id = $2 LIMIT 1",
      [conversationId, userId]
    );

    if (userInConvRes.rows.length === 0) {
      return res.status(403).json({ status: 'error', message: 'Bạn không thuộc cuộc trò chuyện này.' });
    }

    const convRes = await client.query(
      "SELECT id, type, created_by FROM conversations WHERE id = $1 LIMIT 1",
      [conversationId]
    );

    if (convRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy cuộc trò chuyện.' });
    }

    const conversation = convRes.rows[0];

    await client.query('BEGIN');

    // 2. Get all message IDs inside the conversation
    const messagesRes = await client.query(
      "SELECT id FROM messages WHERE conversation_id = $1",
      [conversationId]
    );
    const messageIds = messagesRes.rows.map(row => row.id);

    // 3. Insert all message IDs into deleted_messages for current user
    if (messageIds.length > 0) {
      for (const msgId of messageIds) {
        await client.query(
          "INSERT INTO deleted_messages (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [msgId, userId]
        );
      }
    }

    // 4. Remove current user row from conversation_users
    await client.query(
      "DELETE FROM conversation_users WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, userId]
    );

    // 5. Commit transaction
    await client.query('COMMIT');

    // 6. Emit realtime event
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('conversation_deleted', {
        conversation_id: parseInt(conversationId)
      });
      
      if (conversation.type === 'group') {
        // Báo cho các thành viên khác trong nhóm
        io.to(`room_${conversationId}`).emit('member_removed', {
          conversation_id: String(conversationId),
          user_id: userId
        });
      }
    }

    // Return success
    return res.status(200).json({
      success: true
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Lỗi khi xóa cuộc hội thoại:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi xóa cuộc hội thoại: ' + err.message });
  } finally {
    client.release();
  }
});

const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
require('dotenv').config({ path: __dirname + '/../.env' });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const bucketName = process.env.SUPABASE_BUCKET || 'media';

const cleanSupabaseUrl = supabaseUrl ? supabaseUrl.replace(/\/rest\/v1\/?$/, '') : '';

const supabaseClient = cleanSupabaseUrl && supabaseKey 
  ? createClient(cleanSupabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket }
    })
  : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận định dạng ảnh JPG, JPEG, PNG, WEBP.'));
    }
  }
});

const getAuthUser = (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const JWT_SECRET = process.env.JWT_SECRET || 'SecretCompanyKeySecret_9988';
  if (token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (e) {
      console.warn("⚠️ JWT verification failed in conversations route:", e.message);
    }
  }
  const fallbackId = parseInt(req.query.user_id || req.body.user_id || req.body.requester_id);
  const fallbackRole = req.query.user_role || req.body.user_role || 'user';
  if (fallbackId) {
    return { id: fallbackId, role: fallbackRole };
  }
  return null;
};

const deleteOldConversationAvatar = async (avatarUrl) => {
  if (!avatarUrl || !supabaseClient) return;
  
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const markerIdx = avatarUrl.indexOf(marker);
  
  if (markerIdx !== -1) {
    const filePath = avatarUrl.substring(markerIdx + marker.length);
    console.log(`🧹 [GROUP_AVATAR_CLEANUP] Cleaning up old avatar: ${filePath}`);
    try {
      const { error } = await supabaseClient.storage.from(bucketName).remove([filePath]);
      if (error) {
        console.error(`⚠️ [GROUP_AVATAR_CLEANUP:ERROR] Cannot delete old avatar: ${error.message}`);
      }
    } catch (err) {
      console.error(`⚠️ [GROUP_AVATAR_CLEANUP:CRITICAL] Exception: ${err.message}`);
    }
  }
};

// POST /api/conversations/:conversationId/avatar
router.post('/:conversationId/avatar', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ status: 'error', message: 'Lỗi tải ảnh nhóm: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  const conversationId = parseInt(req.params.conversationId);
  const requester = getAuthUser(req);
  if (!requester) {
    return res.status(401).json({ status: 'error', message: 'Yêu cầu xác thực token (Unauthorized).' });
  }

  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Không tìm thấy tệp ảnh.' });
  }

  if (!supabaseClient) {
    return res.status(500).json({ status: 'error', message: 'Lưu trữ chưa được cấu hình.' });
  }

  const client = await pool.connect();
  try {
    const convRes = await client.query(
      "SELECT id, type, created_by, avatar FROM conversations WHERE id = $1 LIMIT 1",
      [conversationId]
    );

    if (convRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhóm.' });
    }

    const conversation = convRes.rows[0];
    if (conversation.type !== 'group') {
      return res.status(400).json({ status: 'error', message: 'Chỉ cập nhật ảnh cho nhóm.' });
    }

    const isCreator = parseInt(conversation.created_by) === requester.id;
    const isAdmin = requester.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ status: 'error', message: 'Không có quyền cập nhật ảnh đại diện của nhóm này.' });
    }

    const file = req.file;
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
    const dangerousExts = ['exe', 'sh', 'js', 'php', 'py', 'pl', 'html', 'htm', 'xml'];
    if (dangerousExts.includes(ext)) {
      return res.status(400).json({ status: 'error', message: 'Tệp không hợp lệ.' });
    }

    const fileName = `group_avatars/${conversationId}_${Date.now()}.${ext}`;
    const oldAvatarUrl = conversation.avatar;

    const { error: uploadError } = await supabaseClient.storage
      .from(bucketName)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) {
      return res.status(500).json({ status: 'error', message: 'Lỗi Supabase Storage: ' + uploadError.message });
    }

    const { data: publicData } = supabaseClient.storage.from(bucketName).getPublicUrl(fileName);
    const newAvatarUrl = publicData.publicUrl;

    await client.query('UPDATE conversations SET avatar = $1 WHERE id = $2', [newAvatarUrl, conversationId]);

    if (oldAvatarUrl && !oldAvatarUrl.includes('unsplash.com')) {
      await deleteOldConversationAvatar(oldAvatarUrl);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`room_${conversationId}`).emit('group_avatar_updated', {
        conversation_id: String(conversationId),
        avatar: newAvatarUrl
      });

      const membersResult = await client.query(
        "SELECT user_id FROM conversation_users WHERE conversation_id = $1",
        [conversationId]
      );
      membersResult.rows.forEach(({ user_id }) => {
        io.to(`user_${user_id}`).emit('conversation_updated_avatar', {
          conversation_id: String(conversationId),
          avatar: newAvatarUrl
        });
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Cập nhật ảnh đại diện nhóm thành công.',
      avatar: newAvatarUrl
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Lỗi hệ thống: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

