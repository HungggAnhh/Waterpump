// backend/routes/tasks.js
const express = require('express');
const { query } = require('../config/supabase');
const jwt = require('jsonwebtoken');
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
      console.warn("⚠️ JWT verification failed:", e.message);
    }
  }
  const fallbackId = parseInt(req.query.user_id || req.body.user_id);
  const fallbackRole = req.query.user_role || req.body.user_role || 'user';
  if (fallbackId) {
    return { id: fallbackId, role: fallbackRole };
  }
  return null;
};

// 1. GET /api/tasks/workspaces — Lấy danh sách các trang lớn
router.get('/workspaces', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  try {
    let result;
    if (user.role === 'admin') {
      result = await query('SELECT * FROM workspaces ORDER BY id ASC');
    } else {
      // User thường chỉ thấy trang họ được gán làm thành viên (trong workspace_members) HOÀN TOÀN khớp hoặc có task gán cho họ
      result = await query(
        `SELECT DISTINCT w.* FROM workspaces w 
         LEFT JOIN tasks t ON t.workspace_id = w.id AND t.assigned_to = $1
         LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
         WHERE t.assigned_to = $1 OR wm.user_id = $1
         ORDER BY w.id ASC`,
        [user.id]
      );
    }
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi truy vấn danh sách trang: ' + err.message });
  }
});

// 2. POST /api/tasks/workspaces — Tạo trang mới và gán thành viên (chỉ Admin)
router.post('/workspaces', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ có Quản trị viên mới được tạo trang.' });
  }

  const { name, members } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp tên trang.' });
  }

  try {
    // Tạo workspace
    const result = await query(
      'INSERT INTO workspaces (name, created_by) VALUES ($1, $2) RETURNING *',
      [name.trim(), user.id]
    );
    const newWorkspace = result.rows[0];

    // Tự động thêm admin creator làm owner
    await query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [newWorkspace.id, user.id, 'owner']
    );

    // Gán các thành viên nội bộ được chọn vào trang này
    if (members && Array.isArray(members)) {
      for (const memberId of members) {
        const parsedMemberId = parseInt(memberId);
        if (parsedMemberId && parsedMemberId !== user.id) {
          await query(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [newWorkspace.id, parsedMemberId, 'member']
          );
        }
      }
    }

    // Phát realtime socket
    const io = req.app.get('io');
    if (io) {
      io.emit('workspace_created', newWorkspace);
      console.log('📡 Realtime: Phát sự kiện workspace_created cho:', newWorkspace.name);
    }

    return res.status(201).json({ status: 'success', data: newWorkspace });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi tạo trang lớn và gán thành viên: ' + err.message });
  }
});

// 3. GET /api/tasks/workspaces/:workspaceId/tasks — Lấy danh sách nhiệm vụ của trang lớn
router.get('/workspaces/:workspaceId/tasks', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const workspaceId = parseInt(req.params.workspaceId);

  try {
    let result;
    if (user.role === 'admin') {
      result = await query(
        `SELECT t.*, u.name AS assignee_name, u.avatar AS assignee_avatar 
         FROM tasks t 
         LEFT JOIN users u ON t.assigned_to = u.id 
         WHERE t.workspace_id = $1 
         ORDER BY t.id ASC`,
        [workspaceId]
      );
    } else {
      // Chỉ lấy task được giao cho chính user đó thuộc trang lớn này
      result = await query(
        `SELECT t.*, u.name AS assignee_name, u.avatar AS assignee_avatar 
         FROM tasks t 
         LEFT JOIN users u ON t.assigned_to = u.id 
         WHERE t.workspace_id = $1 AND t.assigned_to = $2 
         ORDER BY t.id ASC`,
        [workspaceId, user.id]
      );
    }
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách nhiệm vụ: ' + err.message });
  }
});

