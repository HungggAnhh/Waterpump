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
    const isAssignedFilter = quick_filter === 'assigned_to_me' || !!assignee_id;
    const sortUserId = assignee_id ? parseInt(assignee_id) : user.id;

    let selectFields = `DISTINCT t.*, 
             w.name AS workspace_name,
             c.name AS creator_name, c.avatar AS creator_avatar`;

    if (isAssignedFilter) {
      // Sử dụng subquery vô cùng sạch sẽ để lấy ngày phân công của đúng người đang được lọc/sắp xếp
      // Điều này ngăn chặn việc nhân đôi dòng do JOIN một-nhiều với task_assignments
      selectFields += `, COALESCE(
        (SELECT ta_sort.created_at FROM task_assignments ta_sort WHERE ta_sort.task_id = t.id AND ta_sort.user_id = ${parseInt(sortUserId)} LIMIT 1),
        t.created_at
      ) AS assigned_at`;
    }

    let queryText = `
      SELECT ${selectFields}
      FROM tasks t 
      LEFT JOIN workspaces w ON t.workspace_id = w.id
      LEFT JOIN users c ON t.created_by = c.id
      WHERE (t.is_deleted = FALSE OR t.is_deleted IS NULL)
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Phân quyền cơ bản bằng EXISTS để tránh nhân bản dòng
    if (user.role !== 'admin') {
      queryText += ` AND (
        t.created_by = $${paramIndex} OR 
        t.assigned_to = $${paramIndex} OR 
        EXISTS (SELECT 1 FROM task_assignments ta_perm WHERE ta_perm.task_id = t.id AND ta_perm.user_id = $${paramIndex}) OR 
        EXISTS (SELECT 1 FROM workspace_members wm_perm WHERE wm_perm.workspace_id = t.workspace_id AND wm_perm.user_id = $${paramIndex})
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

    // Lọc theo người thực hiện (Sử dụng EXISTS để tránh duplicate)
    if (assignee_id) {
      queryText += ` AND (t.assigned_to = $${paramIndex} OR EXISTS (SELECT 1 FROM task_assignments ta_filt WHERE ta_filt.task_id = t.id AND ta_filt.user_id = $${paramIndex}))`;
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

    // Bộ lọc nhanh (Quick Filters) - Sử dụng EXISTS để tránh duplicate
    if (quick_filter) {
      if (quick_filter === 'my_tasks' || quick_filter === 'mine') {
        queryText += ` AND (t.assigned_to = $${paramIndex} OR EXISTS (SELECT 1 FROM task_assignments ta_q WHERE ta_q.task_id = t.id AND ta_q.user_id = $${paramIndex}) OR t.created_by = $${paramIndex})`;
        queryParams.push(user.id);
        paramIndex++;
      } else if (quick_filter === 'assigned_to_me') {
        queryText += ` AND (t.assigned_to = $${paramIndex} OR EXISTS (SELECT 1 FROM task_assignments ta_q WHERE ta_q.task_id = t.id AND ta_q.user_id = $${paramIndex}))`;
        queryParams.push(user.id);
        paramIndex++;
      } else if (quick_filter === 'created_by_me') {
        queryText += ` AND t.created_by = $${paramIndex}`;
        queryParams.push(user.id);
        paramIndex++;
      } else if (quick_filter === 'overdue') {
        queryText += ` AND t.deadline < NOW() AND (t.approval_status != 'completed' AND t.status != 'completed')`;
      } else if (quick_filter === 'due_soon') {
        queryText += ` AND t.deadline >= NOW() AND t.deadline <= NOW() + INTERVAL '3 days' AND (t.approval_status != 'completed' AND t.status != 'completed')`;
      } else if (quick_filter === 'completed') {
        queryText += ` AND (t.approval_status = 'completed' OR t.status = 'completed')`;
      }
    }

    if (isAssignedFilter) {
      queryText += ` ORDER BY assigned_at DESC, t.id DESC`;
    } else {
      queryText += ` ORDER BY t.id DESC`;
    }

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

      // Lấy lịch sử xem nhiệm vụ để tính số người đã xem
      const viewsRes = await query(
        `SELECT task_id, user_id FROM task_views WHERE task_id = ANY($1)`,
        [taskIds]
      );
      const viewsMap = {};
      viewsRes.rows.forEach(row => {
        const tId = parseInt(row.task_id);
        if (!viewsMap[tId]) viewsMap[tId] = new Set();
        viewsMap[tId].add(parseInt(row.user_id));
      });

      // Lấy số người nhận hoàn thành
      const completedRes = await query(
        `SELECT task_id, COUNT(CASE WHEN status = 'completed' THEN 1 END)::int AS completed_count
         FROM task_assignments
         WHERE task_id = ANY($1)
         GROUP BY task_id`,
        [taskIds]
      );
      const completedMap = {};
      completedRes.rows.forEach(row => {
        completedMap[parseInt(row.task_id)] = row.completed_count;
      });

      // Lấy số báo cáo của từng nhiệm vụ
      const reportsCountRes = await query(
        `SELECT task_id, COUNT(*)::int AS reports_count
         FROM task_reports
         WHERE task_id = ANY($1)
         GROUP BY task_id`,
        [taskIds]
      );
      const reportsCountMap = {};
      reportsCountRes.rows.forEach(row => {
        reportsCountMap[parseInt(row.task_id)] = row.reports_count;
      });

      // Lấy số báo cáo chưa xem của từng nhiệm vụ
      const unseenReportsCountRes = await query(
        `SELECT task_id, COUNT(*)::int AS unseen_count
         FROM task_reports
         WHERE is_seen_by_admin = FALSE AND task_id = ANY($1)
         GROUP BY task_id`,
        [taskIds]
      );
      const unseenReportsCountMap = {};
      unseenReportsCountRes.rows.forEach(row => {
        unseenReportsCountMap[parseInt(row.task_id)] = row.unseen_count;
      });

      tasks.forEach(t => {
        t.assignees = assigneesMap[t.id] || [];
        const taskViews = viewsMap[t.id] || new Set();
        
        // Tính tổng số người nhận việc duy nhất
        const uniqueAssigneeIds = new Set(t.assignees.map(a => a.user_id));
        if (t.assigned_to) {
          uniqueAssigneeIds.add(parseInt(t.assigned_to));
        }
        
        let viewedCount = 0;
        uniqueAssigneeIds.forEach(uid => {
          if (taskViews.has(uid)) {
            viewedCount++;
          }
        });
        
        t.total_assignees = uniqueAssigneeIds.size;
        t.viewed_assignees_count = viewedCount;
        t.completed_assignees_count = completedMap[t.id] || 0;
        t.total_reports_count = reportsCountMap[t.id] || 0;
        t.unseen_reports_count = unseenReportsCountMap[t.id] || 0;
      });
    }

    return res.status(200).json({ status: 'success', data: tasks });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách nhiệm vụ: ' + err.message });
  }
});

