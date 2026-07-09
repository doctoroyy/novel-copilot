import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installChunkLoadRecovery } from './lib/chunkLoadRecovery';
import './index.css';

installChunkLoadRecovery();

// 本地模式：自动注入认证 token（跳过登录流程）
const TOKEN_KEY = 'novel_copilot_token';
if (!localStorage.getItem(TOKEN_KEY)) {
  localStorage.setItem(TOKEN_KEY, 'local-token');
}

// Electron 环境：添加 titlebar 安全区域标记
// 检测方式：preload 注入的 electronAPI 或 User-Agent 包含 Electron
if ((window as any).electronAPI?.isElectron || navigator.userAgent.includes('Electron')) {
  document.documentElement.classList.add('electron-app');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
