// Optional generated assets (GPT portraits, PixelLab/GPT sprites, ElevenLabs BGM and SFX).
// assets/manifest.json lists the expected paths; anything missing falls back to placeholders.
import * as THREE from 'three';
import { data } from './core/game.js';
import { equipmentIconUrl } from './core/equipment.js';
import { BOW_CLIP, BOW_POSES, FAN_CLIP, FAN_POSES } from './weapon-motion.js';
import { readResource } from './resource.js';

// One HEAD per URL: the music sets below ask again for the BGM and phrases the audio list already looked for.
const seen = new Map();
function exists(url, availability) {
  if (typeof availability?.[url] === 'boolean') return Promise.resolve(availability[url]);
  if (!seen.has(url)) seen.set(url, readResource(url, () => true, { method: 'HEAD', timeout: 2500 }).catch(() => false));
  return seen.get(url);
}

export async function loadManifest() {
  // 自带服务器一次返回可用素材；静态托管或旧服务器无接口时仍逐项检查。
  const index = /^https?:$/.test(location.protocol)
    ? readResource('/api/asset-availability', (r) => r.json(), { timeout: 2000, cache: 'no-store' }).catch(() => null)
    : null;
  const found = { portraits: {}, sprites: {}, audio: {}, music: {} };
  const m = await readResource('assets/manifest.json', (r) => r.json()).catch((error) => {
    console.warn('素材清单无法读取，使用默认素材', error);
    return null;
  });
  if (!m) return found;
  const availability = await index;
  const jobs = [];
  // A list means "first existing wins": generated asset, then the local original-game placeholder.
  for (const group of ['portraits', 'sprites', 'audio']) for (const [k, urls] of Object.entries(m[group] || {})) {
    jobs.push((async () => {
      for (const url of [urls].flat()) if (await exists(url, availability)) { found[group][k] = url; return; }
    })());
  }
  // Every BGM and phrase that exists, so the player can switch between the available music sets.
  for (const [k, urls] of Object.entries(m.audio || {})) if (k.startsWith('bgm-') || k.startsWith('cue-')) {
    jobs.push((async () => {
      const ok = await Promise.all([urls].flat().map((url) => exists(url, availability)));
      found.music[k] = [urls].flat().filter((_, i) => ok[i]);
    })());
  }
  await Promise.all(jobs);
  return found;
}

// The painted icon of a piece of equipment (tools/gen_equip_icons_codex.sh): 0-23 weapons, 24-31 armour, as D.equipment.
export const equipIcon = (id) => equipmentIconUrl(data()?.equipment?.[id]?.icon ?? id);

export function loadPixelTexture(url, timeout = 5000) {
  return new Promise((res, rej) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; rej(new Error(`读取 ${url} 超时`)); }, timeout);
    new THREE.TextureLoader().load(url, (t) => {
      clearTimeout(timer);
      if (expired) { t.dispose(); return; }
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter;
      t.colorSpace = THREE.SRGBColorSpace; res(t);
    }, undefined, (error) => { clearTimeout(timer); rej(error); });
  });
}

// 将过宽的单行动作条无损排列成多行，避免超过低端设备的纹理宽度上限。
export function packSpriteStrip({ tex, meta }, limit = 2048) {
  const image = tex.image, [cw, ch] = meta.cell, count = meta.frames.length;
  if (!image || image.width <= limit || !cw || !ch || image.width !== cw * count || image.height !== ch) return { tex, meta };
  const cols = Math.max(1, Math.floor(limit / cw)), rows = Math.ceil(count / cols);
  if (cols * cw > limit || rows * ch > limit) return { tex, meta };
  const canvas = document.createElement('canvas'); canvas.width = cols * cw; canvas.height = rows * ch;
  const ctx = canvas.getContext('2d'); if (!ctx) return { tex, meta };
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < count; i++) ctx.drawImage(image, i * cw, 0, cw, ch, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
  const packed = new THREE.CanvasTexture(canvas);
  packed.magFilter = THREE.NearestFilter; packed.minFilter = THREE.NearestMipmapNearestFilter;
  packed.colorSpace = THREE.SRGBColorSpace; tex.dispose();
  return { tex: packed, meta: { ...meta, atlasCols: cols, atlasRows: rows } };
}
export function spriteFrame(tex, meta, index) {
  const cols = meta.atlasCols || meta.frames.length, rows = meta.atlasRows || 1;
  tex.repeat.set(1 / cols, 1 / rows);
  tex.offset.set((index % cols) / cols, 1 - (Math.floor(index / cols) + 1) / rows);
}

