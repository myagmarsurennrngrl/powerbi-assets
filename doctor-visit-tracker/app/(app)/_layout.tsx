/**
 * Role-based tab navigation.
 *
 * Every possible tab is declared here, and the ones a role must not see are
 * given `href: null`, which removes them from the bar AND makes the route
 * unreachable by typing it. That is a navigation guard, not a security
 * control — the database refuses the data regardless.
 */
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useAuth } from '@/state/AuthContext';
import { colors, fontSize } from '@/theme/tokens';
import { mn } from '@/i18n/mn';
import { LoadingState } from '@/ui/components';
import type { Role } from '@/domain/permissions';
import { TABS_BY_ROLE } from '@/domain/permissions';

/**
 * Text glyphs rather than an icon font: one less dependency, one less thing to
 * fail on a low-end device, and they scale with the system font size.
 */
const GLYPHS: Record<string, string> = {
  home: '⌂',
  today: '☑',
  plan: '▤',
  directory: '⌕',
  kpi: '▮',
  dashboard: '◈',
  exceptions: '!',
  admin: '⚙',
  users: '👤',
  settings: '⋯',
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  return (
    <View accessible={false}>
      <Text
        style={{
          fontSize: 20,
          color: focused ? colors.primary : colors.textMuted,
        }}
      >
        {GLYPHS[name] ?? '•'}
      </Text>
    </View>
  );
}

function tabHref(role: Role, name: string): undefined | null {
  return TABS_BY_ROLE[role].includes(name) ? undefined : null;
}

export default function AppLayout() {
  const { status, profile } = useAuth();

  if (status === 'loading') return <LoadingState />;
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />;
  if (status === 'noAccess' || !profile) return <Redirect href="/(auth)/no-access" />;

  const role = profile.role;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textInverse,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: fontSize.caption - 1, fontWeight: '600' },
        tabBarStyle: { height: 62, paddingBottom: 8, paddingTop: 6 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: mn.tabs.home,
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: mn.tabs.today,
          href: tabHref(role, 'today'),
          tabBarIcon: ({ focused }) => <TabIcon name="today" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: mn.tabs.plan,
          href: tabHref(role, 'plan'),
          tabBarIcon: ({ focused }) => <TabIcon name="plan" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="directory"
        options={{
          title: mn.tabs.directory,
          headerShown: false,
          href: tabHref(role, 'directory'),
          tabBarIcon: ({ focused }) => <TabIcon name="directory" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="kpi"
        options={{
          title: mn.tabs.kpi,
          href: tabHref(role, 'kpi'),
          tabBarIcon: ({ focused }) => <TabIcon name="kpi" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: mn.tabs.dashboard,
          href: tabHref(role, 'dashboard'),
          tabBarIcon: ({ focused }) => <TabIcon name="dashboard" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="exceptions"
        options={{
          title: mn.tabs.exceptions,
          href: tabHref(role, 'exceptions'),
          tabBarIcon: ({ focused }) => <TabIcon name="exceptions" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: mn.tabs.masterData,
          headerShown: false,
          href: tabHref(role, 'master-data'),
          tabBarIcon: ({ focused }) => <TabIcon name="admin" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: mn.tabs.users,
          href: tabHref(role, 'users'),
          tabBarIcon: ({ focused }) => <TabIcon name="users" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: mn.tabs.settings,
          headerShown: false,
          // Settings is reachable by every role. Administrators get it as a
          // tab; everyone else opens it from the home screen.
          href: tabHref(role, 'settings'),
          tabBarIcon: ({ focused }) => <TabIcon name="settings" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
