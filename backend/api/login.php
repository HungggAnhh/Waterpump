<?php
// backend/api/login.php

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

// Kết nối CSDL
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'POST';

if ($method === 'POST') {
    // Lấy dữ liệu từ body request (JSON)
    $data = json_decode(file_get_contents("php://input"));
    
    if (!empty($data->email) && !empty($data->password)) {
        try {
            $query = "SELECT id, name, email, password, avatar, role, status FROM users WHERE email = :email LIMIT 1";
            $stmt = $pdo->prepare($query);
            $stmt->bindValue(':email', $data->email);
            $stmt->execute();
            
            if ($stmt->rowCount() > 0) {
                $user = $stmt->fetch();
                
                // Kiểm tra trạng thái tài khoản
                if ($user['status'] !== 'active') {
                    http_response_code(403);
                    echo json_encode([
                        "status" => "error",
                        "message" => "Tài khoản của bạn chưa được kích hoạt hoặc đã bị khóa bởi Admin."
                    ], JSON_UNESCAPED_UNICODE);
                    exit;
                }

                // Kiểm tra mật khẩu (Hỗ trợ cả bcrypt hash và mật khẩu trơn để an toàn/tương thích ngược)
                if (password_verify($data->password, $user['password']) || $data->password === $user['password']) {
                    // Xóa trường mật khẩu trước khi trả về
                    unset($user['password']);
                    
                    // Tạo JWT Token nhẹ chuẩn Production (stateless)
                    $header = base64_encode(json_encode(["alg" => "HS256", "typ" => "JWT"]));
                    $payload = base64_encode(json_encode([
                        "id" => $user['id'],
                        "email" => $user['email'],
                        "role" => $user['role'],
                        "exp" => time() + (3600 * 24 * 30) // Hạn 30 ngày
                    ]));
                    $signature = hash_hmac('sha256', "$header.$payload", 'SecretCompanyKeySecret_9988');
                    $token = "$header.$payload.$signature";
                    
                    http_response_code(200);
                    echo json_encode([
                        "status" => "success",
                        "message" => "Đăng nhập thành công.",
                        "token" => $token,
                        "data" => $user
                    ], JSON_UNESCAPED_UNICODE);
                } else {
                    http_response_code(401);
                    echo json_encode([
                        "status" => "error",
                        "message" => "Mật khẩu không chính xác."
                    ], JSON_UNESCAPED_UNICODE);
                }
            } else {
                http_response_code(401); // Sử dụng 401 (Unauthorized) thay vì 404 để tránh gây nhầm lẫn "không tìm thấy file"
                echo json_encode([
                    "status" => "error",
                    "message" => "Email người dùng không tồn tại trong hệ thống."
                ], JSON_UNESCAPED_UNICODE);
            }
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                "status" => "error",
                "message" => "Lỗi truy vấn CSDL: " . $e->getMessage()
            ], JSON_UNESCAPED_UNICODE);
        }
    } else {
        http_response_code(400);
        echo json_encode([
            "status" => "error",
            "message" => "Vui lòng cung cấp đầy đủ email và mật khẩu."
        ], JSON_UNESCAPED_UNICODE);
    }
} else {
    http_response_code(405);
    echo json_encode([
        "status" => "error",
        "message" => "Phương thức HTTP không được hỗ trợ. Chỉ hỗ trợ POST."
    ], JSON_UNESCAPED_UNICODE);
}
