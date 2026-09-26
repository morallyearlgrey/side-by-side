import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function checkLunarScreens(page, shots, origin) {
  await page.unroute('**/v1/connections/constellation');
  await page.unroute('**/v1/connections/page?*');
  const sizes = [[375, 667], [390, 844], [430, 932], [1440, 1000]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const [route, heading] of [['profile', 'Fictional Alex'], ['settings', 'Settings'], ['matches', 'Matches'], ['', 'Connect'], ['auth?mode=signin', 'Hello again.']]) {
      await page.goto(`${origin}/${route || 'profile'}`);
      if (!route) await page.getByRole('tab', { name: /Connect/ }).click();
      await page.getByRole('heading', { name: heading, exact: route !== 'auth?mode=signin' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.fonts.check('23px Michroma')), 'Lunar heading font must load');
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => [...document.querySelectorAll('input,textarea,[role="button"],[role="tab"],[role="heading"]')].filter(el => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.position !== 'absolute' && style.visibility !== 'hidden' && box.right > innerWidth + 1;
      }).map(el => el.tagName + ':' + el.textContent?.slice(0, 60)));
      assert.deepEqual(overflow, [], `${route} overflows at ${width}px`);
      const inputs = await page.locator('input:not([type="checkbox"]):not([type="radio"]),textarea').evaluateAll(elements => elements.map(el => ({ size: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height })));
      assert.ok(inputs.every(input => input.size >= 16 && input.height >= 44), 'Phone fields must not trigger iOS font zoom');
      if (route === 'matches') {
        const pixels = await page.locator('canvas').evaluate(canvas => {
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          const data = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
          let lit = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 10 && data[i] + data[i + 1] + data[i + 2] > 30) lit++;
          return lit;
        });
        assert.ok(pixels > 250, `Constellation blank at ${width}px`);
      }
      if (route.startsWith('auth')) {
        const image = page.getByTestId('lunar-artwork').locator('img');
        assert.ok(await image.evaluate(el => el.complete && el.naturalWidth > 0), 'Lunar artwork must render');
        const email = page.getByRole('textbox', { name: 'Email address' });
        await email.focus();
        assert.equal(await email.evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(245, 160, 126)');
        await email.fill('fictional@sidebyside.invalid');
        await page.getByLabel('Password', { exact: true }).fill('fictional-only');
        assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
        // Do not submit authentication requests, even against the fictional fixture.
        await email.evaluate(el => el.blur());
        await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTo(0, 0); });
      }
      await page.screenshot({ path: join(shots, `lunar-${route.split('?')[0] || 'connect'}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/auth?mode=signin`);
  await page.getByTestId('lunar-artwork').waitFor();
  const artworkStyle = () => page.getByTestId('lunar-artwork').locator('div').first().evaluate(el => ({ transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(300);
  const still = await artworkStyle();
  await page.waitForTimeout(500);
  assert.deepEqual(await artworkStyle(), still, 'Artwork must stop with reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(500);
  const moving = await artworkStyle();
  await page.waitForTimeout(1500);
  assert.notDeepEqual(await artworkStyle(), moving, 'Artwork drift must animate');
  await page.route('**/v1/onboarding', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    session_id: 'fictional', status: 'chatting', ready_for_review: false, answers_count: 1, max_answers: 7,
    turns: [{ role: 'assistant', content: 'What could you talk about for hours?' }, { role: 'user', content: 'I am learning pottery, especially how glazing changes color.' }, { role: 'assistant', content: 'What would you like to learn from someone else who makes pottery?' }],
    provider: { available: true }, draft: null,
  }) }));
  await page.goto(`${origin}/onboarding`);
  await page.getByRole('textbox', { name: 'Your answer' }).waitFor();
  await page.screenshot({ path: join(shots, 'lunar-onboarding-390.png') });
  await page.getByRole('textbox', { name: 'Your answer' }).fill('A fictional answer that must survive focus changes.');
  await page.getByRole('button', { name: 'Continue the conversation', exact: true }).focus();
  assert.equal(await page.getByRole('textbox', { name: 'Your answer' }).inputValue(), 'A fictional answer that must survive focus changes.');
  console.log(JSON.stringify({ lunarVisuals: 'passed', sizes, checks: ['five screens', 'local artwork and font', 'input size and focus', 'no horizontal overflow', '3D nonblank', 'reduced motion', 'onboarding input preserved'] }));
}
