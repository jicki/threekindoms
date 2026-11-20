import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'builtin-sovereigns-expanded-map' }); });
after(async () => { await game?.close(); });

for (const [city, from, style, width, height, flat] of [[12, 32, 'luoyang', 13, 9, false], [8, 34, 'changan', 11, 11, true]]) {
  test(`${style} 都城的独立城防外观、护城河及移动取景`, { timeout: 120000 }, async () => {
    const p = await game.open(flat ? '&phone&flat' : '', { clock: true });
    try {
      if (flat) await p.setViewportSize({ width: 844, height: 390 });
      await newCampaign(p, '刘备');
      await p.evaluate(({city,from}) => {
        const { g, debug } = window.__game;
        const w = { city, from, attacker: 0, defender: 4, day: 1,
          att: { ids: [40,41], gold: 100, rice: 500 }, def: { ids: [43,44], gold: 100, rice: 500 } };
        debug.fieldWar(w, 'att').catch(e => { window.__battleError = String(e.stack || e); });
      }, {city,from});
      const stop = closeMessages(p);
      try {
        await p.waitForFunction(() => { if (window.__battleError) throw new Error(window.__battleError); return window.__game.war?.st?.deploying; });
        if (!flat) await p.waitForFunction(() => window.__game.war.viewState().still);
        const scenes = await p.evaluate(() => {
          const w = window.__game.war, f = w.field, s = f.siege;
          const [mx,my] = s.bounds.moat, [rx,ry] = s.bounds.outer;
          const corners = [-mx,mx].flatMap(dx => [-my,my].map(dy => [s.cx + dx,s.cy + dy]));
          const shown = corners.map(([x,y]) => w.screenOf(x,y)).every(p => p.x > 5 && p.x < innerWidth-5 && p.y > 32 && p.y < innerHeight-16);
          const rendered = w.flat ? (() => {
            const c = w.composite(), px = c.width / f.map[0].length;
            const x = Math.floor((s.cx + 0.5) * px), y = Math.floor((s.cy + 0.5) * px);
            const [r,g,b] = c.getContext('2d').getImageData(x,y,1,1).data;
            return b > r && g > r; // 长安的青瓦屋面画在城内中央
          })() : w.scene.getObjectByName('siege-fortification')?.userData.style === s.style;
          return { style:s.style, width:rx*2+1, height:ry*2+1, water:corners.every(([x,y]) => f.terr(x,y) === 3), shown, rendered };
        });
        assert.deepEqual(scenes, { style, width, height, water:true, shown:true, rendered:true });
        assert.deepEqual(p.errors, []);
      } finally { stop(); }
    } finally { await p.context().close(); }
  });
}

