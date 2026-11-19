# FROM node:22-bookworm-slim AS dependencies
FROM reg.deeproute.ai/deeproute-public/zzh/node:22-bookworm-slim AS dependencies

WORKDIR /dependencies
COPY hd2d-mvp/desktop/package.json hd2d-mvp/desktop/package-lock.json ./
RUN --mount=type=cache,id=threekindoms-npm,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --include=dev --omit=optional --ignore-scripts --no-audit --no-fund

# FROM python:3.13-slim
FROM reg.deeproute.ai/deeproute-public/zzh/python:3.13-slim AS assets
WORKDIR /asset-root
COPY ASSETS.lock.json ASSETS.sha256 threekindoms-assets-*.zip ./
COPY hd2d-mvp/tools/assets_pack.py /usr/local/bin/assets_pack.py
RUN --mount=type=cache,id=threekindoms-assets,target=/asset-cache,sharing=locked \
    python3 /usr/local/bin/assets_pack.py --root /asset-root install --cache-dir /asset-cache

FROM reg.deeproute.ai/deeproute-public/zzh/python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    GAME_VERSION_DIR=/var/lib/threekindoms/versions \
    GAME_ADMIN_TOKEN_FILE=/var/lib/threekindoms/admin/token.sha256
WORKDIR /app

COPY LICENSE LICENSE-ART NOTICE /usr/share/licenses/threekindoms/
COPY --from=assets /asset-root/hd2d-mvp/assets/ ./hd2d-mvp/assets/
COPY hd2d-mvp/assets/ ./hd2d-mvp/assets/
COPY hd2d-mvp/*.html ./hd2d-mvp/
COPY hd2d-mvp/src/ ./hd2d-mvp/src/
COPY hd2d-mvp/data/ ./hd2d-mvp/data/
COPY hd2d-mvp/tools/serve.py hd2d-mvp/tools/scenario_store.py ./hd2d-mvp/tools/

RUN mkdir -p "$GAME_VERSION_DIR" /var/lib/threekindoms/admin \
    && chown 65534:65534 "$GAME_VERSION_DIR" /var/lib/threekindoms/admin \
    && chmod 700 /var/lib/threekindoms/admin

COPY --from=dependencies /dependencies/node_modules/three/ ./hd2d-mvp/desktop/node_modules/three/
COPY --from=dependencies /dependencies/node_modules/@fontsource/ ./hd2d-mvp/desktop/node_modules/@fontsource/

USER 65534:65534
EXPOSE 8677
CMD ["python3", "hd2d-mvp/tools/serve.py", "8677"]
