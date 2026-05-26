<?php
// backend/api/upload.php

// Thêm các header CORS
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Max-Age: 3600");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

// Xử lý request preflight OPTIONS
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Hàm nén và thu nhỏ ảnh tự động bằng GD Library chuẩn Production
function compressImage($sourcePath, $destinationPath, $quality = 75) {
    // Kiểm tra xem thư viện GD có được kích hoạt trên XAMPP không để tránh lỗi Fatal Error
    if (!function_exists('imagecreatefromjpeg') || 
        !function_exists('imagecreatetruecolor') || 
        !function_exists('imagecopyresampled')) {
        return false;
    }

    $info = getimagesize($sourcePath);
    if ($info === false) {
        return false;
    }
    
    $mime = $info['mime'];
    
    // Khởi tạo đối tượng hình ảnh dựa trên loại tệp tin
    switch ($mime) {
        case 'image/jpeg':
            $image = @imagecreatefromjpeg($sourcePath);
            break;
        case 'image/png':
            $image = @imagecreatefrompng($sourcePath);
            if ($image) {
                imagealphablending($image, false);
                imagesavealpha($image, true);
            }
            break;
        case 'image/gif':
            $image = @imagecreatefromgif($sourcePath);
            break;
        default:
            return false;
    }
    
    if (!$image) {
        return false;
    }
    
    // Tự động thay đổi kích thước nếu ảnh quá lớn (Ví dụ chiều rộng/cao vượt quá 1080px)
    $width = imagesx($image);
    $height = imagesy($image);
    $maxDim = 1080;
    
    if ($width > $maxDim || $height > $maxDim) {
        $ratio = $width / $height;
        if ($ratio > 1) {
            $newWidth = $maxDim;
            $newHeight = round($maxDim / $ratio);
        } else {
            $newHeight = $maxDim;
            $newWidth = round($maxDim * $ratio);
        }
        
        $resizedImage = imagecreatetruecolor($newWidth, $newHeight);
        if ($mime == 'image/png' || $mime == 'image/gif') {
            imagealphablending($resizedImage, false);
            imagesavealpha($resizedImage, true);
        }
        
        imagecopyresampled($resizedImage, $image, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
        imagedestroy($image);
        $image = $resizedImage;
    }
    
    // Ghi tệp nén xuống ổ đĩa
    $success = false;
    switch ($mime) {
        case 'image/jpeg':
            $success = imagejpeg($image, $destinationPath, $quality);
            break;
        case 'image/png':
            $pngQuality = round((100 - $quality) / 10); // 0 (no compression) to 9 (max compression)
            $success = imagepng($image, $destinationPath, $pngQuality);
            break;
        case 'image/gif':
            $success = imagegif($image, $destinationPath);
            break;
    }
    
    imagedestroy($image);
    return $success;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'POST';

if ($method === 'POST') {
    // Kiểm tra xem có file tải lên không
    if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
        $fileTmpPath = $_FILES['file']['tmp_name'];
        $fileName = $_FILES['file']['name'];
        $fileSize = $_FILES['file']['size'];
        $fileType = $_FILES['file']['type'];
        
        $fileNameCmps = explode(".", $fileName);
        $fileExtension = strtolower(end($fileNameCmps));
        
        // Tạo tên tệp độc nhất để tránh trùng lặp
        $newFileName = md5(time() . $fileName) . '.' . $fileExtension;
        
        // Các đuôi file được phép tải lên (Hỗ trợ thêm các định dạng video chuẩn di động)
        $allowedFileExtensions = array('jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'mp4', 'mov', 'avi', '3gp', 'quicktime');
        
        if (in_array($fileExtension, $allowedFileExtensions)) {
            // Giới hạn dung lượng: 5MB
            if ($fileSize < 5 * 1024 * 1024) {
                // Thư mục lưu trữ
                $uploadFileDir = __DIR__ . '/../uploads/';
                
                // Tự động tạo thư mục nếu chưa tồn tại
                if (!file_exists($uploadFileDir)) {
                    mkdir($uploadFileDir, 0755, true);
                }
                
                $dest_path = $uploadFileDir . $newFileName;
                
                // Nén và resize nếu là tệp ảnh
                $isImage = in_array($fileExtension, array('jpg', 'jpeg', 'png', 'gif'));
                $uploadSuccess = false;
                
                if ($isImage) {
                    $uploadSuccess = compressImage($fileTmpPath, $dest_path, 80);
                }
                
                // Fallback nếu không phải ảnh hoặc nén lỗi
                if (!$uploadSuccess) {
                    $uploadSuccess = move_uploaded_file($fileTmpPath, $dest_path);
                }
                
                if ($uploadSuccess) {
                    // Tạo đường dẫn URL đầy đủ (giả định chạy trên localhost)
                    $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http";
                    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
                    
                    // Lấy đường dẫn tương đối từ htdocs
                    $scriptDir = dirname($_SERVER['SCRIPT_NAME']); // ví dụ: /app-assign-tasks/api
                    $parentDir = dirname($scriptDir); // ví dụ: /app-assign-tasks
                    $fileUrl = $protocol . "://" . $host . $parentDir . "/uploads/" . $newFileName;
                    
                    http_response_code(200);
                    echo json_encode([
                        "status" => "success",
                        "message" => "Tải lên tệp thành công.",
                        "file_url" => $fileUrl,
                        "file_name" => $fileName
                    ], JSON_UNESCAPED_UNICODE);
                } else {
                    http_response_code(500);
                    echo json_encode([
                        "status" => "error",
                        "message" => "Có lỗi xảy ra khi lưu tệp vào thư mục lưu trữ."
                    ], JSON_UNESCAPED_UNICODE);
                }
            } else {
                http_response_code(400);
                echo json_encode([
                    "status" => "error",
                    "message" => "Dung lượng tệp vượt quá giới hạn cho phép (Tối đa 5MB)."
                ], JSON_UNESCAPED_UNICODE);
            }
        } else {
            http_response_code(400);
            echo json_encode([
                "status" => "error",
                "message" => "Định dạng tệp không được hỗ trợ. Chỉ cho phép các định dạng: " . implode(', ', $allowedFileExtensions)
            ], JSON_UNESCAPED_UNICODE);
        }
    } else {
        http_response_code(400);
        $errorCode = $_FILES['file']['error'] ?? 'Không tìm thấy file gửi lên';
        echo json_encode([
            "status" => "error",
            "message" => "Không có tệp tin nào được tải lên hoặc xuất hiện lỗi: " . $errorCode
        ], JSON_UNESCAPED_UNICODE);
    }
} else {
    http_response_code(405);
    echo json_encode([
        "status" => "error",
        "message" => "Phương thức HTTP không được hỗ trợ. Chỉ hỗ trợ POST."
    ], JSON_UNESCAPED_UNICODE);
}
