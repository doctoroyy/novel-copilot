import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  fetchChapterContent,
  fetchProject,
  fetchProjectActiveTask,
  generateChaptersStream,
  generateOutlineStream,
  resetProject,
} from '../../lib/api';
import type { GenerationTask, ProjectDetail } from '../../types/domain';
import { isAIConfigured } from '../../lib/storage';
import { gradients, ui } from '../../theme/tokens';

type ScreenRoute = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;

export function ProjectDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProjectsStackParamList>>();
  const route = useRoute<ScreenRoute>();
  const projectName = route.params.projectName;

  const { token } = useAuth();
  const { config } = useAppConfig();
  const insets = useSafeAreaInsets();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [outlineModal, setOutlineModal] = useState(false);
  const [outlineChapters, setOutlineChapters] = useState('120');
  const [outlineWordCount, setOutlineWordCount] = useState('30');
  const [outlinePrompt, setOutlinePrompt] = useState('');

  const [chapterCount, setChapterCount] = useState('1');
  const [showMoreActions, setShowMoreActions] = useState(false);
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

  const taskPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadProject = useCallback(async () => {
    if (!token) return;

    try {
      setLoading(true);
      const detail = await fetchProject(config.apiBaseUrl, token, projectName);
      setProject(detail);
      setOutlineChapters(String(detail.state.totalChapters || 120));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.apiBaseUrl, projectName, token]);

  const loadTask = useCallback(async () => {
    if (!token) return;
    try {
      const task = await fetchProjectActiveTask(config.apiBaseUrl, token, projectName);
      setActiveTask(task);
    } catch {
      // silent: task panel degrades gracefully
    }
  }, [config.apiBaseUrl, projectName, token]);

  useEffect(() => {
    void loadProject();
    void loadTask();
  }, [loadProject, loadTask]);

  useEffect(() => {
    if (!token) return;

    taskPollTimer.current = setInterval(() => {
      void loadTask();
    }, 3500);

    return () => {
      if (taskPollTimer.current) {
        clearInterval(taskPollTimer.current);
        taskPollTimer.current = null;
      }
    };
  }, [loadTask, token]);

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
  const chapterIndices = useMemo(() => (
    project
      ? project.chapters
          .map((file) => parseInt(file.replace(/\.md$/i, ''), 10))
          .filter((value) => Number.isFinite(value))
          .sort((a, b) => a - b)
      : []
  ), [project]);
  const canOpenPrevChapter = useMemo(
    () => chapterModalIndex !== null && chapterIndices.includes(chapterModalIndex - 1),
    [chapterIndices, chapterModalIndex],
  );
  const canOpenNextChapter = useMemo(
    () => chapterModalIndex !== null && chapterIndices.includes(chapterModalIndex + 1),
    [chapterIndices, chapterModalIndex],
  );

  const actionDockOffset = useMemo(() => (showMoreActions ? 252 : 172), [showMoreActions]);

  const ensureReady = useCallback(() => {
    if (!token) {
      setError('登录状态已失效，请重新登录');
      return false;
    }

    if (!isAIConfigured(config.ai)) {
      Alert.alert('缺少 AI 配置', '请先到“设置”中填写 provider/model/api key。');
      return false;
    }

    return true;
  }, [config.ai, token]);

  const handleGenerateOutline = async () => {
    if (!project || !ensureReady() || !token) return;

    setRunningAction('outline');
    setLiveMessage('开始生成大纲...');

    try {
      await generateOutlineStream(
        config.apiBaseUrl,
        token,
        project.name,
        {
          targetChapters: Math.max(1, parseInt(outlineChapters, 10) || project.state.totalChapters || 120),
          targetWordCount: Math.max(1, parseInt(outlineWordCount, 10) || 30),
          customPrompt: outlinePrompt.trim() || undefined,
        },
        config.ai,
        (event) => {
          if (event.type === 'progress' && event.message) setLiveMessage(event.message);
          if (event.type === 'volume_complete') {
            setLiveMessage(`卷 ${event.volumeIndex}/${event.totalVolumes} 完成：${event.volumeTitle || ''}`.trim());
          }
          if (event.type === 'done') setLiveMessage('大纲生成完成');
        },
      );

      setOutlineModal(false);
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

    const count = Math.max(1, parseInt(chapterCount, 10) || 1);
    setRunningAction('generate');
    setLiveMessage(`准备生成 ${count} 章...`);

    try {
      await generateChaptersStream(
        config.apiBaseUrl,
        token,
        project.name,
        { chaptersToGenerate: count },
        config.ai,
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
      );

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
            await resetProject(config.apiBaseUrl, token, project.name);
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
            await cancelAllActiveTasks(config.apiBaseUrl, token, project.name);
            await loadTask();
          } catch (err) {
            setError((err as Error).message);
          }
        },
      },
    ]);
  };

  const openChapter = useCallback(async (chapterIndex: number) => {
    if (!token || !project) return;

    setChapterModalOpen(true);
    setChapterModalIndex(chapterIndex);
    setChapterModalTitle(`${project.name} · 第 ${chapterIndex} 章`);
    setChapterModalContent('');
    setChapterModalCopied(false);
    setChapterLoading(true);

    try {
      const content = await fetchChapterContent(config.apiBaseUrl, token, project.name, chapterIndex);
      setChapterModalContent(content);
    } catch (err) {
      setChapterModalContent(`加载失败：${(err as Error).message}`);
    } finally {
      setChapterLoading(false);
    }
  }, [config.apiBaseUrl, project, token]);

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
      const content = await fetchChapterContent(config.apiBaseUrl, token, project.name, chapterIndex);
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

  if (loading && !project) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
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
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
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
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + actionDockOffset }]}>
        <View style={styles.headerCard}>
          <View style={styles.headerBadge}>
            <Ionicons name="compass-outline" size={12} color={ui.colors.primaryStrong} />
            <Text style={styles.headerBadgeText}>项目驾驶舱</Text>
          </View>
          <Text style={styles.projectTitle}>{project.name}</Text>
          <Text style={styles.projectSub}>进度 {project.state.nextChapterIndex - 1}/{project.state.totalChapters}</Text>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>

          <View style={styles.metaRow}>
            <Meta label="进度" value={`${progressPct}%`} />
            <Meta label="大纲" value={project.outline ? '已生成' : '未生成'} />
            <Meta label="需人工" value={project.state.needHuman ? '是' : '否'} />
          </View>
        </View>

        {activeTask ? (
          <View style={styles.taskCard}>
            <Text style={styles.cardTitle}>当前生成任务</Text>
            <Text style={styles.taskText}>{activeTask.currentMessage || `第 ${activeTask.currentProgress} 章处理中`}</Text>
            <View style={styles.taskProgressTrack}>
              <View style={[styles.taskProgressFill, { width: `${activeTaskPct}%` }]} />
            </View>
            <Text style={styles.taskMeta}>{activeTask.completedChapters.length}/{activeTask.targetCount} 完成</Text>
            <Pressable style={styles.stopBtn} onPress={handleCancelTask}>
              <Text style={styles.stopBtnText}>停止任务</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionStack}>
          <View style={[styles.sectionCard, styles.sectionGuideCard]}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconBadge, styles.sectionGuideIcon]}>
                <Ionicons name="sparkles-outline" size={13} color={ui.colors.primaryStrong} />
              </View>
              <Text style={styles.sectionTitle}>操作说明</Text>
            </View>
            <Text style={styles.cardHint}>
              章节主操作已固定在底部，单手即可继续生成。更多操作在“更多”里展开。
            </Text>
            <Pressable
              style={({ pressed }) => [styles.inlineGhostBtn, pressed && styles.pressed]}
              onPress={() => navigation.getParent()?.navigate('AnimeTab' as never)}
            >
              <Ionicons name="film-outline" size={14} color={ui.colors.primaryStrong} />
              <Text style={styles.inlineGhostBtnText}>进入 AI 漫剧</Text>
            </Pressable>
          </View>

          <View style={[styles.sectionCard, styles.sectionOutlineCard]}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconBadge, styles.sectionOutlineIcon]}>
                <Ionicons name="library-outline" size={13} color={ui.colors.accent} />
              </View>
              <Text style={styles.sectionTitle}>大纲预览</Text>
            </View>
            {!project.outline ? (
              <Text style={styles.emptyText}>还没有大纲，可通过底部按钮先生成大纲。</Text>
            ) : (
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
                          <Text style={styles.volumeTitle} numberOfLines={1}>第 {volIndex + 1} 卷 · {volume.title}</Text>
                          <Text style={styles.volumeMeta}>第 {volume.startChapter}-{volume.endChapter} 章 · {volume.chapters.length} 章</Text>
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
            )}
          </View>

          <View style={[styles.sectionCard, styles.sectionChapterCard]}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconBadge, styles.sectionChapterIcon]}>
                <Ionicons name="document-text-outline" size={13} color={ui.colors.primaryStrong} />
              </View>
              <Text style={styles.sectionTitle}>章节列表</Text>
            </View>
            <Text style={styles.sectionHint}>点击章节可查看正文预览</Text>
            {project.chapters.length === 0 ? (
              <Text style={styles.emptyText}>还没有章节，先生成 1 章试试。</Text>
            ) : (
              <View style={styles.chapterList}>
                {project.chapters.map((file) => {
                  const index = parseInt(file.replace(/\.md$/i, ''), 10);
                  return (
                    <View key={file} style={styles.chapterItem}>
                      <Pressable
                        style={({ pressed }) => [styles.chapterMainPressable, pressed && styles.pressed]}
                        onPress={() => void openChapter(index)}
                      >
                        <View style={styles.chapterTextWrap}>
                          <Text style={styles.chapterTitle}>第 {index} 章</Text>
                          <Text style={styles.chapterSubTitle}>点击查看正文预览</Text>
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

          <View style={[styles.sectionCard, styles.sectionSummaryCard]}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconBadge, styles.sectionSummaryIcon]}>
                <Ionicons name="newspaper-outline" size={13} color={ui.colors.primaryStrong} />
              </View>
              <Text style={styles.sectionTitle}>剧情摘要</Text>
            </View>
            <Text style={styles.summaryText}>{project.state.rollingSummary || '暂无摘要'}</Text>
          </View>
        </View>
      </ScrollView>

      {error ? <Text style={[styles.errorBar, { bottom: insets.bottom + actionDockOffset + 10 }]}>{error}</Text> : null}

      <View style={[styles.actionDock, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.actionTopRow}>
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
              <Text style={styles.primaryDockBtnText}>{project.outline ? '继续生成章节' : '先生成大纲'}</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.moreBtn, pressed && styles.pressed]}
            onPress={() => setShowMoreActions((prev) => !prev)}
          >
            <Ionicons name={showMoreActions ? 'chevron-down' : 'chevron-up'} size={18} color={ui.colors.textSecondary} />
            <Text style={styles.moreBtnText}>更多</Text>
          </Pressable>
        </View>

        {showMoreActions ? (
          <View style={styles.moreActionGrid}>
            <Pressable style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]} onPress={() => void loadProject()}>
              <Text style={styles.ghostButtonText}>刷新数据</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]} onPress={() => setOutlineModal(true)}>
              <Text style={styles.ghostButtonText}>{project.outline ? '重建大纲' : '生成大纲'}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.warnButton, pressed && styles.pressed]} onPress={handleResetProject} disabled={runningAction !== null}>
              {runningAction === 'reset' ? <ActivityIndicator color="#fff" /> : <Text style={styles.warnButtonText}>重置项目</Text>}
            </Pressable>
            {activeTask ? (
              <Pressable style={({ pressed }) => [styles.warnButton, styles.stopBtnWide, pressed && styles.pressed]} onPress={handleCancelTask}>
                <Text style={styles.warnButtonText}>停止任务</Text>
              </Pressable>
            ) : (
              <View style={styles.morePlaceholder} />
            )}
          </View>
        ) : null}

        {runningAction ? <Text style={styles.liveText}>{liveMessage || '处理中...'}</Text> : null}
      </View>

      <Modal visible={outlineModal} animationType="slide" transparent onRequestClose={() => setOutlineModal(false)}>
        <View style={styles.modalMask}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>大纲参数</Text>
            <Text style={styles.inputLabel}>目标章节数</Text>
            <TextInput
              value={outlineChapters}
              onChangeText={setOutlineChapters}
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
              <Pressable style={styles.primaryButtonCompact} onPress={() => void handleGenerateOutline()} disabled={runningAction !== null}>
                {runningAction === 'outline' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>开始生成</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={chapterModalOpen} animationType="slide" onRequestClose={() => setChapterModalOpen(false)}>
        <SafeAreaView style={styles.chapterSafeArea} edges={['top', 'bottom']}>
            <View style={styles.chapterHeader}>
              <Text style={styles.chapterHeaderTitle} numberOfLines={1}>{chapterModalTitle}</Text>
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
    paddingBottom: 100,
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
    backgroundColor: '#fff9f1',
    borderRadius: ui.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e7d7c4',
    gap: 10,
    shadowColor: '#1a1712',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
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
    borderColor: '#e8c3ac',
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
  taskCard: {
    backgroundColor: ui.colors.infoSoft,
    borderRadius: ui.radius.lg,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#c6d8e9',
  },
  cardTitle: {
    color: ui.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  taskText: {
    color: ui.colors.textSecondary,
    fontSize: 13,
  },
  taskProgressTrack: {
    height: 9,
    borderRadius: ui.radius.pill,
    backgroundColor: '#cddbeb',
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
  actionCard: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  cardHint: {
    color: ui.colors.textSecondary,
    fontSize: 12,
  },
  inlineGhostBtn: {
    marginTop: 2,
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineGhostBtnText: {
    color: ui.colors.primaryStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: ui.colors.primary,
    minHeight: 44,
    borderRadius: ui.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
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
  inlineRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countInput: {
    width: 68,
    backgroundColor: '#fff',
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    color: ui.colors.text,
    textAlign: 'center',
    fontSize: 16,
    minHeight: 44,
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
  liveText: {
    color: ui.colors.accent,
    fontSize: 12,
    marginTop: 2,
  },
  actionDock: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.card,
    paddingTop: 10,
    paddingHorizontal: 10,
    gap: 8,
    shadowColor: '#1a1712',
    shadowOpacity: 0.09,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 5,
  },
  actionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countStepper: {
    width: 96,
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
  moreBtn: {
    width: 58,
    minHeight: 44,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  moreBtnText: {
    color: ui.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  moreActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stopBtnWide: {
    backgroundColor: ui.colors.danger,
  },
  morePlaceholder: {
    flex: 1,
    minHeight: 44,
  },
  sectionCard: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.border,
    shadowColor: '#1a1712',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sectionStack: {
    gap: 12,
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
  sectionGuideIcon: {
    backgroundColor: ui.colors.primarySoft,
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
  sectionGuideCard: {
    backgroundColor: '#fff9f1',
    borderColor: '#ead7be',
  },
  sectionOutlineCard: {
    backgroundColor: '#f6f9fd',
    borderColor: '#d5e3ee',
  },
  sectionChapterCard: {
    backgroundColor: '#fffdf9',
  },
  sectionSummaryCard: {
    backgroundColor: '#fffbf4',
  },
  sectionHint: {
    color: ui.colors.textSecondary,
    fontSize: 12,
  },
  emptyText: {
    color: ui.colors.textSecondary,
    fontSize: 13,
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
    backgroundColor: '#fffdf9',
    borderRadius: ui.radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderWidth: 1,
    borderColor: '#e3d8ca',
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
  errorBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 14,
    color: '#fff',
    backgroundColor: ui.colors.danger,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
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
