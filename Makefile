COMPOSE ?= docker compose

.DEFAULT_GOAL := help
.PHONY: help build up down logs ps

help:
	@printf '%s\n' \
		'make build  构建游戏镜像' \
		'make up     构建并在后台启动游戏' \
		'make down   停止并移除游戏容器' \
		'make logs   查看游戏服务日志' \
		'make ps     查看游戏服务状态'

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up --build --detach

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow

ps:
	$(COMPOSE) ps
