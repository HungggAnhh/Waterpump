// backend/routes/upload.js
// Upload tệp tin trực tiếp lên Supabase Storage qua Memory Buffer
const express = require('express');
const multer  = require('multer');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
require('dotenv').config({ path: __dirname + '/../.env' });

const router = express.Router();

// Khởi tạo Supabase client dùng khoá quyền lực Service Role Key để vượt qua RLS
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl) {
  console.warn('⚠️ [UPLOAD_API:INIT] SUPABASE_URL đang trống!');
}
if (!supabaseKey) {
  console.warn('⚠️ [UPLOAD_API:INIT] SUPABASE_SERVICE_ROLE_KEY / SERVICE_KEY đang trống!');
}

// Clean the URL by stripping /rest/v1/ if present, as storage client relies on the raw base URL
const cleanSupabaseUrl = supabaseUrl ? supabaseUrl.replace(/\/rest\/v1\/?$/, '') : '';

const supabase = cleanSupabaseUrl && supabaseKey 
  ? createClient(cleanSupabaseUrl, supabaseKey, {
      auth: {
        persistSession: false
      },
      realtime: {
        transport: WebSocket
      }
    })
  : null;

if (supabase) {
  console.log('🟢 [UPLOAD_API:INIT] Supabase Client đã được khởi tạo thành công.');
} else {
  console.error('🔴 [UPLOAD_API:INIT] Không thể khởi tạo Supabase Client. Vui lòng cấu hình biến môi trường.');
}

// Multer: chỉ dùng memoryStorage (lưu trực tiếp tệp nhị phân vào buffer để đẩy lên Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // Tăng giới hạn tải lên tối đa lên 20MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 
      'image/png', 
      'image/gif', 
      'image/webp',
      'video/mp4', 
      'video/quicktime',
      'video/mpeg',
      'audio/m4a',
      'audio/x-m4a',
      'audio/mp4',
      'audio/aac',
      'audio/x-aac',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'audio/webm',
      'audio/3gpp',
      'application/octet-stream'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Định dạng tệp không hỗ trợ (${file.mimetype}).`));
    }
  }
});

// POST /api/upload
// Sử dụng hàm callback tuỳ chỉnh của multer để bắt toàn bộ lỗi kích thước/định dạng tệp và trả về JSON chuẩn
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('❌ [UPLOAD_API:MULTER_ERROR]', err.message);
      return res.status(400).json({
        status: 'error',
        message: 'Lỗi tải tệp tin: ' + err.message
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    // 1. Kiểm tra xem tệp tin có tồn tại trong request không
    if (!req.file) {
      console.error('❌ [UPLOAD_API:ERROR] Không tìm thấy tệp tin trong request! req.file = undefined');
      return res.status(400).json({ 
        status: 'error', 
        message: 'Không có tệp tin nào được gửi lên. Đảm bảo tên trường (field name) là "file".' 
      });
    }

    const file = req.file;

    // 2. Kiểm tra cấu hình Supabase Client
    if (!supabase) {
      console.error('❌ [UPLOAD_API:ERROR] Supabase client chưa được khởi tạo!');
      return res.status(500).json({
        status: 'error',
        message: 'Dịch vụ lưu trữ đám mây Supabase chưa được thiết lập hoặc thiếu biến môi trường.'
      });
    }

    const bucketName = process.env.SUPABASE_BUCKET || 'media';
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
    
    // Kiểm tra định dạng âm thanh để phân chia thư mục uploads vs chat-voice
    const isAudio = file.mimetype.startsWith('audio/') || ['m4a', 'aac', 'mp3', 'wav', 'webm', 'ogg'].includes(ext);
    let fileName;
    if (isAudio) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      fileName = `chat-voice/${year}/${month}/voice_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    } else {
      fileName = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    }

    console.log(`[UPLOAD_API:START] Khởi động upload tệp "${file.originalname}" (${file.size} bytes) lên bucket "${bucketName}/${fileName}"`);

    // 3. Upload buffer trực tiếp lên Supabase Storage
    const { error } = await supabase.storage
      .from(bucketName)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('❌ [UPLOAD_API:SUPABASE_ERROR] Supabase Storage upload failed:', error.message);
      return res.status(500).json({
        status: 'error',
        message: 'Lỗi Supabase Storage: ' + error.message
      });
    }

    // 4. Lấy Public URL của tệp vừa tải lên
    const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
    const fileUrl = publicData.publicUrl;

    console.log(`✨ [UPLOAD_API:SUCCESS] Tải lên Supabase thành công! URL: ${fileUrl}`);

    return res.status(200).json({
      status: 'success',
      message: 'Tải lên tệp thành công.',
      file_url: fileUrl,
      file_name: file.originalname
    });

  } catch (globalError) {
    console.error('❌ [UPLOAD_API:CRITICAL_ERROR]', globalError);
    return res.status(500).json({
      status: 'error',
      message: 'Lỗi hệ thống bất ngờ: ' + globalError.message
    });
  }
});

const voiceUploadLimits = {}; // Key: userId (number/string), Value: Array of timestamps

