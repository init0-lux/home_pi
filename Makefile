SHELL := /bin/sh

DASHBOARD_DIR := dashboard
IMAGE_NAME := zapp-pwa
CONTAINER_NAME := zapp-pwa
PORT := 3000

.PHONY: help install dev lint typecheck build clean docker-build docker-run docker-stop compose-build compose-up compose-down

help:
	@printf '%s\n' \
		'make install       Install dashboard dependencies with pnpm' \
		'make dev           Start the Next.js dev server' \
		'make lint          Run eslint' \
		'make typecheck     Run TypeScript checks' \
		'make build         Create a production build' \
		'make clean         Remove Next.js build output' \
		'make docker-build  Build the Docker image' \
		'make docker-run    Run the Docker image on port $(PORT)' \
		'make docker-stop   Stop the Docker container' \
		'make compose-build Build with docker compose' \
		'make compose-up    Start with docker compose' \
		'make compose-down  Stop docker compose services'

install:
	cd $(DASHBOARD_DIR) && pnpm install

dev:
	cd $(DASHBOARD_DIR) && pnpm dev

lint:
	cd $(DASHBOARD_DIR) && pnpm lint

typecheck:
	cd $(DASHBOARD_DIR) && pnpm typecheck

build:
	cd $(DASHBOARD_DIR) && pnpm build

clean:
	rm -rf $(DASHBOARD_DIR)/.next

docker-build:
	docker build -t $(IMAGE_NAME) ./$(DASHBOARD_DIR)

docker-run:
	docker run --rm -it -p $(PORT):3000 --name $(CONTAINER_NAME) $(IMAGE_NAME)

docker-stop:
	docker stop $(CONTAINER_NAME)

compose-build:
	docker compose build

compose-up:
	docker compose up --build

compose-down:
	docker compose down
