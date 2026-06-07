// backend/routes/tasks.js
const express = require('express');
const { query } = require('../config/supabase');
const jwt = require('jsonwebtoken');
const router = express.Router();

const logTaskActivity = async (taskId, userId, action, oldValue, newValue) => {
  try {
    await query(
      `INSERT INTO task_activities (task_id, user_id, action, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5)`,
      [taskId, userId, action, oldValue || null, newValue || null]
    );
  } catch (err) {
    console.error('❌ Lỗi ghi log hoạt động công việc:', err.message);
  }
};

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
  const fallbackId = parseInt(req.query.user_id || (req.body && req.body.user_id));
  const fallbackRole = req.query.user_role || (req.body && req.body.user_role) || 'user';
  if (fallbackId) {
    return { id: fallbackId, role: fallbackRole };
  }
  return null;
};

// GET /api/tasks — Lấy toàn bộ danh sách nhiệm vụ hệ thống
router.get('/', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const {
    status,
    workspace_id,
    priority,
    search,
    assignee_id,
    creator_id,
    from_date,
    to_date,
    quick_filter
  } = req.query;

  try {
    let queryText = `
      SELECT DISTINCT t.*, 
             w.name AS workspace_name,
             c.name AS creator_name, c.avatar AS creator_avatar 
      FROM tasks t 
      LEFT JOIN workspaces w ON t.workspace_id = w.id
      LEFT JOIN users c ON t.created_by = c.id
      LEFT JOIN task_assignments ta ON ta.task_id = t.id
      LEFT JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
      WHERE (t.is_deleted = FALSE OR t.is_deleted IS NULL)
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Phân quyền cơ bản
    if (user.role !== 'admin') {
      queryText += ` AND (
        t.created_by = $${paramIndex} OR 
        t.assigned_to = $${paramIndex} OR 
        ta.user_id = $${paramIndex} OR 
        wm.user_id = $${paramIndex}
      )`;
      queryParams.push(user.id);
      paramIndex++;
    }

    // Lọc theo trạng thái (status)
    if (status && status !== 'all') {
      if (status === 'not_started' || status === 'pending') {
        queryText += ` AND (t.approval_status = 'pending' OR t.approval_status IS NULL)`;
      } else {
        queryText += ` AND t.approval_status = $${paramIndex}`;
        queryParams.push(status);
        paramIndex++;
      }
    }

    // Lọc theo workspace
    if (workspace_id) {
      queryText += ` AND t.workspace_id = $${paramIndex}`;
      queryParams.push(parseInt(workspace_id));
      paramIndex++;
    }

    // Lọc theo priority
    if (priority) {
      queryText += ` AND t.priority = $${paramIndex}`;
      queryParams.push(priority);
      paramIndex++;
    }

    // Tìm kiếm search realtime (search by title or description)
    if (search && search.trim()) {
      queryText += ` AND (t.title ILIKE $${paramIndex} OR t.description ILIKE $${paramIndex})`;
      queryParams.push(`%${search.trim()}%`);
      paramIndex++;
    }

    // Lọc theo người thực hiện
    if (assignee_id) {
      queryText += ` AND (t.assigned_to = $${paramIndex} OR ta.user_id = $${paramIndex})`;
      queryParams.push(parseInt(assignee_id));
      paramIndex++;
    }

    // Lọc theo người tạo
    if (creator_id) {
      queryText += ` AND t.created_by = $${paramIndex}`;
      queryParams.push(parseInt(creator_id));
      paramIndex++;
    }

    // Lọc theo khoảng thời gian (deadline)
    if (from_date) {
      queryText += ` AND t.deadline >= $${paramIndex}`;
      queryParams.push(from_date);
      paramIndex++;
    }
    if (to_date) {
      queryText += ` AND t.deadline <= $${paramIndex}`;
      queryParams.push(to_date);
      paramIndex++;
    }

    // Bộ lọc nhanh (Quick Filters)
    if (quick_filter) {
      if (quick_filter === 'my_tasks' || quick_filter === 'mine') {
        queryText += ` AND (t.assigned_to = $${paramIndex} OR ta.user_id = $${paramIndex} OR t.created_by = $${paramIndex})`;
        queryParams.push(user.id);
        paramIndex++;
      } else if (quick_filter === 'assigned_to_me') {
        queryText += ` AND (t.assigned_to = $${paramIndex} OR ta.user_id = $${paramIndex})`;
        queryParams.push(user.id);
        paramIndex++;
      } else if (quick_filter === 'created_by_me') {
        queryText += ` AND t.created_by = $${paramIndex}`;
        queryParams.push(user.id);
        paramIndex++;
      } else if (quick_filter === 'overdue') {
        queryText += ` AND t.deadline < NOW() AND (t.approval_status != 'completed' AND t.status != 'completed')`;
      }
    }

    queryText += ` ORDER BY t.id DESC`;

    const result = await query(queryText, queryParams);
    const tasks = result.rows;

    if (tasks.length > 0) {
      const taskIds = tasks.map(t => t.id);
      const assigneesRes = await query(
        `SELECT ta.task_id, ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
         FROM task_assignments ta
         JOIN users u ON ta.user_id = u.id
         WHERE ta.task_id = ANY($1)`,
        [taskIds]
      );

      const assigneesMap = {};
      assigneesRes.rows.forEach(row => {
        if (!assigneesMap[row.task_id]) assigneesMap[row.task_id] = [];
        assigneesMap[row.task_id].push({
          user_id: row.user_id,
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          name: row.name,
          avatar: row.avatar,
          avatar_url: row.avatar_url
        });
      });

      tasks.forEach(t => {
        t.assignees = assigneesMap[t.id] || [];
      });
    }

    return res.status(200).json({ status: 'success', data: tasks });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách nhiệm vụ: ' + err.message });
  }
});

// GET /api/tasks/tasks/:taskId/comments — Lấy danh sách bình luận
router.get('/tasks/:taskId/comments', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  const taskId = parseInt(req.params.taskId);
  try {
    const result = await query(
      `SELECT tc.id, tc.task_id, tc.user_id, COALESCE(tc.content, tc.comment) AS comment, tc.file_url, tc.created_at,
              u.name AS user_name, u.avatar AS user_avatar, u.role AS user_role
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = $1
       ORDER BY tc.id ASC`,
      [taskId]
    );
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách bình luận: ' + err.message });
  }
});

// POST /api/tasks/tasks/:taskId/comments — Tạo bình luận mới
router.post('/tasks/:taskId/comments', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  const taskId = parseInt(req.params.taskId);
  const { comment, file_url } = req.body;
  if (!comment || !comment.trim()) {
    return res.status(400).json({ status: 'error', message: 'Nội dung bình luận không được để trống.' });
  }
  try {
    const result = await query(
      `INSERT INTO task_comments (task_id, user_id, comment, content, file_url)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING *`,
      [taskId, user.id, comment.trim(), file_url || null]
    );
    const newComment = result.rows[0];
    
    // Join with user information to return
    const userRes = await query('SELECT name, avatar, role FROM users WHERE id = $1', [user.id]);
    if (userRes.rows.length > 0) {
      newComment.user_name = userRes.rows[0].name;
      newComment.user_avatar = userRes.rows[0].avatar;
      newComment.user_role = userRes.rows[0].role;
    }
    
    // Socket update
    const io = req.app.get('io');
    if (io) {
      io.emit('task_comment_created', { taskId, comment: newComment });
    }
    
    return res.status(201).json({ status: 'success', data: newComment });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi gửi bình luận: ' + err.message });
  }
});

// GET /api/tasks/tasks/:taskId/attachments — Lấy danh sách tệp đính kèm
router.get('/tasks/:taskId/attachments', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  const taskId = parseInt(req.params.taskId);
  try {
    const result = await query(
      `SELECT ta.*, u.name AS user_name, u.avatar AS user_avatar
       FROM task_attachments ta
       LEFT JOIN users u ON ta.uploaded_by = u.id
       WHERE ta.task_id = $1
       ORDER BY ta.id ASC`,
      [taskId]
    );
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách tài liệu đính kèm: ' + err.message });
  }
});

// POST /api/tasks/tasks/:taskId/attachments — Thêm tệp đính kèm mới
router.post('/tasks/:taskId/attachments', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  const taskId = parseInt(req.params.taskId);
  const { file_url, file_type } = req.body;
  if (!file_url) {
    return res.status(400).json({ status: 'error', message: 'Đường dẫn tệp tin không được để trống.' });
  }
  try {
    const result = await query(
      `INSERT INTO task_attachments (task_id, uploaded_by, file_url, file_type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [taskId, user.id, file_url, file_type || null]
    );
    const newAttachment = result.rows[0];
    
    // Join with user information to return
    const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [user.id]);
    if (userRes.rows.length > 0) {
      newAttachment.user_name = userRes.rows[0].name;
      newAttachment.user_avatar = userRes.rows[0].avatar;
    }
    
    // Log activity
    const fileName = file_url.split('/').pop() || 'tệp tin';
    await logTaskActivity(taskId, user.id, 'file_attached', null, fileName);
    
    // Socket update
    const io = req.app.get('io');
    if (io) {
      io.emit('task_attachment_created', { taskId, attachment: newAttachment });
      io.emit('task_updated', { id: taskId }); // Trigger refresh of activities
    }
    
    return res.status(201).json({ status: 'success', data: newAttachment });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi đính kèm tệp tin: ' + err.message });
  }
});

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

