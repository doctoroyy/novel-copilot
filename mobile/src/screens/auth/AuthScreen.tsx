import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
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
import { gradients, ui } from '../../theme/tokens';

export function AuthScreen() {
  const { login, register, loading, error, clearError } = useAuth();
  const { config, updateConfig, saving } = useAppConfig();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(config.apiBaseUrl);

  const reveal = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: 380,
      useNativeDriver: true,
    }).start();
  }, [reveal]);

  const displayError = localError || error;
  const title = useMemo(() => (mode === 'login' ? '登录' : '注册'), [mode]);

  const handleSubmit = async () => {
    setLocalError(null);
    clearError();

    if (!username.trim()) {
      setLocalError('请输入用户名');
      return;
    }

    if (password.length < 6) {
      setLocalError('密码至少 6 位');
      return;
    }

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setLocalError('两次密码不一致');
        return;
      }
      if (!invitationCode.trim()) {
        setLocalError('请输入邀请码');
        return;
      }
      await register(username.trim(), password, invitationCode.trim());
      return;
    }

    await login(username.trim(), password);
  };

  const handleSaveApiUrl = async () => {
    await updateConfig({
      ...config,
      apiBaseUrl: apiBaseUrlInput,
    });
    setShowApiConfig(false);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <LinearGradient colors={gradients.page} style={styles.bgGradient}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView
            contentContainerStyle={[styles.container, { paddingBottom: Math.max(24, insets.bottom + 16) }]}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View
              style={[
                styles.hero,
                {
                  opacity: reveal,
                  transform: [
                    {
                      translateY: reveal.interpolate({
                        inputRange: [0, 1],
                        outputRange: [18, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <LinearGradient colors={gradients.hero} style={styles.heroInner}>
                <View style={styles.brandMark}>
                  <Ionicons name="library-outline" size={26} color={ui.colors.primaryStrong} />
                </View>
                <View style={styles.heroTextWrap}>
                  <Text style={styles.title}>小说副驾</Text>
                  <Text style={styles.subtitle}>更懂中文创作节奏的写作助手</Text>
                </View>
              </LinearGradient>
            </Animated.View>

            <View style={styles.tabRow}>
              <Pressable
                onPress={() => {
                  setMode('login');
                  setLocalError(null);
                  clearError();
                }}
                style={({ pressed }) => [styles.tab, mode === 'login' && styles.tabActive, pressed && styles.pressed]}
              >
                <Ionicons name="log-in-outline" size={14} color={mode === 'login' ? ui.colors.primaryStrong : ui.colors.textSecondary} />
                <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>登录</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setMode('register');
                  setLocalError(null);
                  clearError();
                }}
                style={({ pressed }) => [styles.tab, mode === 'register' && styles.tabActive, pressed && styles.pressed]}
              >
                <Ionicons name="person-add-outline" size={14} color={mode === 'register' ? ui.colors.primaryStrong : ui.colors.textSecondary} />
                <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>注册</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{title}</Text>

              <Text style={styles.label}>用户名</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                style={styles.input}
                autoCapitalize="none"
                placeholder="请输入用户名"
                placeholderTextColor={ui.colors.textTertiary}
              />

              <Text style={styles.label}>密码</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry
                placeholder="请输入密码"
                placeholderTextColor={ui.colors.textTertiary}
              />

              {mode === 'register' ? (
                <>
                  <Text style={styles.label}>确认密码</Text>
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    style={styles.input}
                    secureTextEntry
                    placeholder="再次输入密码"
                    placeholderTextColor={ui.colors.textTertiary}
                  />

                  <Text style={styles.label}>邀请码</Text>
                  <TextInput
                    value={invitationCode}
                    onChangeText={setInvitationCode}
                    style={styles.input}
                    placeholder="请输入邀请码"
                    placeholderTextColor={ui.colors.textTertiary}
                  />
                </>
              ) : null}

              {displayError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={16} color={ui.colors.danger} />
                  <Text style={styles.errorText}>{displayError}</Text>
                </View>
              ) : null}

              <Pressable onPress={handleSubmit} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{title}</Text>}
              </Pressable>
            </View>

            <View style={styles.configCard}>
              <Pressable
                style={({ pressed }) => [styles.configHeader, pressed && styles.pressed]}
                onPress={() => {
                  setApiBaseUrlInput(config.apiBaseUrl);
                  setShowApiConfig((prev) => !prev);
                }}
              >
                <View style={styles.configHeaderTextWrap}>
                  <Text style={styles.configTitle}>连接设置</Text>
                  <Text style={styles.configCurrent} numberOfLines={1}>
                    {config.apiBaseUrl}
                  </Text>
                </View>
                <Ionicons name={showApiConfig ? 'chevron-up' : 'chevron-down'} size={18} color={ui.colors.textSecondary} />
              </Pressable>

              {showApiConfig ? (
                <View style={styles.configBody}>
                  <Text style={styles.label}>后端地址</Text>
                  <TextInput
                    value={apiBaseUrlInput}
                    onChangeText={setApiBaseUrlInput}
                    style={styles.input}
                    autoCapitalize="none"
                    placeholder="https://novel-copilot.doctoroyy.workers.dev"
                    placeholderTextColor={ui.colors.textTertiary}
                  />
                  <Pressable onPress={handleSaveApiUrl} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} disabled={saving}>
                    {saving ? <ActivityIndicator color={ui.colors.primaryStrong} /> : <Text style={styles.secondaryButtonText}>保存地址</Text>}
                  </Pressable>
                </View>
              ) : null}
            </View>
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
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
    gap: 12,
  },
  hero: {
    borderRadius: ui.radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  heroInner: {
    minHeight: 120,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandMark: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.8,
    borderColor: ui.colors.border,
  },
  heroTextWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 28,
    color: ui.colors.text,
    fontWeight: '800',
  },
  subtitle: {
    color: ui.colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: ui.colors.cardAlt,
    borderRadius: ui.radius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: ui.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  tabActive: {
    backgroundColor: ui.colors.primarySoft,
    borderWidth: 1,
    borderColor: '#efc4ae',
  },
  tabText: {
    color: ui.colors.textSecondary,
    fontWeight: '700',
    fontSize: 14,
  },
  tabTextActive: {
    color: ui.colors.primaryStrong,
  },
  card: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  cardTitle: {
    color: ui.colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  label: {
    color: ui.colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: ui.colors.cardAlt,
    color: ui.colors.text,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 46,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: ui.colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#efbeb8',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: {
    color: ui.colors.danger,
    fontSize: 13,
    flex: 1,
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    shadowColor: ui.colors.primaryStrong,
    shadowOpacity: 0.16,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  configCard: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  configHeader: {
    padding: 14,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  configHeaderTextWrap: {
    flex: 1,
  },
  configTitle: {
    color: ui.colors.text,
    fontWeight: '700',
  },
  configCurrent: {
    color: ui.colors.textTertiary,
    fontSize: 12,
  },
  configBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  secondaryButton: {
    marginTop: 2,
    backgroundColor: ui.colors.primarySoft,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: '#efc4ae',
    paddingVertical: 11,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: ui.colors.primaryStrong,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.84,
  },
});
