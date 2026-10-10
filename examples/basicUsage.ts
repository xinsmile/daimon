/**
 * 编程式用法示例（无需真实 key 也能看懂流程；联网调用需配置 AGNES_API_KEYS）。
 *
 * 运行：
 *   export AGNES_API_KEYS="key1,key2,key3"
 *   npx tsx examples/basicUsage.ts
 */

import { Harness } from "../src/core/harness.js";
import { HarnessConfig, ProviderConfig } from "../src/config.js";
import "../src/plugins/index.js";

async function main(): Promise<void> {
  const config = new HarnessConfig({
    defaultProvider: "agnes",
    providers: {
      agnes: new ProviderConfig({
        name: "agnes",
        baseUrl: "https://api.agnes-ai.cn/v1",
        apiKeyEnv: "AGNES_API_KEYS", // 从环境变量读取多个 key（逗号分隔）
        defaultModels: {
          text: "agnes-text-free",
          image: "agnes-image",
          video: "agnes-video-new-flash",
          audio: "agnes-tts-free",
          multimodal: "agnes-text-free",
        },
        cooldownSeconds: 60,
        roundRobin: false, // 主 key 优先，额度耗尽再轮换
      }),
      "edge-tts": new ProviderConfig({
        name: "edge-tts",
        keys: [], // 无需 key
        defaultModels: { audio: "zh-CN-XiaoxiaoNeural" },
      }),
    },
  });

  const harness = new Harness(config);

  // 1) 列出已装配的 provider 与模态
  console.log("providers:", harness.listProviders());
  console.log("agnes 信息:", harness.providerInfo("agnes"));

  // 2) 文本生成（自动在多 key 间轮转，额度耗尽自动换下一个）
  // const text = await harness.generate("agnes", "text", "用一句话介绍量子纠缠");
  // console.log(text.text);

  // 3) 音频（edge-tts，零密钥）
  // const audio = await harness.generate("edge-tts", "audio", "你好，这是一段测试语音", { output: "out.mp3" });

  console.log("示例结束（取消注释即可实际调用）。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
