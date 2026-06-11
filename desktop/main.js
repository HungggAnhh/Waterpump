// desktop/main.js
const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow = null;
let screenshotWindows = [];

// Đảm bảo chỉ chạy một instance duy nhất (Single Instance Lock) để tránh xung đột khóa cache/DB dưới nền (Lỗi Access is denied 0x5)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 1. Tạo cửa sổ chính (Main Chat App)
function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[PRELOAD_PATH]', preloadPath);
  console.log('[WEB_PREFERENCES]', {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false
  });

  console.log(
    '[WINDOW_CONFIG]',
    {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  );

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Giúp ứng dụng không bị ngủ đông khi thu nhỏ, giữ kết nối Realtime/Push luôn hoạt động
    }
  });

  console.log('[MAIN_WINDOW_CREATED]');

  // Tự động phê duyệt các quyền hiển thị Thông báo (Notification) để đảm bảo không bị Windows chặn
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'notifications') {
      return callback(true); // Chấp nhận quyền thông báo ngay lập tức
    }
    callback(true); // Chấp nhận các quyền cơ bản khác
  });

  // Tải trực tiếp giao diện Web ở local trước (để dev), nếu không chạy thì fallback về bản Vercel đã deploy
  mainWindow.loadURL('http://localhost:8082').catch(() => {
    mainWindow.loadURL('https://waterpump-eta.vercel.app/').catch(() => {
      mainWindow.loadURL('http://localhost:8082');
    });
  });

mainWindow.webContents.on('did-finish-load', () => {
  console.log(
    '[MAIN_WINDOW_URL]',
    mainWindow.webContents.getURL()
  );
});



  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

// 2. Hàm dọn dẹp và đóng toàn bộ cửa sổ chụp màn hình (Screenshot Windows)
function destroyScreenshotWindows() {
  screenshotWindows.forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.close();
      win.destroy();
    }
  });
  screenshotWindows = [];
}

