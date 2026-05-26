-- backend/database/schema.sql
-- Kịch bản khởi tạo Cơ sở dữ liệu và dữ liệu mẫu nâng cấp cho Notion tasks & Realtime Chat

CREATE DATABASE IF NOT EXISTS `App-Assign tasks` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `App-Assign tasks`;

DROP TABLE IF EXISTS `messages`;
DROP TABLE IF EXISTS `conversation_users`;
DROP TABLE IF EXISTS `conversations`;
DROP TABLE IF EXISTS `tasks`;
DROP TABLE IF EXISTS `users`;

-- 1. Bảng Users (Thành viên hệ thống)
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(100) UNIQUE NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `avatar` VARCHAR(255) NULL,
    `role` ENUM('admin', 'user') DEFAULT 'user',
    `status` ENUM('active', 'inactive') DEFAULT 'active',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng Tasks (Quản lý công việc)
CREATE TABLE IF NOT EXISTS `tasks` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('todo', 'in_progress', 'completed') DEFAULT 'todo',
    `priority` ENUM('low', 'medium', 'high') DEFAULT 'medium',
    `due_date` DATE NULL,
    `assignee_id` INT NULL,
    `created_by` INT NULL,
    `boss_checked` TINYINT DEFAULT 0, -- Cột xác nhận 'Sếp đã check' để tối màu task
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng Conversations (Cuộc trò chuyện)
CREATE TABLE IF NOT EXISTS `conversations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255) NULL, -- Tên nhóm chat (nếu là chat direct thì để NULL)
    `type` ENUM('direct', 'group') DEFAULT 'direct',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Bảng Conversation Users (Liên kết hội thoại và người dùng)
CREATE TABLE IF NOT EXISTS `conversation_users` (
    `conversation_id` INT NOT NULL,
    `user_id` INT NOT NULL,
    `joined_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`conversation_id`, `user_id`),
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Bảng Messages (Tin nhắn chi tiết trong cuộc trò chuyện)
CREATE TABLE IF NOT EXISTS `messages` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `conversation_id` INT NOT NULL,
    `sender_id` INT NOT NULL,
    `message` TEXT NOT NULL,
    `type` ENUM('text', 'image', 'file') DEFAULT 'text',
    `file_url` VARCHAR(255) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Chèn Dữ liệu Mẫu (Seeding Data)
-- Admin có tên mặc định là 'Admin'. Các User thường lúc đầu khởi tạo sẽ có tên là 'Chưa đặt tên'
-- để khi đăng nhập lần đầu tiên họ sẽ được yêu cầu nhập họ tên thực tế của mình.
INSERT INTO `users` (`id`, `name`, `email`, `password`, `avatar`, `role`, `status`) VALUES
(1, 'Admin', 'pm@company.com', '$2b$10$LR6LJOjxM6OT6jMT4HPvt.tMZOQHV66fiQlIAfr8BRPEL4mjuzDr.', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80', 'admin', 'active'),
(2, 'Chưa đặt tên', 'dev@company.com', '$2b$10$LR6LJOjxM6OT6jMT4HPvt.tMZOQHV66fiQlIAfr8BRPEL4mjuzDr.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150&q=80', 'user', 'active'),
(3, 'Chưa đặt tên', 'designer@company.com', '$2b$10$LR6LJOjxM6OT6jMT4HPvt.tMZOQHV66fiQlIAfr8BRPEL4mjuzDr.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&h=150&q=80', 'user', 'active');

-- Chèn dữ liệu thật khớp hoàn hảo 100% với ảnh chụp Notion workspace của người dùng
INSERT INTO `tasks` (`id`, `title`, `description`, `status`, `priority`, `due_date`, `assignee_id`, `created_by`, `boss_checked`) VALUES
(1, 'Cài viber', 'Cài đặt Viber cho đội ngũ kỹ thuật', 'in_progress', 'medium', '2026-05-28', 2, 1, 0),
(2, 'thiết kế phần quản lý sản xuất vi phun sương', 'Thiết kế cấu trúc bảng quản lý hệ thống máy vi phun sương', 'completed', 'high', '2026-05-27', 3, 1, 1), -- Đã hoàn tất và được sếp check (tối màu)
(3, 'mai show a xem bảng thiết kế mô phỏng giống như yêu cầu của a', 'Chuẩn bị file trình chiếu 3D mockup hoàn thiện', 'completed', 'high', '2026-05-26', 3, 1, 0),
(4, 'Chat nội bộ', 'Module chat thời gian thực sử dụng Socket.IO', 'in_progress', 'high', '2026-05-28', 2, 1, 0),
(5, 'Notion giao việc', 'Thiết kế trang giao việc dạng Notion Table trên App di động', 'in_progress', 'medium', '2026-05-28', 1, 1, 0),
(6, 'tính năng trang sản xuất, thống kê lượng hàng cần, giao diện trực quan hơn vì lượng sản phẩm ko quá lớn', 'Tối giản hóa và tối ưu giao diện thống kê sản phẩm', 'completed', 'medium', '2026-05-29', 2, 1, 0),
(7, 'chat nội bộ, giao việc, nếu a có việc gấp lúc giao việc a bấm vô, nó sẽ push và báo đt liên tục hoặc thời gian cl...', 'Nút báo động đỏ đẩy notification liên tục cho việc gấp', 'todo', 'high', '2026-06-02', 1, 1, 0),
(8, 'ví dụ Phúc nó hoàn tất rồi, mà a ko bik đã check chưa, e thêm nút như sếp đã check, rồi cái mục đó bị tối màu', 'Nhấn nút sếp đã duyệt để dòng công việc tự động tối màu', 'todo', 'medium', '2026-06-03', 2, 1, 0);

-- Chèn Cuộc trò chuyện mẫu (1 cuộc trò chuyện nhóm và 1 cuộc trò chuyện cá nhân)
INSERT INTO `conversations` (`id`, `name`, `type`) VALUES
(1, 'Nhóm Dự Án App-Assign', 'group'),
(2, NULL, 'direct');

-- Liên kết thành viên vào cuộc trò chuyện
-- Cuộc hội thoại nhóm 1 có cả 3 người tham gia
INSERT INTO `conversation_users` (`conversation_id`, `user_id`) VALUES
(1, 1),
(1, 2),
(1, 3),
-- Cuộc hội thoại cá nhân 2 giữa Admin (1) và Dev (2)
(2, 1),
(2, 2);

-- Chèn lịch sử tin nhắn mẫu trong cuộc hội thoại nhóm 1
INSERT INTO `messages` (`id`, `conversation_id`, `sender_id`, `message`, `type`) VALUES
(1, 1, 1, 'Chào cả nhóm, chúng ta bắt đầu triển khai dự án App-Assign tasks nhé!', 'text'),
(2, 1, 3, 'Em đã hoàn thành xong bản phác thảo giao diện trên Stitch rồi ạ. Đang tiếp tục làm chi tiết màn hình quản lý công việc.', 'text'),
(3, 1, 2, 'Vâng anh, em đang bắt đầu dựng DB MySQL trên XAMPP và viết API PHP.', 'text');

-- Chèn tin nhắn mẫu trong cuộc hội thoại cá nhân 2
INSERT INTO `messages` (`id`, `conversation_id`, `sender_id`, `message`, `type`) VALUES
(4, 2, 1, 'Chào em, DB chat MySQL em đã dựng xong chưa?', 'text'),
(5, 2, 2, 'Em đã dựng xong các bảng conversations, conversation_users và messages rồi anh ạ.', 'text');
