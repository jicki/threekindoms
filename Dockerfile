FROM node:22-bookworm-slim AS dependencies

WORKDIR /dependencies
COPY hd2d-mvp/desktop/package.json hd2d-mvp/desktop/package-lock.json ./
RUN npm ci --include=dev --omit=optional --ignore-scripts --no-audit --no-fund

FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY LICENSE LICENSE-ART NOTICE /usr/share/licenses/threekindoms/
COPY hd2d-mvp/*.html ./hd2d-mvp/
COPY hd2d-mvp/src/ ./hd2d-mvp/src/
COPY hd2d-mvp/data/ ./hd2d-mvp/data/
COPY hd2d-mvp/assets/ ./hd2d-mvp/assets/
COPY hd2d-mvp/tools/serve.py ./hd2d-mvp/tools/serve.py

# 素材包不在 Git 中，避免构建出缺少关键画面的镜像。
RUN for asset in hd2d-mvp/assets/ai/portraits/0.webp hd2d-mvp/assets/ai/sandtable/board/albedo.webp; do \
      if [ ! -s "$asset" ] || [ "$(head -c 24 "$asset")" = 'version https://git-lfs.' ]; then \
        echo '缺少游戏素材，请先按 README.md 将对应版本的 Releases 素材包解压到仓库根目录。' >&2; \
        exit 1; \
      fi; \
    done

COPY --from=dependencies /dependencies/node_modules/three/ ./hd2d-mvp/desktop/node_modules/three/
COPY --from=dependencies /dependencies/node_modules/@fontsource/ ./hd2d-mvp/desktop/node_modules/@fontsource/

USER 65534:65534
EXPOSE 8677
CMD ["python3", "hd2d-mvp/tools/serve.py", "8677"]
