import { Platform } from 'react-native';

export const colors = {
  background: '#F4F3FB', surface: '#FFFFFF', ink: '#171329', muted: '#6F6B80',
  violet: '#5444C8', violetDark: '#342878', lavender: '#E6E2FA', line: '#E4E0EF',
  green: '#28725C', danger: '#A33145', blush: '#F4E6E8', pale: '#EEEBF8',
};
export const font = Platform.select({ ios: 'System', default: 'sans-serif' });
export const space = { xs: 6, sm: 12, md: 20, lg: 28, xl: 40 };
