import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { useActiveTasks } from '../../hooks/useActiveTasks';
import { gradients, ui } from '../../theme/tokens';
import type { GenerationTask } from '../../types/domain';

export function ActivityScreen() {
  const { token } = useAuth();
  const { config } = useAppConfig();
  const insets = useSafeAreaInsets();

  const { tasks, loading, refresh, error } = useActiveTasks({
    apiBaseUrl: config.apiBaseUrl,
    token,
    enabled: Boolean(token),
    pollIntervalMs: 8000,
  });
  const runningCount = tasks.filter((item) => item.status === 'running').length;
  const idleCount = Math.max(0, tasks.length - runningCount);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
        <FlatList
          data={tasks}
          keyExtractor={(item) => `${item.id}`}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 122 }]}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={ui.colors.primary} />}
          ListHeaderComponent={
            <View style={styles.headerWrap}>
              <Text style={styles.pageTitle}>任务中心</Text>
              <Text style={styles.pageSubtitle}>生成任务与系统任务统一看板</Text>
              <View style={styles.summaryPanel}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{runningCount}</Text>
                  <Text style={styles.summaryLabel}>运行中</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{idleCount}</Text>
                  <Text style={styles.summaryLabel}>等待中</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{tasks.length}</Text>
                  <Text style={styles.summaryLabel}>总任务</Text>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="sparkles-outline" size={24} color={ui.colors.primary} />
              <Text style={styles.emptyTitle}>当前没有活跃任务</Text>
              <Text style={styles.emptyText}>去「项目」页发起生成，或触发模板刷新任务，会在这里实时展示。</Text>
            </View>
          }
          renderItem={({ item }) => <TaskCard task={item} />}
        />

        {error ? <Text style={[styles.errorBar, { bottom: insets.bottom + 86 }]}>{error}</Text> : null}
      </LinearGradient>
    </SafeAreaView>
  );
}

function TaskCard({ task }: { task: GenerationTask }) {
  const taskType = task.taskType || 'chapters';
  const taskLabel = taskType === 'chapters'
    ? '章节生成'
    : taskType === 'outline'
      ? '大纲生成'
      : taskType === 'bible'
        ? 'Story Bible'
        : '系统任务';
  const statusLabel = task.status === 'running'
    ? '运行中'
    : task.status === 'paused'
      ? '等待中'
      : task.status === 'completed'
        ? '已完成'
        : '失败';
  const done = taskType === 'chapters' ? task.completedChapters.length : Math.max(0, task.currentProgress || 0);
  const total = taskType === 'chapters' ? Math.max(1, task.targetCount) : Math.max(0, task.targetCount);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  const isRunning = task.status === 'running';
  const updatedAtMs = task.updatedAtMs || task.updatedAt || Date.now();

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{task.projectName || '未命名任务'}</Text>
        <View style={[styles.statusBadge, isRunning ? styles.statusRunning : styles.statusIdle]}>
          <Ionicons
            name={isRunning ? 'sync-outline' : 'pause-outline'}
            size={11}
            color={isRunning ? ui.colors.success : ui.colors.textSecondary}
          />
          <Text style={[styles.statusText, isRunning ? styles.statusTextRunning : styles.statusTextIdle]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <Text style={styles.cardMessage}>{task.currentMessage || '任务处理中'}</Text>

      {pct !== null ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      ) : null}

      <View style={styles.rowBetween}>
        <Text style={styles.metaText}>
          {total > 0 ? `${done}/${total}` : taskLabel}
        </Text>
        <Text style={styles.metaText}>
          更新于 {new Date(updatedAtMs).toLocaleTimeString('zh-CN', { hour12: false })}
        </Text>
      </View>

      {taskType === 'chapters' ? (
        <Text style={styles.metaText}>当前：第 {task.currentProgress || task.startChapter} 章</Text>
      ) : null}

      {taskType === 'chapters' && task.failedChapters.length > 0 ? (
        <Text style={styles.failText}>失败章节：{task.failedChapters.join(', ')}</Text>
      ) : null}
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
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 10,
  },
  pageTitle: {
    color: ui.colors.text,
    fontSize: 42,
    fontWeight: '800',
  },
  pageSubtitle: {
    color: ui.colors.textSecondary,
    fontSize: 14,
    marginTop: 0,
    fontWeight: '500',
  },
  summaryPanel: {
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.surfaceWarm,
    paddingHorizontal: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  summaryValue: {
    color: ui.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  summaryLabel: {
    color: ui.colors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
  },
  summaryDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: ui.colors.border,
  },
  listContent: {
    paddingBottom: 100,
    gap: 10,
  },
  emptyBox: {
    marginTop: 70,
    marginHorizontal: 16,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.card,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    gap: 8,
  },
  emptyTitle: {
    color: ui.colors.text,
    fontWeight: '700',
    fontSize: 17,
  },
  emptyText: {
    color: ui.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    fontSize: 13,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: ui.colors.border,
    shadowColor: ui.colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    color: ui.colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  statusBadge: {
    borderRadius: ui.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 2,
  },
  statusRunning: {
    backgroundColor: ui.colors.successSoft,
    borderColor: ui.colors.accentBorder,
  },
  statusIdle: {
    backgroundColor: ui.colors.bgMuted,
    borderColor: ui.colors.border,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusTextRunning: {
    color: ui.colors.success,
  },
  statusTextIdle: {
    color: ui.colors.textSecondary,
  },
  cardMessage: {
    color: ui.colors.textSecondary,
    fontSize: 13,
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
  metaText: {
    color: ui.colors.textTertiary,
    fontSize: 12,
  },
  failText: {
    color: ui.colors.danger,
    fontSize: 12,
  },
  errorBar: {
    position: 'absolute',
    bottom: 14,
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
});
