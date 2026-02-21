import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { gradients, ui } from '../../theme/tokens';

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { config, updateConfig, saving } = useAppConfig();
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();

  const [apiBaseUrl, setApiBaseUrl] = useState(config.apiBaseUrl);

  useEffect(() => {
    setApiBaseUrl(config.apiBaseUrl);
  }, [config]);

  const handleSave = async () => {
    try {
      await updateConfig({
        apiBaseUrl,
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

  const openAdminPanel = () => {
    navigation.navigate('AdminPanel');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 8}
        >
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.headerWrap}>
              <Text style={styles.pageTitle}>设置</Text>
              <Text style={styles.pageSubtitle}>管理账号与服务连接</Text>
            </View>

            <View style={styles.statusStrip}>
              <View style={styles.statusChip}>
                <Ionicons name="flash" size={14} color={ui.colors.accent} />
                <Text style={styles.statusChipText}>
                  剩余积分：{user?.credit_balance !== undefined ? user.credit_balance : '...'}
                </Text>
              </View>
              <Text style={styles.statusHost} numberOfLines={1}>{apiBaseUrl.replace(/^https?:\/\//, '')}</Text>
            </View>

            <View style={[styles.card, styles.accountCard]}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="person-circle-outline" size={18} color={ui.colors.primaryStrong} />
                <Text style={styles.cardTitle}>账号</Text>
              </View>
              <Text style={styles.accountText}>当前用户：{user?.username || '未知'}</Text>
              <Text style={styles.accountRole}>用户ID：{user?.id || '...'}</Text>
              <Text style={styles.accountRole}>权限组：{user?.role || 'user'}</Text>
              
              {user?.role === 'admin' && (
                <Pressable style={({ pressed }) => [styles.adminButton, pressed && styles.pressed]} onPress={openAdminPanel}>
                  <Ionicons name="settings-outline" size={16} color={ui.colors.primaryStrong} />
                  <Text style={styles.adminButtonText}>打开管理后台</Text>
                </Pressable>
              )}

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
              <Text style={styles.hintText}>
                无需配置 API Key，AI 模型由服务端统一管理。
              </Text>
            </View>

            {user?.allow_custom_provider && (
              <View style={[styles.card, styles.serviceCard]}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="options-outline" size={18} color={ui.colors.primaryStrong} />
                  <Text style={styles.cardTitle}>自定义模型配置</Text>
                </View>
                <Text style={styles.hintText}>
                  您拥有自定义模型权限，设置后将覆盖默认模型。
                </Text>
                
                <Text style={styles.label}>提供商 (Provider)</Text>
                <TextInput
                  value={config.ai?.provider || ''}
                  onChangeText={(v) => updateConfig({ ...config, ai: { ...config.ai, provider: v } as any })}
                  autoCapitalize="none"
                  style={styles.input}
                  placeholder="openai, anthropic, etc."
                  placeholderTextColor={ui.colors.textTertiary}
                />

                <Text style={styles.label}>模型名称 (Model)</Text>
                <TextInput
                  value={config.ai?.model || ''}
                  onChangeText={(v) => updateConfig({ ...config, ai: { ...config.ai, model: v } as any })}
                  autoCapitalize="none"
                  style={styles.input}
                  placeholder="gpt-4o, claude-3-5-sonnet..."
                  placeholderTextColor={ui.colors.textTertiary}
                />

                <Text style={styles.label}>API Base URL</Text>
                <TextInput
                  value={config.ai?.baseUrl || ''}
                  onChangeText={(v) => updateConfig({ ...config, ai: { ...config.ai, baseUrl: v } as any })}
                  autoCapitalize="none"
                  style={styles.input}
                  placeholder="https://api.openai.com/v1"
                  placeholderTextColor={ui.colors.textTertiary}
                />

                <Text style={styles.label}>API Key</Text>
                <TextInput
                  value={config.ai?.apiKey || ''}
                  onChangeText={(v) => updateConfig({ ...config, ai: { ...config.ai, apiKey: v } as any })}
                  autoCapitalize="none"
                  secureTextEntry
                  style={styles.input}
                  placeholder="sk-..."
                  placeholderTextColor={ui.colors.textTertiary}
                />
              </View>
            )}

            <Pressable style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]} onPress={() => void handleSave()} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>保存设置</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
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
  flex: {
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
  adminButton: {
    marginTop: 6,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.cardAlt,
    borderWidth: 1,
    borderColor: ui.colors.border,
    minHeight: 44,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminButtonText: {
    color: ui.colors.primaryStrong,
    fontWeight: '600',
    fontSize: 14,
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
  hintText: {
    color: ui.colors.textTertiary,
    fontSize: 12,
    marginTop: 4,
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
