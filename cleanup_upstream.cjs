#!/usr/bin/env node
/**
 * 高效删除 GitHub 仓库中上游残留文件（Node.js 原生 fetch + 并发控制）
 */
const { execSync } = require('child_process');
const https = require('https');

const OWNER = 'xinsmile';
const REPO  = 'deepseek-harness';
const BRANCH = 'master';

const KEEP = new Set([
  '.gitignore', 'README.md', 'config.example.yaml', 'examples/basicUsage.ts',
  'package-lock.json', 'package.json',
  'src/cli.ts', 'src/config.ts',
  'src/core/errors.ts', 'src/core/harness.ts', 'src/core/http.ts',
  'src/core/keyManager.ts', 'src/core/plugin.ts', 'src/core/results.ts',
  'src/core/types.ts', 'src/index.ts',
  'src/plugins/agnes.ts', 'src/plugins/edgeTts.ts',
  'src/plugins/index.ts', 'src/plugins/openaiCompatible.ts',
  'tests/agnes.test.ts', 'tests/keyManager.test.ts', 'tests/registry.test.ts',
  'tsconfig.json',
]);

function getToken() {
  // Try GH_TOKEN env, then gh cli
  const envTok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envTok && envTok.length > 10) return envTok;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch(e) { return ''; }
}

function ghFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      port: urlObj.port,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'deepseek-harness-cleanup',
        ...opts.headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function fetchTree(token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;
  const r = await ghFetch(url, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } });
  if (r.status !== 200) throw new Error(`tree fetch failed: ${r.status} ${r.body.slice(0, 300)}`);
  const data = JSON.parse(r.body);
  return data.tree.filter(i => i.type === 'blob').map(i => [i.path, i.sha]);
}

async function deleteFile(token, path, sha) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const body = JSON.stringify({ sha, message: 'chore: remove upstream residual' });
  const r = await ghFetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  if (r.status === 200 || r.status === 201 || r.status === 204) return [true, path];
  if (r.status === 404) return [null, path]; // already gone
  return [false, `${path} (${r.status}: ${r.body.slice(0, 200)})`];
}

async function main() {
  const token = getToken();
  if (!token) { console.error('No GitHub token'); process.exit(1); }
  console.error('Fetching remote tree...');
  const allFiles = await fetchTree(token);
  console.error(`Total blobs: ${allFiles.length}`);
  const toDelete = allFiles.filter(([p]) => !KEEP.has(p));
  console.error(`To delete: ${toDelete.length}`);

  let ok = 0, fail = 0, skip = 0;
  const CONCURRENCY = 10;
  const BATCH = 300;

  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH);
    const promises = batch.map(([path, sha]) => deleteFile(token, path, sha));
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r[0] === true) ok++;
      else if (r[0] === null) skip++;
      else { fail++; console.error('FAIL', r[1]); }
    }
    console.error(`Progress: ${Math.min(i + BATCH, toDelete.length)}/${toDelete.length} ok=${ok} fail=${fail} skip=${skip}`);
  }
  console.log(`=== DONE ok=${ok} fail=${fail} skip=${skip} ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
