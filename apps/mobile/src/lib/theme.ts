import { Platform } from 'react-native';

export const colors = {
  background: '#0C0914', surface: 'rgba(31, 24, 47, 0.82)', ink: '#F8F6FF', muted: '#B7AEC9',
  violet: '#C0A3FF', violetDark: '#D9C8FF', lavender: '#302346', line: '#453854',
  green: '#8AE2BF', danger: '#FF9CA8', blush: '#3B202F', pale: '#241C35',
  action: '#7542CE', input: 'rgba(12, 9, 22, 0.66)', redStar: '#FF6D83',
};
export const font = Platform.select({ ios: 'System', default: 'sans-serif' });
export const space = { xs: 6, sm: 12, md: 20, lg: 28, xl: 40 };
