import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import type { ProjectsStackParamList } from '../../types/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import {
  cancelAllActiveTasks,
  cancelTaskById,
  fetchChapterContent,
  fetchCharacters,
  fetchProject,
  fetchProjectActiveTask,
  generateCharacters,
  generateChaptersStream,
  generateOutlineStream,
  resetProject,
  updateProject,
} from '../../lib/api';
import type {
  CharacterProfile,
  CharacterRelationGraph,
  GenerationTask,
  ProjectDetail,
} from '../../types/domain';
// isAIConfigured import removed
import { gradients, ui } from '../../theme/tokens';

type ScreenRoute = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;
type DetailPanel = 'hub' | 'settings' | 'outline' | 'chapters' | 'bible' | 'summary' | 'characters' | 'studio';
type SettingsPanelTab = 'bible' | 'background' | 'roles' | 'chapter-prompt';

const PANELS: { id: DetailPanel; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'hub', label: '书籍主页', hint: '总览与导航', icon: 'home-outline' },
  { id: 'settings', label: '项目设定', hint: '编辑核心规则', icon: 'settings-outline' },
  { id: 'outline', label: '大纲中心', hint: '卷章结构', icon: 'library-outline' },
  { id: 'chapters', label: '章节库', hint: '正文与复制', icon: 'document-text-outline' },
  { id: 'bible', label: '设定预览', hint: '世界观与角色', icon: 'book-outline' },
  { id: 'summary', label: '剧情摘要', hint: '脉络与待办', icon: 'newspaper-outline' },
  { id: 'characters', label: '人物关系', hint: '角色图谱', icon: 'people-outline' },
  { id: 'studio', label: '创作台', hint: '生成与控制', icon: 'sparkles-outline' },
];

const SETTINGS_TABS: { id: SettingsPanelTab; label: string; hint: string }[] = [
  { id: 'bible', label: 'Story Bible', hint: '核心主设' },
  { id: 'background', label: '世界观', hint: '规则与背景' },
  { id: 'roles', label: '角色设定', hint: '人物约束' },
  { id: 'chapter-prompt', label: '正文提示词', hint: '文风与节奏' },
];

const DEFAULT_CHAPTER_PROMPT_PROFILE = 'web_novel_light';
const CHAPTER_PROMPT_PROFILE_OPTIONS = [
  { id: 'web_novel_light', label: '轻快网文', description: '阅读顺滑，少修饰，适合日更连载。' },
  { id: 'plot_first', label: '剧情推进', description: '冲突密度更高，强调事件推进与爽点。' },
  { id: 'cinematic', label: '电影感', description: '保留画面感，但避免辞藻堆叠。' },
] as const;

function normalizeChapterTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim().replace(/^#+\s*/, '');
  const withoutPrefix = trimmed.replace(/^第\s*\d+\s*[章节回节]\s*[：:.\-、\s]*/u, '').trim();
  return withoutPrefix || trimmed;
}

function extractChapterTitle(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  let jsonCandidate = trimmed;
  if (trimmed.startsWith('```')) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) jsonCandidate = fenced[1].trim();
  }

  if (jsonCandidate.startsWith('{') && jsonCandidate.includes('"title"')) {
    try {
      const parsed = JSON.parse(jsonCandidate) as { title?: unknown };
      if (typeof parsed.title === 'string' && parsed.title.trim()) {
        return normalizeChapterTitle(parsed.title);
      }
    } catch {
      // Ignore parse errors and fall back to text pattern matching.
    }
  }

  const firstLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  for (const line of firstLines) {
    const match = line.match(/^#*\s*第\s*\d+\s*[章节回节]?\s*[：:.\-、\s]*(.+)$/u);
    if (match?.[1]?.trim()) {
      return normalizeChapterTitle(match[1]);
    }
  }

  return null;
}

function normalizeMilestone(rawMilestone: unknown): string {
  if (typeof rawMilestone === 'string') return rawMilestone.trim();
  if (rawMilestone && typeof rawMilestone === 'object') {
    const milestoneObj = rawMilestone as { milestone?: unknown; description?: unknown; title?: unknown };
    if (typeof milestoneObj.milestone === 'string') return milestoneObj.milestone.trim();
    if (typeof milestoneObj.description === 'string') return milestoneObj.description.trim();
    if (typeof milestoneObj.title === 'string') return milestoneObj.title.trim();
  }
  return '';
}

function normalizeChapterPromptProfile(value: string | undefined): string {
  if (!value) return DEFAULT_CHAPTER_PROMPT_PROFILE;
  return CHAPTER_PROMPT_PROFILE_OPTIONS.some((option) => option.id === value)
    ? value
    : DEFAULT_CHAPTER_PROMPT_PROFILE;
}

function characterRoleLabel(role: CharacterProfile['role']): string {
  if (role === 'protagonist') return '主角';
  if (role === 'deuteragonist') return '次主角';
  if (role === 'antagonist') return '反派';
  if (role === 'supporting') return '重要配角';
  return '配角';
}

