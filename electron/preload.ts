/**
 * Electron preload 脚本
 *
 * 安全地暴露 IPC 通信接口给渲染进程。
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /** 获取后端服务器端口 */
  getServerPort: () => ipcRenderer.invoke('get-server-port'),

  /** 获取应用数据目录 */
  getAppDataDir: () => ipcRenderer.invoke('get-app-data-dir'),

  /** 平台信息 */
  platform: process.platform,

  /** 是否为 Electron 环境 */
  isElectron: true,
});
