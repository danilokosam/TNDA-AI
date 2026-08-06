# syntax=docker/dockerfile:1
#
# Build context is the MONOREPO ROOT, not this directory - a pnpm workspace
# has one lockfile at the root, and pnpm needs to see every workspace
# member's package.json to resolve the dependency graph, even when
# `--filter` scopes the actual install down to just this package. Build
# from the repo root:
#   docker build -f apps/backend/Dockerfile -t tnda-ai-backend .

# Pinned to an exact patch version, not the rolling `1-alpine` tag: this
# project's Bun-version-sensitive behavior (see the `test` stage's zod
# note, and vitest.config.ts) has already differed between Bun patch
# releases once. Pinning here matches what CI (.github/workflows/ci.yml)
# and local development actually run against, so "works in CI/locally,
# breaks in the image" can't happen because of an untracked Bun version
# drift again. Bump deliberately, in step with CI, not implicitly.
ARG BUN_VERSION=1.3.14
# Matches the root package.json's "packageManager" field - installed via
# `bun install -g` below rather than corepack, since the base image is
# Bun-first and this avoids pulling in Node/corepack just for this.
ARG PNPM_VERSION=11.20.0

# --- base --------------------------------------------------------------
# Shared foundation: only the workspace's manifests + lockfile are here
# (every workspace member's package.json, not full source), so this layer
# stays cached across builds until a dependency actually changes anywhere
# in the workspace, regardless of source edits. packages/config's real
# content (not just its package.json) is needed too - apps/backend's
# tsconfig.json extends it by package name, which pnpm resolves to a
# symlink pointing at this actual directory.
FROM oven/bun:${BUN_VERSION}-alpine AS base
ARG PNPM_VERSION
WORKDIR /app
RUN bun install -g pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY packages/config/ ./packages/config/
COPY packages/types/package.json ./packages/types/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# --- install (this package + its workspace deps, incl. dev) -------------
# --filter=@tnda-ai/backend... (the trailing `...` means "and everything
# it depends on") scopes both resolution and the actual install to just
# this package's dependency chain - the frontend's much larger, unrelated
# dependency tree never gets installed into this image at all.
FROM base AS install
RUN pnpm install --frozen-lockfile --filter=@tnda-ai/backend...

# --- test ----------------------------------------------------------------
# Acts as a build-time gate, not just a CI convenience: this stage must
# succeed for the image to build at all (the release stage below pulls
# package.json/tsconfig.json/src from *this* stage specifically, which
# forces Docker to build and run it as a prerequisite). Needs no real
# Supabase/Azure/Stripe credentials - vitest.config.ts's dummy test env
# vars are self-contained, so this runs the same offline, inside the
# build sandbox, as it does anywhere else.
FROM install AS test
WORKDIR /app/apps/backend
COPY apps/backend/ .
RUN bun run typecheck
RUN bun run lint
RUN bun run test
# Test files are needed above for `bun run test` to find anything to run,
# but have no reason to ship in the runtime image - deleted here (after
# they've done their job) rather than excluded from the build context via
# .dockerignore, since excluding them earlier would leave vitest with
# nothing to run and this whole stage would pass without checking anything.
RUN find src -name "*.test.ts" -delete

# --- install-prod (production deps only, this package's chain only) -----
# Built from `base`, not from `install`/`test`, so devDependencies never
# end up in this layer's node_modules in the first place.
FROM base AS install-prod
RUN pnpm install --frozen-lockfile --filter=@tnda-ai/backend... --prod

# --- release (final runtime image) ---------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS release
WORKDIR /app
ENV NODE_ENV=production

# Everything copied here comes from a stage that already passed
# typecheck/lint/test (see the `test` stage above), except node_modules,
# which is intentionally the separate production-only install so no
# devDependency ever reaches the runtime image. pnpm's node_modules is
# workspace-relative (symlinks back into a shared store keyed by paths
# under /app), so the whole /app tree from install-prod is copied, not
# just apps/backend/node_modules in isolation.
COPY --from=install-prod --chown=bun:bun /app ./
COPY --from=test --chown=bun:bun /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=test --chown=bun:bun /app/apps/backend/tsconfig.json ./apps/backend/tsconfig.json
COPY --from=test --chown=bun:bun /app/apps/backend/src ./apps/backend/src

WORKDIR /app/apps/backend

# The official oven/bun images ship a pre-created, unprivileged `bun`
# user for exactly this purpose - running as root inside the container
# is never necessary for this app.
USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "src/index.ts"]
