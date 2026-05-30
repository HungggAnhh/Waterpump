// backend/list_tasks.js
const { query } = require('./config/supabase');

async function test() {
  try {
    console.log("🔍 Đang truy vấn danh sách tất cả các task hiện có...");
    const res = await query('SELECT id, title, workspace_id, assigned_to, completed, is_deleted, priority FROM tasks LIMIT 10');
    console.log("✅ Danh sách tasks:");
    console.log(JSON.stringify(res.rows, null, 2));

    console.log("🔍 Đang truy vấn danh sách tất cả các workspace_members...");
    const wmRes = await query('SELECT * FROM workspace_members LIMIT 10');
    console.log("✅ Danh sách workspace_members:");
    console.log(JSON.stringify(wmRes.rows, null, 2));
  } catch (err) {
    console.error("❌ Lỗi:", err.stack);
  }
}

test();
