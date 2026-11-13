# Build context: src/control-plane
FROM node:26-slim AS base
RUN npm install -g pnpm@12.19.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm test
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
