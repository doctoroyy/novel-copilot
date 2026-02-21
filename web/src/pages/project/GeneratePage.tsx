import { useEffect, useState } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import { GenerateView } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function GeneratePage() {
  const { 
    selectedProject, 
    loading,
    generatingOutline,
    generationState,
    handleGenerateOutline,
    handleGenerateChapters,
    handleCancelGeneration,
    cancelingGeneration,
    handleResetProject,
  } = useProject();

  // Local form state for this page
  const [outlineChapters, setOutlineChapters] = useState('400');
  const [outlineWordCount, setOutlineWordCount] = useState('100');
  const [outlineMinChapterWords, setOutlineMinChapterWords] = useState('2500');
  const [outlineCustomPrompt, setOutlineCustomPrompt] = useState('');
  const [generateCount, setGenerateCount] = useState('1');

  useEffect(() => {
    if (!selectedProject) return;
    const targetChapters = Math.max(1, selectedProject.state.totalChapters || 400);
    const targetWordCount = selectedProject.outline?.targetWordCount
      ? Math.max(1, selectedProject.outline.targetWordCount)
      : Math.max(5, Math.round(targetChapters / 4));
    const minChapterWords = Math.max(500, selectedProject.state.minChapterWords || 2500);
    setOutlineChapters(String(targetChapters));
    setOutlineWordCount(String(targetWordCount));
    setOutlineMinChapterWords(String(minChapterWords));
    setGenerateCount('1');
  }, [
    selectedProject?.id,
    selectedProject?.state.totalChapters,
    selectedProject?.state.minChapterWords,
    selectedProject?.outline?.targetWordCount,
  ]);

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再进行生成。"/>;
  }

  return (
    <GenerateView
      project={selectedProject}
      loading={loading}
      generatingOutline={generatingOutline}
      generationState={generationState}
      outlineChapters={outlineChapters}
      outlineWordCount={outlineWordCount}
      outlineMinChapterWords={outlineMinChapterWords}
      outlineCustomPrompt={outlineCustomPrompt}
      onOutlineChaptersChange={setOutlineChapters}
      onOutlineWordCountChange={setOutlineWordCount}
      onOutlineMinChapterWordsChange={setOutlineMinChapterWords}
      onOutlineCustomPromptChange={setOutlineCustomPrompt}
      onGenerateOutline={() => handleGenerateOutline(outlineChapters, outlineWordCount, outlineMinChapterWords, outlineCustomPrompt)}
      generateCount={generateCount}
      onGenerateCountChange={setGenerateCount}
      onGenerateChapters={() => handleGenerateChapters(generateCount, undefined, undefined, outlineMinChapterWords)}
      onCancelGeneration={handleCancelGeneration}
      cancelingGeneration={cancelingGeneration}
      onResetState={handleResetProject}
    />
  );
}