// GET /api/tasks/tasks/:taskId — Lấy chi tiết một nhiệm vụ
router.get('/tasks/:taskId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);
  if (isNaN(taskId)) {
    return res.status(400).json({ status: 'error', message: 'ID nhiệm vụ không hợp lệ.' });
  }

  try {
    let queryText = `
      SELECT t.*, 
             w.name AS workspace_name,
             c.name AS creator_name, c.avatar AS creator_avatar 
      FROM tasks t 
      LEFT JOIN workspaces w ON t.workspace_id = w.id
      LEFT JOIN users c ON t.created_by = c.id
      WHERE t.id = $1 AND (t.is_deleted = FALSE OR t.is_deleted IS NULL)
    `;

    const result = await query(queryText, [taskId]);
    const task = result.rows[0];

    if (!task) {
      return res.status(404).json({ status: 'error', message: 'Nhiệm vụ không tồn tại.' });
    }

    // Permission check for non-admin users
    if (user.role !== 'admin') {
      const accessCheck = await query(
        `SELECT 1 FROM tasks t
         LEFT JOIN task_assignments ta ON ta.task_id = t.id
         LEFT JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
         WHERE t.id = $1 AND (
           t.created_by = $2 OR
           t.assigned_to = $2 OR
           ta.user_id = $2 OR
           wm.user_id = $2
         )`,
        [taskId, user.id]
      );
      if (accessCheck.rows.length === 0) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem nhiệm vụ này.' });
      }
    }

    // Load assignees
    const assigneesRes = await query(
      `SELECT ta.task_id, ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );

    task.assignees = assigneesRes.rows.map(row => ({
      user_id: row.user_id,
      status: row.status,
      started_at: row.started_at,
      completed_at: row.completed_at,
      name: row.name,
      avatar: row.avatar,
      avatar_url: row.avatar_url
    }));

    // Load views
    const viewsRes = await query(
      `SELECT user_id FROM task_views WHERE task_id = $1`,
      [taskId]
    );
    const taskViews = new Set(viewsRes.rows.map(row => parseInt(row.user_id)));

    // Load reports count
    const reportsRes = await query(
      `SELECT COUNT(*)::int AS reports_count FROM task_reports WHERE task_id = $1`,
      [taskId]
    );
    task.total_reports_count = reportsRes.rows[0]?.reports_count || 0;

    // Calculate totals
    const uniqueAssigneeIds = new Set(task.assignees.map(a => a.user_id));
    if (task.assigned_to) {
      uniqueAssigneeIds.add(parseInt(task.assigned_to));
    }

    let viewedCount = 0;
    uniqueAssigneeIds.forEach(uid => {
      if (taskViews.has(uid)) {
        viewedCount++;
      }
    });

    task.total_assignees = uniqueAssigneeIds.size;
    task.viewed_assignees_count = viewedCount;
    task.completed_assignees_count = task.assignees.filter(a => a.status === 'completed').length;

    return res.status(200).json({ status: 'success', data: task });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi lấy chi tiết nhiệm vụ: ' + err.message });
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
    const statsSubquery = `
      SELECT 
        workspace_id,
        COUNT(CASE WHEN COALESCE(approval_status, '') != 'completed' AND COALESCE(status, '') != 'completed' THEN 1 END)::int AS total,
        COUNT(CASE WHEN approval_status = 'completed' OR status = 'completed' THEN 1 END)::int AS completed,
        COUNT(CASE WHEN approval_status = 'pending' OR approval_status IS NULL THEN 1 END)::int AS pending,
        COUNT(CASE WHEN approval_status = 'in_progress' THEN 1 END)::int AS in_progress,
        COUNT(CASE WHEN approval_status = 'waiting_approval' THEN 1 END)::int AS waiting_approval,
        COUNT(CASE WHEN approval_status = 'revision_required' THEN 1 END)::int AS revision_required
      FROM tasks
      WHERE is_deleted = FALSE OR is_deleted IS NULL
      GROUP BY workspace_id
    `;

    if (user.role === 'admin') {
      result = await query(`
        SELECT 
          w.*,
          COALESCE(ts.total, 0)::int AS total_tasks,
          COALESCE(ts.completed, 0)::int AS completed_tasks,
          COALESCE(ts.pending, 0)::int AS pending_tasks,
          COALESCE(ts.in_progress, 0)::int AS in_progress_tasks,
          COALESCE(ts.waiting_approval, 0)::int AS waiting_approval_tasks,
          COALESCE(ts.revision_required, 0)::int AS revision_required_tasks
        FROM workspaces w
        LEFT JOIN (${statsSubquery}) ts ON w.id = ts.workspace_id
        ORDER BY w.id ASC
      `);
    } else {
      // User thường chỉ thấy trang họ được gán làm thành viên (trong workspace_members) hoặc có task gán cho họ
      result = await query(`
        WITH user_workspaces AS (
          SELECT DISTINCT w.id, w.name, w.created_by, w.created_at
          FROM workspaces w
          LEFT JOIN tasks t ON t.workspace_id = w.id AND t.assigned_to = $1
          LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
          WHERE t.assigned_to = $1 OR wm.user_id = $1
        )
        SELECT 
          uw.*,
          COALESCE(ts.total, 0)::int AS total_tasks,
          COALESCE(ts.completed, 0)::int AS completed_tasks,
          COALESCE(ts.pending, 0)::int AS pending_tasks,
          COALESCE(ts.in_progress, 0)::int AS in_progress_tasks,
          COALESCE(ts.waiting_approval, 0)::int AS waiting_approval_tasks,
          COALESCE(ts.revision_required, 0)::int AS revision_required_tasks
        FROM user_workspaces uw
        LEFT JOIN (${statsSubquery}) ts ON uw.id = ts.workspace_id
        ORDER BY uw.id ASC
      `, [user.id]);
    }

    const mappedWorkspaces = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      created_by: row.created_by,
      created_at: row.created_at,
      task_stats: {
        total: row.total_tasks || 0,
        completed: row.completed_tasks || 0,
        pending: row.pending_tasks || 0,
        in_progress: row.in_progress_tasks || 0,
        waiting_approval: row.waiting_approval_tasks || 0,
        revision_required: row.revision_required_tasks || 0
      }
    }));

    return res.status(200).json({ status: 'success', data: mappedWorkspaces });
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
        created_at: createdMsg.created_at,
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

    // Kiểm tra đồng bộ trạng thái task tổng khi có thay đổi trạng thái phân công
    const assigneesStatusRes = await query(
      'SELECT status FROM task_assignments WHERE task_id = $1',
      [taskId]
    );
    const totalAssigneesCount = assigneesStatusRes.rows.length;
    const completedAssigneesCountVal = assigneesStatusRes.rows.filter(a => a.status === 'completed').length;

    if (completedAssigneesCountVal === totalAssigneesCount && totalAssigneesCount > 0) {
      await query(
        `UPDATE tasks 
         SET status = 'completed', approval_status = 'completed', completed = TRUE, completed_at = NOW(), updated_at = NOW() 
         WHERE id = $1`,
        [taskId]
      );
    } else {
      const currentTaskStatusRes = await query('SELECT status FROM tasks WHERE id = $1', [taskId]);
      if (currentTaskStatusRes.rows[0]?.status === 'completed' && completedAssigneesCountVal < totalAssigneesCount) {
        await query(
          `UPDATE tasks 
           SET status = 'in_progress', approval_status = 'in_progress', completed = FALSE, completed_at = NULL, updated_at = NOW() 
           WHERE id = $1`,
          [taskId]
        );
      }
    }

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
      if (status === 'in_progress') {
        io.emit('task_started', { taskId, user_id: user.id, userName: user.name, title: task.title });
      }
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
        created_at: sysMsg.created_at,
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
        io.emit('task_completed', { ...updatedTask, completed_by_name: user.name });
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
    let viewedRes;
    let assignmentStatsRes;
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
      viewedRes = await query(`
        SELECT COUNT(DISTINCT t.id)::int AS viewed
        FROM tasks t
        JOIN task_views tv ON t.id = tv.task_id
        WHERE (t.is_deleted = FALSE OR t.is_deleted IS NULL)
      `);
      assignmentStatsRes = await query(`
        SELECT 
          COUNT(*)::int AS total_assignments,
          COUNT(CASE WHEN EXISTS (
            SELECT 1 FROM task_views tv 
            WHERE tv.task_id = ta.task_id AND tv.user_id = ta.user_id
          ) THEN 1 END)::int AS viewed_assignments,
          COUNT(CASE WHEN EXISTS (
            SELECT 1 FROM task_reports tr 
            WHERE tr.task_id = ta.task_id AND tr.user_id = ta.user_id
          ) THEN 1 END)::int AS reported_assignments,
          COUNT(CASE WHEN ta.status = 'in_progress' THEN 1 END)::int AS in_progress_assignments,
          COUNT(CASE WHEN ta.status = 'completed' THEN 1 END)::int AS completed_assignments
        FROM task_assignments ta
        JOIN tasks t ON ta.task_id = t.id
        WHERE t.is_deleted = FALSE OR t.is_deleted IS NULL
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
      viewedRes = await query(`
        SELECT COUNT(DISTINCT t.id)::int AS viewed
        FROM tasks t
        JOIN task_views tv ON t.id = tv.task_id
        WHERE (t.is_deleted = FALSE OR t.is_deleted IS NULL)
          AND (
            t.created_by = $1 OR 
            t.assigned_to = $1 OR 
            EXISTS (
              SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id AND ta.user_id = $1
            ) OR
            EXISTS (
              SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = t.workspace_id AND wm.user_id = $1
            )
          )
      `, [user.id]);
      assignmentStatsRes = await query(`
        SELECT 
          COUNT(*)::int AS total_assignments,
          COUNT(CASE WHEN EXISTS (
            SELECT 1 FROM task_views tv 
            WHERE tv.task_id = ta.task_id AND tv.user_id = ta.user_id
          ) THEN 1 END)::int AS viewed_assignments,
          COUNT(CASE WHEN EXISTS (
            SELECT 1 FROM task_reports tr 
            WHERE tr.task_id = ta.task_id AND tr.user_id = ta.user_id
          ) THEN 1 END)::int AS reported_assignments,
          COUNT(CASE WHEN ta.status = 'in_progress' THEN 1 END)::int AS in_progress_assignments,
          COUNT(CASE WHEN ta.status = 'completed' THEN 1 END)::int AS completed_assignments
        FROM task_assignments ta
        JOIN tasks t ON ta.task_id = t.id
        WHERE (t.is_deleted = FALSE OR t.is_deleted IS NULL)
          AND (
            t.created_by = $1 OR 
            t.assigned_to = $1 OR 
            EXISTS (
              SELECT 1 FROM task_assignments ta2 WHERE ta2.task_id = t.id AND ta2.user_id = $1
            ) OR
            EXISTS (
              SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = t.workspace_id AND wm.user_id = $1
            )
          )
      `, [user.id]);
    }

    const row = result.rows[0];
    const total = row.total || 0;
    const completed = row.completed || 0;
    const completion_rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const viewed = viewedRes.rows[0]?.viewed || 0;

    const assRow = assignmentStatsRes.rows[0] || {
      total_assignments: 0,
      viewed_assignments: 0,
      reported_assignments: 0,
      in_progress_assignments: 0,
      completed_assignments: 0
    };

    // Thống kê bổ sung cho tính năng "Việc giao cho tôi"
    const assignedToMeRes = await query(`
      SELECT 
        COUNT(DISTINCT t.id)::int AS total,
        COUNT(DISTINCT CASE WHEN (t.approval_status = 'completed' OR t.status = 'completed') THEN t.id END)::int AS completed,
        COUNT(DISTINCT CASE WHEN (t.approval_status != 'completed' AND t.status != 'completed') AND t.deadline < NOW() THEN t.id END)::int AS overdue,
        COUNT(DISTINCT CASE WHEN (t.approval_status != 'completed' AND t.status != 'completed') AND (t.deadline >= NOW() AND t.deadline <= NOW() + INTERVAL '3 days') THEN t.id END)::int AS due_soon,
        COUNT(DISTINCT CASE WHEN (t.approval_status != 'completed' AND t.status != 'completed') AND (t.approval_status IN ('in_progress', 'waiting_approval', 'revision_required') OR t.status = 'in_progress') AND (t.deadline IS NULL OR t.deadline > NOW() + INTERVAL '3 days') THEN t.id END)::int AS in_progress,
        COUNT(DISTINCT CASE WHEN tv.task_id IS NULL THEN t.id END)::int AS unread_assigned_count
      FROM tasks t
      LEFT JOIN task_assignments ta ON ta.task_id = t.id
      LEFT JOIN task_views tv ON tv.task_id = t.id AND tv.user_id = $1
      WHERE (t.is_deleted = FALSE OR t.is_deleted IS NULL)
        AND (t.assigned_to = $1 OR ta.user_id = $1)
    `, [user.id]);

    const createdByMeRes = await query(`
      SELECT COUNT(*)::int AS total
      FROM tasks t
      WHERE (t.is_deleted = FALSE OR t.is_deleted IS NULL)
        AND t.created_by = $1
    `, [user.id]);

    const assignedToMeStats = assignedToMeRes.rows[0] || { total: 0, completed: 0, overdue: 0, due_soon: 0, in_progress: 0, unread_assigned_count: 0 };
    const createdByMeStats = createdByMeRes.rows[0] || { total: 0 };

    const statsData = {
      total,
      pending: row.pending || 0,
      in_progress: row.in_progress || 0,
      waiting_approval: row.waiting_approval || 0,
      revision_required: row.revision_required || 0,
      completed,
      completion_rate,
      viewed,
      total_assignments: assRow.total_assignments || 0,
      viewed_assignments: assRow.viewed_assignments || 0,
      reported_assignments: assRow.reported_assignments || 0,
      unreported_assignments: (assRow.total_assignments || 0) - (assRow.reported_assignments || 0),
      in_progress_assignments: assRow.in_progress_assignments || 0,
      completed_assignments: assRow.completed_assignments || 0,
      
      // Tính năng mới "Việc giao cho tôi"
      assigned_to_me: {
        total: assignedToMeStats.total || 0,
        in_progress: assignedToMeStats.in_progress || 0,
        overdue: assignedToMeStats.overdue || 0,
        due_soon: assignedToMeStats.due_soon || 0,
        completed: assignedToMeStats.completed || 0,
        unread_assigned_count: assignedToMeStats.unread_assigned_count || 0
      },
      created_by_me: {
        total: createdByMeStats.total || 0
      },
      overdue: assignedToMeStats.overdue || 0,
      user_completed: assignedToMeStats.completed || 0
    };

    return res.status(200).json({ status: 'success', data: statsData });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Lỗi tính toán thống kê: ' + err.message });
  }
});

