# AgentCore requires ARM64 images (<= 2 GB). Two-stage: bundle, then a lean runtime
# image with prod deps only. Builds the existing sam-server sources — the only new
# code is src/agentcore/.
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
# AgentCore health probe hits GET /ping; traffic hits POST /invocations.
CMD ["node", "dist/agentcore-server.cjs"]
