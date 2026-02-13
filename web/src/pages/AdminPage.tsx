import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  fetchAdminCreditFeatures,
  updateCreditFeature,
  fetchModelRegistry,
  createModel,
  updateModel,
  deleteModel,
  rechargeUserCredit,
} from '@/lib/api';
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
  ToggleRight,
  Zap,
  Bot,
  Star,
  Save,
  Edit,
  X,
  CreditCard
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

  // Credit features & model registry state
  const [creditFeatures, setCreditFeatures] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [editingFeature, setEditingFeature] = useState<string | null>(null);
  const [newModelForm, setNewModelForm] = useState<any>(null);
  const [rechargeUserId, setRechargeUserId] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState('');
  
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const headers = getAuthHeaders();
      
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

      // Fetch credit features and models
      try {
        const [features, modelList] = await Promise.all([
          fetchAdminCreditFeatures(),
          fetchModelRegistry(),
        ]);
        setCreditFeatures(features);
        setModels(modelList);
      } catch (e) {
        console.warn('Credit/model data fetch failed:', e);
      }
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

        {/* Tabbed Management */}
        <Tabs defaultValue="users" className="w-full">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-4 w-4" /> 用户
            </TabsTrigger>
            <TabsTrigger value="codes" className="gap-1.5">
              <Ticket className="h-4 w-4" /> 邀请码
            </TabsTrigger>
            <TabsTrigger value="credit" className="gap-1.5">
              <Zap className="h-4 w-4" /> 能量定价
            </TabsTrigger>
            <TabsTrigger value="models" className="gap-1.5">
              <Bot className="h-4 w-4" /> 模型注册
            </TabsTrigger>
          </TabsList>

          {/* ========== Users Tab ========== */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  用户列表
                </CardTitle>
                <CardDescription>共 {users.length} 个用户</CardDescription>
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
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Recharge section */}
                <div className="mt-4 pt-4 border-t">
                  <h4 className="text-sm font-medium flex items-center gap-1.5 mb-2">
                    <CreditCard className="h-4 w-4" /> 充值能量
                  </h4>
                  <div className="flex gap-2">
                    <Input
                      placeholder="用户ID"
                      value={rechargeUserId}
                      onChange={(e) => setRechargeUserId(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      placeholder="数量"
                      value={rechargeAmount}
                      onChange={(e) => setRechargeAmount(e.target.value)}
                      className="w-24"
                    />
                    <Button
                      onClick={async () => {
                        if (!rechargeUserId || !rechargeAmount) return;
                        try {
                          await rechargeUserCredit(rechargeUserId, parseInt(rechargeAmount), '管理员充值');
                          setRechargeUserId('');
                          setRechargeAmount('');
                          setError(null);
                          alert('充值成功！');
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                      disabled={!rechargeUserId || !rechargeAmount}
                    >
                      <Zap className="h-4 w-4 mr-1" /> 充值
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== Invitation Codes Tab ========== */}
          <TabsContent value="codes">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ticket className="h-5 w-5" />
                  邀请码管理
                </CardTitle>
                <CardDescription>创建和管理邀请码</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                    <p className="text-sm text-muted-foreground text-center py-4">暂无邀请码</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== Credit Features Tab ========== */}
          <TabsContent value="credit">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-amber-500" />
                  能量定价管理
                </CardTitle>
                <CardDescription>管理各功能的能量消耗定价</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {creditFeatures.map((f: any) => (
                    <div key={f.key} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      {editingFeature === f.key ? (
                        <div className="flex items-center gap-2 w-full">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{f.name}</p>
                            <p className="text-xs text-muted-foreground">{f.key}</p>
                          </div>
                          <Input
                            type="number"
                            defaultValue={f.base_cost}
                            className="w-20"
                            id={`cost-${f.key}`}
                          />
                          <Button size="sm" onClick={async () => {
                            const input = document.getElementById(`cost-${f.key}`) as HTMLInputElement;
                            try {
                              await updateCreditFeature(f.key, { baseCost: parseInt(input.value) });
                              setEditingFeature(null);
                              fetchData();
                            } catch (e) { setError((e as Error).message); }
                          }}>
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingFeature(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div>
                            <p className="font-medium text-sm">{f.name}</p>
                            <p className="text-xs text-muted-foreground">{f.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-bold text-amber-500">{f.base_cost}</span>
                            <Button size="sm" variant="ghost" onClick={() => setEditingFeature(f.key)}>
                              <Edit className="h-3 w-3" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {creditFeatures.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无定价数据</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== Model Registry Tab ========== */}
          <TabsContent value="models">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI 模型注册
                </CardTitle>
                <CardDescription>管理 AI 服务提供商和模型配置</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={() => setNewModelForm({
                    provider: 'openai', modelName: '', displayName: '',
                    apiKey: '', baseUrl: '', creditMultiplier: 1.0,
                    capabilities: 'text_generation',
                  })}
                  className="w-full"
                  variant="outline"
                >
                  <Plus className="h-4 w-4 mr-2" /> 添加模型
                </Button>

                {/* New Model Form */}
                {newModelForm && (
                  <div className="p-4 rounded-lg border bg-card space-y-3">
                    <h4 className="font-medium">添加新模型</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground">提供商</label>
                        <Input value={newModelForm.provider} onChange={(e) => setNewModelForm({ ...newModelForm, provider: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">模型名称</label>
                        <Input value={newModelForm.modelName} onChange={(e) => setNewModelForm({ ...newModelForm, modelName: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">显示名称</label>
                        <Input value={newModelForm.displayName} onChange={(e) => setNewModelForm({ ...newModelForm, displayName: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">能量倍率</label>
                        <Input type="number" step="0.1" value={newModelForm.creditMultiplier} onChange={(e) => setNewModelForm({ ...newModelForm, creditMultiplier: parseFloat(e.target.value) })} />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground">API Key</label>
                        <Input type="password" value={newModelForm.apiKey} onChange={(e) => setNewModelForm({ ...newModelForm, apiKey: e.target.value })} />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground">Base URL (可选)</label>
                        <Input value={newModelForm.baseUrl} onChange={(e) => setNewModelForm({ ...newModelForm, baseUrl: e.target.value })} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={async () => {
                        try {
                          await createModel(newModelForm);
                          setNewModelForm(null);
                          fetchData();
                        } catch (e) { setError((e as Error).message); }
                      }}>
                        <Save className="h-4 w-4 mr-1" /> 保存
                      </Button>
                      <Button variant="ghost" onClick={() => setNewModelForm(null)}>
                        取消
                      </Button>
                    </div>
                  </div>
                )}

                {/* Model List */}
                <div className="space-y-3">
                  {models.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        {m.is_default ? (
                          <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                        ) : (
                          <Bot className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium text-sm">
                            {m.display_name}
                            {m.is_default && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">默认</span>}
                            {!m.is_active && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-500">已禁用</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {m.provider} / {m.model_name} · 倍率 {m.credit_multiplier}x
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!m.is_default && (
                          <Button size="sm" variant="ghost" onClick={async () => {
                            try {
                              await updateModel(m.id, { isDefault: true });
                              fetchData();
                            } catch (e) { setError((e as Error).message); }
                          }} title="设为默认">
                            <Star className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await updateModel(m.id, { isActive: !m.is_active });
                              fetchData();
                            } catch (e) { setError((e as Error).message); }
                          }}
                        >
                          {m.is_active ? (
                            <ToggleRight className="h-4 w-4 text-green-500" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={async () => {
                            if (!confirm(`确定删除模型 ${m.display_name}？`)) return;
                            try {
                              await deleteModel(m.id);
                              fetchData();
                            } catch (e) { setError((e as Error).message); }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {models.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无模型，请添加</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

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
                <p className="text-sm text-muted-foreground text-center py-4">暂无活动</p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
