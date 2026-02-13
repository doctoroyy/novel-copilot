import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { createProject, fetchProjects } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { gradients, ui } from '../../theme/tokens';
import type { ProjectSummary } from '../../types/domain';
import type { ProjectsStackParamList } from '../../types/navigation';
import { generateBible } from '../../lib/api';

export function ProjectsHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProjectsStackParamList>>();
  const { token } = useAuth();
  const { config } = useAppConfig();
  const insets = useSafeAreaInsets();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBible, setNewBible] = useState('');
  const [newChapters, setNewChapters] = useState('120');
  const [creating, setCreating] = useState(false);

  // AI Bible Generation State
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiGenre, setAiGenre] = useState('');
  const [aiTheme, setAiTheme] = useState('');
  const [aiKeywords, setAiKeywords] = useState('');
  const [generatingBible, setGeneratingBible] = useState(false);

  const loadProjects = useCallback(async (isRefresh = false) => {
    if (!token) return;

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await fetchProjects(config.apiBaseUrl, token);
      setProjects(result);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [config.apiBaseUrl, token]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const totalStats = useMemo(() => {
    const total = projects.length;
    const inProgress = projects.filter((p) => p.state.nextChapterIndex > 1 && p.state.nextChapterIndex <= p.state.totalChapters).length;
    const completed = projects.filter((p) => p.state.nextChapterIndex > p.state.totalChapters).length;
    return { total, inProgress, completed };
  }, [projects]);

  const missionProgress = useMemo(() => {
    const target = 3;
    const current = Math.min(target, totalStats.inProgress + totalStats.completed);
    return {
      current,
      target,
      pct: Math.round((current / target) * 100),
    };
  }, [totalStats.completed, totalStats.inProgress]);

  const handleCreate = async () => {
    if (!token) return;
    if (!newName.trim() || !newBible.trim()) return;

    setCreating(true);
    try {
      await createProject(config.apiBaseUrl, token, {
        name: newName.trim(),
        bible: newBible.trim(),
        totalChapters: Math.max(1, parseInt(newChapters, 10) || 120),
      });

      setShowCreateModal(false);
      setNewName('');
      setNewBible('');
      setNewChapters('120');
      await loadProjects();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateBible = async () => {
    if (!token) return;
    if (!aiGenre.trim()) {
      setError('请输入小说类型');
      return;
    }

    setGeneratingBible(true);
    try {
      const bible = await generateBible(
        config.apiBaseUrl,
        token,
        aiGenre,
        aiTheme,
        aiKeywords,
        config.ai
      );
      setNewBible(bible);
      setShowAiModal(false);
      // Reset AI fields
      setAiGenre('');
      setAiTheme('');
      setAiKeywords('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingBible(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
        <FlatList
          data={projects}
          keyExtractor={(item) => item.name}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 122 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadProjects(true)} tintColor={ui.colors.primary} />}
          ListHeaderComponent={
            <View style={styles.headerArea}>
              <View style={styles.heroPanel}>
                <View style={styles.headerRow}>
                  <View>
                    <Text style={styles.pageTitle}>Novel Copilot</Text>
                    <Text style={styles.pageSubtitle}>立项、生成、追踪一体化</Text>
                  </View>
                  <Pressable style={({ pressed }) => [styles.createPill, pressed && styles.pressed]} onPress={() => setShowCreateModal(true)}>
                    <Ionicons name="add" size={16} color="#fff" />
                    <Text style={styles.createPillText}>新建</Text>
                  </Pressable>
                </View>
                <View style={styles.heroDivider} />

                <View style={styles.missionCard}>
                  <View style={styles.missionTopRow}>
                    <View style={styles.missionBadge}>
                      <Ionicons name="flash" size={12} color={ui.colors.primaryStrong} />
                      <Text style={styles.missionBadgeText}>今日推进</Text>
                    </View>
                    <Text style={styles.missionValue}>{missionProgress.current}/{missionProgress.target}</Text>
                  </View>
                  <Text style={styles.missionText}>建议推进 3 个章节，保持稳定产出节奏</Text>
                  <View style={styles.missionTrack}>
                    <View style={[styles.missionFill, { width: `${missionProgress.pct}%` }]} />
                  </View>
                </View>
              </View>

              <View style={styles.statsRow}>
                <StatChip icon="layers-outline" label="总项目" value={totalStats.total} />
                <StatChip icon="sparkles-outline" label="进行中" value={totalStats.inProgress} />
                <StatChip icon="checkmark-done-outline" label="已完成" value={totalStats.completed} />
              </View>

              <View style={styles.overviewRow}>
                <View style={styles.overviewBadge}>
                  <Ionicons name="pulse-outline" size={11} color={ui.colors.accent} />
                  <Text style={styles.overviewBadgeText}>持续创作</Text>
                </View>
                <Text style={styles.overviewText}>当前有 {totalStats.inProgress} 个项目正在自动推进</Text>
              </View>

              <View style={styles.sectionStrip}>
                <Text style={styles.sectionStripText}>项目列表</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color={ui.colors.primary} />
                <Text style={styles.centerText}>加载项目中...</Text>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Ionicons name="book-outline" size={24} color={ui.colors.primary} />
                <Text style={styles.emptyTitle}>还没有项目</Text>
                <Text style={styles.emptyText}>先新建一个项目，再开始生成大纲和章节。</Text>
                <Pressable style={({ pressed }) => [styles.emptyActionBtn, pressed && styles.pressed]} onPress={() => setShowCreateModal(true)}>
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={styles.emptyActionText}>创建第一个项目</Text>
                </Pressable>
              </View>
            )
          }
          renderItem={({ item, index }) => {
            const generated = Math.max(0, item.state.nextChapterIndex - 1);
            const total = Math.max(1, item.state.totalChapters);
            const progress = Math.min(100, Math.round((generated / total) * 100));
            const toneStyle = index % 3 === 0
              ? styles.cardTonePrimary
              : index % 3 === 1
                ? styles.cardToneAccent
                : styles.cardToneNeutral;
            const topToneStyle = index % 3 === 0
              ? styles.cardTopTagPrimary
              : index % 3 === 1
                ? styles.cardTopTagAccent
                : styles.cardTopTagNeutral;

            return (
              <Pressable
                style={({ pressed }) => [styles.card, toneStyle, pressed && styles.pressed]}
                onPress={() => navigation.navigate('ProjectDetail', { projectName: item.name })}
              >
                <View style={[styles.cardTopTag, topToneStyle]}>
                  <Text style={styles.cardTopTagText}>{item.hasOutline ? '章节推进中' : '等待大纲'}</Text>
                </View>

                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={[styles.cardBadge, item.hasOutline ? styles.badgeReady : styles.badgeDraft]}>
                    {item.hasOutline ? '已建大纲' : '待建大纲'}
                  </Text>
                </View>

                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {item.state.rollingSummary ? `摘要：${item.state.rollingSummary}` : '摘要：暂无，生成章节后自动更新'}
                </Text>

                <View style={styles.progressRow}>
                  <Text style={styles.progressText}>{generated}/{total} 章</Text>
                  <Text style={styles.progressText}>{progress}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>

                <View style={styles.cardFooter}>
                  <Text style={item.state.needHuman ? styles.warningText : styles.readyText}>
                    {item.state.needHuman ? `待复核：${item.state.needHumanReason || '请检查章节连贯性'}` : '状态正常，可继续自动生成'}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={ui.colors.textTertiary} />
                </View>
              </Pressable>
            );
          }}
        />

        {error ? <Text style={[styles.errorBar, { bottom: insets.bottom + 86 }]}>{error}</Text> : null}
      </LinearGradient>

      <Modal visible={showCreateModal} animationType="slide" transparent onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalMask}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>新建项目</Text>

            <Text style={styles.inputLabel}>项目名称</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              style={styles.input}
              placeholder="例如：苍穹之下"
              placeholderTextColor={ui.colors.textTertiary}
            />

            <Text style={styles.inputLabel}>目标章节数</Text>
            <TextInput
              value={newChapters}
              onChangeText={setNewChapters}
              style={styles.input}
              keyboardType="number-pad"
              placeholder="120"
              placeholderTextColor={ui.colors.textTertiary}
            />

            <View style={styles.labelRow}>
              <Text style={styles.inputLabel}>故事设定 (Bible)</Text>
              <Pressable 
                style={({ pressed }) => [styles.aiBtn, pressed && styles.pressed]} 
                onPress={() => setShowAiModal(true)}
              >
                <Ionicons name="sparkles" size={12} color={ui.colors.primary} />
                <Text style={styles.aiBtnText}>AI 帮你想象</Text>
              </Pressable>
            </View>
            <TextInput
              value={newBible}
              onChangeText={setNewBible}
              style={[styles.input, styles.textArea]}
              multiline
              textAlignVertical="top"
              placeholder="世界观、主角设定、核心冲突..."
              placeholderTextColor={ui.colors.textTertiary}
            />

            <View style={styles.modalActions}>
              <Pressable style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.ghostBtnText}>取消</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} onPress={() => void handleCreate()} disabled={creating}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>创建</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showAiModal} animationType="slide" transparent onRequestClose={() => setShowAiModal(false)}>
        <View style={styles.modalMask}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>AI 辅助设定</Text>
            <Text style={styles.modalSubtitle}>输入关键词，AI 帮你生成完整世界观</Text>

            <Text style={styles.inputLabel}>类型 (必填)</Text>
            <TextInput
              value={aiGenre}
              onChangeText={setAiGenre}
              style={styles.input}
              placeholder="例如：玄幻、赛博朋克、都市重生..."
              placeholderTextColor={ui.colors.textTertiary}
            />

            <Text style={styles.inputLabel}>核心主题</Text>
            <TextInput
              value={aiTheme}
              onChangeText={setAiTheme}
              style={styles.input}
              placeholder="例如：复仇、成长、探索..."
              placeholderTextColor={ui.colors.textTertiary}
            />

            <Text style={styles.inputLabel}>关键词</Text>
            <TextInput
              value={aiKeywords}
              onChangeText={setAiKeywords}
              style={styles.input}
              placeholder="例如：系统、剑道、无敌..."
              placeholderTextColor={ui.colors.textTertiary}
            />

            <View style={styles.modalActions}>
              <Pressable style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]} onPress={() => setShowAiModal(false)}>
                <Text style={styles.ghostBtnText}>取消</Text>
              </Pressable>
              <Pressable 
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} 
                onPress={() => void handleGenerateBible()} 
                disabled={generatingBible}
              >
                {generatingBible ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>生成设定</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatChip({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number }) {
  return (
    <View style={styles.statChip}>
      <Ionicons name={icon} size={14} color={ui.colors.primaryStrong} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  listContent: {
    paddingBottom: 90,
    gap: 12,
  },
  headerArea: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 12,
  },
  heroPanel: {
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.surfaceWarm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroDivider: {
    height: 1,
    backgroundColor: ui.colors.border,
  },
  pageTitle: {
    color: ui.colors.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
  },
  pageSubtitle: {
    color: ui.colors.textSecondary,
    fontSize: 14,
    marginTop: 0,
    fontWeight: '500',
  },
  createPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 38,
  },
  createPillText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  overviewRow: {
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  overviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.accentSoft,
    borderWidth: 1,
    borderColor: ui.colors.accentBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  overviewBadgeText: {
    color: ui.colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  overviewText: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  sectionStrip: {
    alignSelf: 'flex-start',
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sectionStripText: {
    color: ui.colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  missionCard: {
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.surfaceSoft,
    padding: 12,
    gap: 8,
  },
  missionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  missionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ui.colors.accentSoft,
    borderRadius: ui.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: ui.colors.accentBorder,
  },
  missionBadgeText: {
    color: ui.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  missionValue: {
    color: ui.colors.primaryStrong,
    fontWeight: '800',
    fontSize: 13,
  },
  missionText: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  missionTrack: {
    height: 8,
    borderRadius: ui.radius.pill,
    overflow: 'hidden',
    backgroundColor: ui.colors.bgMuted,
  },
  missionFill: {
    height: '100%',
    backgroundColor: ui.colors.accent,
  },
  statChip: {
    flex: 1,
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ui.colors.border,
    gap: 3,
  },
  statValue: {
    color: ui.colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    color: ui.colors.textTertiary,
    fontSize: 12,
  },
  centerBox: {
    marginTop: 70,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  centerText: {
    color: ui.colors.textSecondary,
  },
  emptyBox: {
    marginTop: 58,
    marginHorizontal: 16,
    alignItems: 'center',
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.card,
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 8,
  },
  emptyTitle: {
    color: ui.colors.text,
    fontWeight: '700',
    fontSize: 18,
  },
  emptyText: {
    color: ui.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyActionBtn: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.primary,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  emptyActionText: {
    color: '#fff',
    fontWeight: '700',
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    padding: 15,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.border,
    shadowColor: ui.colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTonePrimary: {
    backgroundColor: ui.colors.surfaceSoft,
  },
  cardToneAccent: {
    backgroundColor: ui.colors.surfaceAccent,
  },
  cardToneNeutral: {
    backgroundColor: ui.colors.card,
  },
  cardTopTag: {
    alignSelf: 'flex-start',
    borderRadius: ui.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  cardTopTagPrimary: {
    backgroundColor: ui.colors.primarySoft,
    borderColor: ui.colors.primaryBorder,
  },
  cardTopTagAccent: {
    backgroundColor: ui.colors.accentSoft,
    borderColor: ui.colors.accentBorder,
  },
  cardTopTagNeutral: {
    backgroundColor: ui.colors.bgMuted,
    borderColor: ui.colors.border,
  },
  cardTopTagText: {
    color: ui.colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: ui.colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  cardBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: ui.radius.pill,
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
  },
  badgeReady: {
    color: ui.colors.accent,
    backgroundColor: ui.colors.accentSoft,
    borderColor: ui.colors.accentBorder,
  },
  badgeDraft: {
    color: ui.colors.primaryStrong,
    backgroundColor: ui.colors.primarySoft,
    borderColor: ui.colors.primaryBorder,
  },
  cardSubtitle: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    color: ui.colors.textTertiary,
    fontSize: 12,
  },
  progressTrack: {
    height: 8,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.bgMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: ui.colors.accent,
  },
  cardFooter: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  warningText: {
    color: ui.colors.primaryStrong,
    fontSize: 12,
    fontWeight: '600',
  },
  readyText: {
    color: ui.colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  errorBar: {
    position: 'absolute',
    bottom: 18,
    left: 16,
    right: 16,
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
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  sheetHandle: {
    width: 46,
    height: 5,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    color: ui.colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  inputLabel: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ui.colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: ui.radius.sm,
  },
  aiBtnText: {
    color: ui.colors.primaryStrong,
    fontSize: 11,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    marginTop: -4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: ui.colors.cardAlt,
    color: ui.colors.text,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  textArea: {
    minHeight: 120,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  ghostBtn: {
    flex: 1,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ui.colors.cardAlt,
  },
  ghostBtnText: {
    color: ui.colors.textSecondary,
    fontWeight: '700',
  },
  primaryBtn: {
    flex: 1,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.primary,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ui.colors.primaryStrong,
    shadowOpacity: 0.16,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.84,
  },
});
