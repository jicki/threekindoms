import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const tool = fileURLToPath(new URL('../tools/compare_expanded_openings.mjs', import.meta.url));
const core = fileURLToPath(new URL('../src/core', import.meta.url));
// Node 22.0–22.6 的 .js 默认使用 CommonJS；较新的 Node 已移除该实验选项。
const nodeOptions = process.allowedNodeEnvironmentFlags.has('--experimental-default-type') ? ['--experimental-default-type=module'] : [];
const args = ['--before', core, '--after', core, '--seeds', '2', '--first-seed', '4', '--players', '8', '--levels', '2', '--years', '2'];

for (const policy of ['auto', 'defend']) test(`开局对照工具的 ${policy} 模式对相同代码和种子给出相同结果`, () => {
  const output = execFileSync(process.execPath, [...nodeOptions, tool, ...args, '--policy', policy], { cwd: root, encoding: 'utf8' });
  const rows = output.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1); assert.equal(rows[0].ruler, '袁术');
  assert.deepEqual(rows[0].before, rows[0].after);
  assert.ok(rows[0].before.attacks > 0, '应执行至少一场玩家防守战');
});

test('开局对照工具允许从种子 0 开始', () => {
  const output = execFileSync(process.execPath, [...nodeOptions, tool, '--before', core, '--after', core, '--seeds', '1', '--first-seed', '0', '--players', '8', '--levels', '2', '--years', '1'], { cwd: root, encoding: 'utf8' });
  const row = JSON.parse(output.trim());
  assert.deepEqual(row.before, row.after);
});

for (const [invalid, reason] of [
  [['--seeds', '0'], /随机种子数/],
  [['--players', ''], /君主编号/],
  [['--first-seed', '4294967295', '--seeds', '2'], /起始及结束种子/],
]) test(`开局对照工具拒绝无效参数 ${invalid.join(' ')}`, () => {
  const result = spawnSync(process.execPath, [...nodeOptions, tool, '--before', core, '--after', core, ...invalid], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, reason);
});
