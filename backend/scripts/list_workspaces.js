// backend/list_workspaces.js
const { query } = require('./config/supabase');

async function test() {
  try {
    console.log("🔍 Đang truy vấn danh sách tất cả các workspace...");
    const res = await query('SELECT * FROM workspaces');
    console.log(JSON.stringify(res.rows, null, 2));

    console.log("🔍 Đang truy vấn danh sách tất cả các thành viên của workspace...");
    const memRes = await query('SELECT * FROM workspace_members');
    console.log(JSON.stringify(memRes.rows, null, 2));
  } catch (err) {
    console.error("❌ Lỗi:", err.stack);
  }
}

test();
