"""校验并原子保存发布后的游戏版本。已发布的编号不可覆盖。"""
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import stat
import tempfile
import zlib
from collections import OrderedDict
from pathlib import Path
from threading import Lock

ID = re.compile(r'^v-[a-f0-9]{32}$')
MAX_BYTES = 1024 * 1024
MAX_PORTRAIT_BYTES = 64 * 1024
MAX_PORTRAIT_SIDE = 384
MAX_ASSET_BYTES = 1024 * 1024
ASSET_ID = re.compile(r'^a-[a-f0-9]{64}$')
BUILTIN_VISUAL = re.compile(r'^b-(sun|zhen|diao|cai|wang|chen|gao|tianyu|qiaorui|huangzu|liuqi|xunyou|qianzhao|huangshi|zhurong)-(portrait|calm|joy|angry|grief|motion)$')
MOODS = ('calm', 'joy', 'angry', 'grief')


class ScenarioError(ValueError):
    pass


def fail(message):
    raise ScenarioError(message)


def js_order(value):
    """JSON.stringify 会先按数字顺序输出数组下标形式的对象键。"""
    if isinstance(value, list):
        return [js_order(item) for item in value]
    if isinstance(value, dict):
        def index(key):
            return isinstance(key, str) and key.isascii() and key.isdigit() and str(int(key)) == key and int(key) < 4294967295
        numeric = sorted((key for key in value if index(key)), key=int)
        return {key: js_order(value[key]) for key in numeric + [key for key in value if not index(key)]}
    return value


def base_signature(base):
    source = json.dumps(js_order(base), ensure_ascii=False, separators=(',', ':')).encode('utf-16-le', 'surrogatepass')
    a, b = 2166136261, 2246822519
    for i in range(0, len(source), 2):
        c = source[i] | source[i + 1] << 8
        a, b = ((a ^ c) * 16777619) & 0xffffffff, ((b ^ c) * 3266489917) & 0xffffffff
    return f'{a:08x}{b:08x}'


def obj(value, label, allowed):
    if not isinstance(value, dict):
        fail(f'{label}格式错误')
    if set(value) - set(allowed):
        fail(f'{label}含有不支持的字段')


def text(value, label, maximum=32):
    if not isinstance(value, str) or not value.strip() or len(value.encode('utf-16-le', 'surrogatepass')) // 2 > maximum or not all(c.isalnum() or c in '· _.-' for c in value):
        fail(f'{label}只能包含文字、数字、空格、点或连字符')


