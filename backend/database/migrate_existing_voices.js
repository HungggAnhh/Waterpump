// backend/database/migrate_existing_voices.js
const { pool, query } = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');
const { transcodeToAAC } = require('../services/voiceProcessor');
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

const tempDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function getPathFromUrl(url) {
  const marker = `/${bucketName}/`;
  const index = url.indexOf(marker);
  if (index !== -1) {
    return decodeURIComponent(url.substring(index + marker.length));
  }
  return url;
}

function isWebMFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
  } catch (err) {
    return false;
  }
}

function isOggFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    return buffer.toString('utf8', 0, 4) === 'OggS';
  } catch (err) {
    return false;
  }
}

async function runMigration() {
  try {
    if (!supabase) {
      console.error('❌ Supabase client failed to initialize.');
      process.exit(1);
    }

    console.log('⚡ Scanning for legacy voice messages (processing_status IS NULL)...');
    const res = await query(
      `SELECT id, attachment_url, attachment_mime_type, conversation_id
       FROM messages
       WHERE type = 'voice' AND processing_status IS NULL
       ORDER BY id ASC`
    );

    console.log(`ℹ️ Found ${res.rows.length} legacy voice messages to migrate.`);

    for (let i = 0; i < res.rows.length; i++) {
      const msg = res.rows[i];
      const percent = Math.round(((i + 1) / res.rows.length) * 100);
      console.log(`[${i + 1}/${res.rows.length}] (${percent}%) Processing legacy voice ID: ${msg.id}`);

      const originalUrl = msg.attachment_url;
      if (!originalUrl) {
        console.log(`   ⚠️ Skip: Empty attachment_url`);
        await query(`UPDATE messages SET processing_status = 'failed', processing_error = 'Empty url' WHERE id = $1`, [msg.id]);
        continue;
      }

      const bucketPath = getPathFromUrl(originalUrl);
      const ext = originalUrl.split('.').pop()?.split('?')[0] || 'm4a';
      const localInputPath = path.join(tempDir, `migrate_input_${msg.id}.${ext}`);

      try {
        // Download
        const { data, error: downloadError } = await supabase.storage
          .from(bucketName)
          .download(bucketPath);

        if (downloadError) {
          throw new Error(`Download failed: ${downloadError.message}`);
        }

        const arrayBuffer = await data.arrayBuffer();
        fs.writeFileSync(localInputPath, Buffer.from(arrayBuffer));
        const originalSize = fs.statSync(localInputPath).size;

        const webm = isWebMFile(localInputPath);
        const ogg = isOggFile(localInputPath);
        const mimewebm = msg.attachment_mime_type?.includes('webm');
        const mimeogg = msg.attachment_mime_type?.includes('ogg');

        const needsTranscode = webm || ogg || mimewebm || mimeogg;

        if (!needsTranscode) {
          console.log(`   ➡️ Skip transcoding: Already a compatible format (detected size: ${originalSize} bytes)`);
          await query(
            `UPDATE messages
             SET original_attachment_url = $1,
                 attachment_codec = 'aac',
                 attachment_size = $2,
                 processing_status = 'completed',
                 processed_at = NOW()
             WHERE id = $3`,
            [originalUrl, originalSize, msg.id]
          );

          if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
          continue;
        }

        console.log(`   🛠️ Transcoding required (webm=${webm}, ogg=${ogg}, mime=${msg.attachment_mime_type})`);
        const localOutputPath = path.join(tempDir, `migrate_output_${msg.id}.m4a`);
        await transcodeToAAC(localInputPath, localOutputPath);

        // Upload normalized M4A
        const outputFilename = `voice_migrated_${msg.id}_${Date.now()}.m4a`;
        const outputBucketPath = `chat-voice/normalized/${outputFilename}`;
        const transcodedBuffer = fs.readFileSync(localOutputPath);

        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(outputBucketPath, transcodedBuffer, {
            contentType: 'audio/mp4',
            upsert: false
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const match = originalUrl.match(/^(https?:\/\/[^\/]+)/);
        const host = match ? match[1] : '';
        const normalizedUrl = `${host}/storage/v1/object/private/media/${outputBucketPath}`;
        const normalizedSize = transcodedBuffer.length;

        // Update DB
        await query(
          `UPDATE messages
           SET attachment_url = $1,
               original_attachment_url = $2,
               attachment_codec = $3,
               attachment_size = $4,
               processing_status = 'completed',
               processed_at = NOW()
           WHERE id = $5`,
          [normalizedUrl, originalUrl, 'aac', normalizedSize, msg.id]
        );

        console.log(`   ✅ Success! Normalized URL: ${normalizedUrl}`);

        if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
        if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
      } catch (err) {
        console.error(`   ❌ Failed to migrate voice ID ${msg.id}:`, err.message);
        await query(
          `UPDATE messages
           SET processing_status = 'failed',
               processing_error = $1,
               processed_at = NOW()
           WHERE id = $2`,
          [err.message, msg.id]
        );

        if (fs.existsSync(localInputPath)) {
          try { fs.unlinkSync(localInputPath); } catch (e) {}
        }
      }
    }

    console.log('🎉 Migration script completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Critical failure in migration script:', err);
    process.exit(1);
  }
}

runMigration();
