// backend/routes/upload.js
// Upload ảnh lên Supabase Storage
const express = require('express');
const multer  = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: __dirname + '/../.env' });

const router = express.Router();

// Khởi tạo Supabase client để upload Storage
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Multer: lưu vào memory (rồi push thẳng lên Supabase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Định dạng tệp không được hỗ trợ.'));
  }
});

// POST /api/upload
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Không có tệp tin nào được tải lên.' });
  }

  const file     = req.file;
  const ext      = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
  const fileName = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  // Nếu đã cấu hình Supabase Storage — upload lên cloud
  if (supabase && supabaseUrl) {
    try {
      const bucketName = process.env.SUPABASE_BUCKET || 'media';
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) throw error;

      const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
      const fileUrl = publicData.publicUrl;

      return res.status(200).json({
        status:    'success',
        message:   'Tải lên tệp thành công.',
        file_url:  fileUrl,
        file_name: file.originalname,
      });
    } catch (err) {
      console.error('Supabase Storage upload error:', err.message);
      return res.status(500).json({ status: 'error', message: 'Lỗi tải lên Supabase Storage: ' + err.message });
    }
  }

  // Fallback: lưu local (khi chưa cấu hình Supabase Storage)
  const path = require('path');
  const fs   = require('fs');
  const localDir  = path.join(__dirname, '../uploads');
  const localPath = path.join(localDir, `${Date.now()}.${ext}`);

  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(localPath, file.buffer);

  const protocol = req.protocol;
  const host     = req.get('host');
  const fileUrl  = `${protocol}://${host}/uploads/${path.basename(localPath)}`;

  return res.status(200).json({
    status:    'success',
    message:   'Tải lên tệp thành công (local).',
    file_url:  fileUrl,
    file_name: file.originalname,
  });
});

module.exports = router;
