/**
 * Electron 主进程入口
 *
 * 启动 Hono HTTP 服务器 + Electron 窗口。
 * 后端逻辑全部在主进程中运行（Node.js 原生环境），
 * 前端 React 应用通过 localhost 与后端通信。
 */

import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 是否为开发模式
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Novel Copilot',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 打开外部链接在系统浏览器中
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    // 开发模式：加载 Vite 开发服务器
    const devUrl = `http://localhost:5173`;
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 生产模式：加载打包后的前端文件
    const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
    await mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC：获取后端服务器端口
ipcMain.handle('get-server-port', () => serverPort);

// IPC：获取应用数据目录
ipcMain.handle('get-app-data-dir', () => {
  return app.getPath('userData');
});

app.whenReady().then(async () => {
  // 设置应用数据目录
  process.env.APP_DATA_DIR = app.getPath('userData');

  console.log(`[Main] 应用数据目录: ${process.env.APP_DATA_DIR}`);
  console.log(`[Main] 开发模式: ${isDev}`);

  // 启动后端 HTTP 服务器
  try {
    serverPort = await startServer();
    console.log(`[Main] 后端服务器已启动: http://localhost:${serverPort}`);
  } catch (error) {
    console.error('[Main] 后端服务器启动失败:', error);
    app.quit();
    return;
  }

  // 创建窗口
  await createWindow();

  app.on('activate', async () => {
    // macOS: 点击 dock 图标时重新创建窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// 非 macOS：所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', async () => {
  console.log('[Main] 应用即将退出，清理资源...');
  await stopServer();
});
