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
    handlePauseGeneration,
    handleStopGeneration,
    handleResetProject,
  } = useProject();

  // Local form state for this page
  const [outlineChapters, setOutlineChapters] = useState('400');
  const [outlineWordCount, setOutlineWordCount] = useState('100');
  const [outlineCustomPrompt, setOutlineCustomPrompt] = useState('');
  const [generateCount, setGenerateCount] = useState('1');
  const [plannerMode, setPlannerMode] = useState<'llm' | 'rule'>('llm');
  const [autoOutline, setAutoOutline] = useState<'on' | 'off'>('on');
  const [autoCharacters, setAutoCharacters] = useState<'on' | 'off'>('on');
  const [repairAttempts, setRepairAttempts] = useState('1');
  const [conflictPolicy, setConflictPolicy] = useState<'block' | 'takeover'>('block');

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
      plannerMode={plannerMode}
      onPlannerModeChange={setPlannerMode}
      autoOutline={autoOutline}
      onAutoOutlineChange={setAutoOutline}
      autoCharacters={autoCharacters}
      onAutoCharactersChange={setAutoCharacters}
      repairAttempts={repairAttempts}
      onRepairAttemptsChange={setRepairAttempts}
      conflictPolicy={conflictPolicy}
      onConflictPolicyChange={setConflictPolicy}
      onGenerateChapters={() =>
        handleGenerateChapters(generateCount, {
          useLLMPlanner: plannerMode === 'llm',
          autoGenerateOutline: autoOutline === 'on',
          autoGenerateCharacters: autoCharacters === 'on',
          maxRepairAttempts: parseInt(repairAttempts, 10),
          takeover: conflictPolicy === 'takeover',
        })
      }
      onPauseGeneration={handlePauseGeneration}
      onStopGeneration={handleStopGeneration}
      onResetState={handleResetProject}
    />
  );
}
