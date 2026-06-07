// backend/test_urge.js
const { query } = require('./config/supabase');

async function test() {
  try {
    console.log("🔍 Chạy thử nghiệm truy vấn tìm thành viên trong Workspace ID 1...");
    const workspaceId = 1;
    const memberRes = await query(
      `SELECT wm.user_id FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1 AND u.role = 'user'
       LIMIT 1`,
      [workspaceId]
    );
    console.log("✅ Thành công! Kết quả:", memberRes.rows);
  } catch (err) {
    console.error("❌ Thất bại với u.role = 'user':", err.message);
    
    try {
      console.log("🔍 Thử lại với u.role::text = 'user'...");
      const memberResText = await query(
        `SELECT wm.user_id FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND u.role::text = 'user'
         LIMIT 1`,
        [workspaceId]
      );
      console.log("✅ Thành công! Kết quả:", memberResText.rows);
    } catch (err2) {
      console.error("❌ Thất bại hoàn toàn:", err2.message);
    }
  }
}

test();
