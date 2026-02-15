import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2, BookOpen, ShieldX, Crown } from 'lucide-react';
import { AIConfigProvider } from './contexts/AIConfigContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GenerationProvider } from './contexts/GenerationContext';
import { ServerEventsProvider } from './contexts/ServerEventsContext';
import { WebMCPProvider } from './components/WebMCPProvider';
import { ThemeProvider } from './contexts/ThemeContext';

import ProjectLayout from './layouts/ProjectLayout';
import {
  DashboardPage,
  GeneratePage,
  ChaptersPage,
  OutlinePage,
  BiblePage,
  CharactersPage,
  AnimePage,
} from './pages/project';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { LandingPage } from './pages/LandingPage';

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
    return <LandingPage />;
  }

  return <>{children}</>;
}

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

export default function App() {
  return (
    <AuthProvider>
      <AIConfigProvider>
        <GenerationProvider>
          <ServerEventsProvider>
            <ThemeProvider>
              <WebMCPProvider />
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginRoute />} />
                  <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />

                  <Route element={<ProtectedRoute><ProjectLayout /></ProtectedRoute>}>
                    <Route index element={<DashboardPage />} />
                    <Route path="project/:projectId" element={<Navigate to="dashboard" replace />} />
                    <Route path="project/:projectId/dashboard" element={<DashboardPage />} />
                    <Route path="project/:projectId/outline" element={<OutlinePage />} />
                    <Route path="project/:projectId/generate" element={<GeneratePage />} />
                    <Route path="project/:projectId/chapters" element={<ChaptersPage />} />
                    <Route path="project/:projectId/bible" element={<BiblePage />} />
                    <Route path="project/:projectId/characters" element={<CharactersPage />} />
                    <Route path="project/:projectId/anime" element={<AnimePage />} />
                    <Route path="project/:projectId/anime/episode/:episodeId" element={<AnimePage />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </ThemeProvider>
          </ServerEventsProvider>
        </GenerationProvider>
      </AIConfigProvider>
    </AuthProvider>
  );
}
