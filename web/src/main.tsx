import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AIConfigProvider } from './contexts/AIConfigContext'
import './index.css'
import App from './App.tsx'
import AnimePage from './pages/AnimePage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AIConfigProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/project/:projectName" element={<App />} />
          <Route path="/project/:projectName/:tab" element={<App />} />
          <Route path="/anime" element={<AnimePage />} />
        </Routes>
      </BrowserRouter>
    </AIConfigProvider>
  </StrictMode>,
)
