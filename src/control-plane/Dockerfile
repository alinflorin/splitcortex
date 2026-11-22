# Build context: src/control-plane
FROM node:26-slim AS base
RUN npm install -g pnpm@12.19.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS test
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
RUN pnpm build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/main.js"]
