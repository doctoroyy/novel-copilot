import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { isAIConfigured } from '../../lib/storage';
import { gradients, ui } from '../../theme/tokens';

export function SettingsScreen() {
  const { config, updateConfig, saving } = useAppConfig();
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();

  const [apiBaseUrl, setApiBaseUrl] = useState(config.apiBaseUrl);
  const [provider, setProvider] = useState(config.ai.provider);
  const [model, setModel] = useState(config.ai.model);
  const [apiKey, setApiKey] = useState(config.ai.apiKey);
  const [aiBaseUrl, setAiBaseUrl] = useState(config.ai.baseUrl || '');

  useEffect(() => {
    setApiBaseUrl(config.apiBaseUrl);
    setProvider(config.ai.provider);
    setModel(config.ai.model);
    setApiKey(config.ai.apiKey);
    setAiBaseUrl(config.ai.baseUrl || '');
  }, [config]);

  const aiReady = useMemo(
    () => isAIConfigured({ provider, model, apiKey, baseUrl: aiBaseUrl || undefined }),
    [aiBaseUrl, apiKey, model, provider],
  );

  const handleSave = async () => {
    try {
      await updateConfig({
        apiBaseUrl,
        ai: {
          provider,
          model,
          apiKey,
          baseUrl: aiBaseUrl || undefined,
        },
      });
      Alert.alert('已保存', '设置已更新');
    } catch (err) {
      Alert.alert('保存失败', (err as Error).message);
    }
  };

  const handleLogout = () => {
    Alert.alert('退出登录', '是否确认退出当前账号？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          void logout();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]}>
          <View style={styles.headerWrap}>
            <Text style={styles.pageTitle}>设置</Text>
            <Text style={styles.pageSubtitle}>管理账号、服务地址与 AI 模型参数</Text>
          </View>

          <View style={styles.statusStrip}>
            <View style={styles.statusChip}>
              <Ionicons name={aiReady ? 'checkmark-circle' : 'alert-circle'} size={14} color={aiReady ? ui.colors.success : ui.colors.danger} />
              <Text style={styles.statusChipText}>{aiReady ? 'AI 已就绪' : 'AI 未就绪'}</Text>
            </View>
            <Text style={styles.statusHost} numberOfLines={1}>{apiBaseUrl.replace(/^https?:\/\//, '')}</Text>
          </View>

          <View style={[styles.card, styles.accountCard]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="person-circle-outline" size={18} color={ui.colors.primaryStrong} />
              <Text style={styles.cardTitle}>账号</Text>
            </View>
            <Text style={styles.accountText}>当前用户：{user?.username || '未知'}</Text>
            <Text style={styles.accountRole}>权限组：{user?.role || 'user'}</Text>
            <Pressable style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={16} color="#fff" />
              <Text style={styles.logoutButtonText}>退出登录</Text>
            </Pressable>
          </View>

          <View style={[styles.card, styles.serviceCard]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="cloud-outline" size={18} color={ui.colors.primaryStrong} />
              <Text style={styles.cardTitle}>服务地址</Text>
            </View>
            <Text style={styles.label}>后端地址</Text>
            <TextInput
              value={apiBaseUrl}
              onChangeText={setApiBaseUrl}
              autoCapitalize="none"
              style={styles.input}
              placeholder="https://novel-copilot.doctoroyy.workers.dev"
              placeholderTextColor={ui.colors.textTertiary}
            />
          </View>

          <View style={[styles.card, styles.aiCard]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="hardware-chip-outline" size={18} color={ui.colors.primaryStrong} />
              <Text style={styles.cardTitle}>AI 引擎</Text>
            </View>

            <Text style={styles.label}>模型提供方（provider）</Text>
            <TextInput
              value={provider}
              onChangeText={setProvider}
              autoCapitalize="none"
              style={styles.input}
              placeholder="例如：gemini / custom / deepseek"
              placeholderTextColor={ui.colors.textTertiary}
            />

            <Text style={styles.label}>模型名称（model）</Text>
            <TextInput
              value={model}
              onChangeText={setModel}
              autoCapitalize="none"
              style={styles.input}
              placeholder="gemini-3-pro"
              placeholderTextColor={ui.colors.textTertiary}
            />

            <Text style={styles.label}>接口密钥（api key）</Text>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              style={styles.input}
              placeholder="sk-... / nvapi-..."
              placeholderTextColor={ui.colors.textTertiary}
              secureTextEntry
            />

            <Text style={styles.label}>Base URL（可选）</Text>
            <TextInput
              value={aiBaseUrl}
              onChangeText={setAiBaseUrl}
              autoCapitalize="none"
              style={styles.input}
              placeholder="https://api.openai.com/v1"
              placeholderTextColor={ui.colors.textTertiary}
            />

            <View style={[styles.configState, aiReady ? styles.readyBox : styles.notReadyBox]}>
              <Ionicons
                name={aiReady ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                size={14}
                color={aiReady ? ui.colors.success : ui.colors.danger}
              />
              <Text style={[styles.configStateText, aiReady ? styles.ready : styles.notReady]}>
                {aiReady ? 'AI 引擎已就绪，可以直接开始生成。' : 'AI 配置不完整，当前无法发起生成。'}
              </Text>
            </View>
          </View>

          <Pressable style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]} onPress={() => void handleSave()} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>保存设置</Text>}
          </Pressable>
        </ScrollView>
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
    paddingBottom: 88,
    gap: 12,
  },
  headerWrap: {
    marginBottom: 2,
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
  statusStrip: {
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: ui.colors.surfaceWarm,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: ui.radius.pill,
    backgroundColor: ui.colors.card,
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusChipText: {
    color: ui.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  statusHost: {
    flex: 1,
    textAlign: 'right',
    color: ui.colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: ui.colors.border,
    gap: 8,
    shadowColor: ui.colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  accountCard: {
    backgroundColor: ui.colors.surfaceWarm,
    borderColor: ui.colors.border,
  },
  serviceCard: {
    backgroundColor: ui.colors.surfaceAccent,
    borderColor: ui.colors.accentBorder,
  },
  aiCard: {
    backgroundColor: ui.colors.surfaceSoft,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    color: ui.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  accountText: {
    color: ui.colors.textSecondary,
    fontSize: 14,
  },
  accountRole: {
    color: ui.colors.textTertiary,
    fontSize: 12,
  },
  logoutButton: {
    marginTop: 6,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.danger,
    minHeight: 44,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  label: {
    color: ui.colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
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
    minHeight: 44,
  },
  configState: {
    marginTop: 4,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  configStateText: {
    fontSize: 12,
    flex: 1,
  },
  readyBox: {
    backgroundColor: ui.colors.successSoft,
  },
  notReadyBox: {
    backgroundColor: ui.colors.dangerSoft,
  },
  ready: {
    color: ui.colors.success,
  },
  notReady: {
    color: ui.colors.danger,
  },
  saveButton: {
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ui.colors.primaryStrong,
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  pressed: {
    opacity: 0.84,
  },
});
