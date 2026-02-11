import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ui } from '../theme/tokens';

export function BootScreen({ message = '加载中...' }: { message?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={ui.colors.primary} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  text: {
    color: ui.colors.textSecondary,
    fontSize: 14,
  },
});
