import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

window.addEventListener('vite:preloadError', () => {
  // If a chunk load fails (e.g. after a deployment), reload the page to get the latest chunks
  if (sessionStorage.getItem('vite-preload-error-reloaded')) {
    sessionStorage.removeItem('vite-preload-error-reloaded');
    return;
  }
  sessionStorage.setItem('vite-preload-error-reloaded', 'true');
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
