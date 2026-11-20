import { h } from './ui.js';
import { duelMotionClip, duelMotionUnit, resolveDuelPose } from './duelview.js';
import { tacticalMotionClip } from './tacticalview.js';
import { BOW_CLIP } from './weapon-motion.js';

const SCENES = { march: '行军', tactical: '白兵', duel: '单挑' };
const WIDTH = 340, HEIGHT = 164, GROUND = 147;

function motionSequence(scene, { strip: { meta }, style }) {
  if (!meta) return [];
  if (scene === 'march') return meta.frames.filter(frame => frame.startsWith('side_walk_')).map(frame => [frame, 130]);
  if (scene === 'tactical') {
    const action = style === 'bow' ? meta.clips.bow ? 'bow' : meta.clips.volley ? 'volley' : 'attack' : 'attack';
    return tacticalMotionClip(meta, action);
  }
  return style === 'bow' ? BOW_CLIP : duelMotionClip(meta, 'attack');
}

function poseOf(strip, scene, frame) {
  if (!strip.meta || scene !== 'duel') return [strip, frame];
  const cards = [strip.turn, strip.wheel, strip.extra].filter(Boolean);
  const pose = resolveDuelPose(name => strip.meta.frames.includes(name) || cards.some(card => card.meta.frames.includes(name)), frame);
  return [cards.find(card => card.meta.frames.includes(pose)) ?? strip, pose];
}

function paint(ctx, scene, { strip, style }, frame, face, progress, impact) {
  const [source, pose] = poseOf(strip, scene, frame);
  const { tex: { image }, meta } = source;
  const [w, h] = meta?.cell ?? [image.width, image.height];
  const scale = Math.min(177 / w, 140 / h, strip.meta
    ? scene === 'duel' ? duelMotionUnit(strip.meta) * 52 : 106 / (strip.meta.standHeight ?? strip.meta.figH)
    : 106 / h);
  const index = Math.max(0, meta?.frames.indexOf(pose) ?? 0), cols = meta?.atlasCols ?? meta?.frames.length ?? 1;
  const moving = scene === 'march' ? (progress - 0.5) * 130 : style === 'bow' ? 0 : Math.sin(progress * Math.PI) * 44;
  const x = WIDTH / 2 + (moving - (scene === 'march' ? 0 : 49)) * face;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#c2a37930';
  ctx.fillRect(15, GROUND, WIDTH - 30, 1);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, GROUND + (meta?.base?.[pose] ?? 0) * scale);
  const mirror = source === strip || source === strip.extra || source === strip.wheel ? face : 1;
  ctx.scale(mirror, 1);
  ctx.drawImage(image, index % cols * w, Math.floor(index / cols) * h, w, h, -(meta?.anchor ?? w / 2) * scale, -h * scale, w * scale, h * scale);
  ctx.restore();
  if (!impact || (style !== 'bow' && style !== 'fan')) return;
  const y = GROUND - 58, reach = impact * 94;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(face, 1);
  ctx.strokeStyle = style === 'bow' ? '#ffe7a0' : '#dcebc0';
  ctx.lineWidth = style === 'bow' ? 2 : 4;
  ctx.beginPath();
  if (style === 'bow') {
    ctx.moveTo(30 + reach, -4); ctx.lineTo(56 + reach, 0); ctx.lineTo(50 + reach, -5);
    ctx.moveTo(56 + reach, 0); ctx.lineTo(49 + reach, 3);
  } else {
    ctx.globalAlpha = 1 - impact;
    ctx.ellipse(50 + reach / 4, 0, 44, 18, -0.24, -1.3, 1.4);
  }
  ctx.stroke();
  ctx.restore();
}

export function officerMotionPreview(load, summary) {
  const canvas = h('canvas', { width: WIDTH, height: HEIGHT, role: 'img' });
  const ctx = canvas.getContext('2d');
  const status = h('p', { class: 'hint', role: 'status' });
  let scene, motion, face = 1, revision = 0, ticker = 0;
  const stop = () => { cancelAnimationFrame(ticker); ticker = 0; };
  const still = () => {
    if (motion) paint(ctx, scene, motion, scene === 'march' ? 'side_stand' : 'idle_a', face, scene === 'march' ? 0.5 : 0, 0);
  };
  const play = h('button', { class: 'btn primary', disabled: true, onclick: () => {
    const clip = motionSequence(scene, motion);
    if (!clip.length) return;
    stop();
    const total = clip.reduce((ms, [, duration]) => ms + duration, 0);
    const start = performance.now();
    let time = 0, impactAt = Infinity;
    for (const [, duration, event] of clip) {
      if (event === 'loose' || event === 'hit') { impactAt = time + (event === 'loose' ? 0 : duration); break; }
      time += duration;
    }
    const end = Number.isFinite(impactAt) && ['bow', 'fan'].includes(motion.style) ? Math.max(total, impactAt + 260) : total;
    const tick = (now) => {
      if (!canvas.isConnected) return;
      const elapsed = now - start;
      const flight = elapsed - impactAt;
      if (elapsed >= end) { ticker = 0; still(); return; }
      let index = 0, next = clip[0][1];
      while (index < clip.length - 1 && elapsed >= next) next += clip[++index][1];
      const impact = flight > 0 && flight < 260 ? flight / 260 : 0;
      paint(ctx, scene, motion, clip[index][0], face, Math.min(1, elapsed / total), impact);
      ticker = requestAnimationFrame(tick);
    };
    ticker = requestAnimationFrame(tick);
  } }, '播放动作');
  const turn = h('button', { class: 'btn', onclick: () => {
    face *= -1;
    turn.textContent = face > 0 ? '朝右 · 换向' : '朝左 · 换向';
    canvas.setAttribute('aria-label', `${SCENES[scene]}动作，朝${face > 0 ? '右' : '左'}`);
    if (!ticker) still();
  } }, '朝右 · 换向');
  async function select(next) {
    const key = ++revision;
    stop();
    scene = next; motion = null; play.disabled = true;
    for (const [id, btn] of tabs) {
      btn.classList.toggle('on', id === scene);
      btn.setAttribute('aria-pressed', String(id === scene));
    }
    canvas.setAttribute('aria-label', `${SCENES[scene]}动作，朝${face > 0 ? '右' : '左'}`);
    if (!ctx) { status.textContent = '当前设备无法绘制动作预览。'; return; }
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    status.textContent = '正在读取动作…';
    try {
      const current = await load(scene);
      if (key !== revision || !canvas.isConnected) return;
      motion = current;
      still();
      play.disabled = !motionSequence(scene, motion).length;
      status.textContent = play.disabled ? '当前使用站姿素材。' : '';
    } catch {
      if (key === revision) status.textContent = '动作读取失败，点选场景可重试。';
    }
  }
  const tabs = Object.entries(SCENES).map(([id, label]) => [id, h('button', { class: 'btn', onclick: () => select(id) }, label)]);
  const controls = h('div', { class: 'motion-tools', role: 'group', 'aria-label': '动作场景' }, ...tabs.map(([, btn]) => btn));
  const element = h('section', { class: 'motion-preview' }, controls, canvas, status, h('div', { class: 'motion-tools' }, turn, play),
    ...summary.map(line => h('p', { class: 'hint' }, line)));
  queueMicrotask(() => { if (element.isConnected && !revision) select('march'); });
  return { element, dispose: () => { revision++; stop(); } };
}
