import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { AiAutocomplete } from './extensions/AiAutocomplete';
import { ChapterChatSidebar } from './ChapterChatSidebar';
import { ConsistencyCheckDialog } from './ConsistencyCheckDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { updateChapter, refineChapterText, createChapter, getChapterSuggestion } from '@/lib/api';
import { useAIConfig, getAIConfigHeaders } from '@/contexts/AIConfigContext';
import { 
  Sparkles, 
  Save, 
  Loader2,
  CheckCircle,
  ArrowLeft,
  Bot,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight';

interface ChapterEditorProps {
  projectName: string;
  chapterIndex?: number; // undefined for new chapter
  initialContent?: string;
  onClose: () => void;
  onSaved?: (chapterIndex: number) => void;
}

function toEditorHtml(content: string): string {
  if (!content.trim()) return '<p></p>';
  return content
    .split('\n')
    .map((line) => {
      const escaped = line
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
      return `<p>${escaped || '<br>'}</p>`;
    })
    .join('');
}

export function ChapterEditor({ 
  projectName, 
  chapterIndex, 
  initialContent = '', 
  onClose,
  onSaved,
}: ChapterEditorProps) {
  const { config, isConfigured } = useAIConfig();
  const [isSaving, setIsSaving] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showInstructionDialog, setShowInstructionDialog] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [selectionContext, setSelectionContext] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showBubbleMenu, setShowBubbleMenu] = useState(false);
  const [bubbleMenuPosition, setBubbleMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [savedChapterIndex, setSavedChapterIndex] = useState<number | undefined>(chapterIndex);
  const [showConsistencyDialog, setShowConsistencyDialog] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [contentVersion, setContentVersion] = useState(0);
  const viewportHeight = useVisualViewportHeight();

  // Debounce ref for ghost text
  const lastTypeTime = useRef<number>(Date.now());

  // Initialize tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Highlight.configure({
        multicolor: true,
        HTMLAttributes: {
          class: 'ai-highlight',
        },
      }),
      AiAutocomplete.configure({
        suggestionClassName: 'after:content-[attr(data-suggestion)] after:text-gray-400 after:italic after:pointer-events-none',
      }),
    ],
    content: toEditorHtml(initialContent),
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none p-4 pb-32',
      },
    },
    onUpdate: ({ editor }) => {
      setHasChanges(true);
      setSaveSuccess(false);
      setSaveError(null);
      setActionError(null);
      setContentVersion((prev) => prev + 1);
      lastTypeTime.current = Date.now();
      
      // Update word count
      const text = editor.getText();
      setWordCount(text.replace(/\s/g, '').length);
    },
    onCreate: ({ editor }) => {
       const text = editor.getText();
       setWordCount(text.replace(/\s/g, '').length);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, '\n');
      const hasSelectedText = text.trim().length > 0 && from !== to;
      setShowBubbleMenu(hasSelectedText);
      if (!hasSelectedText) {
        setBubbleMenuPosition(null);
        return;
      }
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setBubbleMenuPosition({
          top: Math.max(8, Math.min(start.top, end.top) - 8),
          left: (start.left + end.right) / 2,
        });
      } catch {
        setBubbleMenuPosition(null);
      }
    },
  });

  // Handle AI refine button click
  const handleRefineClick = useCallback(() => {
    if (!editor) return;
    setActionError(null);
    
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, '\n');
    
    if (!text.trim()) return;
    
    setSelectedText(text);
    
    // Get surrounding context (up to 200 chars before and after)
    const fullText = editor.getText();
    const textBefore = fullText.slice(Math.max(0, from - 200), from);
    const textAfter = fullText.slice(to, to + 200);
    setSelectionContext(`...${textBefore}【选中部分】${textAfter}...`);
    
    setShowInstructionDialog(true);
  }, [editor]);

  // Submit refinement request
  const handleRefineSubmit = useCallback(async () => {
    if (!editor || !selectedText || !instruction.trim()) return;
    if (savedChapterIndex === undefined) {
      setActionError('请先保存章节后再使用 AI 优化功能');
      return;
    }
    
    setIsRefining(true);
    
    try {
      const aiHeaders = getAIConfigHeaders(config);
      const result = await refineChapterText(
        projectName,
        savedChapterIndex,
        selectedText,
        instruction,
        selectionContext,
        aiHeaders
      );
      
      const { from, to } = editor.state.selection;
      
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent(`<mark data-color="yellow" class="ai-highlight">${result.refinedText}</mark>`)
        .run();
      
      setHasChanges(true);
      setShowInstructionDialog(false);
      setInstruction('');
      setSelectedText('');
      setActionError(null);
    } catch (error) {
      console.error('Refine error:', error);
      setActionError(`优化失败：${(error as Error).message}`);
    } finally {
      setIsRefining(false);
    }
  }, [editor, projectName, savedChapterIndex, selectedText, instruction, selectionContext, config]);

  // Save chapter content
  const handleSave = useCallback(async () => {
    if (!editor) return;
    
    setIsSaving(true);
    setSaveError(null);
    
    try {
      const content = editor.getText();
      if (!content.trim()) {
        throw new Error('章节内容不能为空');
      }
      
      if (savedChapterIndex === undefined) {
        const result = await createChapter(projectName, content);
        setSavedChapterIndex(result.chapterIndex);
        onSaved?.(result.chapterIndex);
      } else {
        await updateChapter(projectName, savedChapterIndex, content);
        onSaved?.(savedChapterIndex);
      }
      
      setHasChanges(false);
      setSaveSuccess(true);
      editor.chain().focus().unsetHighlight().run();
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error('Save error:', error);
      setSaveError((error as Error).message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [editor, projectName, savedChapterIndex, onSaved]);

  // Confirm before closing with unsaved changes
  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (confirm('有未保存的修改，确定要关闭吗？')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Auto-save effect
  useEffect(() => {
    if (!hasChanges || isSaving || !editor) return;
    if (!editor.getText().trim()) return;

    const timer = setTimeout(() => {
      handleSave();
    }, 2000);

    return () => clearTimeout(timer);
  }, [contentVersion, hasChanges, isSaving, editor, handleSave]);

  // Ghost Text (AI Autocomplete) Effect
  useEffect(() => {
    if (!editor || !isConfigured || savedChapterIndex === undefined || isSuggesting) return;

    const checkGhostText = async () => {
      const now = Date.now();
      const timeSinceType = now - lastTypeTime.current;
      
      if (timeSinceType > 1000 && editor.isFocused) {
        const { to } = editor.state.selection;
        const docSize = editor.state.doc.content.size;
        
        if (to === docSize - 1 || to === docSize) { // -1 because doc has block close
             const storage = editor.storage as { aiAutocomplete?: { suggestion?: string } };
             if (storage.aiAutocomplete?.suggestion) return;

             try {
                setIsSuggesting(true);
                const text = editor.getText();
                const contextBefore = text.slice(-1000);
                if (contextBefore.length < 10) { setIsSuggesting(false); return; }

                const aiHeaders = getAIConfigHeaders(config);
                const suggestion = await getChapterSuggestion(projectName, savedChapterIndex, contextBefore, aiHeaders);
                
                if (suggestion && editor.isFocused) {
                   editor.commands.setAiSuggestion(suggestion);
                }
             } catch (err) {
               console.error("Ghost text error", err);
             } finally {
               setIsSuggesting(false);
             }
        }
      }
    };

    const timer = setInterval(checkGhostText, 1000);
    return () => clearInterval(timer);
  }, [editor, isConfigured, savedChapterIndex, projectName, config, isSuggesting]);

  if (!editor) {
    return null;
  }

  const safeViewportHeight = viewportHeight > 0 ? viewportHeight : null;
  const shellStyle = {
    height: safeViewportHeight ? `${safeViewportHeight}px` : '100dvh',
    ['--editor-shell-height' as any]: safeViewportHeight ? `${safeViewportHeight}px` : '100dvh',
  } as CSSProperties;

  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-background flex flex-col" style={shellStyle}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
             <h2 className="text-lg font-medium">
              {savedChapterIndex !== undefined ? `第 ${savedChapterIndex} 章` : '新建章节'}
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{wordCount} 字</span>
              {hasChanges ? (
                <span className="text-yellow-600">● 未保存</span>
              ) : (
                <span className="text-green-600">● 已保存</span>
              )}
              {isSuggesting && (
                 <span className="text-primary flex items-center gap-1 animate-pulse">
                   <Bot className="h-3 w-3" />
                   思考中...
                 </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="flex items-center gap-1 text-sm text-green-600 animate-in fade-in slide-in-from-bottom-1">
              <CheckCircle className="h-4 w-4" />
              已自动保存
            </span>
          )}
          {saveError && (
            <span className="text-sm text-destructive max-w-xs truncate" title={saveError}>
              保存失败：{saveError}
            </span>
          )}
          {actionError && !saveError && (
            <span className="text-sm text-destructive max-w-xs truncate" title={actionError}>
              {actionError}
            </span>
          )}
          
          <Button
            variant={isChatOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="flex items-center gap-1"
          >
            <MessageSquare className="h-4 w-4" />
            AI 助手
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConsistencyDialog(true)}
            className="flex items-center gap-1"
            title="一致性检查"
          >
            <AlertTriangle className="h-4 w-4" />
          </Button>

          <Button 
            onClick={handleSave} 
            disabled={isSaving || !hasChanges}
            size="sm"
            variant="outline"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            保存
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-auto bg-background/50">
          <div className="max-w-4xl mx-auto py-8 px-4 relative h-full">
            {/* Selection Bubble Menu */}
            {showBubbleMenu && bubbleMenuPosition && editor.state.selection.from !== editor.state.selection.to && (
              <div 
                className="fixed bg-popover border rounded-lg shadow-lg p-1 z-50"
                style={{
                  top: `${bubbleMenuPosition.top}px`,
                  left: `${bubbleMenuPosition.left}px`,
                  transform: 'translate(-50%, -100%)',
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefineClick}
                  className="flex items-center gap-1"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI 优化
                </Button>
              </div>
            )}

            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Chat Sidebar */}
        {isChatOpen && (
          <div className="w-80 shrink-0 border-l h-full">
            <ChapterChatSidebar 
              projectName={projectName}
              chapterIndex={savedChapterIndex}
              currentContent={editor.getText()}
              onClose={() => setIsChatOpen(false)}
            />
          </div>
        )}
      </div>

      <Dialog open={showInstructionDialog} onOpenChange={setShowInstructionDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI 文本优化
            </DialogTitle>
            <DialogDescription>
              选中的文本将根据你的指令进行优化
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">选中内容</label>
              <div className="mt-1 p-3 bg-muted rounded-md text-sm max-h-32 overflow-auto">
                {selectedText}
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium">优化指令</label>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例如：让语言更加生动形象 / 增加心理描写 / 精简语句..."
                className="mt-1"
                rows={3}
                autoFocus
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInstructionDialog(false)}
              disabled={isRefining}
            >
              取消
            </Button>
            <Button
              onClick={handleRefineSubmit}
              disabled={isRefining || !instruction.trim()}
            >
              {isRefining ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  优化中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1" />
                  开始优化
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Consistency Check Dialog */}
      <ConsistencyCheckDialog
        open={showConsistencyDialog}
        onOpenChange={setShowConsistencyDialog}
        projectName={projectName}
        chapterIndex={savedChapterIndex || 1}
        content={editor?.getText() || ''}
      />

      {/* Editor Styles */}
      <style>{`
        .ai-highlight {
          background-color: hsl(var(--primary) / 0.2);
          border-radius: 2px;
          padding: 0 2px;
        }
        
        .dark .ai-highlight {
          background-color: hsl(var(--primary) / 0.3);
        }

        .ai-autocomplete-suggestion {
          color: #9ca3af;
          pointer-events: none;
          font-style: italic;
        }
        
        .ProseMirror {
          line-height: 1.8;
          font-size: 1rem;
          min-height: calc(var(--editor-shell-height, 100dvh) - 220px);
        }
        
        .ProseMirror p {
          margin-bottom: 1em;
          text-indent: 2em;
        }
        
        .ProseMirror:focus {
          outline: none;
        }
        
        .ProseMirror::selection {
          background-color: hsl(var(--primary) / 0.3);
        }
      `}</style>
    </div>
  );
}
