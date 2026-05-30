// backend/test_urge_endpoint.js
const { query } = require('./config/supabase');

async function test(taskId, interval) {
  try {
    console.log(`🔍 Chạy thử nghiệm Logic Hối thúc cho Task ID ${taskId}, Interval = "${interval}"...`);
    
    const taskRes = await query('SELECT * FROM tasks WHERE id = $1 AND is_deleted = FALSE', [taskId]);
    if (taskRes.rows.length === 0) {
      console.error('❌ Không tìm thấy nhiệm vụ hoặc nhiệm vụ đã bị xóa.');
      return;
    }

    const task = taskRes.rows[0];
    let assignedTo = task.assigned_to;
    console.log(`📋 Chi tiết Task: id=${task.id}, title="${task.title}", workspace_id=${task.workspace_id}, assigned_to=${task.assigned_to}`);

    if (!assignedTo) {
      console.log("💡 Phát hiện assigned_to = NULL. Đang thử tự động tìm kiếm thành viên...");
      const memberRes = await query(
        `SELECT wm.user_id FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND u.role = 'user'
         LIMIT 1`,
        [task.workspace_id]
      );
      if (memberRes.rows.length > 0) {
        assignedTo = memberRes.rows[0].user_id;
        console.log(`✅ Đã tìm thấy thành viên: User ID ${assignedTo}. Đang cập nhật CSDL...`);
        await query('UPDATE tasks SET assigned_to = $1 WHERE id = $2', [assignedTo, taskId]);
        console.log(`✅ Đã cập nhật assigned_to thành công.`);
      }
    }

    if (!assignedTo) {
      console.error('❌ Thất bại: Nhiệm vụ này chưa được gán cho ai và Trang này chưa có thành viên thường nào.');
      return;
    }

    // Fetch assignee tokens
    console.log(`🔍 Truy vấn push tokens cho User ID ${assignedTo}...`);
    const tokensRes = await query(
      'SELECT fcm_token FROM user_push_tokens WHERE user_id = $1',
      [assignedTo]
    );
    console.log(`✅ Tìm thấy ${tokensRes.rows.length} push tokens.`);

    const { sendPWAPushNotification } = require('./config/firebaseAdmin');
    console.log(`✅ Loaded firebaseAdmin sendPWAPushNotification.`);

    if (interval === 'now') {
      if (tokensRes.rows.length > 0) {
        console.log(`📡 Đang thử gửi push notification khẩn cấp...`);
        const title = `⚡ [HỐI THÚC KHẨN CẤP]`;
        const body = `Sếp đang hối thúc bạn thực hiện nhiệm vụ gấp: "${task.title}"`;
        const dataUrl = `/workspace/${task.workspace_id}`;
        for (const row of tokensRes.rows) {
          const res = await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
          console.log(`🚀 Kết quả gửi:`, res);
        }
      }
      console.log(`🎉 Hoàn tất hối thúc khẩn cấp thành công!`);
      return;
    }

    // Set recurring reminders
    let dbInterval = null;
    if (interval === 'hourly') dbInterval = 'hourly';
    if (interval === 'daily') dbInterval = 'daily';

    console.log(`⚡ Đang cập nhật reminder_interval thành "${dbInterval}" trong CSDL...`);
    await query(
      'UPDATE tasks SET reminder_interval = $1, last_reminded_at = NULL, updated_at = NOW() WHERE id = $2',
      [dbInterval, taskId]
    );
    console.log(`✅ Cập nhật CSDL thành công.`);

    if (dbInterval && tokensRes.rows.length > 0) {
      const reminderText = dbInterval === 'hourly' ? 'mỗi giờ' : 'mỗi ngày';
      console.log(`📡 Đang gửi thông báo thông báo đặt nhắc nhở...`);
      const title = `⏰ Đặt nhắc nhở hối thúc`;
      const body = `Sếp đã bật chế độ hối thúc công việc này [${reminderText}] cho đến khi hoàn tất: "${task.title}"`;
      const dataUrl = `/workspace/${task.workspace_id}`;
      for (const row of tokensRes.rows) {
        const res = await sendPWAPushNotification(row.fcm_token, title, body, dataUrl, 'task');
        console.log(`🚀 Kết quả gửi:`, res);
      }
    }

    console.log(`🎉 Mọi thứ chạy thành công không có bất kỳ lỗi nào!`);

  } catch (err) {
    console.error("❌ Lỗi xảy ra trong quá trình thực thi:", err.stack);
  }
}

// Chạy thử với Task ID 1 hoặc task bất kỳ có trong CSDL
test(1, 'now');
