import { useState } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import { GenerateView } from '@/components/views';

export default function GeneratePage() {
  const { 
    selectedProject, 
    loading,
    generatingOutline,
    generationState,
    handleGenerateOutline,
    handleGenerateChapters,
    handleResetProject,
  } = useProject();

  // Local form state for this page
  const [outlineChapters, setOutlineChapters] = useState('400');
  const [outlineWordCount, setOutlineWordCount] = useState('100');
  const [outlineCustomPrompt, setOutlineCustomPrompt] = useState('');
  const [generateCount, setGenerateCount] = useState('1');

  if (!selectedProject) {
    return null;
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
      onResetState={handleResetProject}
    />
  );
}
