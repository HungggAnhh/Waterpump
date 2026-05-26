<?php
// backend/api/conversations.php
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
        $userId = isset($_GET['user_id']) ? intval($_GET['user_id']) : 0;

        if ($userId <= 0) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Thiếu mã người dùng (user_id) hợp lệ."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        try {
            // Tự động tạo cuộc hội thoại direct với tất cả người dùng khác nếu chưa có
            $usersQuery = "SELECT id FROM users WHERE id != :user_id AND status = 'active'";
            $uStmt = $pdo->prepare($usersQuery);
            $uStmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
            $uStmt->execute();
            $allOtherUsers = $uStmt->fetchAll();

            foreach ($allOtherUsers as $other) {
                $otherId = intval($other['id']);

                // PostgreSQL: dùng dấu nháy đơn cho string, không cần backtick
                $checkQuery = "SELECT cu1.conversation_id
                               FROM conversation_users cu1
                               INNER JOIN conversation_users cu2 ON cu1.conversation_id = cu2.conversation_id
                               INNER JOIN conversations c ON cu1.conversation_id = c.id
                               WHERE c.type = 'direct'
                                 AND cu1.user_id = :user_id
                                 AND cu2.user_id = :recipient_id
                               LIMIT 1";

                $cStmt = $pdo->prepare($checkQuery);
                $cStmt->bindValue(':user_id',     $userId,  PDO::PARAM_INT);
                $cStmt->bindValue(':recipient_id', $otherId, PDO::PARAM_INT);
                $cStmt->execute();

                if ($cStmt->rowCount() === 0) {
                    try {
                        $pdo->beginTransaction();

                        // PostgreSQL: dùng RETURNING id để lấy ID vừa insert
                        $insertConv = "INSERT INTO conversations (name, type) VALUES (NULL, 'direct') RETURNING id";
                        $convStmt   = $pdo->query($insertConv);
                        $convId     = $convStmt->fetchColumn();

                        $insertMembers = "INSERT INTO conversation_users (conversation_id, user_id) VALUES
                                          (:conv_id1, :user_id1),
                                          (:conv_id2, :user_id2)";
                        $mStmt = $pdo->prepare($insertMembers);
                        $mStmt->bindValue(':conv_id1', $convId,  PDO::PARAM_INT);
                        $mStmt->bindValue(':user_id1', $userId,  PDO::PARAM_INT);
                        $mStmt->bindValue(':conv_id2', $convId,  PDO::PARAM_INT);
                        $mStmt->bindValue(':user_id2', $otherId, PDO::PARAM_INT);
                        $mStmt->execute();

                        $pdo->commit();
                    } catch (Exception $txEx) {
                        if ($pdo->inTransaction()) $pdo->rollBack();
                    }
                }
            }

            // PostgreSQL: subquery ORDER BY phải có alias
            // Lấy danh sách cuộc trò chuyện của user
            $query = "SELECT
                        c.id          AS id,
                        c.name        AS name,
                        c.type        AS type,
                        c.created_at  AS created_at,
                        m.message     AS lastMessage,
                        m.type        AS lastMessageType,
                        m.created_at  AS lastMessageTime,
                        m.sender_id   AS lastMessageSenderId
                      FROM conversations c
                      INNER JOIN conversation_users cu ON c.id = cu.conversation_id
                      LEFT JOIN messages m ON m.id = (
                          SELECT id FROM messages
                          WHERE conversation_id = c.id
                          ORDER BY id DESC
                          LIMIT 1
                      )
                      WHERE cu.user_id = :user_id
                      ORDER BY COALESCE(m.created_at, c.created_at) DESC";

            $stmt = $pdo->prepare($query);
            $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
            $stmt->execute();
            $conversations = $stmt->fetchAll();

            $resultData = [];

            foreach ($conversations as $conv) {
                $membersQuery = "SELECT cu.user_id, u.name, u.avatar, u.role, u.email
                                 FROM conversation_users cu
                                 INNER JOIN users u ON cu.user_id = u.id
                                 WHERE cu.conversation_id = :conv_id";
                $mStmt = $pdo->prepare($membersQuery);
                $mStmt->bindValue(':conv_id', $conv['id'], PDO::PARAM_INT);
                $mStmt->execute();
                $members = $mStmt->fetchAll();

                $otherMembers = array_values(array_filter($members, function ($member) use ($userId) {
                    return intval($member['user_id']) !== $userId;
                }));

                $convName   = $conv['name'];
                $convAvatar = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=150&h=150&q=80';
                $otherUser  = null;

                if ($conv['type'] === 'direct') {
                    if (count($otherMembers) > 0) {
                        $otherUser  = $otherMembers[0];
                        $convName   = $otherUser['name'];
                        $convAvatar = $otherUser['avatar'];
                    } else {
                        $convName   = "Tài khoản của bạn";
                        $convAvatar = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80";
                    }
                }

                $resultData[] = [
                    "id"                 => strval($conv['id']),
                    "name"               => $convName,
                    "avatar"             => $convAvatar,
                    "type"               => $conv['type'],
                    "lastMessage"        => $conv['lastmessage'] ?? $conv['lastMessage'] ?? '',
                    "lastMessageType"    => $conv['lastmessagetype'] ?? $conv['lastMessageType'] ?? 'text',
                    "time"               => $conv['lastmessagetime'] ? date('H:i', strtotime($conv['lastmessagetime'])) : ($conv['lastMessageTime'] ? date('H:i', strtotime($conv['lastMessageTime'])) : ''),
                    "rawTime"            => $conv['lastmessagetime'] ?? $conv['lastMessageTime'] ?? $conv['created_at'],
                    "unreadCount"        => 0,
                    "online"             => false,
                    "members"            => $members,
                    "otherUser"          => $otherUser
                ];
            }

            http_response_code(200);
            echo json_encode([
                "status" => "success",
                "data"   => $resultData
            ], JSON_UNESCAPED_UNICODE);

        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                "status"  => "error",
                "message" => "Lỗi truy vấn cuộc trò chuyện: " . $e->getMessage()
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));

        if (empty($data->user_id) || empty($data->recipient_id)) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Vui lòng cung cấp đầy đủ user_id và recipient_id."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $userId      = intval($data->user_id);
        $recipientId = intval($data->recipient_id);

        if ($userId === $recipientId) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Không thể tạo cuộc trò chuyện với chính mình."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        try {
            $checkQuery = "SELECT cu1.conversation_id
                           FROM conversation_users cu1
                           INNER JOIN conversation_users cu2 ON cu1.conversation_id = cu2.conversation_id
                           INNER JOIN conversations c ON cu1.conversation_id = c.id
                           WHERE c.type = 'direct'
                             AND cu1.user_id = :user_id
                             AND cu2.user_id = :recipient_id
                           LIMIT 1";

            $stmt = $pdo->prepare($checkQuery);
            $stmt->bindValue(':user_id',      $userId,      PDO::PARAM_INT);
            $stmt->bindValue(':recipient_id', $recipientId, PDO::PARAM_INT);
            $stmt->execute();

            if ($stmt->rowCount() > 0) {
                $existing = $stmt->fetch();
                http_response_code(200);
                echo json_encode([
                    "status"          => "success",
                    "conversation_id" => strval($existing['conversation_id']),
                    "message"         => "Sử dụng cuộc hội thoại đã tồn tại."
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }

            $pdo->beginTransaction();

            // PostgreSQL: RETURNING id
            $insertConv = "INSERT INTO conversations (name, type) VALUES (NULL, 'direct') RETURNING id";
            $convStmt   = $pdo->query($insertConv);
            $convId     = $convStmt->fetchColumn();

            $insertMembers = "INSERT INTO conversation_users (conversation_id, user_id) VALUES
                              (:conv_id1, :user_id1),
                              (:conv_id2, :user_id2)";
            $mStmt = $pdo->prepare($insertMembers);
            $mStmt->bindValue(':conv_id1', $convId,      PDO::PARAM_INT);
            $mStmt->bindValue(':user_id1', $userId,      PDO::PARAM_INT);
            $mStmt->bindValue(':conv_id2', $convId,      PDO::PARAM_INT);
            $mStmt->bindValue(':user_id2', $recipientId, PDO::PARAM_INT);
            $mStmt->execute();

            $pdo->commit();

            http_response_code(201);
            echo json_encode([
                "status"          => "success",
                "conversation_id" => strval($convId),
                "message"         => "Tạo cuộc trò chuyện cá nhân mới thành công."
            ], JSON_UNESCAPED_UNICODE);

        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            http_response_code(500);
            echo json_encode([
                "status"  => "error",
                "message" => "Lỗi CSDL khi tạo cuộc hội thoại: " . $e->getMessage()
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode([
            "status"  => "error",
            "message" => "Không hỗ trợ phương thức HTTP này."
        ], JSON_UNESCAPED_UNICODE);
        break;
}
