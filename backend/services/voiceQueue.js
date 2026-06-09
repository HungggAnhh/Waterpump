// backend/services/voiceQueue.js
const { pool, query } = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');
const { transcodeToAAC, shouldTranscode } = require('./voiceProcessor');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Initialize Supabase Client
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

let ioInstance = null;
let isProcessing = false;
let pollingInterval = null;

const tempDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Extracts Supabase Storage bucket path from the public/private URL.
 */
function getPathFromUrl(url) {
  const marker = `/${bucketName}/`;
  const index = url.indexOf(marker);
  if (index !== -1) {
    return decodeURIComponent(url.substring(index + marker.length));
  }
  return url;
}

/**
 * Safe transaction-based fetch to claim a job using SKIP LOCKED.
 */
async function acquireNextJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selectSql = `
      SELECT id, attachment_url, attachment_mime_type, conversation_id
      FROM messages
      WHERE type = 'voice' AND processing_status = 'pending'
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
    `;
    const res = await client.query(selectSql);
    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    
    const job = res.rows[0];
    const updateSql = `
      UPDATE messages
      SET processing_status = 'processing'
      WHERE id = $1;
    `;
    await client.query(updateSql, [job.id]);
    await client.query('COMMIT');
    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Process a single claimed job.
 */
async function processJob(job) {
  const startTime = Date.now();
  console.log('[VOICE_PROCESS_START]', {
    messageId: job.id,
    conversationId: job.conversation_id,
    mimeType: job.attachment_mime_type,
  });

  if (!supabase) {
    throw new Error('Supabase client is not initialized in voiceQueue.');
  }

  const originalUrl = job.attachment_url;
  const mimeType = job.attachment_mime_type;
  const bucketPath = getPathFromUrl(originalUrl);
  
  // Download original file to temp directory
  const ext = originalUrl.split('.').pop()?.split('?')[0] || 'webm';
  const localInputPath = path.join(tempDir, `input_${job.id}_${Date.now()}.${ext}`);
  
  try {
    console.log(`[Queue] Downloading raw file from bucket path: ${bucketPath}`);
    const { data, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(bucketPath);

    if (downloadError) {
      throw new Error(`Failed to download original audio: ${downloadError.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    fs.writeFileSync(localInputPath, Buffer.from(arrayBuffer));
    const originalSize = fs.statSync(localInputPath).size;

    // Check if transcoding is required
    const needsTranscode = shouldTranscode(mimeType);

    if (!needsTranscode) {
      console.log(`[Queue] Skipping transcoding for compatible format: ${mimeType}`);
      
      // Update Database
      await query(
        `UPDATE messages
         SET original_attachment_url = $1,
             attachment_codec = $2,
             attachment_size = $3,
             processing_status = 'completed',
             processed_at = NOW()
         WHERE id = $4`,
        [originalUrl, 'aac', originalSize, job.id]
      );

      // Clean up local temp file
      if (fs.existsSync(localInputPath)) {
        fs.unlinkSync(localInputPath);
      }

      console.log('[VOICE_PROCESS_SUCCESS]', {
        messageId: job.id,
        conversationId: job.conversation_id,
        mimeType: mimeType,
        codec: 'aac',
        processingTime: Date.now() - startTime
      });

      // Socket Emit
      notifyClient(job.id, originalUrl, job.conversation_id);
      return;
    }

    // Perform FFmpeg transcoding to standard AAC/M4A
    const localOutputPath = path.join(tempDir, `output_${job.id}_${Date.now()}.m4a`);
    await transcodeToAAC(localInputPath, localOutputPath);

    // Upload normalized M4A back to Supabase Storage
    const outputFilename = `voice_${Date.now()}_${Math.random().toString(36).slice(2)}.m4a`;
    const outputBucketPath = `chat-voice/normalized/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${outputFilename}`;
    const transcodedBuffer = fs.readFileSync(localOutputPath);

    console.log(`[Queue] Uploading normalized file to bucket: ${outputBucketPath}`);
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(outputBucketPath, transcodedBuffer, {
        contentType: 'audio/mp4',
        upsert: false
      });

    if (uploadError) {
      throw new Error(`Failed to upload normalized audio: ${uploadError.message}`);
    }

    // Construct Private URL for the normalized file
    const match = originalUrl.match(/^(https?:\/\/[^\/]+)/);
    const host = match ? match[1] : '';
    const normalizedUrl = `${host}/storage/v1/object/private/media/${outputBucketPath}`;
    const normalizedSize = transcodedBuffer.length;

    // Update Database columns
    await query(
      `UPDATE messages
       SET attachment_url = $1,
           original_attachment_url = $2,
           attachment_codec = $3,
           attachment_size = $4,
           processing_status = 'completed',
           processed_at = NOW()
       WHERE id = $5`,
      [normalizedUrl, originalUrl, 'aac', normalizedSize, job.id]
    );

    // Clean up local temp files
    if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
    if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);

    console.log('[VOICE_PROCESS_SUCCESS]', {
      messageId: job.id,
      conversationId: job.conversation_id,
      mimeType: mimeType,
      codec: 'aac',
      processingTime: Date.now() - startTime
    });

    // Socket Emit
    notifyClient(job.id, normalizedUrl, job.conversation_id);

  } catch (err) {
    console.error('[VOICE_PROCESS_FAIL]', {
      messageId: job.id,
      conversationId: job.conversation_id,
      mimeType: mimeType,
      error: err.message,
      processingTime: Date.now() - startTime
    });

    // Clean up local files if they exist
    if (fs.existsSync(localInputPath)) {
      try { fs.unlinkSync(localInputPath); } catch (e) {}
    }

    // Set processing status to failed
    await query(
      `UPDATE messages
       SET processing_status = 'failed',
           processing_error = $1,
           processed_at = NOW()
       WHERE id = $2`,
      [err.message, job.id]
    );

    // Socket notify failure status
    notifyClient(job.id, originalUrl, job.conversation_id, 'failed');
  }
}

/**
 * Emit socket message to all members in the conversation.
 */
async function notifyClient(messageId, attachmentUrl, conversationId, status = 'completed') {
  if (!ioInstance) return;
  try {
    const memberRes = await query(
      'SELECT user_id FROM conversation_users WHERE conversation_id = $1',
      [parseInt(conversationId)]
    );
    memberRes.rows.forEach(({ user_id }) => {
      ioInstance.to(`user_${user_id}`).emit('message_normalized', {
        messageId,
        attachmentUrl,
        processingStatus: status
      });
    });
  } catch (err) {
    console.error('Failed to broadcast message_normalized socket event:', err);
  }
}

/**
 * Main worker loop.
 */
async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    let job = await acquireNextJob();
    while (job) {
      await processJob(job);
      job = await acquireNextJob();
    }
  } catch (err) {
    console.error('[Queue] Critical error in queue processor:', err);
  } finally {
    isProcessing = false;
  }
}

/**
 * Start queue polling and store socket instance.
 */
function init(io) {
  ioInstance = io;
  console.log('🟢 [Queue] Voice Normalization Queue Service initialized.');
  
  // Start polling PostgreSQL every 5 seconds
  pollingInterval = setInterval(() => {
    processQueue().catch((err) => console.error('[Queue] Polling processing error:', err));
  }, 5000);

  // Run initial scan
  processQueue().catch((err) => console.error('[Queue] Initial processing error:', err));
}

/**
 * Immediately triggers a new processing cycle (e.g. on new uploads)
 */
function trigger() {
  processQueue().catch((err) => console.error('[Queue] Triggered processing error:', err));
}

module.exports = {
  init,
  trigger
};
