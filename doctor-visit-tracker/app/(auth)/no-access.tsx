/**
 * Shown when somebody holds a valid session but cannot use the app: their
 * staff record does not exist, or an administrator deactivated it.
 * They are signed out rather than left in a half-working state.
 */
import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@/state/AuthContext';
import { mn } from '@/i18n/mn';
import { spacing } from '@/theme/tokens';
import { Body, Button, Screen, Title } from '@/ui/components';

export default function NoAccessScreen() {
  const { accessProblem, signOut, refreshProfile } = useAuth();

  const message =
    accessProblem === 'inactive'
      ? mn.auth.errorInactive
      : accessProblem === 'not_provisioned'
        ? mn.auth.errorNotProvisioned
        : mn.auth.errorNetwork;

  return (
    <>
      <Stack.Screen options={{ title: mn.appName }} />
      <Screen>
        <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
          <Title>{mn.common.error}</Title>
          <Body>{message}</Body>
          <Button
            label={mn.common.retry}
            onPress={() => {
              void refreshProfile();
            }}
            variant="secondary"
          />
          <Button
            label={mn.auth.signOut}
            onPress={() => {
              void signOut();
            }}
            variant="danger"
          />
        </View>
      </Screen>
    </>
  );
}