// 上传动作使用固定 4×4 帧表，转成游戏已有的命名帧；无第三张特写图时沿用现有简化落马演出。
export async function loadGridMotion(url, { builtinSize = false, mirrorSide = false, weapon = 'blade' } = {}) {
  const source = await loadPixelTexture(url), image = source.image;
  const standard = image.width === 512 && image.height === 512;
  const built = builtinSize && image.width >= 512 && image.height >= 512 && image.width <= 2048 && image.height <= 2048
    && Math.abs(image.width - image.height) <= Math.max(image.width, image.height) * 0.02;
  if (!standard && !built) { source.dispose(); throw new Error('动作图须为 512×512'); }
  try {
    const cell = 128, input = document.createElement('canvas'); input.width = input.height = 512;
    const read = input.getContext('2d', { willReadFrequently: true }); if (!read) throw new Error('无法处理动作图');
    read.imageSmoothingEnabled = false;
    read.drawImage(image, 0, 0, 512, 512);
    const pixels = read.getImageData(0, 0, 512, 512).data, bounds = [];
    for (let index = 0; index < 16; index++) {
      let top = cell, bottom = -1, solidTop = cell, feet = -1;
      const rows = [], start = Math.floor(index / 4) * cell * 512 + (index % 4) * cell;
      const opaque = (x, y) => x >= 0 && x < cell && y >= 0 && y < cell && pixels[(start + y * 512 + x) * 4 + 3] > 127;
      for (let y = 0; y < cell; y++) {
        let run = 0, width = 0;
        for (let x = 0; x < cell; x++) {
          if (!opaque(x, y)) { run = 0; continue; }
          top = Math.min(top, y); bottom = y;
          if (++run >= 4) feet = y;
          if (run >= 9) solidTop = Math.min(solidTop, y);
          // 倒地图可能包括落在身体下方的兵器，取有一定厚度的像素估计身体接地行。
          if (index === 15 && run >= 5 && opaque(x - 2, y - 2) && opaque(x - 2, y + 2)) width++;
        }
        if (index === 15) rows.push(width);
      }
      const widest = Math.max(1, ...rows);
      let rest = rows.length - 1;
      while (rest >= 0 && rows[rest] < widest * 0.5) rest--;
      bounds.push(bottom < 0 ? null : { top, bottom, solidTop: solidTop < cell ? solidTop : top, feet: feet < 0 ? bottom : feet, rest });
    }
    // 小幅去除各帧脚底透明留白；整帧使用同一比例，避免人物在动作切换时忽大忽小。
    const stand = bounds[0], height = stand ? Math.max(80, Math.min(cell, stand.bottom - stand.top + 1)) : 112;
    const groundShift = (index) => bounds[index] ? Math.min(16, cell - 1 - bounds[index].bottom) : 0;
    const duelBase = (index) => bounds[index] ? cell - 1 - bounds[index].feet - groundShift(index) : 0;
    const make = (names, indices, extra = {}) => {
      const canvas = document.createElement('canvas'); canvas.width = cell * names.length; canvas.height = cell;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法处理动作图');
      ctx.imageSmoothingEnabled = false;
      indices.forEach((index, i) => {
        const shift = groundShift(index);
        ctx.save(); ctx.beginPath(); ctx.rect(i * cell, 0, cell, cell); ctx.clip();
        // 内置的部分动作图侧面朝左；转换为其他动作图约定的朝右方向，正背面保持原样。
        if (mirrorSide && (index < 4 || index >= 8)) { ctx.translate((2 * i + 1) * cell, 0); ctx.scale(-1, 1); }
        ctx.drawImage(input, (index % 4) * cell, Math.floor(index / 4) * cell, cell, cell, i * cell, shift, cell, cell);
        ctx.restore();
      });
      const tex = new THREE.CanvasTexture(canvas); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapNearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      return packSpriteStrip({ tex, meta: { frames: names, cell: [cell, cell], anchor: 64, figH: height, body: 104, tips: { strike: [52, 48 - groundShift(9)] }, clips: {}, ...extra } });
    };
    const march = make(['side_stand', 'side_walk_1', 'side_walk_2', 'side_walk_3', 'side_walk_4', 'front_stand', 'front_walk_1', 'front_walk_2', 'front_walk_3', 'front_walk_4', 'back_stand', 'back_walk_1', 'back_walk_2', 'back_walk_3', 'back_walk_4'],
      [0, 1, 2, 3, 2, 4, 4, 5, 4, 5, 6, 6, 7, 6, 7], { standHeight: height });
    const names = ['idle_a', 'idle_b', 'gallop_1', 'gallop_2', 'gallop_3', 'gallop_4', 'windup', 'strike', 'follow', 'hurt', 'taunt', 'fall', 'dodge', 'downed', 'loose_1', 'loose_2', 'walk_1', 'walk_2', 'walk_3', 'walk_4', 'swing_mid', 'swing_late', 'recover', 'feint_ready', 'feint_jab', 'feint_back', 'allin_windup', 'allin_strike', 'off_balance', 'hit_light', 'recoil_step'];
    const indices = [0, 0, 1, 2, 3, 2, 8, 9, 10, 11, 12, 15, 13, 15, 14, 2, 1, 2, 3, 2, 9, 10, 10, 8, 9, 10, 8, 9, 10, 11, 11];
    const weaponPoses = weapon === 'bow' ? BOW_POSES : weapon === 'fan' ? FAN_POSES : null;
    if (weaponPoses) { names.push(...weaponPoses); indices.push(8, 9, 10); }
    const weaponClips = weapon === 'bow' ? { bow: BOW_CLIP } : weapon === 'fan' ? {
      attack: FAN_CLIP,
      feint: [['fan_ready', 90], ['fan_sweep', 70, 'hit'], ['fan_follow', 100]],
      desperate: [['fan_ready', 330], ['fan_sweep', 155, 'hit'], ['fan_follow', 230]],
    } : {};
    const body = stand ? Math.max(64, stand.feet - stand.solidTop + 1) : 104;
    const rest = bounds[15]?.rest;
    const duel = make(names, indices, { weapon, body, flatFall: true,
      base: Object.fromEntries(names.map((name, i) => [name, duelBase(indices[i])])),
      rest: rest >= 0 ? cell - 1 - rest - groundShift(15) : duelBase(15),
      tips: { strike: [52, 48 - groundShift(9) - duelBase(9)] }, clips: {
      walk: [1, 2, 3, 4].map((n) => [`walk_${n}`, 160]), gallop: [1, 2, 3, 4].map((n) => [`gallop_${n}`, 120]),
      ...weaponClips,
    } });
    const turnNames = ['front_idle', 'front_walk_1', 'front_walk_2', 'front_walk_3', 'front_walk_4', 'front_windup', 'front_strike', 'front_hurt', 'back_idle', 'back_walk_1', 'back_walk_2', 'back_walk_3', 'back_walk_4', 'back_windup', 'back_strike', 'back_hurt'];
    const turnIndices = [4, 4, 5, 4, 5, 4, 5, 4, 6, 6, 7, 6, 7, 6, 7, 6];
    duel.turn = make(turnNames, turnIndices, { base: Object.fromEntries(turnNames.map((name, i) => [name, duelBase(turnIndices[i])])), clips: {
      'front:idle': [['front_idle', 900]], 'front:walk': [['front_walk_1', 160], ['front_walk_2', 160]],
      'front:charge': [['front_walk_1', 120], ['front_walk_2', 120]],
      'back:idle': [['back_idle', 900]], 'back:walk': [['back_walk_1', 160], ['back_walk_2', 160]],
      'back:charge': [['back_walk_1', 120], ['back_walk_2', 120]],
    } });
    return { march, duel };
  } finally { source.dispose(); }
}