for (const mode of ['3d', 'phone']) test(`${mode} 关隘战场可进入、布阵并显示对应场景`, { timeout: 120000 }, async () => {
  const spriteRequests = [];
  const p = await game.open(mode === 'phone' ? '&phone&flat' : '', { setup: (ctx) => ctx.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && /\/assets\/.*\/sprites\/.*\.(png|webp)$/.test(path)) spriteRequests.push(path);
  }) });
  try {
    assert.deepEqual(spriteRequests, [], '标题页按需加载战斗精灵图');
    if (mode === 'phone') await p.setViewportSize({ width: 812, height: 375 });
    else await p.setViewportSize({ width: 900, height: 900 });
    await newCampaign(p, '刘备');
    await p.evaluate(() => {
      const { g, debug } = window.__game;
      g.month = 11;
      const w = { city: 34, from: 8, attacker: 0, defender: 4, day: 1,
        att: { ids: [40, 41], gold: 100, rice: 500 }, def: { ids: [43, 44], gold: 100, rice: 500 } };
      for (const id of [...w.att.ids, ...w.def.ids]) g.officers[id].soldiers = 700;
      debug.fieldWar(w, 'att').catch((e) => { window.__battleError = String(e.stack || e); });
    });
    const stop = closeMessages(p);
    try {
      await p.waitForFunction(() => { if (window.__battleError) throw new Error(window.__battleError); return window.__game.war?.st?.deploying && document.body.dataset.screen === 'war'; }, null, { timeout: 60000 });
      if (mode === '3d') await p.waitForFunction(() => window.__game.war.viewState().still);
      const framing = await p.evaluate(() => {
        const w = window.__game.war, { cx, cy, bounds } = w.field.siege, [mx,my] = bounds.moat;
        const cells = [...w.field.alive];
        for (const dx of [-mx, mx]) for (const dy of [-my, my]) cells.push({ x: cx + dx, y: cy + dy });
        const points = cells.map(u => w.screenOf(u.x, u.y));
        return { shown: points.every(p => p.x > 8 && p.x < innerWidth - 8 && p.y > 42 && p.y < innerHeight - 24), zoom: w.viewState?.().zoom };
      });
      assert.equal(framing.shown, true, '默认视角包含双方队伍与整圈护城河');
      if (mode === '3d') {
        assert.equal(framing.zoom, 'whole');
        const near = await p.evaluate(() => {
          const w = window.__game.war, dist = w.viewState().dist;
          w.zoom(120); return dist;
        });
        await p.waitForFunction(() => window.__game.war.viewState().still);
        const wide = await p.evaluate(() => {
          const w = window.__game.war, dist = w.viewState().dist;
          w.overview(); return dist;
        });
        assert.ok(near < wide, `新版默认视角 ${near} 应比旧构图 ${wide} 更近`);
      }
      assert.ok(spriteRequests.some(path => /\/march\/(attacker|defender)\.png$/.test(path)), '进入战场后加载行军素材');
      const state = await p.evaluate(() => {
        const w = window.__game.war, doors = [], masonry = [];
        const fort = w.scene.getObjectByName('siege-fortification');
        fort?.traverse(o => {
          if (o.name === 'siege-door') doors.push(o.scale.y);
          if (o.isMesh && o.parent === fort) masonry.push(o.geometry.attributes.position.count);
        });
        return { profile: w.field.sceneProfile, castle: w.field.castle(), start: [w.field.side('att')[0].x, w.field.side('att')[0].y],
          flat: !!w.flat, style: fort?.userData.style, doors, masonry, siegeGates: w.field.siege.gates.length, dayTitle: document.querySelector('.warbar .day')?.title };
      });
      assert.equal(state.profile.label, '函谷关道'); assert.deepEqual(state.castle, [15, 9]); assert.deepEqual(state.start, [1, 8]);
      assert.match(state.dayTitle, /函谷关道/);
      assert.match(state.dayTitle, /雪天/);
      assert.match(await p.locator('.warbar .day').textContent(), /雪/);
      assert.equal(state.siegeGates, 4);
      if (mode === 'phone') { assert.equal(state.flat, true); assert.equal(await p.locator('.flatwar canvas').isVisible(), true); }
      else {
        assert.equal(state.flat, false); assert.equal(state.style, 'pass');
        assert.deepEqual(state.doors, Array(4).fill(1));
        assert.ok(state.masonry.length <= 8 && state.masonry.reduce((sum, n) => sum + n, 0) > 3000);
      }
      await p.locator('.deploybtn .btn', { hasText: '布阵完成' }).click();
      await p.waitForFunction(() => !window.__game.war.st.deploying);
      await p.waitForFunction(() => window.__game.war.myTurn && !window.__game.war.st.busy && !document.querySelector('.banner,.panel.msg,.shade'));
      const labels = await p.evaluate(() => {
        const w = window.__game.war, f = w.field, u = f.side('att')[0], saved = { x: u.x, y: u.y };
        const rows = [f.siege.outer, f.siege.inner].map(ring => {
          const gate = f.siege.gates.find(candidate => candidate.ring === ring);
          w.cancel(); Object.assign(u, { x: gate.x, y: gate.y }); w.clickCell(u.x, u.y);
          document.body.classList.add('card-open');
          const value = document.querySelector('.unitpanel .terrain-detail'), box = value.closest('.unitpanel').getBoundingClientRect();
          const text = document.createRange(); text.selectNodeContents(value);
          return { label: value.textContent, fits: [...text.getClientRects()].every(rect => rect.right <= box.right - 1 && rect.left >= box.left + 1) };
        });
        w.cancel(); Object.assign(u, saved); document.body.classList.remove('card-open');
        return rows;
      });
      assert.deepEqual(labels, ['外', '内'].map(ring => ({ label: `${ring}城门（封闭，攻方突破消耗＋2）`, fits: true })));
      if (mode === 'phone') {
        const cdp = await p.context().newCDPSession(p);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        const tap = async (locator) => { const r = await locator.boundingBox(); assert.ok(r); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
        await tap(p.locator('.war-rosterbtn')); await p.locator('.war-roster button').first().waitFor();
        await tap(p.locator('.war-roster button').first());
        await p.waitForFunction(() => window.__game.war.st.sel?.id === 40);
        const gate = await p.evaluate(() => {
          const w=window.__game.war, f=w.field, u=f.side('att')[0];
          const {x,y}=f.siege.gates.find(g=>g.face==='w' && g.ring===f.siege.outer);
          u.x=x-1; u.y=y; f.pool.att=100; w.cancel(); w.clickCell(u.x,u.y); w.centreOn(x,y);
          return {x,y};
        });
        await p.waitForTimeout(600);
        const tapCell = async () => {
          const r=await p.evaluate(({x,y})=>window.__game.war.screenOf(x,y),gate);
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x,y:r.y}]});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        };
        await tapCell(); await p.waitForFunction(({x,y})=>window.__game.war.st.moveAsk?.x===x && window.__game.war.st.moveAsk?.y===y,gate);
        await tapCell(); await p.waitForFunction(({x,y})=>{const w=window.__game.war; return !w.st.busy && w.field.siege.gates.find(g=>g.x===x&&g.y===y)?.open;},gate);
        assert.equal(await p.evaluate(()=>window.__game.war.st.last),null,'突破城门后不能撤销');
        await p.evaluate(() => {
          const w = window.__game.war, f = w.field, u = f.side('att')[0];
          const {x,y} = f.siege.gates.find(g=>g.face==='e' && g.ring===f.siege.outer);
          f.O(u.id).int = 99; f.pool.att = 20;
          Object.assign(u, { x:x+1, y }); w.cancel(); w.clickCell(u.x, u.y);
        });
        assert.equal(await p.getByRole('button', { name: '策应攻门', exact: true }).count(), 0);
        assert.equal(await p.evaluate(() => {
          const f = window.__game.war.field, { outer, gates } = f.siege;
          return f.pool.att === 20 && !gates.find(g => g.face === 'e' && g.ring === outer).open;
        }), true);
        const castChoices=await p.evaluate(()=>{
          const w=window.__game.war, f=w.field, u=f.side('att')[0], [enemy,...others]=f.side('def');
          others.forEach(v=>{v.gone=true;}); f.O(u.id).int=99; f.pool.att=100;
          f.map[3][13]=2; f.map[7][11]=2; f.map[3][4]=2;
          const choose=(sx,sy,tx,ty)=>{
            for(let i=0;i<6;i++) w.cancel(); Object.assign(u,{x:sx,y:sy}); Object.assign(enemy,{x:tx,y:ty});
            w.clickCell(sx,sy); w.openStrategies(); w.chooseStrategy(0); return w.st.cast===0;
          };
          const {x,y} = f.siege.gates.find(g=>g.face==='e' && g.ring===f.siege.outer);
          return [choose(x+1,y,x,y),choose(x,y,x+1,y),choose(3,3,4,3)];
        });
        assert.deepEqual(castChoices,[false,false,true],'手机战场计策目标应在两个方向一致，并允许无遮挡目标');
        await p.evaluate(() => { const w = window.__game.war; w.cancel(); w.openStrategies(); });
        const fire = p.locator('.actpanel [data-sid="0"]');
        await tap(fire);
        assert.match(await p.locator('.actpanel .ap-info').textContent(), /雪天.*命中阈值 −6.*损兵 ×90%/);
        await tap(fire);
        await p.locator('.actpanel [data-target]').first().click();
        const weather = p.locator('.actpanel .ap-weather');
        assert.ok(await weather.isVisible());
        assert.match(await weather.textContent(), /雪天.*损兵 ×90%/);
      }
      assert.deepEqual(p.errors, []);
    } finally { stop(); }
  } finally { await p.context().close(); }
});

