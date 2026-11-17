import base64
import concurrent.futures
import copy
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'hd2d-mvp/tools'))
from scenario_store import MAX_PORTRAIT_BYTES, MAX_PORTRAIT_SIDE, ScenarioError, VersionRepository, base_signature, validate

BASE_PATH = ROOT / 'hd2d-mvp/data/game-data.json'
BASE = json.loads(BASE_PATH.read_text(encoding='utf-8'))
TOKEN = 'test-token-' + 'x' * 40


def version(letter='a'):
    return {'format': 1, 'id': 'v-' + letter * 32, 'name': '测试版本', 'base': base_signature(BASE),
            'officers': [], 'weapons': [], 'skills': [], 'relations': []}


class ValidationTest(unittest.TestCase):
    def test_signature_matches_the_browser(self):
        code = "import {readFileSync} from 'node:fs'; import {baseSignature} from './hd2d-mvp/src/core/scenario.js'; console.log(baseSignature(JSON.parse(readFileSync('hd2d-mvp/data/game-data.json','utf8'))));"
        browser_signature = subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True).strip()
        self.assertEqual(base_signature(BASE), browser_signature)

    def test_rejects_unsafe_fields_and_invalid_references(self):
        s = version(); self.assertTrue(validate(s, BASE))
        s['skills'] = [{'id': 16, 'name': '<script>', 'cost': 3, 'soldiers': 1, 'hp': 0, 'stop': 0, 'rice': 0}]
        with self.assertRaises(ScenarioError): validate(s, BASE)
        s['skills'][0]['name'] = '新计略'; s['skills'][0]['script'] = 'alert(1)'
        with self.assertRaises(ScenarioError): validate(s, BASE)
        s = version(); s['relations'] = [{'from': 0, 'to': 999, 'kind': '朋友'}]
        with self.assertRaises(ScenarioError): validate(s, BASE)

    def test_special_abilities_match_browser_validation(self):
        officer = BASE['officers'][130]
        fields = ('id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction')
        scenario = version()
        scenario['skills'] = [{'id': 16, 'name': '奇谋', 'cost': 9, 'soldiers': 80, 'hp': 3, 'stop': 1, 'rice': 0, 'maxUses': 2}]
        scenario['officers'] = [{**{key: officer[key] for key in fields}, 'birthYear': None, 'birthCity': None,
                                 'portraitId': 130, 'skills': [16], 'duelSkill': 'qinglong',
                                 'visual': {'portrait': 'b-chen-portrait', 'motion': 'b-chen-motion'}}]
        priority = copy.deepcopy(scenario)
        priority['officers'][0].update({'appear': 'search_city', 'faction': None, 'searchPriority': True})
        disabled = copy.deepcopy(scenario); disabled['officers'][0]['searchPriority'] = False
        lubu = copy.deepcopy(scenario); lubu['officers'][0]['duelSkill'] = 'fangtian'
        new_skills = []
        for skill in ('xiaoyao', 'huchi', 'laojiang', 'baier', 'baima', 'sanjian', 'zhenjiang', 'qiaorui', 'zhurong'):
            item = copy.deepcopy(scenario); item['officers'][0]['duelSkill'] = skill; new_skills.append(item)
        cases = [version(), scenario, priority, disabled, lubu, *new_skills]
        for value in (0, 4, True, None, 1.5):
            bad = copy.deepcopy(scenario); bad['skills'][0]['maxUses'] = value; cases.append(bad)
        for value in ('__proto__', '', None, 4):
            bad = copy.deepcopy(scenario); bad['officers'][0]['duelSkill'] = value; cases.append(bad)
        for value in (1, 'true', None):
            bad = copy.deepcopy(priority); bad['officers'][0]['searchPriority'] = value; cases.append(bad)
        bad = copy.deepcopy(scenario); bad['officers'][0]['searchPriority'] = True; cases.append(bad)
        code = """import {readFileSync} from 'node:fs';
import {validateScenario} from './hd2d-mvp/src/core/scenario.js';
const base = JSON.parse(readFileSync('hd2d-mvp/data/game-data.json'));
const cases = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(cases.map((s) => { try { validateScenario(s, base); return true; } catch { return false; } })));"""
        browser = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, input=json.dumps(cases), text=True))
        server = []
        for item in cases:
            try: validate(item, BASE); server.append(True)
            except ScenarioError: server.append(False)
        self.assertEqual(server, [True] * 14 + [False] * (len(cases) - 14))
        self.assertEqual(browser, server)

    def test_ruler_passives_and_new_roster_match_browser_validation(self):
        build = """import {readFileSync} from 'node:fs';
import {loadScenario} from './hd2d-mvp/src/core/scenario-store.js';
const base = JSON.parse(readFileSync('hd2d-mvp/data/game-data.json'));
const s = await loadScenario('builtin-sovereigns', base); s.id = 'v-' + 'b'.repeat(32); console.log(JSON.stringify(s));"""
        scenario = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', build], cwd=ROOT, text=True))
        disabled = copy.deepcopy(scenario); disabled['rulerPassives'] = False
        omitted = copy.deepcopy(scenario); del omitted['rulerPassives']
        no_fix = copy.deepcopy(scenario); del no_fix['fixedAiRecruitment']
        no_opening = copy.deepcopy(scenario); del no_opening['factions'][0]['opening']
        empty_opening = copy.deepcopy(scenario); empty_opening['factions'][0]['opening'] = {}
        no_disasters = copy.deepcopy(scenario); del no_disasters['enhancedDisasters']
        disabled_disasters = copy.deepcopy(scenario); disabled_disasters['enhancedDisasters'] = False
        cases = [scenario, disabled, omitted, no_fix, no_opening, empty_opening, no_disasters, disabled_disasters]
        for value in (None, 0, 1, 'true', [], {}):
            bad = copy.deepcopy(scenario); bad['rulerPassives'] = value; cases.append(bad)
            bad = copy.deepcopy(scenario); bad['fixedAiRecruitment'] = value; cases.append(bad)
            bad = copy.deepcopy(scenario); bad['enhancedDisasters'] = value; cases.append(bad)
        for value in (None, [], '100', -1, 10000, True, 1.5):
            bad = copy.deepcopy(scenario); bad['factions'][0]['opening'] = {'gold': value}; cases.append(bad)
        bad = copy.deepcopy(scenario); bad['factions'][0]['opening'] = {'unknown': 10}; cases.append(bad)
        for value in (None, '', '__proto__', '../unsafe', 1, []):
            bad = copy.deepcopy(scenario); bad['skills'][-1]['visualEffect'] = value; cases.append(bad)
        code = """import {readFileSync} from 'node:fs'; import {validateScenario} from './hd2d-mvp/src/core/scenario.js';
const base=JSON.parse(readFileSync('hd2d-mvp/data/game-data.json')), cases=JSON.parse(readFileSync(0,'utf8'));
console.log(JSON.stringify(cases.map(s=>{try {validateScenario(s,base); return true;} catch {return false;}})));"""
        browser = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, input=json.dumps(cases), text=True))
        server = []
        for item in cases:
            try: validate(item, BASE); server.append(True)
            except ScenarioError: server.append(False)
        self.assertEqual(server, [True] * 8 + [False] * (len(cases) - 8))
        self.assertEqual(browser, server)

    def test_new_factions_match_browser_and_reject_inconsistent_rosters(self):
        build = """import {readFileSync} from 'node:fs';
import {loadScenario} from './hd2d-mvp/src/core/scenario-store.js';
const base = JSON.parse(readFileSync('hd2d-mvp/data/game-data.json'));
const s = await loadScenario('builtin-warlords', base); s.id = 'v-' + 'a'.repeat(32); console.log(JSON.stringify(s));"""
        scenario = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', build], cwd=ROOT, text=True))
        candidate = copy.deepcopy(scenario); candidate['rulers'].append({'faction': 7, 'officer': 65})
        cases = [version(), scenario, candidate]
        for key in ('id', 'duplicate_home', 'occupied_home', 'profile', 'duplicate_ruler', 'ruler_city', 'unowned_city', 'missing_ruler', 'null'):
            item = copy.deepcopy(scenario)
            if key == 'id': item['factions'][0]['id'] = 8
            if key == 'duplicate_home': item['factions'][1]['city'] = item['factions'][0]['city']
            if key == 'occupied_home': item['factions'][0]['city'] = 1
            if key == 'profile': item['factions'][0]['aiProfile'] = 9
            if key == 'duplicate_ruler': item['factions'][0]['ruler'] = item['factions'][1]['ruler']
            if key == 'ruler_city': next(o for o in item['officers'] if o['id'] == 246)['city'] = 5
            if key == 'unowned_city': next(o for o in item['officers'] if o['id'] == 249)['city'] = 5
            if key == 'missing_ruler': next(o for o in item['officers'] if o['id'] == 246)['appear'] = 'search_city'
            if key == 'null': item['factions'] = None
            cases.append(item)
        check = """import {readFileSync} from 'node:fs'; import {validateScenario} from './hd2d-mvp/src/core/scenario.js';
const base=JSON.parse(readFileSync('hd2d-mvp/data/game-data.json')); const cases=JSON.parse(readFileSync(0,'utf8'));
console.log(JSON.stringify(cases.map((s)=>{try {validateScenario(s,base); return true;} catch {return false;}})));"""
        browser = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', check], cwd=ROOT, input=json.dumps(cases), text=True))
        server = []
        for item in cases:
            try: validate(item, BASE); server.append(True)
            except ScenarioError: server.append(False)
        self.assertEqual(server, [True] * 3 + [False] * (len(cases) - 3))
        self.assertEqual(browser, server)

    def test_new_equipment_validation_matches_browser_and_preserves_old_versions(self):
        officer = BASE['officers'][130]
        fields = ('id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction')
        scenario = version()
        scenario['weapons'] = [
            {'id': 32, 'name': '朱雀弓', 'cat': '弓', 'atk': 11, 'weight': 5, 'price': 220, 'icon': 'b-bow', 'shops': [8]},
            {'id': 34, 'name': '白羽扇', 'cat': '扇', 'atk': 8, 'weight': 3, 'price': 160, 'icon': 'b-fan', 'shops': [8]},
        ]
        scenario['armors'] = [{'id': 33, 'name': '锦鳞轻甲', 'dfn': 8, 'weight': 5, 'price': 220, 'icon': 'b-female-armor', 'shops': [8]}]
        scenario['officers'] = [{**{key: officer[key] for key in fields}, 'birthYear': None, 'birthCity': None, 'portraitId': 130,
                                  'weapon': 32, 'armor': 9, 'skills': []}]
        invalid = []
        for change in ('duplicate', 'gap', 'icon', 'weapon', 'armor', 'null_armors'):
            item = copy.deepcopy(scenario)
            if change == 'duplicate': item['armors'][0]['id'] = 32
            if change == 'gap': item['weapons'][1]['id'] = 35
            if change == 'icon': item['weapons'][0]['icon'] = '../../.env'
            if change == 'weapon': item['officers'][0]['weapon'] = 33
            if change == 'armor': item['officers'][0]['armor'] = 8
            if change == 'null_armors': item['armors'] = None
            invalid.append(item)
        gated = copy.deepcopy(scenario)
        gated['weapons'][0].update({'grade': 5, 'requirements': {'war': 85, 'int': 40, 'officers': [0, 130]}})
        gated['armors'][0].update({'grade': 4, 'requirements': {'virtue': 70}})
        for field, value in [('grade', 0), ('grade', 6), ('grade', True), ('requirements', None),
                             ('requirements', {'war': 0}), ('requirements', {'int': 100}),
                             ('requirements', {'virtue': True}), ('requirements', {'officers': []}),
                             ('requirements', {'officers': [0, 0]}), ('requirements', {'officers': [999]}),
                             ('requirements', {'unknown': 1})]:
            item = copy.deepcopy(gated); item['weapons'][0][field] = value; invalid.append(item)
        cases = [version(), scenario, gated, *invalid]
        code = """import {readFileSync} from 'node:fs';
import {validateScenario} from './hd2d-mvp/src/core/scenario.js';
const base = JSON.parse(readFileSync('hd2d-mvp/data/game-data.json'));
const cases = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(cases.map((s) => { try { validateScenario(s, base); return true; } catch { return false; } })));"""
        browser = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, input=json.dumps(cases), text=True))
        server = []
        for item in cases:
            try: validate(item, BASE); server.append(True)
            except ScenarioError: server.append(False)
        self.assertEqual(server, [True, True, True] + [False] * len(invalid))
        self.assertEqual(browser, server)

    def test_portraits_relations_and_candidates_match_browser_validation(self):
        code = "import {MAX_PORTRAIT_BYTES,MAX_PORTRAIT_SIDE} from './hd2d-mvp/src/core/scenario.js'; console.log(JSON.stringify([MAX_PORTRAIT_BYTES,MAX_PORTRAIT_SIDE]));"
        maximum, side = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
        self.assertEqual(maximum, MAX_PORTRAIT_BYTES); self.assertEqual(side, MAX_PORTRAIT_SIDE)
        officer = BASE['officers'][130]
        fields = ('id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction')
        png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
        s = version(); s['officers'] = [{**{key: officer[key] for key in fields}, 'birthYear': None, 'birthCity': None, 'portraitId': 130, 'portraitData': png, 'skills': []}]
        s['relations'] = [{'from': 130, 'to': 131, 'kind': '同乡'}]; s['rulers'] = [{'faction': 2, 'officer': 130}]
        self.assertTrue(validate(s, BASE))
        for bad in ('<img>', ' ', '朋友\n', '关' * 17, []):
            invalid = copy.deepcopy(s); invalid['relations'][0]['kind'] = bad
            with self.assertRaises(ScenarioError): validate(invalid, BASE)
        oversized = bytearray(base64.b64decode(png.split(',')[1])); oversized[16:20] = (385).to_bytes(4, 'big')
        oversized_url = 'data:image/png;base64,' + base64.b64encode(oversized).decode('ascii')
        for bad in ('data:image/svg+xml;base64,PHN2Zz4=', png + '\n', 'data:image/png;base64,YWJj', 'data:image/png;base64,' + 'A' * 90000, oversized_url):
            invalid = copy.deepcopy(s); invalid['officers'][0]['portraitData'] = bad
            with self.assertRaises(ScenarioError): validate(invalid, BASE)
        for candidate in ({'faction': 2, 'officer': 131}, {'faction': 2, 'officer': 0}, {'faction': 4, 'officer': 130}):
            invalid = copy.deepcopy(s); invalid['rulers'] = [candidate]
            with self.assertRaises(ScenarioError): validate(invalid, BASE)
        invalid = copy.deepcopy(s); invalid['rulers'].append({'faction': 2, 'officer': 130})
        with self.assertRaises(ScenarioError): validate(invalid, BASE)

    def test_atomic_publication_never_overwrites_a_version(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = VersionRepository(temp, BASE_PATH)
            a, b = version(), version(); b['name'] = '不同版本'
            def publish(item):
                try: repo.publish(item); return 'published'
                except FileExistsError: return 'conflict'
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(publish, [a, b]))
            self.assertEqual(sorted(results), ['conflict', 'published'])
            existing = repo.read(a['id']); self.assertIn(existing, [a, b])
            self.assertEqual(repo.publish(existing)['id'], a['id'])  # 安全重试
            self.assertEqual(len(repo.list()), 1)
            self.assertEqual(sorted(os.listdir(temp)), [a['id'] + '.json'])


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.process = None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.start_server()

    def start_server(self, token=TOKEN, token_file=None, version_dir=None):
        self.process, self.url = self.launch_server(token, token_file, version_dir)

    def launch_server(self, token=TOKEN, token_file=None, version_dir=None):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        env = dict(os.environ, GAME_VERSION_DIR=str(version_dir or self.temp.name), GAME_ADMIN_TOKEN=token, PYTHONDONTWRITEBYTECODE='1')
        if token_file is None:
            env.pop('GAME_ADMIN_TOKEN_FILE', None)
        else:
            env['GAME_ADMIN_TOKEN_FILE'] = str(token_file)
        process = subprocess.Popen([sys.executable, 'hd2d-mvp/tools/serve.py', str(port)], cwd=ROOT, env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        url = f'http://127.0.0.1:{port}'
        for _ in range(100):
            try:
                self.request('/api/versions', url=url); return process, url
            except urllib.error.URLError:
                if process.poll() is not None:
                    message = process.stderr.read().decode(); process.stderr.close()
                    raise RuntimeError(message)
                time.sleep(.05)
        process.terminate(); process.wait(timeout=5); process.stderr.close()
        raise RuntimeError('server did not start')

    def request(self, path, *, value=None, token=None, origin=None, url=None, include_headers=False):
        headers = {}
        if token is not None: headers['Authorization'] = 'Bearer ' + token
        if origin is not None: headers['Origin'] = origin
        body = None
        if value is not None:
            body = json.dumps(value, ensure_ascii=False).encode('utf-8'); headers['Content-Type'] = 'application/json'
        req = urllib.request.Request((url or self.url) + path, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=5) as response:
                result = (response.status, json.load(response))
                return (*result, response.headers) if include_headers else result
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def stop_server(self):
        if self.process:
            self.process.terminate(); self.process.wait(timeout=5)
            messages = self.process.stderr.read().decode(); self.process.stderr.close(); self.process = None
            return messages
        return ''

    def tearDown(self):
        self.stop_server(); self.temp.cleanup()

    def asset_request(self, path, data=None, token=None, mime='image/png', origin=None):
        headers = {'Content-Type': mime} if data is not None else {}
        if token is not None: headers['Authorization'] = 'Bearer ' + token
        if origin is not None: headers['Origin'] = origin
        req = urllib.request.Request(self.url + path, data=data, headers=headers)
        try:
            with self.opener.open(req, timeout=5) as response:
                body = response.read()
                return response.status, body, response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.read(), error.headers

    def test_visual_assets_are_authenticated_validated_deduplicated_and_persistent(self):
        image = (ROOT / 'hd2d-mvp/assets/characters/sun/motion.png').read_bytes()
        self.assertEqual(self.asset_request('/api/assets', image)[0], 401)
        self.assertEqual(self.asset_request('/api/assets', image, TOKEN, origin='https://other.example')[0], 403)
        self.assertEqual(self.asset_request('/api/assets', b'not an image', TOKEN)[0], 400)
        self.assertEqual(self.asset_request('/api/assets', image, TOKEN, mime='image/webp')[0], 400)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.asset_request('/api/assets', image, TOKEN), range(4)))
        self.assertTrue(all(status == 201 for status, _, _ in results))
        asset = json.loads(results[0][1]); self.assertEqual((asset['width'], asset['height']), (512, 512))
        self.assertTrue(all(json.loads(body)['id'] == asset['id'] for _, body, _ in results))
        status, body, headers = self.asset_request('/api/assets/' + asset['id'])
        self.assertEqual((status, body, headers['Content-Type']), (200, image, 'image/png'))
        self.assertIn('immutable', headers['Cache-Control'])
        status, _, headers = self.asset_request('/api/assets/a-' + '0' * 64)
        self.assertEqual(status, 404); self.assertEqual(headers['Cache-Control'], 'no-store')
        self.stop_server(); self.start_server()
        self.assertEqual(self.asset_request('/api/assets/' + asset['id'])[1], image)
        (Path(self.temp.name) / 'assets' / asset['id']).write_bytes(b'changed')
        self.assertEqual(self.asset_request('/api/assets/' + asset['id'])[0], 500)

    def test_visual_refs_must_exist_and_motion_has_the_required_grid(self):
        image = (ROOT / 'hd2d-mvp/assets/characters/sun/portrait.webp').read_bytes()
        status, body, _ = self.asset_request('/api/assets', image, TOKEN, mime='image/webp')
        self.assertEqual(status, 201); asset = json.loads(body)['id']
        old = BASE['officers'][130]
        keys = ('id', 'name', 'hp', 'war', 'int', 'virtue', 'loyalty', 'level', 'exp', 'soldiers', 'weapon', 'armor', 'army', 'year', 'death', 'appear', 'city', 'faction')
        officer = {**{k: old[k] for k in keys}, 'birthYear': None, 'birthCity': None, 'portraitId': 130, 'skills': [], 'visual': {'portrait': asset}}
        s = version(); s['officers'] = [officer]
        self.assertEqual(self.request('/api/versions', value=s, token=TOKEN)[0], 201)
        missing = copy.deepcopy(s); missing['id'] = 'v-' + 'b' * 32; missing['officers'][0]['visual']['portrait'] = 'a-' + 'a' * 64
        self.assertEqual(self.request('/api/versions', value=missing, token=TOKEN)[0], 400)
        wrong = copy.deepcopy(s); wrong['id'] = 'v-' + 'c' * 32; wrong['officers'][0]['visual']['motion'] = asset
        self.assertEqual(self.request('/api/versions', value=wrong, token=TOKEN)[0], 400)
        unsafe = copy.deepcopy(s); unsafe['id'] = 'v-' + 'd' * 32; unsafe['officers'][0]['visual']['portrait'] = '../../.env'
        self.assertEqual(self.request('/api/versions', value=unsafe, token=TOKEN)[0], 400)

    def test_invalid_and_symlinked_assets_are_not_accepted(self):
        image = (ROOT / 'hd2d-mvp/assets/characters/sun/motion.png').read_bytes()
        corrupt = bytearray(image); corrupt[-1] ^= 1
        self.assertEqual(self.asset_request('/api/assets', bytes(corrupt), TOKEN)[0], 400)
        # 只发送请求头：服务器应在读取大文件之前拒绝，避免客户端继续发送时连接被重置。
        port = int(self.url.rsplit(':', 1)[1])
        with socket.create_connection(('127.0.0.1', port), timeout=5) as connection:
            request = (f'POST /api/assets HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n'
                       f'Authorization: Bearer {TOKEN}\r\nContent-Type: image/png\r\n'
                       f'Content-Length: {1024 * 1024 + 1}\r\nConnection: close\r\n\r\n')
            connection.sendall(request.encode('ascii'))
            self.assertTrue(connection.recv(1024).startswith(b'HTTP/1.0 413 '))
        with tempfile.TemporaryDirectory() as outside:
            (Path(self.temp.name) / 'assets').symlink_to(outside, target_is_directory=True)
            self.assertEqual(self.asset_request('/api/assets', image, TOKEN)[0], 500)
            self.assertEqual(os.listdir(outside), [])

    def test_m4a_static_content_type(self):
        with tempfile.TemporaryDirectory(prefix='music-test-', dir=ROOT / 'hd2d-mvp') as temp:
            path = Path(temp) / 'track.m4a'
            path.write_bytes(b'audio fixture')
            url = self.url + '/' + path.relative_to(ROOT).as_posix()
            for method in ('GET', 'HEAD'):
                with self.opener.open(urllib.request.Request(url, method=method)) as response:
                    self.assertEqual(response.headers.get_content_type(), 'audio/mp4')
                    self.assertEqual(response.read(), b'audio fixture' if method == 'GET' else b'')

    def test_authentication_publication_and_restart(self):
        s = version(); self.assertEqual(self.request('/api/versions'), (200, []))
        self.assertEqual(self.request('/api/versions', value=s)[0], 401)
        self.assertEqual(self.request('/api/versions', value=s, token='wrong')[0], 401)
        self.assertEqual(self.request('/api/versions', value=s, token=TOKEN, origin='http://other.example')[0], 403)
        self.assertEqual(self.request('/api/versions', value=s, token=TOKEN, origin='http://[')[0], 403)
        invalid = dict(s, name='<script>')
        self.assertEqual(self.request('/api/versions', value=invalid, token=TOKEN)[0], 400)
        invalid = dict(s, relations=[{'from': 0, 'to': 1, 'kind': []}])
        self.assertEqual(self.request('/api/versions', value=invalid, token=TOKEN)[0], 400)
        self.assertEqual(self.request('/api/versions'), (200, []))
        self.assertEqual(self.request('/api/versions', value=s, token=TOKEN)[0], 201)
        self.assertEqual(self.request('/api/versions', value=s, token=TOKEN)[0], 201)
        self.assertEqual(self.request('/api/versions', value=dict(s, name='另一个版本'), token=TOKEN)[0], 409)
        self.assertEqual(self.request('/api/versions/' + s['id']), (200, s))
        self.stop_server(); self.start_server()
        self.assertEqual(self.request('/api/versions/' + s['id']), (200, s))
        self.assertEqual(self.request('/api/versions')[1][0]['id'], s['id'])

    def test_corrupt_versions_are_isolated_and_reported(self):
        good = version(); self.assertEqual(self.request('/api/versions', value=good, token=TOKEN)[0], 201)
        directory = Path(self.temp.name)
        (directory / f"{version('b')['id']}.json").write_text('{broken', encoding='ascii')
        (directory / f"{version('c')['id']}.json").write_bytes(b'\xff')
        (directory / f"{version('d')['id']}.json").symlink_to(directory / f"{good['id']}.json")
        (directory / f"{version('e')['id']}.json").mkdir()
        os.mkfifo(directory / f"{version('f')['id']}.json")
        (directory / f"{version('1')['id']}.json").write_text('[' * 2000 + '0' + ']' * 2000, encoding='ascii')
        expected = 6
        if getattr(os, 'geteuid', lambda: 0)() != 0:
            unreadable = directory / f"{version('2')['id']}.json"
            unreadable.write_text(json.dumps(version('2')), encoding='utf-8'); unreadable.chmod(0)
            expected += 1
        (directory / 'v-invalid.json').write_text('ignored', encoding='ascii')
        status, items, headers = self.request('/api/versions', include_headers=True)
        self.assertEqual(status, 200); self.assertIsInstance(items, list)
        self.assertEqual([item['id'] for item in items], [good['id']])
        self.assertEqual(headers.get('X-Game-Version-Skipped'), str(expected))
        self.assertEqual(self.request('/api/versions/' + good['id']), (200, good))
        self.assertEqual(self.request('/api/versions/' + version('1')['id'])[0], 500)
        self.assertEqual(self.request('/api/versions', value=version('0'), token=TOKEN)[0], 201)
        self.assertEqual(len(self.request('/api/versions')[1]), 2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            pending = [pool.submit(self.request, '/api/versions', value=version(letter), token=TOKEN) for letter in '3456']
            for _ in range(3):
                status, items, headers = self.request('/api/versions', include_headers=True)
                self.assertEqual(status, 200); self.assertEqual(headers.get('X-Game-Version-Skipped'), str(expected))
                self.assertIn(good['id'], [item['id'] for item in items])
            self.assertEqual([job.result()[0] for job in pending], [201] * 4)
        self.assertEqual(len(self.request('/api/versions')[1]), 6)
        self.assertEqual((directory / f"{version('b')['id']}.json").read_text(), '{broken')
        self.assertIn(version('b')['id'], self.stop_server())

    def test_unavailable_version_directory_is_a_server_error(self):
        bad_directory = Path(self.temp.name) / 'not-a-directory'
        bad_directory.write_text('test', encoding='ascii')
        self.stop_server(); self.start_server(version_dir=bad_directory)
        self.assertEqual(self.request('/api/versions')[0], 500)

    def test_unconfigured_server_is_read_only(self):
        self.stop_server(); self.start_server(token='')
        self.assertEqual(self.request('/api/versions'), (200, []))
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        self.assertEqual(os.listdir(self.temp.name), [])

    def test_persisted_token_survives_restart_and_can_be_rotated(self):
        token_file = Path(self.temp.name) / 'admin' / 'token'
        second = 'rotated-token-' + 'y' * 40
        self.stop_server(); self.start_server(token=TOKEN, token_file=token_file)
        self.assertTrue(token_file.is_file())
        stored = token_file.read_text(encoding='ascii')
        self.assertNotIn(TOKEN, stored)
        self.assertEqual(stat.S_IMODE(token_file.stat().st_mode), 0o600)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 201)

        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 201)
        self.stop_server(); self.start_server(token='too-short', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        self.assertEqual(token_file.read_text(encoding='ascii'), stored)
        rotator, _ = self.launch_server(token=second, token_file=token_file)
        try:
            self.assertEqual(self.request('/api/versions', value=version(), token=second)[0], 503)
        finally:
            rotator.terminate(); rotator.wait(timeout=5); rotator.stderr.close()

        self.stop_server(); self.start_server(token=second, token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 401)
        self.assertEqual(self.request('/api/versions', value=version(), token=second)[0], 201)
        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=second)[0], 201)

    def test_token_rotation_is_seen_by_all_running_instances(self):
        token_file = Path(self.temp.name) / 'admin' / 'token'
        rotated = 'rotated-token-' + 'y' * 40
        self.stop_server(); self.start_server(token=TOKEN, token_file=token_file)
        second, second_url = self.launch_server(token=rotated, token_file=token_file)
        try:
            for url in (self.url, second_url):
                self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN, url=url)[0], 401)
                self.assertEqual(self.request('/api/versions', value=version(), token=rotated, url=url)[0], 201)
        finally:
            second.terminate(); second.wait(timeout=5); second.stderr.close()

    def test_running_server_checks_token_file_on_each_request(self):
        token_file = Path(self.temp.name) / 'admin' / 'token'
        self.stop_server(); self.start_server(token=TOKEN, token_file=token_file)
        stored = token_file.read_text(encoding='ascii')
        token_file.chmod(0o644)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        token_file.chmod(0o600)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 201)
        token_file.write_text('invalid', encoding='ascii')
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        token_file.unlink()
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        token_file.write_text(stored, encoding='ascii'); token_file.chmod(0o600)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 201)
        directory, renamed = token_file.parent, token_file.parent.with_name('admin-previous')
        directory.rename(renamed); directory.symlink_to(renamed, target_is_directory=True)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        directory.unlink(); renamed.rename(directory)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 201)

    def test_a_later_first_configuration_is_seen_by_an_unconfigured_instance(self):
        token_file = Path(self.temp.name) / 'admin' / 'token'
        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        second, _ = self.launch_server(token=TOKEN, token_file=token_file)
        try:
            self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 201)
        finally:
            second.terminate(); second.wait(timeout=5); second.stderr.close()

    @unittest.skipUnless(getattr(os, 'geteuid', lambda: -1)() == 0, '验证其他用户所有权需要 root')
    def test_other_users_cannot_supply_token_directory_or_file(self):
        directory = Path(self.temp.name) / 'admin'
        token_file = directory / 'token'
        self.stop_server(); self.start_server(token=TOKEN, token_file=token_file)
        stored = token_file.read_text(encoding='ascii')
        os.chown(token_file, 12345, -1)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        os.chown(token_file, 0, -1); os.chown(directory, 12345, -1)
        self.stop_server(); self.start_server(token='new-token-' + 'z' * 40, token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        self.assertEqual(token_file.read_text(encoding='ascii'), stored)
        os.chown(directory, 0, -1)

    def test_unsafe_or_corrupt_token_file_disables_publication(self):
        token_file = Path(self.temp.name) / 'token'
        token_file.write_text('invalid', encoding='ascii'); token_file.chmod(0o600)
        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        self.assertEqual(token_file.read_text(encoding='ascii'), 'invalid')

        self.stop_server(); self.start_server(token=TOKEN, token_file=token_file)
        token_file.chmod(0o644)
        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)

    def test_token_file_links_and_writable_directories_are_not_trusted(self):
        directory = Path(self.temp.name) / 'admin'; directory.mkdir(mode=0o700)
        target = Path(self.temp.name) / 'other-file'; target.write_text('preserve', encoding='ascii')
        token_file = directory / 'token'; token_file.symlink_to(target)
        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        self.stop_server(); self.start_server(token=TOKEN, token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 201)
        self.assertFalse(token_file.is_symlink()); self.assertEqual(target.read_text(encoding='ascii'), 'preserve')

        directory.chmod(0o777)
        self.stop_server(); self.start_server(token='', token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        stored = token_file.read_text(encoding='ascii')
        self.stop_server(); self.start_server(token='new-token-' + 'z' * 40, token_file=token_file)
        self.assertEqual(self.request('/api/versions', value=version(), token=TOKEN)[0], 503)
        self.assertEqual(token_file.read_text(encoding='ascii'), stored)

    def test_extremely_long_content_length_is_rejected(self):
        port = int(self.url.rsplit(':', 1)[1])
        with socket.create_connection(('127.0.0.1', port), timeout=5) as connection:
            request = (f'POST /api/versions HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n'
                       f'Authorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\n'
                       f'Content-Length: {"9" * 5000}\r\nConnection: close\r\n\r\n')
            connection.sendall(request.encode('ascii'))
            response = connection.recv(1024)
        self.assertTrue(response.startswith(b'HTTP/1.0 413 '), response)
        self.assertEqual(self.request('/api/versions'), (200, []))


class StaticProtectionTest(unittest.TestCase):
    def test_env_files_hidden_paths_and_links_cannot_be_read(self):
        with tempfile.TemporaryDirectory() as temp:
            # 仓库本身可以位于名称以 .env 开头的上级目录中。
            root = Path(temp) / '.env-parent' / 'project'; game = root / 'hd2d-mvp'
            (game / 'tools').mkdir(parents=True); (game / 'data').mkdir()
            for name in ('serve.py', 'scenario_store.py'):
                shutil.copyfile(ROOT / 'hd2d-mvp/tools' / name, game / 'tools' / name)
            shutil.copyfile(BASE_PATH, game / 'data/game-data.json')
            (root / '.env').write_text('SECRET=fake-token\n', encoding='ascii')
            (game / '.env.local').write_text('SECRET=another-fake-token\n', encoding='ascii')
            (game / '.envrc').write_text('SECRET=another-fake-token\n', encoding='ascii')
            (root / '.git').mkdir(); (root / '.git/config').write_text('private', encoding='ascii')
            (game / 'index.html').write_text('public page', encoding='ascii')
            (game / 'secret-link').symlink_to(root / '.env')
            (game / 'envrc-link').symlink_to(game / '.envrc')
            (game / 'git-link').symlink_to(root / '.git', target_is_directory=True)
            shared = Path(temp) / '.env-parent' / 'shared'; shared.mkdir()
            (shared / 'asset.txt').write_text('shared asset', encoding='ascii')
            (shared / '.envrc').write_text('SECRET=fake-external-token\n', encoding='ascii')
            (game / 'public-link').symlink_to(shared / 'asset.txt')
            (game / 'external-env-link').symlink_to(shared / '.envrc')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            env = dict(os.environ, GAME_VERSION_DIR=str(root / 'versions'), GAME_ADMIN_TOKEN='', PYTHONDONTWRITEBYTECODE='1')
            env.pop('GAME_ADMIN_TOKEN_FILE', None)
            process = subprocess.Popen([sys.executable, str(game / 'tools/serve.py'), str(port)], cwd=root, env=env,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            url = f'http://127.0.0.1:{port}'
            try:
                for _ in range(100):
                    try:
                        with opener.open(url + '/hd2d-mvp/index.html', timeout=1) as response:
                            self.assertEqual(response.read(), b'public page')
                        break
                    except urllib.error.HTTPError as error:
                        self.fail(f'public page returned HTTP {error.code}')
                    except urllib.error.URLError:
                        if process.poll() is not None:
                            raise RuntimeError(process.stderr.read().decode())
                        time.sleep(.05)
                else:
                    self.fail('server did not start')
                with opener.open(url + '/hd2d-mvp/public-link', timeout=5) as response:
                    self.assertEqual(response.read(), b'shared asset')
                for path in ('/.env', '/%2eenv', '/hd2d-mvp/.env.local', '/hd2d-mvp/%2e%2e/.env',
                             '/.git/config', '/hd2d-mvp/secret-link', '/hd2d-mvp/envrc-link',
                             '/hd2d-mvp/git-link/config', '/hd2d-mvp/external-env-link'):
                    with self.subTest(path=path):
                        for method in ('GET', 'HEAD'):
                            req = urllib.request.Request(url + path, method=method)
                            with self.assertRaises(urllib.error.HTTPError) as raised:
                                opener.open(req, timeout=5)
                            self.assertEqual(raised.exception.code, 404)

                process.terminate(); process.wait(timeout=5); process.stderr.close()
                token_file = game / 'admin-token'
                env.update(GAME_ADMIN_TOKEN=TOKEN, GAME_ADMIN_TOKEN_FILE=str(token_file))
                process = subprocess.Popen([sys.executable, str(game / 'tools/serve.py'), str(port)], cwd=root, env=env,
                                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                body = json.dumps(version(), ensure_ascii=False).encode('utf-8')
                req = urllib.request.Request(url + '/api/versions', data=body,
                                             headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
                for _ in range(100):
                    try:
                        with opener.open(url + '/api/versions', timeout=1): break
                    except urllib.error.URLError:
                        if process.poll() is not None:
                            raise RuntimeError(process.stderr.read().decode())
                        time.sleep(.05)
                else:
                    self.fail('server did not restart')
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    opener.open(req, timeout=5)
                self.assertEqual(raised.exception.code, 503)
                self.assertFalse(token_file.exists(), 'token files must be outside the served directory')
            finally:
                process.terminate(); process.wait(timeout=5); process.stderr.close()


if __name__ == '__main__':
    unittest.main()
