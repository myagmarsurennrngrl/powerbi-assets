/**
 * Bottom tab navigation.
 *
 * Tabs vary by role. This is a USABILITY decision, not a security control:
 * hiding a tab does not protect anything, and the server denies the underlying
 * data regardless of what the app renders. Phase 1 ships the tabs whose
 * screens actually work; manager and administrator tabs arrive in Phase 5/6.
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/lib/auth';
import { mn } from '../../src/lib/i18n/mn';
import { colors, typography } from '../../src/theme';

/**
 * Emoji tab icons.
 *
 * Deliberate trade-off: adding an icon font package for Phase 1 would mean
 * another dependency and another licence to review. Emoji render on both iOS
 * and Android at any size. Swapping in a proper icon set later touches only
 * this file.
 */
function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return <Text style={{ fontSize: focused ? 24 : 21 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const { profile } = useSession();
  const isRep = profile?.role === 'representative';

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.onPrimary,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { ...typography.caption, fontWeight: '600' },
        tabBarStyle: { height: 62, paddingBottom: 8, paddingTop: 6 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: mn.tabs.home,
          headerTitle: mn.app.shortName,
          tabBarIcon: ({ focused }) => <TabIcon symbol="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="clinics"
        options={{
          title: mn.tabs.clinics,
          headerTitle: mn.clinics.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="🏥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="doctors"
        options={{
          title: mn.tabs.doctors,
          headerTitle: mn.doctors.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="👩‍⚕️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="brands"
        options={{
          title: mn.tabs.brands,
          headerTitle: mn.brands.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="🧴" focused={focused} />,
          // A manager sees all brands; a representative sees their own first.
          href: isRep || profile ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: mn.tabs.settings,
          headerTitle: mn.settings.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
