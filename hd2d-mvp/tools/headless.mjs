// Headless Chrome for the capture and check tools: silent (AGENTS.md) and talking to nothing but what the game
// loads. Branded Chrome otherwise reaches Google in the background even under Playwright's switches (Optimization
// Guide model checks, component updates, account and time pings — seen in a net log on 2026-10-29).
//   import { launchChrome } from './headless.mjs';
//   const browser = await launchChrome(URL, ['--disable-gpu-vsync']);
// Scripts that launch Chrome their own way (e.g. headed, for promo recordings) add offlineArgs(URL) to their
// switches; pages a script writes itself (setContent) get the game's fonts with localFonts(page) and FONTS_CSS.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
export const pw = (() => { for (const p of ['../desktop/node_modules/playwright', 'playwright', '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright']) { try { return require(p); } catch {} } throw new Error('找不到 Playwright；请运行 npm --prefix hd2d-mvp/desktop ci'); })();

// Playwright's own --disable-features list (playwright-core lib/server/chromium/chromiumSwitches.js), repeated
// because a second --disable-features replaces it rather than adding to it, plus Chrome's background fetchers.
const OFF = [
  'AcceptCHFrame', 'AvoidUnnecessaryBeforeUnloadCheckSync', 'DestroyProfileOnBrowserClose', 'DialMediaRouteProvider', 'GlobalMediaControls',
  'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding', 'ThirdPartyStoragePartitioning', 'Translate', 'AutoDeElevate',
  'OptimizationGuideModelDownloading', 'OptimizationGuideOnDeviceModel', 'OptimizationHints', 'OptimizationHintsFetching', 'OptimizationTargetPrediction',
  'NetworkTimeServiceQuerying', 'InterestFeedContentSuggestions', 'PrivacySandboxSettings4',
];
// The game loads everything from the dev server (three.js and the fonts too, tools/serve.py), so only it resolves;
// whatever Chrome still tries in the background fails locally and never leaves the machine.
const HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// The switches that keep Chrome off the network; url: the page the script opens (its host is allowed too, e.g. a
// staging server).
export function offlineArgs(url) {
  const hosts = [...HOSTS];
  try { const h = new URL(url).hostname; if (h && !hosts.includes(h)) hosts.push(h); } catch {}
  // --disable-updater-scheduler: about 20 s after launch branded Chrome starts GoogleUpdater, which inherits its stdout and stderr and may run
  // 25 s to 5 min. browser.close() waits for those pipes to close, so a Chrome closed in that time held up its test: 45 s in all, or a bare timeout.
  return ['--no-pings', '--disable-updater-scheduler', `--disable-features=${OFF.join(',')}`, `--host-resolver-rules=MAP * ~NOTFOUND, ${hosts.map((h) => `EXCLUDE ${h}`).join(', ')}`];
}

// args: extra Chrome switches.
export function launchChrome(url, args = []) {
  return pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...offlineArgs(url), ...args] });
}

// The game's two web fonts for a page a script writes itself: <link rel="stylesheet" href="${FONTS_CSS}"> and
// `await localFonts(page)` before setContent; `weights` limits Noto Serif SC to the weights a page used to ask
// Google Fonts for (a missing weight renders in the nearest one offered, so this keeps such a page's look). Requests to that address are answered from desktop/node_modules
// (@fontsource, the copies tools/serve.py and desktop/build-app.mjs use), so nothing is fetched from the network.
export const FONTS_CSS = 'https://fonts.local/fonts.css';
const fontsDir = join(import.meta.dirname, '../desktop/node_modules/@fontsource');
const FACES = [['noto-serif-sc', [400, 600, 900]], ['ma-shan-zheng', [400]]]; // as in desktop/build-app.mjs
export async function localFonts(page, weights = FACES[0][1]) {
  if (!existsSync(fontsDir)) throw new Error('the fonts come from hd2d-mvp/desktop/node_modules: run npm --prefix hd2d-mvp/desktop install');
  const css = FACES.flatMap(([pkg, ws]) => (pkg === 'noto-serif-sc' ? ws.filter((w) => weights.includes(w)) : ws).map((w) => readFileSync(join(fontsDir, pkg, `${w}.css`), 'utf8').replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, ''))).join('\n');
  await page.route('https://fonts.local/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    // Font files are cross-origin to a setContent page, so they need the CORS header.
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (name === 'fonts.css') return route.fulfill({ status: 200, contentType: 'text/css', headers, body: css });
    const file = /^[\w.-]+\.woff2$/.test(name) && FACES.map(([pkg]) => join(fontsDir, pkg, 'files', name)).find(existsSync);
    return file ? route.fulfill({ status: 200, contentType: 'font/woff2', headers, body: readFileSync(file) }) : route.fulfill({ status: 404, headers });
  });
}
