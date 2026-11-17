import { applyScenario, MAX_PORTRAIT_BYTES, MAX_PORTRAIT_SIDE, newDraft, newScenarioId, RELATION_KINDS, validateScenario } from './core/scenario.js';
import { addScenario, addPresetAbilities, listScenarios, loadScenario, uploadVisualAsset, readVisualAsset } from './core/scenario-store.js';
import { CHARACTER_PRESETS, FEMALE_SCENARIO_ID, HERO_SCENARIO_ID, HERO_SCENARIO_NAME, MOODS, femaleOfficer, presetVisual, visualRefs, visualUrl } from './core/visuals.js';
import { EQUIPMENT_ICONS, ensureFemaleGear, equipmentIconUrl } from './core/equipment.js';
import { DUEL_SKILLS } from './core/duel-skills.js';

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
const field = (label, control, cls = '') => { control.setAttribute('aria-label', label); return el('label', { class: cls }, label, control); };
const input = (name, value, min, max) => el('input', { name, type: 'number', value, min, max, step: 1, required: true });
const string = (name, value, max = 32) => el('input', { name, value, maxlength: max, required: true });
const select = (name, choices, value) => {
  const control = el('select', { name }, choices.map(([v, label]) => el('option', { value: v }, label)));
  control.value = String(value); return control;
};
const report = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
async function preparePortrait(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5 MB 的 PNG、JPEG 或 WebP 图片');
  let image;
  try { image = await createImageBitmap(file); } catch { throw new Error('无法读取图片，请选择有效的图片文件'); }
  try {
    if (!image.width || !image.height || image.width * image.height > 16_000_000) throw new Error('图片尺寸过大');
    const scale = Math.min(1, MAX_PORTRAIT_SIDE / image.width, MAX_PORTRAIT_SIDE / image.height), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法处理图片');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55, 0.4, 0.25]) {
      const data = canvas.toDataURL('image/webp', quality), parts = data.split(',');
      if (/^data:image\/(png|webp);base64$/.test(parts[0]) && parts[1].length * 3 / 4 <= MAX_PORTRAIT_BYTES) return data;
    }
    throw new Error('图片压缩后仍超过 64 KB，请选择更简单的图片');
  } finally { image.close(); }
}
async function prepareVisual(file, kind) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片');
  let image;
  try { image = await createImageBitmap(file); } catch { throw new Error('无法读取图片，请选择有效的图片文件'); }
  try {
    if (!image.width || !image.height || image.width * image.height > 16_000_000) throw new Error('图片尺寸过大');
    if (kind === 'motion' && (file.type === 'image/jpeg' || image.width !== image.height || image.width % 4 !== 0)) throw new Error('动作图须为正方形的 4×4 透明 PNG 或 WebP 网格');
    const canvas = document.createElement('canvas'), scale = Math.min(1, (kind === 'portrait' ? 1152 : 512) / Math.max(image.width, image.height));
    canvas.width = kind === 'motion' ? 512 : Math.max(1, Math.round(image.width * scale));
    canvas.height = kind === 'motion' ? 512 : Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法处理图片');
    ctx.imageSmoothingEnabled = kind !== 'motion'; ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (kind === 'motion') {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let transparent = false, visible = false;
      for (let i = 3; i < pixels.length && !(transparent && visible); i += 4) { transparent ||= pixels[i] === 0; visible ||= pixels[i] > 0; }
      if (!transparent || !visible) throw new Error('动作图须包含透明背景和可见图像');
    }
    const type = kind === 'motion' ? 'image/png' : 'image/webp';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
    if (!blob || blob.type !== type || blob.size > 1024 * 1024) throw new Error('压缩后的素材超过 1 MB 或浏览器不支持该格式');
    return blob;
  } finally { image.close(); }
}
const base = await (async () => {
  try { const response = await fetch('data/game-data.json', { cache: 'no-store' }); if (!response.ok) throw new Error('基础数据无法读取'); return await response.json(); }
  catch { report('无法读取游戏基础数据。请通过游戏服务器打开管理页面。', true); return null; }
})();
const existingMotions = await (async () => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('assets/ai/sprites/march/index.json', { cache: 'no-store', signal: controller.signal });
    const ids = response.ok ? await response.json() : [];
    return Array.isArray(ids) ? ids.filter((id) => /^(0|[1-9]\d*)$/.test(String(id))) : [];
  } catch { return []; } finally { clearTimeout(timer); }
})();

