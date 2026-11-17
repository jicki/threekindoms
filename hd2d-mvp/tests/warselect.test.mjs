// 战场选人使用真实指针，覆盖人物与可移动地格重叠、布阵和手机的二次确认。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, warRest } from './game.mjs';

async function openWar(game, query, { view = null } = {}) {
  const p = await game.open(query);
  await p.evaluate(async (view) => { (await import('./src/pace.js')).setPace(4); (await import('./src/vignette.js')).setVignettes(false); if (view) (await import('./src/quality.js')).warView.set(view); }, view);
  await newCampaign(p, '董卓');
  await p.evaluate(() => {
    const { g, G, debug } = window.__game, home = g.factions[g.player].city;
    const to = G.roads(home).map((c) => g.cities[c]).find((c) => c.faction !== g.player && c.faction !== G.NONE && c.officers.length);
    const ids = g.cities[home].officers.slice(0, 3);
    for (const id of [...ids, ...to.officers]) g.officers[id].soldiers ||= 500;
    debug.fieldWar(debug.setupWar(g, { from: home, to: to.id, ids, commander: ids[0], gold: 100, rice: 400 }), 'att');
  });
  await p.waitForFunction(() => window.__game.war?.st.deploying && document.querySelector('.war-rosterbtn'), null, { timeout: 30000 });
  return p;
}

async function finish(p) {
  const stop = closeMessages(p);
  try {
    await p.evaluate(() => window.__game.war.finishDeploy());
    await p.waitForFunction(() => { const w = window.__game.war; return w.field.turn === w.field.human && !w.st.deploying && !w.st.busy && !document.querySelector('.banner,.panel.msg,.shade'); }, null, { timeout: 60000 });
  } finally { stop(); }
}

// 把双方分开，保证每个人可独立指向；位置同步给规则和显示层。
async function arrange(p) {
  return p.evaluate(() => {
    const w = window.__game.war, f = w.field, mine = f.side(f.human), foe = f.alive.filter((u) => u.side !== f.human);
    const put = (u, x, y) => { u.x = x; u.y = y; w.spriteOf(u).position.set(x - 15.5, w.probe().top(x, y), y - 9); };
    mine.forEach((u, i) => put(u, 12 + i * 4, 10)); foe.forEach((u, i) => put(u, 2 + i * 3, 3));
    f.pool[f.human] = 80; w.cancel(); w.clickCell(mine[0].x, mine[0].y);
    if (!w.flat) w.frame(16, 10, 24);
    return mine.map((u) => u.id);
  });
}

