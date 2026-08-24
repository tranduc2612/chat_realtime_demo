.PHONY: dev dev-down staging staging-down prod prod-down version \
        ws ws-down ws-staging ws-staging-down ws-prod ws-prod-down \
        up down staging-up staging-down-all prod-up prod-down-all

# Current app version — single source of truth, read from the VERSION file.
# `docker compose` picks this up via ${APP_VERSION} substitution in the
# compose files (image tags, backend's APP_VERSION setting).
APP_VERSION := $(shell cat VERSION)

version:
	@cat VERSION

# ── Compose invocations, one per environment ────────────────────────────────
# One file per environment now (dev / staging / prod), each holding the whole
# app. -p gives staging and prod their own project namespace (containers/
# network/volumes), so all three can run at once on one machine without name
# collisions. Staging/prod require .env.staging / .env.prod to exist — copy
# from the committed .env.staging.example / .env.prod.example first.
COMPOSE_DEV     := docker compose
COMPOSE_STAGING := docker compose -p chat_realtime_demo_staging -f docker-compose.staging.yml --env-file .env.staging
COMPOSE_PROD    := docker compose -p chat_realtime_demo_prod -f docker-compose.prod.yml --env-file .env.prod

# ── The two deployments, as service groups ──────────────────────────────────
# The HTTP API and the WebSocket service share one compose file per environment
# but are still released independently: every target below names one group, so
# rebuilding or tearing down one side never touches the other's containers or
# its open sockets. Adding a replica means adding it here too (and a `server`
# line in the matching nginx config).
API_SERVICES := mysql redis migrate backend-a backend-b backend-c nginx frontend
WS_SERVICES  := ws-a ws-b nginx-ws

# ── HTTP API deployment ─────────────────────────────────────────────────────
dev:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_DEV) up -d --build $(API_SERVICES)

dev-down:
	$(COMPOSE_DEV) rm -sf $(API_SERVICES)

staging:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_STAGING) up -d --build $(API_SERVICES)

staging-down:
	$(COMPOSE_STAGING) rm -sf $(API_SERVICES)

prod:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_PROD) up -d --build $(API_SERVICES)

prod-down:
	$(COMPOSE_PROD) rm -sf $(API_SERVICES)

# ── WebSocket deployment ────────────────────────────────────────────────────
# Deployed separately from the HTTP API above: own image, own nginx, own port
# (8001 dev / 8081 staging / 9001 prod). Either side can be released,
# restarted or taken down without touching the other — that independence is
# the whole point, so these are deliberately *not* folded into `make dev`.
#
# They do share MySQL and Redis with the matching HTTP stack (sockets verify
# JWTs against the database and receive messages published through Redis), and
# these targets start that infrastructure if it isn't already up. Start order
# doesn't matter, but migrations run in the HTTP stack, so a brand-new database
# needs that side up once before sockets can authenticate.
ws:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_DEV) up -d --build $(WS_SERVICES)

ws-down:
	$(COMPOSE_DEV) rm -sf $(WS_SERVICES)

ws-staging:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_STAGING) up -d --build $(WS_SERVICES)

ws-staging-down:
	$(COMPOSE_STAGING) rm -sf $(WS_SERVICES)

ws-prod:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_PROD) up -d --build $(WS_SERVICES)

ws-prod-down:
	$(COMPOSE_PROD) rm -sf $(WS_SERVICES)

# ── Whole environment at once ───────────────────────────────────────────────
# Convenience for local work and CI, where you usually want the whole app.
# Real deploys still go one side at a time, with the targets above.
# `down` also removes the environment's network (`rm` above leaves it alone).
up:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_DEV) up -d --build

down:
	$(COMPOSE_DEV) down

staging-up:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_STAGING) up -d --build

staging-down-all:
	$(COMPOSE_STAGING) down

prod-up:
	APP_VERSION=$(APP_VERSION) $(COMPOSE_PROD) up -d --build

prod-down-all:
	$(COMPOSE_PROD) down