// POST /api/tasks/tasks/:taskId/urge — Hối thúc nhiệm vụ (chỉ Admin hoặc người giao)
router.post('/tasks/:taskId/urge', async (req, res) => {
  console.log('URGE_ROUTE_CALLED');
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);
  const { interval, target = 'not_viewed' } = req.body; // 'now' | 'hourly' | 'daily' | 'off'

  if (!interval || !['now', 'hourly', 'daily', 'off'].includes(interval)) {
    return res.status(400).json({ status: 'error', message: 'Lựa chọn hối thúc không hợp lệ.' });
  }

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1 AND is_deleted = FALSE', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ hoặc nhiệm vụ đã bị xóa.' });
    }

    const task = taskRes.rows[0];

    // Quyền hối thúc: Admin hoặc Người tạo nhiệm vụ
    if (user.role !== 'admin' && task.created_by !== user.id) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền hối thúc nhiệm vụ này.' });
    }

    // Tìm tất cả người nhận việc của nhiệm vụ này
    const assigneesRes = await query(
      'SELECT user_id, status FROM task_assignments WHERE task_id = $1',
      [taskId]
    );
    const assigneesList = assigneesRes.rows;
    const assigneeIds = assigneesList.map(a => a.user_id);
    if (task.assigned_to && !assigneeIds.includes(task.assigned_to)) {
      assigneeIds.push(task.assigned_to);
      assigneesList.push({ user_id: task.assigned_to, status: 'todo' });
    }

    let assignedTo = task.assigned_to;

    // Tự động gán nếu trống
    if (assigneeIds.length === 0) {
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
        assigneeIds.push(assignedTo);
        assigneesList.push({ user_id: assignedTo, status: 'todo' });
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
          assigneeIds.push(assignedTo);
          assigneesList.push({ user_id: assignedTo, status: 'todo' });
        }
      }
    }

    if (assigneeIds.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Nhiệm vụ này chưa được gán cho ai và Trang này chưa có thành viên thường nào để tự động gán.' });
    }

    // Lọc danh sách người nhận theo yêu cầu (target)
    let filteredIds = [...assigneeIds];
    if (target === 'not_viewed') {
      const viewsRes = await query('SELECT user_id FROM task_views WHERE task_id = $1', [taskId]);
      const viewedIds = new Set(viewsRes.rows.map(v => parseInt(v.user_id)));
      filteredIds = assigneeIds.filter(uid => !viewedIds.has(parseInt(uid)));
    } else if (target === 'not_started') {
      // Chưa bắt đầu: status in task_assignments is 'todo' hoặc 'pending'
      filteredIds = assigneesList
        .filter(a => a.status !== 'in_progress' && a.status !== 'completed')
        .map(a => a.user_id);
    } else if (target === 'in_progress') {
      // Đang thực hiện
      filteredIds = assigneesList
        .filter(a => a.status === 'in_progress')
        .map(a => a.user_id);
    } else if (target === 'waiting_approval') {
      // Chờ duyệt
      if (task.approval_status === 'waiting_approval') {
        filteredIds = assigneesList
          .filter(a => a.status === 'completed')
          .map(a => a.user_id);
      } else {
        filteredIds = [];
      }
    } else if (target === 'not_reported') {
      // Chưa báo cáo: tìm các assignees chưa có bất kỳ báo cáo nào trong task_reports
      const reportsRes = await query('SELECT DISTINCT user_id FROM task_reports WHERE task_id = $1', [taskId]);
      const reportedIds = new Set(reportsRes.rows.map(r => parseInt(r.user_id)));
      filteredIds = assigneeIds.filter(uid => !reportedIds.has(parseInt(uid)));
    }

    // Nếu không tìm thấy người nào thoả mãn bộ lọc, trả về thông báo thành công nhưng không cần gửi push/socket
    if (filteredIds.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'Không tìm thấy người nhận nào phù hợp với điều kiện hối thúc để gửi thông báo.',
        data: task
      });
    }

    // Lấy FCM tokens của các assignees được lọc
    const tokensRes = await query(
      'SELECT user_id, fcm_token FROM user_push_tokens WHERE user_id = ANY($1)',
      [filteredIds]
    );

    const { sendPWAPushNotification } = require('../config/firebaseAdmin');
    const io = req.app.get('io');

    if (interval === 'now') {
      // Gửi Push Notification khẩn cấp
      if (tokensRes.rows.length > 0) {
        const title = `⚡ [HỐI THÚC KHẨN CẤP]`;
        const body = `Sếp đang hối thúc bạn thực hiện nhiệm vụ gấp: "${task.title}"`;
        const dataUrl = `/workspace/${task.workspace_id}`;
        for (const row of tokensRes.rows) {
          await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
        }
        console.log('PUSH_SENT');
      }

      // Phát sự kiện hối thúc qua Socket.IO tới từng người nhận online
      if (io) {
        filteredIds.forEach(recipientId => {
          io.to(`user_${recipientId}`).emit('task_urged', {
            task_id: taskId,
            message: `⚡ Sếp đang hối thúc bạn thực hiện nhiệm vụ gấp: "${task.title}"`,
            task
          });
        });
        console.log('TASK_URGED_SOCKET_SENT');
      }

      return res.status(200).json({
        status: 'success',
        message: 'Đã gửi thông báo hối thúc khẩn cấp thành công!'
      });
    }

    // Thiết lập chế độ nhắc nhở hối thúc định kỳ
    let dbInterval = null;
    if (interval === 'hourly') dbInterval = 'hourly';
    if (interval === 'daily') dbInterval = 'daily';

    await query(
      'UPDATE tasks SET reminder_interval = $1, last_reminded_at = NULL, updated_at = NOW() WHERE id = $2',
      [dbInterval, taskId]
    );

    // Lấy lại task đầy đủ sau khi đã cập nhật
    const updatedTaskRes = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    const updatedTask = updatedTaskRes.rows[0];

    // Lấy thông tin assignees đầy đủ
    const fullAssigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar, u.avatar AS avatar_url
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );
    updatedTask.assignees = fullAssigneesRes.rows;

    if (updatedTask.assigned_to) {
      const uRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.assigned_to]);
      if (uRes.rows.length > 0) {
        updatedTask.assignee_name = uRes.rows[0].name;
        updatedTask.assignee_avatar = uRes.rows[0].avatar;
      }
    }
    if (updatedTask.created_by) {
      const creatorRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.created_by]);
      if (creatorRes.rows.length > 0) {
        updatedTask.creator_name = creatorRes.rows[0].name;
        updatedTask.creator_avatar = creatorRes.rows[0].avatar;
      }
    }

    // Gửi thông báo đẩy báo trước chế độ định kỳ
    if (dbInterval && tokensRes.rows.length > 0) {
      const reminderText = dbInterval === 'hourly' ? 'mỗi giờ' : 'mỗi ngày';
      const title = `⏰ Đặt nhắc nhở hối thúc`;
      const body = `Sếp đã bật chế độ hối thúc công việc này [${reminderText}] cho đến khi hoàn tất: "${task.title}"`;
      const dataUrl = `/workspace/${task.workspace_id}`;
      for (const row of tokensRes.rows) {
        await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
      }
      console.log('PUSH_SENT');
    }

    // Phát sự kiện realtime
    if (io) {
      if (dbInterval) {
        filteredIds.forEach(recipientId => {
          io.to(`user_${recipientId}`).emit('task_urged', {
            task_id: taskId,
            message: `⏰ Sếp đã bật chế độ hối thúc công việc này [${dbInterval === 'hourly' ? 'mỗi giờ' : 'mỗi ngày'}]: "${task.title}"`,
            task: updatedTask
          });
        });
      }
      io.emit('task_updated', updatedTask);
      console.log('TASK_URGED_SOCKET_SENT');
    }

    const msgMap = {
      hourly: 'Đã thiết lập nhắc nhở hối thúc mỗi giờ.',
      daily: 'Đã thiết lập nhắc nhở hối thúc mỗi ngày.',
      off: 'Đã tắt chế độ nhắc nhở hối thúc công việc này.'
    };

    return res.status(200).json({
      status: 'success',
      message: msgMap[interval],
      data: updatedTask
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
    // 1. Lấy hoạt động thông thường
    const actRes = await query(
      `SELECT ta.*, u.name AS user_name, u.avatar AS user_avatar, u.role AS user_role
       FROM task_activities ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );

    // 2. Lấy lượt xem nhiệm vụ
    const viewsRes = await query(
      `SELECT tv.id, tv.task_id, tv.user_id, tv.first_viewed_at AS created_at,
              u.name AS user_name, u.avatar AS user_avatar, u.role AS user_role
       FROM task_views tv
       JOIN users u ON tv.user_id = u.id
       WHERE tv.task_id = $1`,
      [taskId]
    );

    // 3. Lấy bình luận nhiệm vụ
    const commentsRes = await query(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.created_at,
              u.name AS user_name, u.avatar AS user_avatar, u.role AS user_role
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = $1`,
      [taskId]
    );

    // 4. Lấy báo cáo tiến độ nhiệm vụ
    const reportsRes = await query(
      `SELECT tr.id, tr.task_id, tr.user_id, tr.report_type, tr.content, tr.progress_percent, tr.created_at,
              u.name AS user_name, u.avatar AS user_avatar, u.role AS user_role
       FROM task_reports tr
       JOIN users u ON tr.user_id = u.id
       WHERE tr.task_id = $1`,
      [taskId]
    );

    // Chuẩn hóa và gộp tất cả
    const activities = [
      ...actRes.rows,
      ...viewsRes.rows.map(v => ({
        id: `view-${v.id}`,
        task_id: v.task_id,
        user_id: v.user_id,
        action: 'viewed',
        old_value: null,
        new_value: null,
        created_at: v.created_at,
        user_name: v.user_name,
        user_avatar: v.user_avatar,
        user_role: v.user_role
      })),
      ...commentsRes.rows.map(c => ({
        id: `comment-${c.id}`,
        task_id: c.task_id,
        user_id: c.user_id,
        action: 'commented',
        old_value: null,
        new_value: null,
        created_at: c.created_at,
        user_name: c.user_name,
        user_avatar: c.user_avatar,
        user_role: c.user_role
      })),
      ...reportsRes.rows.map(r => ({
        id: `report-${r.id}`,
        task_id: r.task_id,
        user_id: r.user_id,
        action: 'progress_reported',
        old_value: r.report_type,
        new_value: `${r.progress_percent}%: ${r.content}`,
        created_at: r.created_at,
        user_name: r.user_name,
        user_avatar: r.user_avatar,
        user_role: r.user_role
      }))
    ];

    // Sắp xếp theo thứ tự thời gian mới nhất lên đầu (descending)
    activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ status: 'success', data: activities });
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

    // Lấy thêm thông tin creator
    if (updatedTask.created_by) {
      const creatorRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.created_by]);
      if (creatorRes.rows.length > 0) {
        updatedTask.creator_name = creatorRes.rows[0].name;
        updatedTask.creator_avatar = creatorRes.rows[0].avatar;
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

    // Lấy thêm thông tin creator
    if (updatedTask.created_by) {
      const creatorRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.created_by]);
      if (creatorRes.rows.length > 0) {
        updatedTask.creator_name = creatorRes.rows[0].name;
        updatedTask.creator_avatar = creatorRes.rows[0].avatar;
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

    // Lấy thêm thông tin creator
    if (updatedTask.created_by) {
      const creatorRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.created_by]);
      if (creatorRes.rows.length > 0) {
        updatedTask.creator_name = creatorRes.rows[0].name;
        updatedTask.creator_avatar = creatorRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động
    await logTaskActivity(taskId, user.id, 'status_changed', oldStatus, 'completed');
    await logTaskActivity(taskId, user.id, 'reviewed', 'false', 'true');

    // Socket realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('task_updated', updatedTask);
      io.emit('task_approved', { ...updatedTask, approved_by_name: user.name });
      io.emit('task_completed', { ...updatedTask, completed_by_name: user.name });
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

    // Lấy thêm thông tin creator
    if (updatedTask.created_by) {
      const creatorRes = await query('SELECT name, avatar FROM users WHERE id = $1', [updatedTask.created_by]);
      if (creatorRes.rows.length > 0) {
        updatedTask.creator_name = creatorRes.rows[0].name;
        updatedTask.creator_avatar = creatorRes.rows[0].avatar;
      }
    }

    // Ghi log hoạt động
    await logTaskActivity(taskId, user.id, 'status_changed', oldStatus, 'revision_required');
    await logTaskActivity(taskId, user.id, 'revision_note', null, reason.trim());

    // Socket realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('task_updated', updatedTask);
      io.emit('task_rejected', { ...updatedTask, rejected_by_name: user.name });
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

// POST /api/tasks/tasks/:taskId/view — Ghi nhận lượt xem nhiệm vụ
router.post('/tasks/:taskId/view', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    // Kiểm tra nhiệm vụ tồn tại
    const taskRes = await query('SELECT id FROM tasks WHERE id = $1 AND is_deleted = FALSE', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ.' });
    }

    const checkRes = await query(
      'SELECT id FROM task_views WHERE task_id = $1 AND user_id = $2',
      [taskId, user.id]
    );

    let viewedAt;
    if (checkRes.rows.length === 0) {
      const insertRes = await query(
        `INSERT INTO task_views (task_id, user_id, first_viewed_at, last_viewed_at)
         VALUES ($1, $2, NOW(), NOW()) RETURNING first_viewed_at`,
        [taskId, user.id]
      );
      viewedAt = insertRes.rows[0].first_viewed_at;
    } else {
      const updateRes = await query(
        `UPDATE task_views SET last_viewed_at = NOW() WHERE task_id = $1 AND user_id = $2 RETURNING last_viewed_at`,
        [taskId, user.id]
      );
      viewedAt = updateRes.rows[0].last_viewed_at;
    }

    // Phát sự kiện realtime
    const io = req.app.get('io');
    if (io) {
      io.emit('task_viewed', { taskId, userId: user.id, userName: user.name });
    }

    return res.status(200).json({
      success: true,
      viewed_at: viewedAt
    });
  } catch (err) {
    console.error('❌ Lỗi ghi nhận lượt xem nhiệm vụ:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi hệ thống khi ghi nhận lượt xem: ' + err.message });
  }
});

