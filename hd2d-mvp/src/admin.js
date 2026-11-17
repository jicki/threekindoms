import { applyScenario, MAX_PORTRAIT_BYTES, MAX_PORTRAIT_SIDE, newDraft, newScenarioId, RELATION_KINDS, validateScenario } from './core/scenario.js';
import { addScenario, listScenarios, loadScenario } from './core/scenario-store.js';

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
const base = await (async () => {
  try { const response = await fetch('data/game-data.json', { cache: 'no-store' }); if (!response.ok) throw new Error('基础数据无法读取'); return await response.json(); }
  catch { report('无法读取游戏基础数据。请通过游戏服务器打开管理页面。', true); return null; }
})();

if (base) {
  let draft = newDraft(base), tab = 'officers', selected = { officers: 0, weapons: null, skills: null }, formDirty = false, draftDirty = false, lastPublished = null, leaving = false, inFlight = false;
  const editFields = ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction'];
  const editable = (o) => ({ ...Object.fromEntries(editFields.map((key) => [key, o[key]])), birthYear: o.birthYear ?? null, birthCity: o.birthCity ?? null,
    portraitId: o.portraitId ?? (o.id < base.officers.length ? o.id : 0), portraitData: o.portraitData ?? null, skills: [...(o.skills ?? [])] });
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
    const side = panel('list', el('h2', {}, `武将 · ${all.length}`), search, el('div', { class: 'actions' }, add), list);
    const o = editable(all[selected.officers] ?? all[0]), form = el('form');
    const appearance = select('appear', [['initial', '开局已有'], ['search_city', '城市搜索'], ['automatic_faction', '自动出仕']], o.appear);
    const city = select('city', base.cities.map((c) => [c.id, `${c.name}${c.faction === 7 ? '（无主）' : ''}`]), o.city ?? 0);
    const faction = select('faction', base.factions.map((f) => [f.id, f.name]), o.faction ?? 0);
    const cityField = field('登场城市', city), factionField = field('自动出仕势力', faction);
    const showAppearance = () => { cityField.hidden = appearance.value === 'automatic_faction'; factionField.hidden = appearance.value !== 'automatic_faction'; };
    appearance.addEventListener('change', showAppearance); showAppearance();
    const born = el('input', { name: 'birthYear', type: 'number', min: 0, max: 9999, step: 1, value: o.birthYear ?? '', placeholder: '可留空' });
    const portraitSelect = select('portraitId', base.officers.map((p) => [p.id, `No.${p.id} ${p.name}`]), o.portraitId);
    const upload = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': '上传人物图片' });
    const preview = el('img', { class: 'portrait-preview-image', alt: '人物图像预览' });
    const note = el('span', { class: 'portrait-note' });
    const buttons = formButtons(), submit = buttons.querySelector('button');
    let customImage = o.portraitData, imageRequest = 0, imageBusy = false;
    const showPortrait = () => { preview.src = customImage || `assets/ai/portraits/${portraitSelect.value}.webp`; note.textContent = customImage ? '使用自定义图片（各表情共用）' : '使用已有的立绘和表情'; };
    preview.addEventListener('error', () => { if (customImage && preview.src === customImage) { preview.src = `assets/ai/portraits/${portraitSelect.value}.webp`; note.textContent = '自定义图片无法显示，预览已回退到已有图像'; } });
    const clearImage = el('button', { type: 'button', onclick: () => { imageRequest++; imageBusy = false; submit.disabled = false; customImage = null; upload.value = ''; formDirty = true; showPortrait(); } }, '使用已有图像');
    portraitSelect.addEventListener('change', () => { imageRequest++; imageBusy = false; submit.disabled = false; customImage = null; upload.value = ''; showPortrait(); });
    upload.addEventListener('change', async () => {
      const file = upload.files[0], request = ++imageRequest; if (!file) return;
      imageBusy = true; submit.disabled = true;
      try {
        const data = await preparePortrait(file);
        if (request !== imageRequest || !form.isConnected) return;
        customImage = data; showPortrait(); report('图片已准备，请应用人物修改');
      } catch (error) { if (request === imageRequest && form.isConnected) report(error.message, true); }
      finally { if (request === imageRequest && form.isConnected) { imageBusy = false; submit.disabled = false; } }
    });
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
      ...stats.map(([key, label, lo, hi]) => field(label, input(key, o[key], lo, hi))),
      field('出生年份', born), field('出生地', select('birthCity', [['', '未知'], ...base.cities.map((c) => [c.id, c.name])], o.birthCity ?? '')),
      field('登场方式', appearance), cityField, factionField,
      el('div', { class: 'wide portrait-editor' }, preview, el('div', {}, field('上传人物图片', upload), note, clearImage)),
      el('div', { class: 'wide' }, '分配新技能', checks)),
      el('p', { class: 'intro' }, '自定义图片会随版本发布，最大 64 KB；各表情共用该图。开局武将必须放在所属势力的城市；原君主的开局位置保持不变。移走城中最后一名武将后，该城开局无主。'), buttons);
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); if (imageBusy) return; const fd = new FormData(form), mode = fd.get('appear'), cid = number(fd, 'city');
      const next = { id: o.id, name: String(fd.get('name')).trim(), ...Object.fromEntries(stats.map(([key]) => [key, number(fd, key)])),
        birthYear: fd.get('birthYear') === '' ? null : number(fd, 'birthYear'), birthCity: fd.get('birthCity') === '' ? null : number(fd, 'birthCity'), portraitId: number(fd, 'portraitId'),
        army: fd.get('army'), weapon: number(fd, 'weapon'), armor: number(fd, 'armor'), appear: mode,
        city: mode === 'automatic_faction' ? null : cid,
        faction: mode === 'automatic_faction' ? number(fd, 'faction') : mode === 'initial' ? base.cities[cid]?.faction : null,
        skills: fd.getAll('skills').map(Number), ...(customImage ? { portraitData: customImage } : {}) };
      update((d) => { const at = d.officers.findIndex((item) => item.id === o.id); if (at < 0) d.officers.push(next); else d.officers[at] = next; }, '人物修改已应用到草稿');
    });
    return workspace(side, panel('detail', el('h2', {}, `${o.name} · No.${o.id}`), form));
  }

  function renderWeapons() {
    const items = draft.weapons;
    const add = el('button', { type: 'button', onclick: () => {
      if (!abandonForm()) return;
      const id = base.equipment.length + items.length;
      if (update((d) => d.weapons.push({ id, name: `新武器${id}`, cat: '剑', atk: 10, weight: 4, price: 100, icon: 0, shops: [] }), '已添加新武器')) { selected.weapons = id; render(); }
    } }, '＋ 新建武器');
    const side = panel('list', el('h2', {}, `新武器 · ${items.length}`), add, el('div', { class: 'stack' },
      items.map((w) => el('button', { type: 'button', class: selected.weapons === w.id ? 'on' : '', onclick: () => choose('weapons', w.id) }, w.name))));
    const w = items.find((item) => item.id === selected.weapons) ?? items[0];
    if (!w) return workspace(side, panel('detail', el('h2', {}, '新武器'), el('p', { class: 'empty' }, '创建新武器后设置属性和售卖城市。')));
    selected.weapons = w.id;
    const form = el('form'), shops = el('div', { class: 'checks' }, base.cities.filter((c) => c.facilities.weapons).map((c) => el('label', {},
      el('input', { type: 'checkbox', name: 'shops', value: c.id, checked: w.shops.includes(c.id) }), c.name)));
    const icon = select('icon', base.equipment.filter((e) => e.kind === 'weapon').map((e) => [e.id, e.name]), w.icon);
    const iconPreview = el('img', { class: 'weapon-preview', alt: '武器图标预览' });
    const showIcon = () => { iconPreview.src = `assets/ai/icon/equip/${icon.value}.webp`; };
    icon.addEventListener('change', showIcon); showIcon();
    form.append(el('div', { class: 'form-grid' }, field('名称', string('name', w.name)),
      field('类型', select('cat', [['剑', '剑'], ['刀', '刀'], ['枪', '长兵']], w.cat)),
      field('攻击', input('atk', w.atk, 0, 99)), field('重量', input('weight', w.weight, 0, 99)), field('价格', input('price', w.price, 0, 9999)),
      field('沿用图标', icon), iconPreview,
      el('div', { class: 'wide' }, '售卖城市', shops)),
      el('p', { class: 'intro' }, '所选城市的武器屋和战场商店可购买此武器；电脑也可按原有换装规则选择。'), formButtons());
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const fd = new FormData(form), value = { id: w.id, name: String(fd.get('name')).trim(), cat: fd.get('cat'),
        atk: number(fd, 'atk'), weight: number(fd, 'weight'), price: number(fd, 'price'), icon: number(fd, 'icon'), shops: fd.getAll('shops').map(Number) };
      update((d) => { d.weapons[d.weapons.findIndex((item) => item.id === w.id)] = value; }, '武器修改已应用到草稿');
    });
    return workspace(side, panel('detail', el('h2', {}, w.name), form));
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
    form.append(el('div', { class: 'form-grid' }, field('名称', string('name', s.name)),
      ...fields.map(([key, label, lo, hi]) => field(label, input(key, s[key], lo, hi)))),
      el('p', { class: 'intro' }, '目标为 5 格内敌将；效果可以组合，命中率沿用现有战场规则。技能可在武将页面分配。'), formButtons());
    markForm(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const fd = new FormData(form), value = { id: s.id, name: String(fd.get('name')).trim(),
        ...Object.fromEntries(fields.map(([key]) => [key, number(fd, key)])) };
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
    const tabs = [['officers', '人物与登场'], ['weapons', '新武器'], ['skills', '新技能'], ['relations', '人物关系'], ['rulers', '君主候选']];
    $('tabs').replaceChildren(...tabs.map(([id, label]) => el('button', { id: `tab-${id}`, type: 'button', role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', onclick: () => changeTab(id) }, label)));
    $('content').setAttribute('aria-labelledby', `tab-${tab}`);
    $('content').replaceChildren(({ officers: renderOfficers, weapons: renderWeapons, skills: renderSkills, relations: renderRelations, rulers: renderRulers })[tab]());
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
    $('published').replaceChildren(el('option', { value: '' }, '从原版开始'), ...versions.map((v) => el('option', { value: v.id }, v.name)));
    if (versions.some((v) => v.id === old)) $('published').value = old;
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
        selected = { officers: 0, weapons: null, skills: null }; render(); report('已载入新草稿');
      } catch (error) { report(error.message, true); }
    });
  };
  $('import').onclick = () => $('file').click();
  $('file').onchange = async () => {
    const file = $('file').files[0]; $('file').value = ''; if (!file || !abandonDraft()) return;
    await withBusy(async () => {
      try {
        if (file.size > 1024 * 1024) throw new Error('版本文件不能超过 1 MB');
        const imported = JSON.parse(await file.text()); validateScenario(imported, base); applyScenario(base, imported);
        draft = clone(imported); $('version-name').value = draft.name; formDirty = false; draftDirty = true; lastPublished = null;
        selected = { officers: 0, weapons: null, skills: null }; render(); report('版本已导入，未修改时可恢复原编号');
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
  $('export').onclick = () => {
    try {
      const next = prepared(), url = URL.createObjectURL(new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' }));
      el('a', { href: url, download: `threekindoms-${next.id}.json` }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      draft = next; report('已导出版本文件');
    } catch (error) { report(error.message, true); }
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
