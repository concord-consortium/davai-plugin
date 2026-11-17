# AgentCore requires ARM64 images (<=2 GB). Two-stage: build the bundle, then a
# lean runtime image with prod deps only.
FROM --platform=linux/arm64 node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=linux/arm64 node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
# AgentCore health probe hits GET /ping; traffic hits POST /invocations (+ /ws in P3).
CMD ["node", "dist/server.cjs"]
