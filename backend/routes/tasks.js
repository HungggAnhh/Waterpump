// backend/routes/tasks.js
const express = require('express');
const { query } = require('../config/supabase');
const router = express.Router();

// GET /api/tasks
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        t.id, t.title, t.description, t.status, t.priority,
        t.due_date, t.boss_checked, t.created_at,
        u.name  AS assignee_name,
        u.avatar AS assignee_avatar,
        u.role  AS assignee_role
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      ORDER BY t.id ASC
    `);

    // Normalize boss_checked: PostgreSQL boolean → 0/1 for frontend
    const tasks = result.rows.map(t => ({
      ...t,
      boss_checked: t.boss_checked ? 1 : 0,
    }));

    return res.status(200).json({ status: 'success', data: tasks });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Không thể lấy danh sách công việc: ' + err.message });
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  const data = req.body;

  if (!data) {
    return res.status(400).json({ status: 'error', message: 'Không nhận được dữ liệu.' });
  }

  // Hành động 1: cập nhật status
  if (data.action === 'update_status') {
    if (!data.id || !data.status) {
      return res.status(400).json({ status: 'error', message: 'Thiếu id hoặc status.' });
    }
    try {
      await query('UPDATE tasks SET status = $1 WHERE id = $2', [data.status, data.id]);
      return res.status(200).json({ status: 'success', message: 'Cập nhật trạng thái công việc thành công.' });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
    }
  }

  // Hành động 2: toggle boss_checked
  if (data.action === 'toggle_boss_check') {
    if (data.id === undefined || data.boss_checked === undefined) {
      return res.status(400).json({ status: 'error', message: 'Thiếu id hoặc boss_checked.' });
    }
    try {
      const boolVal = data.boss_checked == 1 || data.boss_checked === true;
      await query('UPDATE tasks SET boss_checked = $1 WHERE id = $2', [boolVal, data.id]);
      return res.status(200).json({ status: 'success', message: 'Đã cập nhật phê duyệt của Sếp.' });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: 'Lỗi CSDL: ' + err.message });
    }
  }

  // Hành động 3: tạo mới công việc
  if (!data.title) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp tiêu đề (title).' });
  }

  try {
    const result = await query(
      `INSERT INTO tasks (title, description, status, priority, due_date, assignee_id, created_by, boss_checked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE) RETURNING id`,
      [
        data.title,
        data.description || null,
        data.status   || 'todo',
        data.priority  || 'medium',
        data.due_date  || null,
        data.assignee_id ? parseInt(data.assignee_id) : null,
        data.created_by  ? parseInt(data.created_by)  : 1,
      ]
    );

    return res.status(201).json({
      status: 'success',
      message: 'Công việc đã được tạo thành công.',
      task_id: result.rows[0].id
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi CSDL khi tạo công việc: ' + err.message });
  }
});

module.exports = router;
