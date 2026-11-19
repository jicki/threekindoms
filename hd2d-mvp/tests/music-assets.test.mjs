// 场景音乐通过素材包安装，其他本地音频仍应被忽略。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const packed = new Set(readFileSync(new URL('../../ASSETS.sha256', import.meta.url), 'utf8')
  .trim().split('\n').map(line => line.slice(66)));

test('原版和 PS 版曲目由素材包提供并能被场景清单找到', () => {
  for (const [scene, path] of paths) {
    assert.ok(manifest.audio[scene].includes(path), `${scene}: 清单缺少 ${path}`);
    assert.ok(packed.has(`hd2d-mvp/${path}`), `${path} 未列入素材包`);
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

test('爆炎与碰撞音效由素材包提供并可被选中', () => {
  for (const key of ['sfx-blast', 'sfx-clash']) {
    const path = `assets/audio/${key}.mp3`, repoPath = `hd2d-mvp/${path}`;
    assert.ok(manifest.audio[key].includes(path), `${key} 未在清单中`);
    const data = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.ok(data.length > 1000 && (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)), `${path} 不是 MP3 音频`);
    assert.ok(packed.has(repoPath), `${repoPath} 未列入素材包`);
  }
});

test('素材包包含两套曲库的内政、事件和计略短曲', () => {
  const cues = ['land', 'industry', 'town', 'st-fire', 'st-ruse', 'st-lure', 'st-trap',
    'move', 'envoy', 'record', 'sortie', 'conscript', 'study', 'disaster', 'aiwar', 'income', 'levelup'];
  for (const set of ['original', 'ps']) for (const cue of cues) {
    const path = `assets/audio/${set}/cue-${cue}.m4a`, repoPath = `hd2d-mvp/${path}`;
    assert.ok(manifest.audio[`cue-${cue}`].includes(path), `清单缺少 ${path}`);
    const data = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.ok(data.length > 1000 && data.toString('ascii', 4, 8) === 'ftyp', `${path} 不是有效的 MP4 音频文件`);
    assert.ok(packed.has(repoPath), `${repoPath} 未列入素材包`);
  }
});
