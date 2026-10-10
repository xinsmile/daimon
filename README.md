# deepseek-harness

> 可扩展的**免费大模型服务**接入框架 —— **Everything is a Plugin**。
> 通用免费模型插件系统 + Agnes 多模态免费服务接入 + 多 Key 额度耗尽自动轮转。

本项目**架构上基于并致敬** [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（深度求索官方的 TypeScript 仓库，标语即 “Everything is a Plugin”）。
鉴于官方仓库是一个 279MB 的 pnpm 多包 monorepo（agent / llm / mcp ……），本项目取其**插件化内核思想**，做成一个**聚焦、自包含、零构建即可运行**的 TypeScript 实现，专门解决三件事：

1. **通用免费模型插件**：其它免费服务接入只需极少改动，覆盖 文本 / 图像 / 音频 / 视频 / 多模态。
2. **接入 Agnes 免费模型**：`https://www.agnes-ai.cn/zh-Hans/docs/overview`（OpenAI 兼容，`https://api.agnes-ai.cn/v1`）。
3. **多 Key 自动轮转**：配置多个 key，免费额度用完自动切换到下一个，限流自动冷却。

---

## ✨ 特性

- **插件即一切**：`Provider` 是一个 `Plugin`，能力（Capability）按模态拆分，注册即可用。
- **极低接入成本**：新免费服务只需继承 `OpenAICompatiblePlugin`（白嫖文本/图像）或 `BasePlugin`（自定义模态），**零 HTTP 样板代码**。
- **多 Key 轮转**：`KeyManager` 自动在多个 key 间轮换，额度耗尽→标记失效换下一个；限流→冷却后恢复；连续失败超限→失效。
- **多模态**：文本、图像、音频（TTS）、视频（提交+轮询）、多模态（图文对话）开箱支持。
- **安全**：密钥只走环境变量 / 本地文件，状态持久化**只存 key 哈希，绝不存明文**。
- **零强制依赖**：核心仅依赖 Node 原生 `fetch` + `yaml`；`edge-tts` 为可选依赖。

---

## 📁 目录结构

```
deepseek-harness/
├── package.json            # 依赖与脚本（dev/test/build）
├── tsconfig.json           # TS 配置（NodeNext，.js 扩展名导入）
├── config.example.yaml     # 配置示例（不写密钥，只写 apiKeyEnv 变量名）
├── .gitignore
├── src/
│   ├── index.ts            # 公共导出入口
│   ├── config.ts           # ProviderConfig / HarnessConfig（YAML/JSON + 环境变量）
│   ├── cli.ts              # 命令行（list-providers / key-status / run）
│   ├── core/
│   │   ├── types.ts        # Modality、KeyState、parseModality
│   │   ├── errors.ts       # 异常体系（QuotaExhausted / RateLimited / NoHealthyKey …）
│   │   ├── results.ts      # 结果对象（TextResult / ImageResult / AudioResult / VideoResult …）
│   │   ├── http.ts         # 原生 fetch 封装 + 异常分类 + 超时
│   │   ├── keyManager.ts   # ★ 多 Key 轮转核心（额度检测/冷却/持久化）
│   │   ├── plugin.ts       # ★ 插件基类 / Capability / 注册表 / 带轮转的 request
│   │   └── harness.ts      # 编排器：加载配置 → 装配插件 → 路由请求
│   └── plugins/
│       ├── index.ts        # 注册入口（副作用导入触发 register）
│       ├── openaiCompatible.ts  # 通用 OpenAI 兼容基类（文本/图像）
│       ├── agnes.ts        # Agnes 插件（文本/图像/视频/音频/多模态）
│       └── edgeTts.ts      # edge-tts 免费 TTS（零密钥，演示极简接入）
├── examples/
│   └── basicUsage.ts       # 编程式用法示例
└── tests/                  # 单元测试（node:test，mock fetch）
    ├── keyManager.test.ts
    ├── registry.test.ts
    └── agnes.test.ts
```

---

## 🧩 核心模块设计

### 1. 插件系统（`core/plugin.ts`）——“Everything is a Plugin”

```
                ┌──────────────┐
   provider ──▶ │   Harness    │  加载配置 + 装配插件 + 路由
                └──────┬───────┘
                       │ buildPlugin(name, config)
                ┌──────▼───────┐
                │  BasePlugin  │  ◀── 所有 provider 的基类
                │ - keys(KeyManager)
                │ - request() 带密钥轮转
                │ - makeCapability(modality)
                └──────┬───────┘
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
   OpenAICompatible  AgnesPlugin   EdgeTTSPlugin
   (文本/图像)        (多模态)      (零密钥 TTS)
          │            │
          └── Agnes 继承 OpenAICompatible（文本/图像零代码复用）
```

- **`Capability`**：单模态执行单元（`generate(prompt, opts)`）。
- **`BasePlugin`**：持有 `KeyManager` 与 `request()`（自动跨 key 重试）；`makeCapability(modality)` 返回对应能力。
- **`register(name, Ctor)`** + `REGISTRY`：插件在模块底部注册，导入即生效。

### 2. 多 Key 轮转（`core/keyManager.ts`）—— 需求 3

`KeyManager` 管理同一 provider 的多个 key，状态机：

```
        ┌──────────┐  QuotaExhausted  ┌────────────┐
        │ ACTIVE   │ ───────────────▶ │ EXHAUSTED  │  (额度用尽，永久失效，轮换下一个)
        └────┬─────┘                   └────────────┘
             │ RateLimited / 冷却到期
             ▼
        ┌──────────┐  冷却到期自动  ┌──────────┐
        │ COOLDOWN │ ────────────▶ │ ACTIVE   │
        └──────────┘               └──────────┘
```

- **额度耗尽**（`QuotaExhausted`，HTTP 402/429 + quota/额度 字样）→ 标记 `EXHAUSTED`，换下一个 key。
- **限流**（`RateLimited`）→ 进入 `COOLDOWN`，`cooldown_seconds` 后自动恢复。
- **其它失败** → 累计次数，达到 `max_failures` 判定失效，避免死循环刷坏 key。
- **持久化**：key 状态写入 `state_file`，且仅存 **SHA-256 哈希索引**，不存明文。
- **可观测**：`harness key-status` 查看每个 key 的状态/冷却剩余。

`BasePlugin.request()` 在此基础上实现自动重试：

```
请求 → acquire(key) → 成功: reportSuccess
                   → QuotaExhausted: reportQuota, 换下一个 key
                   → RateLimited: 冷却, 换下一个 key
                   → 其它错误: reportFailure, 换下一个 key
     全部 key 不可用 → 抛出最后一个错误 / NoHealthyKey
```

### 3. HTTP 层（`core/http.ts`）

基于 Node 原生 `fetch`，统一超时（AbortController）与异常分类：4xx/5xx → `ProviderError`，402/429+额度字样 → `QuotaExhausted`，其它 429 → `RateLimited`。便于测试中整体 mock（替换 `globalThis.fetch`）。

### 4. Agnes 插件（`plugins/agnes.ts`）—— 需求 2

- **Base URL**：`https://api.agnes-ai.cn/v1`，认证 `Authorization: Bearer <key>`，OpenAI 兼容。
- **文本 / 图像**：直接继承 `OpenAICompatiblePlugin`，**零重复代码**。
- **视频**：异步「提交 + 轮询」（免费模型 `agnes-video-new-flash`）。
- **音频**：TTS（`/audio/speech`，OpenAI 风格）。
- **多模态**：图文混合对话（vision chat）。
- 视频/音频的**端点与字段抽到 `config.extra`**，改配置即可，无需改代码。

> ⚠️ **需按目标版本核实**：Agnes 文档站当前仅公开 overview，视频/音频的**具体端点路径与响应字段**以 Agnes 控制台 / 官方文档为准。免费模型名已按既有项目经验预填（`agnes-image` / `agnes-video-new-flash` / 等），请以控制台实际免费模型名为准。

---

## 🚀 快速开始

### 安装

```bash
git clone <your-repo>/deepseek-harness
cd deepseek-harness
npm install
```

### 配置

```bash
cp config.example.yaml config.yaml
export AGNES_API_KEYS="key1,key2,key3"   # 多个 key 逗号分隔，额度用完自动轮换
```

### CLI

```bash
# 列出已注册插件与已启用 provider 及其模态
npx tsx src/cli.ts --config config.yaml list-providers

# 查看 key 轮转状态
npx tsx src/cli.ts --config config.yaml key-status --provider agnes

# 发起一次生成（文本 / 图像 / 音频 / 视频 / 多模态）
npx tsx src/cli.ts --config config.yaml run --provider agnes --modality text --prompt "用一句话介绍量子纠缠"
npx tsx src/cli.ts --config config.yaml run --provider agnes --modality video --prompt "一只猫在跑步" --output cat.mp4
npx tsx src/cli.ts --config config.yaml run --provider edge-tts --modality audio --prompt "你好，这是测试" --output hi.mp3
```

> 也可用编译后的入口：`npm run build` 后 `node dist/cli.js ...`。

### 编程式

```ts
import { Harness, ProviderConfig, HarnessConfig } from "deepseek-harness";
import "deepseek-harness/dist/plugins/index.js";

const harness = new Harness(new HarnessConfig({
  defaultProvider: "agnes",
  providers: {
    agnes: new ProviderConfig({
      name: "agnes",
      baseUrl: "https://api.agnes-ai.cn/v1",
      apiKeyEnv: "AGNES_API_KEYS",
      defaultModels: { text: "agnes-text-free", image: "agnes-image", video: "agnes-video-new-flash" },
    }),
  },
}));

const text = await harness.generate("agnes", "text", "你好");
console.log(text.text);
```

---

## ➕ 如何新增一个免费服务（需求 1 的落地）

绝大多数免费服务是 OpenAI 兼容的。新增一个**只需几行**：

```ts
import { OpenAICompatiblePlugin, register, type PluginCtor } from "deepseek-harness";

class MyFreePlugin extends OpenAICompatiblePlugin {
  name = "myfree";
  description = "某免费服务（OpenAI 兼容）";
  modalities = ["text", "image"] as const as any; // 直接复用文本/图像能力
}
register("myfree", MyFreePlugin as unknown as PluginCtor);
```

若还需视频/音频等差异模态，覆写 `makeCapability(modality)` 返回你的 `Capability` 即可——密钥轮转、HTTP、错误处理全部复用，**无需重写一行基础设施代码**。`edgeTts.ts` 即是「零密钥免费服务极简接入」的范例。

---

## ✅ 测试与验证

```bash
npm test
```

- `keyManager.test.ts`：轮转、额度耗尽、限流冷却、连续失败失效、round-robin、持久化不泄露明文、reset。
- `registry.test.ts`：插件注册、能力装配与路由、不支持模态报错。
- `agnes.test.ts`：文本/多模态解析、视频直出与提交+轮询、音频字节、额度耗尽自动轮换、全部 key 耗尽抛错（均 mock `fetch`，无需真实 key）。

当前状态：**18/18 全部通过**，`tsc --noEmit` 类型检查通过，`npm run build` 可产出 `dist`。

---

## 📄 许可证

MIT
