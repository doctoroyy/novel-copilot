import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Send, User, X, Loader2 } from 'lucide-react';
import { chatWithChapter } from '@/lib/api';
import { useAIConfig, getAIConfigHeaders } from '@/contexts/AIConfigContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChapterChatSidebarProps {
  projectName: string;
  chapterIndex?: number;
  currentContent: string;
  onClose: () => void;
}

export function ChapterChatSidebar({
  projectName,
  chapterIndex,
  currentContent,
  onClose,
}: ChapterChatSidebarProps) {
  const { config, isConfigured } = useAIConfig();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '你好！我是你的写作助手。有什么我可以帮你的吗？不管是提供灵感、润色段落，还是检查逻辑，我都在这里。' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    setActionError(null);
    if (!isConfigured) {
      setActionError('请先配置 AI 设置');
      return;
    }
    if (chapterIndex === undefined) {
      setActionError('请先保存章节');
      return;
    }

    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const aiHeaders = getAIConfigHeaders(config);
      // Construct context from last 3000 chars of content
      const context = currentContent.slice(-3000);
      
      const response = await chatWithChapter(
        projectName,
        chapterIndex,
        [...messages, userMsg].slice(-10), // Keep last 10 messages context
        context,
        aiHeaders
      );

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: `出错啦: ${(error as Error).message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full border-l bg-card w-80 shadow-xl">
      <div className="p-4 border-b flex justify-between items-center bg-muted/30">
        <h3 className="font-medium flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          写作助手
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}
              >
                {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              <div
                className={`rounded-lg p-3 text-sm max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4" />
              </div>
              <div className="bg-muted rounded-lg p-3 flex items-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-background">
        {actionError && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入你的问题..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
