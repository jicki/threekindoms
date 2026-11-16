// 新检出必须包含场景所需的音乐，其他本地音频仍应被忽略。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
const original = ['title', 'select', 'strategy', 'battle', 'skirmish', 'duel', 'result', 'gameover', 'ending'];
const ps = ['title', 'select', 'strategy', 'battle', 'skirmish', 'duel', 'ending'];
const paths = [
  ...original.map((scene) => [`bgm-${scene}`, `assets/audio/original/bgm-${scene}.m4a`]),
  ...ps.map((scene) => [`bgm-${scene}`, `assets/audio/ps/bgm-${scene}.${scene === 'ending' ? 'm4a' : 'mp3'}`]),
];

test('原版和 PS 版曲目被版本控制并能被场景清单找到', () => {
  const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', 'hd2d-mvp/assets/audio/original', 'hd2d-mvp/assets/audio/ps'],
    { cwd: root, encoding: 'utf8' }).split('\0'));
  for (const [scene, path] of paths) {
    assert.ok(manifest.audio[scene].includes(path), `${scene}: 清单缺少 ${path}`);
    assert.ok(tracked.has(`hd2d-mvp/${path}`), `${path} 未纳入版本控制`);
    const data = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.ok(data.length > 30000, `${path} 文件过小`);
    if (path.endsWith('.m4a')) assert.equal(data.toString('ascii', 4, 8), 'ftyp', `${path} 不是 MP4 音频`);
    else assert.ok(data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0), `${path} 不是 MP3 音频`);
  }
});

test('未收录的本地音频仍被忽略', () => {
  for (const path of ['hd2d-mvp/assets/audio/original/sfx-select.mp3', 'hd2d-mvp/assets/audio/ps/private.mp3', 'hd2d-mvp/assets/audio/remix/bgm-title.mp3']) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', path], { cwd: root });
    assert.equal(result.status, 0, `${path} 应保持忽略：${result.stderr}`);
  }
});

test('所有内政、事件和计略短曲都存在于两套曲库且不会被忽略', () => {
  const cues = ['land', 'industry', 'town', 'st-fire', 'st-ruse', 'st-lure', 'st-trap',
    'move', 'envoy', 'record', 'sortie', 'conscript', 'study', 'disaster', 'aiwar', 'income', 'levelup'];
  for (const set of ['original', 'ps']) for (const cue of cues) {
    const path = `assets/audio/${set}/cue-${cue}.m4a`, repoPath = `hd2d-mvp/${path}`;
    assert.ok(manifest.audio[`cue-${cue}`].includes(path), `清单缺少 ${path}`);
    const data = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.ok(data.length > 1000 && data.toString('ascii', 4, 8) === 'ftyp', `${path} 不是有效的 MP4 音频文件`);
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', repoPath], { cwd: root });
    assert.equal(ignored.status, 1, `${repoPath} 不应被忽略：${ignored.stderr}`);
  }
});
