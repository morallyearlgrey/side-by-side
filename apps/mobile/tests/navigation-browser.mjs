// Standalone browser harness. Fictional HTTP/auth fixtures, no Supabase or model calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/private/tmp/navigation-browser-tools/node_modules/playwright');
const root = resolve(process.env.PREVIEW_EXPORT || 'apps/mobile/dist-navigation-preview');
const shots = process.env.BROWSER_RESULTS || '/private/tmp/navigation-browser-results'; await mkdir(shots, { recursive: true });
const owner = '10000000-0000-4000-8000-000000000001';
const ownVersion = '40000000-0000-4000-8000-000000000001';
const fact = { fact_id: 'pottery', topic: 'pottery', relationship: 'learning', details: 'I am learning pottery.', evidence: [{ source_type: 'onboarding_answer', reference_id: 'answer-1', channel: 'self_report', support: 'I am learning pottery.' }], confirmation: 'confirmed', matching_allowed: true, sharing_scope: 'matching_only' };
const settings = { display_name: 'Fictional Alex', occupation: 'Student', skills: [], interests: ['pottery'], personality_traits: [], profile_location: '', matching_context: 'casual_chat', hard_filters: { conversation_intents: [] }, discoverable: false, bluetooth_enabled: false, discovery_radius_m: 3218.688, muse_descriptions_enabled: false };
const preview = { enabled: true, display_name: 'Fictional Alex', interests: ['pottery'] };
const version = { profile_version_id: ownVersion, valid_from: new Date().toISOString(), current_goal: 'Talk about pottery', conversation_intent: 'casual_chat', facts: [fact], open_to_discussing: ['pottery'], conversation_preferences: [], avoid_topics: [], onboarding_answers: [{ answer_id: 'answer-1', question_text: 'What interests you?', answer_text: fact.details }], conversation_request: { mode: 'casual_chat', goal: 'Talk about pottery', evidence_requirement: { version: 1, kind: 'none', subject: null, claim: null, confirmation: 'confirmed' } } };
const connections = Array.from({ length: 13 }, (_, i) => ({ request_id: `connection-${i}`, requester_id: owner, recipient_id: `peer-${i}`, candidate_id: `peer-${i}`, viewer_version_id: ownVersion, candidate_version_id: `version-${i}`, requester_decision: 'accepted', recipient_decision: i === 0 ? 'accepted' : 'pending', status: i === 0 ? 'accepted' : 'pending', preview: { display_name: i === 12 ? 'Fictional Ceramics' : `Fictional Peer ${i+1}`, interests: [i === 12 ? 'ceramics' : 'pottery'] }, shared_profile: i === 0 ? { facts: [{ topic: 'pottery', details: 'A fictional shared detail.' }] } : null, preference: i%2 ? 'disliked' : 'liked' }));
const requests = []; let sharing = false; let matchingConsent = true;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8097');
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  requests.push({ path: url.pathname, method: req.method, body });
  const send = value => { res.setHeader('content-type', 'application/json'); res.setHeader('cache-control','no-store'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/v1/me') return send({ profile: { user_id: owner, current_profile_version_id: ownVersion, display_name: settings.display_name, discoverable: settings.discoverable, bluetooth_enabled: false, settings }, current_version: version, preview, original_answer_ids: ['answer-1'], matching_consent: matchingConsent, readiness: { matching: { available: true } } });
  if (url.pathname === '/v1/consents') { matchingConsent = body.granted; if (!matchingConsent) { settings.discoverable = false; settings.bluetooth_enabled = false; } return send({ granted: matchingConsent }); }
  if (url.pathname === '/v1/profile' || url.pathname === '/v1/onboarding/review') { Object.assign(settings, body.settings); Object.assign(version, body.profile); return send({ current_version: version, matching_consent: matchingConsent }); }
  if (url.pathname === '/v1/onboarding') return send({ session_id: 'fictional-onboarding', status: 'awaiting_confirmation', ready_for_review: true, turns: [], draft: version });
  if (url.pathname === '/v1/settings') { Object.assign(settings, body); return send(settings); }
  if (url.pathname === '/v1/presence') return send({ expires_at: new Date(Date.now()+300000).toISOString() });
  if (url.pathname === '/v1/discoveries') return send({ items: settings.discoverable ? [{ ...connections[12], connection_id: null, event_key: 'a'.repeat(64), status: 'recommend', sources: ['nearby'], mode: 'nearby', valid_until: new Date(Date.now()+20000).toISOString() }] : [] });
  if (url.pathname === '/v1/connections/page') {
    const q = (url.searchParams.get('q') || '').toLowerCase(); const filter = url.searchParams.get('filter');
    const all = connections.filter(c => JSON.stringify(c.preview).toLowerCase().includes(q) && (filter === 'all' || c.preference === filter));
    const pages = Math.max(1, Math.ceil(all.length/6)); const page = Math.min(pages, Number(url.searchParams.get('page')) || 1);
    return send({ items: all.slice((page-1)*6, page*6), page, pages, total: all.length, page_size: 6 });
  }
  if (url.pathname === '/v1/connections') return send({ items: connections });
  if (url.pathname === '/v1/match-preferences') { const item = connections.find(c => c.candidate_id === body.candidate_id); if (item) item.preference = body.preference; return send({ preference: body.preference }); }
  if (url.pathname.endsWith('/location')) {
    if (req.method === 'POST') sharing = true;
    if (req.method === 'DELETE') sharing = false;
    const point = { latitude: 40.7128, longitude: -74.006, accuracy_m: 10, observed_at: new Date().toISOString() };
    return send({ status: sharing ? 'sharing' : 'off', sharing, peer_sharing: sharing, share_id: sharing ? 'fictional-lease' : null, sharing_until: new Date(Date.now()+900000).toISOString(), valid_until: new Date(Date.now()+20000).toISOString(), me: sharing ? point : null, peer: sharing ? { ...point, latitude: 40.7138 } : null });
  }
  if (url.pathname === '/v1/matches/description') return send({ status: 'unavailable', message: 'Muse is not configured for match descriptions.' });
  if (url.pathname === '/v1/devices/headsets') return send({ headsets: [] });
  if (url.pathname === '/v1/badges') return send({ badges: [] });
  if (url.pathname.includes('display')) return send({ granted: false, peer_granted: false, revision: 0 });
  if (url.pathname === '/v1/integrations/spotify') return send({ available: false, connected: false, matching_supported: false });
  if (url.pathname.startsWith('/v1/')) return send({});
  if (url.pathname.startsWith('/auth/')) return send({});
  let file = join(root, decodeURIComponent(url.pathname));
  try { if (!(await stat(file)).isFile()) file = join(root, 'index.html'); } catch { file = join(root, 'index.html'); }
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' };
  res.setHeader('content-type', mime[extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8097, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['geolocation'], geolocation: { latitude: 40.7128, longitude: -74.006, accuracy: 10 } });
  await context.route('**/*', route => { if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue(); return route.abort(); });
  await context.addInitScript(({ owner }) => {
    const token = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now()/1000)+86400, aud: 'authenticated' })) + '.fictional';
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fictional', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+86400, expires_in: 86400, user: { id: owner, aud: 'authenticated', role: 'authenticated', email: 'fictional@sidebyside.invalid' } }));
  }, { owner });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8097/profile');
  await page.getByRole('heading', { name: 'Fictional Alex' }).waitFor();
  assert.equal(await page.getByText(/Original onboarding answers|Additional answers you volunteered|Approved predictor inputs|From your answer:/).count(), 0);
  assert.equal(await page.getByRole('switch', { name: 'Use my approved details for matching', exact: true }).count(), 0);
  assert.deepEqual(await page.getByRole('tab').allTextContents().then(items => items.map(x => x.replace(/[^a-zA-Z]/g,''))), ['Profile','Settings','Matches','Connect']);
  await page.screenshot({ path: join(shots, 'profile-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByText('Preview sharing', { exact: true }).waitFor();
  await page.screenshot({ path: join(shots, 'settings-desktop.png'), fullPage: true });
  assert.equal(await page.getByRole('textbox', { name: 'Your name (required)' }).count(), 0);
  const consent = page.getByRole('switch', { name: 'Use my approved details for matching', exact: true });
  await consent.click();
  await page.reload();
  await page.getByText('Preview sharing', { exact: true }).waitFor();
  assert.equal(await consent.isChecked(), false);
  await page.getByRole('tab', { name: /Profile/ }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Your approved profile details are saved.', { exact: true }).waitFor();
  const saved = requests.find(r => r.path === '/v1/profile');
  assert.equal(Object.hasOwn(saved.body, 'matching_consent'), false);
  assert.equal(matchingConsent, false);
  await page.goto('http://127.0.0.1:8097/onboarding/review');
  await page.getByRole('button', { name: 'Save my profile', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
  assert.equal(matchingConsent, false);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Enable Nearby', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Turn Bluetooth Live on', exact: true }).isDisabled(), true);
  assert.equal(await page.getByText(/Before you meet people|Saved profile|Confirmed conversation goal and experience preference/).count(), 0);
  await page.getByRole('button', { name: 'Matching consent settings', exact: true }).click();
  await consent.click();
  await page.reload();
  await page.getByText('Preview sharing', { exact: true }).waitFor();
  assert.equal(await consent.isChecked(), true);
  assert.equal(settings.discoverable, false);
  assert.equal(settings.bluetooth_enabled, false);
  await page.getByRole('tab', { name: /Matches/ }).click();
  await page.getByText('Page 1 of 3', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Previous', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('Page 2 of 3', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('Page 3 of 3', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
  await page.getByLabel('Search connections', { exact: true }).fill('ceramics');
  await page.getByText('Page 1 of 1', { exact: false }).waitFor();
  await page.getByText('Fictional Ceramics', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dislike', exact: true }).click();
  await page.getByRole('radio', { name: 'Disliked', exact: true }).click();
  await page.getByText('Fictional Ceramics', { exact: true }).waitFor();
  await page.screenshot({ path: join(shots, 'matches-desktop.png'), fullPage: true });
  await page.getByLabel('Search connections', { exact: true }).fill('');
  await page.getByRole('radio', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Share location for 15 minutes' }).click();
  await page.getByText('Google Maps web setup required.', { exact: false }).waitFor();
  await context.clearPermissions();
  await page.getByText('Location permission is not active.', { exact: false }).waitFor({ timeout: 15_000 });
  assert.equal(await page.getByText('Google Maps web setup required.', { exact: false }).count(), 0);
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await page.getByRole('button', { name: 'Share location for 15 minutes' }).waitFor();
  assert.equal(await page.getByText('Google Maps web setup required.', { exact: false }).count(), 0);
  await context.grantPermissions(['geolocation']);
  await page.getByRole('tab', { name: /Connect/ }).click();
  assert.equal(requests.some(r => r.path.includes('pairings') && r.method === 'POST'), false);
  await page.getByRole('switch', { name: 'Location discovery', exact: true }).click();
  await page.getByRole('button', { name: 'View new match with Fictional Ceramics' }).waitFor();
  await page.getByText('New suggestion', { exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, 'match-popup-desktop.png'), fullPage: true });
  await page.waitForTimeout(5_200);
  assert.equal(await page.getByRole('button', { name: 'View new match with Fictional Ceramics' }).count(), 0);
  await page.getByRole('button', { name: 'Close match', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(shots, 'connect-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.getByRole('button', { name: 'View match', exact: true }).click();
  await page.getByRole('button', { name: 'Close match', exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, 'match-popup-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close match', exact: true }).click();
  await page.getByRole('switch', { name: 'Location discovery', exact: true }).click();
  await page.getByText('No new discoveries.', { exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(requests.some(r => r.path === '/v1/feedback' && r.method === 'POST'), false);
  console.log(JSON.stringify({ passed: true, screenshots: shots, checks: ['routes','six-item paging','cross-page search','private preference','map setup/permission withdrawal/stop','5s banner','discovery pause','mobile overflow'], network: 'loopback fictional fixtures only' }));
} catch (error) {
  const pages = browser?.contexts().flatMap(context => context.pages()) || [];
  if (pages[0]) await pages[0].screenshot({ path: join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
