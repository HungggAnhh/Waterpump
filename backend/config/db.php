<?php
// backend/config/db.php
// Kết nối Supabase PostgreSQL qua PDO

function loadEnv($path) {
    if (!file_exists($path)) return;
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) continue;
        if (strpos($line, '=') !== false) {
            list($name, $value) = explode('=', $line, 2);
            // Xóa dấu ngoặc kép nếu có
            $_ENV[trim($name)] = trim(trim($value), '"');
        }
    }
}

// Tải file .env từ thư mục gốc backend
loadEnv(__DIR__ . '/../.env');

// Đọc DATABASE_URL từ .env (format Supabase/PostgreSQL)
$databaseUrl = $_ENV['DATABASE_URL'] ?? '';

if (empty($databaseUrl)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode([
        "status" => "error",
        "message" => "Thiếu biến môi trường DATABASE_URL trong file .env"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Parse DATABASE_URL: postgresql://user:password@host:port/dbname
$parsed = parse_url($databaseUrl);
$pgHost   = $parsed['host']   ?? 'localhost';
$pgPort   = $parsed['port']   ?? 5432;
$pgUser   = rawurldecode($parsed['user']   ?? 'postgres');
$pgPass   = rawurldecode($parsed['pass']   ?? '');
$pgDbname = ltrim($parsed['path'] ?? '/postgres', '/');

try {
    $dsn = "pgsql:host={$pgHost};port={$pgPort};dbname={$pgDbname};sslmode=require";
    $pdo = new PDO($dsn, $pgUser, $pgPass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false, // Dùng prepared statements thực sự của PostgreSQL
    ]);
} catch (PDOException $e) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode([
        "status"  => "error",
        "message" => "Kết nối Supabase thất bại: " . $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
