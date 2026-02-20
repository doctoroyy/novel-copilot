import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth';
import { fetchGenerationSettings, updateGenerationSettings } from '@/lib/api';

interface FeatureMapping {
  feature_key: string;
  model_id: string;
  temperature: number;
  feature_name: string;
  model_name: string;
  provider: string;
}

interface Model {
  id: string;
  provider: string;
  model_name: string;
  display_name: string;
  is_active: number;
}

interface CreditFeature {
  feature_key: string;
  name: string;
  category: string;
}

export function ModelFeatureConfig() {
  const [mappings, setMappings] = useState<Record<string, string>>({}); // featureKey -> modelId
  const [models, setModels] = useState<Model[]>([]);
  const [features, setFeatures] = useState<CreditFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryUpdateInterval, setSummaryUpdateInterval] = useState('2');
  const [savingGenerationSettings, setSavingGenerationSettings] = useState(false);
  const [generationSettingsError, setGenerationSettingsError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      setGenerationSettingsError(null);
      const headers = getAuthHeaders();
      const [modelsRes, featuresRes, mappingsRes] = await Promise.all([
        fetch('/api/admin/model-registry', { headers }).then(r => r.json()),
        fetch('/api/admin/credit-features', { headers }).then(r => r.json()),
        fetch('/api/admin/feature-models', { headers }).then(r => r.json())
      ]);

      if (modelsRes.success) setModels(modelsRes.models);
      if (featuresRes.success) setFeatures(featuresRes.features);
      
      if (mappingsRes.success) {
        const map: Record<string, string> = {};
        mappingsRes.mappings.forEach((m: FeatureMapping) => {
          map[m.feature_key] = m.model_id;
        });
        setMappings(map);
      }

      // 检查是否有数据加载失败
      if (!modelsRes.success || !featuresRes.success) {
        setError(modelsRes.error || featuresRes.error || '加载数据失败');
      }

      try {
        const settings = await fetchGenerationSettings();
        setSummaryUpdateInterval(String(settings.summaryUpdateInterval || 2));
      } catch (settingsError) {
        console.warn('Failed to load generation settings', settingsError);
      }
    } catch (err) {
      console.error('Failed to load config data', err);
      setError((err as Error).message || '网络请求失败');
    } finally {
      setLoading(false);
    }
  };

  const handleModelChange = async (featureKey: string, modelId: string) => {
    setMappings(prev => ({ ...prev, [featureKey]: modelId }));
    
    // Auto-save changes
    try {
      setSaving(true);
      await fetch('/api/admin/feature-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          featureKey,
          modelId,
          temperature: 0.7 // 默认温度
        })
      });
    } catch (error) {
      console.error('Failed to save mapping', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSummaryUpdateInterval = async () => {
    setGenerationSettingsError(null);
    const parsed = Number.parseInt(summaryUpdateInterval, 10);

    if (!Number.isInteger(parsed)) {
      setGenerationSettingsError('摘要更新间隔必须是整数');
      return;
    }
    if (parsed < 1 || parsed > 20) {
      setGenerationSettingsError('摘要更新间隔范围为 1-20 章');
      return;
    }

    try {
      setSavingGenerationSettings(true);
      const settings = await updateGenerationSettings(parsed);
      setSummaryUpdateInterval(String(settings.summaryUpdateInterval));
    } catch (err) {
      setGenerationSettingsError((err as Error).message || '保存失败');
    } finally {
      setSavingGenerationSettings(false);
    }
  };

  const groupedFeatures = features.reduce((acc, feature) => {
    const category = feature.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(feature);
    return acc;
  }, {} as Record<string, CreditFeature[]>);

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm font-medium">加载失败</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">模型分流配置</h3>
          <p className="text-sm text-muted-foreground">为不同功能指定特定的 AI 模型</p>
        </div>
        {(saving || savingGenerationSettings) && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> 保存中...</span>}
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-base">章节摘要更新策略</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="summary-update-interval">每隔</Label>
              <Input
                id="summary-update-interval"
                type="number"
                min={1}
                max={20}
                className="w-28"
                value={summaryUpdateInterval}
                onChange={(e) => setSummaryUpdateInterval(e.target.value)}
              />
              <Label htmlFor="summary-update-interval">章更新一次剧情摘要</Label>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveSummaryUpdateInterval}
                disabled={savingGenerationSettings}
              >
                保存
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              默认值为 2。数值越小，摘要更新越频繁、连贯性更强，但会增加生成耗时。
            </p>
            {generationSettingsError && (
              <p className="text-xs text-destructive">{generationSettingsError}</p>
            )}
          </CardContent>
        </Card>

        {Object.entries(groupedFeatures).map(([category, categoryFeatures]) => (
          <Card key={category}>
            <CardHeader className="py-4">
              <CardTitle className="text-base capitalization">{category === 'basic' ? '基础功能' : category === 'advanced' ? '高级功能' : category}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {categoryFeatures.map(feature => (
                <div key={feature.feature_key} className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base">{feature.name}</Label>
                    <p className="text-xs text-muted-foreground">{feature.feature_key}</p>
                  </div>
                  
                  <div className="w-[300px]">
                    <Select 
                      value={mappings[feature.feature_key] || 'default'} 
                      onValueChange={(val) => handleModelChange(feature.feature_key, val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">
                          <span className="text-muted-foreground">默认模型</span>
                        </SelectItem>
                        {models.filter(m => m.is_active).map(model => (
                          <SelectItem key={model.id} value={model.id}>
                            <span className="font-medium">{model.display_name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">({model.provider})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