// DELETE /api/tasks/workspaces/:workspaceId — Xóa trang lớn (chỉ Admin)
router.delete('/workspaces/:workspaceId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Không có quyền thực hiện. Chỉ admin mới được xóa trang.' });
  }

  const workspaceId = parseInt(req.params.workspaceId);
  try {
    const result = await query('DELETE FROM workspaces WHERE id = $1 RETURNING *', [workspaceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy trang để xóa.' });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('workspace_deleted', { id: workspaceId });
    }

    return res.status(200).json({ status: 'success', message: 'Đã xóa trang thành công.' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi khi xóa trang: ' + err.message });
  }
});

// PUT /api/tasks/workspaces/:workspaceId — Cập nhật thông tin trang lớn (chỉ Admin)
router.put('/workspaces/:workspaceId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Không có quyền thực hiện. Chỉ admin mới được sửa thông tin trang.' });
  }

  const workspaceId = parseInt(req.params.workspaceId);
  const { name, members } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp tên trang mới.' });
  }

  try {
    const result = await query(
      'UPDATE workspaces SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy trang để sửa.' });
    }

    const updatedWorkspace = result.rows[0];

    // Cập nhật danh sách thành viên nếu được cung cấp
    if (members && Array.isArray(members)) {
      // Xóa các thành viên cũ (giữ lại owner/chủ sở hữu)
      await query(
        "DELETE FROM workspace_members WHERE workspace_id = $1 AND role = 'member'",
        [workspaceId]
      );

      // Thêm các thành viên mới
      for (const memberId of members) {
        const parsedMemberId = parseInt(memberId);
        if (parsedMemberId && parsedMemberId !== user.id) {
          await query(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [workspaceId, parsedMemberId, 'member']
          );
        }
      }
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('workspace_updated', updatedWorkspace);
    }

    return res.status(200).json({ status: 'success', message: 'Đã cập nhật thông tin trang thành công.', data: updatedWorkspace });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi khi sửa thông tin trang: ' + err.message });
  }
});

