# ⚡ TeamFlow — Realtime Chat & Work Management System

**TeamFlow** là hệ thống quản lý công việc (Notion-style) và chat thời gian thực (Messenger-style) tối giản, hiệu năng cao, được thiết kế tinh gọn để hoạt động hoàn hảo trên môi trường di động, trình duyệt web và ứng dụng máy tính (Desktop App).

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

1. **Frontend**: React Native + Expo (hỗ trợ React Native Web biên dịch 60fps mượt mà).
2. **Backend**: Node.js + Express (thay thế hoàn toàn PHP/XAMPP).
3. **Realtime**: Socket.IO (phát tin nhắn, trạng thái online, chỉ báo gõ chữ typing indicator realtime).
4. **Database**: Supabase PostgreSQL (lưu trữ đám mây qua hệ thống Connection Pooler IPv4 tối ưu).
5. **Desktop Wrapper**: Electron (bọc ngoài ứng dụng Web, hỗ trợ các API máy tính cao cấp).

---

## 📸 Tính Năng Đặc Biệt: Screenshot Quick Share (Zalo/Discord PC Style)
* Kích hoạt chụp ảnh màn hình bằng phím tắt **`Ctrl + Shift + A`** hoặc nút bấm cắt ảnh trong chat.
* **Chụp không kèm cửa sổ chat (Exclude Self Window)**: Tự động ẩn cửa sổ chat nhanh trong 300ms trước khi chụp để loại bỏ hoàn toàn hiệu ứng làm mờ/thu nhỏ của hệ điều hành, chụp sạch sẽ hình nền desktop phía sau. khôi phục cửa sổ ngay sau khi chụp xong.
* **Overlay Crop mượt mà & Chụp thả chuột tức thì (Drag-and-Release)**: Người dùng chỉ cần quét kéo chuột chọn vùng, khi thả chuột ra ứng dụng sẽ tự động chụp, cắt và mở modal gửi ngay lập tức (không cần bấm thêm nút Xác nhận). Hỗ trợ làm mờ vùng bên ngoài vùng chọn cực kỳ chuyên nghiệp.
* **Tối ưu RAM/CPU/Băng thông vượt trội**:
  - Cửa sổ crop chạy bằng **HTML5 Canvas + OffscreenCanvas** siêu nhẹ, không gây lag máy.
  - Ảnh crop được nén JPEG chất lượng 0.82 siêu nhẹ (~80KB) nhưng vẫn cực nét.
  - **Không truyền Base64 lớn qua IPC**: Ghi file tạm trực tiếp xuống đĩa (`teamflow_crop_*.jpg`) và chỉ gửi đường dẫn file qua IPC về cửa sổ chat để nạp và upload ngầm (async background upload).
  - Tự động hiển thị Thumbnail trong chat, click để phóng to (Lightbox mode).
  - **Caption đi kèm ảnh**: Bong bóng chat tự động hiển thị mô tả text đính kèm ngay dưới ảnh chụp.

---

## 🔑 Tài Khoản Thử Nghiệm (Demo Credentials)

> [!IMPORTANT]
> Tất cả tài khoản sử dụng mật khẩu chung mặc định là: **`password123`**

* 🔑 **Quản trị viên (Admin)**: `pm@company.com`
* 👤 **Nhân viên 1 (Dev)**: `dev@company.com`
* 👤 **Nhân viên 2 (Designer)**: `designer@company.com`

---

## 🚀 Hướng Dẫn Khởi Chạy Hệ Thống

Để vận hành toàn bộ dự án trên máy tính của bạn, hãy mở các cửa sổ Terminal riêng biệt để chạy 3 phần sau:

### 1. Khởi chạy Backend Server (Express + Socket.IO)
Di chuyển vào thư mục gốc của dự án và chạy:
```bash
node backend/server.js
```
* **REST API**: `http://localhost:3000/api`
* **Socket.IO**: `ws://localhost:3000`
* *Hệ thống tự động kết nối trực tiếp đến cụm CSDL `aws-1-ap-south-1.pooler.supabase.com:6543` trên mây của bạn qua giao thức IPv4.*

---

### 2. Khởi chạy Frontend Web App (Expo Metro)
Mở một Terminal mới, di chuyển vào thư mục `frontend/` và chạy:
```bash
cd frontend
npm install
npm run start -- --clear --port 8082
```
* Sau khi khởi chạy thành công, bạn có thể truy cập thẳng bản web chat tại địa chỉ:
  👉 **[http://localhost:8082](http://localhost:8082)**

---

### 3. Khởi chạy Ứng dụng Desktop (Electron client)
Để sử dụng tính năng **Chụp màn hình nhanh bằng phím tắt**, bắt buộc bạn phải khởi chạy dự án dưới dạng ứng dụng Desktop bọc Electron:

Mở một Terminal mới, di chuyển vào thư mục `desktop/` và chạy:
```bash
cd desktop
npm install
npm start
```
* *Cửa sổ phần mềm sẽ hiện lên, load trực tiếp giao diện chat của cổng `8082` và đăng ký phím tắt hệ thống `Ctrl + Shift + A`!*

---

## 📂 Sơ Đồ Kiến Trúc Hoạt Động (Data Flow)

```
       React Native App (Expo Client)
                     │
         ┌───────────┴───────────┐
  HTTP (Port 3000)       WebSockets (Port 3000)
         │                       │
  [Express API]            [Socket.IO events]
   auth, tasks,              join, typing,
  conversations,            send_message,
  messages, upload             online
         │                       │
         └───────────┬───────────┘
                     │  (pg Connection Pool)
                     ▼
         Supabase Cloud PostgreSQL
```