// GET /api/tasks/tasks/:taskId/recipients — Lấy danh sách người nhận và chi tiết trạng thái xem
router.get('/tasks/:taskId/recipients', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1 AND is_deleted = FALSE', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ.' });
    }
    const task = taskRes.rows[0];

    // Lấy phân công trong task_assignments
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status AS assignment_status, ta.started_at, ta.completed_at,
              u.name, u.avatar, u.role
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );

    let list = assigneesRes.rows;
    const assignedToId = task.assigned_to ? parseInt(task.assigned_to) : null;
    if (assignedToId && !list.some(item => parseInt(item.user_id) === assignedToId)) {
      const primaryRes = await query(
        'SELECT id AS user_id, name, avatar, role FROM users WHERE id = $1',
        [assignedToId]
      );
      if (primaryRes.rows.length > 0) {
        list.push({
          ...primaryRes.rows[0],
          assignment_status: 'todo',
          started_at: null,
          completed_at: null
        });
      }
    }

    // Lấy thông tin xem nhiệm vụ
    const viewsRes = await query(
      'SELECT user_id, first_viewed_at, last_viewed_at FROM task_views WHERE task_id = $1',
      [taskId]
    );
    const viewsMap = {};
    viewsRes.rows.forEach(v => {
      viewsMap[parseInt(v.user_id)] = v;
    });

    // Lấy thông tin số lượng báo cáo và thời gian hoạt động cuối cùng của từng người nhận
    const reportsRes = await query(
      `SELECT user_id, COUNT(*)::int AS reports_count, MAX(created_at) AS last_report_at
       FROM task_reports
       WHERE task_id = $1
       GROUP BY user_id`,
      [taskId]
    );
    const reportsMap = {};
    reportsRes.rows.forEach(r => {
      reportsMap[parseInt(r.user_id)] = {
        reports_count: r.reports_count,
        last_report_at: r.last_report_at
      };
    });

    let viewedCount = 0;
    let inProgressCount = 0;
    let waitingApprovalCount = 0;
    let completedCount = 0;

    const users = list.map(item => {
      const userId = parseInt(item.user_id);
      const viewRecord = viewsMap[userId];
      const reportRecord = reportsMap[userId];
      const viewed = !!viewRecord;
      if (viewed) viewedCount++;

      // Số báo cáo và thời gian hoạt động cuối cùng
      const reports_count = reportRecord ? reportRecord.reports_count : 0;
      let last_active_at = null;

      const viewTime = viewRecord ? new Date(viewRecord.last_viewed_at).getTime() : 0;
      const reportTime = reportRecord && reportRecord.last_report_at ? new Date(reportRecord.last_report_at).getTime() : 0;
      const maxTime = Math.max(viewTime, reportTime);
      if (maxTime > 0) {
        last_active_at = new Date(maxTime).toISOString();
      }

      // Xác định trạng thái chi tiết của assignee
      let status = 'not_viewed';
      if (item.assignment_status === 'completed') {
        if (task.approval_status === 'completed') {
          status = 'completed';
          completedCount++;
        } else if (task.approval_status === 'waiting_approval') {
          status = 'waiting_approval';
          waitingApprovalCount++;
        } else if (task.approval_status === 'revision_required') {
          status = 'revision_required';
          inProgressCount++;
        } else {
          status = 'completed';
          completedCount++;
        }
      } else if (item.assignment_status === 'in_progress') {
        status = 'in_progress';
        inProgressCount++;
      } else {
        if (viewed) {
          status = 'viewed';
        } else {
          status = 'not_viewed';
        }
      }

      return {
        id: userId,
        name: item.name,
        avatar: item.avatar,
        viewed,
        first_viewed_at: viewRecord ? viewRecord.first_viewed_at : null,
        last_viewed_at: viewRecord ? viewRecord.last_viewed_at : null,
        status,
        reports_count,
        last_active_at
      };
    });

    const notViewedCount = users.length - viewedCount;

    return res.status(200).json({
      success: true,
      data: {
        total: users.length,
        viewed: viewedCount,
        not_viewed: notViewedCount,
        in_progress: inProgressCount,
        waiting_approval: waitingApprovalCount,
        completed: completedCount,
        users
      }
    });
  } catch (err) {
    console.error('❌ Lỗi API lấy người nhận nhiệm vụ:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi hệ thống khi lấy thông tin người nhận: ' + err.message });
  }
});

