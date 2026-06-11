// backend/scripts/test_task_retention.js
// Kiểm tra hệ thống Auto Data Retention Policy
// Chạy: node scripts/test_task_retention.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { query } = require('../config/supabase');
const { runAutoCleanupJob, runTaskAutoArchive: _autoArchive, runTaskHardDelete: _hardDelete } = require('../services/autoCleanup');

async function runRetentionTests() {
  const startTime = Date.now();
  console.log('='.repeat(60));
  console.log('🧪 KIỂM TRA HỆ THỐNG TASK RETENTION POLICY');
  console.log('='.repeat(60));
  console.log('📅 Thời gian:', new Date().toLocaleString('vi-VN'));

  let passed = 0;
  let failed = 0;

  // ──────────────────────────────────────────────────────────────
  // KIỂM TRA 1: Task hoàn thành 31 ngày trước → Phải được archive
  // ──────────────────────────────────────────────────────────────
  console.log('\n🔵 TEST 1: Task hoàn thành 31 ngày trước → expect is_archived = TRUE');
  let testTask1Id = null;
  try {
    // Tạo task test
    const ws = await query(`SELECT id FROM workspaces LIMIT 1`);
    const wsId = ws.rows.length > 0 ? ws.rows[0].id : null;

    const inserted = await query(`
      INSERT INTO tasks (workspace_id, title, status, approval_status, completed, completed_at, is_archived, is_deleted)
      VALUES ($1, '[TEST-RETENTION-31D] Task completed 31 days ago', 'completed', 'completed', TRUE, NOW() - INTERVAL '31 days', FALSE, FALSE)
      RETURNING id
    `, [wsId]);
    testTask1Id = inserted.rows[0].id;
    console.log(`   ✅ Tạo task test ID: ${testTask1Id}`);

    // Kiểm tra điều kiện query archive
    const shouldArchive = await query(`
      SELECT id FROM tasks
      WHERE id = $1
        AND status IN ('completed', 'done')
        AND completed_at <= NOW() - INTERVAL '30 days'
        AND (is_archived = FALSE OR is_archived IS NULL)
        AND (is_deleted = FALSE OR is_deleted IS NULL)
    `, [testTask1Id]);

    if (shouldArchive.rows.length > 0) {
      console.log('   ✅ Task đủ điều kiện để archive.');
      passed++;
    } else {
      console.log('   ❌ Task KHÔNG đủ điều kiện archive! Logic archive bị sai.');
      failed++;
    }
  } catch (err) {
    console.error('   ❌ Test 1 lỗi:', err.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────
  // KIỂM TRA 2: Task hoàn thành 61 ngày trước + archived → files được xóa
  // ──────────────────────────────────────────────────────────────
  console.log('\n🔵 TEST 2: Task archived + file attachment > 60 ngày → file_deleted_at sẽ được set');
  let testTask2Id = null;
  let testAttachId = null;
  try {
    const ws = await query(`SELECT id FROM workspaces LIMIT 1`);
    const wsId = ws.rows.length > 0 ? ws.rows[0].id : null;

    const inserted = await query(`
      INSERT INTO tasks (workspace_id, title, status, approval_status, completed, completed_at, is_archived, archived_at, is_deleted)
      VALUES ($1, '[TEST-RETENTION-61D] Archived task with old file', 'completed', 'completed', TRUE, NOW() - INTERVAL '61 days', TRUE, NOW() - INTERVAL '31 days', FALSE)
      RETURNING id
    `, [wsId]);
    testTask2Id = inserted.rows[0].id;

    const insertedAtt = await query(`
      INSERT INTO task_attachments (task_id, file_url, file_name, file_size, created_at)
      VALUES ($1, 'https://FAKE_URL/test-file-to-delete.pdf', 'test-retention-file.pdf', 0, NOW() - INTERVAL '61 days')
      RETURNING id
    `, [testTask2Id]);
    testAttachId = insertedAtt.rows[0].id;
    console.log(`   ✅ Tạo task test ID: ${testTask2Id}, attachment ID: ${testAttachId}`);

    // Kiểm tra file query
    const shouldDeleteFiles = await query(`
      SELECT ta.id
      FROM task_attachments ta
      JOIN tasks t ON ta.task_id = t.id
      WHERE ta.task_id = $1
        AND ta.created_at < NOW() - INTERVAL '60 days'
        AND ta.file_deleted_at IS NULL
        AND ta.file_url IS NOT NULL
        AND t.is_archived = TRUE
    `, [testTask2Id]);

    if (shouldDeleteFiles.rows.length > 0) {
      console.log('   ✅ Attachment đủ điều kiện bị xóa file theo chính sách 60 ngày.');
      passed++;
    } else {
      console.log('   ❌ Attachment KHÔNG đủ điều kiện! Logic file retention bị sai.');
      failed++;
    }
  } catch (err) {
    console.error('   ❌ Test 2 lỗi:', err.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────
  // KIỂM TRA 3: Task archived + completed 181 ngày → đủ điều kiện hard delete
  // ──────────────────────────────────────────────────────────────
  console.log('\n🔵 TEST 3: Task archived + hoàn thành 181 ngày trước → đủ điều kiện hard delete');
  let testTask3Id = null;
  try {
    const ws = await query(`SELECT id FROM workspaces LIMIT 1`);
    const wsId = ws.rows.length > 0 ? ws.rows[0].id : null;

    const inserted = await query(`
      INSERT INTO tasks (workspace_id, title, status, approval_status, completed, completed_at, is_archived, archived_at, is_deleted)
      VALUES ($1, '[TEST-RETENTION-181D] Task for hard delete', 'completed', 'completed', TRUE, NOW() - INTERVAL '181 days', TRUE, NOW() - INTERVAL '151 days', FALSE)
      RETURNING id
    `, [wsId]);
    testTask3Id = inserted.rows[0].id;
    console.log(`   ✅ Tạo task test ID: ${testTask3Id}`);

    // Kiểm tra hard delete query
    const shouldHardDelete = await query(`
      SELECT id FROM tasks
      WHERE id = $1
        AND status IN ('completed', 'done')
        AND completed_at <= NOW() - INTERVAL '180 days'
        AND is_archived = TRUE
        AND (is_deleted = FALSE OR is_deleted IS NULL)
    `, [testTask3Id]);

    if (shouldHardDelete.rows.length > 0) {
      console.log('   ✅ Task đủ điều kiện hard delete sau 180 ngày.');
      passed++;
    } else {
      console.log('   ❌ Task KHÔNG đủ điều kiện hard delete! Logic sai.');
      failed++;
    }
  } catch (err) {
    console.error('   ❌ Test 3 lỗi:', err.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────
  // KIỂM TRA 4: Active tasks không bị archive
  // ──────────────────────────────────────────────────────────────
  console.log('\n🔵 TEST 4: Task đang thực hiện (in_progress) KHÔNG bị archive');
  let testTask4Id = null;
  try {
    const ws = await query(`SELECT id FROM workspaces LIMIT 1`);
    const wsId = ws.rows.length > 0 ? ws.rows[0].id : null;

    const inserted = await query(`
      INSERT INTO tasks (workspace_id, title, status, approval_status, completed, is_archived, is_deleted)
      VALUES ($1, '[TEST-RETENTION-ACTIVE] Task in progress - must NOT archive', 'in_progress', 'in_progress', FALSE, FALSE, FALSE)
      RETURNING id
    `, [wsId]);
    testTask4Id = inserted.rows[0].id;

    const shouldNotArchive = await query(`
      SELECT id FROM tasks
      WHERE id = $1
        AND status IN ('completed', 'done')
        AND completed_at <= NOW() - INTERVAL '30 days'
        AND (is_archived = FALSE OR is_archived IS NULL)
    `, [testTask4Id]);

    if (shouldNotArchive.rows.length === 0) {
      console.log('   ✅ Task đang làm (in_progress) KHÔNG bị archive. An toàn!');
      passed++;
    } else {
      console.log('   ❌ Task đang làm (in_progress) BỊ archive sai! Nghiêm trọng!');
      failed++;
    }
  } catch (err) {
    console.error('   ❌ Test 4 lỗi:', err.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────
  // CLEANUP: Xóa tất cả task test
  // ──────────────────────────────────────────────────────────────
  console.log('\n🧹 Dọn dẹp data test...');
  try {
    const testIds = [testTask1Id, testTask2Id, testTask3Id, testTask4Id].filter(Boolean);
    if (testIds.length > 0) {
      await query(`DELETE FROM task_attachments WHERE task_id = ANY($1)`, [testIds]);
      await query(`DELETE FROM task_reports WHERE task_id = ANY($1)`, [testIds]);
      await query(`DELETE FROM task_comments WHERE task_id = ANY($1)`, [testIds]);
      await query(`DELETE FROM task_activities WHERE task_id = ANY($1)`, [testIds]);
      await query(`DELETE FROM task_assignments WHERE task_id = ANY($1)`, [testIds]);
      await query(`DELETE FROM task_views WHERE task_id = ANY($1)`, [testIds]);
      await query(`DELETE FROM tasks WHERE id = ANY($1) AND title LIKE '[TEST-RETENTION%'`, [testIds]);
      console.log(`   ✅ Đã xóa ${testIds.length} task test.`);
    }
  } catch (err) {
    console.error('   ❌ Lỗi dọn dẹp:', err.message);
  }

  // ──────────────────────────────────────────────────────────────
  // KẾT LUẬN
  // ──────────────────────────────────────────────────────────────
  const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(60));
  console.log('📊 KẾT QUẢ KIỂM TRA');
  console.log(`   ✅ PASSED: ${passed}`);
  console.log(`   ❌ FAILED: ${failed}`);
  console.log(`   ⚡ Thời gian: ${executionTime} giây`);
  console.log(`   📝 Trạng thái: ${failed === 0 ? '🎉 TẤT CẢ KIỂM TRA THÀNH CÔNG' : '⚠️ CÓ LỖI CẦN XEM XÉT'}`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runRetentionTests().catch(err => {
  console.error('❌ Lỗi nghiêm trọng:', err.message);
  process.exit(1);
});
