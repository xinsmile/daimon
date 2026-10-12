# ---- 构建阶段：安装全部依赖并编译 TS ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# ---- 运行阶段：仅生产依赖 + 编译产物 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY config.example.yaml README.md ./
# 零密钥默认（pollinations）：直接把示例配置作为运行配置；需要密钥时用卷挂载覆盖
RUN cp config.example.yaml config.yaml
# 数据持久化目录（记忆 / 会话）
RUN mkdir -p /data
EXPOSE 3000
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "--host", "0.0.0.0", "--port", "3000", "--config", "config.yaml", "--data-dir", "/data"]