// GET /api/tasks/workspaces/:workspaceId/members — Lấy danh sách thành viên của trang lớn
router.get('/workspaces/:workspaceId/members', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const workspaceId = parseInt(req.params.workspaceId);

  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.avatar, u.role
       FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1
       ORDER BY u.id ASC`,
      [workspaceId]
    );
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách thành viên trang: ' + err.message });
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
    const result = await query(
      `SELECT t.*, 
              c.name AS creator_name, c.avatar AS creator_avatar 
       FROM tasks t 
       LEFT JOIN users c ON t.created_by = c.id
       WHERE t.workspace_id = $1 
       ORDER BY t.id ASC`,
      [workspaceId]
    );

    const tasks = result.rows;
    if (tasks.length > 0) {
      const taskIds = tasks.map(t => t.id);
      const assigneesRes = await query(
        `SELECT ta.task_id, ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
         FROM task_assignments ta
         JOIN users u ON ta.user_id = u.id
         WHERE ta.task_id = ANY($1)`,
        [taskIds]
      );

      const assigneesMap = {};
      assigneesRes.rows.forEach(row => {
        if (!assigneesMap[row.task_id]) assigneesMap[row.task_id] = [];
        assigneesMap[row.task_id].push({
          user_id: row.user_id,
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          name: row.name,
          avatar: row.avatar,
          avatar_url: row.avatar_url
        });
      });

      tasks.forEach(t => {
        t.assignees = assigneesMap[t.id] || [];
      });
    }

    return res.status(200).json({ status: 'success', data: tasks });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách nhiệm vụ: ' + err.message });
  }
});

// 3.5. GET /api/tasks/workspaces/:workspaceId/pages — Lấy danh sách trang con
router.get('/workspaces/:workspaceId/pages', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const workspaceId = parseInt(req.params.workspaceId);

  try {
    const result = await query(
      'SELECT * FROM workspace_pages WHERE workspace_id = $1 ORDER BY id ASC',
      [workspaceId]
    );
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách trang con: ' + err.message });
  }
});

// 3.6. GET /api/tasks/pages/:pageId/tasks — Lấy danh sách nhiệm vụ của trang con
router.get('/pages/:pageId/tasks', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const pageId = parseInt(req.params.pageId);

  try {
    const result = await query(
      `SELECT t.*, 
              c.name AS creator_name, c.avatar AS creator_avatar 
       FROM tasks t 
       LEFT JOIN users c ON t.created_by = c.id
       WHERE t.page_id = $1 
       ORDER BY t.id ASC`,
      [pageId]
    );

    const tasks = result.rows;
    if (tasks.length > 0) {
      const taskIds = tasks.map(t => t.id);
      const assigneesRes = await query(
        `SELECT ta.task_id, ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
         FROM task_assignments ta
         JOIN users u ON ta.user_id = u.id
         WHERE ta.task_id = ANY($1)`,
        [taskIds]
      );

      const assigneesMap = {};
      assigneesRes.rows.forEach(row => {
        if (!assigneesMap[row.task_id]) assigneesMap[row.task_id] = [];
        assigneesMap[row.task_id].push({
          user_id: row.user_id,
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          name: row.name,
          avatar: row.avatar,
          avatar_url: row.avatar_url
        });
      });

      tasks.forEach(t => {
        t.assignees = assigneesMap[t.id] || [];
      });
    }

    return res.status(200).json({ status: 'success', data: tasks });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách nhiệm vụ của trang con: ' + err.message });
  }
});

// 4. POST /api/tasks/tasks — Tạo nhiệm vụ mới (Hỗ trợ phân quyền Giao việc Nhân viên -> Admin/Self & Đa người nhận)
router.post('/tasks', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const { workspace_id, title, description, status = 'todo', priority = 'medium', assigned_to, deadline, conversation_id } = req.body;

  if (!title || !title.trim() || (!workspace_id && !conversation_id)) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp tiêu đề và mã nhóm/trang.' });
  }

  // 0. Chống trùng lặp (Duplicate Task Prevention - 3s window)
  try {
    const dupCheckRes = await query(
      `SELECT id FROM tasks 
       WHERE (workspace_id = $1 OR conversation_id = $2) 
         AND created_by = $3 
         AND title = $4 
         AND created_at >= NOW() - INTERVAL '3 seconds'
       LIMIT 1`,
      [
        workspace_id ? parseInt(workspace_id) : null,
        conversation_id ? parseInt(conversation_id) : null,
        user.id,
        title.trim()
      ]
    );
    if (dupCheckRes.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: 'Nhiệm vụ đang được tạo, vui lòng không gửi trùng lặp.' });
    }
  } catch (err) {
    console.error('⚠️ Lỗi kiểm tra trùng lặp:', err.message);
  }

  // 1. Phân tích danh sách người nhận (assigned_to)
  let assigneeIds = [];
  try {
    if (Array.isArray(assigned_to)) {
      assigneeIds = assigned_to.map(id => parseInt(id)).filter(Boolean);
    } else if (assigned_to === 'all') {
      if (conversation_id) {
        const membersRes = await query('SELECT user_id FROM conversation_users WHERE conversation_id = $1', [parseInt(conversation_id)]);
        assigneeIds = membersRes.rows.map(m => m.user_id);
      } else if (workspace_id) {
        const membersRes = await query('SELECT user_id FROM workspace_members WHERE workspace_id = $1', [parseInt(workspace_id)]);
        assigneeIds = membersRes.rows.map(m => m.user_id);
      }
    } else if (assigned_to) {
      const singleId = parseInt(assigned_to);
      if (singleId) assigneeIds.push(singleId);
    }
  } catch (parseErr) {
    return res.status(400).json({ status: 'error', message: 'Danh sách người nhận không hợp lệ.' });
  }

  // Ràng buộc phân quyền giao việc (nếu người tạo không phải admin)
  if (user.role !== 'admin') {
    if (assigneeIds.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Nhân viên bắt buộc phải chọn người nhận việc.' });
    }
    // Chỉ được phép tự giao việc cho chính mình hoặc giao việc cho Admin
    for (const assigneeId of assigneeIds) {
      if (assigneeId !== user.id) {
        const targetUserRes = await query('SELECT role FROM users WHERE id = $1 LIMIT 1', [assigneeId]);
        if (targetUserRes.rows.length === 0) {
          return res.status(404).json({ status: 'error', message: `Không tìm thấy người nhận việc ID #${assigneeId}.` });
        }
        const targetRole = targetUserRes.rows[0].role;
        if (targetRole !== 'admin') {
          return res.status(403).json({
            status: 'error',
            message: 'Bạn chỉ được giao việc cho chính mình hoặc Admin'
          });
        }
      }
    }
  }

  try {
    let pageId = null;
    if (workspace_id) {
      const pageRes = await query(
        'SELECT id FROM workspace_pages WHERE workspace_id = $1 LIMIT 1',
        [parseInt(workspace_id)]
      );
      if (pageRes.rows.length > 0) {
        pageId = pageRes.rows[0].id;
      } else {
        // Tạo mặc định
        const newPageRes = await query(
          'INSERT INTO workspace_pages (workspace_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
          [parseInt(workspace_id), 'Trang chính 📄', user.id]
        );
        pageId = newPageRes.rows[0].id;
      }
    }

    const isCompleted = status === 'completed';
    // Lưu task chính (cột status và assigned_to trên tasks table vẫn lưu giá trị đầu tiên để tương thích ngược)
    const primaryAssignee = assigneeIds.length > 0 ? assigneeIds[0] : null;

    const result = await query(
      `INSERT INTO tasks (workspace_id, page_id, conversation_id, title, description, status, priority, assigned_to, created_by, deadline, completed, approval_status, creator_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        workspace_id ? parseInt(workspace_id) : null,
        pageId,
        conversation_id ? parseInt(conversation_id) : null,
        title.trim(),
        description || null,
        status,
        priority,
        primaryAssignee,
        user.id,
        deadline || null,
        isCompleted,
        'pending',
        user.role
      ]
    );

    const newTask = result.rows[0];

    // 2. Chèn phân công vào task_assignments
    if (assigneeIds.length > 0) {
      for (const assigneeId of assigneeIds) {
        await query(
          `INSERT INTO task_assignments (task_id, user_id, status, assigned_by, started_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [
            newTask.id,
            assigneeId,
            status,
            user.id,
            (status === 'in_progress' || status === 'completed') ? new Date() : null,
            status === 'completed' ? new Date() : null
          ]
        );
      }
    }

    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [newTask.id]
    );
    newTask.assignees = assigneesRes.rows;

    // Gán thông tin creator
    if (newTask.created_by) {
      const creatorRes = await query('SELECT name, avatar FROM users WHERE id = $1', [newTask.created_by]);
      if (creatorRes.rows.length > 0) {
        newTask.creator_name = creatorRes.rows[0].name;
        newTask.creator_avatar = creatorRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động
    const auditMetadata = {
      creatorId: user.id,
      assigneeIds,
      priority
    };
    await logTaskActivity(newTask.id, user.id, 'task_created', null, JSON.stringify(auditMetadata));

    // Chuẩn hóa Payload Realtime
    const standardizedPayload = {
      task: newTask,
      assignees: newTask.assignees || [],
      creator: {
        id: user.id,
        name: user.name || 'Hệ thống',
        avatar: user.avatar || null
      },
      workspaceId: newTask.workspace_id,
      pageId: newTask.page_id,
      createdAt: newTask.created_at
    };

    const io = req.app.get('io');
    if (io) {
      const recipientIds = [...new Set([...assigneeIds, user.id])];
      for (const recipientId of recipientIds) {
        // Gửi task_created đến tất cả người nhận và người tạo
        io.to(`user_${recipientId}`).emit('task_created', standardizedPayload);
        
        // Gửi task_assigned và task_assigned_notification đến những người nhận khác người tạo
        if (recipientId !== user.id) {
          io.to(`user_${recipientId}`).emit('task_assigned', standardizedPayload);
          io.to(`user_${recipientId}`).emit('task_assigned_notification', standardizedPayload);
        }
      }
      console.log('📡 Realtime: Phát sự kiện tạo và gán task cho các thành viên');
    }

    // Gửi Push Notification bất đồng bộ (chạy nền)
    if (assigneeIds.length > 0) {
      (async () => {
        try {
          const pushTargets = assigneeIds.filter(id => id !== user.id);
          if (pushTargets.length > 0) {
            const tokensRes = await query(
              'SELECT user_id, fcm_token FROM user_push_tokens WHERE user_id = ANY($1)',
              [pushTargets]
            );
            if (tokensRes.rows.length > 0) {
              const { sendPWAPushNotification } = require('../config/firebaseAdmin');
              const title = `📋 Nhiệm vụ mới`;
              const body = `${user.name} đã giao cho bạn: "${newTask.title}"`;
              const dataUrl = `/workspace/${newTask.workspace_id || ''}`;
              
              const extraData = {
                taskId: String(newTask.id),
                workspaceId: String(newTask.workspace_id || ''),
                pageId: String(newTask.page_id || '')
              };

              for (const row of tokensRes.rows) {
                await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task', extraData);
              }
            }
          }
        } catch (pushErr) {
          console.error('⚠️ Lỗi gửi push notification bất đồng bộ khi tạo task:', pushErr.message);
        }
      })();
    }

    // 3. Nếu được tạo từ nhóm chat, chèn tin nhắn chat loại 'task'
    if (conversation_id) {
      const messageText = `📋 Nhiệm vụ mới: "${newTask.title}"`;
      const msgRes = await query(
        `INSERT INTO messages (conversation_id, sender_id, message, type, task_id)
         VALUES ($1, $2, $3, 'task', $4) RETURNING *`,
        [parseInt(conversation_id), user.id, messageText, newTask.id]
      );
      
      const createdMsg = msgRes.rows[0];
      const formattedMsg = {
        id: parseInt(createdMsg.id),
        conversation_id: parseInt(conversation_id),
        sender_id: user.id,
        sender_name: user.name || 'Hệ thống',
        sender_avatar: user.avatar || null,
        message: messageText,
        type: 'task',
        created_at: new Date(createdMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        raw_time: createdMsg.created_at,
        task_id: newTask.id,
        task: newTask
      };

      if (io) {
        // Phát tới từng thành viên trong group chat qua kênh user_xx
        const memberRes = await query(
          'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
          [parseInt(conversation_id)]
        );
        memberRes.rows.forEach(({ user_id }) => {
          io.to(`user_${user_id}`).emit('receive_message', formattedMsg);
        });
      }
    }

    return res.status(201).json({ status: 'success', data: newTask });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi tạo nhiệm vụ: ' + err.message });
  }
});

