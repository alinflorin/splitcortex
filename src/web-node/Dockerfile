# Build context: src/web-node

FROM node:26-slim AS test
WORKDIR /app
RUN npm install -g pnpm@12.19.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Failing tests do not fail this step: it writes reports/junit.xml and reports/exit-code, so CI can export the report
# (`--target test-report`) even when they fail. The build stage below fails the image on a non-zero exit code.
RUN mkdir -p reports; pnpm test:ci; echo $? > reports/exit-code; true

# Only the reports, for `docker build --target test-report --output type=local,dest=<dir>`.
FROM scratch AS test-report
COPY --from=test /app/reports /

FROM test AS build
RUN [ "$(cat reports/exit-code)" = 0 ] || { echo "Unit tests failed: see the JUnit report (target test-report)"; exit 1; }
# The release version, reported to the gateway (empty outside a tag build).
ARG APP_VERSION=
ENV VITE_APP_VERSION=$APP_VERSION
RUN pnpm build
# Brotli copies of the compressible files; Caddy serves them (`precompressed br`).
RUN node scripts/precompress.mjs dist

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# Unprivileged: listens on 8080, config/data dirs in /tmp.
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
USER 65532:65532
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
