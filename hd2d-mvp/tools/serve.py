"""Static dev server for the game with caching disabled (ES modules otherwise go stale).
  python3 hd2d-mvp/tools/serve.py [port=8642]   → http://localhost:8642/hd2d-mvp/ (the bare origin redirects there, muted)
Serves the repository root, so hd2d-mvp/ is served under /hd2d-mvp/ as in the desktop package's layout.
The page loads three.js and its two web fonts from vendor/, the layout desktop/build-app.mjs ships; here they come
straight from desktop/node_modules (npm --prefix hd2d-mvp/desktop install, once), so the game needs no network."""
import io
import hashlib
import hmac
import json
import os
import posixpath
import re
import signal
import socket
import stat
import sys
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import unquote, urlsplit
from scenario_store import MAX_BYTES, MAX_ASSET_BYTES, ScenarioError, VersionRepository

root = Path(__file__).resolve().parents[2]
mods = root / 'hd2d-mvp/desktop/node_modules'
VENDOR = '/hd2d-mvp/vendor/'
# The families and weights the game uses, as in desktop/build-app.mjs.
FACES = [('noto-serif-sc', (400, 600, 900)), ('ma-shan-zheng', (400,))]
version_dir = os.environ.get('GAME_VERSION_DIR') or str(Path.home() / '.local/share/threekindoms/versions')
versions = VersionRepository(version_dir,
                             root / 'hd2d-mvp/data/game-data.json')


def trusted_owner(info):
    get_uid = getattr(os, 'geteuid', None)
    if get_uid is None or not hasattr(info, 'st_uid'):
        raise ValueError('无法验证管理员令牌存储的所有者')
    return info.st_uid in (0, get_uid())


def check_admin_directory(directory):
    if directory.resolve() != directory:
        raise ValueError('管理员令牌目录已更改')
    info = directory.stat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o022 or not trusted_owner(info):
        raise ValueError('管理员令牌目录所有者或访问权限不安全')


def read_admin_digest(path):
    try:
        check_admin_directory(path.parent)
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077 or not trusted_owner(info):
            raise ValueError('管理员令牌文件所有者或访问权限不安全')
        with os.fdopen(fd, 'rb') as saved:
            fd = None
            digest = saved.read(65).decode('ascii')
    finally:
        if fd is not None:
            os.close(fd)
    if not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError('管理员令牌文件内容无效')
    return digest


def configure_admin():
    """保存令牌校验值；未配置持久路径时维持进程内认证。"""
    token = os.environ.get('GAME_ADMIN_TOKEN', '')
    filename = os.environ.get('GAME_ADMIN_TOKEN_FILE', '')
    try:
        path = None
        if filename:
            path = Path(filename).expanduser()
            if not path.is_absolute():
                raise ValueError('管理员令牌文件须使用绝对路径')
            parent = path.parent.resolve()
            if parent == root or root in parent.parents:
                raise ValueError('管理员令牌文件须位于静态服务目录之外')
            path = parent / path.name
        if token:
            if not re.fullmatch(r'[!-~]{32,256}', token):
                raise ValueError('管理员令牌须为 32–256 位不含空格的可打印 ASCII 字符')
            digest = hashlib.sha256(token.encode('ascii')).hexdigest()
            if path:
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                check_admin_directory(path.parent)
                fd, temporary = tempfile.mkstemp(prefix='.token-', dir=path.parent)
                try:
                    with os.fdopen(fd, 'w', encoding='ascii') as output:
                        os.fchmod(output.fileno(), 0o600)
                        output.write(digest); output.flush(); os.fsync(output.fileno())
                    os.replace(temporary, path)
                finally:
                    if os.path.exists(temporary): os.unlink(temporary)
            return digest, path
        if not path:
            return None, None
        return read_admin_digest(path), path
    except (OSError, ValueError, UnicodeError, RuntimeError) as error:
        print(f'管理员令牌不可用：{error}；已禁用发布。', file=sys.stderr)
        # 显式配置失败时不能回退到旧文件，即使它后来变得可读。
        return None, None


admin_digest, admin_file = configure_admin()
admin_file_lock = Lock()
admin_file_error = None


def current_admin_digest():
    """使用共享持久文件的进程在每次认证时读取最新校验值。"""
    global admin_file_error
    if admin_file is None:
        return admin_digest
    try:
        digest = read_admin_digest(admin_file)
        error = '令牌文件不存在' if digest is None else None
    except (OSError, ValueError, UnicodeError, RuntimeError) as exc:
        digest, error = None, str(exc)
    with admin_file_lock:
        if error and error != admin_file_error:
            print(f'管理员令牌不可用：{error}；已禁用发布。', file=sys.stderr)
        admin_file_error = error
    return digest

