/**
 * Root layout.
 *
 * Responsibilities:
 *  - provide the session to the whole tree;
 *  - route the user to the right place based on session status;
 *  - never show a half-loaded interface.
 */
import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SessionProvider, useSession } from '../src/lib/auth';
import { SyncProvider, useSync } from '../src/lib/offline/SyncProvider';
import { LoadingState, PrimaryButton } from '../src/components/ui';
import { mn } from '../src/lib/i18n/mn';
import { colors, spacing, typography } from '../src/theme';

function RootNavigator() {
  const { status, signOut } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    const inAuthGroup = segments[0] === 'login';

    if (status === 'signed_out' && !inAuthGroup) {
      router.replace('/login');
    } else if (status === 'ready' && inAuthGroup) {
      router.replace('/');
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <LoadingState />
      </View>
    );
  }

  // Authenticated with the provider, but no active app_user row. Every policy
  // will deny this person, so explain it rather than showing empty screens.
  if (status === 'not_provisioned') {
    return (
      <View style={styles.center}>
        <Text style={styles.blockedEmoji}>🔒</Text>
        <Text style={styles.blockedTitle}>{mn.auth.errorNotProvisioned}</Text>
        <View style={styles.blockedAction}>
          <PrimaryButton label={mn.auth.signOut} onPress={() => void signOut()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* One bar for the whole app. A representative in a basement should learn
          that from the interface, not from a request that quietly failed. */}
      <ConnectionBar />
      <Stack
        screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.onPrimary,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="clinic/[id]" options={{ title: mn.clinics.title }} />
      <Stack.Screen name="doctor/[id]" options={{ title: mn.doctors.title }} />
      <Stack.Screen name="plan/[id]" options={{ title: mn.planBuilder.title }} />
      <Stack.Screen name="visit/[id]/index" options={{ title: mn.visitDetail.title }} />
      <Stack.Screen name="visit/[id]/start" options={{ title: mn.startVisit.title }} />
      <Stack.Screen
        name="visit/[id]/active"
        options={{
          title: mn.activeVisit.title,
          // A visit in progress must be finished, not swiped away — otherwise
          // it silently stays open and the duration becomes meaningless.
          headerBackVisible: true,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen name="visit/[id]/exception" options={{ title: mn.exception.title }} />
      <Stack.Screen name="visit/unplanned" options={{ title: mn.unplanned.title }} />
      <Stack.Screen name="report/[visitId]" options={{ title: mn.completeVisit.title }} />
      <Stack.Screen name="audit" options={{ title: mn.audit.title }} />
      <Stack.Screen name="change-password" options={{ title: mn.auth.changePasswordTitle }} />
      <Stack.Screen name="sync" options={{ title: mn.sync.title }} />
      <Stack.Screen name="route/[date]" options={{ title: mn.week.title }} />
      <Stack.Screen name="admin/users" options={{ title: mn.admin.usersTitle }} />
      <Stack.Screen name="admin/user/[id]" options={{ title: mn.admin.editUser }} />
      <Stack.Screen name="admin/master-data" options={{ title: mn.admin.masterDataTitle }} />
      <Stack.Screen name="admin/clinic/[id]" options={{ title: mn.admin.editClinic }} />
        <Stack.Screen name="admin/doctor/[id]" options={{ title: mn.admin.editDoctor }} />
      </Stack>
    </View>
  );
}

/**
 * Shown only when there is something to say: no connection, or work still
 * waiting to be sent. A permanent "you are online" bar would be noise, and
 * noise is what people learn to ignore.
 */
function ConnectionBar() {
  const { online, summary } = useSync();
  const router = useRouter();

  if (online && summary.total === 0) return null;

  const blocked = summary.blocked > 0;
  const label = !online
    ? mn.sync.offlineBanner
    : blocked
      ? `${mn.sync.blockedTitle} · ${summary.blocked}`
      : mn.sync.queueCount(summary.total);

  return (
    <Pressable
      onPress={() => router.push('/sync')}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.bar, blocked ? styles.barDanger : styles.barWarning]}
    >
      <Text style={[styles.barText, blocked && styles.barTextDanger]}>{label}</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider>
        {/* Inside SessionProvider: the queue is only meaningful for a signed-in
            person, and purging on sign-out needs both. */}
        <SyncProvider>
          <RootNavigator />
        </SyncProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  bar: { paddingHorizontal: spacing.md, paddingVertical: 6, alignItems: 'center' },
  barWarning: { backgroundColor: colors.warningBg },
  barDanger: { backgroundColor: colors.dangerBg },
  barText: { ...typography.caption, color: colors.warning, fontWeight: '600' },
  barTextDanger: { color: colors.danger },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  blockedEmoji: { fontSize: 44 },
  blockedTitle: { ...typography.heading, color: colors.text, textAlign: 'center' },
  blockedAction: { alignSelf: 'stretch', marginTop: spacing.lg },
});
