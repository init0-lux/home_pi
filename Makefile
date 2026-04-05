# =============================================================================
# Zapp — Demo Makefile
# Run everything for the live demo from this single file.
# =============================================================================

SHELL := /bin/bash

HUB_DIR         := hub
DASHBOARD_DIR   := worktrees/mobile/dashboard
FIRMWARE_DIR    := firmware/zapp_node
HUB_PORT        := 3000
DASHBOARD_PORT  := 3001

.PHONY: help install install-hub install-dashboard \
        dev dev-hub dev-dashboard \
        build build-hub build-dashboard \
        mosquitto start stop clean reset-db \
        test-hub logs

# ─── Help ─────────────────────────────────────────────────────────────────────

help:
	@printf '\n\033[1mZapp — Demo Commands\033[0m\n\n'
	@printf '  \033[33mmake install\033[0m          Install all dependencies\n'
	@printf '  \033[33mmake mosquitto\033[0m         Start the MQTT broker (Mosquitto)\n'
	@printf '  \033[33mmake dev-hub\033[0m           Start the hub (port $(HUB_PORT))\n'
	@printf '  \033[33mmake dev-dashboard\033[0m     Start the dashboard PWA (port $(DASHBOARD_PORT))\n'
	@printf '  \033[33mmake dev\033[0m               Start hub + dashboard together\n'
	@printf '  \033[33mmake build\033[0m             Build both hub and dashboard for production\n'
	@printf '  \033[33mmake test-hub\033[0m          Smoke-test the hub API endpoints\n'
	@printf '  \033[33mmake reset-db\033[0m          Delete the SQLite database (fresh state)\n'
	@printf '  \033[33mmake logs\033[0m              Tail hub logs\n'
	@printf '\n'
	@printf '  \033[36mFull demo sequence:\033[0m\n'
	@printf '  1. make install\n'
	@printf '  2. make mosquitto      (new terminal)\n'
	@printf '  3. make dev-hub        (new terminal — shows logs for demo)\n'
	@printf '  4. make dev-dashboard  (new terminal)\n'
	@printf '  5. Phone → http://<laptop-ip>:$(DASHBOARD_PORT) → Add to Home Screen\n'
	@printf '\n'

# ─── Install ──────────────────────────────────────────────────────────────────

install: install-hub install-dashboard
	@echo "✅ All dependencies installed."

install-hub:
	@echo "→ Installing hub dependencies..."
	cd $(HUB_DIR) && pnpm install

install-dashboard:
	@echo "→ Installing dashboard dependencies..."
	cd $(DASHBOARD_DIR) && pnpm install

# ─── Mosquitto ────────────────────────────────────────────────────────────────

mosquitto:
	@echo "→ Starting Mosquitto MQTT broker on port 1883..."
	@command -v mosquitto >/dev/null 2>&1 || { \
		echo "Mosquitto not found. Install with: sudo apt install -y mosquitto"; \
		exit 1; \
	}
	mosquitto -c $(HUB_DIR)/mosquitto/mosquitto-local.conf

# ─── Dev ──────────────────────────────────────────────────────────────────────

dev-hub:
	@echo "→ Starting Zapp Hub on http://0.0.0.0:$(HUB_PORT)  (mDNS: http://zapp.local:$(HUB_PORT))"
	cd $(HUB_DIR) && pnpm dev

dev-dashboard:
	@echo "→ Starting Zapp Dashboard on http://0.0.0.0:$(DASHBOARD_PORT)"
	cd $(DASHBOARD_DIR) && NEXT_PUBLIC_HUB_URL=http://zapp.local:$(HUB_PORT) pnpm dev -- --port $(DASHBOARD_PORT)

# Run hub and dashboard in parallel (tmux-style via background jobs + wait)
# Logs are interleaved — use separate terminals for cleaner output during demo.
dev:
	@echo "→ Starting hub and dashboard..."
	@echo "   Hub:       http://localhost:$(HUB_PORT)"
	@echo "   Dashboard: http://localhost:$(DASHBOARD_PORT)"
	@echo "   (Ctrl-C to stop both)"
	@trap 'kill 0' SIGINT; \
	  (cd $(HUB_DIR) && pnpm dev) & \
	  (sleep 2 && cd $(DASHBOARD_DIR) && NEXT_PUBLIC_HUB_URL=http://zapp.local:$(HUB_PORT) pnpm dev -- --port $(DASHBOARD_PORT)) & \
	  wait

# ─── Build ────────────────────────────────────────────────────────────────────

build: build-hub build-dashboard
	@echo "✅ Production build complete."

build-hub:
	@echo "→ Building hub..."
	cd $(HUB_DIR) && pnpm build

build-dashboard:
	@echo "→ Building dashboard..."
	cd $(DASHBOARD_DIR) && NEXT_PUBLIC_HUB_URL=http://zapp.local:$(HUB_PORT) pnpm build

# ─── Test / Smoke ─────────────────────────────────────────────────────────────

test-hub:
	@echo "→ Smoke-testing hub at http://localhost:$(HUB_PORT)..."
	@echo ""
	@echo "[health]"
	@curl -sf http://localhost:$(HUB_PORT)/health | python3 -m json.tool || \
		echo "  ❌ Hub not reachable. Is it running? (make dev-hub)"
	@echo ""
	@echo "[provision/config]"
	@curl -sf http://localhost:$(HUB_PORT)/api/v1/provision/config | python3 -m json.tool
	@echo ""
	@echo "[rooms]"
	@curl -sf http://localhost:$(HUB_PORT)/api/v1/rooms | python3 -m json.tool
	@echo ""
	@echo "[devices]"
	@curl -sf http://localhost:$(HUB_PORT)/api/v1/devices | python3 -m json.tool
	@echo ""
	@echo "[mcp/tools count]"
	@curl -sf http://localhost:$(HUB_PORT)/mcp/tools | python3 -c \
		"import sys,json; d=json.load(sys.stdin); print(f'  ✅ {d[\"count\"]} MCP tools available')"

# ─── Logs ─────────────────────────────────────────────────────────────────────

logs:
	tail -f /tmp/hub.log 2>/dev/null || echo "Hub log not found. Start hub with: make dev-hub"

# ─── Reset ────────────────────────────────────────────────────────────────────

reset-db:
	@echo "→ Removing SQLite database..."
	rm -f $(HUB_DIR)/data/zapp.db
	@echo "✅ Database reset. Restart the hub to reinitialize."

clean: reset-db
	@echo "→ Cleaning build artifacts..."
	rm -rf $(HUB_DIR)/dist
	rm -rf $(DASHBOARD_DIR)/.next
	@echo "✅ Clean complete."
