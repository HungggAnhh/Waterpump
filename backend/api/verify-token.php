<?php
// backend/api/verify-token.php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Max-Age: 3600");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/../config/db.php';

// 1. Lấy token từ Headers hoặc Params
$token = null;
$headers = getallheaders();

if (isset($headers['Authorization'])) {
    $authHeader = $headers['Authorization'];
} elseif (isset($headers['authorization'])) {
    $authHeader = $headers['authorization'];
} elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
} else {
    $authHeader = '';
}

if (!empty($authHeader) && preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
    $token = $matches[1];
} elseif (isset($_GET['token'])) {
    $token = $_GET['token'];
} elseif (isset($_POST['token'])) {
    $token = $_POST['token'];
}

if (!$token) {
    http_response_code(400);
    echo json_encode([
        "status" => "error",
        "message" => "Thiếu mã xác thực (Token)."
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    // 2. Phân tích cú pháp JWT Token (Header.Payload.Signature)
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        throw new Exception("Mã xác thực không hợp lệ định dạng.");
    }

    $headerStr = $parts[0];
    $payloadStr = $parts[1];
    $signatureReceived = $parts[2];

    // 3. Kiểm tra chữ ký (Signature Verification)
    $signatureCalculated = hash_hmac('sha256', "$headerStr.$payloadStr", 'SecretCompanyKeySecret_9988');
    if ($signatureReceived !== $signatureCalculated) {
        throw new Exception("Mã xác thực chữ ký sai lệch hoặc đã bị chỉnh sửa.");
    }

    // 4. Giải mã payload
    $payload = json_decode(base64_decode($payloadStr), true);
    if (!$payload || !isset($payload['id']) || !isset($payload['exp'])) {
        throw new Exception("Nội dung mã xác thực bị hỏng.");
    }

    // 5. Kiểm tra thời gian hết hạn (Expiration Check)
    if (time() > $payload['exp']) {
        http_response_code(401);
        echo json_encode([
            "status" => "error",
            "message" => "Mã xác thực đã hết hạn. Vui lòng đăng nhập lại."
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // 6. Kiểm tra người dùng trong CSDL
    $userId = intval($payload['id']);
    $query = "SELECT id, name, email, avatar, role, status FROM users WHERE id = :id LIMIT 1";
    $stmt = $pdo->prepare($query);
    $stmt->bindValue(':id', $userId, PDO::PARAM_INT);
    $stmt->execute();

    if ($stmt->rowCount() > 0) {
        $user = $stmt->fetch();

        // Kiểm tra trạng thái hoạt động
        if ($user['status'] !== 'active') {
            http_response_code(403);
            echo json_encode([
                "status" => "error",
                "message" => "Tài khoản của bạn đã bị khóa hoặc ngừng kích hoạt."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        http_response_code(200);
        echo json_encode([
            "status" => "success",
            "message" => "Xác thực token thành công.",
            "data" => $user
        ], JSON_UNESCAPED_UNICODE);
    } else {
        http_response_code(401);
        echo json_encode([
            "status" => "error",
            "message" => "Người dùng không tồn tại trên hệ thống."
        ], JSON_UNESCAPED_UNICODE);
    }

} catch (Exception $e) {
    http_response_code(401);
    echo json_encode([
        "status" => "error",
        "message" => "Xác thực thất bại: " . $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);
}