// POST /api/upload/sign-upload — lấy URL tải lên an toàn (Private Bucket)
router.post('/sign-upload', async (req, res) => {
  try {
    const { fileName, contentType, user_id } = req.body;
    if (!fileName) {
      return res.status(400).json({ status: 'error', message: 'Thiếu tham số fileName.' });
    }
    
    // Rate limiter: 20 uploads / 5 minutes / user
    if (user_id) {
      const now = Date.now();
      const fiveMinsAgo = now - 5 * 60 * 1000;
      if (!voiceUploadLimits[user_id]) {
        voiceUploadLimits[user_id] = [];
      }
      voiceUploadLimits[user_id] = voiceUploadLimits[user_id].filter(ts => ts > fiveMinsAgo);
      if (voiceUploadLimits[user_id].length >= 20) {
        return res.status(429).json({
          status: 'error',
          message: 'Bạn đã tải lên quá giới hạn (tối đa 20 tin nhắn thoại trong 5 phút). Vui lòng thử lại sau.'
        });
      }
      voiceUploadLimits[user_id].push(now);
    }

    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client chưa được khởi tạo.' });
    }

    const bucketName = process.env.SUPABASE_BUCKET || 'media';
    
    // Generate signed upload URL (ephemeral, valid for 15 minutes / 900 seconds)
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUploadUrl(fileName);

    if (error) {
      console.error('❌ [UPLOAD_API:SIGN_UPLOAD_ERROR]', error.message);
      return res.status(500).json({ status: 'error', message: 'Lỗi Supabase Storage: ' + error.message });
    }

    return res.status(200).json({
      status: 'success',
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path
    });
  } catch (err) {
    console.error('❌ [UPLOAD_API:SIGN_UPLOAD_CRITICAL]', err);
    return res.status(500).json({ status: 'error', message: 'Lỗi hệ thống: ' + err.message });
  }
});

// POST /api/upload/sign-read — lấy URL đọc an toàn thời hạn 15 phút
router.post('/sign-read', async (req, res) => {
  let msg = null;
  try {
    const { attachment_url, user_id, platform = 'unknown' } = req.body;
    console.log('attachment_url=', attachment_url);
    if (!attachment_url || !user_id) {
      return res.status(400).json({ status: 'error', message: 'Thiếu tham số: attachment_url hoặc user_id.' });
    }
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client chưa được khởi tạo.' });
    }

    // 1. Xác thực quyền tham gia cuộc hội thoại chứa tin nhắn này
    const { query } = require('../config/supabase');
    const msgCheck = await query(
      `SELECT id, conversation_id, attachment_mime_type, attachment_codec, attachment_duration 
       FROM messages 
       WHERE attachment_url = $1 OR original_attachment_url = $1 OR file_url = $1 LIMIT 1`,
      [attachment_url]
    );

    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tin nhắn chứa tệp tin này.' });
    }

    msg = msgCheck.rows[0];
    console.log('[VOICE_PLAYBACK_REQUEST]', {
      messageId: msg.id,
      conversationId: msg.conversation_id,
      mimeType: msg.attachment_mime_type,
      codec: msg.attachment_codec || 'unknown',
      duration: msg.attachment_duration || 0,
      platform
    });

    const conversationId = msg.conversation_id;
    
    const memberCheck = await query(
      `SELECT 1 FROM conversation_users 
       WHERE conversation_id = $1 AND user_id = $2 LIMIT 1`,
      [conversationId, parseInt(user_id)]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền truy cập cuộc hội thoại này.' });
    }

    // 2. Tách đường dẫn và sinh Signed URL (thời hạn 15 phút = 900 giây)
    const bucketName = process.env.SUPABASE_BUCKET || 'media';
    
    const marker = `/${bucketName}/`;
    const index = attachment_url.indexOf(marker);
    let path = attachment_url;
    if (index !== -1) {
      path = decodeURIComponent(attachment_url.substring(index + marker.length));
    }

    console.log('bucket=', bucketName);
    console.log('path=', path);

    console.log('calling createSignedUrl');
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(path, 900); // 15 phút

    console.log('signedUrl result', data);
    console.log('signedUrl error', error);

    if (error) {
      console.error('❌ [UPLOAD_API:SIGN_READ_ERROR]', error.message);
      console.log('[VOICE_PLAYBACK_FAIL]', {
        messageId: msg.id,
        conversationId: msg.conversation_id,
        mimeType: msg.attachment_mime_type,
        codec: msg.attachment_codec || 'unknown',
        duration: msg.attachment_duration || 0,
        error: error.message,
        platform
      });
      return res.status(500).json({ status: 'error', message: 'Lỗi Supabase Storage: ' + error.message });
    }

    console.log('[VOICE_PLAYBACK_SUCCESS]', {
      messageId: msg.id,
      conversationId: msg.conversation_id,
      mimeType: msg.attachment_mime_type,
      codec: msg.attachment_codec || 'unknown',
      duration: msg.attachment_duration || 0,
      platform
    });

    return res.status(200).json({
      status: 'success',
      signedUrl: data.signedUrl
    });
  } catch (err) {
    console.error('❌ [UPLOAD_API:SIGN_READ_CRITICAL]', err);
    console.log('[VOICE_PLAYBACK_FAIL]', {
      messageId: msg ? msg.id : null,
      conversationId: msg ? msg.conversation_id : null,
      error: err.message
    });
    return res.status(500).json({ status: 'error', message: 'Lỗi hệ thống: ' + err.message });
  }
});

module.exports = router;
