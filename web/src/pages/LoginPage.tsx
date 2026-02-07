import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { setToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const { login, register, loading, error, clearError } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Handle OAuth callback - check for token in URL
  useEffect(() => {
    const token = searchParams.get('token');
    const oauthError = searchParams.get('error');
    
    if (oauthError) {
      const errorMessages: Record<string, string> = {
        'missing_code': '授权失败：缺少授权码',
        'oauth_not_configured': 'Google 登录未配置',
        'token_exchange_failed': '令牌交换失败',
        'oauth_failed': 'OAuth 登录失败',
        'access_denied': '授权被拒绝',
      };
      setLocalError(errorMessages[oauthError] || `OAuth 错误: ${oauthError}`);
      // Clear URL params
      setSearchParams({});
      return;
    }
    
    if (token) {
      // Got token from OAuth callback
      setToken(token);
      // Clean URL and navigate home
      setSearchParams({});
      navigate('/', { replace: true });
      // Force reload to get user info
      window.location.reload();
    }
  }, [searchParams, setSearchParams, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setLocalError('密码不一致');
        return;
      }
      if (!invitationCode.trim()) {
        setLocalError('请输入邀请码');
        return;
      }
      await register(username, password, invitationCode);
    } else {
      await login(username, password);
    }
  };

  const handleGoogleLogin = () => {
    // Redirect to backend OAuth endpoint
    window.location.href = '/api/auth/google';
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setLocalError(null);
    clearError();
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 grid-pattern">
      <div className="w-full max-w-md">
        <div className="glass-card p-8 rounded-2xl">
          {/* Logo/Title */}
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">📚</div>
            <h1 className="text-2xl font-bold gradient-text">Novel Copilot</h1>
            <p className="text-muted-foreground text-sm mt-2">
              {mode === 'login' ? '登录以继续' : '创建新账户'}
            </p>
          </div>

          {/* Error Display */}
          {displayError && (
            <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg mb-6">
              {displayError}
            </div>
          )}

          {/* Google Login Button */}
          <Button
            type="button"
            variant="outline"
            className="w-full mb-6 py-6 text-base font-medium hover:bg-muted/80"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            使用 Google 账号登录
          </Button>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-4 text-muted-foreground">或使用账号密码</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-muted/50"
                required
                autoComplete="username"
                minLength={2}
                maxLength={20}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-muted/50"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={6}
              />
            </div>

            {mode === 'register' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">确认密码</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="请再次输入密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-muted/50"
                    required
                    autoComplete="new-password"
                    minLength={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invitationCode">邀请码</Label>
                  <Input
                    id="invitationCode"
                    type="text"
                    placeholder="请输入邀请码"
                    value={invitationCode}
                    onChange={(e) => setInvitationCode(e.target.value)}
                    className="bg-muted/50"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    需要邀请码才能注册
                  </p>
                </div>
              </>
            )}

            <Button
              type="submit"
              className="w-full gradient-bg hover:opacity-90 mt-6"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin">⏳</span>
                  处理中...
                </span>
              ) : (
                mode === 'login' ? '登录' : '注册'
              )}
            </Button>
          </form>

          {/* Toggle Mode */}
          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">
              {mode === 'login' ? '没有账户？' : '已有账户？'}
            </span>
            <button
              type="button"
              onClick={toggleMode}
              className="text-primary hover:underline ml-1"
            >
              {mode === 'login' ? '注册' : '登录'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          AI 驱动的小说创作平台
        </p>
      </div>
    </div>
  );
}

