/**
 * LicenseExportSection — Phase 4 commercial shell UI.
 *
 * - License activation / status display
 * - Manuscript export (TXT / Markdown / ZIP)
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  KeyRound,
  Loader2,
  FileText,
  FileCode,
  Package,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import {
  fetchLicense,
  activateLicense,
  deactivateLicense,
  exportProjectUrl,
  type LicenseRecord,
} from '@/lib/api';

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
};

const STATUS_LABELS: Record<string, string> = {
  active: '已激活',
  expired: '已过期',
  revoked: '已撤销',
  grace: '离线宽限期',
};

export function LicenseExportSection() {
  const { selectedProject } = useProject();
  const [license, setLicense] = useState<LicenseRecord | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const l = await fetchLicense();
      setLicense(l);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await activateLicense(keyInput.trim());
      setLicense(record);
      setKeyInput('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    setLoading(true);
    try {
      await deactivateLicense();
      setLicense(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* License */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          授权状态
        </div>

        {license ? (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{TIER_LABELS[license.tier] || license.tier}</Badge>
              <Badge className={license.status === 'active' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'}>
                {license.status === 'active' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {STATUS_LABELS[license.status] || license.status}
              </Badge>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{license.key.slice(0, 14)}...</span>
            </div>
            <div className="text-xs text-muted-foreground">
              激活于 {new Date(license.activatedAt).toLocaleDateString()}
              {license.expiresAt && ` · 到期 ${new Date(license.expiresAt).toLocaleDateString()}`}
            </div>
            <Button variant="outline" size="sm" onClick={handleDeactivate} disabled={loading}>
              取消授权
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              输入授权码激活 Pro 功能（批量生成、Context Inspector、高级 QC、导出）。
              格式：NCP-XXXX-XXXX-XXXX-XXXX
            </p>
            <div className="flex gap-2">
              <Input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="NCP-XXXX-XXXX-XXXX-XXXX"
                className="font-mono text-sm"
              />
              <Button onClick={handleActivate} disabled={loading || !keyInput.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '激活'}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </div>

      {/* Export */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Package className="h-4 w-4" />
          导出稿件
        </div>
        {!selectedProject ? (
          <p className="text-xs text-muted-foreground">请先选择一个项目。</p>
        ) : selectedProject.state.nextChapterIndex <= 1 ? (
          <p className="text-xs text-muted-foreground">暂无可导出的章节。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <a href={exportProjectUrl(selectedProject.id, 'txt')} download>
              <Button variant="outline" size="sm">
                <FileText className="h-4 w-4" />
                导出 TXT
              </Button>
            </a>
            <a href={exportProjectUrl(selectedProject.id, 'md')} download>
              <Button variant="outline" size="sm">
                <FileCode className="h-4 w-4" />
                导出 Markdown
              </Button>
            </a>
            <a href={`/api/projects/${encodeURIComponent(selectedProject.id)}/download`} download>
              <Button variant="outline" size="sm">
                <Package className="h-4 w-4" />
                导出 ZIP（含设定）
              </Button>
            </a>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          本地优先：所有导出文件直接从本地 SQLite 生成，不上传任何内容。
        </p>
      </div>
    </div>
  );
}
