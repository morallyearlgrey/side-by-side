import { Platform } from 'react-native';

export const colors = {
  background: '#15181A', surface: '#1C2123', ink: '#F3F2EF', muted: '#ADB6B8',
  // Keep the existing token contract while moving every surface to Lunar.
  violet: '#FFAB8B', violetDark: '#E8D6CD', lavender: '#303334', line: '#41484A',
  green: '#9BCDBB', danger: '#FFA7A7', blush: '#382528', pale: '#22292B',
  action: '#65402F', input: '#171B1D', redStar: '#FF6D83',
  accent: '#FFAB8B', actionBorder: '#BD8067', focus: '#F5A07E',
  teal: '#A2CFD0', tabMaterial: 'rgba(21, 24, 26, .94)',
};
export const font = Platform.select({ ios: 'System', default: 'sans-serif' });
export const space = { xs: 6, sm: 12, md: 20, lg: 28, xl: 40 };
