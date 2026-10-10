/**
 * 命令行入口。
 *
 * 子命令：
 *   list-providers   列出已注册/已启用的 provider 与支持模态
 *   key-status       查看某 provider 各 key 的轮转状态
 *   run              按 provider+模态 发起一次生成（文本/图像/音频等）
 *
 * 环境变量：AGNES_API_KEYS=逗号分隔的多个 Agnes key（推荐，避免密钥入库）
 */

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { Harness } from "./core/harness.js";
import { listPlugins } from "./core/plugin.js";
import { HarnessConfig } from "./config.js";
import "./plugins/index.js";

function buildHarness(needConfig: boolean, configPath?: string): Harness | null {
  if (configPath) return Harness.fromFile(configPath);
  if (!needConfig) return null;
  const def = "config.yaml";
  if (existsSync(def)) return Harness.fromFile(def);
  console.error("错误：该命令需要 --config 指定配置文件（或当前目录存在 config.yaml）");
  process.exit(2);
}

async function cmdListProviders(harness: Harness | null): Promise<void> {
  console.log("已注册插件（含未启用）:", listPlugins().join(", "));
  if (!harness) return;
  console.log("\n已启用 provider:");
  for (const name of harness.listProviders()) {
    const info = harness.providerInfo(name);
    console.log(`  - ${name}: ${info.description}`);
    console.log(`      模态: ${info.modalities.join(", ")}`);
  }
}

async function cmdKeyStatus(harness: Harness, provider?: string): Promise<void> {
  const info = harness.providerInfo(provider);
  console.log(`provider=${info.name} key 状态:`);
  console.log(JSON.stringify(info.keyStatus, null, 2));
}

async function cmdRun(harness: Harness, values: Record<string, any>): Promise<void> {
  if (!values.modality) {
    console.error("错误：run 需要 --modality");
    process.exit(2);
  }
  if (!values.prompt) {
    console.error("错误：run 需要 --prompt");
    process.exit(2);
  }
  const opts: Record<string, any> = {};
  if (values.model) opts.model = values.model;
  if (values.output) opts.output = values.output;
  if (values.params) {
    try {
      Object.assign(opts, JSON.parse(values.params));
    } catch {
      console.error("错误：--params 必须是合法 JSON");
      process.exit(2);
    }
  }

  const result = await harness.generate(values.provider, values.modality, values.prompt, opts);
  if (result && typeof result === "object") {
    const r = result as Record<string, any>;
    if (typeof r.text === "string") console.log(r.text);
    else if (Array.isArray(r.urls) && r.urls.length) r.urls.forEach((u: string) => console.log(u));
    else if (typeof r.url === "string" && r.url) console.log(r.url);
    else if (r.data) {
      if (r.path) console.log(`已写入: ${r.path}`);
      else console.log(`<二进制数据 ${r.data.length} 字节；用 --output 保存到文件>`);
    } else console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(String(result));
  }
}

function extractGlobal(argv: string[]): { config?: string; rest: string[] } {
  const rest: string[] = [];
  let config: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") config = argv[++i];
    else if (a.startsWith("--config=")) config = a.slice("--config=".length);
    else if (a === "--log-level") i++;
    else if (a.startsWith("--log-level=")) {
      /* ignore local */
    } else rest.push(a);
  }
  return { config, rest };
}

export async function main(argv: string[]): Promise<number> {
  const { config, rest } = extractGlobal(argv);
  const [command, ...sub] = rest;

  const needConfig = command === "run" || command === "key-status";
  const harness = buildHarness(needConfig, config);

  if (command === "list-providers") {
    await cmdListProviders(harness);
    return 0;
  }
  if (command === "key-status") {
    if (!harness) return 2;
    const { values } = parseArgs({
      args: sub,
      options: { provider: { type: "string" } },
      allowPositionals: true,
    });
    await cmdKeyStatus(harness, values.provider);
    return 0;
  }
  if (command === "run") {
    if (!harness) return 2;
    const { values } = parseArgs({
      args: sub,
      options: {
        provider: { type: "string" },
        modality: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string" },
        output: { type: "string" },
        params: { type: "string" },
      },
      allowPositionals: true,
    });
    await cmdRun(harness, values as Record<string, any>);
    return 0;
  }

  console.error(
    `未知或缺失子命令: ${command ?? "(无)"}\n用法: deepseek-harness [--config path] <list-providers|key-status|run> ...`,
  );
  return 2;
}

// 直接运行（tsx / node --experimental-strip-types）
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
const __main = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === __main || process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
