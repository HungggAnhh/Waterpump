// backend/database/migrate_phase3_workspace_pages.js
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Lỗi: Không tìm thấy DATABASE_URL trong .env!");
    process.exit(1);
  }

  console.log("🔌 Đang kết nối tới Supabase PostgreSQL để chạy Phase 3.5 (Workspace Pages & Task Database) Migration...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Đã kết nối cơ sở dữ liệu thành công!");

    // Bắt đầu transaction
    await client.query('BEGIN');

    // 1. Tạo bảng workspaces
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng workspaces.");

    // 2. Tạo bảng workspace_pages (Internal Pages)
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_pages (
        id           SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name         VARCHAR(255) NOT NULL,
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng workspace_pages.");

    // 3. Tạo bảng tasks với cấu trúc phân cấp mới hoàn toàn
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        page_id      INTEGER NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE,
        title        VARCHAR(255) NOT NULL,
        description  TEXT NULL,
        status       VARCHAR(50) NOT NULL DEFAULT 'todo',
        priority     VARCHAR(50) NOT NULL DEFAULT 'medium',
        assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        deadline     TIMESTAMPTZ NULL,
        completed    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("👉 Đã tạo bảng tasks.");

    // 4. Seed Workspace, Page & Tasks mẫu khớp với mô tả yêu cầu
    console.log("⚡ Đang tạo dữ liệu seed mẫu...");
    
    // Tìm các ID của các user mẫu
    const usersRes = await client.query("SELECT id, email FROM users ORDER BY id ASC");
    let adminId = null;
    let userAId = null; // dev@company.com
    let userBId = null; // designer@company.com

    usersRes.rows.forEach(u => {
      if (u.email === 'pm@company.com') adminId = u.id;
      else if (u.email === 'dev@company.com') userAId = u.id;
      else if (u.email === 'designer@company.com') userBId = u.id;
    });

    // Nếu không tìm thấy, dùng ID dự phòng
    if (!adminId) adminId = usersRes.rows[0]?.id || 1;
    if (!userAId) userAId = usersRes.rows[1]?.id || 2;
    if (!userBId) userBId = usersRes.rows[2]?.id || 3;

    console.log(`👤 Seed mapped users: Admin=${adminId}, User A=${userAId}, User B=${userBId}`);

    // Xoá dữ liệu cũ nếu chạy lại seed
    await client.query("TRUNCATE tasks, workspace_pages, workspaces RESTART IDENTITY CASCADE");

    // Thêm Workspace "PHÚC"
    const wsRes = await client.query(`
      INSERT INTO workspaces (id, name, created_by)
      VALUES (1, 'PHÚC', $1)
      RETURNING id;
    `, [adminId]);
    const wsId = wsRes.rows[0].id;

    // Thêm các trang con: "Hình Ảnh", "PCB", "Test"
    const p1Res = await client.query(`
      INSERT INTO workspace_pages (id, workspace_id, name, created_by)
      VALUES (1, $1, 'Hình Ảnh 🎨', $2)
      RETURNING id;
    `, [wsId, adminId]);
    const pageImageId = p1Res.rows[0].id;

    const p2Res = await client.query(`
      INSERT INTO workspace_pages (id, workspace_id, name, created_by)
      VALUES (2, $1, 'PCB ⚡', $2)
      RETURNING id;
    `, [wsId, adminId]);
    const pagePcbId = p2Res.rows[0].id;

    const p3Res = await client.query(`
      INSERT INTO workspace_pages (id, workspace_id, name, created_by)
      VALUES (3, $1, 'Test 🧪', $2)
      RETURNING id;
    `, [wsId, adminId]);
    const pageTestId = p3Res.rows[0].id;

    // Thêm tasks
    // Hình Ảnh:
    // - Thiết kế banner -> User A (dev@company.com)
    // - Chỉnh sửa logo -> User B (designer@company.com)
    await client.query(`
      INSERT INTO tasks (title, description, status, priority, assigned_to, created_by, workspace_id, page_id, deadline)
      VALUES 
      ('Thiết kế banner', 'Thiết kế banner truyền thông cho chiến dịch mùa hè.', 'todo', 'high', $1, $2, $3, $4, NOW() + INTERVAL '2 days'),
      ('Chỉnh sửa logo', 'Chỉnh sửa logo theo nhận diện thương hiệu mới tinh tế hơn.', 'in_progress', 'medium', $5, $2, $3, $4, NOW() + INTERVAL '3 days');
    `, [userAId, adminId, wsId, pageImageId, userBId]);

    // PCB:
    await client.query(`
      INSERT INTO tasks (title, description, status, priority, assigned_to, created_by, workspace_id, page_id, deadline)
      VALUES 
      ('Thiết kế sơ đồ nguyên lý PCB', 'Vẽ và tối ưu hóa Schematic cho bo mạch vi điều khiển.', 'todo', 'high', $1, $2, $3, $4, NOW() + INTERVAL '5 days');
    `, [userAId, adminId, wsId, pagePcbId]);

    // Test:
    await client.query(`
      INSERT INTO tasks (title, description, status, priority, assigned_to, created_by, workspace_id, page_id, deadline)
      VALUES 
      ('Kiểm thử bo mạch vi phun sương', 'Đo đạc điện áp và kiểm tra độ ổn định hoạt động.', 'todo', 'low', $1, $2, $3, $4, NOW() + INTERVAL '7 days');
    `, [userBId, adminId, wsId, pageTestId]);

    // Reset sequences
    await client.query(`SELECT setval('workspaces_id_seq', COALESCE((SELECT MAX(id) FROM workspaces), 1));`);
    await client.query(`SELECT setval('workspace_pages_id_seq', COALESCE((SELECT MAX(id) FROM workspace_pages), 1));`);
    await client.query(`SELECT setval('tasks_id_seq', COALESCE((SELECT MAX(id) FROM tasks), 1));`);

    console.log("🎉 Seeded Workspace, Pages, and Tasks successfully!");

    // Commit transaction
    await client.query('COMMIT');
    console.log("🎉 MIGRATION HOÀN THÀNH RỰC RỠ!");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Lỗi Migration, đã ROLLBACK. Chi tiết lỗi:", err.message);
    throw err;
  } finally {
    await client.end();
    console.log("🔌 Đã ngắt kết nối cơ sở dữ liệu.");
  }
}

runMigration().catch(err => {
  console.error("❌ Migration thất bại:", err.message);
  process.exit(1);
});
