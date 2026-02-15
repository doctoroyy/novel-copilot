import { NavigationContainer, DefaultTheme, getFocusedRouteNameFromRoute } from '@react-navigation/native';
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
import { AdminScreen } from '../screens/admin/AdminScreen';
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
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: ui.colors.bg,
    card: ui.colors.card,
    border: ui.colors.border,
    primary: ui.colors.primary,
    text: ui.colors.text,
    notification: ui.colors.primary,
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
        options={({ route }) => ({ title: route.params.projectName || '项目详情' })}
      />
    </ProjectsStack.Navigator>
  );
}

function MainTabNavigator() {
  const insets = useSafeAreaInsets();
  const tabHeight = 60 + Math.max(8, insets.bottom);
  const baseTabBarStyle = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    backgroundColor: ui.colors.tabBg,
    borderTopColor: ui.colors.border,
    borderTopWidth: 1,
    height: tabHeight,
    paddingBottom: Math.max(8, insets.bottom),
    paddingTop: 8,
    paddingHorizontal: 8,
    shadowColor: 'transparent',
    elevation: 0,
  };

  return (
    <MainTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: ui.colors.accent,
        tabBarInactiveTintColor: ui.colors.textTertiary,
        tabBarStyle: baseTabBarStyle,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '800',
        },
        tabBarItemStyle: {
          borderRadius: 10,
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
            tabBarStyle: shouldHideTabBar ? { display: 'none' } : baseTabBarStyle,
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
          <>
            <RootStack.Screen name="AppFlow" component={MainTabNavigator} />
            <RootStack.Screen name="AdminPanel" component={AdminScreen} options={{ animation: 'slide_from_bottom' }} />
          </>
        ) : (
          <RootStack.Screen name="AuthFlow" component={AuthScreen} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