// 4.5. PUT /api/tasks/tasks/:taskId/assignment/status — Cập nhật tiến độ cá nhân của người nhận nhiệm vụ
router.put('/tasks/:taskId/assignment/status', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);
  const { status } = req.body; // 'todo', 'in_progress', 'completed'

  if (!status || !['todo', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ status: 'error', message: 'Trạng thái không hợp lệ.' });
  }

  try {
    // 1. Kiểm tra xem user có được giao nhiệm vụ này không
    const checkRes = await query(
      'SELECT * FROM task_assignments WHERE task_id = $1 AND user_id = $2',
      [taskId, user.id]
    );

    if (checkRes.rows.length === 0) {
      return res.status(403).json({ status: 'error', message: 'Bạn không được phân quyền cập nhật tiến độ cho nhiệm vụ này.' });
    }

    const currentAssignment = checkRes.rows[0];
    const oldStatus = currentAssignment.status;

    if (oldStatus === status) {
      return res.status(200).json({ status: 'success', message: 'Trạng thái không thay đổi.' });
    }

    // 2. Cập nhật trạng thái
    const now = new Date();
    let startedAt = currentAssignment.started_at;
    let completedAt = currentAssignment.completed_at;

    if (status === 'in_progress' && !startedAt) {
      startedAt = now;
    }
    if (status === 'completed') {
      completedAt = now;
    } else {
      completedAt = null;
    }

    await query(
      `UPDATE task_assignments 
       SET status = $1, started_at = $2, completed_at = $3, updated_at = NOW()
       WHERE task_id = $4 AND user_id = $5`,
      [status, startedAt, completedAt, taskId, user.id]
    );

    // 3. Lấy thông tin nhiệm vụ để lấy tiêu đề và conversation_id
    const taskRes = await query('SELECT title, conversation_id, workspace_id FROM tasks WHERE id = $1', [taskId]);
    const task = taskRes.rows[0];

    // 4. Lấy thông tin assignees đầy đủ chuẩn hóa
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );
    const assignees = assigneesRes.rows;

    const payload = {
      taskId,
      task_id: taskId,
      user_id: user.id,
      status: status,
      completed_at: completedAt ? completedAt.toISOString() : null,
      conversation_id: task.conversation_id ? parseInt(task.conversation_id) : null,
      assignees
    };

    const io = req.app.get('io');
    if (io) {
      if (task.conversation_id) {
        io.to(`room_${task.conversation_id}`).emit('assignment_status_updated', payload);
      }
      io.emit('assignment_status_updated', payload);
      io.emit('task_updated', { id: taskId, user_id: user.id, status, assignees });
    }

    // 5. Tạo tin nhắn hệ thống thông báo đổi trạng thái
    if (task.conversation_id) {
      let emoji = '⏳';
      let actionText = 'đã đổi trạng thái sang Chưa bắt đầu';
      if (status === 'in_progress') {
        emoji = '🔄';
        actionText = 'đã bắt đầu thực hiện nhiệm vụ';
      } else if (status === 'completed') {
        emoji = '✅';
        actionText = 'đã hoàn thành nhiệm vụ';
      }

      const userRes = await query('SELECT name FROM users WHERE id = $1', [user.id]);
      const userName = userRes.rows[0]?.name || 'Thành viên';
      
      const systemMessageText = `${emoji} ${userName} ${actionText}: "${task.title}"`;
      
      const sysMsgRes = await query(
        `INSERT INTO messages (conversation_id, sender_id, message, type)
         VALUES ($1, $2, $3, 'system') RETURNING *`,
        [parseInt(task.conversation_id), user.id, systemMessageText]
      );

      const sysMsg = sysMsgRes.rows[0];
      const formattedSysMsg = {
        id: parseInt(sysMsg.id),
        conversation_id: parseInt(task.conversation_id),
        sender_id: user.id,
        sender_name: 'Hệ thống',
        sender_avatar: null,
        message: systemMessageText,
        type: 'system',
        created_at: new Date(sysMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        raw_time: sysMsg.created_at
      };

      if (io) {
        const memberRes = await query(
          'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
          [parseInt(task.conversation_id)]
        );
        memberRes.rows.forEach(({ user_id }) => {
          io.to(`user_${user_id}`).emit('receive_message', formattedSysMsg);
        });
      }
    }

    return res.status(200).json({ status: 'success', data: payload });

  } catch (err) {
    console.error('Lỗi cập nhật trạng thái gán việc:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ: ' + err.message });
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
      const { title, description, status, priority, assigned_to, deadline, completed, is_reviewed, approval_status } = req.body;
      const finalCompleted = completed !== undefined ? completed : (approval_status === 'completed' || status === 'completed');
      
      const primaryAssignee = (assigned_to !== undefined) 
        ? (Array.isArray(assigned_to) ? (assigned_to[0] ? parseInt(assigned_to[0]) : null) : (assigned_to ? parseInt(assigned_to) : null))
        : currentTask.assigned_to;

      // Cập nhật phân công
      if (assigned_to !== undefined) {
        let assigneeIds = [];
        if (Array.isArray(assigned_to)) {
          assigneeIds = assigned_to.map(id => parseInt(id)).filter(Boolean);
        } else if (assigned_to) {
          const singleId = parseInt(assigned_to);
          if (singleId) assigneeIds.push(singleId);
        }
        
        await query('DELETE FROM task_assignments WHERE task_id = $1', [taskId]);
        for (const assigneeId of assigneeIds) {
          await query(
            `INSERT INTO task_assignments (task_id, user_id, status, assigned_by)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [taskId, assigneeId, status || currentTask.status || 'todo', user.id]
          );
        }
      }

      queryStr = `
        UPDATE tasks 
        SET title = $1, 
            description = $2, 
            status = $3, 
            priority = $4, 
            assigned_to = $5, 
            deadline = $6, 
            completed = $7, 
            is_reviewed = $8, 
            approval_status = $9,
            updated_at = NOW(),
            reminder_interval = CASE WHEN $7 = TRUE THEN NULL ELSE reminder_interval END,
            last_reminded_at = CASE WHEN $7 = TRUE THEN NULL ELSE last_reminded_at END
        WHERE id = $10 
        RETURNING *`;
      params = [
        title !== undefined ? title : currentTask.title,
        description !== undefined ? description : currentTask.description,
        status !== undefined ? status : currentTask.status,
        priority !== undefined ? priority : currentTask.priority,
        primaryAssignee,
        deadline !== undefined ? (deadline || null) : currentTask.deadline,
        finalCompleted,
        is_reviewed !== undefined ? is_reviewed : (currentTask.is_reviewed || false),
        approval_status !== undefined ? approval_status : currentTask.approval_status,
        taskId
      ];
    } else {
      if (currentTask.assigned_to !== user.id) {
        return res.status(403).json({ status: 'error', message: 'Bạn không được phân quyền cập nhật công việc của người khác.' });
      }

      const { priority, description, progress } = req.body;

      queryStr = `
        UPDATE tasks 
        SET priority = $1, 
            description = $2, 
            progress = $3,
            updated_at = NOW()
        WHERE id = $4 
        RETURNING *`;
      params = [
        priority !== undefined ? priority : currentTask.priority,
        description !== undefined ? description : currentTask.description,
        progress !== undefined ? parseInt(progress) : (currentTask.progress || 0),
        taskId
      ];
    }
    const updateRes = await query(queryStr, params);
    const updatedTask = updateRes.rows[0];

    // Lấy thông tin assignees đầy đủ
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [updatedTask.id]
    );
    updatedTask.assignees = assigneesRes.rows;

    // Lấy thông tin assignee
    if (updatedTask.assigned_to) {
      const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.assigned_to]);
      if (userRes.rows.length > 0) {
        updatedTask.assignee_name = userRes.rows[0].name;
        updatedTask.assignee_avatar = userRes.rows[0].avatar;
      }
    }

    // Lấy thêm thông tin creator
    if (updatedTask.created_by) {
      const creatorRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.created_by]);
      if (creatorRes.rows.length > 0) {
        updatedTask.creator_name = creatorRes.rows[0].name;
        updatedTask.creator_avatar = creatorRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động khi có thay đổi (bất đồng bộ)
    (async () => {
      if (currentTask.status !== updatedTask.status) {
        await logTaskActivity(taskId, user.id, 'status_changed', currentTask.status, updatedTask.status);
      }
      if (currentTask.priority !== updatedTask.priority) {
        await logTaskActivity(taskId, user.id, 'priority_changed', currentTask.priority, updatedTask.priority);
      }
      if (currentTask.assigned_to !== updatedTask.assigned_to) {
        let oldAssigneeName = 'Không ai';
        let newAssigneeName = 'Không ai';
        
        if (currentTask.assigned_to) {
          const uRes = await query('SELECT name FROM users WHERE id = $1', [currentTask.assigned_to]);
          if (uRes.rows.length > 0) oldAssigneeName = uRes.rows[0].name;
        }
        if (updatedTask.assigned_to) {
          newAssigneeName = updatedTask.assignee_name || `User #${updatedTask.assigned_to}`;
        }
        await logTaskActivity(taskId, user.id, 'assigned', oldAssigneeName, newAssigneeName);
      }
      if (currentTask.title !== updatedTask.title) {
        await logTaskActivity(taskId, user.id, 'title_changed', currentTask.title, updatedTask.title);
      }
      if (currentTask.description !== updatedTask.description) {
        await logTaskActivity(taskId, user.id, 'desc_changed', currentTask.description, updatedTask.description);
      }
      if (currentTask.is_reviewed !== updatedTask.is_reviewed) {
        await logTaskActivity(taskId, user.id, 'reviewed', currentTask.is_reviewed ? 'true' : 'false', updatedTask.is_reviewed ? 'true' : 'false');
      }
    })();

    // Gửi Push Notification nếu thay đổi người thực hiện (hoặc được giao mới)
    if (updatedTask.assigned_to && updatedTask.assigned_to !== currentTask.assigned_to) {
      (async () => {
        try {
          const tokensRes = await query(
            'SELECT user_id, fcm_token FROM user_push_tokens WHERE user_id = $1',
            [updatedTask.assigned_to]
          );
          if (tokensRes.rows.length > 0) {
            const { sendPWAPushNotification } = require('../config/firebaseAdmin');
            const title = `📋 Bạn có nhiệm vụ mới`;
            const body = `Sếp đã giao cho bạn nhiệm vụ: "${updatedTask.title}"`;
            const dataUrl = `/workspace/${updatedTask.workspace_id}`;
            for (const row of tokensRes.rows) {
              await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
            }
          }
        } catch (pushErr) {
          console.error('⚠️ Lỗi gửi push notification khi gán task:', pushErr.message);
        }
      })();
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
          COUNT(CASE WHEN approval_status = 'pending' OR approval_status IS NULL THEN 1 END)::int AS pending,
          COUNT(CASE WHEN approval_status = 'in_progress' THEN 1 END)::int AS in_progress,
          COUNT(CASE WHEN approval_status = 'waiting_approval' THEN 1 END)::int AS waiting_approval,
          COUNT(CASE WHEN approval_status = 'revision_required' THEN 1 END)::int AS revision_required,
          COUNT(CASE WHEN approval_status = 'completed' THEN 1 END)::int AS completed
        FROM tasks
        WHERE is_deleted = FALSE OR is_deleted IS NULL
      `);
    } else {
      result = await query(`
        SELECT 
          COUNT(*)::int AS total,
          COUNT(CASE WHEN approval_status = 'pending' OR approval_status IS NULL THEN 1 END)::int AS pending,
          COUNT(CASE WHEN approval_status = 'in_progress' THEN 1 END)::int AS in_progress,
          COUNT(CASE WHEN approval_status = 'waiting_approval' THEN 1 END)::int AS waiting_approval,
          COUNT(CASE WHEN approval_status = 'revision_required' THEN 1 END)::int AS revision_required,
          COUNT(CASE WHEN approval_status = 'completed' THEN 1 END)::int AS completed
        FROM tasks
        WHERE (is_deleted = FALSE OR is_deleted IS NULL)
          AND (
            created_by = $1 OR 
            assigned_to = $1 OR 
            EXISTS (
              SELECT 1 FROM task_assignments ta WHERE ta.task_id = tasks.id AND ta.user_id = $1
            ) OR
            EXISTS (
              SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = tasks.workspace_id AND wm.user_id = $1
            )
          )
      `, [user.id]);
    }

    const row = result.rows[0];
    const total = row.total || 0;
    const completed = row.completed || 0;
    const completion_rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const statsData = {
      total,
      pending: row.pending || 0,
      in_progress: row.in_progress || 0,
      waiting_approval: row.waiting_approval || 0,
      revision_required: row.revision_required || 0,
      completed,
      completion_rate
    };

    return res.status(200).json({ status: 'success', data: statsData });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi tính toán thống kê: ' + err.message });
  }
});

// POST /api/tasks/tasks/:taskId/urge — Hối thúc nhiệm vụ (chỉ Admin)
router.post('/tasks/:taskId/urge', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ có Quản trị viên mới được sử dụng tính năng hối thúc.' });
  }

  const taskId = parseInt(req.params.taskId);
  const { interval } = req.body; // 'now' | 'hourly' | 'daily' | 'off'

  if (!interval || !['now', 'hourly', 'daily', 'off'].includes(interval)) {
    return res.status(400).json({ status: 'error', message: 'Lựa chọn hối thúc không hợp lệ.' });
  }

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1 AND is_deleted = FALSE', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ hoặc nhiệm vụ đã bị xóa.' });
    }

    const task = taskRes.rows[0];
    let assignedTo = task.assigned_to;

    if (!assignedTo) {
      // 1. Tự động tìm thành viên thường (non-admin) đầu tiên trong Trang để gán nhiệm vụ
      const memberRes = await query(
        `SELECT wm.user_id FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND u.role::text = 'user'
         LIMIT 1`,
        [task.workspace_id]
      );
      if (memberRes.rows.length > 0) {
        assignedTo = memberRes.rows[0].user_id;
        // Cập nhật CSDL
        await query('UPDATE tasks SET assigned_to = $1 WHERE id = $2', [assignedTo, taskId]);
        console.log(`💡 [urge] Tự động gán nhiệm vụ ID ${taskId} cho User ID ${assignedTo}`);
      } else {
        // 2. Fallback: Nếu Trang này chưa có thành viên thường nào, tự động gán cho tài khoản thường (non-admin) đầu tiên trong hệ thống
        const userRes = await query(
          `SELECT id FROM users WHERE role::text = 'user' ORDER BY id ASC LIMIT 1`
        );
        if (userRes.rows.length > 0) {
          assignedTo = userRes.rows[0].id;
          // Cập nhật CSDL
          await query('UPDATE tasks SET assigned_to = $1 WHERE id = $2', [assignedTo, taskId]);
          console.log(`💡 [urge] Tự động gán nhiệm vụ ID ${taskId} cho tài khoản thường đầu tiên ID ${assignedTo}`);
        }
      }
    }

    if (!assignedTo) {
      return res.status(400).json({ status: 'error', message: 'Nhiệm vụ này chưa được gán cho ai và Trang này chưa có thành viên thường nào để tự động gán.' });
    }

    // Fetch assignee tokens
    const tokensRes = await query(
      'SELECT fcm_token FROM user_push_tokens WHERE user_id = $1',
      [assignedTo]
    );

    const { sendPWAPushNotification } = require('../config/firebaseAdmin');

    if (interval === 'now') {
      // Immediate push notification
      if (tokensRes.rows.length > 0) {
        const title = `⚡ [HỐI THÚC KHẨN CẤP]`;
        const body = `Sếp đang hối thúc bạn thực hiện nhiệm vụ gấp: "${task.title}"`;
        const dataUrl = `/workspace/${task.workspace_id}`;
        for (const row of tokensRes.rows) {
          await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
        }
      }
      return res.status(200).json({
        status: 'success',
        message: 'Đã gửi thông báo hối thúc khẩn cấp thành công!'
      });
    }

    // Set recurring reminders
    let dbInterval = null;
    if (interval === 'hourly') dbInterval = 'hourly';
    if (interval === 'daily') dbInterval = 'daily';

    await query(
      'UPDATE tasks SET reminder_interval = $1, last_reminded_at = NULL, updated_at = NOW() WHERE id = $2',
      [dbInterval, taskId]
    );

    // Send immediate notification letting the user know a reminder is set
    if (dbInterval && tokensRes.rows.length > 0) {
      const reminderText = dbInterval === 'hourly' ? 'mỗi giờ' : 'mỗi ngày';
      const title = `⏰ Đặt nhắc nhở hối thúc`;
      const body = `Sếp đã bật chế độ hối thúc công việc này [${reminderText}] cho đến khi hoàn tất: "${task.title}"`;
      const dataUrl = `/workspace/${task.workspace_id}`;
      for (const row of tokensRes.rows) {
        await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
      }
    }

    const msgMap = {
      hourly: 'Đã thiết lập nhắc nhở hối thúc mỗi giờ.',
      daily: 'Đã thiết lập nhắc nhở hối thúc mỗi ngày.',
      off: 'Đã tắt chế độ nhắc nhở hối thúc công việc này.'
    };

    return res.status(200).json({
      status: 'success',
      message: msgMap[interval],
      data: {
        reminder_interval: dbInterval
      }
    });

  } catch (err) {
    console.error('❌ Lỗi API hối thúc:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi hệ thống khi xử lý hối thúc: ' + err.message });
  }
});

// 9. GET /api/tasks/tasks/:taskId/activities — Lấy lịch sử hoạt động của nhiệm vụ
router.get('/tasks/:taskId/activities', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    const result = await query(
      `SELECT ta.*, u.name AS user_name, u.avatar AS user_avatar, u.role AS user_role
       FROM task_activities ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1
       ORDER BY ta.id DESC`,
      [taskId]
    );
    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy lịch sử hoạt động: ' + err.message });
  }
});

// 10. POST /api/tasks/tasks/:taskId/start — Bắt đầu thực hiện (User/Admin)
router.post('/tasks/:taskId/start', async (req, res) => {
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

    const task = taskRes.rows[0];

    // Check if user is assigned to this task (either as primary, or in task_assignments)
    const checkAssignment = await query(
      'SELECT 1 FROM task_assignments WHERE task_id = $1 AND user_id = $2',
      [taskId, user.id]
    );
    const isAssigned = checkAssignment.rows.length > 0 || task.assigned_to === user.id;

    if (user.role !== 'admin' && !isAssigned) {
      return res.status(403).json({ status: 'error', message: 'Bạn không được phân quyền thực hiện công việc này.' });
    }

    const oldStatus = task.approval_status || 'pending';
    const result = await query(
      `UPDATE tasks 
       SET approval_status = 'in_progress', 
           status = 'in_progress',
           updated_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [taskId]
    );

    const updatedTask = result.rows[0];

    // Cập nhật task_assignments cho user hiện tại
    await query(
      `UPDATE task_assignments 
       SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE task_id = $1 AND user_id = $2`,
      [taskId, user.id]
    );

    // Lấy thông tin assignees đầy đủ chuẩn hóa
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );
    const assignees = assigneesRes.rows;
    updatedTask.assignees = assignees;

    // Lấy thông tin assignee chính
    if (updatedTask.assigned_to) {
      const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.assigned_to]);
      if (userRes.rows.length > 0) {
        updatedTask.assignee_name = userRes.rows[0].name;
        updatedTask.assignee_avatar = userRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động
    await logTaskActivity(taskId, user.id, 'status_changed', oldStatus, 'in_progress');

    // Socket realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('assignment_status_updated', {
        taskId,
        task_id: taskId,
        user_id: user.id,
        status: 'in_progress',
        completed_at: null,
        assignees
      });
      io.emit('task_updated', updatedTask);
    }

    return res.status(200).json({ status: 'success', data: updatedTask });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi bắt đầu thực hiện: ' + err.message });
  }
});

