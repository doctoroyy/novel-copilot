import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save } from 'lucide-react';

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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [modelsRes, featuresRes, mappingsRes] = await Promise.all([
        fetch('/api/admin/model-registry').then(r => r.json()),
        fetch('/api/admin/credit-features').then(r => r.json()),
        fetch('/api/admin/feature-models').then(r => r.json())
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
    } catch (error) {
      console.error('Failed to load config data', error);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureKey,
          modelId,
          temperature: 0.7 // Default for now
        })
      });
    } catch (error) {
      console.error('Failed to save mapping', error);
    } finally {
      setSaving(false);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">模型分流配置</h3>
          <p className="text-sm text-muted-foreground">为不同功能指定特定的 AI 模型</p>
        </div>
        {saving && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> 保存中...</span>}
      </div>

      <div className="grid gap-6">
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
