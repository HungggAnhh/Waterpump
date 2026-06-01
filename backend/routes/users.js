// backend/routes/users.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/supabase');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'SecretCompanyKeySecret_9988';

// Helper: Giải mã user từ token hoặc lấy fallback trong môi trường dev
const getAuthUser = (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return { id: parseInt(decoded.id), role: decoded.role };
    } catch (e) {
      console.warn("⚠️ JWT verification failed in users route:", e.message);
    }
  }
  const fallbackId = parseInt(req.query.user_id || req.body.user_id);
  const fallbackRole = req.query.user_role || req.body.user_role || 'user';
  if (fallbackId) {
    return { id: fallbackId, role: fallbackRole };
  }
  return null;
};

// GET /api/users — lấy danh sách tất cả users
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, email, avatar, role, status, created_at FROM users ORDER BY id ASC'
    );
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Không thể truy vấn người dùng: ' + err.message });
  }
});

// POST /api/users — tạo mới / cập nhật tên / cập nhật avatar
router.post('/', async (req, res) => {
  const data = req.body;

  if (!data) {
    return res.status(400).json({ status: 'error', message: 'Không nhận được dữ liệu.' });
  }

  // Hành động 1: cập nhật tên
  if (data.action === 'update_name') {
    if (!data.id || !data.name) {
      return res.status(400).json({ status: 'error', message: 'Thiếu id hoặc name.' });
    }
    try {
      await query('UPDATE users SET name = $1 WHERE id = $2', [data.name, data.id]);
      
      const updatedRes = await query('SELECT id, name, email, role, status, avatar, created_at FROM users WHERE id = $1 LIMIT 1', [data.id]);
      const io = req.app.get('io');
      if (io && updatedRes.rows.length > 0) {
        io.emit('user_updated', updatedRes.rows[0]);
      }

      return res.status(200).json({ status: 'success', message: 'Cập nhật họ tên thành công.' });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
    }
  }

  // Hành động 2: cập nhật avatar
  if (data.action === 'update_avatar') {
    if (!data.id || !data.avatar) {
      return res.status(400).json({ status: 'error', message: 'Thiếu id hoặc avatar.' });
    }
    try {
      await query('UPDATE users SET avatar = $1 WHERE id = $2', [data.avatar, data.id]);
      
      const updatedRes = await query('SELECT id, name, email, role, status, avatar, created_at FROM users WHERE id = $1 LIMIT 1', [data.id]);
      const io = req.app.get('io');
      if (io && updatedRes.rows.length > 0) {
        io.emit('user_updated', updatedRes.rows[0]);
      }

      return res.status(200).json({ status: 'success', message: 'Cập nhật ảnh đại diện thành công.' });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
    }
  }

  // Hành động 3: tạo tài khoản mới
  const { email, password, role = 'user', avatar, status = 'active' } = data;
  const name = role === 'admin' ? 'Admin' : (data.name?.trim() || 'Chưa đặt tên');

  if (!email || !password) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ Email và Mật khẩu.' });
  }

  try {
    // Kiểm tra email trùng
    const check = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (check.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: 'Email này đã tồn tại trong hệ thống.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const defaultAvatar = avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80';

    const result = await query(
      'INSERT INTO users (name, email, password, avatar, role, status) VALUES ($1,$2,$3,$4,$5::user_role,$6::user_status) RETURNING id',
      [name, email, hashedPassword, defaultAvatar, role, status]
    );

    const newUser = {
      id: result.rows[0].id,
      name,
      email,
      role,
      status,
      avatar: defaultAvatar,
      created_at: new Date().toISOString()
    };

    // Phát socket events realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('user_created', newUser);
    }

    return res.status(201).json({
      status: 'success',
      message: 'Tạo tài khoản mới thành công!',
      data: newUser
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi tạo tài khoản: ' + err.message });
  }
});

// POST /api/users/admin-update — Admin cập nhật thông tin thành viên (không đổi mật khẩu)
router.post('/admin-update', async (req, res) => {
  const requester = getAuthUser(req);
  if (!requester || requester.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Không có quyền truy cập. Chỉ dành cho Admin.' });
  }

  const { id, name, email, role, status } = req.body;
  if (!id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu ID người dùng cần cập nhật.' });
  }

  try {
    // 1. Kiểm tra xem người dùng cần cập nhật có tồn tại không
    const userCheck = await query('SELECT id, role, status FROM users WHERE id = $1 LIMIT 1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Người dùng không tồn tại.' });
    }

    const targetUser = userCheck.rows[0];

    // 2. Không cho phép đổi trạng thái hoặc quyền của Super Admin (id = 1)
    if (parseInt(id) === 1 && (role !== 'admin' || status !== 'active')) {
      return res.status(403).json({ status: 'error', message: 'Không thể hạ quyền hoặc khóa tài khoản Super Admin.' });
    }

    // 3. Kiểm tra trùng email nếu email thay đổi
    if (email) {
      const emailCheck = await query('SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1', [email, id]);
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ status: 'error', message: 'Email này đã tồn tại trong hệ thống.' });
      }
    }

    // 4. Cập nhật cơ sở dữ liệu
    await query(
      `UPDATE users 
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           role = COALESCE($3::text, role::text)::user_role,
           status = COALESCE($4::text, status::text)::user_status
       WHERE id = $5`,
      [name || null, email || null, role || null, status || null, id]
    );

    // Lấy thông tin user đã cập nhật
    const updatedRes = await query('SELECT id, name, email, role, status, avatar, created_at FROM users WHERE id = $1 LIMIT 1', [id]);
    const updatedUser = updatedRes.rows[0];

    // Phát socket events realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('user_updated', updatedUser);
      if (targetUser.role !== role) {
        io.emit('user_role_changed', { id, role });
      }
      if (targetUser.status !== status) {
        io.emit('user_status_changed', { id, status });
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Cập nhật thông tin tài khoản thành công.',
      data: updatedUser
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
  }
});

