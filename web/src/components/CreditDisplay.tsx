import { useState, useEffect } from 'react';
import { Zap, History, TrendingDown, TrendingUp, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { fetchCreditBalance, fetchCreditTransactions } from '@/lib/api';

export function CreditDisplay() {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchCreditBalance()
      .then((data) => setBalance(data.creditBalance))
      .catch(() => setBalance(null));
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const data = await fetchCreditTransactions(20, 0);
      setTransactions(data.transactions);
    } catch (e) {
      console.error('Failed to load transactions', e);
    }
    setLoading(false);
  };

  if (balance === null) return null;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'consume': return <TrendingDown className="h-3 w-3 text-red-400" />;
      case 'recharge': return <TrendingUp className="h-3 w-3 text-green-400" />;
      case 'reward': return <Gift className="h-3 w-3 text-yellow-400" />;
      default: return <History className="h-3 w-3 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => {
      setDialogOpen(open);
      if (open) loadTransactions();
    }}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-medium px-2">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <span>{balance}</span>
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>创作能量余额</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            创作能量
            <span className="text-lg font-bold ml-auto">{balance}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="border-t pt-3">
          <div className="flex items-center gap-1.5 mb-3">
            <History className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground font-medium">消费记录</span>
          </div>
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-8">加载中...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">暂无记录</div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {transactions.map((tx: any) => (
                <div key={tx.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {getTypeIcon(tx.type)}
                    <div className="min-w-0">
                      <div className="truncate">{tx.description}</div>
                      <div className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString('zh-CN')}</div>
                    </div>
                  </div>
                  <span className={`font-mono font-medium tabular-nums ml-3 ${
                    tx.amount > 0 ? 'text-green-500' : 'text-red-400'
                  }`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
