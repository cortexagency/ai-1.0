// puppeteer-launch.js
const os = require('os');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer'); // v18.x pinned in package.json

function getChromiumPath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return undefined;
}

function tmpProfileDir() {
  const dir = path.join(os.tmpdir(), 'puppeteer_profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function baseArgs() {
  const args = [
    '--disable-gpu',
    '--disable-features=Translate',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-zygote'
  ];
  // Running as root in Docker? Must include no-sandbox flags.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  return args;
}

/**
 * launchBrowser(userOpts)
 * - userOpts.args are merged, but we ensure no-sandbox is present for root.
 */
async function launchBrowser(userOpts = {}) {
  const userArgs = Array.isArray(userOpts.args) ? userOpts.args : [];
  const args = [...baseArgs(), ...userArgs];

  // Guarantee the sandbox flags are there on root even if userOpts override
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot && !args.includes('--no-sandbox')) args.push('--no-sandbox');
  if (isRoot && !args.includes('--disable-setuid-sandbox')) args.push('--disable-setuid-sandbox');

  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    userDataDir: tmpProfileDir(),
    executablePath: getChromiumPath(),
    ...userOpts,
    args
  });
  return browser;
}

async function safeCloseBrowser(browser) {
  try { if (browser) await browser.close(); } catch {}
}

module.exports = { launchBrowser, safeCloseBrowser };
