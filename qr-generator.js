const { launchBrowser, safeCloseBrowser } = require('./puppeteer-launch');

/**
 * generateQRCode(url, opts)
 * - Opens a page with the provided url and returns a base64 PNG screenshot.
 * - Performs defensive checks for null page/browser and ensures cleanup.
 *
 * Example:
 *   const { generateQRCode } = require('./lib/qr-generator');
 *   const base64 = await generateQRCode('https://example.com/qrpage');
 */
async function generateQRCode(url, opts = {}) {
  let browser;
  try {
    browser = await launchBrowser(opts.launch || {});
    if (!browser) throw new Error('Browser instance is null after launch');

    const page = await browser.newPage();
    if (!page) throw new Error('Failed to create new page — returned null');

    // Optional navigation: if your QR is generated client-side, navigate and wait
    if (opts.navigate !== false) {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeout || 30000 });
    }

    // Wait small amount for client-side QR generation (adjustable)
    if (opts.waitFor || opts.waitForSelector) {
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: opts.waitForTimeout || 5000 });
      } else {
        await page.waitForTimeout(opts.waitFor || 1000);
      }
    }

    // Example: screenshot the full page or a selector
    let screenshotBuffer;
    if (opts.selector) {
      const el = await page.$(opts.selector);
      if (!el) throw new Error(`Selector ${opts.selector} not found for QR capture`);
      screenshotBuffer = await el.screenshot({ type: 'png' });
    } else {
      screenshotBuffer = await page.screenshot({ fullPage: false, type: 'png' });
    }

    await safeCloseBrowser(browser);
    return screenshotBuffer.toString('base64');
  } catch (err) {
    console.error('generateQRCode error:', err && err.message ? err.message : err);
    await safeCloseBrowser(browser);
    throw err;
  }
}

module.exports = { generateQRCode };