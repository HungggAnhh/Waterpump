// desktop/main.js
const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow = null;
let screenshotWindows = [];

// 1. Tạo cửa sổ chính (Main Chat App)
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Tải trực tiếp giao diện Web đã deploy trên Vercel của bạn
  mainWindow.loadURL('https://waterpump-eta.vercel.app/').catch(() => {
    // Fallback về localhost nếu muốn chạy thử ở local
    mainWindow.loadURL('http://localhost:8082').catch(() => {
      mainWindow.loadURL('http://localhost:8081');
    });
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
