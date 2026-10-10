import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KeyManager } from "../src/capabilities/model/keyManager.js";
import { NoHealthyKey } from "../src/capabilities/model/errors.js";

test("acquire 返回首个可用 key", () => {
  const km = new KeyManager(["k1", "k2"]);
  assert.equal(km.acquire(), "k1");
  assert.equal(km.size, 2);
});

test("额度耗尽自动轮换到下一个 key", () => {
  const km = new KeyManager(["k1", "k2"]);
  km.reportQuota("k1");
  assert.equal(km.acquire(), "k2");
  km.reportQuota("k2");
  assert.throws(() => km.acquire(), NoHealthyKey);
});

test("限流冷却后自动恢复", async () => {
  const km = new KeyManager(["k1"], { cooldownSeconds: 1 });
  km.reportRatelimit("k1");
  assert.throws(() => km.acquire(), NoHealthyKey);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(km.acquire(), "k1");
});

test("连续失败达到上限判定 key 失效", () => {
  const km = new KeyManager(["k1"], { maxFailures: 2 });
  km.reportFailure("k1");
  assert.equal(km.acquire(), "k1"); // 还没到上限
  km.reportFailure("k1");
  assert.throws(() => km.acquire(), NoHealthyKey);
});

test("round-robin 均摊", () => {
  const km = new KeyManager(["k1", "k2", "k3"], { roundRobin: true });
  const got = new Set([km.acquire(), km.acquire(), km.acquire()]);
  assert.deepEqual([...got].sort(), ["k1", "k2", "k3"]);
});

test("持久化不写入明文 key", () => {
  const sf = path.join(os.tmpdir(), `km-${Date.now()}.json`);
  const km = new KeyManager(["SECRET_123"], { stateFile: sf });
  km.reportQuota("SECRET_123");
  const content = fs.readFileSync(sf, "utf-8");
  assert.ok(!content.includes("SECRET_123"));
  assert.ok(content.includes("exhausted"));
  fs.unlinkSync(sf);
});

test("reset 恢复失效 key", () => {
  const km = new KeyManager(["k1"]);
  km.reportQuota("k1");
  assert.throws(() => km.acquire(), NoHealthyKey);
  km.reset("k1");
  assert.equal(km.acquire(), "k1");
});
