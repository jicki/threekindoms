// The art must be real files. The open-source repository keeps it out of git: ASSETS.sha256 at its root lists every
// file of the Release asset pack, which a fresh clone lacks until make assets runs (an old LFS clone has small
// text pointers instead). This fails at once with the fix, instead of a game full of broken images.
// ASSETS_DIR points it at another tree (tests of this test), ASSETS_SUMS at another list. Plain Node, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.ASSETS_DIR || fileURLToPath(new URL('../assets', import.meta.url));
const SUMS = process.env.ASSETS_SUMS || fileURLToPath(new URL('../../ASSETS.sha256', import.meta.url));
const ROOT = join(DIR, '../..');
const BINARY = /\.(webp|png|jpg|glb|bin|mp3|m4a)$/;
const MAGIC = 'version https://git-lfs';
const FIX = 'run make assets in the repository root (see README.md)';

test('assets are real files, not LFS pointers', () => {
  const pointers = [], head = Buffer.alloc(MAGIC.length);
  for (const e of readdirSync(DIR, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !BINARY.test(e.name)) continue;
    const f = join(e.parentPath, e.name), fd = openSync(f, 'r');
    try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
    if (head.toString('latin1') === MAGIC) pointers.push(f);
  }
  assert.equal(pointers.length, 0, `${pointers.length} LFS pointer files (first: ${pointers[0]}); ${FIX}`);
});

test('every file of ASSETS.sha256 is there with its hash', { skip: !existsSync(SUMS) && 'no ASSETS.sha256 (private repository)' }, () => {
  const missing = [], changed = [];
  for (const line of readFileSync(SUMS, 'utf8').split('\n').filter(Boolean)) {
    const sha = line.slice(0, 64), f = join(ROOT, line.slice(66));
    if (!existsSync(f)) missing.push(line.slice(66));
    else if (createHash('sha256').update(readFileSync(f)).digest('hex') !== sha) changed.push(line.slice(66));
  }
  assert.equal(missing.length, 0, `${missing.length} asset files missing (first: ${missing[0]}); ${FIX}`);
  assert.equal(changed.length, 0, `${changed.length} asset files differ from ASSETS.sha256 (first: ${changed[0]}); take the pack of the Release that matches this checkout`);
});