// 4. POST /api/tasks/tasks — Tạo nhiệm vụ mới (chỉ Admin)
router.post('/tasks', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ có Quản trị viên mới được tạo nhiệm vụ.' });
  }

  const { workspace_id, title, description, status = 'todo', priority = 'medium', assigned_to, deadline } = req.body;

  if (!workspace_id || !title || !title.trim()) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp tiêu đề và mã trang.' });
  }

  try {
    const isCompleted = status === 'completed';
    const result = await query(
      `INSERT INTO tasks (workspace_id, page_id, title, description, status, priority, assigned_to, created_by, deadline, completed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        parseInt(workspace_id),
        parseInt(workspace_id),
        title.trim(),
        description || null,
        status,
        priority,
        assigned_to ? parseInt(assigned_to) : null,
        user.id,
        deadline || null,
        isCompleted
      ]
    );

    const newTask = result.rows[0];

    // Lấy thêm thông tin assignee
    if (newTask.assigned_to) {
      const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [newTask.assigned_to]);
      if (userRes.rows.length > 0) {
        newTask.assignee_name = userRes.rows[0].name;
        newTask.assignee_avatar = userRes.rows[0].avatar;
      }
    }

    // Phát realtime socket
    const io = req.app.get('io');
    if (io) {
      io.emit('task_created', newTask);
      console.log('📡 Realtime: Phát sự kiện task_created cho:', newTask.title);
    }

    return res.status(201).json({ status: 'success', data: newTask });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi tạo nhiệm vụ: ' + err.message });
  }
});

// 5. PUT /api/tasks/tasks/:taskId — Cập nhật nhiệm vụ (Admin sửa tất cả, User sửa status/completed)
router.put('/tasks/:taskId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ.' });
    }

    const currentTask = taskRes.rows[0];
    let queryStr = '';
    let params = [];

    if (user.role === 'admin') {
      const { title, description, status, priority, assigned_to, deadline, completed, is_reviewed } = req.body;
      const finalCompleted = completed !== undefined ? completed : (status === 'completed');
      
      queryStr = `
        UPDATE tasks 
        SET title = $1, description = $2, status = $3, priority = $4, assigned_to = $5, deadline = $6, completed = $7, is_reviewed = $8, updated_at = NOW() 
        WHERE id = $9 
        RETURNING *`;
      params = [
        title !== undefined ? title : currentTask.title,
        description !== undefined ? description : currentTask.description,
        status !== undefined ? status : currentTask.status,
        priority !== undefined ? priority : currentTask.priority,
        assigned_to !== undefined ? (assigned_to ? parseInt(assigned_to) : null) : currentTask.assigned_to,
        deadline !== undefined ? (deadline || null) : currentTask.deadline,
        finalCompleted,
        is_reviewed !== undefined ? is_reviewed : (currentTask.is_reviewed || false),
        taskId
      ];
    } else {
      if (currentTask.assigned_to !== user.id) {
        return res.status(403).json({ status: 'error', message: 'Bạn không được phân quyền cập nhật công việc của người khác.' });
      }

      const { status, priority, description, completed } = req.body;
      const finalCompleted = completed !== undefined ? completed : (status === 'completed');

      queryStr = `
        UPDATE tasks 
        SET status = $1, priority = $2, description = $3, completed = $4, updated_at = NOW() 
        WHERE id = $5 
        RETURNING *`;
      params = [
        status !== undefined ? status : currentTask.status,
        priority !== undefined ? priority : currentTask.priority,
        description !== undefined ? description : currentTask.description,
        finalCompleted,
        taskId
      ];
    }

    const updateRes = await query(queryStr, params);
    const updatedTask = updateRes.rows[0];

    // Lấy thông tin assignee
    if (updatedTask.assigned_to) {
      const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.assigned_to]);
      if (userRes.rows.length > 0) {
        updatedTask.assignee_name = userRes.rows[0].name;
        updatedTask.assignee_avatar = userRes.rows[0].avatar;
      }
    }

    // Phát realtime socket
    const io = req.app.get('io');
    if (io) {
      io.emit('task_updated', updatedTask);
      console.log('📡 Realtime: Phát sự kiện task_updated cho:', updatedTask.title);
      if (updatedTask.completed && !currentTask.completed) {
        io.emit('task_completed', updatedTask);
      }
    }

    return res.status(200).json({ status: 'success', data: updatedTask });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi cập nhật nhiệm vụ: ' + err.message });
  }
});

// 6. DELETE /api/tasks/tasks/:taskId — Xóa nhiệm vụ (chỉ Admin)
router.delete('/tasks/:taskId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ có Quản trị viên mới có quyền xóa nhiệm vụ.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING *', [taskId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ để xóa.' });
    }

    // Phát realtime socket
    const io = req.app.get('io');
    if (io) {
      io.emit('task_deleted', { id: taskId });
      console.log('📡 Realtime: Phát sự kiện task_deleted cho ID:', taskId);
    }

    return res.status(200).json({ status: 'success', message: 'Xóa nhiệm vụ thành công.', data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi xóa nhiệm vụ: ' + err.message });
  }
});

// 7. GET /api/tasks/stats — Thống kê KPI trang chủ
router.get('/stats', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  try {
    let result;
    if (user.role === 'admin') {
      result = await query(`
        SELECT 
          COUNT(*)::int AS total,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END)::int AS in_progress,
          COUNT(CASE WHEN completed = TRUE OR status = 'completed' THEN 1 END)::int AS completed,
          COUNT(CASE WHEN priority = 'high' AND completed = FALSE THEN 1 END)::int AS urgent
        FROM tasks
      `);
    } else {
      result = await query(`
        SELECT 
          COUNT(*)::int AS total,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END)::int AS in_progress,
          COUNT(CASE WHEN completed = TRUE OR status = 'completed' THEN 1 END)::int AS completed,
          COUNT(CASE WHEN priority = 'high' AND completed = FALSE THEN 1 END)::int AS urgent
        FROM tasks
        WHERE assigned_to = $1
      `, [user.id]);
    }
    return res.status(200).json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi tính toán thống kê: ' + err.message });
  }
});

module.exports = router;
