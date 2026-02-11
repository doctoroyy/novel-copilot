import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppConfigProvider } from './src/contexts/AppConfigContext';
import { AuthProvider } from './src/contexts/AuthContext';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppConfigProvider>
          <AuthProvider>
            <AppNavigator />
          </AuthProvider>
        </AppConfigProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
