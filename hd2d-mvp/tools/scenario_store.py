"""校验并原子保存发布后的游戏版本。已发布的编号不可覆盖。"""
import base64
import binascii
import json
import logging
import os
import re
import stat
import tempfile
from pathlib import Path

ID = re.compile(r'^v-[a-f0-9]{32}$')
MAX_BYTES = 1024 * 1024
MAX_PORTRAIT_BYTES = 64 * 1024
MAX_PORTRAIT_SIDE = 384


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


def validate(s, base):
    obj(s, '版本', ['format', 'id', 'name', 'base', 'officers', 'weapons', 'skills', 'relations', 'rulers'])
    if type(s.get('format')) is not int or s['format'] != 1:
        fail('不支持的版本文件格式')
    if not isinstance(s.get('id'), str) or not ID.fullmatch(s['id']):
        fail('版本编号无效')
    text(s.get('name'), '版本名称', 40)
    if s.get('base') != base_signature(base):
        fail('版本所需的基础数据与当前游戏不一致')
    officers, weapons, skills, relations = (s.get(k) for k in ('officers', 'weapons', 'skills', 'relations'))
    array(officers, '武将', len(base['officers']) + 100)
    array(weapons, '新武器', 64)
    array(skills, '新技能', 64)
    array(relations, '人物关系', 1000)
    rulers = s.get('rulers', [])
    array(rulers, '君主候选', len(base['officers']) + 100)
    for i, w in enumerate(weapons):
        obj(w, '武器', ['id', 'name', 'cat', 'atk', 'weight', 'price', 'icon', 'shops'])
        if type(w.get('id')) is not int or w['id'] != len(base['equipment']) + i:
            fail('新武器编号不连续')
        text(w.get('name'), '武器名称')
        if w.get('cat') not in ('剑', '刀', '枪'):
            fail('武器类型无效')
        for key, label, maximum in [('atk', '武器攻击', 99), ('weight', '武器重量', 99), ('price', '武器价格', 9999), ('icon', '武器图标', 23)]:
            integer(w.get(key), label, 0, maximum)
        shops = w.get('shops'); array(shops, '售卖城市', len(base['cities']))
        for city in shops:
            integer(city, '售卖城市', 0, len(base['cities']) - 1)
            if not base['cities'][city]['facilities']['weapons']:
                fail('只能在设有武器屋的城市售卖')
        if len(set(shops)) != len(shops):
            fail('售卖城市重复')
    for i, skill in enumerate(skills):
        obj(skill, '技能', ['id', 'name', 'cost', 'soldiers', 'hp', 'stop', 'rice'])
        if type(skill.get('id')) is not int or skill['id'] != 16 + i:
            fail('新技能编号不连续')
        text(skill.get('name'), '技能名称')
        for key, label, minimum, maximum in [('cost', '技能机动力', 1, 60), ('soldiers', '损兵', 0, 1000), ('hp', '体力伤害', 0, 99), ('stop', '限制移动天数', 0, 10), ('rice', '粮草损失', 0, 9999)]:
            integer(skill.get(key), label, minimum, maximum)
        if not any(skill[key] for key in ('soldiers', 'hp', 'stop', 'rice')):
            fail('技能至少需要一种效果')
    nbase = len(base['officers'])
    max_officer = nbase + sum(isinstance(o, dict) and type(o.get('id')) is int and o['id'] >= nbase for o in officers) - 1
    seen, rosters = set(), [list(c['officers']) for c in base['cities']]
    for o in officers:
        obj(o, '武将', ['id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'birthYear', 'birthCity', 'portraitId', 'portraitData', 'appear', 'city', 'faction', 'skills'])
        integer(o.get('id'), '武将编号', 0, max_officer); oid = o['id']
        if oid in seen:
            fail('武将编号重复')
        seen.add(oid); text(o.get('name'), '武将姓名')
        for key, label, minimum, maximum in [('hp', '体力', 1, 99), ('war', '武力', 1, 99), ('int', '智力', 1, 99), ('virtue', '人德', 1, 99), ('loyalty', '忠诚', 0, 100), ('level', '等级', 1, 8), ('exp', '经验', 0, 49999), ('soldiers', '兵数', 0, 1000), ('armor', '防具', 0, 7), ('year', '登场年份', 0, 9999), ('death', '寿命年份', 0, 9999), ('portraitId', '人物图像', 0, nbase - 1)]:
            integer(o.get(key), label, minimum, maximum)
        portrait(o.get('portraitData'))
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
        integer(o.get('weapon'), '武器', 0, len(base['equipment']) + len(weapons) - 1)
        if 24 <= o['weapon'] < len(base['equipment']):
            fail('武器不能选择防具')
        if o.get('army') not in ('平', '山', '水'):
            fail('兵种无效')
        appear = o.get('appear')
        if appear not in ('initial', 'search_city', 'automatic_faction'):
            fail('登场方式无效')
        if appear == 'automatic_faction':
            if 'city' not in o or o['city'] is not None:
                fail('自动出仕的武将不能指定登场城市')
            integer(o.get('faction'), '出仕势力', 0, len(base['factions']) - 1)
        else:
            integer(o.get('city'), '登场城市', 0, len(base['cities']) - 1)
            if appear == 'search_city':
                if 'faction' not in o or o['faction'] is not None:
                    fail('搜索登场的武将不能预设势力')
            else:
                integer(o.get('faction'), '所属势力', 0, len(base['factions']) - 1)
                if base['cities'][o['city']]['faction'] != o['faction']:
                    fail('开局城市不属于所选势力')
                if o['year'] > 189:
                    fail('开局登场的年份不能晚于 189 年')
        ruler = next((f for f in base['factions'] if f['ruler'] == oid), None)
        if ruler and (appear != 'initial' or o['city'] != base['officers'][oid]['city'] or o['faction'] != ruler['id']):
            fail('君主的开局城市和势力不能改变')
        selected = o.get('skills'); array(selected, '武将技能', 64)
        for sid in selected:
            integer(sid, '技能编号', 16, 15 + len(skills))
        if len(set(selected)) != len(selected):
            fail('武将技能重复')
        prior = base['officers'][oid] if oid < nbase else None
        if prior is None or any(prior[k] != o[k] for k in ('appear', 'city', 'faction')):
            for roster in rosters:
                if oid in roster:
                    roster.remove(oid)
            if appear == 'initial':
                rosters[o['city']].append(oid)
    if any(i not in seen for i in range(nbase, max_officer + 1)):
        fail('新武将编号不连续')
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
    edited = {o['id']: o for o in officers}
    for r in rulers:
        obj(r, '君主候选', ['faction', 'officer'])
        integer(r.get('faction'), '候选所属势力', 0, len(base['factions']) - 1)
        integer(r.get('officer'), '候选武将', 0, max_officer)
        oid, faction = r['officer'], r['faction']
        officer = edited.get(oid) or (base['officers'][oid] if oid < nbase else None)
        if officer is None or officer['appear'] != 'initial' or officer['faction'] != faction or base['cities'][officer['city']]['faction'] != faction:
            fail('君主候选必须为该势力开局武将')
        if base['factions'][faction]['ruler'] == oid or oid in seen_rulers:
            fail('君主候选重复')
        seen_rulers.add(oid)
    return True


class VersionRepository:
    def __init__(self, directory, base_file):
        self.directory, self.base_file = Path(directory), Path(base_file)

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
