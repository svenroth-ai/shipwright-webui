.PHONY: help install dev dev-server dev-client test test-server test-client typecheck lint build clean sync-profiles

help:
	@echo "Shipwright Command Center — convenience targets"
	@echo ""
	@echo "  make install       — npm install in both server/ and client/"
	@echo "  make dev-server    — start Hono backend on :3847 (tsx watch)"
	@echo "  make dev-client    — start Vite frontend on :5173"
	@echo ""
	@echo "  make test          — run both server + client test suites"
	@echo "  make test-server   — server (vitest)"
	@echo "  make test-client   — client (vitest)"
	@echo ""
	@echo "  make typecheck     — tsc --noEmit in both halves"
	@echo "  make lint          — eslint in client/"
	@echo "  make build         — production build (both halves)"
	@echo ""
	@echo "  make sync-profiles — refresh server/profiles/ from a sibling"
	@echo "                       shipwright checkout (reads \$SHIPWRIGHT_MONOREPO_PATH"
	@echo "                       or ../shipwright by default)"
	@echo "  make clean         — drop node_modules + build artefacts"
	@echo ""
	@echo "Ports override: PORT=3848 VITE_PORT=5174 make dev-server"

install:
	cd server && npm install
	cd client && npm install

dev-server:
	cd server && npm run dev

dev-client:
	cd client && npm run dev

test: test-server test-client

test-server:
	cd server && npm test -- --run

test-client:
	cd client && npm test -- --run

typecheck:
	cd server && npx tsc --noEmit
	cd client && npx tsc --noEmit

lint:
	cd client && npm run lint

build:
	cd server && npm run build
	cd client && npm run build

sync-profiles:
	@src="$${SHIPWRIGHT_MONOREPO_PATH:-../shipwright}/shared/profiles"; \
	if [ ! -d "$$src" ]; then \
		echo "Source profiles dir not found: $$src"; \
		echo "Set SHIPWRIGHT_MONOREPO_PATH=/path/to/shipwright or place the"; \
		echo "shipwright checkout next to this repo."; \
		exit 1; \
	fi; \
	cp "$$src"/*.json server/profiles/; \
	echo "Synced from $$src → server/profiles/"

clean:
	rm -rf server/node_modules server/dist
	rm -rf client/node_modules client/dist