def integer(value, label, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        fail(f'{label}须为 {minimum}–{maximum} 的整数')


def array(value, label, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        fail(f'{label}数量或格式错误')


def portrait(value):
    if value is None:
        return
    if not isinstance(value, str) or len(value) > ((MAX_PORTRAIT_BYTES + 2) // 3) * 4 + 32:
        fail('人物图像大小或格式错误')
    match = re.fullmatch(r'data:image/(png|webp);base64,([A-Za-z0-9+/]+={0,2})', value)
    if not match:
        fail('人物图像只支持 PNG 或 WebP')
    encoded = match.group(2)
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        fail('人物图像编码无效')
    if len(data) > MAX_PORTRAIT_BYTES or base64.b64encode(data).decode('ascii') != encoded:
        fail('人物图像大小或编码无效')
    width = height = 0
    if match.group(1) == 'png' and len(data) >= 33 and data.startswith(b'\x89PNG\r\n\x1a\n') and int.from_bytes(data[8:12], 'big') == 13 and data[12:16] == b'IHDR':
        width, height = int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')
    elif match.group(1) == 'webp' and len(data) >= 30 and data.startswith(b'RIFF') and data[8:12] == b'WEBP' and int.from_bytes(data[4:8], 'little') == len(data) - 8:
        tag, size = data[12:16], int.from_bytes(data[16:20], 'little')
        if size <= len(data) - 20:
            if tag == b'VP8 ' and size >= 10 and data[23:26] == b'\x9d\x01\x2a':
                width, height = int.from_bytes(data[26:28], 'little') & 0x3fff, int.from_bytes(data[28:30], 'little') & 0x3fff
            elif tag == b'VP8L' and size >= 5 and data[20] == 0x2f:
                bits = int.from_bytes(data[21:25], 'little'); width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
            elif tag == b'VP8X' and size >= 10:
                width, height = int.from_bytes(data[24:27], 'little') + 1, int.from_bytes(data[27:30], 'little') + 1
    if not width or not height or width > MAX_PORTRAIT_SIDE or height > MAX_PORTRAIT_SIDE:
        fail('人物图像内容或尺寸无效')


def visual_ref(value, kind, count):
    if not isinstance(value, str):
        fail('人物素材引用无效')
    builtin = BUILTIN_VISUAL.fullmatch(value)
    officer = re.fullmatch(r'o-(0|[1-9][0-9]{0,5})', value) if kind == 'motion' else None
    if ASSET_ID.fullmatch(value) or (builtin and builtin.group(2) == kind) or (officer and int(officer.group(1)) < count):
        return
    fail('人物素材引用无效')


def visual(value, count):
    obj(value, '人物素材', ('portrait', 'faces', 'motion'))
    for kind in ('portrait', 'motion'):
        if kind in value:
            visual_ref(value[kind], kind, count)
    if 'faces' in value:
        obj(value['faces'], '人物表情', MOODS)
        for kind, ref in value['faces'].items():
            visual_ref(ref, kind, count)


def image_info(data):
    """受限静态 PNG/WebP，限制压缩文件与解码尺寸；PNG 同时检查块、CRC 和解压长度。"""
    if not data or len(data) > MAX_ASSET_BYTES:
        fail('素材文件过大或为空')
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        pos, chunks, header, compressed = 8, [], None, bytearray()
        while pos + 12 <= len(data):
            length = int.from_bytes(data[pos:pos + 4], 'big'); end = pos + 12 + length
            if end > len(data): fail('PNG 内容无效')
            tag, payload = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
            if zlib.crc32(tag + payload) & 0xffffffff != int.from_bytes(data[end - 4:end], 'big'): fail('PNG 校验失败')
            chunks.append(tag)
            if tag == b'IHDR':
                if header is not None or len(payload) != 13 or pos != 8: fail('PNG 头无效')
                header = payload
            elif tag == b'IDAT': compressed.extend(payload)
            elif tag == b'acTL': fail('不支持动态 PNG')
            elif tag == b'IEND':
                if length or end != len(data): fail('PNG 结尾无效')
                break
            pos = end
        if not header or not compressed or not chunks or chunks[-1] != b'IEND': fail('PNG 内容无效')
        width, height = int.from_bytes(header[:4], 'big'), int.from_bytes(header[4:8], 'big')
        depth, color, comp, filt, interlace = header[8:13]
        channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color)
        if not channels or depth != 8 or comp or filt or interlace: fail('PNG 格式不受支持')
        if not width or not height or width > 1536 or height > 1536 or width * height > 2_000_000: fail('素材尺寸无效')
        stride, expected = width * channels + 1, (width * channels + 1) * height
        try:
            decoder = zlib.decompressobj(); pixels = decoder.decompress(compressed, expected + 1)
            if not decoder.eof or decoder.unused_data or len(pixels) != expected or any(pixels[i] > 4 for i in range(0, expected, stride)):
                fail('PNG 像素内容无效')
        except zlib.error:
            fail('PNG 像素内容无效')
        return 'image/png', width, height
    if len(data) >= 30 and data[:4] == b'RIFF' and data[8:12] == b'WEBP' and int.from_bytes(data[4:8], 'little') == len(data) - 8:
        tag, size = data[12:16], int.from_bytes(data[16:20], 'little')
        if size > len(data) - 20: fail('WebP 内容无效')
        width = height = 0
        if tag == b'VP8 ' and size >= 10 and data[23:26] == b'\x9d\x01\x2a':
            width, height = int.from_bytes(data[26:28], 'little') & 0x3fff, int.from_bytes(data[28:30], 'little') & 0x3fff
        elif tag == b'VP8L' and size >= 5 and data[20] == 0x2f:
            bits = int.from_bytes(data[21:25], 'little'); width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
        elif tag == b'VP8X' and size >= 10 and not data[20] & 2:
            width, height = int.from_bytes(data[24:27], 'little') + 1, int.from_bytes(data[27:30], 'little') + 1
        if not width or not height or width > 1536 or height > 1536 or width * height > 2_000_000: fail('素材尺寸无效')
        pos, found = 12, False
        while pos + 8 <= len(data):
            chunk, length = data[pos:pos + 4], int.from_bytes(data[pos + 4:pos + 8], 'little')
            pos += 8 + length + (length & 1)
            if pos > len(data) or chunk in (b'ANIM', b'ANMF'): fail('WebP 内容无效')
            found |= chunk in (b'VP8 ', b'VP8L')
        if pos != len(data) or not found: fail('WebP 内容无效')
        return 'image/webp', width, height
    fail('素材只支持静态 PNG 或 WebP')


def validate(s, base):
    obj(s, '版本', ['format', 'id', 'name', 'base', 'officers', 'weapons', 'armors', 'skills', 'relations', 'rulers', 'factions', 'rulerPassives', 'fixedAiRecruitment', 'enhancedDisasters', 'smartAiReinforcement', 'cityRaids'])
    if type(s.get('format')) is not int or s['format'] != 1:
        fail('不支持的版本文件格式')
    if not isinstance(s.get('id'), str) or not ID.fullmatch(s['id']):
        fail('版本编号无效')
    text(s.get('name'), '版本名称', 40)
    if 'rulerPassives' in s and type(s['rulerPassives']) is not bool:
        fail('君主被动设置无效')
    if 'fixedAiRecruitment' in s and type(s['fixedAiRecruitment']) is not bool:
        fail('电脑补兵设置无效')
    if 'enhancedDisasters' in s and type(s['enhancedDisasters']) is not bool:
        fail('增强灾害设置无效')
    if 'smartAiReinforcement' in s and type(s['smartAiReinforcement']) is not bool:
        fail('电脑补兵优先级设置无效')
    if 'cityRaids' in s and type(s['cityRaids']) is not bool:
        fail('守城事件设置无效')
    if s.get('base') != base_signature(base):
        fail('版本所需的基础数据与当前游戏不一致')
    officers, weapons, skills, relations = (s.get(k) for k in ('officers', 'weapons', 'skills', 'relations'))
    armors = s.get('armors', [])
    array(officers, '武将', len(base['officers']) + 100)
    array(weapons, '新武器', 64)
    array(armors, '新防具', 64)
    array(skills, '新技能', 64)
    array(relations, '人物关系', 1000)
    rulers = s.get('rulers', [])
    array(rulers, '君主候选', len(base['officers']) + 100)
    nbase = len(base['officers'])
    max_officer = nbase + sum(isinstance(o, dict) and type(o.get('id')) is int and o['id'] >= nbase for o in officers) - 1
    factions = s.get('factions', []); array(factions, '新势力', 3)
    homes, faction_rulers = set(), {f['ruler'] for f in base['factions']}
    for i, faction in enumerate(factions):
        obj(faction, '新势力', ['id', 'name', 'ruler', 'city', 'aiProfile', 'opening'])
        if type(faction.get('id')) is not int or faction['id'] != len(base['factions']) + i:
            fail('新势力编号不连续')
        text(faction.get('name'), '势力名称')
        integer(faction.get('ruler'), '势力君主', 0, max_officer)
        integer(faction.get('city'), '势力开局城市', 0, len(base['cities']) - 1)
        integer(faction.get('aiProfile'), '势力电脑策略', 0, len(base['factions']) - 1)
        if 'opening' in faction:
            opening = faction['opening']; obj(opening, '开局资源', ['gold', 'rice', 'reserve'])
            for key in ('gold', 'rice', 'reserve'):
                if key in opening: integer(opening[key], '开局资源', 0, 9999)
        city = base['cities'][faction['city']]
        if city['faction'] != len(base['factions']) or city['officers'] or faction['city'] in homes:
            fail('新势力须占用不同的原版无主空城')
        if faction['ruler'] in faction_rulers:
            fail('势力君主重复')
        homes.add(faction['city']); faction_rulers.add(faction['ruler'])
    all_factions = [*base['factions'], *factions]

    def owner_for_city(city):
        home = next((f['id'] for f in factions if f['city'] == city), None)
        owner = base['cities'][city]['faction']
        return home if home is not None else len(all_factions) if owner == len(base['factions']) else owner

    kinds = {}
    for item, kind in [(w, 'weapon') for w in weapons] + [(a, 'armor') for a in armors]:
        obj(item, '武器' if kind == 'weapon' else '防具', ['id', 'name', 'cat', 'atk', 'dfn', 'weight', 'price', 'icon', 'shops', 'grade', 'requirements'])
        integer(item.get('id'), '新装备编号', len(base['equipment']), len(base['equipment']) + len(weapons) + len(armors) - 1)
        if item['id'] in kinds:
            fail('新装备编号重复')
        kinds[item['id']] = kind

    def check_shops(item):
        shops = item.get('shops'); array(shops, '售卖城市', len(base['cities']))
        for city in shops:
            integer(city, '售卖城市', 0, len(base['cities']) - 1)
            if not base['cities'][city]['facilities']['weapons']:
                fail('只能在设有武器屋的城市售卖')
        if len(set(shops)) != len(shops):
            fail('售卖城市重复')

    def check_icon(icon, kind):
        if type(icon) is int:
            integer(icon, '装备图标', 0 if kind == 'weapon' else 24, 23 if kind == 'weapon' else 31)
        elif not isinstance(icon, str) or icon not in (('b-bow', 'b-fan') if kind == 'weapon' else ('b-female-armor',)):
            fail('装备图标无效')

    def check_requirements(item):
        if 'grade' in item:
            integer(item['grade'], '装备品级', 1, 5)
        if 'requirements' not in item:
            return
        requirement = item['requirements']
        obj(requirement, '购买条件', ['war', 'int', 'virtue', 'officers'])
        for key, label in [('war', '最低武力'), ('int', '最低智力'), ('virtue', '最低人德')]:
            if key in requirement:
                integer(requirement[key], label, 1, 99)
        if 'officers' in requirement:
            ids = requirement['officers']; array(ids, '指定武将', max_officer + 1)
            if not ids: fail('指定武将不能为空')
            for officer_id in ids: integer(officer_id, '指定武将', 0, max_officer)
            if len(ids) != len(set(ids)): fail('指定武将重复')

    for w in weapons:
        obj(w, '武器', ['id', 'name', 'cat', 'atk', 'weight', 'price', 'icon', 'shops', 'grade', 'requirements'])
        text(w.get('name'), '武器名称')
        if w.get('cat') not in ('剑', '刀', '枪', '扇', '弓'):
            fail('武器类型无效')
        for key, label, maximum in [('atk', '武器攻击', 99), ('weight', '武器重量', 99), ('price', '武器价格', 9999)]:
            integer(w.get(key), label, 0, maximum)
        check_icon(w.get('icon'), 'weapon'); check_shops(w); check_requirements(w)
    for a in armors:
        obj(a, '防具', ['id', 'name', 'dfn', 'weight', 'price', 'icon', 'shops', 'grade', 'requirements'])
        text(a.get('name'), '防具名称')
        for key, label, maximum in [('dfn', '防具防御', 99), ('weight', '防具重量', 99), ('price', '防具价格', 9999)]:
            integer(a.get(key), label, 0, maximum)
        check_icon(a.get('icon'), 'armor'); check_shops(a); check_requirements(a)
    for i, skill in enumerate(skills):
        obj(skill, '技能', ['id', 'name', 'cost', 'soldiers', 'hp', 'stop', 'rice', 'maxUses', 'visualEffect'])
        if type(skill.get('id')) is not int or skill['id'] != 16 + i:
            fail('新技能编号不连续')
        text(skill.get('name'), '技能名称')
        for key, label, minimum, maximum in [('cost', '技能机动力', 1, 60), ('soldiers', '损兵', 0, 1000), ('hp', '体力伤害', 0, 99), ('stop', '限制移动天数', 0, 10), ('rice', '粮草损失', 0, 9999)]:
            integer(skill.get(key), label, minimum, maximum)
        if 'maxUses' in skill:
            integer(skill['maxUses'], '每场使用次数', 1, 3)
        if 'visualEffect' in skill and (not isinstance(skill['visualEffect'], str) or skill['visualEffect'] not in ('tianyu', 'huangzu', 'xunyou', 'qianzhao', 'huangshi')):
            fail('技能演出无效')
        if not any(skill[key] for key in ('soldiers', 'hp', 'stop', 'rice')):
            fail('技能至少需要一种效果')
    seen, rosters = set(), [list(c['officers']) for c in base['cities']]
    for o in officers:
        obj(o, '武将', ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'birthYear', 'birthCity', 'portraitId', 'portraitData', 'appear', 'city', 'faction', 'skills', 'duelSkill', 'visual', 'searchPriority'])
        integer(o.get('id'), '武将编号', 0, max_officer); oid = o['id']
        if oid in seen:
            fail('武将编号重复')
        seen.add(oid); text(o.get('name'), '武将姓名')
        for key, label, minimum, maximum in [('hp', '体力', 1, 99), ('war', '武力', 1, 99), ('int', '智力', 1, 99), ('virtue', '人德', 1, 99), ('loyalty', '忠诚', 0, 100), ('level', '等级', 1, 8), ('exp', '经验', 0, 49999), ('soldiers', '兵数', 0, 1000), ('year', '登场年份', 0, 9999), ('death', '寿命年份', 0, 9999), ('portraitId', '人物图像', 0, nbase - 1)]:
            integer(o.get(key), label, minimum, maximum)
        portrait(o.get('portraitData'))
        if 'visual' in o:
            visual(o['visual'], nbase)
        if 'birthYear' not in o:
            fail('出生年份格式错误')
        if 'birthCity' not in o:
            fail('出生地格式错误')
        if o['birthCity'] is not None:
            integer(o['birthCity'], '出生地', 0, len(base['cities']) - 1)
        birth = o['birthYear']
        if birth is not None:
            integer(birth, '出生年份', 0, 9999)
            if birth > o['year']:
                fail('出生年份不能晚于登场年份')
        if o['death'] < o['year']:
            fail('寿命年份不能早于登场年份')
        last = len(base['equipment']) + len(weapons) + len(armors) - 1
        integer(o.get('weapon'), '武器', 0, last)
        weapon_kind = base['equipment'][o['weapon']]['kind'] if o['weapon'] < len(base['equipment']) else kinds.get(o['weapon'])
        if weapon_kind != 'weapon':
            fail('武器不能选择防具')
        integer(o.get('armor'), '防具', 0, last - 24)
        armor_id = 24 + o['armor']
        armor_kind = base['equipment'][armor_id]['kind'] if armor_id < len(base['equipment']) else kinds.get(armor_id)
        if armor_kind != 'armor':
            fail('防具不能选择武器')
        if o.get('army') not in ('平', '山', '水'):
            fail('兵种无效')
        appear = o.get('appear')
        if appear not in ('initial', 'search_city', 'automatic_faction'):
            fail('登场方式无效')
        if 'searchPriority' in o and type(o['searchPriority']) is not bool:
            fail('搜索优先设置无效')
        if o.get('searchPriority') and appear != 'search_city':
            fail('只有城市搜索登场的武将可以优先搜索')
        if appear == 'automatic_faction':
            if 'city' not in o or o['city'] is not None:
                fail('自动出仕的武将不能指定登场城市')
            integer(o.get('faction'), '出仕势力', 0, len(all_factions) - 1)
        else:
            integer(o.get('city'), '登场城市', 0, len(base['cities']) - 1)
            if appear == 'search_city':
                if 'faction' not in o or o['faction'] is not None:
                    fail('搜索登场的武将不能预设势力')
            else:
                integer(o.get('faction'), '所属势力', 0, len(all_factions) - 1)
                if owner_for_city(o['city']) != o['faction']:
                    fail('开局城市不属于所选势力')
                if o['year'] > 189:
                    fail('开局登场的年份不能晚于 189 年')
        ruler = next((f for f in all_factions if f['ruler'] == oid), None)
        ruler_city = ruler.get('city') if ruler and 'city' in ruler else base['officers'][oid]['city'] if ruler else None
        if ruler and (appear != 'initial' or o['city'] != ruler_city or o['faction'] != ruler['id']):
            fail('君主的开局城市和势力不能改变')
        selected = o.get('skills'); array(selected, '武将技能', 64)
        for sid in selected:
            integer(sid, '技能编号', 16, 15 + len(skills))
        if len(set(selected)) != len(selected):
            fail('武将技能重复')
        if 'duelSkill' in o and (not isinstance(o['duelSkill'], str) or o['duelSkill'] not in ('qinglong', 'longdan', 'yanren', 'gongyao', 'shoucheng', 'xianzhen', 'fangtian', 'xiaoyao', 'huchi', 'laojiang', 'baier', 'baima', 'sanjian', 'zhenjiang', 'qiaorui', 'zhurong')):
            fail('单挑技无效')
        prior = base['officers'][oid] if oid < nbase else None
        if prior is None or any(prior[k] != o[k] for k in ('appear', 'city', 'faction')):
            for roster in rosters:
                if oid in roster:
                    roster.remove(oid)
            if appear == 'initial':
                rosters[o['city']].append(oid)
    if any(i not in seen for i in range(nbase, max_officer + 1)):
        fail('新武将编号不连续')
    edited = {o['id']: o for o in officers}
    for faction in factions:
        oid = faction['ruler']
        ruler = edited.get(oid) or (base['officers'][oid] if oid < nbase else None)
        if ruler is None or ruler['appear'] != 'initial' or ruler['city'] != faction['city'] or ruler['faction'] != faction['id']:
            fail('新势力君主必须在该势力开局城市')
    if any(len(roster) > 10 for roster in rosters):
        fail('开局城市的武将不能超过 10 人')
    pairs = set()
    for r in relations:
        obj(r, '人物关系', ['from', 'to', 'kind'])
        integer(r.get('from'), '关系起点', 0, max_officer); integer(r.get('to'), '关系终点', 0, max_officer)
        if r['from'] == r['to']:
            fail('人物关系无效')
        text(r.get('kind'), '关系名称', 16)
        key = (r['from'], r['to'], r['kind'])
        if key in pairs:
            fail('人物关系重复')
        pairs.add(key)
    seen_rulers = set()
    for r in rulers:
        obj(r, '君主候选', ['faction', 'officer'])
        integer(r.get('faction'), '候选所属势力', 0, len(all_factions) - 1)
        integer(r.get('officer'), '候选武将', 0, max_officer)
        oid, faction = r['officer'], r['faction']
        officer = edited.get(oid) or (base['officers'][oid] if oid < nbase else None)
        if officer is None or officer['appear'] != 'initial' or officer['faction'] != faction or owner_for_city(officer['city']) != faction:
            fail('君主候选必须为该势力开局武将')
        if all_factions[faction]['ruler'] == oid or oid in seen_rulers:
            fail('君主候选重复')
        seen_rulers.add(oid)
    return True


class VersionRepository:
    def __init__(self, directory, base_file):
        self.directory, self.base_file = Path(directory), Path(base_file)
        self._asset_cache, self._asset_lock = OrderedDict(), Lock()

    def asset_directory(self, create=False):
        directory = self.directory / 'assets'
        if create:
            directory.mkdir(parents=True, exist_ok=True)
        if directory.is_symlink() or not directory.is_dir():
            raise FileNotFoundError('素材目录不可用')
        return directory

    def read_asset(self, asset_id):
        if not ASSET_ID.fullmatch(asset_id): raise FileNotFoundError(asset_id)
        directory = self.asset_directory()
        fd = os.open(directory / asset_id, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode): fail('素材文件须为普通文件')
            with os.fdopen(fd, 'rb') as f:
                fd = None; data = f.read(MAX_ASSET_BYTES + 1)
        finally:
            if fd is not None: os.close(fd)
        if 'a-' + hashlib.sha256(data).hexdigest() != asset_id: fail('素材校验失败')
        # 哈希不变则图片校验结果不变；限制缓存并串行处理首个解码，避免公开读取时重复解压。
        with self._asset_lock:
            info = self._asset_cache.get(asset_id)
            if info is None:
                info = image_info(data); self._asset_cache[asset_id] = info
                if len(self._asset_cache) > 256: self._asset_cache.popitem(last=False)
            else: self._asset_cache.move_to_end(asset_id)
        return data, info

    def put_asset(self, data, content_type):
        info = image_info(data)
        if info[0] != content_type: fail('素材类型与内容不一致')
        asset_id = 'a-' + hashlib.sha256(data).hexdigest()
        directory = self.asset_directory(create=True)
        fd, temporary = tempfile.mkstemp(prefix='.asset-', dir=directory)
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(data); f.flush(); os.fsync(f.fileno())
            try: os.link(temporary, directory / asset_id)
            except FileExistsError:
                existing, _ = self.read_asset(asset_id)
                if existing != data: fail('素材编号冲突')
        finally:
            os.unlink(temporary)
        return {'id': asset_id, 'type': info[0], 'width': info[1], 'height': info[2]}

    def read(self, version_id):
        if not ID.fullmatch(version_id):
            raise FileNotFoundError(version_id)
        path = self.directory / f'{version_id}.json'
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ScenarioError('版本文件须为普通文件')
            with os.fdopen(fd, 'rb') as f:
                fd = None
                raw = f.read(MAX_BYTES + 1)
        finally:
            if fd is not None:
                os.close(fd)
        if len(raw) > MAX_BYTES:
            raise ScenarioError('版本文件过大')
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get('id') != version_id:
            raise ScenarioError('版本文件损坏')
        return value

    def list(self, on_error=None):
        try:
            entries = os.scandir(self.directory)
        except FileNotFoundError:
            return []
        result = []
        with entries:
            for entry in entries:
                if not entry.name.endswith('.json'):
                    continue
                version_id = entry.name[:-5]
                if not ID.fullmatch(version_id):
                    continue
                try:
                    if entry.is_symlink():
                        raise ScenarioError('版本文件不能是符号链接')
                    value = self.read(version_id)
                    text(value.get('name'), '版本名称', 40)
                    result.append({'id': version_id, 'name': value['name'], 'savedAt': int(entry.stat().st_mtime * 1000)})
                except (OSError, ValueError, UnicodeError, RecursionError) as error:
                    logging.getLogger(__name__).warning('跳过无法读取的游戏版本 %s（%s）', version_id, type(error).__name__)
                    if on_error:
                        on_error(version_id)
        return sorted(result, key=lambda r: r['savedAt'], reverse=True)

    def publish(self, value):
        base = json.loads(self.base_file.read_text(encoding='utf-8'))
        validate(value, base)
        checked, total = {}, 0
        for officer in value['officers']:
            art = officer.get('visual', {})
            for kind, ref in [('portrait', art.get('portrait')), ('motion', art.get('motion')), *art.get('faces', {}).items()]:
                if ref and ASSET_ID.fullmatch(ref):
                    if ref not in checked:
                        if len(checked) >= 128: fail('版本素材数量超过 128 个')
                        try: data, info = self.read_asset(ref)
                        except FileNotFoundError: fail('版本引用的素材不存在，请先上传')
                        total += len(data)
                        if total > 16 * 1024 * 1024: fail('版本素材总量超过 16 MB')
                        checked[ref] = info
                    info = checked[ref]
                    if kind == 'motion' and info != ('image/png', 512, 512): fail('动作素材须为 512×512 的 PNG 网格图')
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(raw) > MAX_BYTES:
            fail('版本文件过大')
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / f"{value['id']}.json"
        fd, temp = tempfile.mkstemp(prefix='.version-', dir=self.directory)
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(raw); f.flush(); os.fsync(f.fileno())
            # link 只在目标不存在时成功，避免并发发布覆盖已供存档引用的版本。
            try:
                os.link(temp, target)
            except FileExistsError:
                if self.read(value['id']) != value:
                    raise
        finally:
            os.unlink(temp)
        return {'id': value['id'], 'name': value['name']}
