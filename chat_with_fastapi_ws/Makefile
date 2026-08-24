.PHONY: dev test

# Local, non-Docker. Port 8001 so it can run beside the HTTP API on 8000.
dev:
	uvicorn app.main:app --reload --port 8001

test:
	pytest
