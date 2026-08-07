// ============================================
// 部署 Cloudflare Worker（无需安装 wrangler）
// 用法：
//   node scripts/deploy-worker.mjs <CF_TOKEN> <ACCOUNT_ID> <NOTION_TOKEN> [GH_TOKEN]
// 作用：上传 worker/src/index.js、配置数据库 id 等变量、
//      注入 NOTION_TOKEN（及可选 GH_TOKEN，内容同步用）密钥、
//      输出 Worker 访问地址
// ============================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [cfToken, accountId, notionToken, ghToken] = process.argv.slice(2);
if (!cfToken || !accountId || !notionToken) {
  console.error("用法: node scripts/deploy-worker.mjs <CF_TOKEN> <ACCOUNT_ID> <NOTION_TOKEN> [GH_TOKEN]");
  process.exit(1);
}

const scriptName = "wzsf-site-api";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const code = fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8");

const vars = {
  DB_SITE: "3b339fd6-4004-81d9-b672-cda022e565bb",
  DB_ACTIVITIES: "3b339fd6-4004-8157-9ea2-c126459645f4",
  DB_WORKS: "3b339fd6-4004-8111-aac9-cf77c0c99eab",
  DB_MEMBERS: "3b339fd6-4004-81a1-a3a5-f3933823fcd6",
  DB_CONTESTS: "3b439fd6-4004-8100-8d7e-e7e049dd49b5",
  DB_SUBMISSIONS: "3b439fd6-4004-8093-b745-c8ee4f27c1a0",
  GH_REPO: "SNE-program/wenzhou-sf-club-site",
};

const bindings = Object.entries(vars).map(([name, text]) => ({ type: "plain_text", name, text }));

// 1. 上传脚本（传统格式：Content-Type: application/javascript）
const dep = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
  {
    method: "PUT",
    headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/javascript" },
    body: code,
  }
);
const depJson = await dep.json();
console.log("① 上传脚本:", dep.status, depJson.success ? "成功" : JSON.stringify(depJson.errors));
if (!depJson.success) process.exit(1);

// 1.5 设置环境变量（数据库 id）
const st = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/settings`,
  {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ bindings }),
  }
);
const stJson = await st.json();
console.log("①.5 配置环境变量:", st.status, stJson.success ? "成功" : JSON.stringify(stJson.errors));

// 2. 注入 NOTION_TOKEN 密钥
const sec = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
  {
    method: "PUT",
    headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "NOTION_TOKEN", text: notionToken }),
  }
);
const secJson = await sec.json();
console.log("② 配置密钥:", sec.status, secJson.success ? "成功" : JSON.stringify(secJson.errors));

// 2.5 注入 GH_TOKEN 密钥（内容同步用，可选）
if (ghToken) {
  const sec2 = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "GH_TOKEN", text: ghToken }),
    }
  );
  const sec2Json = await sec2.json();
  console.log("②.5 配置 GH_TOKEN 密钥:", sec2.status, sec2Json.success ? "成功" : JSON.stringify(sec2Json.errors));
}

// 3. 获取 workers.dev 子域
const sub = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
  { headers: { Authorization: `Bearer ${cfToken}` } }
);
const subJson = await sub.json();
if (!subJson.success || !subJson.result?.subdomain) {
  console.log("③ 获取子域失败，请在 Cloudflare 控制台开通 Workers 免费子域（Workers & Pages → 启用 workers.dev 子域）");
  process.exit(1);
}
const subdomain = subJson.result.subdomain;
const workerUrl = `https://${scriptName}.${subdomain}.workers.dev`;
console.log("③ workers.dev 子域:", subdomain);
console.log("④ Worker 访问地址:", workerUrl);

// 4. 立即自检一次
try {
  const check = await fetch(`${workerUrl}/api/site`, { signal: AbortSignal.timeout(15000) });
  const text = await check.text();
  console.log("⑤ 自检 /api/site:", check.status, text.slice(0, 200));
} catch (e) {
  console.log("⑤ 自检失败（可稍后重试）:", e.message);
}
