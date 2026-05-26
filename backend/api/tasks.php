<?php
// backend/api/tasks.php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
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
            // PostgreSQL: không cần backtick, dùng dấu nháy kép hoặc không có
            $query = "SELECT
                        t.id             AS id,
                        t.title          AS title,
                        t.description    AS description,
                        t.status         AS status,
                        t.priority       AS priority,
                        t.due_date       AS due_date,
                        t.boss_checked   AS boss_checked,
                        t.created_at     AS created_at,
                        u.name           AS assignee_name,
                        u.avatar         AS assignee_avatar,
                        u.role           AS assignee_role
                      FROM tasks t
                      LEFT JOIN users u ON t.assignee_id = u.id
                      ORDER BY t.id ASC";

            $stmt = $pdo->prepare($query);
            $stmt->execute();
            $tasks = $stmt->fetchAll();

            // Normalize boss_checked: PostgreSQL trả về bool/string 't'/'f'
            foreach ($tasks as &$task) {
                $task['boss_checked'] = ($task['boss_checked'] === true || $task['boss_checked'] === 't' || $task['boss_checked'] == 1) ? 1 : 0;
            }
            unset($task);

            http_response_code(200);
            echo json_encode([
                "status" => "success",
                "data"   => $tasks
            ], JSON_UNESCAPED_UNICODE);

        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                "status"  => "error",
                "message" => "Không thể lấy danh sách công việc: " . $e->getMessage()
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));

        if (empty($data)) {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Không nhận được dữ liệu yêu cầu."
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Hành động 1: Cập nhật trạng thái (status)
        if (isset($data->action) && $data->action === 'update_status') {
            if (!isset($data->id) || !isset($data->status)) {
                http_response_code(400);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Thiếu mã công việc (id) hoặc trạng thái (status) mới."
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }

            try {
                $query = "UPDATE tasks SET status = :status WHERE id = :id";
                $stmt  = $pdo->prepare($query);
                $stmt->bindValue(':status', $data->status);
                $stmt->bindValue(':id',     intval($data->id), PDO::PARAM_INT);

                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode([
                        "status"  => "success",
                        "message" => "Cập nhật trạng thái công việc thành công."
                    ], JSON_UNESCAPED_UNICODE);
                } else {
                    http_response_code(500);
                    echo json_encode([
                        "status"  => "error",
                        "message" => "Không thể cập nhật trạng thái."
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

        // Hành động 2: Toggle "Sếp đã check"
        if (isset($data->action) && $data->action === 'toggle_boss_check') {
            if (!isset($data->id) || !isset($data->boss_checked)) {
                http_response_code(400);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Thiếu mã công việc (id) hoặc trạng thái boss_checked."
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }

            try {
                // PostgreSQL: boss_checked là BOOLEAN, dùng true/false
                $bossChecked = ($data->boss_checked == 1 || $data->boss_checked === true) ? 'TRUE' : 'FALSE';
                $query = "UPDATE tasks SET boss_checked = {$bossChecked} WHERE id = :id";
                $stmt  = $pdo->prepare($query);
                $stmt->bindValue(':id', intval($data->id), PDO::PARAM_INT);

                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode([
                        "status"  => "success",
                        "message" => "Đã cập nhật phê duyệt của Sếp."
                    ], JSON_UNESCAPED_UNICODE);
                } else {
                    http_response_code(500);
                    echo json_encode([
                        "status"  => "error",
                        "message" => "Không thể cập nhật trạng thái duyệt."
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

        // Hành động 3: Tạo mới công việc
        if (!empty($data->title)) {
            try {
                // PostgreSQL: RETURNING id thay vì lastInsertId()
                $query = "INSERT INTO tasks (title, description, status, priority, due_date, assignee_id, created_by, boss_checked)
                          VALUES (:title, :description, :status, :priority, :due_date, :assignee_id, :created_by, FALSE)
                          RETURNING id";

                $stmt = $pdo->prepare($query);
                $stmt->bindValue(':title',       $data->title);
                $stmt->bindValue(':description', $data->description ?? null);
                $stmt->bindValue(':status',      $data->status   ?? 'todo');
                $stmt->bindValue(':priority',    $data->priority  ?? 'medium');
                $stmt->bindValue(':due_date',    $data->due_date  ?? null);
                $stmt->bindValue(':assignee_id', isset($data->assignee_id) ? intval($data->assignee_id) : null, PDO::PARAM_INT);
                $stmt->bindValue(':created_by',  isset($data->created_by)  ? intval($data->created_by)  : 1,    PDO::PARAM_INT);
                $stmt->execute();

                $taskId = $stmt->fetchColumn();

                http_response_code(201);
                echo json_encode([
                    "status"  => "success",
                    "message" => "Công việc đã được tạo thành công.",
                    "task_id" => intval($taskId)
                ], JSON_UNESCAPED_UNICODE);

            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode([
                    "status"  => "error",
                    "message" => "Lỗi CSDL khi tạo công việc: " . $e->getMessage()
                ], JSON_UNESCAPED_UNICODE);
            }
        } else {
            http_response_code(400);
            echo json_encode([
                "status"  => "error",
                "message" => "Không thể tạo công việc. Vui lòng cung cấp tiêu đề (title)."
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
