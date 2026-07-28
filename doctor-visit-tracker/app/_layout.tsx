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
import { StyleSheet, Text, View } from 'react-native';
import { SessionProvider, useSession } from '../src/lib/auth';
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
      <Stack.Screen name="report/[visitId]" options={{ title: mn.completeVisit.title }} />
      <Stack.Screen name="route/[date]" options={{ title: mn.week.title }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
