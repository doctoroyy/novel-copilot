import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AIConfigProvider } from './contexts/AIConfigContext';
import { AuthProvider } from './contexts/AuthContext';
import { GenerationProvider } from './contexts/GenerationContext';
import { ServerEventsProvider } from './contexts/ServerEventsContext';
import { WebMCPProvider } from './components/WebMCPProvider';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { lazyWithRecovery } from './lib/chunkLoadRecovery';

const ProjectLayout = lazyWithRecovery('ProjectLayout', () => import('./layouts/ProjectLayout'));
const DashboardPage = lazyWithRecovery('DashboardPage', () => import('./pages/project/DashboardPage'));
const GeneratePage = lazyWithRecovery('GeneratePage', () => import('./pages/project/GeneratePage'));
const ChaptersPage = lazyWithRecovery('ChaptersPage', () => import('./pages/project/ChaptersPage'));
const OutlinePage = lazyWithRecovery('OutlinePage', () => import('./pages/project/OutlinePage'));
const BiblePage = lazyWithRecovery('BiblePage', () => import('./pages/project/BiblePage'));
const SummaryPage = lazyWithRecovery('SummaryPage', () => import('./pages/project/SummaryPage'));
const SettingsPage = lazyWithRecovery('SettingsPage', () => import('./pages/project/SettingsPage'));
const CharactersPage = lazyWithRecovery('CharactersPage', () => import('./pages/project/CharactersPage'));
const AnimePage = lazyWithRecovery('AnimePage', () => import('./pages/project/AnimePage'));
const QualityPage = lazyWithRecovery('QualityPage', () => import('./pages/project/QualityPage'));
const AdminPage = lazyWithRecovery('AdminPage', async () => ({ default: (await import('./pages/AdminPage')).AdminPage }));

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-10 w-10 mx-auto animate-spin mb-4 text-primary" />
        <p className="text-muted-foreground">页面加载中...</p>
      </div>
    </div>
  );
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
                <AppErrorBoundary>
                  <Suspense fallback={<RouteLoadingFallback />}>
                    <Routes>
                      <Route path="/admin" element={<AdminPage />} />

                      <Route element={<ProjectLayout />}>
                        <Route index element={<DashboardPage />} />
                        <Route path="project/:projectId" element={<Navigate to="dashboard" replace />} />
                        <Route path="project/:projectId/dashboard" element={<DashboardPage />} />
                        <Route path="project/:projectId/settings" element={<SettingsPage />} />
                        <Route path="project/:projectId/bible" element={<BiblePage />} />
                        <Route path="project/:projectId/summary" element={<SummaryPage />} />
                        <Route path="project/:projectId/outline" element={<OutlinePage />} />
                        <Route path="project/:projectId/generate" element={<GeneratePage />} />
                        <Route path="project/:projectId/chapters" element={<ChaptersPage />} />
                        <Route path="project/:projectId/characters" element={<CharactersPage />} />
                        <Route path="project/:projectId/quality" element={<QualityPage />} />
                        <Route path="project/:projectId/anime" element={<AnimePage />} />
                        <Route path="project/:projectId/anime/episode/:episodeId" element={<AnimePage />} />
                      </Route>
                    </Routes>
                  </Suspense>
                </AppErrorBoundary>
              </BrowserRouter>
            </ThemeProvider>
          </ServerEventsProvider>
        </GenerationProvider>
      </AIConfigProvider>
    </AuthProvider>
  );
}