// 11. POST /api/tasks/tasks/:taskId/submit — Gửi duyệt công việc (User/Admin)
router.post('/tasks/:taskId/submit', async (req, res) => {
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

    const task = taskRes.rows[0];

    // Check if user is assigned to this task (either as primary, or in task_assignments)
    const checkAssignment = await query(
      'SELECT status FROM task_assignments WHERE task_id = $1 AND user_id = $2',
      [taskId, user.id]
    );
    const isAssigned = checkAssignment.rows.length > 0 || task.assigned_to === user.id;

    if (user.role !== 'admin' && !isAssigned) {
      return res.status(403).json({ status: 'error', message: 'Bạn không được phân quyền gửi duyệt công việc này.' });
    }

    // Check if user is assigned and status is 'in_progress'
    if (checkAssignment.rows.length > 0) {
      const assignmentStatus = checkAssignment.rows[0].status;
      if (assignmentStatus !== 'in_progress') {
        return res.status(400).json({ status: 'error', message: 'Bạn chỉ có thể gửi duyệt sau khi đã bắt đầu thực hiện nhiệm vụ.' });
      }
    }

    const oldStatus = task.approval_status || 'in_progress';
    const result = await query(
      `UPDATE tasks 
       SET approval_status = 'waiting_approval', 
           status = 'in_progress',
           updated_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [taskId]
    );

    const updatedTask = result.rows[0];

    // Cập nhật task_assignments cho user hiện tại: status = 'completed'
    const now = new Date();
    await query(
      `UPDATE task_assignments 
       SET status = 'completed', completed_at = $1, updated_at = NOW()
       WHERE task_id = $2 AND user_id = $3`,
      [now, taskId, user.id]
    );

    // Lấy thông tin assignees đầy đủ chuẩn hóa
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );
    const assignees = assigneesRes.rows;
    updatedTask.assignees = assignees;

    // Lấy thông tin assignee chính
    if (updatedTask.assigned_to) {
      const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.assigned_to]);
      if (userRes.rows.length > 0) {
        updatedTask.assignee_name = userRes.rows[0].name;
        updatedTask.assignee_avatar = userRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động
    await logTaskActivity(taskId, user.id, 'status_changed', oldStatus, 'waiting_approval');

    // Socket realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('assignment_status_updated', {
        taskId,
        task_id: taskId,
        user_id: user.id,
        status: 'completed',
        completed_at: now.toISOString(),
        assignees
      });
      io.emit('task_updated', updatedTask);
      io.emit('task_submitted', updatedTask);
    }

    // Gửi Push Notification cho tất cả Admin
    (async () => {
      try {
        const adminsRes = await query("SELECT id FROM users WHERE role = 'admin'");
        if (adminsRes.rows.length > 0) {
          const adminIds = adminsRes.rows.map(r => r.id);
          const tokensRes = await query(
            'SELECT fcm_token FROM user_push_tokens WHERE user_id = ANY($1)',
            [adminIds]
          );
          if (tokensRes.rows.length > 0) {
            const { sendPWAPushNotification } = require('../config/firebaseAdmin');
            const submitterName = user.name || 'Nhân viên';
            const title = `📋 Nhiệm vụ chờ duyệt`;
            const body = `${submitterName} vừa gửi duyệt nhiệm vụ: "${updatedTask.title}"`;
            const dataUrl = `/workspace/${updatedTask.workspace_id}`;
            for (const row of tokensRes.rows) {
              await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
            }
          }
        }
      } catch (pushErr) {
        console.error('⚠️ Lỗi gửi push cho admin khi gửi duyệt:', pushErr.message);
      }
    })();

    return res.status(200).json({ status: 'success', data: updatedTask });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi gửi duyệt: ' + err.message });
  }
});

// 12. POST /api/tasks/tasks/:taskId/approve — Duyệt hoàn thành (Chỉ Admin)
router.post('/tasks/:taskId/approve', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ quản trị viên mới được phép duyệt hoàn thành công việc.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ.' });
    }

    const task = taskRes.rows[0];
    const oldStatus = task.approval_status || 'waiting_approval';

    const result = await query(
      `UPDATE tasks 
       SET approval_status = 'completed', 
           status = 'completed',
           completed = TRUE, 
           completed_at = NOW(),
           approved_by = $1,
           approved_at = NOW(),
           updated_at = NOW(),
           reminder_interval = NULL,
           last_reminded_at = NULL
       WHERE id = $2 RETURNING *`,
      [user.id, taskId]
    );

    const updatedTask = result.rows[0];

    // Lấy thông tin assignees đầy đủ chuẩn hóa
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );
    updatedTask.assignees = assigneesRes.rows;

    // Lấy thông tin assignee chính
    if (updatedTask.assigned_to) {
      const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.assigned_to]);
      if (userRes.rows.length > 0) {
        updatedTask.assignee_name = userRes.rows[0].name;
        updatedTask.assignee_avatar = userRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động
    await logTaskActivity(taskId, user.id, 'status_changed', oldStatus, 'completed');
    await logTaskActivity(taskId, user.id, 'reviewed', 'false', 'true');

    // Socket realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('task_updated', updatedTask);
      io.emit('task_approved', updatedTask);
      io.emit('task_completed', updatedTask);
    }

    // Gửi Push Notification cho Assignee
    if (updatedTask.assigned_to) {
      (async () => {
        try {
          const tokensRes = await query(
            'SELECT fcm_token FROM user_push_tokens WHERE user_id = $1',
            [updatedTask.assigned_to]
          );
          if (tokensRes.rows.length > 0) {
            const { sendPWAPushNotification } = require('../config/firebaseAdmin');
            const title = `🎉 Nhiệm vụ đã hoàn thành`;
            const body = `Nhiệm vụ "${updatedTask.title}" đã được quản lý phê duyệt.`;
            const dataUrl = `/workspace/${updatedTask.workspace_id}`;
            for (const row of tokensRes.rows) {
              await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
            }
          }
        } catch (pushErr) {
          console.error('⚠️ Lỗi gửi push cho assignee khi duyệt:', pushErr.message);
        }
      })();
    }

    return res.status(200).json({ status: 'success', data: updatedTask });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi duyệt hoàn tất công việc: ' + err.message });
  }
});

// 13. POST /api/tasks/tasks/:taskId/reject — Yêu cầu làm lại (Chỉ Admin)
router.post('/tasks/:taskId/reject', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ quản trị viên mới có quyền yêu cầu làm lại công việc.' });
  }

  const taskId = parseInt(req.params.taskId);
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng nhập lý do yêu cầu chỉnh sửa.' });
  }

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ.' });
    }

    const task = taskRes.rows[0];
    const oldStatus = task.approval_status || 'waiting_approval';
    const newCount = (task.revision_count || 0) + 1;

    const result = await query(
      `UPDATE tasks 
       SET approval_status = 'revision_required', 
           status = 'in_progress',
           completed = FALSE,
           revision_note = $1,
           revision_count = $2,
           updated_at = NOW() 
       WHERE id = $3 RETURNING *`,
      [reason.trim(), newCount, taskId]
    );

    const updatedTask = result.rows[0];

    // Lấy thông tin assignees đầy đủ chuẩn hóa
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );
    updatedTask.assignees = assigneesRes.rows;

    // Lấy thông tin assignee chính
    if (updatedTask.assigned_to) {
      const userRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.assigned_to]);
      if (userRes.rows.length > 0) {
        updatedTask.assignee_name = userRes.rows[0].name;
        updatedTask.assignee_avatar = userRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động
    await logTaskActivity(taskId, user.id, 'status_changed', oldStatus, 'revision_required');
    await logTaskActivity(taskId, user.id, 'revision_note', null, reason.trim());

    // Socket realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('task_updated', updatedTask);
      io.emit('task_rejected', updatedTask);
    }

    // Gửi Push Notification cho Assignee
    if (updatedTask.assigned_to) {
      (async () => {
        try {
          const tokensRes = await query(
            'SELECT fcm_token FROM user_push_tokens WHERE user_id = $1',
            [updatedTask.assigned_to]
          );
          if (tokensRes.rows.length > 0) {
            const { sendPWAPushNotification } = require('../config/firebaseAdmin');
            const title = `⚠️ Nhiệm vụ cần chỉnh sửa`;
            const body = `Lý do: ${reason.trim()}`;
            const dataUrl = `/workspace/${updatedTask.workspace_id}`;
            for (const row of tokensRes.rows) {
              await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
            }
          }
        } catch (pushErr) {
          console.error('⚠️ Lỗi gửi push cho assignee khi từ chối:', pushErr.message);
        }
      })();
    }

    return res.status(200).json({ status: 'success', data: updatedTask });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi yêu cầu sửa lại: ' + err.message });
  }
});

module.exports = router;
