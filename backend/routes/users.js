// backend/routes/users.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/supabase');
const router = express.Router();

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
      'INSERT INTO users (name, email, password, avatar, role, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [name, email, hashedPassword, defaultAvatar, role, status]
    );

    return res.status(201).json({
      status: 'success',
      message: 'Tạo tài khoản mới thành công!',
      data: { id: result.rows[0].id, name, email, role, status }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi tạo tài khoản: ' + err.message });
  }
});

module.exports = router;
