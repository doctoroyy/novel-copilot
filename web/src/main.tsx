import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AIConfigProvider } from './contexts/AIConfigContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import './index.css'
import App from './App.tsx'
import AnimePage from './pages/AnimePage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { AdminPage } from './pages/AdminPage.tsx'

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl animate-pulse mb-4">📚</div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Admin route wrapper - requires admin role
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl animate-pulse mb-4">👑</div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🚫</div>
          <p className="text-muted-foreground">需要管理员权限</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// Login route - redirect to home if already logged in
function LoginRoute() {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl animate-pulse mb-4">📚</div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AIConfigProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
            <Route path="/" element={<ProtectedRoute><App /></ProtectedRoute>} />
            <Route path="/project/:projectName" element={<ProtectedRoute><App /></ProtectedRoute>} />
            <Route path="/project/:projectName/:tab" element={<ProtectedRoute><App /></ProtectedRoute>} />
            <Route path="/project/:projectName/anime/episode/:episodeId" element={<ProtectedRoute><App /></ProtectedRoute>} />
            <Route path="/anime" element={<ProtectedRoute><AnimePage /></ProtectedRoute>} />
          </Routes>
        </BrowserRouter>
      </AIConfigProvider>
    </AuthProvider>
  </StrictMode>,
)

