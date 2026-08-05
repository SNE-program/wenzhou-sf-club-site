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
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const handlers = {};
globalThis.addEventListener = (type, fn) => { handlers[type] = fn; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const code = fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8");

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

for (const p of ["/api/site", "/api/activities", "/api/works", "/api/members"]) {
  const start = Date.now();
  try {
    const r = await invoke(p);
    console.log(`${p} → ${r.status} (${Date.now() - start}ms)`);
    console.log("  " + r.body.slice(0, 300));
  } catch (e) {
    console.log(`${p} → 异常: ${e.message}`);
  }
}
