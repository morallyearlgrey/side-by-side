const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "/private/tmp/navigation-browser-tools/node_modules/playwright",
);
const assert = require("node:assert/strict");
const { mkdir, readFile } = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const base = process.env.INTAKE_TEST_URL || "http://localhost:8094";
  const out = path.resolve("../../artifacts/intake-dashboard-browser");
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const [width, height] of [
      [375, 667],
      [390, 844],
      [430, 932],
      [1440, 1000],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/admin`);
      await page
        .getByRole("button", { name: "Open fictional dashboard" })
        .click();
      await page.getByText("15 responses", { exact: true }).waitFor();
      assert.equal(await page.locator(".dash-person").count(), 12);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page
        .getByRole("checkbox", {
          name: "Select Alex 1 (fictional)",
          exact: true,
        })
        .check();
      await page
        .getByRole("checkbox", {
          name: "Select Sam 2 (fictional)",
          exact: true,
        })
        .check();
      await page.locator(".dash-person-open").first().click();
      await page
        .getByRole("heading", { name: "What could you talk about for hours?" })
        .waitFor();
      assert.equal(
        await page
          .getByText("No recruiting or sales conversations, please.", {
            exact: true,
          })
          .count(),
        1,
      );
      await page.screenshot({
        path: path.join(out, `responses-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Close response", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Next page", exact: true })
        .click();
      await page.getByText("Page 2 of 2").waitFor();
      assert.equal(await page.locator(".dash-person").count(), 3);
      await page
        .getByRole("textbox", { name: "Search responses" })
        .fill("Sam 14");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByText("1 matching responses").waitFor();
      assert.equal(await page.locator(".dash-person").count(), 1);
      await page.getByRole("button", { name: "Matching batch (2)" }).click();
      assert.equal(
        await page.getByRole("button", { name: "Run matching" }).isDisabled(),
        true,
      );
      await page
        .getByRole("heading", { name: "Model host not connected" })
        .waitFor();
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download private batch" })
        .click();
      const download = await downloaded;
      const content = JSON.parse(await readFile(await download.path(), "utf8"));
      assert.equal(content.inference_performed, false);
      assert.equal(content.participants.length, 2);
      assert.equal(content.participants[0].data_origin, "fictional_demo");
      await page.screenshot({
        path: path.join(out, `batch-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          local: Object.keys(localStorage),
          session: Object.keys(sessionStorage),
        })),
        { local: [], session: [] },
      );
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.getByRole("heading", { name: "Organizer access" }).waitFor();
      assert.equal(
        await page.getByText("Alex 1 (fictional)", { exact: true }).count(),
        0,
      );
      assert.equal(await page.locator(".dash-main").count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.route("**/api/config", (route) =>
      route.fulfill({ json: { mode: "live" } }),
    );
    let login;
    await page.route("**/api/admin?*", async (route) => {
      const req = route.request(),
        action = new URL(req.url()).searchParams.get("action");
      if (action === "login") {
        login = req.postDataJSON();
        return route.fulfill({
          json: {
            access_token: "test-only-token",
            expires_in: 900,
            user: { email: "organizer@example.invalid" },
            matching: {
              available: false,
              reason: "An approved host is not connected.",
            },
          },
        });
      }
      assert.equal(req.headers().authorization, "Bearer test-only-token");
      return route.fulfill({ status: 401, json: { error: "Session expired" } });
    });
    await page.goto(`${base}/admin`);
    await page
      .getByLabel("Email address", { exact: true })
      .fill("organizer@example.invalid");
    await page
      .getByLabel("Password", { exact: true })
      .fill("fictional-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByText("Your organizer session ended. Sign in again.")
      .waitFor();
    assert.equal(
      await page.getByLabel("Password", { exact: true }).inputValue(),
      "",
    );
    assert.equal(login.email, "organizer@example.invalid");
    assert.equal(await page.locator(".dash-main").count(), 0);
    await page.close();
    console.log(
      JSON.stringify({
        passed: true,
        screenshots: out,
        viewports: [375, 390, 430, 1440],
        checks: [
          "response review",
          "pagination",
          "search",
          "cross-page selection",
          "private batch",
          "no fake model run",
          "in-memory session only",
          "logout clears data",
          "expired sessions clear data",
        ],
        data: "fictional only",
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
