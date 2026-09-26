// Offline phone-width smoke test: source records and all user data are fictional.
// Export web with EXPO_NO_DOTENV=1 and loopback API/Supabase URLs matching PREVIEW_PORT.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.env.PREVIEW_EXPORT || 'apps/mobile/dist-activity-preview');
const shots = resolve(process.env.BROWSER_RESULTS || 'work/activity-browser-results');
const port = Number(process.env.PREVIEW_PORT || 8098);
const origin = `http://127.0.0.1:${port}`;
await mkdir(shots, { recursive: true });
const owner = '10000000-0000-4000-8000-000000000001';
const versionId = '40000000-0000-4000-8000-000000000001';
const preview = { enabled: true, display_name: 'Fictional Alex', interests: ['art', 'walking'] };
const settings = { display_name: preview.display_name, occupation: 'Student', skills: [], interests: preview.interests, personality_traits: [], profile_location: '', matching_context: 'casual_chat', hard_filters: { conversation_intents: [] }, discoverable: false, bluetooth_enabled: false, discovery_radius_m: 3218.688, muse_descriptions_enabled: false };
const version = { profile_version_id: versionId, valid_from: new Date().toISOString(), current_goal: 'Talk about art', conversation_intent: 'casual_chat', facts: [], open_to_discussing: ['art'], conversation_preferences: [], avoid_topics: [], conversation_request: { mode: 'casual_chat', goal: 'Talk about art', evidence_requirement: { version: 1, kind: 'none', subject: null, claim: null, confirmation: 'confirmed' } } };
const connection = { request_id: 'fictional-connection', requester_id: owner, recipient_id: 'fictional-peer', candidate_id: 'fictional-peer', viewer_version_id: versionId, candidate_version_id: 'fictional-peer-version', requester_decision: 'accepted', recipient_decision: 'accepted', status: 'accepted', preview: { display_name: 'Fictional Jamie', interests: ['art', 'walking'] }, shared_profile: { facts: [] }, preference: null };
const sourceBase = { kind: 'evergreen', cost: 'free', cost_note: 'Free to walk; optional food costs extra.', eligibility: 'public', eligibility_note: 'Public paths. Check the source for temporary closures.', duration_minutes: 45, indoor: false, source_name: 'Fictional activity source', source_checked_at: new Date(Date.now()-60000).toISOString(), review_after: new Date(Date.now()+86400000).toISOString(), starts_at: null, ends_at: null, status: 'active', basis: 'both_interests', reason: 'Its activity tags relate to interests in both approved previews.' };
const activities = [
  { ...sourceBase, id: 'fictional-walk', title: 'A walk and an art conversation', summary: 'Walk together and compare the murals you notice.', venue: 'Fictional Eastside Trail', area: 'Atlanta', tags: ['walking', 'art'], source_url: 'https://example.org/activities/walk', invitation: 'Would you like to try a walk and an art conversation together?' },
  { ...sourceBase, id: 'fictional-campus', title: 'Explore a campus sculpture walk', summary: 'Take a relaxed walk past public sculptures.', venue: 'Fictional Campus Path', area: 'Georgia Tech area', tags: ['art'], source_url: 'https://example.org/activities/campus', invitation: 'Interested in checking out a campus sculpture walk together?' },
];
const requests = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    requests.push({ path: url.pathname, method: req.method, body });
    const send = value => { res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/v1/me') return send({ profile: { user_id: owner, current_profile_version_id: versionId, display_name: settings.display_name, discoverable: false, bluetooth_enabled: false, settings }, current_version: version, preview, matching_consent: true, readiness: { matching: { available: true } } });
    if (url.pathname === '/v1/connections/page') return send({ items: [connection], page: 1, pages: 1, total: 1, page_size: 6 });
    if (url.pathname === '/v1/connections') return send({ items: [connection] });
    if (url.pathname === '/v1/connections/constellation') return send({ nodes: [{ request_id: connection.request_id, display_name: connection.preview.display_name, preference: null }] });
    if (url.pathname.includes('display')) return send({ granted: false, peer_granted: false, revision: 0 });
    if (url.pathname === '/v1/matches/description') return send({ status: 'ready', provider: 'Muse', source: 'muse', description: 'You both chose art for your approved previews.', conversation_starter: 'What piece of public art has stayed with you?', basis: 'shared_preview_topic', activities });
    if (url.pathname === '/v1/profile/preview') { Object.assign(preview, body); return send(preview); }
    if (url.pathname === '/v1/discoveries') return send({ items: [] });
    if (url.pathname === '/v1/devices/headsets') return send({ headsets: [] });
    if (url.pathname === '/v1/badges') return send({ badges: [] });
    if (url.pathname === '/v1/integrations/spotify') return send({ available: false, connected: false, matching_supported: false });
    if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/auth/')) return send({});
    let file = join(root, decodeURIComponent(url.pathname));
    try { if (!(await stat(file)).isFile()) file = join(root, 'index.html'); } catch { file = join(root, 'index.html'); }
    res.setHeader('content-type', { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' }[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'example.org') return route.fulfill({ contentType: 'text/html', body: '<h1>Fictional activity source</h1>' });
    return route.abort();
  });
  await context.addInitScript(({ owner }) => {
    const token = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now()/1000)+86400, aud: 'authenticated' })) + '.fictional';
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fictional', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+86400, expires_in: 86400, user: { id: owner, aud: 'authenticated', role: 'authenticated', email: 'fictional@sidebyside.invalid' } }));
  }, { owner });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`${origin}/matches`);
  await page.getByText('What piece of public art has stayed with you?', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Show details for Fictional Jamie', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Hide details for Fictional Jamie', exact: true }).count(), 1);
  assert.equal(requests.filter(item => item.path === '/v1/matches/description').length, 1);
  assert.equal(await page.getByText('A walk and an art conversation', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Explore a campus sculpture walk', { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.getByText('Muse ideas', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(shots, 'automatic-ideas-phone.png'), fullPage: true });
  const links = page.getByRole('link', { name: /on Fictional activity source/ });
  assert.equal(await links.count(), 2);
  await links.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(shots, 'activity-source-links-phone.png'), fullPage: true });
  await Promise.all([page.waitForURL(activities[0].source_url), links.first().click()]);
  await page.getByRole('heading', { name: 'Fictional activity source' }).waitFor();
  await page.goto(`${origin}/matches`);
  await page.getByText('What piece of public art has stayed with you?', { exact: true }).waitFor();
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByText('Preview sharing', { exact: true }).waitFor();
  assert.equal(await page.getByRole('switch', { name: 'Allow Muse match descriptions', exact: true }).count(), 0);
  assert.equal(await page.getByText('Muse ideas', { exact: true }).count(), 0);
  await page.getByText('Preview sharing', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(shots, 'settings-auto-muse-phone.png'), fullPage: true });
  await page.getByRole('switch', { name: 'Show my preview', exact: true }).click();
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/v1/me') && response.ok()), page.getByRole('button', { name: 'Save preview', exact: true }).click()]);
  const beforeReturn = requests.filter(item => item.path === '/v1/matches/description').length;
  await page.getByRole('tab', { name: /Matches/ }).click();
  await page.getByText('1 connection', { exact: true }).waitFor();
  assert.equal(await page.getByText('Muse ideas', { exact: true }).count(), 0);
  assert.equal(await page.getByText('What piece of public art has stayed with you?', { exact: true }).count(), 0);
  assert.equal(requests.filter(item => item.path === '/v1/matches/description').length, beforeReturn);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ passed: true, screenshots: shots, checks: ['automatic starter and two cards in expanded match', 'single automatic request', 'phone overflow', 'accessible HTTPS source links', 'Muse toggle removed', 'hidden on tab change', 'approved-preview revocation removes wording'], network: 'loopback and intercepted fictional source only' }));
} catch (error) {
  const page = browser?.contexts().flatMap(context => context.pages())[0];
  if (page) console.error(JSON.stringify({ url: page.url(), recentRequests: requests.slice(-8) }));
  if (page) await page.screenshot({ path: join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
