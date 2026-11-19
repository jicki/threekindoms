// The war map's play (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): the march, the charge and the recoil,
// the 计略 and its show, the 升级 told, the day tick's 奇门遁甲, the win check, the AI's turn and the loop of turns.
// fx2d and endHuman are reassigned here (the flat map's effects list, the human turn's resolver): they are wv.fx2d and
// wv.endHuman, never copied; done is interact.js's, read and written as wv.done.
import * as THREE from 'three';
import { W, H, STRATS, stratCount } from '../core/field.js';
import { slash, sparkBurst, dustPuff, STRATEGY_FX, levelUp } from '../fx.js';
import { name, cityName, takeLevelUps, DEAD } from '../core/game.js';
import { playVignette, warmVignette } from '../vignette.js';
import { ORIGINAL, paced, hold as holdBeat } from '../pace.js';
import { stage } from '../commitguard.js';
import { tween, STRAT_SCENE, STRAT_CUE, STRAT_FX, STRAT_FX_SOUND } from './shared.js';
import { SKILL_VISUALS } from '../core/skill-visuals.js';

// 旧版新增计策没有专属演出配置，按名称选用与计策含义相符的原版演出。
// 管理员自行添加的计策则按效果类型回退，避免一律出现火焰和火计音效。
const CUSTOM_STRATEGY_SCENES = {
  '八阵奇谋': 15, '赤壁谋火': 14, '公台奇谋': 3, '胡笳扰阵': 2,
  '坚城奇策': 13, '奉孝奇策': 3, '鹰视守谋': 15, '宪英明鉴': 2,
  '幽骑冲阵': 3, '淮南筹策': 3, '荆襄固阵': 10, '长史守谋': 15,
  '阎象明策': 2, '异度奇谋': 2,
};
function strategySceneId(strategy) {
  if (!strategy.custom) return strategy.id;
  const sourceName = strategy.legacyName ?? strategy.name;
  if (Object.hasOwn(CUSTOM_STRATEGY_SCENES, sourceName)) return CUSTOM_STRATEGY_SCENES[sourceName];
  if (strategy.name.includes('火')) return 0;
  if (strategy.stop) return 2;
  if (strategy.hp) return 1;
  return 3;
}
function strategyVisual(strategy) {
  return Object.hasOwn(SKILL_VISUALS, strategy.visualEffect) ? SKILL_VISUALS[strategy.visualEffect] : null;
}
function warmStrategy(id) {
  const s = STRATS[id];
  warmVignette(strategyVisual(s)?.scene ?? STRAT_SCENE[strategySceneId(s)]);
}

