import React from 'react';
import { Stack } from 'expo-router';
import { mn } from '@/i18n/mn';
import { spacing } from '@/theme/tokens';
import { Body, Card, Heading, Screen, Title } from '@/ui/components';

/**
 * Location privacy, written for the employee rather than for a lawyer.
 * Everything stated here is enforced by the code: background location is not
 * installed, and location is read only at check-in, check-out and a manually
 * submitted exception.
 */
export default function PrivacyScreen() {
  const bullets = [
    mn.privacy.bullet1,
    mn.privacy.bullet2,
    mn.privacy.bullet3,
    mn.privacy.bullet4,
    mn.privacy.bullet5,
    mn.privacy.bullet6,
  ];

  return (
    <>
      <Stack.Screen options={{ title: mn.privacy.heading }} />
      <Screen>
        <Title>{mn.privacy.heading}</Title>
        <Card>
          {bullets.map((b, i) => (
            <Body key={i} style={{ marginBottom: spacing.md }}>{`• ${b}`}</Body>
          ))}
        </Card>
        <Heading>Асуулт байвал</Heading>
        <Body>
          Байршлын мэдээлэлтэй холбоотой асуултаа шууд удирдлагадаа эсвэл системийн
          администратортаа тавина уу.
        </Body>
      </Screen>
    </>
  );
}
