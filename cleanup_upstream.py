#!/usr/bin/env python3
"""
高效删除 GitHub 仓库中上游残留文件（asyncio + aiohttp）。
"""
import asyncio
import aiohttp
import sys
import subprocess
from pathlib import Path

OWNER = "xinsmile"
REPO = "deepseek-harness"
BRANCH = "master"

KEEP = set([
    ".gitignore", "README.md", "config.example.yaml", "examples/basicUsage.ts",
    "package-lock.json", "package.json",
    "src/cli.ts", "src/config.ts",
    "src/core/errors.ts", "src/core/harness.ts", "src/core/http.ts",
    "src/core/keyManager.ts", "src/core/plugin.ts", "src/core/results.ts",
    "src/core/types.ts", "src/index.ts",
    "src/plugins/agnes.ts", "src/plugins/edgeTts.ts",
    "src/plugins/index.ts", "src/plugins/openaiCompatible.ts",
    "tests/agnes.test.ts", "tests/keyManager.test.ts", "tests/registry.test.ts",
    "tsconfig.json",
])

async def get_token() -> str:
    try:
        result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception as e:
        print(f"Failed to get gh token: {e}", file=sys.stderr)
    return ""

async def fetch_tree(session: aiohttp.ClientSession, token: str) -> list[tuple[str, str]]:
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/git/trees/{BRANCH}?recursive=1"
    headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
    async with session.get(url, headers=headers) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Failed to fetch tree: {resp.status}")
        data = await resp.json()
        return [(item["path"], item["sha"]) for item in data.get("tree", []) if item["type"] == "blob"]

async def delete_file(session: aiohttp.ClientSession, token: str, path: str, sha: str, sem: asyncio.Semaphore):
    async with sem:
        url = f"https://api.github.com/repos/{OWNER}/{REPO}/contents/{path}"
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
        }
        body = {"sha": sha, "message": "chore: remove upstream residual"}
        async with session.delete(url, headers=headers, json=body) as resp:
            if resp.status in (200, 201, 204):
                return True, path
            elif resp.status == 404:
                return None, path  # already gone
            else:
                text = await resp.text()
                return False, (path, resp.status, text[:200])

async def main():
    print("Getting GitHub token...", file=sys.stderr)
    token = await get_token()
    if not token:
        print("No GitHub token found", file=sys.stderr)
        sys.exit(1)

    print("Fetching remote tree...", file=sys.stderr)
    async with aiohttp.ClientSession() as session:
        all_files = await fetch_tree(session, token)
    print(f"Total blob files on remote: {len(all_files)}", file=sys.stderr)

    # Filter to files to delete
    to_delete = [(p, s) for p, s in all_files if p not in KEEP]
    print(f"Files to delete: {len(to_delete)}", file=sys.stderr)

    sem = asyncio.Semaphore(15)  # 15 concurrent
    ok = 0; fail = 0; skip = 0
    batch_size = 300

    for i in range(0, len(to_delete), batch_size):
        batch = to_delete[i:i+batch_size]
        coros = [delete_file(session, token, p, s, sem) for p, s in batch]
        results = await asyncio.gather(*coros)
        for r in results:
            if r[0] is True:
                ok += 1
            elif r[0] is None:
                skip += 1
            else:
                fail += 1
                print(f"FAIL {r[1]}", file=sys.stderr)
        print(f"Progress: {min(i+batch_size, len(to_delete))}/{len(to_delete)} ok={ok} fail={fail} skip={skip}", flush=True)

    print(f"=== DONE ok={ok} fail={fail} skip={skip} ===")

if __name__ == "__main__":
    asyncio.run(main())