export function makePlay(wv) {
  const { ctx, field, audio, ui, human, scene, wx, wz, topY, terr, views, place, removeGone, drop, addUnit, FIGURE, clearMarks, view, focusOn, followPoint,
    st, hud, sideLabel, showOptions, select, lastCast, showDeploy, refuse } = wv;
  // While the field plays something out, the unit panel's commands are greyed: a menu opened then would act on
  // a pool and a board that are about to change.
  const lock = () => { st.busy = true; showOptions(); };

  // A march the way grid tactics games ride it: straight from cell centre to cell centre, the corners cut by
  // a small arc so the position never jerks, and the figure turned once, at the corner, to the next leg's
  // heading (a curve through the centres swept the heading through the camera's axis at every corner, so the
  // front or back view flashed for a few frames, and a staircase route kept him swinging). Even pace with a
  // short ramp at each end. One stride (STRIDE cells, the strip's four walk frames) carries two footfalls:
  // the bob, the hoofbeat and the dust all fall on them, so nothing drifts against the legs. The picture is
  // not tilted or squashed while it rides. The camera follows the rider.
  const STRIDE = 1.6, PACE = 190, CORNER = 0.22, RAMP = 90;
  const right = new THREE.Vector3(), tan = new THREE.Vector3();
  let footfallAt = -Infinity;
  function faceToward(v, dir) { v.heading.copy(dir).setY(0).normalize(); pose(v); }
  // Pick the facing (and walk frame) from the heading in camera space: within ~35° of the camera is the
  // three-quarter front, within ~35° of straight away the three-quarter back, otherwise the side profile;
  // leftward headings mirror the sprite. v.face is ±1 only in profile (it drives the sideways lean).
  const toCam = new THREE.Vector3();
  function pose(v) {
    // 平面地图固定朝北绘制，不随三维相机旋转；按它自己的视角选择正、背和侧面帧。
    const yaw = wv.flat ? 0 : view.yaw;
    right.set(Math.cos(yaw), 0, -Math.sin(yaw)); toCam.set(Math.sin(yaw), 0, Math.cos(yaw));
    const hx = v.heading.dot(right), hz = v.heading.dot(toCam), ang = Math.atan2(Math.abs(hx), hz);
    if (Math.abs(hx) > 0.08) v.flip = Math.sign(hx);
    if (!v.frames) { v.face = v.flip; v.body.scale.x = v.flip; return; }
    const row = ang < 0.6 ? 'front' : ang > 2.55 ? 'back' : 'side';
    v.face = row === 'side' ? v.flip : 0; v.body.scale.x = v.flip;
    // One stride per STRIDE cells: the generic sheets walk stand → walk_1..3, the star officers' strips walk_1..4.
    const gait = v.frames.includes(`${row}_walk_4`) ? ['walk_1', 'walk_2', 'walk_3', 'walk_4'] : ['stand', 'walk_1', 'walk_2', 'walk_3'];
    const col = v.walk ? gait[Math.floor(v.stride / STRIDE * 4) % 4] : 'stand';
    const f = v.frames.indexOf(`${row}_${col}`);
    if (f !== v.frame) { v.frame = f; v.tex.offset.x = f / v.frames.length; v.ntex.offset.x = v.tex.offset.x; }
  }
  // perCell given: exactly that long per cell (the enemy's march keeps its own timeline). Left out: PACE per
  // cell, the cells past the fourth at 0.7 of it so a long ride doesn't drag.
  async function moveAlong(u, path, { perCell = null, follow = true, sound = true, minMs = 260, settleMs = 180 } = {}) {
    const v = views.get(u);
    if (!path.length) return place(u);
    const pts = [v.g.position.clone()];
    for (const [x, y] of path) { const q = new THREE.Vector3(wx(x), topY(x, y), wz(y)); if (q.distanceTo(pts[pts.length - 1]) > 1e-3) pts.push(q); }
    if (pts.length < 2) return place(u);
    const n = path.length, legs = [], at = [0];
    for (let i = 1; i < pts.length; i++) { const dir = pts[i].clone().sub(pts[i - 1]), l = dir.length(); legs.push({ dir: dir.divideScalar(l), flat: dir.clone().setY(0).normalize(), l }); at.push(at[i - 1] + l); }
    const len = at[at.length - 1], ms = Math.max(minMs, perCell != null ? perCell * n : PACE * (n <= 4 ? n : 4 + (n - 4) * 0.7)), ramp = Math.min(RAMP, ms / 4);
    const turns = (i) => i > 0 && i < legs.length && legs[i - 1].flat.dot(legs[i].flat) < 0.99; // a corner at pts[i]
    const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    let beat = 0, i = 0;
    v.moving = v.walk = true; v.stride = 0;
    await tween(ms, (k) => {
      // Trapezoid pace: `ramp` ms up to speed, level, `ramp` ms down.
      const t = k * ms, run = t < ramp ? t * t / (2 * ramp) : t > ms - ramp ? ms - ramp - (ms - t) ** 2 / (2 * ramp) : t - ramp / 2;
      const dist = len * run / (ms - ramp), speed = Math.min(1, t / ramp + 0.25, (ms - t) / ramp + 0.25);
      while (i < legs.length - 1 && dist > at[i + 1]) i++;
      const leg = legs[i], s = dist - at[i];
      p.copy(pts[i]).addScaledVector(leg.dir, Math.min(s, leg.l));
      // Within the corner's reach on either side the point rides a quadratic arc past the corner cell's centre.
      const c = turns(i + 1) && leg.l - s < CORNER ? i + 1 : turns(i) && s < CORNER ? i : 0;
      if (c) {
        const q = (dist - at[c] + CORNER) / (2 * CORNER);
        a.copy(pts[c]).addScaledVector(legs[c - 1].dir, -CORNER); b.copy(pts[c]).addScaledVector(legs[c].dir, CORNER);
        p.copy(a).multiplyScalar((1 - q) ** 2).addScaledVector(pts[c], 2 * q * (1 - q)).addScaledVector(b, q * q);
      }
      v.stride = dist; faceToward(v, leg.flat);
      v.g.position.copy(p);
      v.bill.position.y = Math.abs(Math.sin(dist / STRIDE * Math.PI * 2)) * 0.045 * speed;
      if (dist >= beat * STRIDE / 2) {
        beat++;
        const now = performance.now();
        // 采样已含连续蹄声，避免多队或高速行军时密集叠加。
        if (sound && now - footfallAt >= 300) { footfallAt = now; audio.sfx('sfx-war-march'); }
        burst('dust', p.clone().setY(p.y + 0.08).addScaledVector(leg.flat, -0.3), { size: 0.35 });
      }
      if (follow) followPoint(p);
    });
    // Land on this path's last cell, not wherever the unit stands logically by now (later steps may be queued).
    const [ex, ey] = path[path.length - 1]; v.g.position.set(wx(ex), topY(ex, ey), wz(ey));
    // Settle: he reins in, the standing frame, one small sink onto the hooves.
    v.walk = false; v.bill.position.y = 0;
    await tween(settleMs, (k) => { v.body.scale.y = 1 - 0.022 * Math.sin(k * Math.PI); });
    v.body.scale.y = 1; v.moving = false;
  }
  // A short charge toward the target and back before the 白兵 opens; a struck unit flashes and recoils.
  // Every effect set off in the scene (sparks, dust, slashes, each 计略's flames, rings, streaks …, src/fx.js) is
  // also listed for the flat map (src/warmap2d.js), which draws its own over the painted board.
  wv.fx2d = [];
  scene.userData.flatFx = (kind, at, o) => {
    wv.fx2d.push({ kind, x: at.x + W / 2 - 0.5, y: at.z + H / 2 - 0.5, h: at.y, ...o, t: performance.now() / 1000, seed: (Math.random() * 1e9) | 0 });
    if (wv.fx2d.length > 160) wv.fx2d.splice(0, wv.fx2d.length - 160);
  };
  function burst(kind, at, { n = 40, color = '#ffd070', size = 1 } = {}) {
    if (kind === 'spark') sparkBurst(scene, at, n, color); else if (kind === 'dust') dustPuff(scene, at, size); else slash(scene, at, false, size);
  }
  // The day's loss rises from the trapped one's own tag (a child of it, so it rides wherever declutter() lifts the tag and
  // never lands on a neighbour's), over his head; on the flat map a 'num' effect drawn under that unit's plaque. It
  // lasts 0.9 s at 1×, less at the faster paces, so it is gone before the next group.
  // A 计略's outcome rises the same way (feedback R07, 2026-11-02): `text` in place of the bare loss, held `hold` ms at 1×.
  function lossNum(u, loss, { text = `−${loss}`, hold = 900, gain = false } = {}) {
    const v = views.get(u); if (!v) return;
    const ms = paced(hold), el = Object.assign(document.createElement('div'), { className: `lossnum${gain ? ' gain' : ''}`, textContent: text });
    el.style.animationDuration = `${ms}ms`; v.el.append(el);
    setTimeout(() => el.remove(), ms);
    scene.userData.flatFx('num', v.g.position.clone().setY(FIGURE + 0.1), { text, color: gain ? '#ffd860' : '#ff6a5a', ms, u });
  }
  // 升级 (bank12 $A5FD after the player's 计略, bank13 $C6EA for both generals after a 白兵 and its 单挑, research/
  // experience-evidence.md §5): each of the player's generals who went up since the last telling, one after another.
  // The original stops the theme for phrase 123 and opens a window the player closes: 「…升级了」, with 「武力提升了N」
  // when 武力 rose; a 谋士 whose new level opens more 计略 then gets 「学会了新的计略」 (message 4B). The remake adds
  // the light on the board and the new level rising over him. Generals of the other side go up unannounced.
  async function tellLevelUps(order = []) {
    const rank = (lu) => (order.includes(lu.id) ? order.indexOf(lu.id) : order.length);
    for (const lu of takeLevelUps(field.g).sort((x, y) => rank(x) - rank(y))) {
      const u = field.units.find((x) => x.id === lu.id), v = u && views.get(u), o = field.O(lu.id);
      if (!u || u.side !== human || u.gone || o.status === DEAD) continue;
      if (v) {
        focusOn(u);
        const at = v.g.position.clone(); at.y += 0.8; levelUp(scene, at);
        tween(1100, (k) => { v.body.material.emissive.set('#ffcf70'); v.body.material.emissiveIntensity = 0.45 * Math.sin(Math.PI * Math.min(1, k * 1.6)) ** 2; })
          .then(() => { v.body.material.emissive.set('#ffffff'); v.body.material.emissiveIntensity = 0; });
        lossNum(u, 0, { text: `等级 ${lu.to}`, hold: 1800, gain: true });
        wv.tag(u);
      }
      if (!audio.cue('cue-levelup')) audio.sfx('sfx-levelup');
      if (v) await holdBeat(650); // the light first, then the window over it
      const gain = lu.war - lu.warFrom;
      ui.log(`<strong>${name(lu.id)}升至等级 ${lu.to}</strong>${gain ? `，武力 ${lu.warFrom}→${lu.war}` : ''}`);
      await ui.levelUp?.({ id: lu.id, from: lu.from, to: lu.to, warFrom: lu.warFrom, war: lu.war });
      const was = stratCount(lu.id, { ...o, level: lu.from }), now = stratCount(lu.id, o);
      if (now > was) {
        const learnt = STRATS.slice(was, now).map((S) => S.name);
        ui.log(`${name(lu.id)}学会了新的计略：${learnt.join('、')}`);
        await ui.learnStrategies?.({ id: lu.id, names: learnt });
      }
    }
  }
  // The day tick's 奇门遁甲 (field.endTurn): the trapped within four cells of the first are shown together, the view
  // framed on him, the stones flaring and each one's loss rising; 0.8 s a group, Enter moves on.
  async function qimenBeat(list) {
    const rest = list.filter((x) => views.get(x.u));
    while (rest.length) {
      const lead = rest[0].u, group = rest.filter(({ u }) => Math.max(Math.abs(u.x - lead.x), Math.abs(u.y - lead.y)) <= 4);
      for (const x of group) rest.splice(rest.indexOf(x), 1);
      if (!group.some((x) => x.loss > 0)) continue; // nothing lost here: no flare, no sound, no wait
      focusOn(lead);
      for (const { u, loss } of group) {
        const at = views.get(u).g.position.clone(); at.y += 0.8;
        STRATEGY_FX.qimen(scene, at);
        if (loss > 0) { lossNum(u, loss); ui.log(`${name(u.id)}困于石阵，折兵${loss}`); }
        wv.tag(u);
      }
      audio.sfx('sfx-clash');
      await holdBeat(800);
    }
  }
  async function lunge(a, d) {
    const v = views.get(a), from = v.g.position.clone(), dir = new THREE.Vector3(wx(d.x) - wx(a.x), 0, wz(d.y) - wz(a.y)).normalize();
    faceToward(v, dir); v.moving = true;
    await tween(170, (k) => { const e = k * k; v.g.position.copy(from).addScaledVector(dir, 0.38 * e); v.bill.rotation.z = -v.face * 0.14 * e; });
    await tween(220, (k) => { const e = 1 - (1 - k) * (1 - k); v.g.position.copy(from).addScaledVector(dir, 0.38 * (1 - e)); v.bill.rotation.z = -v.face * 0.14 * (1 - e); });
    v.g.position.copy(from); v.bill.rotation.z = 0; v.moving = false;
  }
  function recoil(t, from) {
    const v = views.get(t); if (!v) return;
    const p0 = v.g.position.clone(), dir = from ? new THREE.Vector3(wx(t.x) - wx(from.x), 0, wz(t.y) - wz(from.y)).normalize() : new THREE.Vector3();
    tween(360, (k) => { const b = Math.sin(k * Math.PI) * (1 - k * 0.5); v.g.position.copy(p0).addScaledVector(dir, 0.16 * b); v.body.material.emissiveIntensity = 0.9 * (1 - k); })
      .then(() => { if (!t.gone) place(t); v.body.material.emissiveIntensity = 0; });
  }
  async function playAttack(a, d, res) {
    ui.log(`${name(a.id)} 攻击 ${name(d.id)}`);
    const ready = ctx.prepareSkirmish?.(res);
    await lunge(a, d);
    await ctx.onSkirmish(a, d, res, terr(d.x, d.y), ready);
    ui.log(`　${name(d.id)} 损兵 ${res.lossD}，${name(a.id)} 损兵 ${res.lossA}`);
    for (const [u, info] of [[a, res.a], [d, res.d]]) {
      if (info.fate === 'dead') ui.log(`　<em>${name(u.id)} 阵亡</em>`);
      if (info.fate === 'captured') ui.log(`　<em>${name(u.id)} 被俘</em>`);
      if (info.fate === 'defected') { ui.log(`　<em>${name(u.id)} 转投${sideLabel(u.side)}</em>`); drop(views.get(u).g); views.delete(u); addUnit(u); }
      wv.tag(u);
    }
    if (res.duel?.retreated) ui.log(`　${name(res.duel.retreated)} 从单挑中退却`);
    removeGone();
    await tellLevelUps([a.id, d.id]); // back on the war map, attacker then defender (bank13 $C69F)
  }

  // 布阵 (6.7 §6.5): the human side may move each unit to any free cell inside its rectangle, any terrain.
  const rect = human ? (human === 'att' ? field.dep.attacker_rect : field.dep.defender_rect) : null;
  async function castOn(u, id, t, count = 1) {
    if (st.busy) return;
    if (!field.canCast(u, id, t)) return refuse(u, id);
    lock(); st.last = null;
    const results = field.castMany(u, id, t, count);
    const res = count === 1 ? results[0] : { ...results[0], batch: true, hit: results.some((r) => r.hit), hits: results.flatMap((r) => r.hits), lines: [...results.flatMap((r, i) => [`第${i + 1}次：${r.hit ? '成功' : '失败'}`, ...r.lines]), ...(results.length < count ? [`执行${results.length}次后因战场状态或施计条件变化而停止`] : [])] };
    lastCast.set(u, { id, t });
    await playStrategy(u, t, id, res);
    // The 计略 is done and he stays selected, his commands back in his card, as after an attack: 再施 (X), a move or another 计略
    // follow without picking him again (2026-11-14; they used to be put away with the cast).
    // The input that closed the result acts on nothing here (stage()); he is let go only if he left the field or the war is over.
    st.busy = false; if (u.gone || field.over || field.turn !== human) st.sel = null; else if (count > 1 && field.canCast(u, id, t)) st.cast = id; stage(); showOptions(); hud(); check();
  }
  async function playStrategy(u, t, id, res) {
    const name0 = STRATS[id].name;
    const visualId = strategySceneId(STRATS[id]);
    const visual = strategyVisual(STRATS[id]);
    ui.log(`${name(u.id)} 施展<strong>${name0}</strong>${t ? `→${name(t.id)}` : ''}`);
    const cue = () => { if (!audio.cue(visual?.cue ?? STRAT_CUE[visualId])) audio.sfx('sfx-horn'); }; // its phrase, then the war theme from the top (T13)
    // The player has just picked the target on the view he has and keeps it; an enemy's 计略 is shown to him (devblog #96, 2026-11-03).
    if (u.side !== human) focusOn(t || u);
    // The original's beats (src/pace.js): the cast animation names the 计略 and plays its phrase, then a window
    // tells what it did while the effect lands on the board, then the board has the rest of the 3.48 s. Without
    // the picture (演出 off) a banner stands in for the cast.
    const shown = await playVignette({ scene: visual?.scene ?? STRAT_SCENE[visualId], caption: `${name(u.id)}的${name0}……`, audio, assetWait: 1200, duration: paced(ORIGINAL.strategyShow), onShow: cue, part: res.hit ? undefined : 'attempt' }); // a 计略 that fails stops short of the outcome
    if (!shown) { cue(); await ui.stratBanner?.(name0); }
    const t0 = performance.now(); // the window and the board keep the original's time after the show, however long it ran
    // The face the original's window wears (bank 12 $AACD / $AAE5, bank 13 $C0B6 / $C0C0): the player's caster, 喜 when
    // it works and 忧 when it fails; an enemy's 计略 is told by the one it was aimed at, the other way round.
    const mine = u.side === human, who = mine ? u.id : t?.id ?? res.hits?.[0]?.u.id ?? null;
    const told = ui.stratResult?.(name0, res.hit || res.batch ? res.lines.join('<br>') : mine ? '计略失败了，非常抱歉。' : `${name0}失败了。`, who, res.hit === mine ? 'joy' : 'grief');
    const v = t && views.get(t);
    let effectSound = null;
    if (v && res.hit) {
      const at = v.g.position.clone(); at.y += 0.8;
      const fx = visual?.fx ?? STRAT_FX[visualId];
      STRATEGY_FX[fx](scene, at);
      effectSound = STRAT_FX_SOUND[fx] ?? 'sfx-clash'; audio.sfx(effectSound);
    }
    // 有实际损兵时同步给出受击声；本身已使用碰撞声的计略不重复叠加。
    if (res.hit && res.hits.some((h) => h.soldiers < 0) && effectSound !== 'sfx-clash') audio.sfx('sfx-clash');
    if (res.hit) for (const h of res.hits) recoil(h.u, u);
    // What each one lost rises over him, one line a unit (落石 takes 体力 and soldiers at once): 兵 bare, 体 and 米 named.
    const lost = new Map();
    for (const h of res.hits) if (h.hp || h.rice || h.soldiers) lost.set(h.u, [...(lost.get(h.u) ?? []), h.hp ? `体−${-h.hp}` : h.rice ? `米−${-h.rice}` : `−${-h.soldiers}`]);
    for (const [v, l] of lost) lossNum(v, 0, { text: l.join('　'), hold: 1600 });
    for (const l of res.lines) ui.log(`　${l}`);
    for (const h of res.hits) if (views.get(h.u)) wv.tag(h.u);
    if (res.hit) for (const [x, vw] of views) if (!x.gone && vw.g.parent && x.stop > 0) wv.tag(x); // 虚兵 / 连环 hold with no loss to report: their tags say so now
    if (id === 8 && res.hit && t) { drop(views.get(t).g); views.delete(t); addUnit(t); }
    await told;
    await new Promise((r) => setTimeout(r, Math.max(0, paced(ORIGINAL.strategy - ORIGINAL.strategyCast) - (performance.now() - t0))));
    removeGone();
    await tellLevelUps();
  }
  function check() { if (field.over && wv.done) { const d = wv.done; wv.done = null; clearMarks(); setTimeout(() => d(field.over), 900); } }

  // The AI takes its turn one cell at a time, unit after unit (the original dispatcher, 10 frames a cell).
  // Runs of plain steps are gathered and played as one march with the camera on the group, so the camera
  // never swings between units every cell. The march keeps the rotation's own timeline: step k of the run
  // falls at k step-times, and each unit walks its cells in one smooth stroke from its first step's time to
  // its last one's, so the order stays readable and the run lasts as many step-times as it has steps.
  // A step that springs an ambush or takes the castle joins the march as its last cell and the march plays
  // out at once, so the event lands as the unit arrives. Anything else (an attack, a 计略, a retreat) first
  // plays the march so far, then itself.
  async function aiSide(s) {
    ui.log(`—— 第${field.day}日 ${sideLabel(s)}行动 ——`);
    const march = new Map(); let steps = 0; // u → { path, first, last } (step indices in the run)
    const flush = async () => {
      if (!march.size) return;
      const legs = [...march].map(([u, m]) => [u, m.path, m.first, m.last]); march.clear(); steps = 0;
      const c = legs.reduce((a, [u]) => a.add(new THREE.Vector3(wx(u.x), 0, wz(u.y))), new THREE.Vector3()).divideScalar(legs.length);
      followPoint(c);
      const T = paced(ORIGINAL.move);
      await Promise.all(legs.map(([u, path, first, last]) => new Promise((r) => setTimeout(r, first * T))
        .then(() => moveAlong(u, path, { perCell: ((last - first + 1) * T) / path.length, minMs: T, settleMs: Math.min(180, T), follow: false }))));
      hud();
    };
    for (const act of field.aiActions(s)) {
      if (act.type === 'move') {
        const m = march.get(act.u) || { path: [], first: steps }; m.path.push(...act.path); steps += act.path.length; m.last = steps - 1; march.set(act.u, m);
        if (!field.lastAmbush && !field.over) continue;
        await flush();
        const amb = field.lastAmbush;
        if (amb) { ui.log(`<em>${name(act.u.id)}中了${name(amb.by.id)}的十面埋伏！损兵 ${amb.damage}</em>`); audio.sfx('sfx-clash'); STRATEGY_FX.encircle(scene, views.get(act.u).g.position.clone().setY(1)); wv.tag(act.u); field.lastAmbush = null; await ui.stratResult?.('十面埋伏', `伏兵发动奇袭，敌兵减少了 ${amb.damage} 人。`, amb.by.id, 'joy'); await tellLevelUps(); }
      }
      else {
        await flush();
        if (act.type === 'attack') { focusOn(act.a); await playAttack(act.a, act.d, act.res); }
        else if (act.type === 'retreat') { ui.log(`${name(act.u.id)} 退往${cityName(act.city)}`); removeGone(); }
        else if (act.type === 'strategy') await playStrategy(act.u, act.t, act.id, act.res);
        else if (act.type === 'mission') { ui.log(`${name(act.u.id)} 进村${act.kind === 'rice' ? '买米' : '求医'}：${act.log.join('，') || '金不足'}`); wv.tag(act.u); }
      }
      hud();
      if (field.over) break;
    }
    await flush();
  }
  // Drives both sides until the war ends; the human side waits for endTurn().
  wv.endHuman = undefined;
  async function loop() {
    if (human && rect && !field.resumed) { // a suspended war taken up again (src/core/suspend.js) was deployed before it stopped
      st.deploying = true; hud(); ui.deploy?.(true);
      const first = field.side(human)[0]; if (first) { focusOn(first); st.sel = first; }
      showDeploy();
      await new Promise((res) => (wv.endDeploy = res));
      ui.deploy?.(false);
    }
    while (!field.over) {
      if (field.turn === human) {
        ui.log(`—— 第${field.day}日 ${sideLabel(human)}行动 ——`); // silent, as in the original (D43: no war-start phrase each day)
        // The camera turns to the commander but no one is selected: with him selected, a click that missed another
        // general landed on an empty cell in his reach and marched him off (player feedback, 2026-11-03).
        const first = field.side(human).find((u) => u.commander) || field.side(human)[0];
        if (first) focusOn(first);
        select(null);
        hud(); stage(); // our day begins: a key held through the enemy's turn (or a report closed on it) does not end it (src/commitguard.js)
        await new Promise((res) => (wv.endHuman = res));
        st.last = null; select(null);
      } else { st.busy = true; await aiSide(field.turn); st.busy = false; }
      if (field.over) break;
      // The day tick changes soldiers off screen (奇门遁甲's daily loss, the day's recovery): every tag is redrawn
      // from the rules, or it kept the old 兵 under a tip that told the new one (playtest of 2026-10-30).
      const tick = field.endTurn(); if (tick?.qimen.length) { st.busy = true; try { await qimenBeat(tick.qimen); await tellLevelUps(); } finally { st.busy = false; } } // the player waits it out (Enter skips)
      for (const u of field.alive) if (views.get(u)) wv.tag(u); hud();
    }
    check();
  }
  function endTurn() { if (st.busy || st.confirm || st.strike || field.turn !== human || !wv.endHuman) return; st.peek = null; const f = wv.endHuman; wv.endHuman = null; f(); }
  return { lock, faceToward, pose, moveAlong, burst, lossNum, tellLevelUps, qimenBeat, lunge, recoil, playAttack, rect, castOn, playStrategy, warmStrategy, check, aiSide, loop, endTurn };
}
