import type { PropsWithChildren } from 'react';
import { Text } from 'react-native';
export function GradientText({ children, size = 42, align = 'left' }: PropsWithChildren<{ size?: number; align?: 'left' | 'center' }>) {
  return <Text style={{ fontSize: size, lineHeight: size * 1.08, fontWeight: '400', letterSpacing: -1.5, color: '#FFE6DC', textAlign: align }}>{children}</Text>;
}
