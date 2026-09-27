import { Platform } from 'react-native';

export const colors = {
  background: '#161316', surface: '#21191A', ink: '#FFE6DC', muted: '#BABABA',
  // Keep the existing token names so the rest of the app receives the same palette.
  violet: '#FF6D29', violetDark: '#FCB187', lavender: '#453027', line: '#594139',
  green: '#FCB187', danger: '#FF8D75', blush: '#453027', pale: '#302123',
  action: '#FF6D29', input: '#20191B', redStar: '#FF6D29',
  accent: '#FF6D29', actionBorder: '#FCB187', focus: '#FFE6DC',
  teal: '#FCB187', tabMaterial: 'rgba(22, 19, 22, .76)',
};
export const font = Platform.select({ web: 'Neue Montreal, Helvetica Neue, Arial, sans-serif', ios: 'System', default: 'sans-serif' });
export const space = { xs: 6, sm: 12, md: 20, lg: 28, xl: 40 };
