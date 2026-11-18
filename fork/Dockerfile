# Image of this fork: upstream Outline plus the fork's own commits.
#
# A single multi-stage build so that the upstream Dockerfile and
# Dockerfile.base stay untouched and rebasing onto upstream never conflicts.
# Build from the repository root:
#
#   docker build -f fork/Dockerfile -t outline-fork .
#
ARG NODE_IMAGE=node:26.13.1
ARG NODE_SLIM_IMAGE=node:26.13.1-slim
ARG APP_PATH=/opt/outline

# --- Build: install all dependencies, build server and client, then keep only
# the production dependencies.
FROM ${NODE_IMAGE} AS build

ARG APP_PATH
# Optional registry for corepack's Yarn download, for networks that cannot
# reach repo.yarnpkg.com.
ARG COREPACK_NPM_REGISTRY=
ENV COREPACK_NPM_REGISTRY=${COREPACK_NPM_REGISTRY}
ENV NODE_OPTIONS="--max-old-space-size=12000"
WORKDIR $APP_PATH

# Build tools installed like upstream; may be set empty where no Debian
# mirror is reachable, as dependency install scripts are disabled anyway.
ARG BUILD_APT_PACKAGES=cmake
RUN if [ -n "$BUILD_APT_PACKAGES" ]; then \
      apt-get update && apt-get install -y $BUILD_APT_PACKAGES && \
      rm -rf /var/lib/apt/lists/*; \
    fi
RUN npm install -g corepack && corepack enable

COPY ./package.json ./yarn.lock ./.yarnrc.yml ./
COPY ./patches ./patches
RUN yarn install --immutable --network-timeout 1000000 && yarn cache clean

COPY . .
ARG CDN_URL
RUN yarn build

RUN yarn workspaces focus --production && yarn cache clean

# --- Runner: the same layout and defaults as the upstream image.
FROM ${NODE_SLIM_IMAGE} AS runner

LABEL org.opencontainers.image.source="https://github.com/OnkelDom/outline"
LABEL org.opencontainers.image.description="Outline with the fork's own extensions"

ARG APP_PATH
WORKDIR $APP_PATH
ENV NODE_ENV=production
ENV MALLOC_ARENA_MAX=2

RUN addgroup --gid 1001 nodejs && \
    adduser --uid 1001 --ingroup nodejs nodejs && \
    mkdir -p /var/lib/outline && \
    chown -R nodejs:nodejs /var/lib/outline && \
    chown -R nodejs:nodejs $APP_PATH

COPY --from=build --chown=nodejs:nodejs $APP_PATH/build ./build
COPY --from=build --chown=nodejs:nodejs $APP_PATH/server ./server
COPY --from=build --chown=nodejs:nodejs $APP_PATH/public ./public
COPY --from=build --chown=nodejs:nodejs $APP_PATH/.sequelizerc ./.sequelizerc
COPY --from=build --chown=nodejs:nodejs $APP_PATH/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs $APP_PATH/package.json ./package.json

# Runtime packages: git is used by the Git sync for collections.
ARG RUNTIME_APT_PACKAGES=git
RUN if [ -n "$RUNTIME_APT_PACKAGES" ]; then \
      apt-get update && apt-get install -y --no-install-recommends $RUNTIME_APT_PACKAGES ca-certificates && \
      rm -rf /var/lib/apt/lists/*; \
    fi

ENV FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data
RUN mkdir -p "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
    chown -R nodejs:nodejs "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
    chmod 1777 "$FILE_STORAGE_LOCAL_ROOT_DIR"

VOLUME /var/lib/outline/data

USER nodejs

# Uses Node's fetch rather than wget, so the slim image needs no extra packages.
HEALTHCHECK --interval=1m CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/_health').then(r => r.text()).then(t => process.exit(t.includes('OK') ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 3000
CMD ["node", "build/server/index.js"]
