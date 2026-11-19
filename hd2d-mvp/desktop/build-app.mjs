// Snapshot the playable game into desktop/app/ for the Electron shell, fully offline.
//   node hd2d-mvp/desktop/build-app.mjs
//   node hd2d-mvp/desktop/build-app.mjs --generated-music     # no local audio: chiptune BGM stand-ins, committed SFX
//   node hd2d-mvp/desktop/build-app.mjs --no-original-music   # leave FC and PS original-game BGM out (SFX stay original)
// Copies index.html, save-editor.html, admin.html, src/, data/ and the runtime assets (git-tracked plus untracked-but-not-ignored files,
// so generator sources never ship), adds for every BGM slot each local version the manifest lists (PS, remix
// and original tracks), so the package offers the same 曲目 choice as local play, and the original-game SFX for
// every SFX slot (the snapshot's manifest lists them first), re-encodes the 单挑 strips as lossless WebP, then
// vendors three.js (with only the addons the game imports) and the two web fonts into vendor/, where index.html
// already loads them from (tools/serve.py serves the same layout in development). Needs cwebp (brew install webp).
// The game sources are only read, never changed.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const game = join(here, '..');
const out = join(here, 'app');
const mods = join(here, 'node_modules');

// Generator inputs and editor-only material that the game never loads, and the dropped generated score (新编, assets/audio/bgm-*).
const SKIP = [/(^|\/)source(\/|$)/, /^assets\/ai\/title-source/, /^assets\/audio\/(original|remix|ps)\//, /^assets\/audio\/generated\.json$/, /^assets\/audio\/bgm-[^/]+\.mp3$/, /(^|\/)\.DS_Store$/];
const KEEP = [/^index\.html$/, /^save-editor\.html$/, /^admin\.html$/, /^src\//, /^data\//, /^assets\//];

rmSync(out, { recursive: true, force: true });
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: game, encoding: 'utf8' }).split('\0');
let files = 0, bytes = 0;
for (const f of listed) {
  if (!f || !KEEP.some((r) => r.test(f)) || SKIP.some((r) => r.test(f))) continue;
  const src = join(game, f);
  if (!existsSync(src)) continue; // tracked but deleted in the working tree
  mkdirSync(dirname(join(out, f)), { recursive: true });
  cpSync(src, join(out, f));
  files++; bytes += statSync(src).size;
}
// The open-source repository keeps its art out of git (make assets installs the pinned Release pack, so git ignores
// it): ASSETS.sha256 at the repository root lists those files. Copy them too, and stop with the fix when one is missing.
const sumsFile = join(game, '..', 'ASSETS.sha256');
if (existsSync(sumsFile)) {
  const missing = [];
  for (const line of readFileSync(sumsFile, 'utf8').split('\n')) {
    const f = line.slice(66).replace(/^hd2d-mvp\//, '');
    if (!f || !KEEP.some((r) => r.test(f)) || SKIP.some((r) => r.test(f)) || existsSync(join(out, f))) continue;
    const src = join(game, f);
    if (!existsSync(src)) { missing.push(f); continue; }
    mkdirSync(dirname(join(out, f)), { recursive: true });
    cpSync(src, join(out, f));
    files++; bytes += statSync(src).size;
  }
  if (missing.length) {
    console.error(`${missing.length} files of ASSETS.sha256 are missing (first: ${missing[0]}): run make assets in the repository root (see README.md)`);
    process.exit(1);
  }
}

// BGM and the command / 计略 phrases (cue-*): per manifest slot, every local candidate that exists, so the 曲目 switch finds
// the same sets as in development; the manifest order still decides the default. Both tracked and local-only
// music are copied here so the music exclusion flags apply consistently.
// SFX: the original-game file for every slot, moved to the front of the snapshot's manifest so it beats
// a committed generated one (sfx-clash); slots without an original keep the committed/synth fallbacks.
const manifest = JSON.parse(readFileSync(join(game, 'assets/manifest.json'), 'utf8'));
const local = process.argv.includes('--no-original-music') ? /^assets\/audio\/remix\// : /^assets\/audio\/(ps|remix|original)\//;
const music = {};
if (!process.argv.includes('--generated-music')) for (const [slot, list] of Object.entries(manifest.audio || {})) {
  let picks = [];
  if (slot.startsWith('bgm-') || slot.startsWith('cue-')) picks = [].concat(list).filter((f) => local.test(f) && existsSync(join(game, f)));
  else if (slot.startsWith('sfx-')) {
    const legacy = `assets/audio/original/${slot}.mp3`;
    const pick = [].concat(list).find((f) => /^assets\/audio\/original\//.test(f) && existsSync(join(game, f)))
      || (existsSync(join(game, legacy)) ? legacy : null);
    if (!pick) continue;
    manifest.audio[slot] = [pick, ...[].concat(list).filter((f) => f !== pick)];
    picks = [pick];
  }
  if (!picks.length) continue;
  music[slot] = picks;
  for (const pick of picks) {
    if (existsSync(join(out, pick))) continue;
    mkdirSync(dirname(join(out, pick)), { recursive: true });
    cpSync(join(game, pick), join(out, pick));
    files++; bytes += statSync(join(game, pick)).size;
  }
}
writeFileSync(join(out, 'assets/manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

// 单挑 strips: ~6000 px wide RGBA PNGs, a third of the size as lossless WebP (same pixels, -exact keeps the
// colour under transparent ones); the snapshot's app.js asks for .webp. Encoded copies are cached by content hash.
const WEBP = [{ dir: 'assets/ai/sprites/duel', ref: ['assets/ai/sprites/duel/${k}.png', 'assets/ai/sprites/duel/${k}.webp'], in: 'src/app.js' }];
const cache = join(here, '.webp-cache');
mkdirSync(cache, { recursive: true });
let webpSaved = 0;
for (const { dir, ref: [from, to], in: file } of WEBP) {
  const pngs = readdirSync(join(out, dir)).filter((f) => f.endsWith('.png'));
  await Promise.all(Array.from({ length: 8 }, async (_, lane) => {
    for (let i = lane; i < pngs.length; i += 8) {
      const png = join(out, dir, pngs[i]), webp = png.replace(/\.png$/, '.webp');
      const hit = join(cache, createHash('sha1').update(readFileSync(png)).digest('hex') + '.webp');
      if (!existsSync(hit)) await run('cwebp', ['-quiet', '-lossless', '-exact', '-z', '9', png, '-o', hit + '.tmp']).then(() => renameSync(hit + '.tmp', hit));
      cpSync(hit, webp);
      webpSaved += statSync(png).size - statSync(webp).size;
      rmSync(png);
    }
  })).catch((e) => { throw new Error(`cwebp failed (brew install webp): ${e.message}`); });
  const src = readFileSync(join(out, file), 'utf8');
  if (!src.includes(from)) throw new Error(`${file}: ${from} not found — update WEBP in build-app.mjs`);
  writeFileSync(join(out, file), src.replaceAll(from, to));
}

// three.js: the build plus the addons the game imports and what they import in turn (found by following
// the import statements), so a newly used addon is picked up by the next snapshot.
const three = join(mods, 'three');
const threeVersion = JSON.parse(readFileSync(join(three, 'package.json'), 'utf8')).version;
cpSync(join(three, 'build/three.module.js'), join(out, 'vendor/three/build/three.module.js'));
const jsm = join(three, 'examples/jsm');
const addons = new Set();
const gameJs = listed.filter((f) => /^src\/.*\.js$/.test(f) && existsSync(join(game, f)));
const queue = gameJs.flatMap((f) => [...readFileSync(join(game, f), 'utf8').matchAll(/['"]three\/addons\/([^'"]+)['"]/g)].map((m) => m[1]));
while (queue.length) {
  const rel = queue.pop();
  if (addons.has(rel)) continue;
  if (!existsSync(join(jsm, rel))) throw new Error(`three/addons/${rel} not found in three ${threeVersion}`);
  addons.add(rel);
  // Only real import / export statements and import(): a comment such as GLTFLoader's "loaded from 'https://…'" is not one.
  const specs = readFileSync(join(jsm, rel), 'utf8').matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm);
  for (const spec of [...specs].map((m) => m[1] ?? m[2] ?? m[3])) {
    if (spec === 'three') continue;
    if (!spec.startsWith('.')) throw new Error(`three/addons/${rel} imports ${spec} — not vendored`);
    queue.push(relative(jsm, join(jsm, dirname(rel), spec)));
  }
}
for (const rel of addons) cpSync(join(jsm, rel), join(out, 'vendor/three/examples/jsm', rel));

// Fonts: the same families and weights index.html asks Google Fonts for, woff2 only.
const faces = [['noto-serif-sc', [400, 600, 900]], ['ma-shan-zheng', [400]]];
let css = '';
for (const [pkg, weights] of faces) for (const w of weights) {
  const dir = join(mods, '@fontsource', pkg);
  css += readFileSync(join(dir, `${w}.css`), 'utf8')
    .replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, '')
    .replace(/url\(\.\/files\/([^)]+\.woff2)\)/g, (_, name) => {
      cpSync(join(dir, 'files', name), join(out, 'vendor/fonts/files', name));
      return `url(./files/${name})`;
    }) + '\n';
}
writeFileSync(join(out, 'vendor/fonts/fonts.css'), css);

// index.html already loads three.js and the fonts from vendor/; fail loudly if that moved or it reaches out.
const html = readFileSync(join(game, 'index.html'), 'utf8');
for (const ref of ['vendor/fonts/fonts.css', './vendor/three/build/three.module.js', './vendor/three/examples/jsm/'])
  if (!html.includes(ref)) throw new Error(`index.html: ${ref} not found — update build-app.mjs`);
if (/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error('index.html still references the network');
writeFileSync(join(out, 'index.html'), html);

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: game, encoding: 'utf8' }).trim();
// Dirty means a change in what the package is made of (the KEEP paths above), not notes or captures under docs/.
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'index.html', 'save-editor.html', 'admin.html', 'src', 'data', 'assets'], { cwd: game, encoding: 'utf8' }).trim() ? '+dirty' : '';
writeFileSync(join(out, 'build.json'), JSON.stringify({ commit: commit + dirty, built: new Date().toISOString(), music }, null, 1));
console.log(`${relative(process.cwd(), out) || out}: ${files} game files, ${(bytes / 2 ** 20).toFixed(1)} MB (${(webpSaved / 2 ** 20).toFixed(1)} MB less as WebP) + vendor (three ${threeVersion} with ${addons.size} addon files, fonts) @ ${commit}${dirty}; local audio: ${Object.entries(music).map(([k, fs]) => `${k}=${fs.map((f) => f.split('/').at(-2)).join('+')}`).join(' ') || 'none'}`);