// POST /api/users/admin-reset-password — Admin reset mật khẩu cho thành viên
router.post('/admin-reset-password', async (req, res) => {
  const requester = getAuthUser(req);
  if (!requester || requester.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Không có quyền truy cập. Chỉ dành cho Admin.' });
  }

  const { userId, newPassword } = req.body;
  if (!userId || !newPassword || newPassword.trim() === '') {
    return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ userId và mật khẩu mới.' });
  }

  try {
    // Kiểm tra người dùng có tồn tại không
    const userCheck = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Người dùng không tồn tại.' });
    }

    // Hash mật khẩu mới bằng bcrypt
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Cập nhật CSDL
    await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

    return res.status(200).json({
      status: 'success',
      message: 'Đặt lại mật khẩu thành công!'
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi reset mật khẩu: ' + err.message });
  }
});

// POST /api/users/admin-delete — Admin xóa tài khoản
router.post('/admin-delete', async (req, res) => {
  const requester = getAuthUser(req);
  if (!requester || requester.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Không có quyền truy cập. Chỉ dành cho Admin.' });
  }

  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu ID người dùng cần xóa.' });
  }

  const targetId = parseInt(id);

  // Safeguards:
  // 1. Không cho phép Admin tự xóa chính mình
  if (targetId === requester.id) {
    return res.status(400).json({ status: 'error', message: 'Bạn không thể tự xóa chính tài khoản của mình.' });
  }

  // 2. Không cho phép xóa Super Admin (id = 1)
  if (targetId === 1) {
    return res.status(403).json({ status: 'error', message: 'Không thể xóa tài khoản Super Admin.' });
  }

  try {
    // Kiểm tra xem người dùng có tồn tại không
    const userCheck = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [targetId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Người dùng không tồn tại.' });
    }

    // Thực hiện xóa (cascade deletes sẽ tự dọn dẹp các bảng phụ liên quan do Postgres Foreign Key ON DELETE CASCADE)
    await query('DELETE FROM users WHERE id = $1', [targetId]);

    // Phát socket events realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('user_deleted', { id: targetId });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Đã xóa tài khoản người dùng thành công.'
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi xóa người dùng: ' + err.message });
  }
});

// POST /api/users/register-push-token — Đăng ký FCM token từ PWA client
router.post('/register-push-token', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Thiếu mã xác thực (Token).' });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'SecretCompanyKeySecret_9988';
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;

    const { fcmToken, deviceType = 'pwa_web' } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ status: 'error', message: 'Thiếu FCM Token trong yêu cầu.' });
    }

    // Upsert FCM token: chèn mới, nếu trùng fcm_token thì cập nhật lại user_id tương ứng
    await query(`
      INSERT INTO user_push_tokens (user_id, fcm_token, device_type, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (fcm_token)
      DO UPDATE SET user_id = EXCLUDED.user_id, device_type = EXCLUDED.device_type, updated_at = NOW()
    `, [parseInt(userId), fcmToken, deviceType]);

    console.log(`🎫 Đã đăng ký FCM Web Token cho User ID ${userId}: ${fcmToken.substring(0, 15)}...`);

    return res.status(200).json({
      status: 'success',
      message: 'Đăng ký FCM Web Token thành công.'
    });
  } catch (err) {
    console.error('❌ Lỗi đăng ký FCM token:', err.message);
    return res.status(401).json({
      status: 'error',
      message: 'Mã xác thực không hợp lệ hoặc lỗi CSDL: ' + err.message
    });
  }
});

module.exports = router;
