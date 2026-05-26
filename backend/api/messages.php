<?php
// backend/api/messages.php
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
        $conversationId = isset($_GET['conversation_id']) ? intval($_GET['conversation_id']) : 0;
        $page           = isset($_GET['page'])  ? intval($_GET['page'])  : 1;
        $limit          = isset($_GET['limit']) ? intval($_GET['limit']) : 30;

        if ($conversationId <= 0) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Thiếu mã cuộc hội thoại (conversation_id) hợp lệ."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $offset = ($page - 1) * $limit;

        try {
            // PostgreSQL: LIMIT ... OFFSET ... (thay vì MySQL LIMIT offset, limit)
            $query = "SELECT
                        m.id              AS id,
                        m.conversation_id AS conversation_id,
                        m.sender_id       AS sender_id,
                        u.name            AS sender_name,
                        u.avatar          AS sender_avatar,
                        m.message         AS message,
                        m.type            AS type,
                        m.file_url        AS file_url,
                        m.created_at      AS created_at
                      FROM messages m
                      INNER JOIN users u ON m.sender_id = u.id
                      WHERE m.conversation_id = :conv_id
                      ORDER BY m.id DESC
                      LIMIT :limit OFFSET :offset";

            $stmt = $pdo->prepare($query);
            $stmt->bindValue(':conv_id', $conversationId, PDO::PARAM_INT);
            $stmt->bindValue(':limit',   $limit,          PDO::PARAM_INT);
            $stmt->bindValue(':offset',  $offset,         PDO::PARAM_INT);
            $stmt->execute();
            $messages = $stmt->fetchAll();

            // Format dữ liệu trả về
            $formattedMessages = [];
            foreach ($messages as $msg) {
                $formattedMessages[] = [
                    "id"              => intval($msg['id']),
                    "conversation_id" => intval($msg['conversation_id']),
                    "sender_id"       => intval($msg['sender_id']),
                    "sender_name"     => $msg['sender_name'],
                    "sender_avatar"   => $msg['sender_avatar'],
                    "message"         => $msg['message'],
                    "type"            => $msg['type'],
                    "file_url"        => $msg['file_url'],
                    "created_at"      => date('H:i', strtotime($msg['created_at'])),
                    "raw_time"        => $msg['created_at']
                ];
            }

            http_response_code(200);
            echo json_encode([
                "status"   => "success",
                "data"     => $formattedMessages,
                "page"     => $page,
                "limit"    => $limit,
                "has_more" => count($formattedMessages) === $limit
            ], JSON_UNESCAPED_UNICODE);

        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                "status"  => "error",
                "message" => "Lỗi truy vấn tin nhắn: " . $e->getMessage()
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));

        if (empty($data->conversation_id) || empty($data->sender_id) || empty($data->message)) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Vui lòng cung cấp đầy đủ: conversation_id, sender_id và nội dung tin nhắn."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $convId   = intval($data->conversation_id);
        $senderId = intval($data->sender_id);
        $message  = trim($data->message);
        $type     = $data->type    ?? 'text';
        $fileUrl  = $data->file_url ?? null;

        try {
            // PostgreSQL: RETURNING id để lấy ID vừa insert
            $query = "INSERT INTO messages (conversation_id, sender_id, message, type, file_url)
                      VALUES (:conv_id, :sender_id, :message, :type, :file_url)
                      RETURNING id";

            $stmt = $pdo->prepare($query);
            $stmt->bindValue(':conv_id',   $convId,   PDO::PARAM_INT);
            $stmt->bindValue(':sender_id', $senderId, PDO::PARAM_INT);
            $stmt->bindValue(':message',   $message);
            $stmt->bindValue(':type',      $type);
            $stmt->bindValue(':file_url',  $fileUrl);
            $stmt->execute();

            $msgId = $stmt->fetchColumn();

            // Lấy thông tin sender để trả về đầy đủ
            $userQuery = "SELECT name, avatar FROM users WHERE id = :sender_id LIMIT 1";
            $uStmt     = $pdo->prepare($userQuery);
            $uStmt->bindValue(':sender_id', $senderId, PDO::PARAM_INT);
            $uStmt->execute();
            $user = $uStmt->fetch();

            http_response_code(201);
            echo json_encode([
                "status" => "success",
                "data"   => [
                    "id"              => intval($msgId),
                    "conversation_id" => $convId,
                    "sender_id"       => $senderId,
                    "sender_name"     => $user['name'],
                    "sender_avatar"   => $user['avatar'],
                    "message"         => $message,
                    "type"            => $type,
                    "file_url"        => $fileUrl,
                    "created_at"      => date('H:i'),
                    "raw_time"        => date('Y-m-d H:i:s')
                ]
            ], JSON_UNESCAPED_UNICODE);

        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                "status"  => "error",
                "message" => "Lỗi CSDL khi lưu tin nhắn: " . $e->getMessage()
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