if (base) {
  $('published').append(el('option', { value: HERO_SCENARIO_ID }, `${HERO_SCENARIO_NAME}（内置）`));
  let draft = newDraft(base), tab = 'officers', selected = { officers: 0, weapons: null, armors: null, skills: null }, formDirty = false, draftDirty = false, lastPublished = null, leaving = false, inFlight = false;
  const equipmentId = () => base.equipment.length + draft.weapons.length + (draft.armors?.length ?? 0);
  const iconValue = (value) => /^\d+$/.test(value) ? Number(value) : value;
  const iconChoices = (kind) => [...base.equipment.filter((e) => e.kind === kind).map((e) => [e.id, e.name]),
    ...EQUIPMENT_ICONS.filter((e) => e.kind === kind).map((e) => [e.id, e.name])];
  const gearRequirements = (item) => {
    const r = item.requirements ?? {};
    const grade = select('grade', [['', '未设置'], ...[1, 2, 3, 4, 5].map((n) => [n, `${n}级`])], item.grade ?? '');
    const limit = (key) => el('input', { name: key, type: 'number', min: 1, max: 99, step: 1, value: r[key] ?? '', placeholder: '不限' });
    const allowed = el('select', { name: 'allowedOfficers', multiple: true, size: 6, 'aria-label': '限定购买武将' },
      currentData().officers.map((o) => el('option', { value: o.id, selected: r.officers?.includes(o.id) }, `No.${o.id} ${o.name}`)));
    const clear = el('button', { type: 'button', onclick: () => {
      for (const option of allowed.options) option.selected = false;
      allowed.dispatchEvent(new Event('change', { bubbles: true }));
    } }, '不限武将');
    return [field('品级', grade), field('最低武力', limit('war')), field('最低智力', limit('int')), field('最低人德', limit('virtue')),
      el('div', { class: 'wide' }, field('限定购买武将', allowed), clear, el('p', { class: 'intro' }, '可多选指定武将，未选择则不限；属性门槛与武将限制同时生效，仅限制购买。'))];
  };
  const readGearRequirements = (fd) => {
    const requirement = {};
    for (const key of ['war', 'int', 'virtue']) if (fd.get(key) !== '') requirement[key] = Number(fd.get(key));
    const officers = fd.getAll('allowedOfficers').map(Number); if (officers.length) requirement.officers = officers;
    return { ...(fd.get('grade') ? { grade: Number(fd.get('grade')) } : {}), ...(Object.keys(requirement).length ? { requirements: requirement } : {}) };
  };
  const editFields = ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction'];
  const editable = (o) => ({ ...Object.fromEntries(editFields.map((key) => [key, o[key]])), birthYear: o.birthYear ?? null, birthCity: o.birthCity ?? null,
    portraitId: o.portraitId ?? (o.id < base.officers.length ? o.id : 0), portraitData: o.portraitData ?? null, skills: [...(o.skills ?? [])],
    ...(o.duelSkill ? { duelSkill: o.duelSkill } : {}), ...(o.searchPriority ? { searchPriority: true } : {}), visual: clone(o.visual ?? {}) });
  const currentData = () => applyScenario(base, draft, { draft: true });
  const hasChanges = () => formDirty || draftDirty || $('version-name').value !== draft.name;
  const abandonForm = () => !formDirty || confirm('当前表单尚未应用，确定放弃这些输入吗？');
  const abandonDraft = () => !hasChanges() || confirm('当前草稿有未发布的修改，确定放弃吗？');
  const markForm = (form) => { form.addEventListener('input', () => { formDirty = true; }); form.addEventListener('change', () => { formDirty = true; }); };
  function update(mutator, success) {
    try {
      const next = clone(draft); next.id = null; mutator(next);
      applyScenario(base, next, { draft: true }); draft = next; formDirty = false; draftDirty = true; lastPublished = null;
      render(); report(success); return true;
    } catch (error) { report(error.message, true); return false; }
  }
  function changeTab(next) {
    if (!abandonForm()) return;
    formDirty = false; tab = next; render();
  }
  function choose(kind, id) {
    if (selected[kind] === id) return;
    if (!abandonForm()) return;
    formDirty = false; selected[kind] = id; render();
  }
  const number = (fd, name) => Number(fd.get(name));
  const workspace = (list, detail) => el('div', { class: 'workspace' }, list, detail);
  const panel = (cls, ...children) => el('div', { class: `panel ${cls}` }, children);
  const formButtons = (label = '应用修改') => el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'primary' }, label));
  async function withBusy(action) {
    if (inFlight) return;
    inFlight = true;
    const controls = [...document.querySelectorAll('button, input, select')].map((node) => [node, node.disabled]);
    for (const [node] of controls) node.disabled = true;
    try { await action(); }
    finally { for (const [node, disabled] of controls) if (node.isConnected) node.disabled = disabled; inFlight = false; }
  }

  function renderOfficers() {
    const data = currentData(), all = data.officers, search = el('input', { type: 'search', placeholder: '搜索姓名或编号', 'aria-label': '搜索武将' });
    const list = el('div', { class: 'stack' });
    const fill = () => {
      const query = search.value.trim();
      list.replaceChildren(...all.filter((o) => !query || o.name.includes(query) || String(o.id).includes(query)).map((o) => el('button', {
        type: 'button', class: selected.officers === o.id ? 'on' : '', onclick: () => choose('officers', o.id),
      }, `No.${o.id}　${o.name}`)));
    };
    search.addEventListener('input', fill); fill();
    const add = el('button', { type: 'button', onclick: () => {
      if (!abandonForm()) return;
      const id = data.officers.length, actor = { ...editable(base.officers[0]), id, name: `新武将${id}`, year: 189,
        death: 240, birthYear: null, birthCity: null, portraitId: 0, appear: 'search_city', city: 0, faction: null, skills: [] };
      if (update((next) => next.officers.push(actor), `已添加 ${actor.name}`)) { selected.officers = id; render(); }
    } }, '＋ 新建武将');
    const addPreset = select('characterPreset', CHARACTER_PRESETS.map((p) => [p.key, p.name]), CHARACTER_PRESETS[0].key);
    addPreset.setAttribute('aria-label', '角色模板');
    const addFemale = el('button', { type: 'button', onclick: () => {
      if (!abandonForm()) return;
      const preset = CHARACTER_PRESETS.find((p) => p.key === addPreset.value), id = data.officers.length;
      if (update((next) => {
        const officer = femaleOfficer(base, preset, id, ensureFemaleGear(next, base, preset.key, { balanced: true }));
        addPresetAbilities(next, preset, officer); next.officers.push(officer);
      }, `已添加 ${preset.name}`)) { selected.officers = id; render(); }
    } }, '添加角色模板');
    const side = panel('list', el('h2', {}, `武将 · ${all.length}`), search, el('div', { class: 'actions' }, add, addPreset, addFemale), list);
    const o = editable(all[selected.officers] ?? all[0]), form = el('form');
    const appearance = select('appear', [['initial', '开局已有'], ['search_city', '城市搜索'], ['automatic_faction', '自动出仕']], o.appear);
    const city = select('city', base.cities.map((c) => [c.id, `${c.name}${c.faction === 7 ? '（无主）' : ''}`]), o.city ?? 0);
    const faction = select('faction', base.factions.map((f) => [f.id, f.name]), o.faction ?? 0);
    const cityField = field('登场城市', city), factionField = field('自动出仕势力', faction);
    const priorityField = field('登场后优先搜索', el('input', { type: 'checkbox', name: 'searchPriority', checked: !!o.searchPriority }));
    const showAppearance = () => { cityField.hidden = appearance.value === 'automatic_faction'; factionField.hidden = appearance.value !== 'automatic_faction'; priorityField.hidden = appearance.value !== 'search_city'; };
    appearance.addEventListener('change', showAppearance); showAppearance();
    const born = el('input', { name: 'birthYear', type: 'number', min: 0, max: 9999, step: 1, value: o.birthYear ?? '', placeholder: '可留空' });
    const portraitSelect = select('portraitId', base.officers.map((p) => [p.id, `No.${p.id} ${p.name}`]), o.portraitId);
    const upload = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': '上传人物图片' });
    const preview = el('img', { class: 'portrait-preview-image', alt: '人物图像预览' });
    const note = el('span', { class: 'portrait-note' });
    const buttons = formButtons(), submit = buttons.querySelector('button');
    let customImage = o.portraitData, imageRequest = 0, imageBusy = false;
    const assetInputs = [], visuals = {}, refreshVisuals = [];
    const busyImages = (busy) => { imageBusy = busy; submit.disabled = busy; for (const node of assetInputs) node.disabled = busy; };
    const showPortrait = () => {
      const visual = visualUrl(visuals.portrait?.value);
      preview.src = visual || customImage || `assets/ai/portraits/${portraitSelect.value}.webp`;
      note.textContent = visual ? '使用所选立绘素材' : customImage ? '使用自定义图片（未设置表情时共用）' : '使用已有的立绘和表情';
    };
    preview.addEventListener('error', () => {
      const selected = visualUrl(visuals.portrait?.value);
      if (selected && preview.getAttribute('src') === selected) { preview.src = customImage || `assets/ai/portraits/${portraitSelect.value}.webp`; note.textContent = '立绘素材无法显示，预览已回退'; }
      else if (customImage && preview.src === customImage) { preview.src = `assets/ai/portraits/${portraitSelect.value}.webp`; note.textContent = '自定义图片无法显示，预览已回退到已有图像'; }
    });
    const clearImage = el('button', { type: 'button', onclick: () => { imageRequest++; customImage = null; upload.value = ''; if (visuals.portrait) visuals.portrait.value = ''; formDirty = true; refreshVisuals.forEach((f) => f()); showPortrait(); } }, '使用已有图像');
    portraitSelect.addEventListener('change', () => { imageRequest++; customImage = null; upload.value = ''; if (visuals.portrait) visuals.portrait.value = ''; refreshVisuals.forEach((f) => f()); showPortrait(); });
    upload.addEventListener('change', async () => {
      const file = upload.files[0], request = ++imageRequest; if (!file) return;
      busyImages(true);
      try {
        const data = await preparePortrait(file);
        if (request !== imageRequest || !form.isConnected) return;
        customImage = data; if (visuals.portrait) visuals.portrait.value = ''; refreshVisuals.forEach((f) => f()); showPortrait(); report('图片已准备，请应用人物修改');
      } catch (error) { if (request === imageRequest && form.isConnected) report(error.message, true); }
      finally { if (request === imageRequest && form.isConnected) busyImages(false); }
    });
    assetInputs.push(upload, clearImage, portraitSelect);
    const captions = { portrait: '立绘素材', calm: '平静表情', joy: '喜悦表情', angry: '愤怒表情', grief: '悲伤表情', motion: '动作素材' };
    const assetFields = Object.entries(captions).map(([kind, label]) => {
      const current = kind === 'portrait' || kind === 'motion' ? o.visual[kind] : o.visual.faces?.[kind];
      const options = [['', '沿用默认'], ...CHARACTER_PRESETS.map((p) => [`b-${p.key}-${kind}`, `${p.name} · ${label}`])];
      if (kind === 'motion') for (const id of existingMotions) if (base.officers[Number(id)]) options.push([`o-${id}`, `${base.officers[Number(id)].name} · 原有动作`]);
      if (current && !options.some(([value]) => value === current)) options.push([current, current.startsWith('a-') ? '已上传素材' : `既有动作 ${current.slice(2)}`]);
      const chosen = visuals[kind] = select(`visual_${kind}`, options, current ?? '');
      const file = el('input', { type: 'file', accept: kind === 'motion' ? 'image/png,image/webp' : 'image/png,image/jpeg,image/webp', 'aria-label': `上传${label}` });
      const assetPreview = el('img', { class: 'visual-asset-preview', alt: `${label}预览`, hidden: true });
      const refresh = () => {
        const existing = kind === 'motion' && /^o-(\d+)$/.exec(chosen.value);
        const src = visualUrl(chosen.value) || (existing ? `assets/ai/sprites/march/${existing[1]}.png` : null);
        assetPreview.hidden = !src; if (src) assetPreview.src = src;
      };
      assetPreview.addEventListener('error', () => { assetPreview.hidden = true; });
      refreshVisuals.push(refresh); refresh();
      assetInputs.push(file, chosen);
      chosen.addEventListener('change', () => { refresh(); if (kind === 'portrait') showPortrait(); });
      file.addEventListener('change', async () => {
        const source = file.files[0]; file.value = ''; if (!source) return;
        const request = ++imageRequest; busyImages(true);
        try {
          const blob = await prepareVisual(source, kind), result = await uploadVisualAsset(blob, $('token').value);
          if (!/^a-[a-f0-9]{64}$/.test(result?.id ?? '')) throw new Error('服务器返回的素材编号无效');
          if (request !== imageRequest || !form.isConnected) return;
          chosen.append(el('option', { value: result.id }, '已上传素材')); chosen.value = result.id;
          formDirty = true; refresh(); showPortrait(); report(`${label}已上传，请应用人物修改`);
        } catch (error) { if (request === imageRequest && form.isConnected) report(error.message, true); }
        finally { if (request === imageRequest && form.isConnected) busyImages(false); }
      });
      return el('div', {}, field(label, chosen), file, assetPreview);
    });
    const stylePreset = select('stylePreset', [['', '选择角色素材'], ...CHARACTER_PRESETS.map((p) => [p.key, p.name])], '');
    stylePreset.setAttribute('aria-label', '整套角色素材');
    const applyPreset = el('button', { type: 'button', onclick: () => {
      if (!stylePreset.value) return;
      const v = presetVisual(stylePreset.value); visuals.portrait.value = v.portrait; visuals.motion.value = v.motion;
      for (const mood of MOODS) visuals[mood].value = v.faces[mood];
      customImage = null; upload.value = ''; formDirty = true; refreshVisuals.forEach((f) => f()); showPortrait();
    } }, '应用整套素材');
    assetInputs.push(stylePreset, applyPreset);
    showPortrait();
    const weapons = data.equipment.filter((e) => e.kind === 'weapon').map((e) => [e.id, `${e.name}（攻${e.atk}）`]);
    const armors = data.equipment.filter((e) => e.kind === 'armor').map((e) => [e.id - 24, `${e.name}（防${e.dfn}）`]);
    const stats = [['hp', '体力', 1, 99], ['war', '武力', 1, 99], ['int', '智力', 1, 99], ['virtue', '人德', 1, 99],
      ['loyalty', '忠诚', 0, 100], ['level', '等级', 1, 8], ['exp', '经验', 0, 49999], ['soldiers', '兵数', 0, 1000],
      ['year', '登场年份', 0, 9999], ['death', '年老判定起始年', 0, 9999]];
    const checks = el('div', { class: 'checks' }, draft.skills.length ? draft.skills.map((s) => el('label', {},
      el('input', { type: 'checkbox', name: 'skills', value: s.id, checked: o.skills.includes(s.id) }), s.name)) : el('span', { class: 'empty' }, '尚无新技能，可先在“技能”中添加。'));
    form.append(el('div', { class: 'form-grid' }, field('姓名', string('name', o.name)),
      field('人物图像', portraitSelect),
      field('兵种', select('army', [['平', '平军'], ['山', '山军'], ['水', '水军']], o.army)),
      field('武器', select('weapon', weapons, o.weapon)), field('防具', select('armor', armors, o.armor)),
      field('专属单挑技', select('duelSkill', [['', '无'], ...Object.entries(DUEL_SKILLS).map(([key, skill]) => [key, `${skill.name}（命中${skill.hit >= 0 ? '+' : ''}${skill.hit}，伤害${skill.damage}%）`])], o.duelSkill ?? '')),
      ...stats.map(([key, label, lo, hi]) => field(label, input(key, o[key], lo, hi))),
      field('出生年份', born), field('出生地', select('birthCity', [['', '未知'], ...base.cities.map((c) => [c.id, c.name])], o.birthCity ?? '')),
      field('登场方式', appearance), cityField, factionField, priorityField,
      el('div', { class: 'wide portrait-editor' }, preview, el('div', {}, field('上传人物图片', upload), note, clearImage)),
      el('div', { class: 'wide' }, el('h3', {}, '立绘、表情与动作'), el('div', { class: 'actions' }, stylePreset, applyPreset),
        el('p', { class: 'intro' }, '可选择内置素材或上传；上传前请填写管理员令牌。动作图为透明 4×4 网格，包含行军、转向、攻击与受伤帧。'),
        el('div', { class: 'form-grid' }, ...assetFields)),
      el('div', { class: 'wide' }, '分配新技能', checks)),
      el('p', { class: 'intro' }, '单挑技每场单挑仅能使用一次。自定义图片会随版本发布，最大 64 KB；各表情共用该图。开局武将必须放在所属势力的城市；原君主的开局位置保持不变。移走城中最后一名武将后，该城开局无主。'), buttons);
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); if (imageBusy) return; const fd = new FormData(form), mode = fd.get('appear'), cid = number(fd, 'city');
      const visual = {}, faces = {};
      if (visuals.portrait.value) visual.portrait = visuals.portrait.value;
      if (visuals.motion.value) visual.motion = visuals.motion.value;
      for (const mood of MOODS) if (visuals[mood].value) faces[mood] = visuals[mood].value;
      if (Object.keys(faces).length) visual.faces = faces;
      const next = { id: o.id, name: String(fd.get('name')).trim(), ...Object.fromEntries(stats.map(([key]) => [key, number(fd, key)])),
        birthYear: fd.get('birthYear') === '' ? null : number(fd, 'birthYear'), birthCity: fd.get('birthCity') === '' ? null : number(fd, 'birthCity'), portraitId: number(fd, 'portraitId'),
        army: fd.get('army'), weapon: number(fd, 'weapon'), armor: number(fd, 'armor'), appear: mode,
        city: mode === 'automatic_faction' ? null : cid,
        faction: mode === 'automatic_faction' ? number(fd, 'faction') : mode === 'initial' ? base.cities[cid]?.faction : null,
        skills: fd.getAll('skills').map(Number), ...(mode === 'search_city' && fd.get('searchPriority') ? { searchPriority: true } : {}), ...(fd.get('duelSkill') ? { duelSkill: fd.get('duelSkill') } : {}), ...(customImage ? { portraitData: customImage } : {}), ...(Object.keys(visual).length ? { visual } : {}) };
      update((d) => { const at = d.officers.findIndex((item) => item.id === o.id); if (at < 0) d.officers.push(next); else d.officers[at] = next; }, '人物修改已应用到草稿');
    });
    return workspace(side, panel('detail', el('h2', {}, `${o.name} · No.${o.id}`), form));
  }

  function renderWeapons() {
    const items = draft.weapons;
    const add = el('button', { type: 'button', onclick: () => {
      if (!abandonForm()) return;
      const id = equipmentId();
      if (update((d) => d.weapons.push({ id, name: `新武器${id}`, cat: '剑', atk: 10, weight: 4, price: 100, icon: 0, shops: [] }), '已添加新武器')) { selected.weapons = id; render(); }
    } }, '＋ 新建武器');
    const side = panel('list', el('h2', {}, `新武器 · ${items.length}`), add, el('div', { class: 'stack' },
      items.map((w) => el('button', { type: 'button', class: selected.weapons === w.id ? 'on' : '', onclick: () => choose('weapons', w.id) }, w.name))));
    const w = items.find((item) => item.id === selected.weapons) ?? items[0];
    if (!w) return workspace(side, panel('detail', el('h2', {}, '新武器'), el('p', { class: 'empty' }, '创建新武器后设置属性和售卖城市。')));
    selected.weapons = w.id;
    const form = el('form'), shops = el('div', { class: 'checks' }, base.cities.filter((c) => c.facilities.weapons).map((c) => el('label', {},
      el('input', { type: 'checkbox', name: 'shops', value: c.id, checked: w.shops.includes(c.id) }), c.name)));
    const icon = select('icon', iconChoices('weapon'), w.icon);
    const iconPreview = el('img', { class: 'weapon-preview', alt: '武器图标预览' });
    const showIcon = () => { iconPreview.src = equipmentIconUrl(iconValue(icon.value)); };
    icon.addEventListener('change', showIcon); showIcon();
    form.append(el('div', { class: 'form-grid' }, field('名称', string('name', w.name)),
      field('类型', select('cat', [['剑', '剑'], ['刀', '刀'], ['枪', '长兵'], ['扇', '扇'], ['弓', '弓']], w.cat)),
      field('攻击', input('atk', w.atk, 0, 99)), field('重量', input('weight', w.weight, 0, 99)), field('价格', input('price', w.price, 0, 9999)),
      field('沿用图标', icon), iconPreview, ...gearRequirements(w),
      el('div', { class: 'wide' }, '售卖城市', shops)),
      el('p', { class: 'intro' }, '弓可在白兵中沿直线射击两格，远射的战力和武器攻击分别按 55% 和 60% 计算；近身遇敌将仍单挑，扇使用近战。所选城市的武器屋出售，有战场武器店时也可购买；电脑按武器类别与购买条件换装。'), formButtons());
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const fd = new FormData(form), value = { id: w.id, name: String(fd.get('name')).trim(), cat: fd.get('cat'),
        atk: number(fd, 'atk'), weight: number(fd, 'weight'), price: number(fd, 'price'), icon: iconValue(fd.get('icon')), shops: fd.getAll('shops').map(Number), ...readGearRequirements(fd) };
      update((d) => { d.weapons[d.weapons.findIndex((item) => item.id === w.id)] = value; }, '武器修改已应用到草稿');
    });
    return workspace(side, panel('detail', el('h2', {}, w.name), form));
  }

  function renderArmors() {
    const items = draft.armors ?? [];
    const add = el('button', { type: 'button', onclick: () => {
      if (!abandonForm()) return;
      const id = equipmentId();
      if (update((d) => (d.armors ??= []).push({ id, name: `新防具${id}`, dfn: 5, weight: 4, price: 100, icon: 24, shops: [] }), '已添加新防具')) { selected.armors = id; render(); }
    } }, '＋ 新建防具');
    const side = panel('list', el('h2', {}, `新防具 · ${items.length}`), add, el('div', { class: 'stack' },
      items.map((a) => el('button', { type: 'button', class: selected.armors === a.id ? 'on' : '', onclick: () => choose('armors', a.id) }, a.name))));
    const a = items.find((item) => item.id === selected.armors) ?? items[0];
    if (!a) return workspace(side, panel('detail', el('h2', {}, '新防具'), el('p', { class: 'empty' }, '创建新防具后设置属性和售卖城市。')));
    selected.armors = a.id;
    const form = el('form'), shops = el('div', { class: 'checks' }, base.cities.filter((c) => c.facilities.weapons).map((c) => el('label', {},
      el('input', { type: 'checkbox', name: 'shops', value: c.id, checked: a.shops.includes(c.id) }), c.name)));
    const icon = select('icon', iconChoices('armor'), a.icon), preview = el('img', { class: 'weapon-preview', alt: '防具图标预览' });
    const showIcon = () => { preview.src = equipmentIconUrl(iconValue(icon.value)); };
    icon.addEventListener('change', showIcon); showIcon();
    form.append(el('div', { class: 'form-grid' }, field('名称', string('name', a.name)), field('防御', input('dfn', a.dfn, 0, 99)),
      field('重量', input('weight', a.weight, 0, 99)), field('价格', input('price', a.price, 0, 9999)), field('防具图标', icon), preview, ...gearRequirements(a),
      el('div', { class: 'wide' }, '售卖城市', shops)),
      el('p', { class: 'intro' }, '所选城市的武器屋出售此防具，有战场武器店时也可购买。'), formButtons());
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const fd = new FormData(form), value = { id: a.id, name: String(fd.get('name')).trim(), dfn: number(fd, 'dfn'),
        weight: number(fd, 'weight'), price: number(fd, 'price'), icon: iconValue(fd.get('icon')), shops: fd.getAll('shops').map(Number), ...readGearRequirements(fd) };
      update((d) => { d.armors[d.armors.findIndex((item) => item.id === a.id)] = value; }, '防具修改已应用到草稿');
    });
    return workspace(side, panel('detail', el('h2', {}, a.name), form));
  }

  function renderSkills() {
    const items = draft.skills;
    const add = el('button', { type: 'button', onclick: () => {
      if (!abandonForm()) return;
      const id = 16 + items.length;
      if (update((d) => d.skills.push({ id, name: `新技能${id}`, cost: 4, soldiers: 50, hp: 0, stop: 0, rice: 0 }), '已添加新技能')) { selected.skills = id; render(); }
    } }, '＋ 新建技能');
    const side = panel('list', el('h2', {}, `新技能 · ${items.length}`), add, el('div', { class: 'stack' },
      items.map((s) => el('button', { type: 'button', class: selected.skills === s.id ? 'on' : '', onclick: () => choose('skills', s.id) }, s.name))));
    const s = items.find((item) => item.id === selected.skills) ?? items[0];
    if (!s) return workspace(side, panel('detail', el('h2', {}, '新技能'), el('p', { class: 'empty' }, '创建新技能后可组合多种固定效果。')));
    selected.skills = s.id;
    const form = el('form'), fields = [['cost', '机动力消耗', 1, 60], ['soldiers', '损兵', 0, 1000], ['hp', '体力伤害', 0, 99],
      ['stop', '限制移动天数', 0, 10], ['rice', '粮草损失', 0, 9999]];
    const maxUses = el('input', { name: 'maxUses', type: 'number', min: 1, max: 3, step: 1, value: s.maxUses ?? '', placeholder: '不限' });
    form.append(el('div', { class: 'form-grid' }, field('名称', string('name', s.name)),
      ...fields.map(([key, label, lo, hi]) => field(label, input(key, s[key], lo, hi))), field('每场使用次数', maxUses)),
      el('p', { class: 'intro' }, '目标为 5 格内敌将；效果可以组合，命中率沿用现有战场规则。可限制每场使用 1–3 次，尝试失败也消耗次数；技能可在武将页面分配。'), formButtons());
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const fd = new FormData(form), value = { id: s.id, name: String(fd.get('name')).trim(),
        ...Object.fromEntries(fields.map(([key]) => [key, number(fd, key)])), ...(fd.get('maxUses') !== '' ? { maxUses: number(fd, 'maxUses') } : {}) };
      update((d) => { d.skills[d.skills.findIndex((item) => item.id === s.id)] = value; }, '技能修改已应用到草稿');
    });
    return workspace(side, panel('detail', el('h2', {}, s.name), form));
  }

  function renderRelations() {
    const data = currentData(), choices = data.officers.map((o) => [o.id, `${o.name} · ${o.id}`]), form = el('form');
    const relationKind = select('kind', [...RELATION_KINDS.map((k) => [k, k]), ['__custom__', '自定义关系']], RELATION_KINDS[0]);
    const customKind = el('input', { name: 'customKind', maxlength: 16, placeholder: '例如：同乡' }), customField = field('自定义关系名称', customKind);
    const showCustom = () => { customField.hidden = relationKind.value !== '__custom__'; customKind.required = !customField.hidden; };
    relationKind.addEventListener('change', showCustom); showCustom();
    form.append(el('div', { class: 'form-grid' }, field('人物', select('from', choices, 0)), field('关系', relationKind),
      customField, field('相关人物', select('to', choices, 1))), formButtons('添加关系'));
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const fd = new FormData(form), relation = { from: number(fd, 'from'), to: number(fd, 'to'), kind: fd.get('kind') === '__custom__' ? String(fd.get('customKind')).trim() : fd.get('kind') };
      if (draft.relations.some((r) => r.kind === relation.kind && ((r.from === relation.from && r.to === relation.to) || (r.from === relation.to && r.to === relation.from)))) {
        report('这两人已有相同关系', true); return;
      }
      update((d) => d.relations.push(relation), '人物关系已添加到草稿');
    });
    const search = el('input', { type: 'search', placeholder: '搜索人物姓名或编号', 'aria-label': '搜索人物关系' });
    const kinds = [...new Set([...RELATION_KINDS, ...draft.relations.map((r) => r.kind)])];
    const kind = select('relationFilter', [['', '全部关系类型'], ...kinds.map((k) => [k, k])], '');
    const count = el('p', { class: 'intro', 'aria-live': 'polite' }), rows = el('div', { class: 'relations' });
    const fill = () => {
      const query = search.value.trim(), wanted = kind.value;
      const found = draft.relations.map((r, i) => ({ r, i })).filter(({ r }) => (!wanted || r.kind === wanted)
        && (!query || [data.officers[r.from].name, data.officers[r.to].name, String(r.from), String(r.to)].some((s) => s.includes(query))));
      count.textContent = `当前关系 ${draft.relations.length} 条${found.length === draft.relations.length ? '' : `，符合筛选 ${found.length} 条`}`;
      rows.replaceChildren(...(found.length ? found.map(({ r, i }) => el('div', { class: 'relation' },
        el('span', {}, `${data.officers[r.from].name} · ${r.kind} · ${data.officers[r.to].name}`),
        el('button', { type: 'button', onclick: () => { if (abandonForm()) update((d) => d.relations.splice(i, 1), '人物关系已移除'); } }, '移除')))
        : [el('p', { class: 'empty' }, draft.relations.length ? '没有符合条件的关系。' : '原版没有内置人物关系；可在此添加。')]));
    };
    search.addEventListener('input', fill); kind.addEventListener('change', fill); fill();
    return panel('detail', el('h2', {}, '人物关系'), el('p', { class: 'intro' }, `可用关系：${RELATION_KINDS.join('、')}，也可自定义。关系在双方资料中使用相同名称，不自动改变招募、忠诚或战斗规则。`), form,
      el('div', { class: 'form-grid' }, field('搜索人物关系', search), field('筛选关系类型', kind)), count, rows);
  }

  function renderRulers() {
    const data = currentData(), items = draft.rulers ?? [], form = el('form');
    const faction = select('faction', data.factions.map((f) => [f.id, `${data.officers[f.ruler].name}势力`]), 0);
    const officer = select('officer', [], ''), buttons = formButtons('添加君主候选'), submit = buttons.querySelector('button');
    const fill = () => {
      const f = Number(faction.value), choices = data.officers.filter((o) => o.appear === 'initial' && o.faction === f
        && data.cities[o.city]?.faction === f && o.id !== data.factions[f].ruler && !items.some((r) => r.officer === o.id));
      officer.replaceChildren(...choices.map((o) => el('option', { value: o.id }, `${o.name} · No.${o.id} · ${data.cities[o.city].name}`)));
      officer.disabled = submit.disabled = !choices.length;
    };
    faction.addEventListener('change', fill); fill();
    form.append(el('div', { class: 'form-grid' }, field('所属势力', faction), field('候选武将', officer)), buttons);
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); if (officer.disabled) return;
      const fd = new FormData(form), candidate = { faction: number(fd, 'faction'), officer: number(fd, 'officer') };
      update((d) => { (d.rulers ||= []).push(candidate); }, '君主候选已添加到草稿');
    });
    const rows = items.map((r, i) => el('div', { class: 'relation' },
      el('span', {}, `${data.officers[r.officer].name} · ${data.officers[data.factions[r.faction].ruler].name}势力 · ${data.cities[data.officers[r.officer].city].name}`),
      el('button', { type: 'button', onclick: () => { if (abandonForm()) update((d) => d.rulers.splice(i, 1), '君主候选已移除'); } }, '移除')));
    return panel('detail', el('h2', {}, '君主候选'), el('p', { class: 'intro' }, '原有七位君主始终可选。可将本势力的开局武将增加为候选；玩家选中后由该武将统领原势力，原君主留在该势力。候选不会创建新势力。'),
      el('p', { class: 'intro' }, `原有君主：${data.factions.map((f) => data.officers[f.ruler].name).join('、')}`), form,
      el('h3', {}, `已添加候选 · ${items.length}`), el('div', { class: 'relations' }, rows.length ? rows : el('p', { class: 'empty' }, '尚未添加额外候选。')));
  }

  function render() {
    const tabs = [['officers', '人物与登场'], ['weapons', '新武器'], ['armors', '新防具'], ['skills', '新技能'], ['relations', '人物关系'], ['rulers', '君主候选']];
    $('tabs').replaceChildren(...tabs.map(([id, label]) => el('button', { id: `tab-${id}`, type: 'button', role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', onclick: () => changeTab(id) }, label)));
    $('content').setAttribute('aria-labelledby', `tab-${tab}`);
    $('content').replaceChildren(({ officers: renderOfficers, weapons: renderWeapons, armors: renderArmors, skills: renderSkills, relations: renderRelations, rulers: renderRulers })[tab]());
  }
  let listRequest = 0;
  async function refreshPublished() {
    const sequence = ++listRequest;
    let versions;
    try { versions = await listScenarios(); }
    catch (error) { if (sequence !== listRequest) return; throw error; }
    if (sequence !== listRequest) return;
    if (!Array.isArray(versions)) throw new Error('版本列表格式错误');
    const old = $('published').value;
    $('published').replaceChildren(el('option', { value: '' }, '从原版开始'), el('option', { value: HERO_SCENARIO_ID }, `${HERO_SCENARIO_NAME}（内置）`),
      ...versions.filter((v) => ![FEMALE_SCENARIO_ID, HERO_SCENARIO_ID].includes(v.id)).map((v) => el('option', { value: v.id }, v.name)));
    if (old === HERO_SCENARIO_ID || versions.some((v) => v.id === old)) $('published').value = old;
    const warning = $('version-warning');
    warning.hidden = !versions.skipped;
    warning.textContent = versions.skipped ? `有 ${versions.skipped} 个已发布版本无法读取，已跳过；请检查服务器日志和版本文件。` : '';
  }
  $('load-version').onclick = async () => {
    if (!abandonDraft()) return;
    await withBusy(async () => {
      try {
        const id = $('published').value;
        draft = id ? { ...clone(await loadScenario(id, base)), id: null } : newDraft(base);
        $('version-name').value = draft.name; formDirty = draftDirty = false; lastPublished = null;
        selected = { officers: 0, weapons: null, armors: null, skills: null }; render(); report('已载入新草稿');
      } catch (error) { report(error.message, true); }
    });
  };
  $('import').onclick = () => $('file').click();
  $('file').onchange = async () => {
    const file = $('file').files[0]; $('file').value = ''; if (!file || !abandonDraft()) return;
    await withBusy(async () => {
      try {
        if (file.size > 24 * 1024 * 1024) throw new Error('版本素材包不能超过 24 MB');
        const parsed = JSON.parse(await file.text()), bundle = parsed?.bundle === 'threekindoms-assets-v1';
        if (!bundle && file.size > 1024 * 1024) throw new Error('版本文件不能超过 1 MB');
        const imported = bundle ? parsed.scenario : parsed;
        validateScenario(imported, base); applyScenario(base, imported);
        if (bundle) {
          const assets = parsed.assets;
          if (!assets || typeof assets !== 'object' || Array.isArray(assets)) throw new Error('版本素材包无效');
          const needed = new Set(imported.officers.flatMap((o) => visualRefs(o.visual)).filter((id) => /^a-[a-f0-9]{64}$/.test(id)));
          if (needed.size > 128 || Object.keys(assets).length !== needed.size || [...needed].some((id) => !Object.hasOwn(assets, id))) throw new Error('版本素材包不完整');
          let total = 0;
          for (const id of needed) {
            const item = assets[id];
            if (!item || !['image/png', 'image/webp'].includes(item.type) || typeof item.data !== 'string' || item.data.length > 1398104 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new Error('版本素材包无效');
            let bytes; try { bytes = Uint8Array.from(atob(item.data), (c) => c.charCodeAt(0)); } catch { throw new Error('版本素材编码无效'); }
            total += bytes.length; if (total > 16 * 1024 * 1024) throw new Error('版本素材总量超过 16 MB');
            const uploaded = await uploadVisualAsset(new Blob([bytes], { type: item.type }), $('token').value);
            if (uploaded.id !== id) throw new Error('版本素材校验失败');
          }
        }
        draft = clone(imported); $('version-name').value = draft.name; formDirty = false; draftDirty = true; lastPublished = null;
        selected = { officers: 0, weapons: null, armors: null, skills: null }; render(); report('版本已导入，未修改时可恢复原编号');
      } catch (error) { report(error.message || '版本文件无效', true); }
    });
  };
  function prepared() {
    if (formDirty) throw new Error('请先应用当前表单中的修改');
    const next = clone(draft), name = $('version-name').value.trim();
    if (next.name !== name) { next.name = name; next.id = null; }
    next.id ||= newScenarioId();
    validateScenario(next, base); applyScenario(base, next);
    if (new TextEncoder().encode(JSON.stringify(next, null, 2)).byteLength > 1024 * 1024) throw new Error('版本文件超过 1 MB，请减少自定义图片');
    return next;
  }
  $('export').onclick = async () => {
    await withBusy(async () => {
      try {
        const next = prepared(), ids = [...new Set(next.officers.flatMap((o) => visualRefs(o.visual)).filter((id) => /^a-[a-f0-9]{64}$/.test(id)))];
        if (ids.length > 128) throw new Error('版本素材数量超过 128 个');
        const assets = {}; let total = 0;
        for (const id of ids) {
          const blob = await readVisualAsset(id); total += blob.size;
          if (total > 16 * 1024 * 1024) throw new Error('版本素材总量超过 16 MB');
          const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
          for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
          assets[id] = { type: blob.type, data: btoa(binary) };
        }
        const output = ids.length ? { bundle: 'threekindoms-assets-v1', scenario: next, assets } : next;
        const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
        el('a', { href: url, download: `threekindoms-${next.id}.json` }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        draft = next; report(ids.length ? '已导出包含素材的版本文件' : '已导出版本文件');
      } catch (error) { report(error.message, true); }
    });
  };
  $('publish').onclick = async () => {
    await withBusy(async () => {
      try {
        const next = prepared(), token = $('token').value;
        report('正在发布游戏版本…');
        draft = next; await addScenario(next, base, token); $('token').value = '';
        draft = next; formDirty = draftDirty = false; lastPublished = next.id;
        try { await refreshPublished(); $('published').value = next.id; }
        catch { report(`已发布“${next.name}”，但版本列表刷新失败。`, true); return; }
        report(`已发布“${next.name}”，可在游戏标题的“游戏版本”中选择。`);
      } catch (error) { report(error.message, true); }
    });
  };
  $('back').onclick = () => {
    if (!abandonDraft()) return;
    try { sessionStorage.setItem('hd2d-title-seen', '1'); } catch {}
    leaving = true;
    location.replace(`index.html${location.search}`);
  };
  addEventListener('beforeunload', (event) => { if (!leaving && hasChanges()) event.preventDefault(); });
  $('version-name').addEventListener('input', () => { draftDirty = true; lastPublished = null; });
  render();
  refreshPublished().catch(() => report('无法读取服务器版本列表；仍可编辑草稿，发布前请检查服务器。', true));
  window.__admin = { get draft() { return clone(draft); }, get lastPublished() { return lastPublished; } };
}