def fonts_css():
    # @fontsource's per-weight sheets, woff2 only; their url(./files/…) resolve under vendor/fonts/files/.
    return ''.join(re.sub(r",\s*url\([^)]*\.woff\) format\('woff'\)", '', (mods / '@fontsource' / pkg / f'{w}.css').read_text()) + '\n'
                   for pkg, weights in FACES for w in weights)


def asset_availability():
    """只检查清单中的游戏素材，不接受客户端提供的文件路径。"""
    game = root / 'hd2d-mvp'
    manifest = json.loads((game / 'assets/manifest.json').read_text(encoding='utf-8'))
    found = {}
    for group in ('portraits', 'sprites', 'audio'):
        for value in manifest.get(group, {}).values():
            for url in value if isinstance(value, list) else [value]:
                if not isinstance(url, str) or not re.fullmatch(r'assets/[A-Za-z0-9_./-]+', url) or '..' in url.split('/'):
                    continue
                file = game / url
                found[url] = file.is_file() and os.access(file, os.R_OK)
    return found

class GameHTTPServer(ThreadingHTTPServer):
    # 浏览器启动时并发请求大量模块，默认队列可能导致连接重置。
    request_queue_size = 128

    def handle_error(self, request, client_address):
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionResetError)):
            print(f'客户端在请求处理期间断开连接（{type(error).__name__}）。', file=sys.stderr)
            return
        super().handle_error(request, client_address)

