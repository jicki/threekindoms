# Three Kingdoms HD-2D（三国 HD-2D）

一款回合制三国战略游戏的 HD-2D 重制：像素角色立在 3D 地形上，加上实时光影、景深与后期。玩法规则和数值参照 1992 年 FC 游戏《三國志II 覇王の大陸》。游戏用浏览器运行（three.js），也能打包成 Electron 桌面版。

> 本项目是非官方、非商业的同人重制，与 Bandai Namco 无关。仓库里没有原版 ROM 或任何原版素材，运行也不需要它们。立绘等美术由 AI 生成，经人工筛选与修改。

## 项目结构

```
hd2d-mvp/
  index.html          游戏入口
  save-editor.html    存档（记录）编辑器
  vignettes.html      命令演出预览页
  src/
    core/             规则层，不依赖渲染：
                        game.js 战略层与全部命令、ai.js 战略 AI、warcore.js 开战与战后写回、
                        field.js 战争地图、tactical.js 白兵、skirmish.js 白兵与单挑结算、
                        saveedit.js 记录编辑、ahuinan.js 阿会喃漏洞模式
    war/              战争地图 3D 视图（board、units、overlay、camera、pick、interact、play、probe）
    *.js              three.js 场景（strategy*.js 战略地图、warview.js 战场、tacticalview.js 白兵、
                      duelview.js 单挑等）与流程、界面（app.js、ui.js、ui.css）
  data/
    game-data.json    武将、城市、地图、事件等全部规则数据
    thanks.txt        片尾鸣谢名单
  assets/             美术、3D 模型与音效（素材包，见下文）；manifest.json 列出可选资源
  tests/              测试（*.test.mjs），公共辅助函数在 game.mjs
  tools/              开发服务器、无头浏览器、截图与检查、模拟，以及美术切图与烘焙脚本
  desktop/            Electron 打包脚本
```

## 获取代码与素材

仓库的 git 里只有代码和数据。美术、3D 模型、音效和图标只放在 [Releases](https://github.com/tianlin/threekindoms/releases) 的素材包 `threekindoms-assets-<版本>.zip` 里。

```bash
git clone https://github.com/tianlin/threekindoms.git
cd threekindoms
# 从 Releases 下载与代码对应的素材包（跟进 main 就用最新的），解压到仓库根目录：
unzip -o ~/Downloads/threekindoms-assets-0.3.6.zip
shasum -a 256 -c ASSETS.sha256 | grep -v ': OK$'    # 没有输出就说明素材齐全
```

素材文件已经写进 `.gitignore`，解压后不会出现在 `git status` 里。根目录的 `ASSETS.sha256` 列出了每个素材文件和它的哈希：
- 解压后如果 git 显示 `ASSETS.sha256` 被修改，说明素材包和代码版本不一致，请换用对应版本的素材包。
- 缺少素材时，开发服务器、`tests/lfs-pointer.test.mjs` 和桌面版打包都会提示你先解压素材包。

## 运行

需要 Node.js 22 以上和 Python 3。

```bash
npm --prefix hd2d-mvp/desktop install     # 首次：安装 three.js、字体和 Electron
python3 hd2d-mvp/tools/serve.py 8677      # 启动开发服务器
```

然后用浏览器打开 http://localhost:8677/hd2d-mvp/ 。在网址后面加 `?mute` 可以静音。

游戏的背景音乐由代码实时合成，音效使用仓库里的文件。

### 使用 Docker Compose

需要 Docker 和 Docker Compose。构建前先按「获取代码与素材」下载并解压与代码版本对应的素材包；素材会打包进镜像，更新素材或代码后重新运行 `make up` 即可重新构建。构建时只检查两个关键素材，完整性请使用上面的 SHA-256 校验命令确认。

```bash
make up       # 构建镜像并在后台启动
make ps       # 查看服务状态
make logs     # 查看服务日志，按 Ctrl+C 退出
make down     # 停止并移除容器
```

打开 http://localhost:8677/hd2d-mvp/ 。也可单独执行 `make build` 构建镜像。默认只监听本机的 8677 端口；可以通过环境变量修改监听地址和宿主机端口，例如：

```bash
GAME_BIND_ADDRESS=0.0.0.0 GAME_PORT=8080 make up
```

游戏记录保存在浏览器本地，容器不保存存档；更换浏览器或访问地址后不会自动共享记录。

## 测试

浏览器测试用 Playwright 驱动本机 Chrome 的无头模式，需要先装 Playwright（`npm i -g playwright`）和 Google Chrome。

```bash
node --test hd2d-mvp/tests/artcoverage.test.mjs                  # 单个测试文件
node --test --test-concurrency=1 'hd2d-mvp/tests/*.test.mjs'     # 全部测试（较慢，war.test 约 10 分钟）
```

## 打包桌面版

需要 `cwebp`（macOS 上用 `brew install webp` 安装）。

```bash
npm --prefix hd2d-mvp/desktop run dist:mac    # macOS dmg（arm64 与 x64）
npm --prefix hd2d-mvp/desktop run dist:win    # Windows x64 zip
npm --prefix hd2d-mvp/desktop run dist:dir    # 只出 macOS 的 .app 目录，最快
npm --prefix hd2d-mvp/desktop start           # 直接用 Electron 运行游戏（需要先执行一次 build-app）
```

这几个命令都会先运行 `build-app.mjs`，把游戏快照到 `hd2d-mvp/desktop/app/`，产物放在 `hd2d-mvp/desktop/release/`。

## 许可

- 源代码：MIT，见 [LICENSE](LICENSE)。
- `hd2d-mvp/assets/` 下的美术、3D 模型与生成音频：CC BY-NC 4.0，不可商用，见 [LICENSE-ART](LICENSE-ART)。
- 第三方组件：见 [NOTICE](NOTICE)。

代码注释里提到的 `research/`、`analysis/` 等路径，指向作者没有公开的逆向研究资料。`data/game-data.json` 就是由这些资料导出的；要调整规则数据，直接改这个文件即可。