// 3. Khởi tạo chức năng chụp màn hình (Multi-monitor support)
async function triggerScreenshot(options = { excludeSelf: true }) {
  // Hủy các cửa sổ chụp màn hình đang mở (nếu có)
  destroyScreenshotWindows();

  // Đảm bảo excludeSelf luôn mặc định là true ngay cả khi options là đối tượng rỗng
  const excludeSelf = options && options.excludeSelf !== undefined ? options.excludeSelf : true;

  // Chế độ Exclude Self: Ẩn cửa sổ ứng dụng -> Đợi 300ms (tăng từ 150ms để loại bỏ hoàn toàn lag Aero animation của Windows) -> Capture
  if (excludeSelf && mainWindow) {
    mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  try {
    const displays = screen.getAllDisplays();
    
    // Lấy danh sách nguồn chụp màn hình
    // thumbnailSize được nén nhẹ hơn kích thước tối đa để tránh nghẽn RAM khi multi-monitor
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 } // Thumbnail tối ưu, không render full quality tránh lag
    });

    if (!sources || sources.length === 0) {
      throw new Error('Không tìm thấy nguồn chụp màn hình. Hãy kiểm tra quyền truy cập Screen Recording của ứng dụng.');
    }

    // Mở một cửa sổ overlay transparent cho MỖI monitor
    displays.forEach((display, index) => {
      // Tìm source tương ứng với display này (sắp xếp theo id hoặc index)
      const source = sources[index] || sources[0];
      if (!source) return;

      const screenWidth = display.bounds.width;
      const screenHeight = display.bounds.height;

      const screenWin = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: screenWidth,
        height: screenHeight,
        transparent: true,
        frame: false,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        enableLargerThanScreen: true,
        resizable: false,
        movable: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: path.join(__dirname, 'preload.js')
        }
      });

      // Đưa cửa sổ tràn màn hình vật lý thực tế
      screenWin.setContentProtection(false);
      screenWin.setBounds(display.bounds);
      screenWin.setFullScreen(true);

      // Load giao diện Crop
      screenWin.loadFile(path.join(__dirname, 'screenshot', 'index.html'));

      // Chờ giao diện sẵn sàng -> Gửi ảnh nền cho cửa sổ đó
      screenWin.webContents.once('did-finish-load', () => {
        screenWin.webContents.send('init-screenshot-data', {
          imgDataUrl: source.thumbnail.toDataURL(),
          width: screenWidth,
          height: screenHeight
        });
      });

      screenshotWindows.push(screenWin);
    });

  } catch (err) {
    console.error('❌ Lỗi khi chụp ảnh màn hình:', err);
    // Nếu có lỗi xảy ra trước khi mở overlay, khôi phục ngay cửa sổ chính
    if (excludeSelf && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

// 4. Lắng nghe các sự kiện IPC từ renderers
app.whenReady().then(() => {
  // Thiết lập định danh ứng dụng cho Windows để hệ thống nhận diện trong Action Center và hiển thị Notification nổi
  app.setAppUserModelId('com.teamflow.app');
  
  createMainWindow();

  // Đăng ký shortcut Ctrl+Shift+A (Chụp không kèm cửa sổ app)
  globalShortcut.register('Ctrl+Shift+A', () => {
    triggerScreenshot({ excludeSelf: true });
  });

  // Lắng nghe yêu cầu chụp ảnh từ React Native App (Có thể tùy chỉnh include/exclude)
  ipcMain.on('trigger-screenshot', (event, options) => {
    triggerScreenshot(options);
  });

  ipcMain.handle('save-temp-crop', async (event, arrayBuffer) => {
    try {
      const tempDir = os.tmpdir();
      const filePath = path.join(tempDir, `teamflow_crop_${Date.now()}.jpg`);
      
      // Ghi file nhị phân trực tiếp cực nhanh
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      
      // Đóng và hủy toàn bộ các screenshot windows lập tức để giải phóng RAM
      destroyScreenshotWindows();

      // Khôi phục cửa sổ chính và gửi đường dẫn ảnh đã chụp
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('screenshot-captured', filePath);
      }

      return { success: true, filePath };
    } catch (err) {
      console.error('❌ Lỗi ghi file tạm:', err);
      destroyScreenshotWindows();
      // Phục hồi cửa sổ chính nếu ghi lỗi
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
      return { success: false, error: err.message };
    }
  });

  // Lắng nghe sự kiện HỦY chụp màn hình (nhấn ESC)
  ipcMain.on('cancel-screenshot', () => {
    destroyScreenshotWindows();
    // Phục hồi cửa sổ chính
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Đọc file ảnh tạm trả về dạng Base64
  ipcMain.handle('read-image-file', async (event, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      return buffer.toString('base64');
    } catch (err) {
      console.error('❌ Lỗi đọc file tạm:', err);
      return null;
    }
  });

  // Đọc ảnh từ clipboard
  ipcMain.handle('clipboard-read-image', async () => {
    console.log('[MAIN_CLIPBOARD_HANDLER_ENTERED]');
    console.log('[CLIPBOARD_READ_START]');
    try {
      const { clipboard } = require('electron');
      const image = clipboard.readImage();
      console.log('[MAIN_CLIPBOARD_IMAGE_EMPTY]', image.isEmpty());
      if (image.isEmpty()) {
        console.log('[CLIPBOARD_IMAGE_EMPTY]');
        console.log('[CLIPBOARD_READ_FAIL] Clipboard is empty or does not contain an image.');
        return { success: false, error: 'Clipboard does not contain an image.' };
      }
      
      const buffer = image.toPNG();
      console.log('[MAIN_CLIPBOARD_IMAGE_SIZE]', buffer.length);
      const sizeBytes = buffer.length;
      
      // Reject if larger than 20MB (20 * 1024 * 1024 bytes)
      if (sizeBytes > 20 * 1024 * 1024) {
        console.log('[CLIPBOARD_IMAGE_TOO_LARGE]', sizeBytes);
        return { success: false, error: 'Image size exceeds 20MB limit.' };
      }
      
      const tempDir = os.tmpdir();
      const filePath = path.join(tempDir, `teamflow_clipboard_${Date.now()}.png`);
      fs.writeFileSync(filePath, buffer);
      
      const size = image.getSize();
      console.log('[CLIPBOARD_IMAGE_SAVED]', {
        width: size.width,
        height: size.height,
        bufferSize: sizeBytes,
        savedPath: filePath
      });
      
      return {
        success: true,
        filePath,
        width: size.width,
        height: size.height,
        sizeBytes
      };
    } catch (err) {
      console.log('[CLIPBOARD_READ_ERROR]', err.message);
      console.log('[CLIPBOARD_READ_FAIL]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Xóa file tạm một cách an toàn
  ipcMain.handle('delete-temp-file', async (event, filePath) => {
    try {
      if (!filePath) return { success: false, error: 'No path provided' };
      const tempDir = os.tmpdir();
      
      const normalizedPath = path.normalize(filePath);
      const normalizedTempDir = path.normalize(tempDir);
      
      if (!normalizedPath.startsWith(normalizedTempDir)) {
        console.log('[TEMP_FILE_DELETE_FAIL] Unauthorized deletion path:', filePath);
        return { success: false, error: 'Unauthorized path' };
      }
      
      if (fs.existsSync(normalizedPath)) {
        fs.unlinkSync(normalizedPath);
        console.log('[TEMP_FILE_DELETE]', normalizedPath);
      }
      return { success: true };
    } catch (err) {
      console.log('[TEMP_FILE_DELETE_FAIL]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Tải xuống file an toàn (hỗ trợ cả Base64 và URL)
  ipcMain.handle('download-file', async (event, { url, filename }) => {
    try {
      const { dialog } = require('electron');
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: filename || 'download.png',
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
        ]
      });

      if (canceled || !filePath) {
        return { success: false, error: 'User canceled' };
      }

      if (url.startsWith('data:')) {
        const base64Data = url.split(';base64,').pop();
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      } else {
        const { net } = require('electron');
        const request = net.request(url);
        
        await new Promise((resolve, reject) => {
          request.on('response', (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
              fs.writeFileSync(filePath, Buffer.concat(chunks));
              resolve();
            });
            response.on('error', reject);
          });
          request.on('error', reject);
          request.end();
        });
      }
      return { success: true, filePath };
    } catch (err) {
      console.error('❌ Lỗi tải xuống file:', err);
      return { success: false, error: err.message };
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  // Gỡ bỏ phím tắt
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
