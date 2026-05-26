// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/supabase');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'SecretCompanyKeySecret_9988';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ email và mật khẩu.' });
  }

  try {
    const result = await query(
      'SELECT id, name, email, password, avatar, role, status FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Email người dùng không tồn tại trong hệ thống.' });
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({ status: 'error', message: 'Tài khoản của bạn chưa được kích hoạt hoặc đã bị khóa.' });
    }

    // Kiểm tra mật khẩu (bcrypt + plain text fallback)
    const isValid = await bcrypt.compare(password, user.password).catch(() => false)
      || password === user.password;

    if (!isValid) {
      return res.status(401).json({ status: 'error', message: 'Mật khẩu không chính xác.' });
    }

    delete user.password;

    // Tạo JWT token 30 ngày
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(200).json({
      status: 'success',
      message: 'Đăng nhập thành công.',
      token,
      data: user
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi server: ' + err.message });
  }
});

// POST /api/auth/verify-token
router.post('/verify-token', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(400).json({ status: 'error', message: 'Thiếu mã xác thực (Token).' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await query(
      'SELECT id, name, email, avatar, role, status FROM users WHERE id = $1 LIMIT 1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Người dùng không tồn tại.' });
    }

    const user = result.rows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ status: 'error', message: 'Tài khoản đã bị khóa.' });
    }

    return res.status(200).json({ status: 'success', message: 'Xác thực token thành công.', data: user });
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Mã xác thực không hợp lệ hoặc đã hết hạn.' });
  }
});

module.exports = router;
