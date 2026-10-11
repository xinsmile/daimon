# 免费模型可用性核对表

> 本表对照 `config.example.yaml` 中**已预填**的模型名，标注其免费状态与核实方式。
> 模型名按公开文档 / 项目经验预填；标注 ⚠️ 的请以你账号控制台「实际免费档」为准后再上线。
> 所有密钥只走环境变量（如 `AGNES_API_KEYS`），绝不入库。

---

## 一、零密钥 / 全免费

| Provider | 已填模型名 | 模态 | 免费状态 | 核实方式 |
|---|---|---|---|---|
| **pollinations** | `text=openai`<br>`image=flux`<br>`audio=openai-audio`<br>`video=veo2` | text / image / audio / video | ✅ 完全免费，无需任何 Key | 直接可用，无需控制台 |
| **edge-tts** | `audio=zh-CN-XiaoxiaoNeural` | audio | ✅ 微软免费 TTS，无 Key | 直接可用（`npm i edge-tts`） |

---

## 二、OpenAI 兼容的免费 / 免费额度服务

> 接入方式：在 `config.yaml` 加一段 `plugin: openai-compatible` + `base_url` + `api_key_env`，**零代码**。

| Provider | 已填模型名 | 模态 | 免费状态 | 核实方式 |
|---|---|---|---|---|
| **agnes** | `text=agnes-text-free`<br>`image=agnes-image`<br>`video=agnes-video-new-flash`<br>`audio=agnes-tts-free`<br>`multimodal=agnes-text-free` | text / image / video / audio / multimodal | ⚠️ `image`/`video` 按既有项目经验为免费档；`text`/`audio` 为占位名，请以 Agnes 控制台实际免费模型名为准 | Agnes 控制台「模型」页 |
| **zhipu**（智谱 GLM） | `text=glm-4-flash`<br>`image=cogview-4` | text / image | ✅ `glm-4-flash` 为公开免费档；`cogview-4` 有免费额度 | 智谱开放平台 → 模型列表 |
| **siliconflow**（硅基流动） | `text=Qwen/Qwen2.5-7B-Instruct`<br>`image=SDXL-Lightning` | text / image | ✅ 两者均有免费额度 | 硅基流动 → 模型广场 |
| **openrouter** | `text=meta-llama/llama-3.1-8b-instruct:free` | text / image | ✅ 模型名带 `:free` 后缀即免费档（语义明确） | OpenRouter 模型页（带 `:free`） |
| **groq** | `text=llama-3.1-8b-instant` | text / image | ✅ 公开免费档 | Groq 控制台 → Docs |
| **gemini**（Google） | `text=gemini-2.0-flash` | text / image | ✅ 有免费档（每日配额） | Google AI Studio |
| **qianfan**（百度千帆） | `text=ernie-4.0-8k-latest` | text / image | ⚠️ 有免费配额 / 体验额度，模型名可能随版本调整 | 千帆控制台 → 免费额度 |
| **bailian**（阿里百炼） | `text=qwen-plus` | text / image | ⚠️ 有赠送免费额度（`qwen-plus`/`qwen-turbo` 常含） | 百炼控制台 → 模型 |

---

## 三、多 Key 轮转说明

免费额度服务（agnes / 智谱 / 硅基流动 / …）通常限制 **每日 / 每月免费配额**。daimon 内置：

- 同一 provider 配置多个 key（`api_key_env` 用逗号分隔：`export AGNES_API_KEYS="k1,k2,k3"`）；
- 额度耗尽（上游 429 + 含 `quota`/`额度` 字样）→ 自动切下一个 key；
- 触发限流 → 该 key 进入冷却，到期自动恢复；
- 连续失败达上限 → 判定失效并轮换；
- 密钥状态持久化**只存 SHA-256 哈希，绝不存明文**。

---

## 四、如何核对 / 修正某个模型名

1. 打开对应平台控制台，找到「模型」或「免费额度」页，确认当前可用的免费模型 ID；
2. 在 `config.yaml` 的对应 provider 下改 `default_models.<模态>`；
3. 跑一次验证：
   ```bash
   npx tsx src/cli.ts --config config.yaml run --provider <name> --modality text --prompt "ping"
   ```
4. 若返回正常文本即生效；若 404/无效模型，按控制台修正模型名。
