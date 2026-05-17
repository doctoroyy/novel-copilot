import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let localServerUrl = '';

async function startServer() {
  // Dynamically import server to ensure it compiles properly in Vite/TS
  const { startLocalServer } = await import('./server.js');
  const { port } = await startLocalServer(8787); // 固定为 8787，兼容 Vite 代理
  localServerUrl = `http://localhost:${port}`;
  console.log(`Backend running on ${localServerUrl}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  });

  // In production, we'd load the built index.html.
  // In development, we can load a local vite dev server if it's running, 
  // or we can just load the dist folder.
  
  if (process.env.NODE_ENV === 'development') {
    // Assuming Vite frontend runs on 5173
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Load local built static frontend
    mainWindow.loadFile(join(__dirname, '../web/dist/index.html'));
  }
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
