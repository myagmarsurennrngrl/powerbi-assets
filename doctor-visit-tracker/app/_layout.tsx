import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthProviderComponent } from '@/state/AuthContext';
import { envError, isConfigured } from '@/config/env';
import { colors, fontSize, spacing } from '@/theme/tokens';
import { mn } from '@/i18n/mn';

/**
 * Retry policy tuned for weak mobile networks: a request that fails because
 * the user walked into a lift should quietly succeed a moment later rather
 * than showing an error.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 16_000),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

/**
 * Shown instead of a white screen when .env has not been filled in. A
 * non-technical person needs to see what to fix, not a stack trace.
 */
function SetupRequiredScreen() {
  return (
    <ScrollView contentContainerStyle={setupStyles.container}>
      <Text style={setupStyles.title}>{mn.setup.title}</Text>
      <Text style={setupStyles.body}>{mn.setup.body}</Text>
      <Text style={setupStyles.code}>{envError}</Text>
    </ScrollView>
  );
}

export default function RootLayout() {
  if (!isConfigured) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <SetupRequiredScreen />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProviderComponent>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.primary },
              headerTintColor: colors.textInverse,
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
          </Stack>
        </AuthProviderComponent>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const setupStyles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  title: { fontSize: fontSize.heading, fontWeight: '700', color: colors.danger },
  body: { fontSize: fontSize.body, color: colors.text, lineHeight: 24 },
  code: {
    fontFamily: 'monospace',
    fontSize: fontSize.caption,
    color: colors.text,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