function summarizeCharacter(character: CharacterProfile): string {
  const fragments = [
    character.basic.identity,
    character.personality.traits?.slice(0, 2).join(' / '),
    character.abilities?.slice(0, 2).join('、'),
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return fragments.join(' · ') || '暂无详细摘要';
}

export function ProjectDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProjectsStackParamList>>();
  const route = useRoute<ScreenRoute>();
  const projectId = route.params.projectId;

  const { token } = useAuth();
  const { config } = useAppConfig();
  const insets = useSafeAreaInsets();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activePanel, setActivePanel] = useState<DetailPanel>('hub');
  const [settingsTab, setSettingsTab] = useState<SettingsPanelTab>('bible');

  const [settingsBible, setSettingsBible] = useState('');
  const [settingsBackground, setSettingsBackground] = useState('');
  const [settingsRoleSettings, setSettingsRoleSettings] = useState('');
  const [settingsChapterPromptProfile, setSettingsChapterPromptProfile] = useState(DEFAULT_CHAPTER_PROMPT_PROFILE);
  const [settingsChapterPromptCustom, setSettingsChapterPromptCustom] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [outlineModal, setOutlineModal] = useState(false);
  const [outlineChapters, setOutlineChapters] = useState('120');
  const [outlineWordCount, setOutlineWordCount] = useState('30');
  const [outlineMinChapterWords, setOutlineMinChapterWords] = useState('2500');
  const [outlinePrompt, setOutlinePrompt] = useState('');

  const [chapterCount, setChapterCount] = useState('1');
  const [runningAction, setRunningAction] = useState<'outline' | 'generate' | 'reset' | null>(null);
  const [liveMessage, setLiveMessage] = useState<string>('');

  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);

  const [chapterModalOpen, setChapterModalOpen] = useState(false);
  const [chapterModalIndex, setChapterModalIndex] = useState<number | null>(null);
  const [chapterModalTitle, setChapterModalTitle] = useState('');
  const [chapterModalContent, setChapterModalContent] = useState('');
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterCopyingIndex, setChapterCopyingIndex] = useState<number | null>(null);
  const [chapterCopiedIndex, setChapterCopiedIndex] = useState<number | null>(null);
  const [chapterModalCopied, setChapterModalCopied] = useState(false);
  const [expandedVolumes, setExpandedVolumes] = useState<number[]>([]);
  const [outlineMilestonesExpanded, setOutlineMilestonesExpanded] = useState(false);
  const [chapterTitleCache, setChapterTitleCache] = useState<Record<number, string>>({});
  const [characterGraph, setCharacterGraph] = useState<CharacterRelationGraph | null>(null);
  const [characterLoading, setCharacterLoading] = useState(false);
  const [characterGenerating, setCharacterGenerating] = useState(false);
  const [characterError, setCharacterError] = useState<string | null>(null);

  const taskPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadProject = useCallback(async () => {
    // ... (loadProject logic)
    if (!token) return;

    try {
      setLoading(true);
      const detail = await fetchProject(config.apiBaseUrl, token, projectId);
      setProject(detail);
      setOutlineChapters(String(detail.state.totalChapters || 120));
      setOutlineMinChapterWords(String(Math.max(500, detail.state.minChapterWords || 2500)));
      navigation.setOptions({ title: detail.name });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.apiBaseUrl, navigation, projectId, token]);

  const loadTask = useCallback(async () => {
    // ... (loadTask logic)
    if (!token) return;
    try {
      const task = await fetchProjectActiveTask(config.apiBaseUrl, token, projectId);
      setActiveTask(task);
    } catch {
      // graceful degrade
    }
  }, [config.apiBaseUrl, projectId, token]);

  useEffect(() => {
    void loadProject();
    void loadTask();
  }, [loadProject, loadTask]);

  useEffect(() => {
    if (!project) return;
    setSettingsBible(project.bible || '');
    setSettingsBackground(project.background || '');
    setSettingsRoleSettings(project.role_settings || '');
    setSettingsChapterPromptProfile(normalizeChapterPromptProfile(project.chapter_prompt_profile));
    setSettingsChapterPromptCustom(project.chapter_prompt_custom || '');
  }, [project]);

  useEffect(() => {
    if (!token) return;

    taskPollTimer.current = setInterval(() => {
      void loadTask();
    }, 8000);

    return () => {
      if (taskPollTimer.current) {
        clearInterval(taskPollTimer.current);
        taskPollTimer.current = null;
      }
    };
  }, [loadTask, token]);

  useEffect(() => {
    setCharacterGraph(null);
    setCharacterError(null);
    setCharacterLoading(false);
    setCharacterGenerating(false);
  }, [projectId]);

  const progressPct = useMemo(() => {
    if (!project) return 0;
    const generated = Math.max(0, project.state.nextChapterIndex - 1);
    return Math.min(100, Math.round((generated / Math.max(1, project.state.totalChapters)) * 100));
  }, [project]);

  const activeTaskPct = useMemo(() => {
    if (!activeTask) return 0;
    const done = activeTask.completedChapters.length;
    return Math.min(100, Math.round((done / Math.max(1, activeTask.targetCount)) * 100));
  }, [activeTask]);

  const chapterCountNum = useMemo(() => Math.max(1, parseInt(chapterCount, 10) || 1), [chapterCount]);
  const chapterIndices = useMemo(
    () =>
      project
        ? project.chapters
            .map((file) => parseInt(file.replace(/\.md$/i, ''), 10))
            .filter((value) => Number.isFinite(value))
            .sort((a, b) => a - b)
        : [],
    [project],
  );
  const canOpenPrevChapter = useMemo(
    () => chapterModalIndex !== null && chapterIndices.includes(chapterModalIndex - 1),
    [chapterIndices, chapterModalIndex],
  );
  const canOpenNextChapter = useMemo(
    () => chapterModalIndex !== null && chapterIndices.includes(chapterModalIndex + 1),
    [chapterIndices, chapterModalIndex],
  );

  const generatedChapters = useMemo(() => Math.max(0, (project?.state.nextChapterIndex || 1) - 1), [project]);
  const remainingChapters = useMemo(
    () => Math.max(0, (project?.state.totalChapters || 0) - generatedChapters),
    [generatedChapters, project],
  );
  const outlineMilestones = useMemo(
    () =>
      (project?.outline?.milestones || [])
        .map((milestone) => normalizeMilestone(milestone))
        .filter((milestone) => milestone.length > 0),
    [project?.outline?.milestones],
  );
  const outlineChapterTitles = useMemo<Record<number, string>>(() => {
    const titles: Record<number, string> = {};
    for (const volume of project?.outline?.volumes || []) {
      for (const chapter of volume.chapters || []) {
        if (Number.isFinite(chapter.index) && typeof chapter.title === 'string' && chapter.title.trim()) {
          titles[chapter.index] = normalizeChapterTitle(chapter.title);
        }
      }
    }
    return titles;
  }, [project]);
  const chapterTitleByIndex = useMemo(
    () => ({ ...outlineChapterTitles, ...chapterTitleCache }),
    [outlineChapterTitles, chapterTitleCache],
  );
  const panelLabel = useMemo(
    () => PANELS.find((panel) => panel.id === activePanel)?.label || '书籍主页',
    [activePanel],
  );
  const settingsDirty = useMemo(
    () =>
      settingsBible !== (project?.bible || '') ||
      settingsBackground !== (project?.background || '') ||
      settingsRoleSettings !== (project?.role_settings || '') ||
      settingsChapterPromptProfile !== normalizeChapterPromptProfile(project?.chapter_prompt_profile) ||
      settingsChapterPromptCustom !== (project?.chapter_prompt_custom || ''),
    [
      project,
      settingsBackground,
      settingsBible,
      settingsChapterPromptCustom,
      settingsChapterPromptProfile,
      settingsRoleSettings,
    ],
  );
  const activePromptProfile = useMemo(
    () =>
      CHAPTER_PROMPT_PROFILE_OPTIONS.find((option) => option.id === settingsChapterPromptProfile) ||
      CHAPTER_PROMPT_PROFILE_OPTIONS[0],
    [settingsChapterPromptProfile],
  );
  const characterProfiles = useMemo(
    () => [
      ...(characterGraph?.protagonists || []).map((item) => ({ ...item, _group: 'protagonist' as const })),
      ...(characterGraph?.mainCharacters || []).map((item) => ({ ...item, _group: 'main' as const })),
    ],
    [characterGraph],
  );

  const ensureReady = useCallback(() => {
    if (!token) {
      setError('登录状态已失效，请重新登录');
      return false;
    }
    // AI config check removed as it is now server-side
    return true;
  }, [token]);

  const loadCharacters = useCallback(
    async (force: boolean = false) => {
      if (!project || !token) return;
      if (characterLoading && !force) return;

      setCharacterLoading(true);
      setCharacterError(null);
      try {
        const data = await fetchCharacters(config.apiBaseUrl, token, project.id);
        setCharacterGraph(data);
      } catch (err) {
        setCharacterError((err as Error).message);
      } finally {
        setCharacterLoading(false);
      }
    },
    [characterLoading, config.apiBaseUrl, project, token],
  );

  const handleSaveSettings = useCallback(async () => {
    if (!project || !token) return;

    setSavingSettings(true);
    setError(null);
    try {
      await updateProject(config.apiBaseUrl, token, project.id, {
        bible: settingsBible,
        background: settingsBackground,
        role_settings: settingsRoleSettings,
        chapter_prompt_profile: settingsChapterPromptProfile,
        chapter_prompt_custom: settingsChapterPromptCustom,
      });
      await loadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }, [
    config.apiBaseUrl,
    loadProject,
    project,
    settingsBackground,
    settingsBible,
    settingsChapterPromptCustom,
    settingsChapterPromptProfile,
    settingsRoleSettings,
    token,
  ]);

  const handleGenerateCharacters = useCallback(async () => {
    if (!project || !token || !ensureReady()) return;

    setCharacterGenerating(true);
    setCharacterError(null);
    try {
      const data = await generateCharacters(
        config.apiBaseUrl,
        token,
        project.id,
        config.ai,
        {
          targetChapters: project.state.totalChapters || 200,
        },
      );
      setCharacterGraph(data);
    } catch (err) {
      setCharacterError((err as Error).message);
    } finally {
      setCharacterGenerating(false);
    }
  }, [config.ai, config.apiBaseUrl, ensureReady, project, token]);

  useEffect(() => {
    if (activePanel !== 'characters' || !project || !token) return;
    if (characterGraph || characterLoading) return;
    void loadCharacters();
  }, [activePanel, characterGraph, characterLoading, loadCharacters, project, token]);

  const handleGenerateOutline = async () => {
    if (!project || !ensureReady() || !token) return;

    if (activeTask) {
      Alert.alert('已有进行中的任务', '当前有生成任务正在运行，请等待完成或先停止该任务。');
      return;
    }

    const parsedMinChapterWords = parseInt(outlineMinChapterWords, 10);
    if (!Number.isInteger(parsedMinChapterWords) || parsedMinChapterWords < 500 || parsedMinChapterWords > 20000) {
      setError('每章最少字数必须是 500~20000 的整数');
      return;
    }

    setRunningAction('outline');
    setLiveMessage('开始生成大纲...');

    try {
      await generateOutlineStream(
        config.apiBaseUrl,
        token,
        project.id,
        {
          targetChapters: Math.max(1, parseInt(outlineChapters, 10) || project.state.totalChapters || 120),
          targetWordCount: Math.max(1, parseInt(outlineWordCount, 10) || 30),
          minChapterWords: parsedMinChapterWords,
          customPrompt: outlinePrompt.trim() || undefined,
        },
        (event) => {
          if (event.type === 'progress' && event.message) setLiveMessage(event.message);
          if (event.type === 'volume_complete') {
            setLiveMessage(`卷 ${event.volumeIndex}/${event.totalVolumes} 完成：${event.volumeTitle || ''}`.trim());
          }
          if (event.type === 'done') setLiveMessage('大纲生成完成');
        },
        config.ai
      );

      setOutlineModal(false);
      setActivePanel('outline');
      await loadProject();
    } catch (err) {
      setError((err as Error).message);
      setLiveMessage(`生成失败：${(err as Error).message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const handleGenerateChapters = async () => {
    if (!project || !ensureReady() || !token) return;

    if (activeTask) {
      Alert.alert('已有进行中的任务', '当前有生成任务正在运行，请等待完成或先停止该任务。');
      return;
    }

    const count = Math.max(1, parseInt(chapterCount, 10) || 1);
    setRunningAction('generate');
    setLiveMessage(`准备生成 ${count} 章...`);

    try {
      await generateChaptersStream(
        config.apiBaseUrl,
        token,
        project.id,
        {
          chaptersToGenerate: count,
          minChapterWords: Math.max(500, project.state.minChapterWords || 2500),
        },
        (event) => {
          if (event.type === 'progress' && event.message) {
            setLiveMessage(event.message);
          }
          if (event.type === 'chapter_complete') {
            setLiveMessage(`第 ${event.chapterIndex} 章完成`);
          }
          if (event.type === 'done') {
            setLiveMessage('批量生成完成');
          }
        },
        config.ai
      );

      setActivePanel('chapters');
      await Promise.all([loadProject(), loadTask()]);
    } catch (err) {
      setError((err as Error).message);
      setLiveMessage(`生成失败：${(err as Error).message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const adjustChapterCount = (delta: number) => {
    const next = Math.max(1, Math.min(20, chapterCountNum + delta));
    setChapterCount(String(next));
  };
  
  // ... (rest of the file)

  const handleResetProject = () => {
    if (!project || !token) return;

    Alert.alert('重置项目', '将清空已生成章节并重置进度，是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认重置',
        style: 'destructive',
        onPress: async () => {
          setRunningAction('reset');
          try {
            await resetProject(config.apiBaseUrl, token, project.id);
            await loadProject();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setRunningAction(null);
          }
        },
      },
    ]);
  };

  const handleCancelTask = () => {
    if (!project || !token || !activeTask) return;
    Alert.alert('停止当前任务', '将删除当前活跃生成任务，是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '停止',
        style: 'destructive',
        onPress: async () => {
          try {
            if (typeof activeTask?.id === 'number') {
              await cancelTaskById(config.apiBaseUrl, token, activeTask.id);
            } else {
              await cancelAllActiveTasks(config.apiBaseUrl, token, project.id);
            }
            await loadTask();
          } catch (err) {
            setError((err as Error).message);
          }
        },
      },
    ]);
  };

  const openChapter = useCallback(
    async (chapterIndex: number) => {
      if (!token || !project) return;

      const knownTitle = chapterTitleByIndex[chapterIndex];
      setChapterModalOpen(true);
      setChapterModalIndex(chapterIndex);
      setChapterModalTitle(
        knownTitle
          ? `${project.name} · 第 ${chapterIndex} 章 · ${knownTitle}`
          : `${project.name} · 第 ${chapterIndex} 章`,
      );
      setChapterModalContent('');
      setChapterModalCopied(false);
      setChapterLoading(true);

      try {
        const content = await fetchChapterContent(config.apiBaseUrl, token, project.id, chapterIndex);
        setChapterModalContent(content);
        const extractedTitle = extractChapterTitle(content);
        if (extractedTitle) {
          setChapterTitleCache((prev) => (prev[chapterIndex] === extractedTitle ? prev : { ...prev, [chapterIndex]: extractedTitle }));
          setChapterModalTitle(`${project.name} · 第 ${chapterIndex} 章 · ${extractedTitle}`);
        }
      } catch (err) {
        setChapterModalContent(`加载失败：${(err as Error).message}`);
      } finally {
        setChapterLoading(false);
      }
    },
    [chapterTitleByIndex, config.apiBaseUrl, project, token],
  );

  const toggleVolumeExpand = (index: number) => {
    setExpandedVolumes((prev) => {
      if (prev.includes(index)) return prev.filter((item) => item !== index);
      return [...prev, index];
    });
  };

  const copyChapter = async (chapterIndex: number) => {
    if (!token || !project) return;
    setChapterCopyingIndex(chapterIndex);
    setChapterCopiedIndex(null);

    try {
      const content = await fetchChapterContent(config.apiBaseUrl, token, project.id, chapterIndex);
      await Clipboard.setStringAsync(content);
      setChapterCopiedIndex(chapterIndex);
      setTimeout(() => setChapterCopiedIndex((current) => (current === chapterIndex ? null : current)), 1800);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChapterCopyingIndex(null);
    }
  };

  const copyCurrentModalChapter = async () => {
    if (!chapterModalContent) return;
    if (chapterModalContent.startsWith('加载失败：')) return;
    await Clipboard.setStringAsync(chapterModalContent);
    setChapterModalCopied(true);
    setTimeout(() => setChapterModalCopied(false), 1500);
  };

  const openAdjacentChapter = async (direction: 'prev' | 'next') => {
    if (chapterModalIndex === null) return;
    const target = direction === 'next' ? chapterModalIndex + 1 : chapterModalIndex - 1;
    if (!chapterIndices.includes(target)) return;
    await openChapter(target);
  };

  useEffect(() => {
    setOutlineMilestonesExpanded(false);
  }, [projectId, project?.outline?.milestones?.length]);

  if (loading && !project) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <LinearGradient colors={gradients.page} style={styles.bgGradient}>
          <View style={styles.centerBox}>
            <ActivityIndicator color={ui.colors.primary} />
            <Text style={styles.centerText}>加载项目中...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (!project) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <LinearGradient colors={gradients.page} style={styles.bgGradient}>
          <View style={styles.centerBox}>
            <Text style={styles.centerText}>项目不存在或无权限</Text>
            <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
              <Text style={styles.secondaryButtonText}>返回项目列表</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        >
          <View style={styles.headerCard}>
            <View style={styles.headerBadge}>
              <Ionicons name="sunny-outline" size={12} color={ui.colors.primaryStrong} />
              <Text style={styles.headerBadgeText}>创作中心</Text>
            </View>
            <Text style={styles.projectTitle}>{project.name}</Text>
            <Text style={styles.projectSub}>已生成 {generatedChapters} 章 · 剩余 {remainingChapters} 章</Text>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>

            <View style={styles.metaRow}>
              <Meta label="完成度" value={`${progressPct}%`} />
              <Meta label="大纲卷数" value={String(project.outline?.volumes.length || 0)} />
              <Meta label="待复核" value={project.state.needHuman ? '有' : '无'} />
            </View>
          </View>

          <View style={styles.breadcrumbRow}>
            <Ionicons name="git-branch-outline" size={13} color={ui.colors.accent} />
            <Text style={styles.breadcrumbText}>书库 / {project.name} / {panelLabel}</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.panelNavContent}
          >
            {PANELS.map((panel) => {
              const active = panel.id === activePanel;
              return (
                <Pressable
                  key={panel.id}
                  style={({ pressed }) => [styles.panelChip, active && styles.panelChipActive, pressed && styles.pressed]}
                  onPress={() => setActivePanel(panel.id)}
                >
                  <Ionicons
                    name={panel.icon}
                    size={14}
                    color={active ? ui.colors.primaryStrong : ui.colors.textSecondary}
                  />
                  <View style={styles.panelChipTextWrap}>
                    <Text style={[styles.panelChipTitle, active && styles.panelChipTitleActive]}>{panel.label}</Text>
                    <Text style={styles.panelChipHint}>{panel.hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {error ? (
            <View style={styles.errorInline}>
              <Ionicons name="alert-circle-outline" size={14} color="#fff" />
              <Text style={styles.errorInlineText}>{error}</Text>
            </View>
          ) : null}

          {activeTask && activePanel !== 'studio' ? (
            <View style={styles.activeTaskHintCard}>
              <View style={styles.activeTaskHintTextWrap}>
                <Text style={styles.activeTaskHintTitle}>当前有生成任务在运行</Text>
                <Text style={styles.activeTaskHintText} numberOfLines={2}>
                  {activeTask.currentMessage || `已完成 ${activeTask.completedChapters.length}/${activeTask.targetCount}`}
                </Text>
              </View>
              <Pressable style={styles.activeTaskHintBtn} onPress={() => setActivePanel('studio')}>
                <Text style={styles.activeTaskHintBtnText}>去创作台</Text>
              </Pressable>
            </View>
          ) : null}

          {activePanel === 'hub' ? (
            <View style={styles.sectionStack}>
              <View style={styles.moduleGrid}>
                <ModuleEntry
                  icon="library-outline"
                  title="大纲中心"
                  desc={project.outline ? `已生成 ${project.outline.volumes.length} 卷` : '尚未生成大纲'}
                  tone="accent"
                  onPress={() => setActivePanel('outline')}
                />
                <ModuleEntry
                  icon="document-text-outline"
                  title="章节库"
                  desc={`已生成 ${project.chapters.length} 章，可逐章查看`}
                  tone="warm"
                  onPress={() => setActivePanel('chapters')}
                />
                <ModuleEntry
                  icon="newspaper-outline"
                  title="剧情摘要"
                  desc={project.state.rollingSummary ? '已沉淀滚动摘要' : '暂时还没有摘要'}
                  tone="sun"
                  onPress={() => setActivePanel('summary')}
                />
                <ModuleEntry
                  icon="settings-outline"
                  title="项目设定"
                  desc="编辑 Story Bible、世界观与正文提示词"
                  tone="primary"
                  onPress={() => setActivePanel('settings')}
                />
                <ModuleEntry
                  icon="book-outline"
                  title="设定预览"
                  desc={project.bible?.trim() ? '查看世界观与角色设定' : '当前没有设定内容'}
                  tone="accent"
                  onPress={() => setActivePanel('bible')}
                />
                <ModuleEntry
                  icon="people-outline"
                  title="人物关系"
                  desc={characterGraph ? '查看角色图谱与关系' : '生成并查看角色关系图谱'}
                  tone="sun"
                  onPress={() => setActivePanel('characters')}
                />
                <ModuleEntry
                  icon="sparkles-outline"
                  title="创作台"
                  desc="生成章节、重建大纲、重置项目"
                  tone="primary"
                  onPress={() => setActivePanel('studio')}
                />
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.cardTitle}>当前建议路径</Text>
                <Text style={styles.infoText}>
                  {!project.outline
                    ? '先进入创作台生成大纲，再回到章节库持续推进。'
                    : `当前已具备大纲，建议每次批量生成 ${chapterCountNum} 章并在章节库抽检。`}
                </Text>
                <View style={styles.inlineRow}>
                  {!project.outline ? (
                    <Pressable
                      style={({ pressed }) => [styles.primaryButtonCompact, pressed && styles.pressed]}
                      onPress={() => {
                        setActivePanel('studio');
                        setOutlineModal(true);
                      }}
                    >
                      <Text style={styles.primaryButtonText}>去生成大纲</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.primaryButtonCompact, pressed && styles.pressed]}
                      onPress={() => setActivePanel('chapters')}
                    >
                      <Text style={styles.primaryButtonText}>查看章节库</Text>
                    </Pressable>
                  )}

                  <Pressable
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
                    onPress={() => void loadProject()}
                  >
                    <Text style={styles.ghostButtonText}>刷新数据</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}

          {activePanel === 'settings' ? (
            <View style={styles.sectionStack}>
              <View style={[styles.sectionCard, styles.sectionBibleCard]}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionIconBadge, styles.sectionSummaryIcon]}>
                    <Ionicons name="settings-outline" size={13} color={ui.colors.primaryStrong} />
                  </View>
                  <Text style={styles.sectionTitle}>项目设定</Text>
                </View>
                <Text style={styles.sectionHint}>移动端已补齐可编辑设定，保存后会直接影响后续大纲、正文与人物生成。</Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.editorTabRow}
                >
                  {SETTINGS_TABS.map((tab) => {
                    const active = tab.id === settingsTab;
                    return (
                      <Pressable
                        key={tab.id}
                        style={({ pressed }) => [
                          styles.editorTab,
                          active && styles.editorTabActive,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => setSettingsTab(tab.id)}
                      >
                        <Text style={[styles.editorTabText, active && styles.editorTabTextActive]}>{tab.label}</Text>
                        <Text style={[styles.editorTabHint, active && styles.editorTabHintActive]}>{tab.hint}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {settingsTab === 'bible' ? (
                  <View style={styles.settingsField}>
                    <Text style={styles.cardTitle}>Story Bible</Text>
                    <Text style={styles.settingsHelpText}>核心概念、主线卖点、升级路线与整体钩子。</Text>
                    <TextInput
                      value={settingsBible}
                      onChangeText={setSettingsBible}
                      style={[styles.input, styles.settingsInputTall]}
                      multiline
                      textAlignVertical="top"
                      placeholder="补全主设、节奏、类型融合与关键爽点"
                      placeholderTextColor={ui.colors.textTertiary}
                    />
                  </View>
                ) : null}

                {settingsTab === 'background' ? (
                  <View style={styles.settingsField}>
                    <Text style={styles.cardTitle}>世界观与背景</Text>
                    <Text style={styles.settingsHelpText}>补充阵营、规则、资源体系、社会结构与历史背景。</Text>
                    <TextInput
                      value={settingsBackground}
                      onChangeText={setSettingsBackground}
                      style={[styles.input, styles.settingsInputTall]}
                      multiline
                      textAlignVertical="top"
                      placeholder="例如：修炼体系、科技树、势力版图、时代背景"
                      placeholderTextColor={ui.colors.textTertiary}
                    />
                  </View>
                ) : null}

                {settingsTab === 'roles' ? (
                  <View style={styles.settingsField}>
                    <Text style={styles.cardTitle}>角色设定</Text>
                    <Text style={styles.settingsHelpText}>定义核心角色的人设边界、动机、关系和语言风格。</Text>
                    <TextInput
                      value={settingsRoleSettings}
                      onChangeText={setSettingsRoleSettings}
                      style={[styles.input, styles.settingsInputTall]}
                      multiline
                      textAlignVertical="top"
                      placeholder="主角/反派/关键配角的人物卡都放这里"
                      placeholderTextColor={ui.colors.textTertiary}
                    />
                  </View>
                ) : null}

                {settingsTab === 'chapter-prompt' ? (
                  <View style={styles.settingsField}>
                    <Text style={styles.cardTitle}>正文提示词</Text>
                    <Text style={styles.settingsHelpText}>先选模板，再叠加你自己的补充约束。</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.promptProfileRow}
                    >
                      {CHAPTER_PROMPT_PROFILE_OPTIONS.map((option) => {
                        const active = option.id === settingsChapterPromptProfile;
                        return (
                          <Pressable
                            key={option.id}
                            style={({ pressed }) => [
                              styles.promptProfileChip,
                              active && styles.promptProfileChipActive,
                              pressed && styles.pressed,
                            ]}
                            onPress={() => setSettingsChapterPromptProfile(option.id)}
                          >
                            <Text style={[styles.promptProfileTitle, active && styles.promptProfileTitleActive]}>
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Text style={styles.settingsHelpText}>{activePromptProfile.description}</Text>
                    <TextInput
                      value={settingsChapterPromptCustom}
                      onChangeText={setSettingsChapterPromptCustom}
                      style={[styles.input, styles.settingsInputTall]}
                      multiline
                      textAlignVertical="top"
                      placeholder="例如：减少形容词密度，多写动作与决策，不要机械承接上一章尾句。"
                      placeholderTextColor={ui.colors.textTertiary}
                    />
                  </View>
                ) : null}

                <View style={styles.inlineRow}>
                  <Pressable
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
                    onPress={() => {
                      setSettingsBible(project.bible || '');
                      setSettingsBackground(project.background || '');
                      setSettingsRoleSettings(project.role_settings || '');
                      setSettingsChapterPromptProfile(normalizeChapterPromptProfile(project.chapter_prompt_profile));
                      setSettingsChapterPromptCustom(project.chapter_prompt_custom || '');
                    }}
                    disabled={savingSettings}
                  >
                    <Text style={styles.ghostButtonText}>重置未保存</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryButtonCompact,
                      (!settingsDirty || savingSettings) && styles.disabledButton,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => void handleSaveSettings()}
                    disabled={!settingsDirty || savingSettings}
                  >
                    {savingSettings ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>{settingsDirty ? '保存设定' : '已同步'}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}

          {activePanel === 'outline' ? (
            <View style={styles.sectionStack}>
              <View style={[styles.sectionCard, styles.sectionOutlineCard]}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionIconBadge, styles.sectionOutlineIcon]}>
                    <Ionicons name="library-outline" size={13} color={ui.colors.accent} />
                  </View>
                  <Text style={styles.sectionTitle}>卷章结构</Text>
                </View>
                {!project.outline ? (
                  <>
                    <Text style={styles.emptyText}>还没有大纲，请先到创作台生成。</Text>
                    <Pressable
                      style={({ pressed }) => [styles.primaryButtonCompact, pressed && styles.pressed]}
                      onPress={() => {
                        setActivePanel('studio');
                        setOutlineModal(true);
                      }}
                    >
                      <Text style={styles.primaryButtonText}>前往创作台</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.outlineMetaCard}>
                      <Text style={styles.outlineMetaTitle}>主线目标</Text>
                      <Text style={styles.outlineMetaText}>{project.outline.mainGoal || '暂无主线目标'}</Text>

                      <View style={styles.outlineMilestoneHeader}>
                        <Text style={styles.outlineMetaTitle}>里程碑（{outlineMilestones.length}）</Text>
                        {outlineMilestones.length > 0 ? (
                          <Pressable
                            style={({ pressed }) => [styles.outlineToggleBtn, pressed && styles.pressed]}
                            onPress={() => setOutlineMilestonesExpanded((prev) => !prev)}
                          >
                            <Text style={styles.outlineToggleText}>{outlineMilestonesExpanded ? '收起' : '展开'}</Text>
                            <Ionicons
                              name={outlineMilestonesExpanded ? 'chevron-up' : 'chevron-down'}
                              size={14}
                              color={ui.colors.textSecondary}
                            />
                          </Pressable>
                        ) : null}
                      </View>

                      {outlineMilestones.length === 0 ? (
                        <Text style={styles.outlineMetaEmpty}>暂无里程碑</Text>
                      ) : outlineMilestonesExpanded ? (
                        <View style={styles.outlineMilestoneList}>
                          {outlineMilestones.map((milestone, idx) => (
                            <View key={`milestone-${idx}`} style={styles.outlineMilestoneItem}>
                              <Text style={styles.outlineMilestoneDot}>•</Text>
                              <Text style={styles.outlineMilestoneText}>{milestone}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Pressable
                          style={({ pressed }) => [styles.outlineMilestoneCollapsed, pressed && styles.pressed]}
                          onPress={() => setOutlineMilestonesExpanded(true)}
                        >
                          <Text style={styles.outlineMetaHint}>已收起 {outlineMilestones.length} 条里程碑，点击展开查看</Text>
                        </Pressable>
                      )}
                    </View>

                    <View style={styles.volumeList}>
                      {project.outline.volumes.map((volume, volIndex) => {
                        const expanded = expandedVolumes.includes(volIndex);
                        return (
                          <View key={`${volume.title}-${volIndex}`} style={styles.volumeCard}>
                            <Pressable
                              style={({ pressed }) => [styles.volumeHeader, pressed && styles.pressed]}
                              onPress={() => toggleVolumeExpand(volIndex)}
                            >
                              <View style={styles.volumeHeaderTextWrap}>
                                <Text style={styles.volumeTitle} numberOfLines={1}>
                                  第 {volIndex + 1} 卷 · {volume.title}
                                </Text>
                                <Text style={styles.volumeMeta}>
                                  第 {volume.startChapter}-{volume.endChapter} 章 · {volume.chapters.length} 章
                                </Text>
                              </View>
                              <Ionicons
                                name={expanded ? 'chevron-up' : 'chevron-down'}
                                size={16}
                                color={ui.colors.textTertiary}
                              />
                            </Pressable>

                            {expanded ? (
                              <View style={styles.volumeBody}>
                                <Text style={styles.volumeBodyText}>目标：{volume.goal || '暂无'}</Text>
                                <Text style={styles.volumeBodyText}>冲突：{volume.conflict || '暂无'}</Text>
                                <Text style={styles.volumeBodyText}>高潮：{volume.climax || '暂无'}</Text>
                                <View style={styles.volumeChapterList}>
                                  {volume.chapters.map((chapter) => (
                                    <Text key={`${volume.title}-${chapter.index}`} style={styles.volumeChapterText}>
                                      第 {chapter.index} 章：{chapter.title}
                                    </Text>
                                  ))}
                                </View>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}
              </View>
            </View>
          ) : null}

          {activePanel === 'chapters' ? (
            <View style={styles.sectionStack}>
              <View style={[styles.sectionCard, styles.sectionChapterCard]}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionIconBadge, styles.sectionChapterIcon]}>
                    <Ionicons name="document-text-outline" size={13} color={ui.colors.primaryStrong} />
                  </View>
                  <Text style={styles.sectionTitle}>章节列表</Text>
                </View>
                <Text style={styles.sectionHint}>点击章节可查看正文，旁边可一键复制全文。</Text>
                {project.chapters.length === 0 ? (
                  <>
                    <Text style={styles.emptyText}>还没有章节，先去创作台生成 1 章。</Text>
                    <Pressable
                      style={({ pressed }) => [styles.primaryButtonCompact, pressed && styles.pressed]}
                      onPress={() => setActivePanel('studio')}
                    >
                      <Text style={styles.primaryButtonText}>前往创作台</Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.chapterList}>
                    {project.chapters.map((file) => {
                      const index = parseInt(file.replace(/\.md$/i, ''), 10);
                      const chapterTitle = chapterTitleByIndex[index];
                      return (
                        <View key={file} style={styles.chapterItem}>
                          <Pressable
                            style={({ pressed }) => [styles.chapterMainPressable, pressed && styles.pressed]}
                            onPress={() => void openChapter(index)}
                          >
                            <View style={styles.chapterTextWrap}>
                              <Text style={styles.chapterTitle} numberOfLines={1}>
                                {chapterTitle ? `第 ${index} 章 · ${chapterTitle}` : `第 ${index} 章`}
                              </Text>
                              <Text style={styles.chapterSubTitle}>
                                {chapterTitle ? '点击查看正文' : '点击查看正文预览'}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={ui.colors.textTertiary} />
                          </Pressable>

                          <Pressable
                            style={({ pressed }) => [styles.chapterCopyBtn, pressed && styles.pressed]}
                            onPress={() => void copyChapter(index)}
                            disabled={chapterCopyingIndex === index}
                          >
                            {chapterCopyingIndex === index ? (
                              <ActivityIndicator size="small" color={ui.colors.primaryStrong} />
                            ) : (
                              <Ionicons
                                name={chapterCopiedIndex === index ? 'checkmark-done-outline' : 'copy-outline'}
                                size={14}
                                color={chapterCopiedIndex === index ? ui.colors.accent : ui.colors.primaryStrong}
                              />
                            )}
                            <Text style={styles.chapterCopyBtnText}>
                              {chapterCopyingIndex === index ? '复制中' : chapterCopiedIndex === index ? '已复制' : '复制'}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          ) : null}

          {activePanel === 'summary' ? (
            <View style={styles.sectionStack}>
              <View style={[styles.sectionCard, styles.sectionSummaryCard]}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionIconBadge, styles.sectionSummaryIcon]}>
                    <Ionicons name="newspaper-outline" size={13} color={ui.colors.primaryStrong} />
                  </View>
                  <Text style={styles.sectionTitle}>剧情摘要</Text>
                </View>
                <Text style={styles.summaryText}>{project.state.rollingSummary || '暂无摘要'}</Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>未闭环线索</Text>
                {project.state.openLoops.length === 0 ? (
                  <Text style={styles.emptyText}>暂无未闭环线索。</Text>
                ) : (
                  <View style={styles.loopList}>
                    {project.state.openLoops.map((loop, idx) => (
                      <View key={`${loop}-${idx}`} style={styles.loopItem}>
                        <Ionicons name="ellipse" size={8} color={ui.colors.primaryStrong} />
                        <Text style={styles.loopText}>{loop}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.reviewCard}>
                  <Text style={styles.reviewTitle}>人工复核</Text>
                  <Text style={styles.reviewText}>
                    {project.state.needHuman
                      ? `需要处理：${project.state.needHumanReason || '请检查剧情一致性与角色状态。'}`
                      : '当前无需人工介入。'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {activePanel === 'bible' ? (
            <View style={styles.sectionStack}>
              <View style={[styles.sectionCard, styles.sectionBibleCard]}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionIconBadge, styles.sectionBibleIcon]}>
                    <Ionicons name="book-outline" size={13} color={ui.colors.accent} />
                  </View>
                  <Text style={styles.sectionTitle}>设定预览</Text>
                </View>
                <Text style={styles.sectionHint}>这里只读预览当前生效规则；需要修改时，切到「项目设定」。</Text>
                <Pressable
                  style={({ pressed }) => [styles.ghostButton, styles.previewJumpBtn, pressed && styles.pressed]}
                  onPress={() => setActivePanel('settings')}
                >
                  <Text style={styles.ghostButtonText}>去编辑设定</Text>
                </Pressable>

                <View style={styles.bibleBlock}>
                  <Text style={styles.bibleBlockTitle}>Story Bible</Text>
                  <Text style={styles.bibleBlockText}>{project.bible?.trim() || '暂无内容'}</Text>
                </View>

                <View style={styles.bibleBlock}>
                  <Text style={styles.bibleBlockTitle}>世界观与背景</Text>
                  <Text style={styles.bibleBlockText}>{project.background?.trim() || '暂无内容'}</Text>
                </View>

                <View style={styles.bibleBlock}>
                  <Text style={styles.bibleBlockTitle}>角色设定</Text>
                  <Text style={styles.bibleBlockText}>{project.role_settings?.trim() || '暂无内容'}</Text>
                </View>

                <View style={styles.bibleBlock}>
                  <Text style={styles.bibleBlockTitle}>正文提示词配置</Text>
                  <Text style={styles.bibleMetaLine}>
                    模板：{project.chapter_prompt_profile?.trim() || 'web_novel_light（默认）'}
                  </Text>
                  <Text style={styles.bibleBlockText}>{project.chapter_prompt_custom?.trim() || '暂无自定义补充要求'}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {activePanel === 'characters' ? (
            <View style={styles.sectionStack}>
              <View style={[styles.sectionCard, styles.sectionSummaryCard]}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionIconBadge, styles.sectionSummaryIcon]}>
                    <Ionicons name="people-outline" size={13} color={ui.colors.primaryStrong} />
                  </View>
                  <Text style={styles.sectionTitle}>人物关系</Text>
                </View>
                <Text style={styles.sectionHint}>对齐 Web 端人物关系页，支持查看已有图谱并在移动端直接触发重新生成。</Text>

                <View style={styles.inlineRow}>
                  <Pressable
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
                    onPress={() => void loadCharacters(true)}
                    disabled={characterLoading || characterGenerating}
                  >
                    <Text style={styles.ghostButtonText}>刷新图谱</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryButtonCompact,
                      (characterLoading || characterGenerating) && styles.disabledButton,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => void handleGenerateCharacters()}
                    disabled={characterLoading || characterGenerating}
                  >
                    {characterGenerating ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>{characterGraph ? '重新生成' : '生成图谱'}</Text>
                    )}
                  </Pressable>
                </View>

                {characterError ? <Text style={styles.characterInlineError}>{characterError}</Text> : null}

                {characterLoading && !characterGraph ? (
                  <View style={styles.characterLoadingBox}>
                    <ActivityIndicator color={ui.colors.primary} />
                    <Text style={styles.centerText}>正在加载人物关系...</Text>
                  </View>
                ) : null}

                {!characterLoading && !characterGraph ? (
                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewTitle}>还没有人物关系图谱</Text>
                    <Text style={styles.reviewText}>先根据 Story Bible 和大纲生成一份角色网络，再回来查看。</Text>
                  </View>
                ) : null}

                {characterGraph ? (
                  <>
                    <View style={styles.characterStatRow}>
                      <CharacterStat label="主角" value={characterGraph.protagonists.length} />
                      <CharacterStat label="主要角色" value={characterGraph.mainCharacters.length} />
                      <CharacterStat label="关系" value={characterGraph.relationships.length} />
                    </View>

                    <View style={styles.characterCardList}>
                      {characterProfiles.map((character) => (
                        <View key={character.id} style={styles.characterCard}>
                          <View style={styles.characterCardTop}>
                            <View style={styles.characterNameWrap}>
                              <Text style={styles.characterName}>{character.name}</Text>
                              <Text style={styles.characterMeta}>第 {character.debutChapter || 0} 章登场</Text>
                            </View>
                            <View
                              style={[
                                styles.characterRoleBadge,
                                character._group === 'protagonist'
                                  ? styles.characterRoleBadgePrimary
                                  : styles.characterRoleBadgeAlt,
                              ]}
                            >
                              <Text style={styles.characterRoleBadgeText}>{characterRoleLabel(character.role)}</Text>
                            </View>
                          </View>
                          <Text style={styles.characterSummary}>{summarizeCharacter(character)}</Text>
                        </View>
                      ))}
                    </View>

                    <View style={styles.sectionCard}>
                      <Text style={styles.cardTitle}>关系链路</Text>
                      {characterGraph.relationships.length === 0 ? (
                        <Text style={styles.emptyText}>暂无关系数据。</Text>
                      ) : (
                        <View style={styles.relationshipList}>
                          {characterGraph.relationships.map((relation) => (
                            <View key={relation.id} style={styles.relationshipCard}>
                              <View style={styles.relationshipTop}>
                                <Text style={styles.relationshipRoute}>
                                  {relation.from} → {relation.to}
                                </Text>
                                <Text style={styles.relationshipType}>{relation.type || '未命名关系'}</Text>
                              </View>
                              <View style={styles.relationshipMeterTrack}>
                                <View
                                  style={[
                                    styles.relationshipMeterFill,
                                    { width: `${Math.min(100, Math.max(8, relation.bondStrength * 10))}%` },
                                  ]}
                                />
                              </View>
                              <Text style={styles.relationshipText}>{relation.dynamic || relation.tension || '暂无关系描述'}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>

                    {characterGraph.factions.length > 0 ? (
                      <View style={styles.sectionCard}>
                        <Text style={styles.cardTitle}>阵营</Text>
                        <View style={styles.factionList}>
                          {characterGraph.factions.map((faction) => (
                            <View key={faction.id} style={styles.factionCard}>
                              <Text style={styles.factionTitle}>{faction.name}</Text>
                              <Text style={styles.factionText}>{faction.description || '暂无描述'}</Text>
                              <Text style={styles.factionMeta}>成员 {faction.members.length} 人</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </View>
            </View>
          ) : null}

          {activePanel === 'studio' ? (
            <View style={styles.sectionStack}>
              {activeTask ? (
                <View style={styles.taskCard}>
                  <Text style={styles.cardTitle}>当前生成任务</Text>
                  <Text style={styles.taskText}>{activeTask.currentMessage || `第 ${activeTask.currentProgress} 章处理中`}</Text>
                  <View style={styles.taskProgressTrack}>
                    <View style={[styles.taskProgressFill, { width: `${activeTaskPct}%` }]} />
                  </View>
                  <Text style={styles.taskMeta}>
                    {activeTask.completedChapters.length}/{activeTask.targetCount} 完成
                  </Text>
                  <Pressable style={styles.stopBtn} onPress={handleCancelTask}>
                    <Text style={styles.stopBtnText}>停止任务</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionIconBadge, styles.sectionSummaryIcon]}>
                    <Ionicons name="sparkles-outline" size={13} color={ui.colors.primaryStrong} />
                  </View>
                  <Text style={styles.sectionTitle}>生成控制台</Text>
                </View>

                <View style={styles.studioRow}>
                  <View style={styles.countStepper}>
                    <Pressable
                      style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
                      onPress={() => adjustChapterCount(-1)}
                      disabled={runningAction !== null}
                    >
                      <Ionicons name="remove" size={16} color={ui.colors.primaryStrong} />
                    </Pressable>
                    <Text style={styles.stepValue}>{chapterCountNum}</Text>
                    <Pressable
                      style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
                      onPress={() => adjustChapterCount(1)}
                      disabled={runningAction !== null}
                    >
                      <Ionicons name="add" size={16} color={ui.colors.primaryStrong} />
                    </Pressable>
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.primaryDockBtn, pressed && styles.pressed]}
                    onPress={() => (project.outline ? void handleGenerateChapters() : setOutlineModal(true))}
                    disabled={runningAction !== null}
                  >
                    {runningAction === 'generate' ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryDockBtnText}>{project.outline ? '生成章节' : '先生成大纲'}</Text>
                    )}
                  </Pressable>
                </View>

                <View style={styles.studioRow}>
                  <Pressable
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
                    onPress={() => void loadProject()}
                  >
                    <Text style={styles.ghostButtonText}>刷新数据</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
                    onPress={() => setOutlineModal(true)}
                  >
                    <Text style={styles.ghostButtonText}>{project.outline ? '重建大纲' : '生成大纲'}</Text>
                  </Pressable>
                </View>

                <View style={styles.studioRow}>
                  <Pressable
                    style={({ pressed }) => [styles.warnButton, pressed && styles.pressed]}
                    onPress={handleResetProject}
                    disabled={runningAction !== null}
                  >
                    {runningAction === 'reset' ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.warnButtonText}>重置项目</Text>
                    )}
                  </Pressable>
                  {activeTask ? (
                    <Pressable
                      style={({ pressed }) => [styles.warnButton, styles.stopBtnWide, pressed && styles.pressed]}
                      onPress={handleCancelTask}
                    >
                      <Text style={styles.warnButtonText}>停止任务</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.morePlaceholder} />
                  )}
                </View>

                {runningAction ? <Text style={styles.liveText}>{liveMessage || '处理中...'}</Text> : null}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <Modal visible={outlineModal} animationType="slide" transparent onRequestClose={() => setOutlineModal(false)}>
          <KeyboardAvoidingView
            style={styles.modalMask}
            behavior={Platform.OS === 'ios' ? 'position' : undefined}
            keyboardVerticalOffset={0}
          >
            <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                contentContainerStyle={styles.modalScrollContent}
              >
                <Text style={styles.modalTitle}>大纲参数</Text>
                <Text style={styles.inputLabel}>目标章节数</Text>
                <TextInput
                  value={outlineChapters}
                  onChangeText={setOutlineChapters}
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholderTextColor={ui.colors.textTertiary}
                />

                <Text style={styles.inputLabel}>每章最少字数</Text>
                <TextInput
                  value={outlineMinChapterWords}
                  onChangeText={setOutlineMinChapterWords}
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholderTextColor={ui.colors.textTertiary}
                />

                <Text style={styles.inputLabel}>目标字数（万字）</Text>
                <TextInput
                  value={outlineWordCount}
                  onChangeText={setOutlineWordCount}
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholderTextColor={ui.colors.textTertiary}
                />

                <Text style={styles.inputLabel}>额外要求（可选）</Text>
                <TextInput
                  value={outlinePrompt}
                  onChangeText={setOutlinePrompt}
                  style={[styles.input, styles.inputArea]}
                  multiline
                  textAlignVertical="top"
                  placeholder="如：增加群像线、提高悬疑感"
                  placeholderTextColor={ui.colors.textTertiary}
                />

                <View style={styles.inlineRow}>
                  <Pressable style={styles.ghostButton} onPress={() => setOutlineModal(false)}>
                    <Text style={styles.ghostButtonText}>取消</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButtonCompact}
                    onPress={() => void handleGenerateOutline()}
                    disabled={runningAction !== null}
                  >
                    {runningAction === 'outline' ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>开始生成</Text>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          visible={chapterModalOpen}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setChapterModalOpen(false)}
        >
          <SafeAreaView style={[styles.chapterSafeArea, { paddingTop: insets.top }]} edges={['bottom']}>
            <View style={styles.chapterHeader}>
              <Text style={styles.chapterHeaderTitle} numberOfLines={1}>
                {chapterModalTitle}
              </Text>
              <View style={styles.chapterHeaderActions}>
                <Pressable
                  onPress={() => void openAdjacentChapter('prev')}
                  style={[styles.chapterActionBtn, !canOpenPrevChapter && styles.chapterActionDisabled]}
                  disabled={!canOpenPrevChapter || chapterLoading}
                >
                  <Text style={styles.chapterActionText}>上一章</Text>
                </Pressable>
                <Pressable
                  onPress={copyCurrentModalChapter}
                  style={[styles.chapterActionBtn, chapterLoading && styles.chapterActionDisabled]}
                  disabled={chapterLoading || !chapterModalContent}
                >
                  <Text style={styles.chapterActionText}>{chapterModalCopied ? '已复制' : '复制'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void openAdjacentChapter('next')}
                  style={[styles.chapterActionBtn, !canOpenNextChapter && styles.chapterActionDisabled]}
                  disabled={!canOpenNextChapter || chapterLoading}
                >
                  <Text style={styles.chapterActionText}>下一章</Text>
                </Pressable>
                <Pressable onPress={() => setChapterModalOpen(false)} style={styles.chapterCloseBtn}>
                  <Text style={styles.chapterCloseText}>关闭</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView contentContainerStyle={[styles.chapterContentWrap, { paddingBottom: insets.bottom + 24 }]}>
              {chapterLoading ? (
                <ActivityIndicator color={ui.colors.primary} />
              ) : (
                <Text style={styles.chapterContent}>{chapterModalContent || '章节内容为空'}</Text>
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function CharacterStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.characterStatCard}>
      <Text style={styles.characterStatValue}>{value}</Text>
      <Text style={styles.characterStatLabel}>{label}</Text>
    </View>
  );
}

function ModuleEntry({
  icon,
  title,
  desc,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  tone: 'warm' | 'accent' | 'sun' | 'primary';
  onPress: () => void;
}) {
  const toneStyle =
    tone === 'accent'
      ? styles.moduleCardAccent
      : tone === 'sun'
        ? styles.moduleCardSun
        : tone === 'primary'
          ? styles.moduleCardPrimary
          : styles.moduleCardWarm;

  return (
    <Pressable style={({ pressed }) => [styles.moduleCard, toneStyle, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.moduleTopRow}>
        <View style={styles.moduleIconWrap}>
          <Ionicons name={icon} size={14} color={ui.colors.primaryStrong} />
        </View>
        <Ionicons name="chevron-forward" size={16} color={ui.colors.textTertiary} />
      </View>
      <Text style={styles.moduleTitle}>{title}</Text>
      <Text style={styles.moduleDesc}>{desc}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: ui.colors.bg,
  },
  bgGradient: {
    flex: 1,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  centerText: {
    color: ui.colors.textSecondary,
  },
  headerCard: {
    backgroundColor: ui.colors.surfaceWarm,
    borderRadius: ui.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: ui.colors.border,
    gap: 10,
    shadowColor: ui.colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  headerBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.primarySoft,
    borderWidth: 1,
    borderColor: ui.colors.primaryBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerBadgeText: {
    color: ui.colors.primaryStrong,
    fontSize: 11,
    fontWeight: '700',
  },
  projectTitle: {
    color: ui.colors.text,
    fontSize: 25,
    fontWeight: '800',
  },
  projectSub: {
    color: ui.colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  progressTrack: {
    height: 10,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.bgMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: ui.colors.accent,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metaItem: {
    flex: 1,
    backgroundColor: ui.colors.cardAlt,
    borderRadius: ui.radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  metaLabel: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  metaValue: {
    color: ui.colors.text,
    fontWeight: '800',
    marginTop: 2,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  breadcrumbText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  panelNavContent: {
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  panelChip: {
    minWidth: 118,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.card,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panelChipActive: {
    borderColor: ui.colors.primaryBorder,
    backgroundColor: ui.colors.surfaceSun,
    shadowColor: ui.colors.primaryStrong,
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  panelChipTextWrap: {
    flex: 1,
  },
  panelChipTitle: {
    color: ui.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  panelChipTitleActive: {
    color: ui.colors.primaryStrong,
  },
  panelChipHint: {
    color: ui.colors.textTertiary,
    fontSize: 10,
    marginTop: 1,
  },
  errorInline: {
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  errorInlineText: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  activeTaskHintCard: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.accentBorder,
    backgroundColor: ui.colors.surfaceAccent,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activeTaskHintTextWrap: {
    flex: 1,
    gap: 2,
  },
  activeTaskHintTitle: {
    color: ui.colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  activeTaskHintText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
  },
  activeTaskHintBtn: {
    borderRadius: ui.radius.sm,
    backgroundColor: ui.colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  activeTaskHintBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  sectionStack: {
    gap: 12,
  },
  moduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  moduleCard: {
    width: '48.5%',
    minHeight: 118,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 10,
    gap: 8,
  },
  moduleCardWarm: {
    backgroundColor: ui.colors.surfaceSoft,
  },
  moduleCardAccent: {
    backgroundColor: ui.colors.surfaceAccent,
  },
  moduleCardSun: {
    backgroundColor: ui.colors.surfaceWarm,
  },
  moduleCardPrimary: {
    backgroundColor: ui.colors.surfaceSun,
    borderColor: ui.colors.primaryBorder,
  },
  moduleTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  moduleIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ui.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleTitle: {
    color: ui.colors.text,
    fontWeight: '800',
    fontSize: 14,
  },
  moduleDesc: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  infoCard: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
    gap: 8,
  },
  cardTitle: {
    color: ui.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  infoText: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  sectionCard: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.border,
    shadowColor: ui.colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionIconBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionOutlineIcon: {
    backgroundColor: ui.colors.accentSoft,
  },
  sectionChapterIcon: {
    backgroundColor: ui.colors.cardAlt,
  },
  sectionSummaryIcon: {
    backgroundColor: ui.colors.primarySoft,
  },
  sectionTitle: {
    color: ui.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionOutlineCard: {
    backgroundColor: ui.colors.surfaceAccent,
    borderColor: ui.colors.accentBorder,
  },
  sectionChapterCard: {
    backgroundColor: ui.colors.surfaceSoft,
  },
  sectionSummaryCard: {
    backgroundColor: ui.colors.surfaceWarm,
  },
  sectionBibleCard: {
    backgroundColor: ui.colors.surfaceAccent,
    borderColor: ui.colors.accentBorder,
  },
  sectionBibleIcon: {
    backgroundColor: ui.colors.accentSoft,
  },
  sectionHint: {
    color: ui.colors.textSecondary,
    fontSize: 12,
  },
  emptyText: {
    color: ui.colors.textSecondary,
    fontSize: 13,
  },
  outlineMetaCard: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    padding: 10,
    gap: 8,
  },
  outlineMetaTitle: {
    color: ui.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  outlineMetaText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  outlineMilestoneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  outlineToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  outlineToggleText: {
    color: ui.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  outlineMilestoneCollapsed: {
    borderRadius: ui.radius.sm,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  outlineMetaHint: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  outlineMetaEmpty: {
    color: ui.colors.textTertiary,
    fontSize: 12,
  },
  outlineMilestoneList: {
    gap: 6,
  },
  outlineMilestoneItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  outlineMilestoneDot: {
    color: ui.colors.primaryStrong,
    marginTop: 2,
  },
  outlineMilestoneText: {
    flex: 1,
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  volumeList: {
    gap: 8,
  },
  volumeCard: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    overflow: 'hidden',
  },
  volumeHeader: {
    minHeight: 50,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  volumeHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  volumeTitle: {
    color: ui.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  volumeMeta: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  volumeBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
  },
  volumeBodyText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  volumeChapterList: {
    marginTop: 4,
    gap: 2,
  },
  volumeChapterText: {
    color: ui.colors.textTertiary,
    fontSize: 11,
    lineHeight: 17,
  },
  chapterList: {
    gap: 8,
  },
  chapterItem: {
    backgroundColor: ui.colors.surfaceSoft,
    borderRadius: ui.radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderWidth: 1,
    borderColor: ui.colors.border,
    overflow: 'hidden',
  },
  chapterMainPressable: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chapterTextWrap: {
    flex: 1,
    gap: 2,
    paddingRight: 8,
  },
  chapterTitle: {
    color: ui.colors.text,
    fontWeight: '700',
  },
  chapterSubTitle: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  chapterCopyBtn: {
    minHeight: 56,
    paddingHorizontal: 10,
    borderLeftWidth: 1,
    borderLeftColor: ui.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: ui.colors.cardAlt,
  },
  chapterCopyBtnText: {
    color: ui.colors.primaryStrong,
    fontSize: 11,
    fontWeight: '700',
  },
  summaryText: {
    color: ui.colors.textSecondary,
    lineHeight: 21,
    fontSize: 14,
  },
  bibleBlock: {
    marginTop: 8,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  bibleBlockTitle: {
    color: ui.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  bibleBlockText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 19,
  },
  bibleMetaLine: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  loopList: {
    gap: 6,
  },
  loopItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loopText: {
    flex: 1,
    color: ui.colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  reviewCard: {
    marginTop: 4,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    padding: 10,
    gap: 4,
  },
  reviewTitle: {
    color: ui.colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  reviewText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  taskCard: {
    backgroundColor: ui.colors.infoSoft,
    borderRadius: ui.radius.lg,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.accentBorder,
  },
  taskText: {
    color: ui.colors.textSecondary,
    fontSize: 13,
  },
  taskProgressTrack: {
    height: 9,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.accentSoft,
    overflow: 'hidden',
  },
  taskProgressFill: {
    height: '100%',
    backgroundColor: ui.colors.info,
  },
  taskMeta: {
    color: ui.colors.textSecondary,
    fontSize: 12,
  },
  stopBtn: {
    alignSelf: 'flex-start',
    backgroundColor: ui.colors.danger,
    borderRadius: ui.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  stopBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  studioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countStepper: {
    width: 102,
    minHeight: 44,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.cardAlt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ui.colors.card,
  },
  stepValue: {
    color: ui.colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  primaryDockBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ui.colors.primaryStrong,
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  primaryDockBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  primaryButtonCompact: {
    flex: 1,
    backgroundColor: ui.colors.primary,
    minHeight: 44,
    borderRadius: ui.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  ghostButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: {
    color: ui.colors.textSecondary,
    fontWeight: '700',
  },
  warnButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warnButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  stopBtnWide: {
    backgroundColor: ui.colors.danger,
  },
  morePlaceholder: {
    flex: 1,
    minHeight: 44,
  },
  liveText: {
    color: ui.colors.accent,
    fontSize: 12,
    marginTop: 2,
  },
  editorTabRow: {
    gap: 8,
    paddingBottom: 2,
  },
  editorTab: {
    minWidth: 106,
    minHeight: 56,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    gap: 2,
  },
  editorTabActive: {
    backgroundColor: ui.colors.primarySoft,
    borderColor: ui.colors.primary,
  },
  editorTabText: {
    color: ui.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  editorTabTextActive: {
    color: ui.colors.primaryStrong,
  },
  editorTabHint: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  editorTabHintActive: {
    color: ui.colors.primaryStrong,
  },
  settingsField: {
    gap: 6,
  },
  settingsHelpText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  settingsInputTall: {
    minHeight: 180,
    paddingTop: 12,
  },
  promptProfileRow: {
    gap: 8,
    paddingVertical: 2,
  },
  promptProfileChip: {
    minHeight: 40,
    borderRadius: ui.radius.pill,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptProfileChipActive: {
    backgroundColor: ui.colors.primary,
    borderColor: ui.colors.primary,
  },
  promptProfileTitle: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  promptProfileTitleActive: {
    color: '#fff',
  },
  previewJumpBtn: {
    marginTop: 4,
  },
  disabledButton: {
    opacity: 0.55,
  },
  characterInlineError: {
    color: ui.colors.danger,
    fontSize: 12,
    lineHeight: 18,
  },
  characterLoadingBox: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  characterStatRow: {
    flexDirection: 'row',
    gap: 8,
  },
  characterStatCard: {
    flex: 1,
    minHeight: 72,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  characterStatValue: {
    color: ui.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  characterStatLabel: {
    color: ui.colors.textSecondary,
    fontSize: 11,
  },
  characterCardList: {
    gap: 8,
  },
  characterCard: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    padding: 10,
    gap: 6,
  },
  characterCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  characterNameWrap: {
    flex: 1,
    gap: 2,
  },
  characterName: {
    color: ui.colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  characterMeta: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  characterRoleBadge: {
    borderRadius: ui.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  characterRoleBadgePrimary: {
    backgroundColor: ui.colors.primarySoft,
  },
  characterRoleBadgeAlt: {
    backgroundColor: ui.colors.accentSoft,
  },
  characterRoleBadgeText: {
    color: ui.colors.primaryStrong,
    fontSize: 11,
    fontWeight: '800',
  },
  characterSummary: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  relationshipList: {
    gap: 8,
  },
  relationshipCard: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    padding: 10,
    gap: 6,
  },
  relationshipTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  relationshipRoute: {
    flex: 1,
    color: ui.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  relationshipType: {
    color: ui.colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  relationshipMeterTrack: {
    height: 6,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.surfaceSoft,
    overflow: 'hidden',
  },
  relationshipMeterFill: {
    height: '100%',
    backgroundColor: ui.colors.primary,
  },
  relationshipText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  factionList: {
    gap: 8,
  },
  factionCard: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    padding: 10,
    gap: 4,
  },
  factionTitle: {
    color: ui.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  factionText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  factionMeta: {
    color: ui.colors.textTertiary,
    fontSize: 11,
  },
  modalMask: {
    flex: 1,
    backgroundColor: 'rgba(35, 24, 10, 0.2)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: ui.colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  modalScrollContent: {
    gap: 8,
  },
  modalTitle: {
    color: ui.colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 4,
  },
  inputLabel: {
    color: ui.colors.textSecondary,
    fontSize: 13,
  },
  input: {
    backgroundColor: ui.colors.cardAlt,
    color: ui.colors.text,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputArea: {
    minHeight: 84,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    borderRadius: ui.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: ui.colors.textSecondary,
    fontWeight: '700',
  },
  chapterSafeArea: {
    flex: 1,
    backgroundColor: ui.colors.bg,
  },
  chapterHeader: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: ui.colors.border,
    gap: 8,
  },
  chapterHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  chapterHeaderTitle: {
    color: ui.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  chapterActionBtn: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chapterActionDisabled: {
    opacity: 0.45,
  },
  chapterActionText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  chapterCloseBtn: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chapterCloseText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  chapterContentWrap: {
    padding: 16,
  },
  chapterContent: {
    color: ui.colors.text,
    fontSize: 16,
    lineHeight: 28,
  },
  pressed: {
    opacity: 0.82,
  },
});
