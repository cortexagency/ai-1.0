// puppeteer-launch.js
const os = require('os');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer'); // v18.x

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

async function launchBrowser() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-features=Translate',
    '--no-first-run',
    '--no-zygote'
  ];

  const browser = await puppeteer.launch({
    headless: true,
    args,
    userDataDir: tmpProfileDir(),
    executablePath: getChromiumPath(),
    ignoreHTTPSErrors: true
  });

  return browser;
}

module.exports = { launchBrowser };
