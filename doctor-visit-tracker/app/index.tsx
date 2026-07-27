/**
 * Entry point — decides where the user belongs and sends them there.
 * No UI of its own beyond a spinner while the session is being restored.
 */
import React from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '@/state/AuthContext';
import { LoadingState } from '@/ui/components';
import { colors } from '@/theme/tokens';

export default function Index() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  if (status === 'signedIn') return <Redirect href="/(app)/home" />;
  if (status === 'noAccess') return <Redirect href="/(auth)/no-access" />;
  return <Redirect href="/(auth)/login" />;
}
