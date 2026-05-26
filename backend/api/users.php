<?php
// backend/api/users.php
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

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

switch ($method) {
    case 'GET':
        try {
            $query = "SELECT id, name, email, avatar, role, status, created_at FROM users ORDER BY id ASC";
            $stmt  = $pdo->prepare($query);
            $stmt->execute();
            $users = $stmt->fetchAll();

            http_response_code(200);
            echo json_encode([
                "status" => "success",
                "data"   => $users
            ], JSON_UNESCAPED_UNICODE);

        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                "status"  => "error",
                "message" => "Không thể truy vấn người dùng: " . $e->getMessage()
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));

        if (empty($data)) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Không nhận được dữ liệu."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Hành động 1: Cập nhật tên
        if (isset($data->action) && $data->action === 'update_name') {
            if (empty($data->id) || empty($data->name)) {
                http_response_code(400);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Thiếu mã tài khoản (id) hoặc tên mới (name)."
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }

            try {
                $query = "UPDATE users SET name = :name WHERE id = :id";
                $stmt  = $pdo->prepare($query);
                $stmt->bindValue(':name', $data->name);
                $stmt->bindValue(':id',   intval($data->id), PDO::PARAM_INT);

                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode([
                        "status"  => "success",
                        "message" => "Cập nhật họ tên thành công."
                    ], JSON_UNESCAPED_UNICODE);
                } else {
                    http_response_code(500);
                    echo json_encode([
                        "status"  => "error",
                        "message" => "Không thể cập nhật họ tên."
                    ], JSON_UNESCAPED_UNICODE);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Lỗi CSDL: " . $e->getMessage()
                ], JSON_UNESCAPED_UNICODE);
            }
            exit;
        }

        // Hành động 2: Cập nhật ảnh đại diện
        if (isset($data->action) && $data->action === 'update_avatar') {
            if (empty($data->id) || empty($data->avatar)) {
                http_response_code(400);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Thiếu mã tài khoản (id) hoặc đường dẫn ảnh đại diện mới (avatar)."
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }

            try {
                $query = "UPDATE users SET avatar = :avatar WHERE id = :id";
                $stmt  = $pdo->prepare($query);
                $stmt->bindValue(':avatar', $data->avatar);
                $stmt->bindValue(':id',     intval($data->id), PDO::PARAM_INT);

                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode([
                        "status"  => "success",
                        "message" => "Cập nhật ảnh đại diện thành công."
                    ], JSON_UNESCAPED_UNICODE);
                } else {
                    http_response_code(500);
                    echo json_encode([
                        "status"  => "error",
                        "message" => "Không thể cập nhật ảnh đại diện."
                    ], JSON_UNESCAPED_UNICODE);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Lỗi CSDL: " . $e->getMessage()
                ], JSON_UNESCAPED_UNICODE);
            }
            exit;
        }

        // Hành động 3: Tạo tài khoản mới
        $role     = $data->role     ?? 'user';
        $email    = $data->email    ?? '';
        $password = $data->password ?? '';

        if ($role === 'admin') {
            $name = 'Admin';
        } else {
            $name = !empty($data->name) ? trim($data->name) : 'Chưa đặt tên';
        }

        if (empty($email) || empty($password)) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Vui lòng cung cấp đầy đủ Email và Mật khẩu để cấp tài khoản mới."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        try {
            // Kiểm tra trùng lặp email
            $checkQuery = "SELECT id FROM users WHERE email = :email LIMIT 1";
            $checkStmt  = $pdo->prepare($checkQuery);
            $checkStmt->bindValue(':email', $email);
            $checkStmt->execute();

            if ($checkStmt->rowCount() > 0) {
                http_response_code(409);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Email này đã tồn tại trong hệ thống."
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }

            $hashedPassword = password_hash($password, PASSWORD_BCRYPT);
            $avatar = $data->avatar ?? 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80';
            $status = $data->status ?? 'active';

            // PostgreSQL: RETURNING id
            $insertQuery = "INSERT INTO users (name, email, password, avatar, role, status)
                            VALUES (:name, :email, :password, :avatar, :role, :status)
                            RETURNING id";
            $insertStmt  = $pdo->prepare($insertQuery);
            $insertStmt->bindValue(':name',     $name);
            $insertStmt->bindValue(':email',    $email);
            $insertStmt->bindValue(':password', $hashedPassword);
            $insertStmt->bindValue(':avatar',   $avatar);
            $insertStmt->bindValue(':role',     $role);
            $insertStmt->bindValue(':status',   $status);
            $insertStmt->execute();

            $newId = $insertStmt->fetchColumn();

            http_response_code(201);
            echo json_encode([
                "status"  => "success",
                "message" => "Tạo tài khoản mới thành công!",
                "data"    => [
                    "id"     => intval($newId),
                    "name"   => $name,
                    "email"  => $email,
                    "role"   => $role,
                    "status" => $status
                ]
            ], JSON_UNESCAPED_UNICODE);

        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                "status"  => "error",
                "message" => "Lỗi CSDL khi tạo tài khoản: " . $e->getMessage()
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode([
            "status"  => "error",
            "message" => "Phương thức HTTP không được hỗ trợ."
        ], JSON_UNESCAPED_UNICODE);
        break;
}
