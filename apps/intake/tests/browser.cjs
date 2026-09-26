const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "/private/tmp/navigation-browser-tools/node_modules/playwright",
);
const assert = require("node:assert/strict");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const { answers } = await import("./fixtures.mjs");
  const output = path.resolve("../../artifacts/intake-browser");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const [name, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
      ["narrow", { width: 320, height: 740 }],
    ]) {
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(process.env.INTAKE_TEST_URL || "http://localhost:8090");
      await page
        .getByRole("status")
        .filter({ hasText: "Local preview" })
        .waitFor();
      await page.screenshot({
        path: `${output}/${name}-step-1.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByText("Enter a name or nickname.").waitFor();
      await page.waitForFunction(
        () => document.activeElement.id === "display_name",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "display_name",
      );
      for (const key of ["display_name", "interests", "experience"])
        await page.locator(`#${key}`).fill(answers[key]);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      for (const key of ["current_goal", "open_topics", "boundaries"])
        await page.locator(`#${key}`).fill(answers[key]);
      await page
        .getByRole("radio", { name: /Someone to explore with/ })
        .check();
      await page.screenshot({
        path: `${output}/${name}-step-2.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Back", exact: true }).click();
      assert.equal(
        await page.locator("#interests").inputValue(),
        answers.interests,
      );
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Review answers" }).click();
      assert.equal(
        await page.getByRole("button", { name: "Finish preview" }).isDisabled(),
        true,
      );
      await page.getByRole("checkbox").check();
      await page.screenshot({
        path: `${output}/${name}-review.png`,
        fullPage: true,
      });
      // Unknown save outcomes must keep the same idempotency key when retried.
      const attempts = [];
      await page.route("**/api/submit", async (route) => {
        attempts.push(route.request().postDataJSON());
        if (attempts.length === 1)
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Temporary test outage. Please retry.",
            }),
          });
        else await route.continue();
      });
      await page.getByRole("button", { name: "Finish preview" }).click();
      await page.getByRole("alert").waitFor();
      await page.getByRole("button", { name: "Retry submission" }).click();
      await page
        .getByRole("heading", { name: "You are ready for the real thing." })
        .waitFor();
      assert.deepEqual(attempts[0], attempts[1]);
      await page.screenshot({
        path: `${output}/${name}-complete.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      if (name === "desktop")
        assert(
          await page.locator("canvas").evaluate((canvas) => {
            const data = canvas
              .getContext("2d")
              .getImageData(0, 0, canvas.width, canvas.height).data;
            return data.some((value, index) => index % 4 === 3 && value > 0);
          }),
        );
      await page.close();
      console.log(
        `${name}: validation, navigation, review, consent, retry, and completion passed`,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
