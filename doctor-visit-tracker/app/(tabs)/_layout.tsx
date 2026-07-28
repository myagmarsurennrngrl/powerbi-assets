/**
 * Bottom tab navigation.
 *
 * Tabs vary by role. This is a USABILITY decision, not a security control:
 * hiding a tab protects nothing, and the server denies the underlying data
 * regardless of what the app renders.
 *
 * FIVE TABS MAXIMUM. On a 360 dp Android screen a sixth tab makes every label
 * truncate and every target too narrow to hit while walking. Clinics and
 * brands are reference screens rather than daily destinations, so they are
 * reachable from Home and from a visit instead of occupying a tab.
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
 * Deliberate trade-off: an icon font would mean another dependency and licence
 * to review. Emoji render on both platforms at any size. Swapping in a proper
 * icon set later touches only this file.
 */
function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return <Text style={{ fontSize: focused ? 24 : 21 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const { profile, isManager } = useSession();
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

      {/* A route and a plan only exist for a representative. */}
      <Tabs.Screen
        name="today"
        options={{
          title: mn.tabs.today,
          headerTitle: mn.today.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="📍" focused={focused} />,
          href: isRep ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="week"
        options={{
          title: mn.tabs.week,
          headerTitle: mn.week.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="🗓️" focused={focused} />,
          href: isRep ? undefined : null,
        }}
      />

      <Tabs.Screen
        name="kpi"
        options={{
          title: mn.tabs.kpi,
          headerTitle: mn.kpi.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="📊" focused={focused} />,
          href: isRep ? undefined : null,
        }}
      />

      {/* The manager's daily job: decide the pending requests. */}
      <Tabs.Screen
        name="exceptions"
        options={{
          title: mn.tabs.exceptions,
          headerTitle: mn.exception.queueTitle,
          tabBarIcon: ({ focused }) => <TabIcon symbol="📝" focused={focused} />,
          href: isManager ? undefined : null,
        }}
      />

      {/*
        A representative's five are: home, today, week, KPI, settings. Doctors
        is a reference screen reached from Home and from a visit, so it leaves
        the bar for them — but it IS a manager's main destination.
      */}
      <Tabs.Screen
        name="doctors"
        options={{
          title: mn.tabs.doctors,
          headerTitle: mn.doctors.title,
          tabBarIcon: ({ focused }) => <TabIcon symbol="👩‍⚕️" focused={focused} />,
          href: isRep ? null : undefined,
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

      {/*
        Still fully navigable (Home links to them, and a visit links to its
        clinic) — just not occupying one of the five tab slots.
      */}
      <Tabs.Screen name="clinics" options={{ headerTitle: mn.clinics.title, href: null }} />
      <Tabs.Screen name="brands" options={{ headerTitle: mn.brands.title, href: null }} />
    </Tabs>
  );
}
