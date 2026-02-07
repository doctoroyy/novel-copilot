import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Users, 
  BookOpen, 
  FileText, 
  Ticket, 
  Plus, 
  Trash2, 
  ArrowLeft,
  RefreshCcw,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';

interface User {
  id: string;
  username: string;
  role: string;
  created_at: string;
  project_count: number;
  total_chapters: number;
}

interface InvitationCode {
  code: string;
  max_uses: number;
  used_count: number;
  created_at: string;
  is_active: number;
}

interface Stats {
  userCount: number;
  projectCount: number;
  chapterCount: number;
}

interface RecentProject {
  name: string;
  created_at: string;
  username: string;
}

export function AdminPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [users, setUsers] = useState<User[]>([]);
  const [codes, setCodes] = useState<InvitationCode[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  
  const [newCode, setNewCode] = useState('');
  const [newCodeMaxUses, setNewCodeMaxUses] = useState('10');
  
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const headers = getAuthHeaders();
      
      // Fetch all data in parallel
      const [usersRes, codesRes, statsRes] = await Promise.all([
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/invitation-codes', { headers }),
        fetch('/api/admin/stats', { headers }),
      ]);
      
      const [usersData, codesData, statsData] = await Promise.all([
        usersRes.json(),
        codesRes.json(),
        statsRes.json(),
      ]);
      
      if (!usersRes.ok) throw new Error(usersData.error || '获取用户列表失败');
      if (!codesRes.ok) throw new Error(codesData.error || '获取邀请码失败');
      if (!statsRes.ok) throw new Error(statsData.error || '获取统计数据失败');
      
      setUsers(usersData.users);
      setCodes(codesData.codes);
      setStats(statsData.stats);
      setRecentProjects(statsData.recentProjects || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchData();
  }, []);
  
  const handleCreateCode = async () => {
    if (!newCode.trim()) return;
    
    try {
      const res = await fetch('/api/admin/invitation-codes', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: newCode.trim(),
          maxUses: parseInt(newCodeMaxUses),
        }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setNewCode('');
      fetchData();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  
  const handleDeleteCode = async (code: string) => {
    if (!confirm(`确定删除邀请码 "${code}"？`)) return;
    
    try {
      const res = await fetch(`/api/admin/invitation-codes/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      
      fetchData();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  
  const handleToggleCode = async (code: string, currentActive: number) => {
    try {
      const res = await fetch(`/api/admin/invitation-codes/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      
      fetchData();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4 px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
          <h1 className="text-lg font-semibold">管理后台</h1>
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground">👤 {user?.username}</span>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
      </header>
      
      <main className="container px-4 py-6 space-y-6">
        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
            {error}
          </div>
        )}
        
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-blue-500/10">
                  <Users className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats?.userCount || 0}</p>
                  <p className="text-sm text-muted-foreground">用户数</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-green-500/10">
                  <BookOpen className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats?.projectCount || 0}</p>
                  <p className="text-sm text-muted-foreground">项目数</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-purple-500/10">
                  <FileText className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats?.chapterCount || 0}</p>
                  <p className="text-sm text-muted-foreground">章节数</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Users */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                用户列表
              </CardTitle>
              <CardDescription>
                共 {users.length} 个用户
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {users.map((u) => (
                  <div 
                    key={u.id} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div>
                      <p className="font-medium">
                        {u.username}
                        {u.role === 'admin' && (
                          <span className="ml-2 text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">
                            管理员
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {u.project_count} 个项目 · {u.total_chapters} 章
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {/* Invitation Codes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="h-5 w-5" />
                邀请码管理
              </CardTitle>
              <CardDescription>
                创建和管理邀请码
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Create new code */}
              <div className="flex gap-2">
                <Input
                  placeholder="新邀请码..."
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="number"
                  placeholder="次数"
                  value={newCodeMaxUses}
                  onChange={(e) => setNewCodeMaxUses(e.target.value)}
                  className="w-20"
                />
                <Button onClick={handleCreateCode} disabled={!newCode.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Code list */}
              <div className="space-y-2">
                {codes.map((code) => (
                  <div 
                    key={code.code} 
                    className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                      code.is_active ? 'bg-muted/50' : 'bg-muted/20 opacity-60'
                    }`}
                  >
                    <div>
                      <p className="font-mono font-medium">{code.code}</p>
                      <p className="text-xs text-muted-foreground">
                        已用 {code.used_count} / {code.max_uses} 次
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleCode(code.code, code.is_active)}
                        title={code.is_active ? '禁用' : '启用'}
                      >
                        {code.is_active ? (
                          <ToggleRight className="h-4 w-4 text-green-500" />
                        ) : (
                          <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteCode(code.code)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {codes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    暂无邀请码
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>最近活动</CardTitle>
            <CardDescription>最近创建的项目</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentProjects.map((p, i) => (
                <div 
                  key={i} 
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      by {p.username}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              ))}
              
              {recentProjects.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  暂无活动
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
