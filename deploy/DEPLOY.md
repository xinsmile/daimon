# daimon 部署指南

daimon 是 **CLI + 库** 形态的 Agent 框架（cordis 内核）。它提供两个可常驻的服务入口：

- **HTTP API 服务**（`serve`）：用 Node 内置 `http` 实现，零新增依赖，对外提供 `/chat`、`/run`、`/health`、`/providers`。
- **MCP stdio Server**（`mcp`）：用 Node 标准库实现 MCP over stdio（JSON-RPC 2.0），把 `chat` / `run` / `list_providers` 暴露成 MCP 工具。

> 公共前提：目标机需 **Node ≥ 18.18**。默认 provider 为 `pollinations`（零密钥），不填任何 key 也能跑通。

---

## 1. 源码部署（最灵活，推荐先跑通）

```bash
git clone https://github.com/xinsmile/daimon.git && cd daimon
npm install
cp config.example.yaml config.yaml
npm run build          # 产出 dist/（含 cli.js / server.js / mcpServer.js）

# 启动 HTTP 服务（默认 http://0.0.0.0:3000）
node dist/cli.js serve --config config.yaml --port 3000 --data-dir ./data

# 或单轮 / 交互 CLI
node dist/cli.js chat --prompt "你好"
node dist/cli.js list-providers
```

`serve` 参数：`--port`（默认 3000）、`--host`（默认 0.0.0.0）、`--token`（或环境变量 `DAEMON_API_TOKEN`）、`--data-dir`（记忆/会话落盘目录，默认当前目录）。

### HTTP 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 否 | `{ ok, providers }` |
| GET | `/providers` | 否 | 已启用 provider 列表 |
| POST | `/chat` | 是 | body `{ prompt, provider? }` → `{ reply }` |
| POST | `/run` | 是 | body `{ provider, modality, prompt, model?, output?, params? }` → 生成结果 |

> 设置 token 后，`/chat` 与 `/run` 需带 `Authorization: Bearer <token>`。未设置则关闭鉴权。

```bash
# 示例
curl -s localhost:3000/health
curl -s -X POST localhost:3000/chat \
  -H "Content-Type: application/json" -H "Authorization: Bearer $DAEMON_API_TOKEN" \
  -d '{"prompt":"你好"}'
curl -s -X POST localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{"provider":"pollinations","modality":"image","prompt":"a cat","output":"./data/cat.png"}'
```

---

## 2. Docker 部署

```bash
# 构建镜像
docker build -t daimon:0.1.0 .

# 单容器运行（零密钥默认；数据卷持久化记忆/会话）
docker run -d --name daimon -p 3000:3000 \
  -e DAEMON_API_TOKEN=change-me \
  -v daimon-data:/data daimon:0.1.0

# 或用 compose（自动读取宿主机同名环境变量注入密钥）
DAEMON_API_TOKEN=change-me docker compose up -d --build
docker compose logs -f
```

- 配置：镜像内已 `cp config.example.yaml config.yaml`（pollinations 默认）。需要自定义时，挂载覆盖：`-v ./config.yaml:/app/config.yaml:ro`。
- 改端口：`command: ["serve","--port","8080",...]`（compose 里取消注释 `command` 行）。
- 健康检查：`curl -f localhost:3000/health`。

---

## 3. systemd 守护（裸机 / VPS）

```bash
# 1) 部署到 /opt/daimon 并构建
sudo mkdir -p /opt/daimon && sudo cp -r . /opt/daimon/ && cd /opt/daimon
npm ci && npm run build && cp config.example.yaml config.yaml

# 2) 运行用户与数据目录
sudo useradd -r -s /usr/sbin/nologin daimon || true
sudo mkdir -p /etc/daimon /var/lib/daimon && sudo chown daimon:daimon /var/lib/daimon
sudo cp deploy/daimon.env.example /etc/daimon/daimon.env   # 按需填写密钥，chmod 600
sudo chmod 600 /etc/daimon/daimon.env

# 3) 安装 unit（注意核对 ExecStart 里 node 路径：which node）
sudo cp deploy/daimon.service /etc/systemd/system/daimon.service
sudo systemctl daemon-reload
sudo systemctl enable --now daimon
sudo systemctl status daimon && journalctl -u daimon -f
```

---

## 4. pm2 守护

```bash
npm ci && npm run build && cp config.example.yaml config.yaml
mkdir -p data
npm i -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup   # 开机自启
pm2 logs daimon
```

---

## 5. 作为 MCP Server（供 Claude / 其它 MCP 客户端调用）

MCP 客户端配置示例（stdio）：

```json
{
  "mcpServers": {
    "daimon": {
      "command": "node",
      "args": ["dist/cli.js", "--config", "config.yaml", "mcp"]
    }
  }
}
```

暴露工具：`chat`（`{prompt, provider?}`）、`run`（`{provider, modality, prompt, ...}`）、`list_providers`（`{}`）。
协议：MCP `2024-11-05`；`initialize` / `tools/list` / `tools/call` / `ping`。

---

## 6. 密钥与环境变量

- 密钥**只走环境变量**（`AGNES_API_KEYS`、`ZHIPU_API_KEYS`…），逗号分隔可多个，额度耗尽自动轮转；状态持久化只存 key 的 SHA-256，绝不存明文。
- 默认 `pollinations` 零密钥，可先不填任何 key 跑通。
- 各 provider 免费模型可用性清单见 [docs/FREE_MODELS.md](../docs/FREE_MODELS.md)。

## 7. 数据持久化与注意事项

- **`dataDir`**：`memory.json` / `session.json` 落盘于此。裸机/容器记得把该目录挂卷（compose 已挂 `daimon-data:/data`，systemd 用 `/var/lib/daimon`）。
- **多租户**：HTTP/MCP 服务当前为**单会话**（一个进程共享一份 session 历史）。若要多用户隔离，需基于 `SessionService` 按 sessionKey 扩展。
- **serverless**：CloudFlare Worker / Vercel 等边缘环境不支持本地文件落盘，需把 `memory`/`session` 换成内存或对象存储，并确认可用 Node 运行时。
- **安全**：HTTP 服务无内置限速，公网暴露时务必设置 `DAEMON_API_TOKEN` 并在反向代理层加 TLS / 限流。
