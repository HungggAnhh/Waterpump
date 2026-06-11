// backend/services/autoCleanup.js
const { query } = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
require('dotenv').config({ path: __dirname + '/../.env' });

// Initialize Supabase Client using Service Role Key to bypass RLS
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const cleanSupabaseUrl = supabaseUrl ? supabaseUrl.replace(/\/rest\/v1\/?$/, '') : '';
const bucketName = process.env.SUPABASE_BUCKET || 'media';

const supabase = cleanSupabaseUrl && supabaseKey
  ? createClient(cleanSupabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket }
    })
  : null;

if (supabase) {
  console.log('🟢 [auto-cleanup] Supabase Client initialized successfully.');
} else {
  console.warn('⚠️ [auto-cleanup] Supabase Client could not be initialized. Environment variables may be missing.');
}

/**
 * Extracts Supabase Storage bucket path from the public/private URL.
 */
function getSupabaseFilePath(url, bucket) {
  if (!url) return null;

  const publicMarker = `/storage/v1/object/public/${bucket}/`;
  const publicIdx = url.indexOf(publicMarker);
  if (publicIdx !== -1) {
    return decodeURIComponent(url.substring(publicIdx + publicMarker.length).split('?')[0]);
  }

  const privateMarker = `/storage/v1/object/private/${bucket}/`;
  const privateIdx = url.indexOf(privateMarker);
  if (privateIdx !== -1) {
    return decodeURIComponent(url.substring(privateIdx + privateMarker.length).split('?')[0]);
  }

  try {
    const decoded = decodeURIComponent(url);
    const parts = decoded.split(`/${bucket}/`);
    if (parts.length > 1) {
      return parts[1].split('?')[0];
    }
  } catch (e) {}

  return null;
}

/**
 * Delete a physical file from Supabase Storage.
 * Returns true on success or if file not found.
 */
async function deleteStorageFile(url) {
  if (!supabase || !url) return false;
  const filePath = getSupabaseFilePath(url, bucketName);
  if (!filePath) return false;
  const { error } = await supabase.storage.from(bucketName).remove([filePath]);
  if (error) {
    console.error(`❌ [file-retention] Error deleting storage file: ${filePath} – ${error.message}`);
    return false;
  }
  console.log(`🗑️  [file-retention] Physical file deleted: ${filePath}`);
  return true;
}

