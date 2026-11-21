import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, newCampaign, closeMessages, warRest } from './game.mjs';
import { ALIGNED_APPROACH_BATTLE_REVISION } from '../src/core/regional-battlefields.js';

const scenario = 'builtin-sovereigns-expanded-map';
async function deploy(page, city, from, human = 'att', revision = null) {
  await newCampaign(page, '刘备');
  await page.evaluate(({ city, from, human, revision }) => {
    const { g, debug } = window.__game, w = { city, from, attacker: 4, defender: 0, day: 1,
      att: { ids: [40, 41, 42], gold: 200, rice: 900 }, def: { ids: [43, 44, 45], gold: 200, rice: 900 } };
    for (const id of [...w.att.ids, ...w.def.ids]) g.officers[id].soldiers = 700;
    if (revision != null) g.campaignRevision = revision;
    debug.fieldWar(w, human).catch(error => { window.__battleError = String(error.stack || error); });
  }, { city, from, human, revision });
  const stop = closeMessages(page);
  try {
    await page.waitForFunction(() => {
      if (window.__battleError) throw new Error(window.__battleError);
      return document.body.dataset.screen === 'war' && window.__game.war?.st.deploying;
    });
  } finally { stop(); }
}

test('手机触控可切换两个登陆区并跨区布阵，深海不可放置或行军', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 844, height: 390, touch: true });
  try {
    const page = await game.open('&phone&flat');
    await deploy(page, 38, 17);
    await page.getByRole('button', { name: '战场全图' }).tap();
    const zones = page.getByRole('group', { name: '布阵区' });
    assert.deepEqual(await zones.getByRole('button').allTextContents(), ['主登陆滩', '侧翼小湾']);
    const points = await page.evaluate(() => {
      const w = window.__game.war, f = w.field, u = w.st.sel;
      const land = f.deploymentZones('att')[1].cells.find(([x, y]) => !f.unitAt(x, y));
      const sea = land && [...f.approaches.barriers].filter(([, kind]) => kind === '深海')
        .map(([k]) => k.split(',').map(Number)).sort((a,b) => (Math.abs(a[0] - land[0]) + Math.abs(a[1] - land[1]))
          - (Math.abs(b[0] - land[0]) + Math.abs(b[1] - land[1])))[0];
      const visible = f.deploymentZones('att').every(z => {
        const p = w.screenOf(...z.anchor);
        return p.x > 80 && p.x < innerWidth - 30 && p.y > 44 && p.y < innerHeight - 56;
      });
      const canvas = w.composite(), ctx = canvas.getContext('2d'), cell = canvas.width / f.width;
      const sample = (x, y) => [...ctx.getImageData(Math.floor((x + 0.5) * cell), Math.floor((y + 0.5) * cell), 1, 1).data];
      const y = 7, shore = f.map[y].findIndex(tile => tile !== 3) - 1;
      return { who: u.id, start: [u.x, u.y], land, sea, flat: w.flat, visible,
        nearWater: sample(shore, y), deepWater: sample(2, y) };
    });
    assert.equal(points.flat, true);
    assert.equal(points.visible, true, '全图取景能看到两个登陆区');
    assert.ok(points.nearWater[1] > points.deepWater[1] + 12, '平面版岸边比外海明亮');
    await zones.getByRole('button', { name: '侧翼小湾' }).tap();
    const tap = async ([x, y]) => {
      const at = await page.evaluate(([x, y]) => window.__game.war.screenOf(x, y), [x, y]);
      assert.ok(at.x > 0 && at.x < 844 && at.y > 0 && at.y < 390);
      await page.touchscreen.tap(at.x, at.y);
    };
    const position = () => page.evaluate(id => {
      const u = window.__game.war.field.side('att').find(u => u.id === id);
      return [u.x, u.y];
    }, points.who);
    await tap(points.sea);
    assert.deepEqual(await position(), points.start);
    await tap(points.land);
    assert.deepEqual(await position(), points.land);
    await page.getByRole('button', { name: '布阵完成' }).tap();
    await zones.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(({ who, sea: [x,y] }) => {
      const f = window.__game.war.field, u = f.side('att').find(u => u.id === who);
      return !f.reach(u, Infinity).dist.has(`${x},${y}`);
    }, points), true);
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('手机宛城可定位宽城内与外营，选中的部将在城内路面上换位', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 844, height: 390, touch: true });
  try {
    const page = await game.open('&phone&flat');
    await deploy(page, 32, 13, 'def');
    const zones = page.getByRole('group', { name: '布阵区' });
    const position = () => page.evaluate(() => {
      const w = window.__game.war, f = w.field, [commander] = f.side('def');
      return { x: commander.x, y: commander.y, flat: w.flat };
    });
    const start = await position();
    assert.equal(start.flat, true);
    await zones.getByRole('button', { name: '外营驻地' }).tap();
    await zones.getByRole('button', { name: '城内守备' }).tap();
    const target = await page.evaluate(({ x, y }) => {
      const w = window.__game.war, f = w.field;
      return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => [x+dx,y+dy]).find(([cx,cy]) =>
        f.siege.streets.has(`${cx},${cy}`) && !f.unitAt(cx,cy));
    },start);
    assert.ok(target);
    for (const cell of [[start.x,start.y], target]) {
      const at = await page.evaluate(([x,y]) => window.__game.war.screenOf(x,y),cell);
      assert.ok(at.x > 0 && at.x < 844 && at.y > 0 && at.y < 390);
      await page.touchscreen.tap(at.x,at.y);
    }
    await page.waitForFunction(([x,y]) => {
      const [u] = window.__game.war.field.side('def');
      return u.x === x && u.y === y;
    }, target, {timeout:5000});
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('兖州新店址显示各自的牌子并打开对应的战场命令', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 1366, height: 850 });
  try {
    const page = await game.open();
    await deploy(page, 11, 14);
    for (const label of ['米', '武', '医']) await page.locator('.vtag').filter({ hasText:new RegExp(`^${label}$`) }).waitFor({state:'attached'});
    await page.getByRole('button', { name: '布阵完成' }).click();
    await page.waitForFunction(() => !window.__game.war.st.deploying);
    for (const [kind, command] of [['米店', '买米'], ['武器店', '武器店'], ['病院', '治疗 50金']]) {
      await page.evaluate(kind => {
        const w = window.__game.war, f = w.field, [u] = f.side('att');
        const shop = f.villages.find(v => v.kind === kind), reach = f.reach(u, Infinity);
        const cost = reach.dist.get(`${shop.x},${shop.y}`);
        if (!Number.isFinite(cost)) throw new Error(`未能到达${kind}`);
        w.clickCell(-1,-1);
        f.pool.att = cost;
        f.move(u,shop.x,shop.y,cost,f.path(reach,shop.x,shop.y));
        f.O(u.id).hp = 10;
        w.clickCell(u.x,u.y);
      }, kind);
      await page.locator('.unitacts button, .unitpanel:not(.compare) button', { hasText:command }).first().waitFor();
    }
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('手机并州进城后放大街区，切回城外恢复倍率，手动缩放优先', { timeout:120000 }, async () => {
  const game = await startGame({ scenario, width:844, height:390, touch:true });
  try {
    const page = await game.open('&phone&flat');
    await deploy(page,2,5,'att',ALIGNED_APPROACH_BATTLE_REVISION);
    await page.getByRole('button',{ name:'布阵完成' }).tap();
    await page.waitForFunction(() => !window.__game.war.st.deploying && !window.__game.war.st.busy);
    const setup = await page.evaluate(() => {
      const w = window.__game.war, f = w.field, [u, ally] = f.side('att');
      const gate = f.siege.gates.find(p => p.face === 'w' && p.ring === f.siege.outer);
      // 从门前开始操作，让回归专注于两次触控、进城动画与取景的衔接。
      Object.assign(u,{x:gate.x-1,y:gate.y});
      f.pool.att = 24;
      w.centreOn(gate.x,gate.y);
      w.clickCell(u.x,u.y);
      const target = w.screenOf(gate.x,gate.y);
      return { insideId:u.id,outsideId:ally.id,base:target.cw,x:target.x,y:target.y };
    });
    await page.touchscreen.tap(setup.x,setup.y);
    await page.waitForFunction(() => !!window.__game.war.st.moveAsk);
    const previewScale = await page.evaluate(() => window.__game.war.screenAxes().x[0]);
    assert.equal(previewScale, setup.base);
    await page.touchscreen.tap(setup.x,setup.y);
    await page.waitForFunction(base => {
      const w = window.__game.war, f = w.field, u = w.st.sel;
      return !w.st.busy && u && f.siege.gates.some(g => g.open && g.x === u.x && g.y === u.y) && w.screenAxes().x[0] > base * 1.35;
    },setup.base,{timeout:7000});
    const select = id => page.evaluate(id => {
      const w = window.__game.war, u = w.field.side('att').find(u => u.id === id);
      w.clickCell(u.x,u.y);
    },id);
    await select(setup.outsideId);
    await page.waitForFunction(base => Math.abs(window.__game.war.screenAxes().x[0]-base)<0.1,setup.base,{timeout:5000});
    await select(setup.insideId);
    await page.waitForFunction(base => window.__game.war.screenAxes().x[0]>base*1.35,setup.base,{timeout:5000});
    const manual = await page.evaluate(() => {
      const w = window.__game.war;
      w.zoom(400, { x:0, y:0 });
      w.slide(15,0);
      return w.screenAxes().x[0];
    });
    await select(setup.outsideId);
    await select(setup.insideId);
    await page.evaluate(() => new Promise(resolve => {
      const count = window.__game.war.flatDebug().frames;
      const frame = () => window.__game.war.flatDebug().frames >= count+12 ? resolve() : requestAnimationFrame(frame);
      requestAnimationFrame(frame);
    }));
    assert.equal(await page.evaluate(() => window.__game.war.screenAxes().x[0]),manual);
    await page.evaluate(() => window.__game.war.resetView());
    await page.waitForFunction(base => window.__game.war.screenAxes().x[0]>base*1.35,setup.base,{timeout:5000});
    assert.deepEqual(page.errors,[]);
  } finally { await game.close(); }
});

test('手机读取旧版并州布局时继续使用旧取景倍率', { timeout:120000 }, async () => {
  const game = await startGame({ scenario, width:844, height:390, touch:true });
  try {
    const page = await game.open('&phone&flat');
    await deploy(page,2,8,'att',14);
    await page.getByRole('button',{ name:'布阵完成' }).tap();
    await page.waitForFunction(() => !window.__game.war.st.deploying && !window.__game.war.st.busy);
    const result = await page.evaluate(async () => {
      const w = window.__game.war, f = w.field, [u] = f.side('att');
      const gate = f.siege.gates.find(p => p.face === 'w' && p.ring === f.siege.outer);
      Object.assign(u,{x:gate.x,y:gate.y});
      const before = w.screenAxes().x[0], start = w.flatDebug().frames;
      w.clickCell(u.x,u.y);
      await new Promise(resolve => {
        const frame = () => w.flatDebug().frames >= start+12 ? resolve() : requestAnimationFrame(frame);
        requestAnimationFrame(frame);
      });
      return { revision:f.siege.revision, selected:w.st.sel === u, stable:w.screenAxes().x[0] === before };
    });
    assert.deepEqual(result,{revision:7,selected:true,stable:true});
    assert.deepEqual(page.errors,[]);
  } finally { await game.close(); }
});

test('桌面三维显示洛阳街坊和分段城壕，进城道路与小地图使用同一尺寸', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 1366, height: 850 });
  try {
    const page = await game.open();
    await deploy(page, 12, 32);
    await page.getByRole('button', { name: '战场全图' }).click();
    await page.waitForFunction(() => window.__game.war.viewState().still);
    const board = await page.evaluate(() => {
      const w = window.__game.war, f = w.field;
      const scenery = w.scene.getObjectByName('battle-approaches');
      const fort = w.scene.getObjectByName('siege-fortification');
      const gates = f.siege.gates.filter(g => g.ring === f.siege.outer);
      const mini = document.querySelector('.warmini canvas');
      const height = Math.max(...fort.children.filter(o => o.isMesh).map(o => {
        o.geometry.computeBoundingBox(); return o.geometry.boundingBox.max.y;
      }));
      return { title: f.sceneProfile.label, size: [f.width, f.height], fort: fort?.userData.style, height,
        buildings: f.approaches.sites.filter(s => s.kind === 'house').length, render: scenery?.children.length,
        moat: f.siege.moatCells.length, wet: f.siege.moatCells.some(cell => cell.wet),
        routes: new Set(f.approaches.routes.map(r => r.goal.label)).size, mini: [mini.width, mini.height],
        framed: [...gates, ...f.units].every(u => {
          const p = w.screenOf(u.x, u.y); return p.x > 0 && p.x < innerWidth && p.y > 25 && p.y < innerHeight;
        }) };
    });
    assert.equal(board.title, '洛阳宫城');
    assert.deepEqual(board.size, [52, 34]);
    assert.equal(board.fort, 'luoyang');
    assert.ok(board.height > 2.5, '宫殿与南门有可见的高度差');
    assert.ok(board.buildings > 4 && board.render > 0);
    assert.ok(board.moat > 10 && !board.wet);
    assert.equal(board.routes, 4);
    assert.deepEqual(board.mini, [520, 340]);
    assert.equal(board.framed, true);
    const entrance = await page.evaluate(async () => {
      const { Raycaster, Vector3 } = await import('three');
      const w = window.__game.war, f = w.field, u = f.side('att')[0];
      const gate = f.siege.gates.find(g => g.face === 's' && g.ring === f.siege.outer);
      const fort = w.scene.getObjectByName('siege-fortification');
      const door = fort.children.find(o => o.name === 'siege-door' && o.position.x === gate.x - f.width / 2 + 0.5
        && o.position.z === gate.y - f.height / 2 + 0.5);
      const origin = door.position.clone().add(new Vector3(0.13, 0.55, 0.51));
      const ray = new Raycaster(origin, new Vector3(0, 0, -1), 0, 1.02);
      const blocked = () => {
        fort.updateMatrixWorld(true);
        return ray.intersectObject(fort, true).length > 0;
      };
      const cost = f.cost(u, gate.x, gate.y), closed = blocked();
      const adjacentWall = [-1, 1].every(dx => !f.deployable(gate.x + dx, gate.y));
      const opened = f.move(u, gate.x, gate.y, cost);
      return new Promise(resolve => {
        const check = () => {
          if (door.scale.y !== 0.1) { requestAnimationFrame(check); return; }
          resolve({ closed, adjacentWall, opened, clear: !blocked(), discount: cost - f.cost(u, gate.x, gate.y) });
        };
        requestAnimationFrame(check);
      });
    });
    assert.deepEqual(entrance, { closed: true, adjacentWall: true, opened: true, clear: true, discount: 2 });
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('剑阁栈道的可见高度和拾取对应实际栈道格，断崖仍不可通行', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 1366, height: 850 });
  try {
    const page = await game.open();
    await deploy(page, 36, 25);
    await page.evaluate(() => {
      const w = window.__game.war, route = w.field.approaches.routes.find(r => r.goal.label === '栈道至内关');
      const deck = route.cells.filter(([x,y]) => w.field.approaches.roads.get(`${x},${y}`)?.kind === 'plank');
      w.centreOn(...deck[Math.floor(deck.length / 2)]);
    });
    await page.waitForFunction(() => window.__game.war.viewState().still);
    const status = await page.evaluate(() => {
      const w = window.__game.war, f = w.field, u = f.side('att')[0], board = w.probe();
      const way = f.approaches.routes.find(r => r.goal.label === '栈道至内关');
      const deck = way.cells.filter(([x, y]) => f.approaches.roads.get(`${x},${y}`)?.kind === 'plank');
      const altitudes = deck.map(([x, y]) => board.top(x, y));
      const marked = document.querySelector('.vtag[title="贴壁栈道"]');
      w.setTerrainView(true);
      const hits = deck.filter(([x, y]) => {
        if (f.unitAt(x, y)) return false;
        const p = w.screenOf(x, y), el = document.elementFromPoint(p.x, p.y);
        if (el?.tagName !== 'CANVAS') return false;
        const cell = w.hover({ x: p.x / innerWidth * 2 - 1, y: 1 - p.y / innerHeight * 2 });
        return cell?.x === x && cell?.y === y;
      }).length;
      const blocked = [...f.approaches.barriers]
        .filter(([, kind]) => kind === '断崖')
        .every(([k]) => !Number.isFinite(f.cost(u, ...k.split(',').map(Number))));
      return { hits, raised: Math.max(...altitudes) - Math.min(...altitudes) > 0.6,
        clear: deck.every(p => Number.isFinite(f.cost(u, ...p))), blocked, marked: !!marked?.getClientRects().length };
    });
    assert.ok(status.hits >= 2 && status.raised && status.clear && status.blocked && status.marked, JSON.stringify(status));
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('桌面夷洲的两个登陆按钮均可点击，避开系统菜单', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 1366, height: 850 });
  try {
    const page = await game.open();
    const loaded = [];
    page.on('response', res => {
      const pathname = new URL(res.url()).pathname;
      if (res.ok() && pathname.includes('/battle-textures/')) loaded.push(pathname.split('/').at(-1));
    });
    await deploy(page, 38, 17);
    assert.deepEqual(loaded.sort(), ['court-stone.webp', 'road-earth.webp', 'water-ripples.webp', 'woods-floor.webp']);
    const depthColor = await page.evaluate(() => {
      const w = window.__game.war, sea = w.scene.children.find(mesh => mesh.userData.water);
      const colors = sea.geometry.attributes.color.array;
      return { variation: colors[0] !== colors[16] || colors.some((value, i) => value !== colors[i % 3]),
        ripple: sea.material.map.image.naturalWidth, sprites: !!w.scene.children.find(mesh => mesh.userData.woods)?.count };
    });
    assert.deepEqual(depthColor, { variation: true, ripple: 384, sprites: true });
    const zones = page.getByRole('group', { name: '布阵区' }), system = page.locator('.sysmenu-btn');
    for (const [width, height] of [[1366, 850], [960, 600]]) {
      await page.setViewportSize({ width, height });
      const frame = await system.boundingBox(), group = await zones.boundingBox();
      assert.ok(group.y >= frame.y + frame.height && group.y + group.height < height);
      await zones.getByRole('button', { name: '侧翼小湾' }).click();
      await zones.getByRole('button', { name: '主登陆滩' }).click();
    }
    assert.equal(await page.evaluate(() => window.__game.war.st.deploying), true);
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('新材质加载失败时，仍可使用既有贴图进入桌面战场并完成布阵', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 1280, height: 800 });
  try {
    const page = await game.open('', { setup: context => context.route('**/battle-textures/*.webp', route => route.abort()) });
    await deploy(page, 30, 13);
    assert.equal(await page.evaluate(() => {
      const w = window.__game.war, sea = w.scene.children.find(mesh => mesh.userData.water);
      return !w.flat && sea.material.map.image.naturalWidth > 0;
    }), true);
    await page.getByRole('button', { name: '布阵完成' }).click();
    await page.waitForFunction(() => !window.__game.war.st.deploying);
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('三维战场开场及布阵完成后聚焦可控武将，滚轮、键盘和全图可连续切换', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 1280, height: 800 });
  try {
    const page = await game.open();
    await deploy(page, 32, 13);
    const read = () => page.evaluate(() => {
      const w = window.__game.war, u = w.field.side('att').find(u => u.commander);
      return { ...w.viewState(), unit: w.screenOf(u.x, u.y), selected: w.st.sel?.id ?? null, day: w.field.day };
    });
    await warRest(page);
    const opening = await read();
    assert.equal(opening.zoom, 'mid');
    assert.ok(opening.unit.x > 425 && opening.unit.x < 990 && opening.unit.y > 150 && opening.unit.y < 615);
    assert.ok(opening.selected != null);
    assert.equal(await page.getByRole('group', { name: '布阵区' }).getByRole('button').count(), 4);
    for (const [width, height] of [[860, 650], [960, 600]]) {
      await page.setViewportSize({ width, height });
      for (const name of ['缩小战场', '放大战场', '战场全图']) {
        await page.getByRole('button', { name }).click({ trial: true });
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await warRest(page);
    const tower = await page.evaluate(() => {
      const w = window.__game.war, { x,y } = w.field.approaches.post, probe = w.probe();
      const scene = w.scene.getObjectByName('battle-approaches');
      const pennant = scene.children.find(mesh => mesh.isInstancedMesh && mesh.material.color.getHexString() === 'a74432');
      return pennant?.instanceMatrix.array[13] - probe.top(x,y);
    });
    assert.ok(tower > 1.1, '三维哨楼有高于底座的旗帜');
    await page.getByRole('button', { name: '布阵完成' }).click();
    await warRest(page);
    assert.equal((await read()).zoom, 'mid');
    assert.equal((await read()).selected, null);

    await page.mouse.move(780, 335);
    await page.mouse.wheel(0, -120);
    await warRest(page);
    const near = await read();
    assert.equal(near.zoom, 'near');
    assert.ok(near.dist < opening.dist);
    await page.getByRole('button', { name: '缩小战场' }).click();
    await warRest(page);
    assert.equal((await read()).zoom, 'mid');
    await page.getByRole('button', { name: '战场全图' }).click();
    await warRest(page);
    assert.equal((await read()).tactical, true);
    await page.keyboard.press('=');
    await warRest(page);
    assert.equal((await read()).tactical, false);
    assert.equal((await read()).zoom, 'far');
    await page.keyboard.press('c');
    await warRest(page);
    const reset = await read();
    assert.equal(reset.zoom, 'mid');
    assert.equal(reset.day, 1);
    assert.ok(Math.abs(reset.unit.x - opening.unit.x) < 40 && Math.abs(reset.unit.y - opening.unit.y) < 110);
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});

test('手机平面战场先看主将，四角可定位，双指和缩放按钮可放大及还原全图', { timeout: 120000 }, async () => {
  const game = await startGame({ scenario, width: 844, height: 390, touch: true });
  try {
    const page = await game.open('&phone&flat&safe=24,24,6,12');
    await deploy(page, 11, 14);
    const zones = page.getByRole('group', { name: '布阵区' });
    const zoom = page.getByRole('group', { name: '战场缩放' });
    await page.setViewportSize({ width: 568, height: 320 });
    for (const group of [zones, zoom]) {
      for (const button of await group.getByRole('button').all()) await button.click({ trial: true, timeout: 5000 });
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => {
      const w = window.__game.war, u = w.field.side('att')[0], at = w.screenOf(u.x, u.y);
      return Math.abs(at.x - 422) < 28 && Math.abs(at.y - 175.5) < 28;
    }, null, { timeout: 5000 });
    const read = () => page.evaluate(() => {
      const w = window.__game.war, u = w.field.side('att')[0], last = w.field.dep.attackerZones.at(-1).anchor;
      return [w.screenOf(u.x,u.y), w.screenOf(...last)];
    });
    const [first] = await read();
    await zones.getByRole('button').last().tap();
    const [, corner] = await read();
    assert.ok(Math.abs(corner.x - 422) < 28 && Math.abs(corner.y - 175.5) < 28);
    const touch = await page.context().newCDPSession(page);
    const drag = async (from, to) => {
      const points = d => [{ x: 422 - d, y: 154, id: 1 }, { x: 422 + d, y: 154, id: 2 }];
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(to) });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await drag(36, 54);
    const [large] = await read();
    assert.ok(large.cw > corner.cw * 1.15);
    await drag(54, 30);
    const [smaller] = await read();
    assert.ok(smaller.cw < large.cw * 0.85);
    await page.getByRole('button', { name: '战场全图' }).tap();
    const [overview] = await read();
    assert.ok(overview.cw < first.cw * 0.75);
    await page.getByRole('button', { name: '放大战场' }).tap();
    assert.ok((await read())[0].cw > overview.cw);
    assert.deepEqual(page.errors, []);
  } finally { await game.close(); }
});
