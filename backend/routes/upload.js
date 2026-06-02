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
  limits: { fileSize: 10 * 1024 * 1024 }, // Tăng giới hạn tải lên tối đa lên 10MB cho cả video và ảnh lớn
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 
      'image/png', 
      'image/gif', 
      'image/webp',
      'video/mp4', 
      'video/quicktime',
      'video/mpeg'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Định dạng tệp không hỗ trợ (${file.mimetype}). Chỉ chấp nhận JPEG, PNG, GIF, WEBP và MP4/MOV.`));
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
    const fileName = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

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

module.exports = router;
