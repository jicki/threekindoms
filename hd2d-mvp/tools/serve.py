"""Static dev server for the game with caching disabled (ES modules otherwise go stale).
  python3 hd2d-mvp/tools/serve.py [port=8642]   → http://localhost:8642/hd2d-mvp/ (the bare origin redirects there, muted)
Serves the repository root, so hd2d-mvp/ is served under /hd2d-mvp/ as in the desktop package's layout.
The page loads three.js and its two web fonts from vendor/, the layout desktop/build-app.mjs ships; here they come
straight from desktop/node_modules (npm --prefix hd2d-mvp/desktop install, once), so the game needs no network."""
import io
import posixpath
import re
import signal
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

root = Path(__file__).resolve().parents[2]
mods = root / 'hd2d-mvp/desktop/node_modules'
VENDOR = '/hd2d-mvp/vendor/'
# The families and weights the game uses, as in desktop/build-app.mjs.
FACES = [('noto-serif-sc', (400, 600, 900)), ('ma-shan-zheng', (400,))]

def fonts_css():
    # @fontsource's per-weight sheets, woff2 only; their url(./files/…) resolve under vendor/fonts/files/.
    return ''.join(re.sub(r",\s*url\([^)]*\.woff\) format\('woff'\)", '', (mods / '@fontsource' / pkg / f'{w}.css').read_text()) + '\n'
                   for pkg, weights in FACES for w in weights)

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
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
with ThreadingHTTPServer(('', port), partial(NoCache, directory=str(root))) as server:
    server.serve_forever()
