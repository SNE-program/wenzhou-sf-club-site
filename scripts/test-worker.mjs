// ============================================
// 本地模拟运行 Worker 代码，验证逻辑与 Notion 连通性
// 用法：
//   node scripts/test-worker.mjs <NOTION_TOKEN>
// ============================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [notionToken] = process.argv.slice(2);
if (!notionToken) {
  console.error("用法: node scripts/test-worker.mjs <NOTION_TOKEN>");
  process.exit(1);
}

// 模拟 Worker 全局环境
globalThis.NOTION_TOKEN = notionToken;
globalThis.DB_SITE = "3b339fd6-4004-81d9-b672-cda022e565bb";
globalThis.DB_ACTIVITIES = "3b339fd6-4004-8157-9ea2-c126459645f4";
globalThis.DB_WORKS = "3b339fd6-4004-8111-aac9-cf77c0c99eab";
globalThis.DB_MEMBERS = "3b339fd6-4004-81a1-a3a5-f3933823fcd6";
globalThis.DB_CONTESTS = "3b439fd6-4004-8100-8d7e-e7e049dd49b5";
globalThis.DB_SUBMISSIONS = "3b439fd6-4004-8093-b745-c8ee4f27c1a0";
globalThis.SITE_BASE = "https://sne-program.github.io/wenzhou-sf-club-site";
globalThis.RESEND_FROM = "onboarding@resend.dev";
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const handlers = {};
globalThis.addEventListener = (type, fn) => { handlers[type] = fn; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let code = fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8");

// workerd 会在脚本执行前把 vars 注入为全局变量，Node eval 中没有这一机制，
// 且 `const X = typeof X !== "undefined" ? X : 默认` 在 Node 全局 eval 中会触发 TDZ 报错。
// 因此把这两处改为读 globalThis（语义等价，仅用于本地模拟）。
code = code
  .replace('const SITE_BASE = typeof SITE_BASE !== "undefined" ? SITE_BASE :', 'const SITE_BASE = globalThis.SITE_BASE ??')
  .replace('const RESEND_FROM = typeof RESEND_FROM !== "undefined" ? RESEND_FROM :', 'const RESEND_FROM = globalThis.RESEND_FROM ??');

// 顶层 const 需用间接 eval 使其进入全局作用域
(0, eval)(code);

if (!handlers.fetch) {
  console.error("未找到 fetch 事件处理器，Worker 代码可能加载失败");
  process.exit(1);
}

async function invoke(pathname) {
  const req = new Request(`https://local.test${pathname}`);
  let responsePromise;
  const ev = {
    request: req,
    waitUntil: () => {},
    respondWith: (p) => { responsePromise = p; },
  };
  handlers.fetch(ev);
  const res = await responsePromise;
  return { status: res.status, body: await res.text() };
}

for (const p of ["/api/site", "/api/activities", "/api/works", "/api/contests", "/api/members"]) {
  const start = Date.now();
  try {
    const r = await invoke(p);
    console.log(`${p} → ${r.status} (${Date.now() - start}ms)`);
    console.log("  " + r.body.slice(0, 300));
  } catch (e) {
    console.log(`${p} → 异常: ${e.message}`);
  }
}