// POST /api/tasks/tasks/:taskId/reports — Tạo báo cáo mới
router.post('/tasks/:taskId/reports', async (req, res) => {
  const user = getAuthUser(req);
  console.log('[REPORTS_API:AUTH] Request received. user =', user);
  if (user) {
    console.log('[REPORTS_API:AUTH] Authenticated User ID =', user.id);
  }

  if (!user) {
    console.warn('[REPORTS_API:UNAUTHORIZED] 401 Unauthorized - Authentication failed');
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng (401 Unauthorized).' });
  }

  const taskId = parseInt(req.params.taskId);
  const { report_type = 'progress', content, progress_percent = 0, attachments = [] } = req.body;
  console.log('[REPORTS_API:BODY] taskId =', taskId, 'body =', { report_type, content, progress_percent, attachments });

  if (!content || !content.trim()) {
    return res.status(400).json({ status: 'error', message: 'Nội dung báo cáo không được để trống.' });
  }

  if (!['progress', 'issue', 'material_request', 'completion'].includes(report_type)) {
    return res.status(400).json({ status: 'error', message: 'Loại báo cáo không hợp lệ.' });
  }

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1 AND is_deleted = FALSE', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ.' });
    }

    const task = taskRes.rows[0];

    // Kiểm tra xem user có được giao nhiệm vụ này không
    const checkAssignment = await query(
      'SELECT 1 FROM task_assignments WHERE task_id = $1 AND user_id = $2',
      [taskId, user.id]
    );
    const isAssigned = checkAssignment.rows.length > 0 || task.assigned_to === user.id;
    if (user.role !== 'admin' && !isAssigned) {
      console.warn(`[REPORTS_API:FORBIDDEN] 403 Forbidden - User ID ${user.id} has no permission for task ${taskId}`);
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền gửi báo cáo cho nhiệm vụ này' });
    }

    // Nếu chưa có dòng phân công trong task_assignments (ví dụ là primary assignee cũ), tự chèn vào
    if (checkAssignment.rows.length === 0 && task.assigned_to === user.id) {
      await query(
        `INSERT INTO task_assignments (task_id, user_id, status, assigned_by)
         VALUES ($1, $2, 'todo', $3) ON CONFLICT DO NOTHING`,
        [taskId, user.id, task.created_by]
      );
    }

    // Thêm báo cáo vào CSDL
    const attachmentsJson = JSON.stringify(attachments);
    const dailyReportDate = new Date().toISOString().slice(0, 10); // Format YYYY-MM-DD

    const reportInsertRes = await query(
      `INSERT INTO task_reports (task_id, user_id, report_type, content, progress_percent, attachments, daily_report_date, is_seen_by_admin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       RETURNING *`,
      [taskId, user.id, report_type, content.trim(), parseInt(progress_percent), attachmentsJson, dailyReportDate]
    );

    const report = reportInsertRes.rows[0];

    // Ghi log hoạt động
    await logTaskActivity(taskId, user.id, 'progress_reported', report_type, `${progress_percent}%: ${content.trim()}`);

    // Cập nhật trạng thái phân công của người báo cáo
    if (report_type === 'completion') {
      await query(
        `UPDATE task_assignments 
         SET status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE task_id = $1 AND user_id = $2`,
        [taskId, user.id]
      );
    } else {
      // Nếu gửi các báo cáo khác, tự động cập nhật status sang 'in_progress' nếu nó đang là 'todo'
      await query(
        `UPDATE task_assignments 
         SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
         WHERE task_id = $1 AND user_id = $2 AND status = 'todo'`,
        [taskId, user.id]
      );
    }

    // Lấy thông tin assignees đầy đủ để trả về và check hoàn thành task tổng
    const assigneesRes = await query(
      `SELECT ta.user_id, ta.status, ta.started_at, ta.completed_at, u.name, u.avatar
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [taskId]
    );
    const assignees = assigneesRes.rows;

    const totalAssignees = assignees.length;
    const completedAssigneesCount = assignees.filter(a => a.status === 'completed').length;

    let updatedTask = task;
    if (completedAssigneesCount === totalAssignees && totalAssignees > 0) {
      const taskUpdateRes = await query(
        `UPDATE tasks 
         SET status = 'completed', approval_status = 'completed', completed = TRUE, completed_at = NOW(), updated_at = NOW() 
         WHERE id = $1 RETURNING *`,
        [taskId]
      );
      updatedTask = taskUpdateRes.rows[0];
    } else {
      // Nếu gửi completion report nhưng chưa hoàn thành hết, hãy chắc chắn task_status không chuyển thành completed
      // Trừ khi task tổng đã completed trước đó, nhưng ta giữ nguyên status hoặc chuyển sang in_progress nếu chưa xong
      if (task.status === 'completed' && completedAssigneesCount < totalAssignees) {
        const taskUpdateRes = await query(
          `UPDATE tasks 
           SET status = 'in_progress', approval_status = 'in_progress', completed = FALSE, completed_at = NULL, updated_at = NOW() 
           WHERE id = $1 RETURNING *`,
          [taskId]
        );
        updatedTask = taskUpdateRes.rows[0];
      }
    }

    // Chuẩn bị payload socket/realtime
    const io = req.app.get('io');
    if (io) {
      const socketPayload = {
        taskId,
        taskTitle: task.title,
        reporterId: user.id,
        reporterName: user.name || 'Thành viên',
        workspaceId: task.workspace_id,
        createdAt: report.created_at,
        taskCreatorId: task.created_by
      };
      io.emit('task_report_created', socketPayload);
      if (task.conversation_id) {
        io.to(`room_${task.conversation_id}`).emit('task_report_created', socketPayload);
      }
      io.emit('task_updated', { id: taskId, user_id: user.id, status: updatedTask.status, assignees });

      if (report_type === 'completion') {
        io.emit('task_completed', { id: taskId, user_id: user.id, userName: user.name, completed_by_name: user.name, title: task.title });
      }
    }

    // Trigger push notification cho những người liên quan (ví dụ sếp hoặc assignees khác)
    try {
      const userRes = await query('SELECT name FROM users WHERE id = $1', [user.id]);
      const userName = userRes.rows[0]?.name || 'Thành viên';
      
      let typeText = 'báo cáo tiến độ';
      if (report_type === 'issue') typeText = 'báo cáo sự cố ⚠️';
      if (report_type === 'material_request') typeText = 'báo cáo thiếu vật tư 📦';
      if (report_type === 'completion') typeText = 'báo cáo hoàn thành ✅';

      const pushMessage = `📢 ${userName} đã gửi ${typeText}: "${content.substring(0, 40)}${content.length > 40 ? '...' : ''}" cho công việc "${task.title}"`;
      
      // Gửi cho người tạo nhiệm vụ nếu không phải chính mình
      const recipientsToNotify = [];
      if (task.created_by && task.created_by !== user.id) {
        recipientsToNotify.push(task.created_by);
      }
      // Gửi cho những người nhận việc khác
      assignees.forEach(a => {
        if (a.user_id !== user.id && !recipientsToNotify.includes(a.user_id)) {
          recipientsToNotify.push(a.user_id);
        }
      });

      if (recipientsToNotify.length > 0) {
        const tokensRes = await query(
          'SELECT user_id, fcm_token FROM user_push_tokens WHERE user_id = ANY($1)',
          [recipientsToNotify]
        );
        const { sendPWAPushNotification } = require('../config/firebaseAdmin');
        tokensRes.rows.forEach(({ fcm_token }) => {
          if (fcm_token) {
            sendPWAPushNotification(fcm_token, 'Báo cáo công việc mới', pushMessage, {
              taskId: String(taskId),
              type: 'task_report'
            }).catch(e => console.error('Error sending report push:', e.message));
          }
        });
      }
    } catch (pushErr) {
      console.error('Error processing push notification for report:', pushErr.message);
    }

    return res.status(201).json({ status: 'success', data: report });
  } catch (err) {
    console.error('❌ Lỗi tạo báo cáo:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ: ' + err.message });
  }
});

// GET /api/tasks/tasks/:taskId/reports — Lấy danh sách báo cáo của nhiệm vụ
router.get('/tasks/:taskId/reports', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    const result = await query(
      `SELECT tr.*, u.name AS user_name, u.avatar AS user_avatar, u.role AS user_role
       FROM task_reports tr
       JOIN users u ON tr.user_id = u.id
       WHERE tr.task_id = $1
       ORDER BY tr.created_at DESC`,
      [taskId]
    );

    return res.status(200).json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('❌ Lỗi lấy báo cáo nhiệm vụ:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ khi lấy danh sách báo cáo.' });
  }
});

// POST /api/tasks/tasks/:taskId/reports/seen — Đánh dấu tất cả báo cáo của nhiệm vụ này là đã xem
router.post('/tasks/:taskId/reports/seen', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Không thể xác thực người dùng.' });
  }

  const taskId = parseInt(req.params.taskId);

  try {
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1 AND is_deleted = FALSE', [taskId]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhiệm vụ.' });
    }

    // UPDATE task_reports SET is_seen_by_admin = TRUE WHERE task_id = :taskId
    await query(
      `UPDATE task_reports SET is_seen_by_admin = TRUE WHERE task_id = $1`,
      [taskId]
    );

    // Phát socket event: task_reports_seen
    const io = req.app.get('io');
    if (io) {
      io.emit('task_reports_seen', { taskId });
    }

    return res.status(200).json({ status: 'success', message: 'Đã đánh dấu đã xem toàn bộ báo cáo.' });
  } catch (err) {
    console.error('❌ Lỗi đánh dấu đã xem báo cáo:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ khi cập nhật trạng thái đã xem.' });
  }
});

module.exports = router;
