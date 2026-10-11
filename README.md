# daimon

> 一个**个人 Agent** —— 基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 同源的 **cordis** 插件内核，**Everything is a Plugin**。
> 「免费多模型接入 + 多 Key 额度耗尽自动轮转」是它的**能力之一**，此外还有工具、记忆、会话。

---

## 🎯 这是什么

`daimon` 是一个**个人 Agent 框架**，不是单纯的模型接入库。它借鉴 deepseek-harness 的架构：
用 [cordis](https://github.com/cordiverse/cordis)（deepseek-harness 的插件内核，v4）管理**能力**，
每个能力都是一个可插拔的 `Service`，通过 `ctx.model` / `ctx.tools` 互相注入。

```
                    ┌─────────────────────────┐
                    │   cordis Context (ctx)  │  ← 插件内核（来自 deepseek-harness 同源）
                    └───────────┬─────────────┘
                                │ ctx.plugin(Service)
        ┌───────────┬───────────┼───────────┬────────────┐
        ▼           ▼           ▼           ▼            ▼
    ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
    │ model  │ │ tools  │ │  memory  │ │ session  │        ← 四大能力（可插拔）
    │ 模型接入│ │ 工具调用│ │  记忆    │ │  会话    │
    └───┬────┘ └────────┘ └──────────┘ └──────────┘
        │                        ▲
        │  ┌─────────────────────┘
        │  │ 组合
        ▼  ▼
   ┌────────────┐
   │   Agent    │  对话循环：记忆召回 → 组上下文 → 生成 → 工具回灌
   └────────────┘
```

**两层插件结构**（与 deepseek-harness 一致）：
- **外层（cordis）**：管「能力」—— model / tools / memory / session
- **内层（model 能力内部）**：管「模型 provider」—— agnes / openai-compatible / edge-tts

---

## ✨ 能力一览

| 能力 | 服务名 | 作用 |
|---|---|---|
| **model** | `ctx.model` | 免费模型接入 + 多 Key 轮转（文本/图像/音频/视频/多模态） |
| **tools** | `ctx.tools` | 工具注册与调用，支持 `ctx.effect()` 卸载时自动注销 |
| **memory** | `ctx.memory` | 长期记忆，本地 JSON 持久化 + 关键词召回 |
| **session** | `ctx.session` | 多轮会话持久化，支持断点续聊 |
| **Agent** | — | 组合上述能力，`chat()` 完成一次对话（含工具回灌循环） |

### model 能力（内建 provider）

- **通用免费模型插件**：新服务继承 `OpenAICompatiblePlugin` 即可，**零 HTTP 样板代码**；通过 `plugin` 字段，智谱/硅基流动/OpenRouter/Groq/Gemini/千帆/百炼等 OpenAI 兼容服务**零代码接入**
- **Agnes**：`https://api.agnes-ai.cn/v1`（OpenAI 兼容），覆盖文本/图像/视频/音频/多模态
- **Pollinations.AI**：`https://pollinations.ai`（全模态、**完全免费、无需 API Key**），文本/图像/音频/视频
- **edge-tts**：零密钥免费 TTS，演示极简接入
- **多 Key 自动轮转**：额度耗尽→换下一个；限流→冷却后恢复；连续失败超限→失效
- **安全**：密钥只走环境变量，状态持久化**只存 key 的 SHA-256 哈希，绝不存明文**

#### 已支持免费模型 Provider

| Provider | 类型 | 模态 | 密钥环境变量 | 备注 |
|---|---|---|---|---|
| **pollinations** | 原生插件 | text / image / audio / video | 无需 | 完全免费、零密钥，已设为默认 provider |
| **agnes** | 原生插件（OpenAI 兼容） | text / image / video / audio / multimodal | `AGNES_API_KEYS` | 多模态免费服务 |
| **zhipu**（智谱 GLM） | `openai-compatible` | text / image | `ZHIPU_API_KEYS` | `base_url: open.bigmodel.cn/api/paas/v4/` |
| **siliconflow**（硅基流动） | `openai-compatible` | text / image | `SILICONFLOW_API_KEYS` | 含免费模型 |
| **openrouter** | `openai-compatible` | text / image | `OPENROUTER_API_KEYS` | 含 `:free` 模型 |
| **groq** | `openai-compatible` | text / image | `GROQ_API_KEYS` | 免费档 |
| **gemini**（Google） | `openai-compatible` | text / image | `GEMINI_API_KEYS` | 兼容网关 |
| **qianfan**（百度千帆） | `openai-compatible` | text / image | `QIANFAN_API_KEYS` | 兼容模式 |
| **bailian**（阿里百炼） | `openai-compatible` | text / image | `DASHSCOPE_API_KEYS` | 兼容模式 |
| **edge-tts** | 原生插件 | audio | 无需 | 微软免费 TTS |

> 接入新 OpenAI 兼容服务只需在 `config.yaml` 加一段 `plugin: openai-compatible` + `base_url` + `api_key_env`，**无需改代码**（见 `config.example.yaml`）。

> 📋 各 provider 的**免费模型名 → 真实可用性核对表**（含 ⚠️ 需控制台确认项）见 [docs/FREE_MODELS.md](docs/FREE_MODELS.md)。

#### 配置约定（snake_case 自动转 camelCase）

`config.yaml` 里用 `base_url` / `api_key_env` / `default_models` / `extra.video_endpoint` 等 snake_case 写法，
加载时会被**整体归一为 camelCase**，因此与代码读取（`config.extra.videoEndpoint` 等）一致，无需手写两种风格。

---

## 📁 目录结构

```
daimon/
├── package.json / tsconfig.json / .gitignore
├── config.example.yaml
├── src/
│   ├── kernel.ts               # ★ 用 cordis 装配四大能力，返回 Agent
│   ├── agent/                  # ★ 执行主体（对话循环 + 工具回灌）
│   ├── capabilities/
│   │   ├── model/              # ★ 能力一：模型接入（原有完整实现）
│   │   │   ├── service.ts      #   ModelService（包装成 cordis Service）
│   │   │   ├── keyManager.ts   #   多 Key 轮转核心
│   │   │   ├── plugin.ts       #   provider 插件基类 / Capability / 注册表
│   │   │   ├── harness.ts      #   编排器
│   │   │   ├── config.ts / types.ts / errors.ts / results.ts / http.ts
│   │   │   └── providers/      #   openaiCompatible / agnes / edgeTts / pollinations
│   │   ├── tools/              # 能力二：工具
│   │   ├── memory/             # 能力三：记忆
│   │   └── session/            # 能力四：会话
│   ├── cli.ts                  # CLI（list-providers / key-status / run / chat）
│   └── index.ts                # 公共导出
├── examples/basicUsage.ts
└── tests/                      # 49 个用例（node:test）
    ├── keyManager.test.ts
    ├── registry.test.ts
    ├── agnes.test.ts
    ├── kernel.test.ts          # 内核装配 + 四大能力 + Agent
    ├── pollinations.test.ts     # 文本/图像/音频/视频(GET直出+POST)
    ├── freeProviders.test.ts    # 7 个 OpenAI 兼容 provider
    └── integration.pollinations.test.ts  # 内核→Agent→model→pollinations→session 全链路
```

---

## 🚀 快速开始

```bash
npm install
cp config.example.yaml config.yaml
export AGNES_API_KEYS="key1,key2,key3"   # 多 key 逗号分隔，额度用完自动轮换
```

> 💡 默认 provider 已设为 `pollinations`（完全免费、无需 API Key），因此**不填任何 key 也能直接 `chat`**。
> 想用 agnes/智谱 等需 key 的服务时，再 `export` 对应环境变量并改 `default_provider` 即可。

### 作为 Agent 使用

```bash
# 单轮对话
npx tsx src/cli.ts --config config.yaml chat --prompt "你好"

# 交互模式
npx tsx src/cli.ts --config config.yaml chat
```

### 作为模型接入使用

```bash
npx tsx src/cli.ts --config config.yaml list-providers
npx tsx src/cli.ts --config config.yaml key-status --provider agnes
npx tsx src/cli.ts --config config.yaml run --provider agnes --modality text --prompt "介绍量子纠缠"
```

---

## 🧩 编程式用法

```ts
import { createKernel, ToolsService } from "daimon";

const { ctx, agent, stop } = await createKernel({
  model: {
    providers: {
      agnes: {
        baseUrl: "https://api.agnes-ai.cn/v1",
        apiKeyEnv: "AGNES_API_KEYS",
        defaultModels: { text: "agnes-text-free", video: "agnes-video-new-flash" },
      },
    },
  },
  dataDir: "./.daimon",
});

// 注册一个工具（返回注销函数，可交给 ctx.effect 托管）
ctx.tools.register({
  name: "add",
  description: "两数相加",
  handler: (args: any) => args.a + args.b,
});

// 对话（自动：召回记忆 → 组上下文 → 生成 → 工具回灌 → 写入会话）
const reply = await agent.chat("帮我算一下 2+3");
console.log(reply);

await stop();
```

也可只用模型能力：

```ts
import { Harness, HarnessConfig, ProviderConfig } from "daimon";

const harness = new Harness(
  new HarnessConfig({
    defaultProvider: "agnes",
    providers: {
      agnes: new ProviderConfig({
        name: "agnes",
        baseUrl: "https://api.agnes-ai.cn/v1",
        apiKeyEnv: "AGNES_API_KEYS",
      }),
    },
  }),
);
const r = await harness.generate("agnes", "text", "你好");
console.log(r.text);
```

---

## ➕ 扩展

### 新增一个免费模型服务

```ts
import { OpenAICompatiblePlugin, register, type PluginCtor } from "daimon";

class MyFreePlugin extends OpenAICompatiblePlugin {
  name = "myfree";
  description = "某免费服务（OpenAI 兼容）";
  modalities = ["text", "image"] as any;
}
register("myfree", MyFreePlugin as unknown as PluginCtor);
```

密钥轮转、HTTP、错误处理全部复用。差异模态（视频/音频）覆写 `makeCapability()` 即可。

### 新增一个能力

写一个 `extends Service` 的类，在 `kernel.ts` 里 `ctx.plugin(YourService)`，即可通过 `ctx.yourService` 被 Agent 或其它能力注入使用。

---

## ⚙️ 关键实现说明

- **插件内核**：[cordis](https://github.com/cordiverse/cordis) v4（`4.0.0-rc.10`），与 deepseek-harness 同源。
  `ctx.plugin()` 返回 `Fiber`（可 await / dispose），能力通过 `inject` 声明依赖。
- **工具调用协议**：采用轻量 JSON 指令（模型回复中输出 `{"tool":"名","args":{...}}`），
  不依赖 provider 的 function-calling，兼容免费模型。
- **tsconfig 解析模式**：`moduleResolution: "Bundler"`。原因是 cordis 的类型声明使用无扩展名相对导入，
  在 `NodeNext` 下会触发 TS2834 并被 `skipLibCheck` 静默吞掉，导致 `Context`/`Service` 解析不出导出成员。

---

## ✅ 测试

```bash
npm test
```

- `keyManager.test.ts`：轮转、额度耗尽、限流冷却、连续失败失效、持久化不泄露明文
- `registry.test.ts`：provider 注册、能力路由、不支持模态报错、`plugin` 字段复用
- `agnes.test.ts`：文本/多模态/视频/音频解析、额度耗尽自动轮换（mock `fetch`）
- `kernel.test.ts`：cordis 内核装配、tools/memory/session、Agent 对话与工具回灌
- `pollinations.test.ts`：文本(/openai)、图像(GET)、音频(GET)、视频(GET 直出 mp4 + POST 返回 URL)、错误（mock `fetch`）
- `freeProviders.test.ts`：智谱/硅基流动/OpenRouter/Groq/Gemini/千帆/百炼 经 `openai-compatible` 基类接入，断言 host 与鉴权头
- `integration.pollinations.test.ts`：内核→Agent→model→pollinations→session 全链路（mock `fetch`，确定性 CI）

当前状态：**49/49 全部通过**，`tsc --noEmit` 通过，`npm run build` 产出 `dist`。

> 真实端到端验证（联网）：`npx tsx src/cli.ts --config config.yaml chat --prompt "你好"` 已实测可经 Pollinations 返回文本回复。

---

## 🙏 致谢

架构与插件内核基于并致敬 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
（"Everything is a Plugin"）。本项目取其插件化内核思想，做成聚焦、自包含的个人 Agent 实现。

## 📄 许可证

MIT
