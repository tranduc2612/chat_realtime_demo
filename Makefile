.PHONY: dev dev-down staging staging-down prod prod-down version \
        ws ws-down ws-staging ws-staging-down ws-prod ws-prod-down \
        up down

# Current app version — single source of truth, read from the VERSION file.
# `docker compose` picks this up via ${APP_VERSION} substitution in the
# compose files (image tags, backend's APP_VERSION setting).
APP_VERSION := $(shell cat VERSION)

version:
	@cat VERSION

# Dev: identical to running `docker compose up -d` directly (that's exactly
# what e2e/playwright.config.ts does) — this target just also exports
# APP_VERSION so the image gets tagged with the current version.
dev:
	APP_VERSION=$(APP_VERSION) docker compose up -d --build

dev-down:
	docker compose down

# Staging/prod: -p gives each its own project namespace (containers/network/
# volumes), so dev/staging/prod can all run at once on one machine without
# name collisions. Requires .env.staging / .env.prod to exist — copy from
# the committed .env.staging.example / .env.prod.example first.
staging:
	APP_VERSION=$(APP_VERSION) docker compose -p chat_realtime_demo_staging -f docker-compose.staging.yml --env-file .env.staging up -d --build

staging-down:
	docker compose -p chat_realtime_demo_staging -f docker-compose.staging.yml down

prod:
	APP_VERSION=$(APP_VERSION) docker compose -p chat_realtime_demo_prod -f docker-compose.prod.yml --env-file .env.prod up -d --build

prod-down:
	docker compose -p chat_realtime_demo_prod -f docker-compose.prod.yml down

# ── WebSocket deployments ────────────────────────────────────────────────────
# Deployed separately from the HTTP API above: own compose project, own nginx,
# own port (8001 dev / 8081 staging / 9001 prod). Either side can be released,
# restarted or taken down without touching the other — that independence is the
# whole point, so these are deliberately *not* folded into `make dev`.
#
# They do share MySQL and Redis with the matching HTTP stack (sockets verify
# JWTs against the database and receive messages published through Redis), over
# a shared network both compose files declare. Start order doesn't matter, but
# migrations run in the HTTP stack, so a brand-new database needs that side up
# once before sockets can authenticate.
ws:
	APP_VERSION=$(APP_VERSION) docker compose -p chat_realtime_demo_ws -f docker-compose.ws.yml up -d --build

ws-down:
	docker compose -p chat_realtime_demo_ws -f docker-compose.ws.yml down

ws-staging:
	APP_VERSION=$(APP_VERSION) docker compose -p chat_realtime_demo_ws_staging -f docker-compose.ws.staging.yml --env-file .env.staging up -d --build

ws-staging-down:
	docker compose -p chat_realtime_demo_ws_staging -f docker-compose.ws.staging.yml down

ws-prod:
	APP_VERSION=$(APP_VERSION) docker compose -p chat_realtime_demo_ws_prod -f docker-compose.ws.prod.yml --env-file .env.prod up -d --build

ws-prod-down:
	docker compose -p chat_realtime_demo_ws_prod -f docker-compose.ws.prod.yml down

# Convenience for local work, where you usually want the whole app: brings up
# both dev deployments. Deploys still happen one side at a time.
up: dev ws

down: ws-down dev-down
