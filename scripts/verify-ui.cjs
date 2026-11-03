const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    fs.mkdirSync('verification-output', { recursive: true });
    await page.goto('http://localhost:5173');
    await page.getByRole('button', { name: 'CREATE LOBBY', exact: true }).click();
    await page.getByRole('button', { name: 'REFEREE', exact: true }).click();
    await page.getByRole('button', { name: 'T1 TEAM A', exact: true }).click();
    await page.getByRole('button', { name: 'CLICK TO READY', exact: true }).first().click();
    await page.getByRole('button', { name: 'READY', exact: true }).waitFor();
    await page.getByRole('button', { name: 'CLICK TO READY', exact: true }).click();
    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await page.getByPlaceholder('搜索...').waitFor();
    await page.getByRole('button', { name: 'Pause game', exact: true }).click();
    await page.getByText('PAUSED', { exact: true }).waitFor();
    await page.waitForTimeout(3200);
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `verification-output/${name}.png`, fullPage: true });
      const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        images: [...document.images].filter(i => i.naturalWidth > 0).length }));
      if (result.scrollWidth > width) throw new Error(`${name}: horizontal overflow`);
      if (!result.images) throw new Error(`${name}: no hero images rendered`);
      console.log(name, result);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('UI checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
