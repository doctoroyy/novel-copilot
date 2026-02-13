import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import {
  createAnimeProject,
  fetchAnimeProjectDetail,
  fetchAnimeProjects,
  fetchChapterContent,
  fetchProject,
  fetchProjects,
  generateAnimeEpisodes,
} from '../../lib/api';
// isAIConfigured import removed
import { gradients, ui } from '../../theme/tokens';
import type { AnimeEpisode, AnimeProject, ProjectSummary } from '../../types/domain';

export function AnimeStudioScreen() {
  const { token } = useAuth();
  const { config } = useAppConfig();
  const insets = useSafeAreaInsets();

  const [novelProjects, setNovelProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectName, setSelectedProjectName] = useState<string>('');
  const [animeProjects, setAnimeProjects] = useState<AnimeProject[]>([]);
  const [animeProject, setAnimeProject] = useState<AnimeProject | null>(null);
  const [episodes, setEpisodes] = useState<AnimeEpisode[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingEpisode, setGeneratingEpisode] = useState<number | null>(null);
  const [episodesInput, setEpisodesInput] = useState('60');
  const [error, setError] = useState<string | null>(null);

  // aiReady removed as AI is server-side
  const animeProjectName = useMemo(
    () => (selectedProjectName ? `anime-${selectedProjectName}` : ''),
    [selectedProjectName],
  );

  const doneCount = useMemo(
    () => episodes.filter((item) => item.status === 'done').length,
    [episodes],
  );
  const progressPct = useMemo(() => {
    if (!episodes.length) return 0;
    return Math.min(100, Math.round((doneCount / episodes.length) * 100));
  }, [doneCount, episodes.length]);

  const loadAnimeDetail = useCallback(async (project: AnimeProject | null) => {
    if (!token || !project) {
      setAnimeProject(project);
      setEpisodes([]);
      return;
    }
    const detail = await fetchAnimeProjectDetail(config.apiBaseUrl, token, project.id);
    setAnimeProject(detail.project);
    setEpisodes(detail.episodes || []);
  }, [config.apiBaseUrl, token]);

  const loadAll = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [projectList, animeList] = await Promise.all([
        fetchProjects(config.apiBaseUrl, token),
        fetchAnimeProjects(config.apiBaseUrl, token),
      ]);

      setNovelProjects(projectList);
      setAnimeProjects(animeList);

      const fallbackProjectName = selectedProjectName || projectList[0]?.name || '';
      setSelectedProjectName(fallbackProjectName);

      if (!fallbackProjectName) {
        setAnimeProject(null);
        setEpisodes([]);
      } else {
        const matched = animeList.find((item) => item.name === `anime-${fallbackProjectName}`) || null;
        await loadAnimeDetail(matched);
      }

      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [config.apiBaseUrl, loadAnimeDetail, selectedProjectName, token]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedProjectName) return;
    const matched = animeProjects.find((item) => item.name === `anime-${selectedProjectName}`) || null;
    loadAnimeDetail(matched).catch((err) => {
      setError((err as Error).message);
    });
  }, [animeProjects, loadAnimeDetail, selectedProjectName]);

  const handleCreateAnimeProject = async () => {
    if (!token || !selectedProjectName) return;
    // aiReady check removed

    setCreating(true);
    setError(null);

    try {
      const detail = await fetchProject(config.apiBaseUrl, token, selectedProjectName);
      const chapterIndices = detail.chapters
        .map((item) => parseInt(item.replace(/\.md$/i, ''), 10))
        .filter((item) => Number.isFinite(item))
        .sort((a, b) => a - b);

      if (!chapterIndices.length) {
        throw new Error('该项目暂无章节，请先生成章节后再创建漫剧项目');
      }

      const chapters = await Promise.all(
        chapterIndices.map((index) => fetchChapterContent(config.apiBaseUrl, token, detail.name, index)),
      );
      const novelText = chapters.join('\n\n---\n\n');
      const totalEpisodes = Math.max(1, parseInt(episodesInput, 10) || 60);

      await createAnimeProject(config.apiBaseUrl, token, {
        name: `anime-${detail.name}`,
        novelText,
        totalEpisodes,
      }, config.ai);

      await loadAll(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateAll = async () => {
    if (!token || !animeProject) return;
    // aiReady check removed

    setGeneratingAll(true);
    try {
      await generateAnimeEpisodes(config.apiBaseUrl, token, animeProject.id, undefined, config.ai);
      await loadAll(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingAll(false);
    }
  };

  const handleGenerateEpisode = async (episodeNum: number) => {
    if (!token || !animeProject) return;
    // aiReady check removed

    setGeneratingEpisode(episodeNum);
    try {
      await generateAnimeEpisodes(config.apiBaseUrl, token, animeProject.id, {
        startEpisode: episodeNum,
        endEpisode: episodeNum,
      }, config.ai);
      await loadAll(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingEpisode(null);
    }
  };

  const statusText = (status: AnimeEpisode['status']) => {
    if (status === 'pending') return '待处理';
    if (status === 'script') return '剧本中';
    if (status === 'storyboard') return '分镜中';
    if (status === 'audio') return '音频中';
    if (status === 'video') return '视频中';
    if (status === 'processing') return '处理中';
    if (status === 'done') return '已完成';
    return '错误';
  };

  const statusStyle = (status: AnimeEpisode['status']) => {
    if (status === 'done') return styles.statusDone;
    if (status === 'error') return styles.statusError;
    if (status === 'pending') return styles.statusPending;
    return styles.statusRunning;
  };
  
  // ... (rest of the file)

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <LinearGradient colors={gradients.page} style={styles.bgGradient}>
          <View style={styles.centerBox}>
            <ActivityIndicator color={ui.colors.primary} />
            <Text style={styles.centerText}>加载漫剧工作台...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadAll(true)} tintColor={ui.colors.primary} />}
        >
          <View style={styles.headerWrap}>
            <View style={styles.headerBadge}>
              <Ionicons name="film-outline" size={12} color={ui.colors.primaryStrong} />
              <Text style={styles.headerBadgeText}>漫剧工位</Text>
            </View>
            <Text style={styles.pageTitle}>AI漫剧</Text>
            <Text style={styles.pageSubtitle}>将章节快速转换为分集脚本与分镜视频</Text>
          </View>

          <View style={styles.workflowRail}>
            <View style={styles.workflowItem}>
              <View style={[styles.workflowDot, styles.workflowDotPrimary]} />
              <Text style={styles.workflowText}>选择项目</Text>
            </View>
            <View style={styles.workflowLine} />
            <View style={styles.workflowItem}>
              <View style={[styles.workflowDot, styles.workflowDotAccent]} />
              <Text style={styles.workflowText}>创建分集</Text>
            </View>
            <View style={styles.workflowLine} />
            <View style={styles.workflowItem}>
              <View style={[styles.workflowDot, styles.workflowDotDone]} />
              <Text style={styles.workflowText}>生成视频</Text>
            </View>
          </View>

          <View style={[styles.card, styles.selectorCard]}>
            <Text style={styles.cardTitle}>选择小说项目</Text>
            {novelProjects.length === 0 ? (
              <Text style={styles.mutedText}>当前没有可用小说项目</Text>
            ) : (
              <View style={styles.projectChipWrap}>
                {novelProjects.map((item) => {
                  const active = item.name === selectedProjectName;
                  return (
                    <Pressable
                      key={item.name}
                      style={({ pressed }) => [
                        styles.projectChip,
                        active && styles.projectChipActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => setSelectedProjectName(item.name)}
                    >
                      <Text style={[styles.projectChipText, active && styles.projectChipTextActive]} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {!animeProject ? (
            <View style={[styles.card, styles.createCard]}>
              <Text style={styles.cardTitle}>创建漫剧项目</Text>
              <Text style={styles.mutedText}>
                当前项目：{selectedProjectName || '未选择'}。创建后会按章节内容切分为分集任务。
              </Text>

              <Text style={styles.inputLabel}>分集数量</Text>
              <TextInput
                value={episodesInput}
                onChangeText={setEpisodesInput}
                keyboardType="number-pad"
                style={styles.input}
                placeholder="60"
                placeholderTextColor={ui.colors.textTertiary}
              />

              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                onPress={() => void handleCreateAnimeProject()}
                disabled={creating || !selectedProjectName}
              >
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>创建并初始化</Text>}
              </Pressable>
            </View>
          ) : (
            <>
              <View style={[styles.card, styles.progressCard]}>
                <View style={styles.rowBetween}>
                  <View>
                    <Text style={styles.cardTitle}>项目状态</Text>
                    <Text style={styles.mutedText}>{animeProjectName}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.primaryButtonCompact, pressed && styles.pressed]}
                    onPress={() => void handleGenerateAll()}
                    disabled={generatingAll}
                  >
                    {generatingAll ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>全部生成</Text>}
                  </Pressable>
                </View>

                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                </View>
                <Text style={styles.progressText}>{doneCount}/{episodes.length} 集完成（{progressPct}%）</Text>
              </View>

              <View style={[styles.card, styles.episodesCard]}>
                <Text style={styles.cardTitle}>分集列表</Text>
                {episodes.length === 0 ? (
                  <Text style={styles.mutedText}>还没有分集数据，请先初始化项目。</Text>
                ) : (
                  <View style={styles.episodeList}>
                    {episodes.map((episode) => (
                      <View key={episode.id} style={styles.episodeRow}>
                        <View style={styles.episodeLeft}>
                          <View style={[styles.episodeIndexBubble, statusStyle(episode.status)]}>
                            <Text style={styles.episodeIndexText}>{episode.episode_num}</Text>
                          </View>
                          <Text style={styles.episodeTitle}>第 {episode.episode_num} 集</Text>
                          <View style={[styles.statusBadge, statusStyle(episode.status)]}>
                            <Text style={styles.statusText}>{statusText(episode.status)}</Text>
                          </View>
                        </View>
                        <Pressable
                          style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
                          onPress={() => void handleGenerateEpisode(episode.episode_num)}
                          disabled={generatingEpisode === episode.episode_num}
                        >
                          {generatingEpisode === episode.episode_num ? (
                            <ActivityIndicator color={ui.colors.primaryStrong} />
                          ) : (
                            <Text style={styles.ghostButtonText}>生成本集</Text>
                          )}
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {error ? <Text style={[styles.errorBar, { bottom: insets.bottom + 86 }]}>{error}</Text> : null}
      </LinearGradient>
    </SafeAreaView>
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
    padding: 16,
    gap: 12,
  },
  headerWrap: {
    marginBottom: 2,
    gap: 6,
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
  pageTitle: {
    color: ui.colors.text,
    fontSize: 42,
    fontWeight: '800',
  },
  pageSubtitle: {
    color: ui.colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  card: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
    gap: 10,
  },
  workflowRail: {
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.surfaceWarm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  workflowItem: {
    alignItems: 'center',
    gap: 5,
  },
  workflowDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  workflowDotPrimary: {
    backgroundColor: ui.colors.primary,
  },
  workflowDotAccent: {
    backgroundColor: ui.colors.accent,
  },
  workflowDotDone: {
    backgroundColor: ui.colors.success,
  },
  workflowLine: {
    flex: 1,
    height: 1,
    backgroundColor: ui.colors.border,
  },
  workflowText: {
    color: ui.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  selectorCard: {
    backgroundColor: ui.colors.surfaceSoft,
  },
  createCard: {
    backgroundColor: ui.colors.surfaceWarm,
    borderColor: ui.colors.border,
  },
  progressCard: {
    backgroundColor: ui.colors.surfaceAccent,
    borderColor: ui.colors.accentBorder,
  },
  episodesCard: {
    backgroundColor: ui.colors.card,
  },
  cardTitle: {
    color: ui.colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  mutedText: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  projectChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  projectChip: {
    maxWidth: '100%',
    borderRadius: ui.radius.pill,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  projectChipActive: {
    backgroundColor: ui.colors.accentSoft,
    borderColor: ui.colors.accentBorder,
  },
  projectChipText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  projectChipTextActive: {
    color: ui.colors.accent,
    fontWeight: '700',
  },
  inputLabel: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: ui.colors.cardAlt,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    color: ui.colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 15,
  },
  primaryButton: {
    marginTop: 2,
    minHeight: 46,
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
  primaryButtonCompact: {
    minHeight: 38,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  progressTrack: {
    height: 9,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.bgMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: ui.colors.accent,
  },
  progressText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
  },
  episodeList: {
    gap: 8,
  },
  episodeRow: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.cardAlt,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  episodeLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  episodeIndexBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  episodeIndexText: {
    color: ui.colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
  },
  episodeTitle: {
    color: ui.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: ui.radius.pill,
  },
  statusPending: {
    backgroundColor: ui.colors.bgMuted,
  },
  statusRunning: {
    backgroundColor: ui.colors.accentSoft,
  },
  statusDone: {
    backgroundColor: ui.colors.successSoft,
  },
  statusError: {
    backgroundColor: ui.colors.dangerSoft,
  },
  statusText: {
    color: ui.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  ghostButton: {
    minHeight: 34,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  ghostButtonText: {
    color: ui.colors.primaryStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  centerText: {
    color: ui.colors.textSecondary,
  },
  errorBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    color: '#fff',
    backgroundColor: ui.colors.danger,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.84,
  },
});
