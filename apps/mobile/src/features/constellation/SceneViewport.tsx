import type { ReactNode } from 'react';
import { View } from 'react-native';

export function SceneViewport({ children }: { children: (visible: boolean) => ReactNode }) {
  return <View style={{ flex: 1 }}>{children(true)}</View>;
}
