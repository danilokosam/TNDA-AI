# syntax=docker/dockerfile:1

# Pinned to an exact patch version, not the rolling `1-alpine` tag: this
# project's Bun-version-sensitive behavior (see the `test` stage's zod
# note, and vitest.config.ts) has already differed between Bun patch
# releases once. Pinning here matches what CI (.github/workflows/ci.yml)
# and local development actually run against, so "works in CI/locally,
# breaks in the image" can't happen because of an untracked Bun version
# drift again. Bump deliberately, in step with CI, not implicitly.
ARG BUN_VERSION=1.3.14

# --- base --------------------------------------------------------------
# Shared foundation: only the manifest + lockfile are here, so this layer
# (and every stage built on it) stays cached across builds until a
# dependency actually changes, regardless of source edits.
FROM oven/bun:${BUN_VERSION}-alpine AS base
WORKDIR /app
COPY package.json bun.lock ./

# --- install (all deps, incl. dev) --------------------------------------
FROM base AS install
RUN bun install --frozen-lockfile

# --- test ----------------------------------------------------------------
# Acts as a build-time gate, not just a CI convenience: this stage must
# succeed for the image to build at all (the release stage below pulls
# package.json/tsconfig.json/src from *this* stage specifically, which
# forces Docker to build and run it as a prerequisite). Needs no real
# Supabase/Azure/Stripe credentials — vitest.config.ts's dummy test env
# vars are self-contained, so this runs the same offline, inside the
# build sandbox, as it does anywhere else.
FROM install AS test
COPY . .
RUN bun run typecheck
RUN bun run lint
RUN bun run test
# Test files are needed above for `bun run test` to find anything to run,
# but have no reason to ship in the runtime image — deleted here (after
# they've done their job) rather than excluded from the build context via
# .dockerignore, since excluding them earlier would leave vitest with
# nothing to run and this whole stage would pass without checking anything.
RUN find src -name "*.test.ts" -delete

# --- install-prod (production deps only) --------------------------------
# Built from `base`, not from `install`/`test`, so devDependencies never
# end up in this layer's node_modules in the first place.
FROM base AS install-prod
RUN bun install --frozen-lockfile --production

# --- release (final runtime image) ---------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS release
WORKDIR /app
ENV NODE_ENV=production

# Everything copied here comes from a stage that already passed
# typecheck/lint/test (see the `test` stage above), except node_modules,
# which is intentionally the separate production-only install so no
# devDependency ever reaches the runtime image.
COPY --from=install-prod --chown=bun:bun /app/node_modules ./node_modules
COPY --from=test --chown=bun:bun /app/package.json ./package.json
COPY --from=test --chown=bun:bun /app/tsconfig.json ./tsconfig.json
COPY --from=test --chown=bun:bun /app/src ./src

# The official oven/bun images ship a pre-created, unprivileged `bun`
# user for exactly this purpose — running as root inside the container
# is never necessary for this app.
USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "src/index.ts"]