test('手机同盟守城只在选将名单中显示实际受玩家指挥的援军', { timeout: 120000 }, async () => {
  const page = await game.open('&flat&phone');
  try {
    await page.setViewportSize({ width: 812, height: 375 });
    await newCampaign(page, '曹操');
    await page.evaluate(async () => {
      const { g, G, debug } = window.__game;
      const { joinDefense, defenseCandidates } = await import('./src/core/warcore.js');
      const occupy = (city, faction, ids) => {
        for (const c of g.cities) c.officers = c.officers.filter(id => !ids.includes(id));
        Object.assign(g.cities[city], { faction, officers: ids, gold: 500, rice: 900 });
        for (const id of ids) Object.assign(g.officers[id], { soldiers: 500, hp: 60, status: G.SERVING });
      };
      occupy(30, 4, [40, 41]); occupy(13, 0, [42]); occupy(35, g.player, [43, 44, 45]);
      g.factions[g.player].alliance[0] = g.factions[0].alliance[g.player] = 10;
      const w = debug.setupWar(g, { from: 30, to: 13, ids: [40], commander: 40, gold: 100, rice: 150 });
      const plan = defenseCandidates(g, 4, 0, 13).find(c => c.city === 35);
      if (!joinDefense(g, w, plan)) throw new Error('没有武关援军');
      debug.fieldWar(w, 'def').catch(e => { window.__battleError = String(e.stack || e); });
    });
    const stop = closeMessages(page);
    try {
      await page.waitForFunction(() => {
        if (window.__battleError) throw new Error(window.__battleError);
        return window.__game.war?.st?.deploying;
      });
      await page.locator('.war-rosterbtn').click();
      const rows = page.locator('.war-roster button');
      assert.equal(await rows.count(), 2);
      const names = await page.evaluate(() => [44, 45, 42].map(id => window.__game.G.name(id)));
      const roster = await rows.locator('b').allTextContents();
      assert.deepEqual([...roster].sort(), names.slice(0, 2).sort());
      await rows.filter({ hasText: names[1] }).click();
      assert.equal(await page.evaluate(() => window.__game.war.st.sel.id), 45);
      assert.match(await page.locator('.warbar .side.me').textContent(), /联军/);
      assert.deepEqual(page.errors, []);
    } finally { stop(); }
  } finally { await page.context().close(); }
});