// =============================================================================
// PHASE 1 – CHAT ATTACHMENT CLEANUP (> 60 days, unchanged from original)
// =============================================================================
async function cleanupChatFiles() {
  let physicalDeleted = 0;
  let dbUpdated = 0;

  try {
    const messagesRes = await query(`
      SELECT id, file_url, attachment_url, original_attachment_url
      FROM messages
      WHERE created_at < NOW() - INTERVAL '60 days'
        AND file_deleted_at IS NULL
        AND (file_url IS NOT NULL OR attachment_url IS NOT NULL OR original_attachment_url IS NOT NULL)
    `);
    console.log(`[auto-cleanup:job] Found ${messagesRes.rows.length} messages with files older than 60 days.`);

    for (const msg of messagesRes.rows) {
      try {
        const urls = [msg.file_url, msg.attachment_url, msg.original_attachment_url].filter(Boolean);
        for (const url of urls) {
          if (await deleteStorageFile(url)) physicalDeleted++;
        }
        await query(`
          UPDATE messages
          SET file_url = NULL,
              attachment_url = NULL,
              original_attachment_url = NULL,
              file_deleted_at = NOW(),
              file_deleted_reason = 'AUTO_RETENTION_60_DAYS'
          WHERE id = $1
        `, [msg.id]);
        dbUpdated++;
      } catch (e) {
        console.error(`❌ [auto-cleanup:job] Error cleaning message ID ${msg.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('❌ [auto-cleanup:job] Error querying messages:', err.message);
  }

  return { physicalDeleted, dbUpdated };
}

// =============================================================================
// PHASE 2 – TASK FILE RETENTION (files > 60 days on archived tasks)
// =============================================================================
async function cleanupTaskFiles() {
  let physicalDeleted = 0;
  let dbUpdated = 0;

  // B. task_attachments (archived tasks, files > 60 days)
  try {
    const attRes = await query(`
      SELECT ta.id, ta.file_url
      FROM task_attachments ta
      JOIN tasks t ON ta.task_id = t.id
      WHERE ta.created_at < NOW() - INTERVAL '60 days'
        AND ta.file_deleted_at IS NULL
        AND ta.file_url IS NOT NULL
        AND t.is_archived = TRUE
    `);
    console.log(`[auto-cleanup:job] Found ${attRes.rows.length} archived task attachments with files older than 60 days.`);

    for (const att of attRes.rows) {
      try {
        if (await deleteStorageFile(att.file_url)) physicalDeleted++;
        await query(`
          UPDATE task_attachments
          SET file_url = NULL,
              file_deleted_at = NOW(),
              file_deleted_reason = 'AUTO_RETENTION_60_DAYS'
          WHERE id = $1
        `, [att.id]);
        dbUpdated++;
      } catch (e) {
        console.error(`❌ [auto-cleanup:job] Error cleaning task attachment ID ${att.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('❌ [auto-cleanup:job] Error querying task_attachments:', err.message);
  }

  // C. task_reports (archived tasks, report files > 60 days)
  try {
    const repRes = await query(`
      SELECT tr.id, tr.attachments
      FROM task_reports tr
      JOIN tasks t ON tr.task_id = t.id
      WHERE tr.created_at < NOW() - INTERVAL '60 days'
        AND tr.file_deleted_at IS NULL
        AND tr.attachments IS NOT NULL
        AND jsonb_typeof(tr.attachments) = 'array'
        AND jsonb_array_length(tr.attachments) > 0
        AND t.is_archived = TRUE
    `);
    console.log(`[auto-cleanup:job] Found ${repRes.rows.length} archived task reports with files older than 60 days.`);

    for (const rep of repRes.rows) {
      try {
        const attachments = rep.attachments || [];
        for (const file of attachments) {
          if (file && file.url && await deleteStorageFile(file.url)) physicalDeleted++;
        }
        await query(`
          UPDATE task_reports
          SET attachments = '[]'::jsonb,
              file_deleted_at = NOW(),
              file_deleted_reason = 'AUTO_RETENTION_60_DAYS'
          WHERE id = $1
        `, [rep.id]);
        dbUpdated++;
      } catch (e) {
        console.error(`❌ [auto-cleanup:job] Error cleaning task report ID ${rep.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('❌ [auto-cleanup:job] Error querying task_reports:', err.message);
  }

  // D. task_comments (archived tasks, comment files > 60 days)
  try {
    const comRes = await query(`
      SELECT tc.id, tc.file_url
      FROM task_comments tc
      JOIN tasks t ON tc.task_id = t.id
      WHERE tc.created_at < NOW() - INTERVAL '60 days'
        AND tc.file_deleted_at IS NULL
        AND tc.file_url IS NOT NULL
        AND t.is_archived = TRUE
    `);
    console.log(`[auto-cleanup:job] Found ${comRes.rows.length} archived task comments with files older than 60 days.`);

    for (const com of comRes.rows) {
      try {
        if (await deleteStorageFile(com.file_url)) physicalDeleted++;
        await query(`
          UPDATE task_comments
          SET file_url = NULL,
              file_deleted_at = NOW(),
              file_deleted_reason = 'AUTO_RETENTION_60_DAYS'
          WHERE id = $1
        `, [com.id]);
        dbUpdated++;
      } catch (e) {
        console.error(`❌ [auto-cleanup:job] Error cleaning task comment ID ${com.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('❌ [auto-cleanup:job] Error querying task_comments:', err.message);
  }

  return { physicalDeleted, dbUpdated };
}

// =============================================================================
// TASK RETENTION – PHASE A: AUTO-ARCHIVE (completed tasks > 30 days)
// =============================================================================
async function runTaskAutoArchive() {
  let archivedCount = 0;

  try {
    // Process in batches of 100 to avoid memory issues
    const BATCH_SIZE = 100;
    let offset = 0;

    while (true) {
      const tasksRes = await query(`
        SELECT id
        FROM tasks
        WHERE status IN ('completed', 'done')
          AND completed_at <= NOW() - INTERVAL '30 days'
          AND (is_archived = FALSE OR is_archived IS NULL)
          AND (is_deleted = FALSE OR is_deleted IS NULL)
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);

      if (tasksRes.rows.length === 0) break;

      const taskIds = tasksRes.rows.map(r => r.id);

      await query(`
        UPDATE tasks
        SET is_archived = TRUE,
            archived_at = NOW(),
            updated_at = NOW()
        WHERE id = ANY($1)
      `, [taskIds]);

      archivedCount += taskIds.length;
      console.log(`✅ [task-retention] Task archived: IDs [${taskIds.join(', ')}]`);

      if (tasksRes.rows.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }
  } catch (err) {
    console.error('❌ [task-retention] Error in auto-archive phase:', err.message);
  }

  return archivedCount;
}

// =============================================================================
// TASK RETENTION – PHASE B: HARD DELETE (archived tasks with completed_at > 180 days)
// =============================================================================
async function runTaskHardDelete() {
  let deletedTasksCount = 0;
  let deletedFilesCount = 0;
  let deletedReportsCount = 0;
  let deletedCommentsCount = 0;

  try {
    const BATCH_SIZE = 50;
    let offset = 0;

    while (true) {
      const tasksRes = await query(`
        SELECT id
        FROM tasks
        WHERE status IN ('completed', 'done')
          AND completed_at <= NOW() - INTERVAL '180 days'
          AND is_archived = TRUE
          AND (is_deleted = FALSE OR is_deleted IS NULL)
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);

      if (tasksRes.rows.length === 0) break;

      for (const taskRow of tasksRes.rows) {
        const taskId = taskRow.id;
        let taskFilesDeleted = 0;
        let taskReportsDeleted = 0;
        let taskCommentsDeleted = 0;

        try {
          // 1. Delete physical files from task_attachments
          const attRes = await query(`SELECT id, file_url FROM task_attachments WHERE task_id = $1 AND file_url IS NOT NULL`, [taskId]);
          for (const att of attRes.rows) {
            if (await deleteStorageFile(att.file_url)) taskFilesDeleted++;
          }

          // 2. Delete physical files from task_reports
          const repRes = await query(`SELECT id, attachments FROM task_reports WHERE task_id = $1 AND attachments IS NOT NULL AND jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) > 0`, [taskId]);
          for (const rep of repRes.rows) {
            const atts = rep.attachments || [];
            for (const file of atts) {
              if (file && file.url && await deleteStorageFile(file.url)) taskFilesDeleted++;
            }
          }
          taskReportsDeleted = repRes.rows.length;

          // 3. Delete physical files from task_comments
          const comRes = await query(`SELECT id, file_url FROM task_comments WHERE task_id = $1 AND file_url IS NOT NULL`, [taskId]);
          for (const com of comRes.rows) {
            if (await deleteStorageFile(com.file_url)) taskFilesDeleted++;
          }
          taskCommentsDeleted = comRes.rows.length;

          // 4. Delete DB records in safe dependency order
          await query(`DELETE FROM task_reports WHERE task_id = $1`, [taskId]);
          console.log(`🗑️  [task-retention] Deleted reports for task ${taskId}: ${taskReportsDeleted}`);

          await query(`DELETE FROM task_comments WHERE task_id = $1`, [taskId]);
          console.log(`🗑️  [task-retention] Deleted comments for task ${taskId}: ${taskCommentsDeleted}`);

          await query(`DELETE FROM task_attachments WHERE task_id = $1`, [taskId]);

          await query(`DELETE FROM task_activities WHERE task_id = $1`, [taskId]);

          // notifications: delete by task_id in data field (JSONB) or by type
          await query(`DELETE FROM notifications WHERE data->>'task_id' = $1::text OR data->>'taskId' = $1::text`, [taskId.toString()]);

          await query(`DELETE FROM task_assignments WHERE task_id = $1`, [taskId]);

          await query(`DELETE FROM task_views WHERE task_id = $1`, [taskId]);

          // 5. Finally delete the task itself
          await query(`DELETE FROM tasks WHERE id = $1`, [taskId]);

          deletedTasksCount++;
          deletedFilesCount += taskFilesDeleted;
          deletedReportsCount += taskReportsDeleted;
          deletedCommentsCount += taskCommentsDeleted;

          console.log(`✅ [task-retention] Task permanently deleted: ID ${taskId} | files: ${taskFilesDeleted} | reports: ${taskReportsDeleted} | comments: ${taskCommentsDeleted}`);

        } catch (taskErr) {
          console.error(`❌ [task-retention] Error deleting task ID ${taskId}:`, taskErr.message);
        }
      }

      // If we processed a full batch there might be more, but since we're deleting
      // the offset stays at 0 as items are removed from the result set
      if (tasksRes.rows.length < BATCH_SIZE) break;
      // Don't increment offset since deleted rows shift the result set
    }
  } catch (err) {
    console.error('❌ [task-retention] Error in hard delete phase:', err.message);
  }

  return { deletedTasksCount, deletedFilesCount, deletedReportsCount, deletedCommentsCount };
}

// =============================================================================
// LIGHT DATA CLEANUP (> 180 days)
// =============================================================================
async function cleanupLightData() {
  let lightDeleted = 0;
  const tablesToClean = [
    'notifications',
    'task_activities',
    'activity_logs',
    'socket_logs',
    'audit_logs'
  ];

  for (const tableName of tablesToClean) {
    try {
      const res = await query(`DELETE FROM ${tableName} WHERE created_at < NOW() - INTERVAL '180 days'`);
      const count = res.rowCount || 0;
      lightDeleted += count;
      if (count > 0) {
        console.log(`✨ [auto-cleanup:job] Purged ${tableName}: ${count} rows deleted.`);
      }
    } catch (err) {
      console.log(`ℹ️  [auto-cleanup:job] Table ${tableName} purge skipped: ${err.message}`);
    }
  }

  return lightDeleted;
}

// =============================================================================
// MAIN JOB
// =============================================================================
async function runAutoCleanupJob() {
  console.log('🔄 [auto-cleanup:job] Running scheduled cleanup...');
  const startTime = Date.now();

  if (!supabase) {
    console.error('❌ [auto-cleanup:job] Supabase client is not available. Skipping storage deletion.');
    return;
  }

  // ── STEP 1: Chat file cleanup (messages > 60 days) ──────────────────────────
  console.log('\n📂 [auto-cleanup:job] STEP 1: Cleaning up old chat files...');
  const chatResult = await cleanupChatFiles();

  // ── STEP 2: Task file cleanup (archived task files > 60 days) ───────────────
  console.log('\n📂 [auto-cleanup:job] STEP 2: Cleaning up old task files...');
  const taskFileResult = await cleanupTaskFiles();

  // ── STEP 3: Task auto-archive (completed > 30 days) ─────────────────────────
  console.log('\n📦 [auto-cleanup:job] STEP 3: Auto-archiving completed tasks...');
  const archivedCount = await runTaskAutoArchive();

  // ── STEP 4: Task hard delete (archived + completed > 180 days) ───────────────
  console.log('\n🗑️  [auto-cleanup:job] STEP 4: Hard deleting expired archived tasks...');
  const deleteResult = await runTaskHardDelete();

  // ── STEP 5: Light data purge (> 180 days) ────────────────────────────────────
  console.log('\n🧹 [auto-cleanup:job] STEP 5: Purging light data (> 180 days)...');
  const lightDeleted = await cleanupLightData();

  const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n==================================================`);
  console.log(`📊 LOG TỔNG KẾT SCHEDULED JOB: auto_cleanup_old_data`);
  console.log(`📅 Thời gian: ${new Date().toLocaleString('vi-VN')}`);
  console.log(`⚡ Thời gian thực thi: ${timeTaken} giây`);
  console.log(`📦 Số task tự động lưu trữ: ${archivedCount}`);
  console.log(`🗑️  Số task xóa vĩnh viễn: ${deleteResult.deletedTasksCount}`);
  console.log(`📎 Số file vật lý xóa (chat): ${chatResult.physicalDeleted}`);
  console.log(`📎 Số file vật lý xóa (task): ${taskFileResult.physicalDeleted + deleteResult.deletedFilesCount}`);
  console.log(`📝 Số báo cáo bị xóa: ${deleteResult.deletedReportsCount}`);
  console.log(`💬 Số bình luận bị xóa: ${deleteResult.deletedCommentsCount}`);
  console.log(`🗑️  Số records dữ liệu nhẹ bị xóa (> 180 ngày): ${lightDeleted}`);
  console.log(`==================================================\n`);
}

/**
 * Initialize the recurring job scheduler (Daily at 02:00 AM)
 */
function init() {
  console.log('⏰ [auto-cleanup] Auto Data Retention Scheduler initialized.');

  let lastRunDate = '';
  setInterval(async () => {
    try {
      const now = new Date();
      const currentDateStr = now.toDateString();

      if (now.getHours() === 2 && now.getMinutes() === 0 && lastRunDate !== currentDateStr) {
        lastRunDate = currentDateStr;
        console.log(`⏰ [auto-cleanup] Triggering daily auto_cleanup_old_data job...`);
        await runAutoCleanupJob();
      }
    } catch (err) {
      console.error('❌ [auto-cleanup] Error in auto-cleanup schedule loop:', err.message);
    }
  }, 60000); // 1 minute
}

module.exports = {
  init,
  runAutoCleanupJob
};
