import { useState, useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
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
import { updateChapter, refineChapterText, createChapter } from '@/lib/api';
import { useAIConfig, getAIConfigHeaders } from '@/contexts/AIConfigContext';
import { 
  Sparkles, 
  Save, 
  Loader2,
  CheckCircle,
  ArrowLeft,
} from 'lucide-react';

interface ChapterEditorProps {
  projectName: string;
  chapterIndex?: number; // undefined for new chapter
  initialContent?: string;
  onClose: () => void;
  onSaved?: (chapterIndex: number) => void;
}

export function ChapterEditor({ 
  projectName, 
  chapterIndex, 
  initialContent = '', 
  onClose,
  onSaved,
}: ChapterEditorProps) {
  const { config } = useAIConfig();
  const [isSaving, setIsSaving] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [showInstructionDialog, setShowInstructionDialog] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [selectionContext, setSelectionContext] = useState('');
  const [hasChanges, setHasChanges] = useState(chapterIndex === undefined); // New chapters always have "changes"
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showBubbleMenu, setShowBubbleMenu] = useState(false);
  const [savedChapterIndex, setSavedChapterIndex] = useState<number | undefined>(chapterIndex);

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
    ],
    content: `<p>${initialContent.split('\n').join('</p><p>')}</p>`,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[400px] p-4',
      },
    },
    onUpdate: () => {
      setHasChanges(true);
      setSaveSuccess(false);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, '\n');
      setShowBubbleMenu(text.trim().length > 0);
    },
  });

  // Handle AI refine button click
  const handleRefineClick = useCallback(() => {
    if (!editor) return;
    
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

  // Submit refinement request (only for existing chapters)
  const handleRefineSubmit = useCallback(async () => {
    if (!editor || !selectedText || !instruction.trim()) return;
    if (savedChapterIndex === undefined) {
      alert('请先保存章节后再使用 AI 优化功能');
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
      
      // Replace selected text with refined version and highlight it
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
    } catch (error) {
      console.error('Refine error:', error);
      alert(`优化失败: ${(error as Error).message}`);
    } finally {
      setIsRefining(false);
    }
  }, [editor, projectName, savedChapterIndex, selectedText, instruction, selectionContext, config]);

  // Save chapter content
  const handleSave = useCallback(async () => {
    if (!editor) return;
    
    setIsSaving(true);
    
    try {
      // Get plain text content (strip HTML tags and highlights)
      const content = editor.getText();
      
      if (savedChapterIndex === undefined) {
        // Create new chapter
        const result = await createChapter(projectName, content);
        setSavedChapterIndex(result.chapterIndex);
        onSaved?.(result.chapterIndex);
      } else {
        // Update existing chapter
        await updateChapter(projectName, savedChapterIndex, content);
        onSaved?.(savedChapterIndex);
      }
      
      setHasChanges(false);
      setSaveSuccess(true);
      
      // Clear highlights after save
      editor.chain().focus().unsetHighlight().run();
      
      // Show success briefly
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error('Save error:', error);
      alert(`保存失败: ${(error as Error).message}`);
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

  if (!editor) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-lg font-medium">
            {savedChapterIndex !== undefined ? `第 ${savedChapterIndex} 章` : '新建章节'}
          </h2>
          {hasChanges && (
            <span className="text-xs text-muted-foreground">(未保存)</span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" />
              已保存
            </span>
          )}
          <Button 
            onClick={handleSave} 
            disabled={isSaving || !hasChanges}
            size="sm"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            保存 (⌘S)
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto py-8 px-4 relative">
          {/* Custom Bubble Menu - appears when text is selected */}
          {showBubbleMenu && editor.state.selection.from !== editor.state.selection.to && (
            <div 
              className="absolute bg-popover border rounded-lg shadow-lg p-1 z-10"
              style={{
                top: 'var(--bubble-top, 0)',
                left: 'var(--bubble-left, 0)',
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefineClick}
                className="flex items-center gap-1"
              >
                <Sparkles className="h-4 w-4 text-orange-500" />
                AI 优化
              </Button>
            </div>
          )}

          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Floating AI Button - always visible when text selected */}
      {showBubbleMenu && (
        <div className="fixed bottom-6 right-6 z-50">
          <Button
            onClick={handleRefineClick}
            className="rounded-full shadow-lg h-12 px-4"
          >
            <Sparkles className="h-5 w-5 mr-2" />
            AI 优化选中文本
          </Button>
        </div>
      )}

      {/* AI Instruction Dialog */}
      <Dialog open={showInstructionDialog} onOpenChange={setShowInstructionDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-orange-500" />
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

      {/* Editor Styles */}
      <style>{`
        .ai-highlight {
          background-color: rgba(249, 115, 22, 0.2);
          border-radius: 2px;
          padding: 0 2px;
        }
        
        .dark .ai-highlight {
          background-color: rgba(249, 115, 22, 0.3);
        }
        
        .ProseMirror {
          line-height: 1.8;
          font-size: 1rem;
        }
        
        .ProseMirror p {
          margin-bottom: 1em;
          text-indent: 2em;
        }
        
        .ProseMirror:focus {
          outline: none;
        }
        
        .ProseMirror::selection {
          background-color: rgba(249, 115, 22, 0.3);
        }
      `}</style>
    </div>
  );
}
