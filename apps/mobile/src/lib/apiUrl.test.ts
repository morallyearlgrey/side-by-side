import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from './apiUrl';

const local = {
  platform: 'ios', development: true, followMetroHost: true,
  apiUrl: 'http://127.0.0.1:8000', nativeApiUrl: 'http://172.20.10.9:8000',
  metroHostUri: '172.20.10.6:8081',
};

describe('development API host selection', () => {
  it('follows the opened LAN server after an address change and preserves API port/path', () => {
    expect(resolveApiUrl(local)).toBe('http://172.20.10.6:8000');
    expect(resolveApiUrl({ ...local, nativeApiUrl: 'http://192.168.1.2:9000/api/', metroHostUri: 'http://10.66.32.222:8081' })).toBe('http://10.66.32.222:9000/api');
    expect(resolveApiUrl({ ...local, platform: 'android', nativeApiUrl: undefined })).toBe('http://172.20.10.6:8000');
  });

  it('keeps existing precedence when disabled, in release builds, or on web', () => {
    expect(resolveApiUrl({ ...local, followMetroHost: false })).toBe(local.nativeApiUrl);
    expect(resolveApiUrl({ ...local, development: false })).toBe(local.nativeApiUrl);
    expect(resolveApiUrl({ ...local, platform: 'web' })).toBe(local.apiUrl);
    expect(resolveApiUrl({ ...local, followMetroHost: false, nativeApiUrl: undefined })).toBe(local.apiUrl);
  });

  it.each(['https://api.example.com', 'http://api.example.com', 'https://192.168.1.2:8000', 'http://8.8.8.8:8000', 'http://172.32.0.1:8000', 'http://user:pass@127.0.0.1:8000'])(
    'never redirects a hosted, secure, or credential-bearing API: %s', nativeApiUrl => {
      expect(resolveApiUrl({ ...local, nativeApiUrl })).toBe(nativeApiUrl);
    },
  );

  it.each([undefined, null, '', 'not a host', 'example.exp.direct', 'https://example.com:8081', 'http://8.8.8.8:8081', 'file://172.20.10.6', 'http://user:pass@172.20.10.6:8081'])(
    'keeps the configured endpoint when a usable local Metro host is unavailable: %s', metroHostUri => {
      expect(resolveApiUrl({ ...local, metroHostUri })).toBe(local.nativeApiUrl);
    },
  );

  it('does not invent an API endpoint or throw for malformed configuration', () => {
    expect(resolveApiUrl({ ...local, apiUrl: undefined, nativeApiUrl: undefined })).toBe('');
    expect(resolveApiUrl({ ...local, nativeApiUrl: 'not a URL' })).toBe('not a URL');
  });
});
