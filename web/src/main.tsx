import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Loader2, BookOpen, ShieldX, Crown } from 'lucide-react'
import { AIConfigProvider } from './contexts/AIConfigContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { GenerationProvider } from './contexts/GenerationContext'
import { ServerEventsProvider } from './contexts/ServerEventsContext'
import './index.css'

// Layout and pages
import ProjectLayout from './layouts/ProjectLayout'
import { 
  DashboardPage, 
  GeneratePage, 
  ChaptersPage, 
  OutlinePage,
  BiblePage,
  CharactersPage,
  AnimePage,
} from './pages/project'
import { LoginPage } from './pages/LoginPage.tsx'
import { AdminPage } from './pages/AdminPage.tsx'

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-10 w-10 mx-auto animate-spin mb-4 text-primary" />
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
          <Crown className="h-10 w-10 mx-auto animate-pulse mb-4 text-yellow-500" />
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
          <ShieldX className="h-10 w-10 mx-auto mb-4 text-destructive" />
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
          <BookOpen className="h-10 w-10 mx-auto animate-pulse mb-4 text-primary" />
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
        <GenerationProvider>
          <ServerEventsProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginRoute />} />
                <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
                
                {/* Main app with nested routes */}
                <Route element={<ProtectedRoute><ProjectLayout /></ProtectedRoute>}>
                  <Route index element={<DashboardPage />} />
                  <Route path="project/:projectName" element={<Navigate to="dashboard" replace />} />
                  <Route path="project/:projectName/dashboard" element={<DashboardPage />} />
                  <Route path="project/:projectName/outline" element={<OutlinePage />} />
                  <Route path="project/:projectName/generate" element={<GeneratePage />} />
                  <Route path="project/:projectName/chapters" element={<ChaptersPage />} />
                  <Route path="project/:projectName/bible" element={<BiblePage />} />
                  <Route path="project/:projectName/characters" element={<CharactersPage />} />
                  <Route path="project/:projectName/anime" element={<AnimePage />} />
                  <Route path="project/:projectName/anime/episode/:episodeId" element={<AnimePage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </ServerEventsProvider>
        </GenerationProvider>
      </AIConfigProvider>
    </AuthProvider>
  </StrictMode>,
)



