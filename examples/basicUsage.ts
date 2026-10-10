/**
 * daimon 编程式用法示例。
 *
 * 两种用法：
 *   1) 作为个人 Agent（推荐）—— createKernel 装配 model/tools/memory/session
 *   2) 仅用模型接入能力 —— 直接用 Harness
 *
 * 运行（无需真实 key 也能跑通装配部分）：
 *   export AGNES_API_KEYS="key1,key2,key3"
 *   npx tsx examples/basicUsage.ts
 */

import { createKernel } from "../src/kernel.js";
import { Harness } from "../src/capabilities/model/harness.js";
import { HarnessConfig, ProviderConfig } from "../src/capabilities/model/config.js";
import "../src/capabilities/model/providers/index.js";

const AGNES = {
  baseUrl: "https://api.agnes-ai.cn/v1",
  apiKeyEnv: "AGNES_API_KEYS", // 环境变量，多 key 逗号分隔
  defaultModels: {
    text: "agnes-text-free",
    image: "agnes-image",
    video: "agnes-video-new-flash",
    audio: "agnes-tts-free",
    multimodal: "agnes-text-free",
  },
  cooldownSeconds: 60,
  roundRobin: false, // 主 key 优先，额度耗尽再轮换
};

/** 用法一：作为个人 Agent */
async function demoAgent(): Promise<void> {
  const { ctx, agent, stop } = await createKernel({
    model: {
      defaultProvider: "agnes",
      providers: { agnes: AGNES },
    },
    dataDir: "./.daimon", // 记忆/会话落盘位置
  });

  // 注册一个工具（返回值是注销函数，可交给 ctx.effect 托管）
  const tools = (ctx as any).tools;
  tools.register({
    name: "now",
    description: "获取当前时间",
    handler: () => new Date().toISOString(),
  });

  console.log("已装配能力:", ["model", "tools", "memory", "session"].filter((k) => (ctx as any)[k]));
  console.log("已启用 provider:", (ctx as any).model.listProviders());
  console.log("已注册工具:", tools.list().map((t: any) => t.name));

  // 实际对话（会真实调用模型，取消注释即可用）
  // const reply = await agent.chat("现在几点？");
  // console.log("daimon>", reply);

  // 记一条长期记忆，之后会话会自动召回
  // agent.remember("用户偏好中文回复", ["偏好"]);

  await stop();
  console.log("Agent 示例结束（取消注释即可实际对话）。");
}

/** 用法二：仅用模型接入能力（多 Key 自动轮转） */
async function demoModelOnly(): Promise<void> {
  const harness = new Harness(
    new HarnessConfig({
      defaultProvider: "agnes",
      providers: {
        agnes: new ProviderConfig({ name: "agnes", ...AGNES }),
        "edge-tts": new ProviderConfig({
          name: "edge-tts",
          keys: [], // 无需 key
          defaultModels: { audio: "zh-CN-XiaoxiaoNeural" },
        }),
      },
    }),
  );

  console.log("providers:", harness.listProviders());
  console.log("agnes 信息:", harness.providerInfo("agnes"));

  // const text = await harness.generate("agnes", "text", "用一句话介绍量子纠缠");
  // console.log(text.text);
  // const audio = await harness.generate("edge-tts", "audio", "你好，这是测试语音", { output: "out.mp3" });

  console.log("模型直用示例结束（取消注释即可实际调用）。");
}

async function main(): Promise<void> {
  await demoAgent();
  console.log("---");
  await demoModelOnly();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
