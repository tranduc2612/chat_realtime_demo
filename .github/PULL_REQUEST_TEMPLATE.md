## Summary

<!-- What does this PR do, and why? -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Infra / CI/CD / Docker
- [ ] Docs
- [ ] Refactor / cleanup

## Testing

CI (`.github/workflows/ci-cd.yml`) runs backend tests, frontend tests, and the full e2e suite automatically on this PR — link/note anything beyond that here, e.g. manual checks against a specific environment.

- [ ] `make test` (backend, `chat_with_fastapi/`) passes locally
- [ ] `npm run test` (frontend, `chat_frontend/`) passes locally
- [ ] `npm run test` (e2e, `e2e/`) passes locally, if this touches backend/frontend/WebSocket behavior
- [ ] Verified manually against `docker compose up` (dev), if this touches Docker/environment config

## Checklist

- [ ] Docs updated (`CLAUDE.md`, `chat_with_fastapi/README.md`) if architecture, routes, or environment setup changed
- [ ] `VERSION` bumped, if this should ship as a new release
- [ ] No new required env var was added without also updating `.env.example`/`.env.sample`/`.env.staging.example`/`.env.prod.example` as applicable
- [ ] Screenshots attached, for UI changes

## Related issues

<!-- Fixes #, relates to # -->
