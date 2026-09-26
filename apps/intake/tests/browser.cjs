const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "/private/tmp/navigation-browser-tools/node_modules/playwright",
);
const assert = require("node:assert/strict");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const { answers } = await import("./fixtures.mjs");
  const { FIELDS } = await import("../shared/form.mjs");
  const output = path.resolve("../../artifacts/intake-lunar-browser");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const [name, viewport] of [
      ["small-phone", { width: 375, height: 667 }],
      ["phone", { width: 390, height: 844 }],
      ["large-phone", { width: 430, height: 932 }],
      ["desktop", { width: 1440, height: 1000 }],
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
      await page.evaluate(() => document.fonts.ready);
      async function checkLayout(stage) {
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          inputs: [
            ...document.querySelectorAll(".field input, .field textarea"),
          ].map((el) => ({
            font: parseFloat(getComputedStyle(el).fontSize),
            width: el.getBoundingClientRect().width,
          })),
          targets: [
            ...document.querySelectorAll("button, .radio-option, .consent"),
          ].map((el) => el.getBoundingClientRect().height),
          footer: document
            .querySelector(".form-actions")
            ?.getBoundingClientRect().bottom,
          viewport: innerHeight,
        }));
        assert.equal(
          metrics.overflow,
          false,
          `${name}/${stage}: no horizontal overflow`,
        );
        assert(
          metrics.inputs.every(
            (input) => input.font >= 16 && input.width > 100,
          ),
        );
        assert(
          metrics.targets.every((height) => height >= 44),
          `${name}/${stage}: 44px tap targets`,
        );
        if (viewport.width < 768 && metrics.footer)
          assert(
            Math.abs(metrics.footer - metrics.viewport) < 2,
            "Actions remain at the visible bottom",
          );
        for (const field of FIELDS) {
          const control = page.locator(`#${field.key}`);
          if (!(await control.count())) continue;
          assert.equal(await control.getAttribute("name"), field.key);
          assert.equal(
            await control.getAttribute("maxlength"),
            String(field.max),
          );
          assert.equal(
            await control.evaluate((el) => el.required),
            field.min > 0,
          );
          if (!field.short) {
            assert.equal(
              await control
                .locator("xpath=../..")
                .locator(".counter")
                .innerText(),
              `${(await control.inputValue()).length} / ${field.max}`,
            );
          }
        }
      }
      await checkLayout("initial");
      await page.screenshot({ path: `${output}/${name}-first-viewport.png` });
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
      if (name === "small-phone") {
        await page.setViewportSize({ width: viewport.width, height: 400 });
        await page.locator("#interests").focus();
        await page.waitForFunction(() => {
          const input = document
            .querySelector("#interests")
            .getBoundingClientRect();
          return (
            input.top >= 0 &&
            input.bottom <
              document.querySelector(".form-actions").getBoundingClientRect()
                .top
          );
        });
        await checkLayout("short-viewport-focus");
        await page.screenshot({
          path: `${output}/${name}-short-viewport-focus.png`,
        });
        await page.setViewportSize(viewport);
      }
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      for (const key of ["current_goal", "open_topics", "boundaries"])
        await page.locator(`#${key}`).fill(answers[key]);
      await page
        .getByRole("radio", { name: /Someone to explore with/ })
        .check();
      await checkLayout("step-2");
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
      await checkLayout("review");
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
      await checkLayout("complete");
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
      assert(
        await page
          .locator(".poster-art img")
          .evaluate((img) => img.complete && img.naturalWidth === 1200),
      );
      assert.equal(
        await page.locator(".orbit-progress").getAttribute("data-step"),
        "3",
      );
      await page.close();
      console.log(
        `${name}: validation, navigation, review, consent, retry, and completion passed`,
      );
    }
    const motion = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "no-preference",
    });
    await motion.goto(process.env.INTAKE_TEST_URL || "http://localhost:8090");
    await motion
      .getByRole("status")
      .filter({ hasText: "Local preview" })
      .waitFor();
    const orbitBefore = await motion
      .locator(".orbit-turn")
      .evaluate((el) => getComputedStyle(el).transform);
    const light = await motion.locator(".poster-art img").evaluate((el) => {
      const animation = el.getAnimations()[0];
      animation.pause();
      animation.currentTime = 0;
      const before = getComputedStyle(el).transform;
      animation.currentTime = 13000;
      return {
        before,
        after: getComputedStyle(el).transform,
        duration: animation.effect.getTiming().duration,
      };
    });
    assert.equal(light.duration, 26000);
    assert.notEqual(light.before, light.after, "Light drifts using transforms");
    for (const key of ["display_name", "interests", "experience"])
      await motion.locator(`#${key}`).fill(answers[key]);
    await motion.getByRole("button", { name: "Continue", exact: true }).click();
    await motion.waitForFunction(
      (before) =>
        document.querySelector(".orbit-progress").dataset.step === "1" &&
        getComputedStyle(document.querySelector(".orbit-turn")).transform !==
          before,
      orbitBefore,
    );
    assert.deepEqual(
      await motion
        .locator(".form-body > .field")
        .evaluateAll((fields) =>
          fields.map((el) => getComputedStyle(el).animationDelay),
        ),
      ["0s", "0.04s", "0.12s"],
    );
    await motion.emulateMedia({ reducedMotion: "reduce" });
    for (const selector of [".poster-art img", ".film-grain"])
      assert.equal(
        await motion
          .locator(selector)
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
    assert.equal(
      await motion
        .locator(".orbit-turn")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await motion.close();
    console.log(
      "Motion: light drift, orbital step progress, field staggering and reduced motion passed",
    );

    // Simulates iOS's smaller visual viewport, not a real device keyboard.
    const keyboard = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await keyboard.addInitScript(() => {
      document.startViewTransition = undefined;
    });
    await keyboard.goto(process.env.INTAKE_TEST_URL || "http://localhost:8090");
    await keyboard
      .getByRole("status")
      .filter({ hasText: "Local preview" })
      .waitFor();
    await keyboard.locator("#interests").focus();
    await keyboard.evaluate(() => {
      Object.defineProperty(visualViewport, "height", {
        value: 400,
        configurable: true,
      });
      Object.defineProperty(visualViewport, "offsetTop", {
        value: 40,
        configurable: true,
      });
      visualViewport.dispatchEvent(new Event("resize"));
    });
    await keyboard.waitForFunction(() => {
      const actions = document
        .querySelector(".form-actions")
        .getBoundingClientRect();
      const input = document
        .querySelector("#interests")
        .getBoundingClientRect();
      return (
        Math.abs(actions.bottom - 440) < 2 &&
        input.top >= 40 &&
        input.bottom < actions.top
      );
    });
    await keyboard.evaluate(() => {
      delete visualViewport.height;
      delete visualViewport.offsetTop;
      visualViewport.dispatchEvent(new Event("resize"));
    });
    for (const key of ["display_name", "interests", "experience"])
      await keyboard.locator(`#${key}`).fill(answers[key]);
    await keyboard
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await keyboard
      .getByRole("heading", { name: "Your next connection", exact: true })
      .waitFor();
    await keyboard.close();
    console.log(
      "Keyboard: visual-viewport inset/focus simulation and no-View-Transition fallback passed",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
