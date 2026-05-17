import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // We can add IPC methods here later if needed
});
