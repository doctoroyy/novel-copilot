import { NavigationContainer, DarkTheme, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityScreen } from '../screens/activity/ActivityScreen';
import { AnimeStudioScreen } from '../screens/anime/AnimeStudioScreen';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { ProjectDetailScreen } from '../screens/projects/ProjectDetailScreen';
import { ProjectsHomeScreen } from '../screens/projects/ProjectsHomeScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { useAuth } from '../contexts/AuthContext';
import { BootScreen } from '../components/BootScreen';
import { ui } from '../theme/tokens';
import type {
  MainTabParamList,
  ProjectsStackParamList,
  RootStackParamList,
} from '../types/navigation';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const ProjectsStack = createNativeStackNavigator<ProjectsStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();

const appTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: ui.colors.bg,
    card: ui.colors.card,
    border: ui.colors.border,
    primary: ui.colors.primary,
    text: ui.colors.text,
  },
};

function getTabIcon(routeName: keyof MainTabParamList, focused: boolean): keyof typeof Ionicons.glyphMap {
  if (routeName === 'ProjectsTab') return focused ? 'book' : 'book-outline';
  if (routeName === 'ActivityTab') return focused ? 'pulse' : 'pulse-outline';
  if (routeName === 'AnimeTab') return focused ? 'film' : 'film-outline';
  return focused ? 'build' : 'build-outline';
}

function ProjectsStackNavigator() {
  return (
    <ProjectsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: ui.colors.bg },
        headerTintColor: ui.colors.text,
        contentStyle: { backgroundColor: ui.colors.bg },
        headerShadowVisible: false,
      }}
    >
      <ProjectsStack.Screen
        name="ProjectsHome"
        component={ProjectsHomeScreen}
        options={{ headerShown: false }}
      />
      <ProjectsStack.Screen
        name="ProjectDetail"
        component={ProjectDetailScreen}
        options={({ route }) => ({ title: route.params.projectName })}
      />
    </ProjectsStack.Navigator>
  );
}

function MainTabNavigator() {
  const insets = useSafeAreaInsets();
  const tabBottom = Math.max(10, insets.bottom + 4);
  const tabHeight = 58 + Math.max(8, insets.bottom);

  return (
    <MainTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: ui.colors.accent,
        tabBarInactiveTintColor: ui.colors.textTertiary,
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: tabBottom,
          borderRadius: 24,
          backgroundColor: ui.colors.tabBg,
          borderColor: ui.colors.border,
          borderWidth: 1,
          height: tabHeight + 2,
          paddingBottom: Math.max(8, insets.bottom),
          paddingTop: 8,
          paddingHorizontal: 8,
          shadowColor: '#1a1712',
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 5 },
          elevation: 4,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '800',
        },
        tabBarItemStyle: {
          borderRadius: 16,
          marginHorizontal: 2,
          minHeight: 42,
        },
        tabBarActiveBackgroundColor: ui.colors.accentSoft,
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={getTabIcon(route.name, focused)} size={size || 19} color={color} />
        ),
      })}
    >
      <MainTabs.Screen
        name="ProjectsTab"
        component={ProjectsStackNavigator}
        options={({ route }) => {
          const routeName = getFocusedRouteNameFromRoute(route) ?? 'ProjectsHome';
          const shouldHideTabBar = routeName !== 'ProjectsHome';
          return {
            tabBarLabel: '项目',
            tabBarStyle: shouldHideTabBar
              ? { display: 'none' }
              : {
                  position: 'absolute',
                  left: 12,
                  right: 12,
                  bottom: tabBottom,
                  borderRadius: 24,
                  backgroundColor: ui.colors.tabBg,
                  borderColor: ui.colors.border,
                  borderWidth: 1,
                  height: tabHeight + 2,
                  paddingBottom: Math.max(8, insets.bottom),
                  paddingTop: 8,
                  paddingHorizontal: 8,
                  shadowColor: '#1a1712',
                  shadowOpacity: 0.08,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 5 },
                  elevation: 4,
                },
          };
        }}
      />
      <MainTabs.Screen
        name="ActivityTab"
        component={ActivityScreen}
        options={{ tabBarLabel: '任务' }}
      />
      <MainTabs.Screen
        name="AnimeTab"
        component={AnimeStudioScreen}
        options={{ tabBarLabel: '漫剧' }}
      />
      <MainTabs.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ tabBarLabel: '设置' }}
      />
    </MainTabs.Navigator>
  );
}

export function AppNavigator() {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return <BootScreen message="正在初始化会话..." />;
  }

  return (
    <NavigationContainer theme={appTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isLoggedIn ? (
          <RootStack.Screen name="AppFlow" component={MainTabNavigator} />
        ) : (
          <RootStack.Screen name="AuthFlow" component={AuthScreen} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
