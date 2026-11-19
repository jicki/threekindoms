import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages } from './game.mjs';

let game;
before(async () => { game = await startGame({ scenario: 'builtin-sovereigns-expanded-map' }); });
after(async () => { await game?.close(); });

for (const mode of ['3d', 'phone']) test(`${mode} 关隘战场可进入、布阵并显示对应场景`, { timeout: 120000 }, async () => {
  const p = await game.open(mode === 'phone' ? '&phone&flat' : '');
  try {
    if (mode === 'phone') await p.setViewportSize({ width: 812, height: 375 });
    await newCampaign(p, '刘备');
    await p.evaluate(() => {
      const { g, debug } = window.__game;
      const w = { city: 34, from: 8, attacker: 0, defender: 4, day: 1,
        att: { ids: [40, 41], gold: 100, rice: 500 }, def: { ids: [43, 44], gold: 100, rice: 500 } };
      for (const id of [...w.att.ids, ...w.def.ids]) g.officers[id].soldiers = 700;
      debug.fieldWar(w, 'att').catch((e) => { window.__battleError = String(e.stack || e); });
    });
    const stop = closeMessages(p);
    try {
      await p.waitForFunction(() => { if (window.__battleError) throw new Error(window.__battleError); return window.__game.war?.st?.deploying && document.body.dataset.screen === 'war'; }, null, { timeout: 60000 });
      const state = await p.evaluate(() => {
        const w = window.__game.war, pass = [], gates = [];
        w.scene.traverse((o) => { if (o.userData.landmark === 'pass') pass.push(o.rotation.y); if (o.userData.siegeGate) gates.push(o.type); });
        return { profile: w.field.sceneProfile, castle: w.field.castle(), start: [w.field.side('att')[0].x, w.field.side('att')[0].y],
          flat: !!w.flat, pass, gates, siegeGates: w.field.siege.gates.length, dayTitle: document.querySelector('.warbar .day')?.title };
      });
      assert.equal(state.profile.label, '函谷关道'); assert.deepEqual(state.castle, [15, 9]); assert.deepEqual(state.start, [1, 9]);
      assert.match(state.dayTitle, /函谷关道/);
      assert.equal(state.siegeGates, 8);
      if (mode === 'phone') { assert.equal(state.flat, true); assert.equal(await p.locator('.flatwar canvas').isVisible(), true); }
      else { assert.equal(state.flat, false); assert.equal(state.pass.length, 1); assert.equal(state.pass[0], -Math.PI/2); assert.equal(state.gates.length, 8); }
      await p.locator('.deploybtn .btn', { hasText: '布阵完成' }).click();
      await p.waitForFunction(() => !window.__game.war.st.deploying);
      if (mode === 'phone') {
        await p.waitForFunction(() => window.__game.war.myTurn && !window.__game.war.st.busy && !document.querySelector('.banner,.panel.msg,.shade'));
        const cdp = await p.context().newCDPSession(p);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        const tap = async (locator) => { const r = await locator.boundingBox(); assert.ok(r); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
        await tap(p.locator('.war-rosterbtn')); await p.locator('.war-roster button').first().waitFor();
        await tap(p.locator('.war-roster button').first());
        await p.waitForFunction(() => window.__game.war.st.sel?.id === 40);
        const gate = await p.evaluate(() => {
          const w=window.__game.war, f=w.field, u=f.side('att')[0], {cx,cy}=f.siege;
          u.x=cx-4; u.y=cy; f.pool.att=100; w.cancel(); w.clickCell(u.x,u.y); w.centreOn(cx-3,cy);
          return {x:cx-3,y:cy};
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
        const castChoices=await p.evaluate(()=>{
          const w=window.__game.war, f=w.field, u=f.side('att')[0], [enemy,...others]=f.side('def');
          others.forEach(v=>{v.gone=true;}); f.O(u.id).int=99; f.pool.att=100;
          f.map[3][13]=2; f.map[7][11]=2; f.map[3][4]=2;
          const choose=(sx,sy,tx,ty)=>{
            for(let i=0;i<6;i++) w.cancel(); Object.assign(u,{x:sx,y:sy}); Object.assign(enemy,{x:tx,y:ty});
            w.clickCell(sx,sy); w.openStrategies(); w.chooseStrategy(0); return w.st.cast===0;
          };
          return [choose(13,3,11,7),choose(11,7,13,3),choose(3,3,4,3)];
        });
        assert.deepEqual(castChoices,[false,false,true],'手机战场计策目标应在两个方向一致，并允许无遮挡目标');
      }
      assert.deepEqual(p.errors, []);
    } finally { stop(); }
  } finally { await p.context().close(); }
});
