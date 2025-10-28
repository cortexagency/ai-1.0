const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const puppeteer = require('puppeteer-core');

/**
 * launchBrowser(options)
 * - Creates a temporary userDataDir to avoid profile lock conflicts
 * - Uses container-friendly Chromium args
 * - Respects environment executable path variables:
 *    PUPPETEER_EXECUTABLE_PATH or CHROME_PATH
 *
 * Returns a Puppeteer Browser instance.
 */
async function launchBrowser(options = {}) {
  // Create a temp profile dir for this launch to avoid locked profiles
  const tmpDir = path.join(os.tmpdir(), `puppeteer_profile_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const defaultArgs = [
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-dev-shm-usage', // important in containers
    '--disable-extensions',
    '--disable-gpu',
    '--disable-sync',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-sandbox', // often required inside containers
    '--disable-setuid-sandbox',
    '--single-process',
    '--no-zygote',
    '--disable-features=site-per-process',
    '--enable-automation',
    '--disable-infobars',
    // Puppeteer should be allowed to set window size if necessary:
    '--window-size=1280,800'
  ];

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;

  // Build launch options
  const launchOptions = {
    headless: true,
    args: defaultArgs,
    userDataDir: tmpDir,
    executablePath,
    ignoreHTTPSErrors: true,
    ...options
  };

  // If executablePath is undefined, allow puppeteer-core to throw a helpful error
  try {
    const browser = await puppeteer.launch(launchOptions);

    // Clean up temporary profile dir when browser closes/disconnects
    const cleanup = async () => {
      try {
        if (fsSync.existsSync(tmpDir)) await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (e) {
        // non-fatal; log to help debugging
        console.warn('puppeteer-launch cleanup failed:', e && e.message ? e.message : e);
      }
    };
    browser.on('disconnected', cleanup);
    browser.on('targetdestroyed', async () => {
      // no-op here; we do main cleanup on 'disconnected'
    });

    return browser;
  } catch (err) {
    // Attempt to remove the temp directory on error
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (e) {}
    // Re-throw with added context
    const msg = new Error(`Puppeteer failed to launch. executablePath=${executablePath || '<auto>'}. Original: ${err && err.message ? err.message : err}`);
    msg.stack = err && err.stack ? err.stack : msg.stack;
    throw msg;
  }
}

/**
 * safeCloseBrowser(browser)
 * - Safely closes a Puppeteer browser instance without throwing.
 */
async function safeCloseBrowser(browser) {
  if (!browser) return;
  try {
    if (browser.isConnected && browser.isConnected()) {
      await browser.close();
    }
  } catch (e) {
    // swallow errors but log
    console.warn('safeCloseBrowser error:', e && e.message ? e.message : e);
    try { if (browser.disconnect) browser.disconnect(); } catch (e2) {}
  }
}

module.exports = {
  launchBrowser,
  safeCloseBrowser
};