for (const [view, query] of [['3D', ''], ['平面', '&flat']]) {
  test(`${view}战场：名牌、名单和切换准确选人，移动与攻击确认仍受保护`, { timeout: 180000 }, async () => {
    const game = await startGame({ width: 1280, height: 800 });
    try {
      const p = await openWar(game, query);
      for (const size of [{ width: 1024, height: 600 }, { width: 1201, height: 675 }, { width: 1440, height: 900 }]) {
        await p.setViewportSize(size); await p.waitForTimeout(200);
        const layout = await p.evaluate(() => {
          const button = document.querySelector('.war-rosterbtn'), r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const overlaps = [...document.querySelectorAll('.unitpanel, .logbox, .deploybtn, .warbar, .sysbtns')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; }).map((e) => e.className);
          return { l: r.left, r: r.right, t: r.top, b: r.bottom, hit: button.contains(hit), overlaps };
        });
        assert.ok(layout.l >= 0 && layout.r <= size.width && layout.t >= 0 && layout.b <= size.height && layout.hit && !layout.overlaps.length, `布阵 ${size.width}×${size.height} 的选将按钮应可用: ${JSON.stringify(layout)}`);
      }
      await p.setViewportSize({ width: 1280, height: 800 });
      await finish(p);
      const ids = await arrange(p); assert.equal(ids.length, 3);
      if (view === '3D') await warRest(p); else await p.waitForTimeout(200);
      await p.evaluate(() => { const w = window.__game.war, e = w.field.alive.find((u) => u.side !== w.field.human); w.hoverCell({ x: e.x, y: e.y }); });
      for (const size of [{ width: 1024, height: 600 }, { width: 1201, height: 675 }, { width: 1440, height: 900 }]) {
        await p.setViewportSize(size); await p.waitForTimeout(250);
        const layout = await p.evaluate(() => {
          const button = document.querySelector('.war-rosterbtn'), r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const overlaps = [...document.querySelectorAll('.unitpanel, .logbox, .wardock, .warbar, .sysbtns')].filter((e) => {
            const b = e.getBoundingClientRect(); return b.width && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
          }).map((e) => e.className);
          return { l: r.left, r: r.right, t: r.top, b: r.bottom, hit: button.contains(hit), overlaps };
        });
        assert.ok(layout.l >= 0 && layout.r <= size.width && layout.t >= 0 && layout.b <= size.height && layout.hit && !layout.overlaps.length, `${size.width}×${size.height} 的选将按钮应可见且不遮挡卡片: ${JSON.stringify(layout)}`);
      }
      await p.setViewportSize({ width: 1280, height: 800 }); await arrange(p);
      if (view === '3D') await warRest(p); else await p.waitForTimeout(200);

      // 找一个姓名位于可移动空格上方的真实位置；覆盖旧逻辑会将点击视为移动的情形。
      const at = await p.evaluate((ids) => {
        const w = window.__game.war, f = w.field, u = f.alive.find((v) => v.id === ids[1]), v = w.flatState().units.find((x) => x.u === u);
        const points = [];
        if (w.flat) {
          const s = w.screenOf(u.x, u.y), head = s.y + 0.28 * s.ch - v.lift * s.cw - 1.3 * s.cw;
          for (const dx of [0, -3, 3]) for (const dy of [6, 10, 14]) points.push({ x: s.x + dx, y: head - dy });
        } else {
          const el = [...document.querySelectorAll('.tag:not(.dot)')].find((e) => e.querySelector('b')?.textContent.replace('★', '') === window.__game.G.name(u.id));
          if (!el) return null;
          const r = el.getBoundingClientRect();
          for (const dx of [0.5, 0.3, 0.7]) for (const dy of [0.5, 0.3, 0.7]) points.push({ x: r.left + r.width * dx, y: r.top + r.height * dy });
        }
        for (const p of points) {
          if (document.elementFromPoint(p.x, p.y)?.tagName !== 'CANVAS') continue;
          // 地形视图临时关闭选人命中，读取姓名下的地格。
          if (w.flat) document.body.classList.add('terrain-view'); else w.setTerrainView(true);
          const c = w.hover({ x: p.x / innerWidth * 2 - 1, y: 1 - p.y / innerHeight * 2 });
          if (w.flat) document.body.classList.remove('terrain-view'); else w.setTerrainView(false);
          if (c && !f.unitAt(c.x, c.y) && w.st.reach.dist.has(`${c.x},${c.y}`)) return { ...p, id: u.id, cell: [c.x, c.y] };
        }
        return null;
      }, ids);
      assert.ok(at, '找到姓名与可移动空格重叠的位置');
      await p.locator('.terrainbtn').click();
      const ground = await p.evaluate(({ x, y }) => { const c = window.__game.war.hover({ x: x / innerWidth * 2 - 1, y: 1 - y / innerHeight * 2 }); return [c?.x, c?.y]; }, at);
      assert.deepEqual(ground, at.cell, '地形视图仍可选择姓名下方的移动地格');
      await p.locator('.terrainbtn').click();
      // 等显示层完成一帧：地形视图刚关闭时，3D 标签尚未重新绘制。
      await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const before = await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot()));
      await p.mouse.click(at.x, at.y);
      const selected = await p.evaluate((id) => {
        const w = window.__game.war, el = [...document.querySelectorAll('.tag')].find((e) => e.querySelector('b')?.textContent.replace('★', '') === window.__game.G.name(id));
        const r = el?.getBoundingClientRect(); return { id: w.st.sel?.id, stage: w.st.stage, rect: r && [r.left, r.top, r.right, r.bottom], cls: el?.className };
      }, at.id);
      assert.equal(selected.id, at.id, `点击位置 ${JSON.stringify(at)}，当前状态 ${JSON.stringify(selected)}`);
      assert.equal(await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot())), before, '点击姓名没有移动或消耗机动力');

      if (view === '平面') {
        await p.evaluate(() => window.__game.war.cancel()); await p.waitForTimeout(200);
        // 在人物跨出所在格的部分选择一个实际不透明像素；透明像素仍指向下面的地格。
        const pixels = await p.evaluate((id) => {
          const w = window.__game.war, u = w.field.alive.find((v) => v.id === id), v = w.flatState().units.find((x) => x.u === u), s = w.screenOf(u.x, u.y);
          const canvas = document.createElement('canvas'); canvas.width = v.img.width; canvas.height = v.img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(v.img, 0, 0); const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const h = 1.65 * s.cw, width = h * v.cw / v.ch, foot = s.y + 0.28 * s.ch - v.lift * s.cw + 0.04 * s.cw;
          const head = s.y + 0.28 * s.ch - v.lift * s.cw - 1.3 * s.cw, cos = Math.cos(v.tilt), sin = Math.sin(v.tilt), out = {};
          for (let sy = 0; sy < v.ch; sy += 2) for (let sx = 0; sx < v.cw; sx += 2) {
            const a = d[(sy * canvas.width + Math.floor(v.sx + sx)) * 4 + 3], kind = a >= 128 ? 'opaque' : a === 0 ? 'clear' : null;
            if (!kind || out[kind]) continue;
            const lx = ((sx + 0.5) / v.cw - 0.5) * width * (v.flip < 0 ? -1 : 1), ly = ((sy + 0.5) / v.ch - 1) * h;
            const x = s.x + cos * lx - sin * ly, y = foot + sin * lx + cos * ly;
            if (y <= head + 2 || y >= s.y - s.ch * 0.5 || document.elementFromPoint(x, y)?.tagName !== 'CANVAS') continue;
            const gx = Math.floor((x - (s.x - (u.x + 0.5) * s.cw)) / s.cw), gy = Math.floor((y - (s.y - (u.y + 0.5) * s.ch)) / s.ch);
            if (gx < 0 || gy < 0 || gx >= 32 || gy >= 19 || w.field.unitAt(gx, gy)) continue;
            out[kind] = { x, y, gx, gy };
          }
          return out;
        }, ids[2]);
        assert.ok(pixels.opaque && pixels.clear, `找到跨格的实像素和透明像素: ${JSON.stringify(pixels)}`);
        const clear = await p.evaluate(({ x, y }) => { const c = window.__game.war.hover({ x: x / innerWidth * 2 - 1, y: 1 - y / innerHeight * 2 }); return [c?.x, c?.y]; }, pixels.clear);
        assert.deepEqual(clear, [pixels.clear.gx, pixels.clear.gy], '透明像素不拦截地格');
        await p.mouse.click(pixels.opaque.x, pixels.opaque.y);
        await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, ids[2], { timeout: 5000 });
        assert.equal(await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot())), before);
      } else {
        const folded = await p.evaluate((id) => {
          const w = window.__game.war, el = [...document.querySelectorAll('.tag:not(.dot)')].find((e) => e.querySelector('b')?.textContent.replace('★', '') === window.__game.G.name(id));
          const r = el.getBoundingClientRect(), x = r.left + 2, y = r.top + 2; el.classList.add('dot');
          const c = w.hover({ x: x / innerWidth * 2 - 1, y: 1 - y / innerHeight * 2 }); el.classList.remove('dot');
          return !!c?.tag;
        }, ids[1]);
        assert.equal(folded, false, '折叠名牌隐藏文字的区域不拦截点击');
      }

      // 名单选择不消耗资源；关闭名单也不改变选中对象。
      await p.locator('.war-rosterbtn').click();
      assert.equal(await p.locator('.war-roster button').count(), ids.length);
      const name = await p.evaluate((id) => window.__game.G.name(id), ids[2]);
      await p.locator('.war-roster button', { hasText: name }).click();
      await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, ids[2]);
      assert.equal(await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot())), before);
      await p.locator('.war-rosterbtn').click(); await p.keyboard.press('Escape');
      assert.equal(await p.evaluate(() => window.__game.war.st.sel.id), ids[2]);
      await p.locator('.war-rosterbtn').click();
      await p.evaluate(() => { window.__game.war.st.busy = true; });
      const firstName = await p.evaluate((id) => window.__game.G.name(id), ids[0]);
      await p.locator('.war-roster button', { hasText: firstName }).click();
      assert.equal(await p.evaluate(() => window.__game.war.st.sel.id), ids[2], '名单打开后战场进入忙碌状态时不再切换');
      await p.evaluate(() => { window.__game.war.st.busy = false; });
      assert.equal(await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot())), before);

      // 未选中时，反向从最后一名开始，正向从第一名开始。
      await p.evaluate(() => window.__game.war.cancel()); await p.keyboard.press('[');
      await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, ids.at(-1));
      await p.evaluate(() => window.__game.war.cancel()); await p.keyboard.press(']');
      await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, ids[0]);

      // 选中可见的空地并实际行军。
      const move = await p.evaluate(() => {
        const w = window.__game.war, f = w.field, u = w.st.sel;
        for (const [key, cost] of w.st.reach.dist) {
          const [x, y] = key.split(',').map(Number); if (f.unitAt(x, y)) continue;
          const s = w.screenOf(x, y); if (document.elementFromPoint(s.x, s.y)?.tagName !== 'CANVAS') continue;
          const hit = w.hover({ x: s.x / innerWidth * 2 - 1, y: 1 - s.y / innerHeight * 2 });
          if (hit?.x === x && hit.y === y && !hit.tag) return { x, y, px: s.x, py: s.y, cost, id: u.id, pool: f.pool[f.human] };
        }
        return null;
      });
      assert.ok(move, '有可点击的移动地格');
      await p.mouse.click(move.px, move.py);
      await p.waitForFunction(({ x, y, id }) => { const w = window.__game.war, u = w.field.alive.find((v) => v.id === id); return u.x === x && u.y === y && !w.st.busy; }, move, { timeout: 20000 });
      assert.equal(await p.evaluate(() => { const f = window.__game.war.field; return f.pool[f.human]; }), move.pool - move.cost);

      // 等待攻击确认时，名单不能替玩家切换或提交攻击。
      const setup = await p.evaluate(() => {
        const w = window.__game.war, f = w.field, u = w.st.sel, e = f.alive.find((v) => v.side !== f.human);
        const place = [[15, 9], [15, 10]]; if (f.alive.some((v) => v !== u && v !== e && place.some(([x, y]) => x === v.x && y === v.y))) return false;
        for (const [v, [x, y]] of [[u, place[0]], [e, place[1]]]) { v.x = x; v.y = y; w.spriteOf(v).position.set(x - 15.5, w.probe().top(x, y), y - 9); }
        f.pool[f.human] = 20; w.cancel(); w.clickCell(u.x, u.y); w.clickCell(e.x, e.y); return w.st.stage === 'strike';
      });
      assert.ok(setup, '先进入攻击确认');
      const attackBefore = await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot()));
      await p.locator('.war-rosterbtn').click();
      assert.equal(await p.locator('.war-roster').count(), 0);
      assert.equal(await p.evaluate(() => window.__game.war.st.stage), 'strike');
      assert.equal(await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot())), attackBefore);

      // 选择计略目标及等待确认时，名单同样不能代替目标选择或提交。
      const cast = await p.evaluate(() => {
        const w = window.__game.war, f = w.field, u = w.st.sel, e = f.alive.find((v) => v.side !== f.human);
        w.cancel(); f.pool[f.human] = 80;
        let place = null;
        for (let y = Math.max(0, u.y - 4); y <= Math.min(18, u.y + 4) && !place; y++) for (let x = Math.max(0, u.x - 4); x <= Math.min(31, u.x + 4); x++) {
          if (f.unitAt(x, y) && (e.x !== x || e.y !== y)) continue;
          const test = { ...e, x, y }; if (f.legal(u, 0, test)) { place = [x, y]; break; }
        }
        if (!place) return false;
        [e.x, e.y] = place; w.spriteOf(e).position.set(e.x - 15.5, w.probe().top(e.x, e.y), e.y - 9);
        w.clickCell(u.x, u.y); w.chooseStrategy(0); return w.st.stage === 'targets';
      });
      assert.ok(cast, '进入计略目标选择');
      const castBefore = await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot()));
      await p.locator('.war-rosterbtn').click();
      assert.equal(await p.evaluate(() => window.__game.war.st.stage), 'targets');
      assert.equal(await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot())), castBefore);
      const confirmed = await p.evaluate(() => { const w = window.__game.war, e = w.field.alive.find((v) => v.side !== w.field.human); w.clickCell(e.x, e.y); return w.st.stage === 'confirm'; });
      assert.ok(confirmed, '进入计略确认');
      await p.locator('.war-rosterbtn').click();
      assert.equal(await p.evaluate(() => window.__game.war.st.stage), 'confirm');
      assert.equal(await p.evaluate(() => JSON.stringify(window.__game.war.field.snapshot())), castBefore);
      assert.deepEqual(p.errors, []);
    } finally { await game.close(); }
  });
}

