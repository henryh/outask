TARGETS ?= linux-x64 macos-arm64 windows-x64
REPO ?=
RELEASE_ROOT ?=
BIN_DIR ?= $(HOME)/.local/bin

.PHONY: help ci ci-dependencies test test-distribution install-push-guard release release-upload install-local-release

help:
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_-]+:.*## / { printf "make %-21s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

ci: ## Run dependency checks, core/MCP tests and native host install smoke
	@node scripts/ci.mjs

ci-dependencies: ## Install locked dependencies and audit core/MCP including dev
	@node scripts/ci.mjs dependencies

test: ## Run all existing core and MCP test files
	@node scripts/ci.mjs test

test-distribution: ## Build and smoke-test a temporary native host archive
	@node scripts/ci.mjs distribution

install-push-guard: ## Explicitly install this checkout's local main push guard
	@node scripts/install-push-guard.mjs

release: ## Build release archives
	@TARGETS="$(TARGETS)" node scripts/release-build.mjs

release-upload: ## Internal approved-release publication helper (CI owns tagging/upload)
	@TARGETS="$(TARGETS)" REPO="$(REPO)" node scripts/release-upload.mjs

install-local-release: ## Install the local archive for this user
	@RELEASE_ROOT="$(RELEASE_ROOT)" BIN_DIR="$(BIN_DIR)" node scripts/install-local-release.mjs
