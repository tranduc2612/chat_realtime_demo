.PHONY: dev dev-down staging staging-down prod prod-down version

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
