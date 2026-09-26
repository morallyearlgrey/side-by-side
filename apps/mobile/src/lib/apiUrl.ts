type ApiUrlOptions = {
  platform: string;
  development: boolean;
  followMetroHost: boolean;
  apiUrl?: string;
  nativeApiUrl?: string;
  metroHostUri?: string | null;
};

function isLocalIPv4Host(hostname: string) {
  if (hostname === 'localhost') return true;
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

/** Follow the selected LAN development server only when explicitly requested. */
export function resolveApiUrl(options: ApiUrlOptions) {
  const configured = (options.platform === 'web' ? options.apiUrl : options.nativeApiUrl || options.apiUrl) || '';
  const unchanged = configured.replace(/\/$/, '');
  if (options.platform === 'web' || !options.development || !options.followMetroHost || !options.metroHostUri) return unchanged;
  try {
    const api = new URL(configured);
    const metro = new URL(options.metroHostUri.includes('://') ? options.metroHostUri : `http://${options.metroHostUri}`);
    // Never redirect hosted APIs or infer an API endpoint from an Expo tunnel.
    if (api.protocol !== 'http:' || !isLocalIPv4Host(api.hostname) || api.username || api.password) return unchanged;
    if (!['http:', 'https:'].includes(metro.protocol) || !isLocalIPv4Host(metro.hostname) || metro.username || metro.password) return unchanged;
    api.hostname = metro.hostname;
    return api.toString().replace(/\/$/, '');
  } catch {
    return unchanged;
  }
}
