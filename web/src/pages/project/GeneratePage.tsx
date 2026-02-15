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
  const [outlineCustomPrompt, setOutlineCustomPrompt] = useState('');
  const [generateCount, setGenerateCount] = useState('1');

  useEffect(() => {
    if (!selectedProject) return;
    const targetChapters = Math.max(1, selectedProject.state.totalChapters || 400);
    const targetWordCount = selectedProject.outline?.targetWordCount
      ? Math.max(1, selectedProject.outline.targetWordCount)
      : Math.max(5, Math.round(targetChapters / 4));
    setOutlineChapters(String(targetChapters));
    setOutlineWordCount(String(targetWordCount));
    setGenerateCount('1');
  }, [selectedProject?.name]);

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
      outlineCustomPrompt={outlineCustomPrompt}
      onOutlineChaptersChange={setOutlineChapters}
      onOutlineWordCountChange={setOutlineWordCount}
      onOutlineCustomPromptChange={setOutlineCustomPrompt}
      onGenerateOutline={() => handleGenerateOutline(outlineChapters, outlineWordCount, outlineCustomPrompt)}
      generateCount={generateCount}
      onGenerateCountChange={setGenerateCount}
      onGenerateChapters={() => handleGenerateChapters(generateCount)}
      onCancelGeneration={handleCancelGeneration}
      cancelingGeneration={cancelingGeneration}
      onResetState={handleResetProject}
    />
  );
}