test('手机平面战场：布阵可切换和从名单选将，移动仍需二次确认', { timeout: 180000 }, async () => {
  const game = await startGame({ width: 812, height: 375 });
  try {
    const p = await openWar(game, '&flat&phone&safe=24,24,6,12');
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const tap = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const ids = await p.evaluate(() => window.__game.war.field.side(window.__game.war.field.human).map((u) => u.id));
    for (const size of [{ width: 568, height: 320 }, { width: 667, height: 375 }, { width: 720, height: 375 }, { width: 812, height: 375 }]) {
      await p.setViewportSize(size); await p.waitForTimeout(200);
      const layout = await p.evaluate(() => [...document.querySelectorAll('.wardock > .btn, .wardock .threatbtn, .wardock .war-rosterbtn')].map((el) => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const covers = [...document.querySelectorAll('.unitpanel, .deploybtn, .warbar')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; }).map((e) => e.className);
        return { text: el.textContent.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, hit: el.contains(hit), covers };
      }));
      assert.ok(layout.every((b) => b.left >= 0 && b.right <= size.width && b.top >= 0 && b.bottom <= size.height && b.w >= 44 && b.h >= 44 && b.hit && !b.covers.length), `${size.width}×${size.height} 的按钮应足够大，且不应移出屏幕或互相遮挡: ${JSON.stringify(layout)}`);
      if (size.width === 568) await p.evaluate((id) => { const o = window.__game.G.data().officers[id]; window.__oldWarName = o.name; o.name = 'A'.repeat(32); }, ids[2]);
      await p.locator('.war-rosterbtn').click(); assert.equal(await p.locator('.war-roster button').count(), ids.length);
      if (size.width === 568) {
        const fits = await p.evaluate(() => {
          const label = [...document.querySelectorAll('.war-roster button b')].find((e) => e.textContent === 'A'.repeat(32)), button = label.closest('button'), range = document.createRange();
          range.selectNodeContents(label); const t = range.getBoundingClientRect(), b = button.getBoundingClientRect();
          return t.left >= b.left && t.right <= b.right && t.top >= b.top && t.bottom <= b.bottom;
        });
        assert.ok(fits, '最长自定义姓名保持在选将按钮内');
      }
      await p.keyboard.press('Escape');
      if (size.width === 568) await p.evaluate((id) => { window.__game.G.data().officers[id].name = window.__oldWarName; delete window.__oldWarName; }, ids[2]);
    }
    const buttons = p.locator('.wardock .cyclebtn');
    assert.equal(await buttons.nth(1).isEnabled(), true);
    await buttons.nth(1).click(); await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, ids[1]);
    await p.locator('.war-rosterbtn').click();
    const nm = await p.evaluate((id) => window.__game.G.name(id), ids[2]);
    await p.locator('.war-roster button', { hasText: nm }).click();
    await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, ids[2]);
    await finish(p);
    await arrange(p); await p.waitForTimeout(800);
    await p.setViewportSize({ width: 568, height: 320 }); await p.waitForTimeout(300);
    const battleLayout = await p.evaluate(() => [...document.querySelectorAll('.wardock > .btn, .wardock .threatbtn, .wardock .war-rosterbtn')].map((el) => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: el.textContent.trim(), hit: el.contains(hit), on: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    }));
    assert.ok(battleLayout.every((b) => b.hit && b.on), `小屏作战时工具栏保持可用: ${JSON.stringify(battleLayout)}`);
    await p.setViewportSize({ width: 812, height: 375 }); await p.waitForTimeout(600);
    const findMove = () => p.evaluate(() => {
      const w = window.__game.war, f = w.field, u = w.st.sel;
      for (const [key, cost] of w.st.reach.dist) {
        const [x, y] = key.split(',').map(Number); if (f.unitAt(x, y)) continue;
        const s = w.screenOf(x, y); if (document.elementFromPoint(s.x, s.y)?.tagName !== 'CANVAS') continue;
        const hit = w.hover({ x: s.x / innerWidth * 2 - 1, y: 1 - s.y / innerHeight * 2 });
        if (hit?.x === x && hit.y === y && !hit.tag) return { x, y, px: s.x, py: s.y, cost, id: u.id, start: [u.x, u.y], pool: f.pool[f.human] };
      }
      return null;
    });
    let move = await findMove();
    assert.ok(move, '有可点击的移动地格');
    await tap(move.px, move.py);
    assert.deepEqual(await p.evaluate(({ id }) => { const w = window.__game.war, u = w.field.alive.find((v) => v.id === id); return { at: [u.x, u.y], ask: [w.st.moveAsk?.x, w.st.moveAsk?.y], pool: w.field.pool[w.field.human] }; }, move), { at: move.start, ask: [move.x, move.y], pool: move.pool });
    await p.locator('.war-rosterbtn').click();
    const other = await p.evaluate((id) => window.__game.G.name(id), ids[1]);
    await p.locator('.war-roster button', { hasText: other }).click();
    assert.deepEqual(await p.evaluate(({ id }) => { const w = window.__game.war, u = w.field.alive.find((v) => v.id === id); return { at: [u.x, u.y], ask: w.st.moveAsk, pool: w.field.pool[w.field.human], selected: w.st.sel.id }; }, move), { at: move.start, ask: null, pool: move.pool, selected: ids[1] });
    await p.locator('.war-rosterbtn').click();
    const first = await p.evaluate((id) => window.__game.G.name(id), ids[0]);
    await p.locator('.war-roster button', { hasText: first }).click(); await p.waitForTimeout(600);
    move = await findMove(); assert.ok(move, '重新选择后有可点击的移动地格');
    await tap(move.px, move.py);
    await p.locator('.movego').click();
    await p.waitForFunction(({ x, y, id }) => { const w = window.__game.war, u = w.field.alive.find((v) => v.id === id); return u.x === x && u.y === y && !w.st.busy; }, move, { timeout: 20000 });
    assert.equal(await p.evaluate(() => { const f = window.__game.war.field; return f.pool[f.human]; }), move.pool - move.cost);
    assert.deepEqual(p.errors, []);
  } finally { await game.close(); }
});

