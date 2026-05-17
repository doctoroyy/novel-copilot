import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installChunkLoadRecovery } from './lib/chunkLoadRecovery';
import './index.css';

installChunkLoadRecovery();

// 本地模式：自动注入认证 token（跳过登录流程）
// 如果 localStorage 中没有 token，自动设置一个本地 token
const TOKEN_KEY = 'novel_copilot_token';
if (!localStorage.getItem(TOKEN_KEY)) {
  localStorage.setItem(TOKEN_KEY, 'local-token');
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
