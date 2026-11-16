import concurrent.futures
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
from scenario_store import ScenarioError, VersionRepository, base_signature, validate

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
