<?php
// backend/config/init_db.php
// Tự động import schema.sql vào cơ sở dữ liệu MySQL

header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/db.php';

try {
    $schemaFile = __DIR__ . '/../database/schema.sql';
    if (!file_exists($schemaFile)) {
        throw new Exception("Không tìm thấy file schema.sql tại " . $schemaFile);
    }

    $sql = file_get_contents($schemaFile);
    
    // Thực thi toàn bộ lệnh SQL
    $pdo->exec($sql);
    
    echo json_encode([
        "status" => "success",
        "message" => "Khởi tạo cơ sở dữ liệu và dữ liệu mẫu thành công!"
    ], JSON_UNESCAPED_UNICODE);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        "status" => "error",
        "message" => "Lỗi khi khởi tạo CSDL: " . $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);
}