test('手机 3D 战场：布阵与作战时窄屏按钮不遮挡，名单可用', { timeout: 180000 }, async () => {
  const game = await startGame({ width: 812, height: 375 });
  try {
    const p = await openWar(game, '&phone&safe=24,24,6,12', { view: '3d' });
    assert.equal(await p.evaluate(() => !!window.__game.war.flat), false, '手机战场显式选择 3D');
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const tap = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const checkLayout = async () => { for (const size of [{ width: 568, height: 320 }, { width: 667, height: 375 }, { width: 750, height: 375 }, { width: 812, height: 375 }]) {
      await p.setViewportSize(size); await p.waitForTimeout(250);
      const layout = await p.evaluate(() => [...document.querySelectorAll('.wardock .btn')].filter((el) => el.getBoundingClientRect().width).map((el) => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const covers = [...document.querySelectorAll('.unitpanel, .unitpanel .acts:not(:empty), .deploybtn, .warbar')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; }).map((e) => e.className);
        return { text: el.textContent.trim() || el.getAttribute('aria-label'), l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, hit: el.contains(hit), covers };
      }));
      assert.ok(layout.every((b) => b.l >= 0 && b.r <= size.width && b.t >= 0 && b.b <= size.height && b.w >= 44 && b.h >= 44 && b.hit && !b.covers.length), `手机 3D ${size.width}×${size.height} 的工具栏应可用: ${JSON.stringify(layout)}`);
    } };
    await checkLayout();
    const ids = await p.evaluate(() => { const f = window.__game.war.field; return f.side(f.human).map((u) => u.id); }), id = ids.at(-1);
    const nm = await p.evaluate((id) => window.__game.G.name(id), id);
    const roster = await p.locator('.war-rosterbtn').boundingBox(); await tap(roster.x + roster.width / 2, roster.y + roster.height / 2);
    const item = p.locator('.war-roster button', { hasText: nm }); await item.waitFor();
    const row = await item.boundingBox(); await tap(row.x + row.width / 2, row.y + row.height / 2);
    await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, id);
    await p.evaluate((id) => { const w = window.__game.war, u = w.field.alive.find((v) => v.id === id); w.centreOn(u.x, u.y); }, ids[0]);
    await warRest(p);
    const tag = await p.evaluate((id) => {
      const el = [...document.querySelectorAll('.tag:not(.dot)')].find((e) => e.querySelector('b')?.textContent.replace('★', '') === window.__game.G.name(id));
      const r = el?.getBoundingClientRect(); if (!r?.width) return null;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return document.elementFromPoint(x, y)?.tagName === 'CANVAS' ? { x, y } : null;
    }, ids[0]);
    assert.ok(tag, '总大将的姓名可以触摸'); await tap(tag.x, tag.y);
    await p.waitForFunction((id) => window.__game.war.st.sel?.id === id, ids[0]);
    await finish(p);
    await p.evaluate((id) => { const w = window.__game.war, u = w.field.alive.find((v) => v.id === id); w.clickCell(u.x, u.y); }, id);
    await checkLayout();
    assert.deepEqual(p.errors, []);
  } finally { await game.close(); }
});
