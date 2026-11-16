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

### 背景音乐

游戏会自动检查本地可选音频。在标题页或游戏中的「☰ 系统 → 曲目」可以切换已提供的音乐版本，选择保存在当前浏览器中；浏览器可能要求先点击页面才能播放。没有可用音频时，部分场景使用合成音乐。已有的 `remix/` 素材仍显示为 Remix，不会误认为 PS 复刻版。

原版和 PS 复刻版音频放在 `hd2d-mvp/assets/audio/original/` 和 `hd2d-mvp/assets/audio/ps/`，文件名与 `assets/manifest.json` 中的对应场景一致。两目录被 Git 忽略，不随代码或 Releases 素材包分发；在其他机器上运行时，需要自行提供相应的音频文件。构建 Docker 镜像或桌面版时，本地存在的音频会被打包；加入或更换音频后需要重新构建。

目前接入的场景及音源对应关系如下。FC 音频来自 [原版 NSF 曲目表](https://www.zophar.net/music/nintendo-nes-nsf/sangokushi-2-haou-no-tairiku)，PS 曲目编号来自 [Namco Anthology 1 音源](https://downloads.khinsider.com/game-soundtracks/album/namco-anthology-1-ps1-gamerip-1998)，结合[场景曲目资料](https://w.atwiki.jp/gamemusicbest100/pages/5645.html)及旋律特征比对；结局使用 [PSF 音源](https://ftpmirror2.infania.net/sites/modland/incoming/warehouse/PSF/HaounoTairiku_psf/HaounoTairiku_ezp104_PSF/)中标注为 Epilogue 的曲目。PS 版战后和失败暂未找到可可靠对应的文件，选择 PS 版时会回退到该场景的其他可用版本。

PS 结局的对应关系依据音源标签，尚未与原 PS 游戏的结局画面交叉验证。

| 游戏场景 | 原版曲目 | PS 复刻版曲目 |
| --- | --- | --- |
| 标题 | 1 Title | Haou T0 |
| 选择君主 | 2 Player Select | Haou T1 |
| 战略与内政 | 3 Strategy | Haou R00 |
| 战争地图 | 4 War | Haou J2 |
| 白兵 | 5 Tactics | Haou J5 |
| 单挑 | 6 Single Combat | Haou J7 |
| 战后结算 | 7 End of War | 暂缺 |
| 游戏失败 | 8 Game Over | 暂缺 |
| 天下统一 | 9 Ending | Epilogue（haou_e_seq00） |

原作音乐的权利归其权利人所有，不属于本项目生成素材的许可范围；对外分发或部署这些音频前需自行确认使用权限。

### 使用 Docker Compose

需要 Docker 和 Docker Compose。构建前先按「获取代码与素材」下载并解压与代码版本对应的素材包；素材会打包进镜像，更新素材或代码后重新运行 `make up` 即可重新构建。构建时只检查两个关键素材，完整性请使用上面的 SHA-256 校验命令确认。

Dockerfile 从 `reg.deeproute.ai` 拉取 Node 和 Python 基础镜像。本次验证的镜像为 `linux/amd64`；在 ARM 主机上运行需要支持 amd64 模拟。

```bash
make up       # 构建镜像并在后台启动
make ps       # 查看服务状态
make logs     # 查看服务日志，按 Ctrl+C 退出
make down     # 停止并移除容器
```

客户端提前断开连接时，日志会保留一条简短提示；其他服务端异常仍会输出完整堆栈。

打开 http://localhost:8677/hd2d-mvp/ 。也可单独执行 `make build` 构建镜像。默认只监听本机的 8677 端口；可以通过环境变量修改监听地址和宿主机端口，例如：

```bash
GAME_BIND_ADDRESS=0.0.0.0 GAME_PORT=8080 make up
```

游戏记录保存在浏览器本地，容器不保存存档；更换浏览器或访问地址后不会自动共享记录。
当前版本的普通记录和快捷存档使用 IndexedDB 协调不同页面的写入，支持 Web Locks 时也会使用该锁；IndexedDB 不可用时会提示无法安全写入，避免覆盖其他页面的记录。检测到不同版本的记录时会要求重新确认；已存在的、来自更新版本的普通记录不会被旧版本覆盖。已打开的旧版页面可能不参与协调，更新后请关闭旧版页面。

### 游戏版本管理

管理员可在标题画面选择「☰ 系统 → 版本管理」，或打开 `/hd2d-mvp/admin.html`。管理页面可以基于原版或已发布版本编辑人物属性、出生与登场信息、人物关系、新武器和新技能，再发布给使用同一服务器的玩家。人物图像和武器图标使用已有素材；人物关系显示在资料中，不自动改变招募、忠诚或战斗规则。新技能可组合固定的损兵、体力伤害、限制移动和粮草损失效果，不执行自定义代码。

出生年份和出生地用于人物资料，登场年份、地点和方式决定人物何时进入游戏。君主的开局位置不可修改；如果调整登场导致某城开局没有武将，该城会成为无主城。

服务器默认允许读取已发布版本，**未配置管理员令牌时不允许发布**。令牌需为 32–256 位不含空格的可打印 ASCII 字符，请使用密码管理器生成的高强度随机值。首次启动或轮换令牌时，在当前终端输入令牌（输入不会回显）：

```bash
read -r -s GAME_ADMIN_TOKEN
export GAME_ADMIN_TOKEN
make up
```

Compose 会将令牌的 SHA-256 校验值保存在独立的 `game_admin_token` 持久卷中，文件仅允许所有者访问；不会把令牌原文写入该卷、浏览器或版本文件。随后容器重启或重建时，即使没有环境变量，也会继续使用已保存的令牌。该配置依赖同一 Compose 项目中的持久卷；迁移宿主机或更换项目时需迁移该卷或重新配置令牌。已有部署升级到此功能后，首次启动仍需提供原令牌一次，才能写入新的持久卷。

发布时在管理页面输入相同令牌；发布成功后输入框会清空。需要轮换令牌时，以新令牌重新执行上述命令；启动后旧令牌失效。使用同一可信持久令牌文件的运行中实例会在每次发布认证时读取最新校验值，轮换后的认证请求会使用新令牌；只使用进程内令牌的实例不会自动同步。启动时非空的 `GAME_ADMIN_TOKEN` 总是覆盖已保存的校验值，因此轮换后应协调所有实例的配置，避免其他实例重启时再次提供旧令牌。令牌文件和所在目录须由服务运行用户或 root 所有；文件不得允许其他用户访问，目录不得允许其他用户或用户组写入。无效的环境变量、不可写或损坏的令牌文件会禁用发布并记录错误，不会用错误令牌覆盖已保存的配置。首次启动时传入的环境变量仍可被具有 Docker 管理权限的人查看；若不再需要它，可在终端执行 `unset GAME_ADMIN_TOKEN`，然后重新执行 `make up`。

静态服务拒绝访问隐藏文件及指向 `.env` 配置的链接，`.env*` 也被排除在 Git 和 Docker 构建上下文之外。仍建议不要把真实令牌放在项目目录内。默认端口仅绑定本机；通过网络管理时，应使用 HTTPS 反向代理保护令牌。

玩家在标题画面选择「☰ 系统 → 游戏版本」，原版仍为默认。每次修改后发布都会创建不可覆盖的新版本编号，原版及各版本的普通、快捷、自动和中断战斗记录分别保存。管理页面可以导入、导出版本 JSON；未经修改的导入文件可用原编号恢复已发布版本。版本绑定当前基础数据，基础数据发生变化后需要先确认兼容性，不能直接当作新版加载。独立 Electron 离线包仍可使用原版；服务器版本管理与选择需要通过游戏服务器访问。

无法读取的单个版本会从列表中跳过，管理页面和游戏版本选择界面会提示数量，其他正常版本仍可使用。服务器日志会记录被跳过的版本编号，管理员可检查版本文件或从备份恢复；服务器不会自动删除或覆盖这些文件。整个版本目录无法访问时，列表仍会报告服务错误。

Compose 将已发布版本保存在 `game_versions` 卷，管理员令牌校验值保存在 `game_admin_token` 卷；`make down` 不会删除它们。删除对应卷会分别删除已发布版本或令牌配置。直接运行开发服务器时，版本默认保存在 `~/.local/share/threekindoms/versions`，可用 `GAME_VERSION_DIR` 指定其他可写目录；若也需要持久化令牌，设置 `GAME_ADMIN_TOKEN_FILE` 为静态服务目录之外的绝对文件路径。未设置该路径时，直接运行的服务器仅在当前进程内使用令牌。

## 测试

浏览器测试用 Playwright 驱动本机 Chrome 的无头模式，需要先装 Playwright（`npm i -g playwright`）和 Google Chrome。

```bash
node --test hd2d-mvp/tests/artcoverage.test.mjs                  # 单个测试文件
node --test --test-concurrency=1 'hd2d-mvp/tests/*.test.mjs'     # 全部测试（较慢，war.test 约 10 分钟）
python3 hd2d-mvp/tests/scenario_server_test.py                  # 游戏版本发布接口与认证
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