class NoCache(SimpleHTTPRequestHandler):
    # 某些精简容器没有系统 MIME 数据库，显式声明游戏使用的音频格式。
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.m4a': 'audio/mp4'}

    def end_headers(self):
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable' if getattr(self, '_immutable_asset', False) else 'no-store')
        super().end_headers()
    def log_message(self, *a): pass

    def do_HEAD(self):
        self._immutable_asset = False
        return super().do_HEAD()

    def json_response(self, status, value, headers=None):
        body = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        for name, content in (headers or {}).items():
            self.send_header(name, content)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._immutable_asset = False
        path = urlsplit(self.path).path
        if path == '/api/asset-availability':
            try: self.json_response(200, asset_availability())
            except (OSError, ValueError, TypeError, AttributeError) as error:
                print(f'读取素材清单失败：{error}', file=sys.stderr)
                self.json_response(503, {'error': '素材清单不可用'})
            return
        asset = re.fullmatch(r'/api/assets/(a-[a-f0-9]{64})', path)
        if asset:
            try:
                body, (content_type, _, _) = versions.read_asset(asset.group(1))
                self._immutable_asset = True
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers(); self.wfile.write(body)
            except FileNotFoundError: self.json_response(404, {'error': '素材不存在'})
            except (BrokenPipeError, ConnectionResetError): return
            except (OSError, ValueError) as error:
                print(f'读取游戏素材失败：{error}', file=sys.stderr)
                self.json_response(500, {'error': '素材无法读取'})
            return
        if path == '/api/versions':
            try:
                skipped = []
                result = versions.list(on_error=skipped.append)
                headers = {'X-Game-Version-Skipped': str(len(skipped))} if skipped else None
                self.json_response(200, result, headers)
            except (OSError, ScenarioError) as error:
                print(f'读取游戏版本失败：{error}', file=sys.stderr)
                self.json_response(500, {'error': '无法读取已发布的游戏版本'})
            return
        match = re.fullmatch(r'/api/versions/(v-[a-f0-9]{32})', path)
        if match:
            try: self.json_response(200, versions.read(match.group(1)))
            except FileNotFoundError: self.json_response(404, {'error': '游戏版本不存在'})
            except (OSError, ValueError, UnicodeError, RecursionError) as error:
                print(f'读取游戏版本失败：{error}', file=sys.stderr)
                self.json_response(500, {'error': '游戏版本无法读取'})
            return
        if path.startswith('/api/'):
            self.json_response(404, {'error': '接口不存在'}); return
        super().do_GET()

    def do_POST(self):
        self._immutable_asset = False
        path = urlsplit(self.path).path
        if path not in ('/api/versions', '/api/assets'):
            self.json_response(404, {'error': '接口不存在'}); return
        uploading = path == '/api/assets'
        digest = current_admin_digest()
        if not digest:
            self.json_response(503, {'error': '服务器未配置有效的管理员令牌'}); return
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer ') or not hmac.compare_digest(hashlib.sha256(auth[7:].encode('utf-8')).hexdigest(), digest):
            self.json_response(401, {'error': '管理员令牌无效'}); return
        origin = self.headers.get('Origin')
        if origin:
            try: parsed = urlsplit(origin)
            except ValueError:
                self.json_response(403, {'error': '请求来源不匹配'}); return
            if parsed.scheme not in ('http', 'https') or parsed.netloc != self.headers.get('Host') or parsed.path not in ('', '/'):
                self.json_response(403, {'error': '请求来源不匹配'}); return
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or not re.fullmatch(r'[0-9]+', lengths[0]) or self.headers.get('Transfer-Encoding'):
            self.json_response(400, {'error': '请求长度无效'}); return
        digits = lengths[0].lstrip('0') or '0'
        limit = MAX_ASSET_BYTES if uploading else MAX_BYTES
        if len(digits) > len(str(limit)):
            self.json_response(413, {'error': '文件过大或为空'}); return
        size = int(digits)
        if size <= 0 or size > limit:
            self.json_response(413, {'error': '文件过大或为空'}); return
        content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        if content_type not in (('image/png', 'image/webp') if uploading else ('application/json',)):
            self.json_response(415, {'error': '素材需要 PNG 或 WebP 格式' if uploading else '需要 JSON 格式'}); return
        try:
            self.connection.settimeout(10)
            raw = self.rfile.read(size)
            if len(raw) != size: raise ValueError('incomplete body')
            if uploading:
                result = versions.put_asset(raw, content_type)
            else:
                value = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid number')))
                result = versions.publish(value)
        except FileExistsError:
            self.json_response(409, {'error': '版本编号已存在且内容不同'}); return
        except (ValueError, UnicodeError, RecursionError, socket.timeout) as error:
            self.json_response(400, {'error': str(error) if isinstance(error, ScenarioError) else '素材文件无效' if uploading else '版本文件无效'}); return
        except OSError as error:
            print(f'保存游戏{"素材" if uploading else "版本"}失败：{error}', file=sys.stderr)
            self.json_response(500, {'error': '无法保存游戏素材，请检查服务器存储' if uploading else '无法保存游戏版本，请检查服务器存储'}); return
        self.json_response(201, result)

    def translate_path(self, path):
        p = unquote(path.split('?', 1)[0].split('#', 1)[0])
        if p.startswith(VENDOR):
            rest = posixpath.normpath(p[len(VENDOR):])
            if rest.startswith('three/') and '..' not in rest.split('/'):
                return str(mods / rest)
            if rest.startswith('fonts/files/') and rest.count('/') == 2:
                for pkg, _ in FACES:
                    f = mods / '@fontsource' / pkg / 'files' / rest.rsplit('/', 1)[1]
                    if f.exists(): return str(f)
            return str(mods / '.missing')
        return super().translate_path(path)
    # The repository root has no page of its own: a bare origin (what a preview opens) goes to the game,
    # muted, since development and tests never play sound (AGENTS.md).
    def send_head(self):
        p = self.path.split('?', 1)[0]
        decoded = unquote(p).replace('\\', '/')
        if any(part.startswith('.') for part in decoded.split('/') if part):
            self.send_error(404); return None
        if p == '/':
            self.send_response(302)
            self.send_header('Location', '/hd2d-mvp/?mute')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        if p.startswith(VENDOR) and not mods.is_dir():
            self.send_error(503, 'three.js and the fonts come from hd2d-mvp/desktop/node_modules: run npm --prefix hd2d-mvp/desktop install')
            return None
        if p == VENDOR + 'fonts/fonts.css':
            body = fonts_css().encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/css; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        try:
            target = Path(self.translate_path(p)).resolve()
            relative = target.relative_to(root) if target == root or root in target.parents else None
            if relative is not None:
                protected = any(part.startswith('.') for part in relative.parts)
            else:
                common = Path(os.path.commonpath((root, target)))
                protected = any(part.lower() == '.git' or part.lower().startswith('.env') for part in target.relative_to(common).parts)
            if protected:
                self.send_error(404); return None
        except (OSError, RuntimeError, ValueError):
            self.send_error(404); return None
        return super().send_head()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
if not mods.is_dir():
    print('Note: hd2d-mvp/desktop/node_modules is missing, so three.js and the fonts will not load;'
          ' run npm --prefix hd2d-mvp/desktop install', file=sys.stderr)
# A clone of the open-source repository has no art until its Release asset pack is unzipped (and an old LFS clone only
# pointer files): say so instead of a page of broken images.
for probe in ('hd2d-mvp/assets/ai/portraits/0.webp', 'hd2d-mvp/assets/ai/sandtable/board/albedo.webp'):
    p = root / probe
    if not p.is_file() or p.read_bytes()[:24] == b'version https://git-lfs.':
        print('Note: the art is missing from hd2d-mvp/assets/;'
              ' unzip the asset pack from the Releases page in the repository root (see README.md)', file=sys.stderr)
        break
def terminate(_signum, _frame):
    raise SystemExit(0)

# 容器中的 Python 可能是 PID 1，需要显式处理停止信号。
signal.signal(signal.SIGTERM, terminate)
with GameHTTPServer(('', port), partial(NoCache, directory=str(root))) as server:
    server.serve_forever()
