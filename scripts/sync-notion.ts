// ============================================
// Supabase Edge Function：后台维护的世界观/中心页 自动写回 Notion（备份）
//
// 方案：Supabase（后台）为主，Notion 为自动同步的备份。
// 每次后台保存/删除时调用本函数，把内容同步到 Notion 对应表；
// 首次保存（Notion 无对应行）时自动创建，并把 Notion 行 id 返回给前端回填 notion_id。
//
// 接口：
//   POST {SUPABASE_URL}/functions/v1/sync-notion
//   headers: Authorization: Bearer <管理员JWT>，apikey: <anon>
//   body: {
//     table: "worlds" | "hubs",
//     action: "save" | "delete",
//     id: "<supabase 行 id>",
//     notion_id?: "<已知 Notion 行 id，可省略>",
//     data: { name, kind?, summary, body, eras_text?, cover, shown, world?, era?, theme?, sort? }
//   }
//   返回 { ok, notion_id? }
//
// 说明：
//   - kind='meta' 的类世界观在 Notion 无对应列，写回「中心页表」的保留名行（按名称匹配）
//   - select 列（所属世界观/主题）自动补全选项，避免 400
//   - rich_text 超长自动截断（Notion 上限 2000）
//   - 删除：DELETE /v1/blocks/{notion_id} 移入回收站
// ============================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const NOTION_TOKEN = (Deno.env.get("NOTION_TOKEN") ?? "").trim();
const NOTION_VERSION = "2022-06-28";
const DB_WORLDS = "3b739fd6-4004-8004-84ed-cf7fab7a1c5e";
const DB_HUBS = "3b739fd6-4004-80c5-8cb2-ead40207fe30";
const MAX_RICH = 2000;

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}
async function throwWithDetail(prefix, res) {
  const detail = await res.text().catch(() => "");
  throw new Error(`${prefix} ${res.status}${detail ? ": " + detail.slice(0, 300) : ""}`);
}

// 单次请求内已补全的 select 列缓存
const optionCache = new Map();

async function ensureSelectOption(dbId, prop, value) {
  if (!value) return;
  const key = `${dbId}/${prop}`;
  if (!optionCache.has(key)) {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, { headers: notionHeaders() });
    if (!res.ok) throw await throwWithDetail("read db", res);
    const db = await res.json();
    optionCache.set(key, new Set((db.properties?.[prop]?.select?.options || []).map((o) => o.name)));
  }
  const set = optionCache.get(key);
  if (set.has(value)) return;
  const patch = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: { [prop]: { select: { options: [...set].map((n) => ({ name: n })).concat({ name: value }) } } },
    }),
  });
  if (!patch.ok) throw await throwWithDetail("add select option", patch);
  set.add(value);
}

const txt = (s) => String(s ?? "").trim();
const rich = (s) => {
  const v = txt(s);
  return v ? { rich_text: [{ text: { content: v.slice(0, MAX_RICH) } }] } : null;
};
const coverProp = (url) => {
  const v = txt(url);
  return v ? { files: [{ name: "cover", external: { url: v } }] } : { files: [] };
};
const selectProp = (s) => {
  const v = txt(s);
  return v ? { select: { name: v } } : null;
};

function buildProperties(table, data) {
  const p = { "名称": { title: [{ text: { content: txt(data.name).slice(0, 200) } }] } };
  const rt = rich(data.summary);
  if (rt) p["简介"] = rt;
  const b = rich(data.body);
  if (b) p["设定正文"] = b;
  const c = coverProp(data.cover);
  p["封面"] = c.files.length ? c : { files: [] };
  if (typeof data.shown === "boolean") p["是否展示"] = { checkbox: data.shown };
  if (table === "worlds") {
    const e = rich(data.eras_text);
    if (e) p["时代线"] = e;
  } else if (data.kind !== "meta") {
    if (data.world) { const sp = selectProp(data.world); if (sp) p["所属世界观"] = sp; }
    if (data.era) { const e = rich(data.era); if (e) p["所属时代"] = e; }
    if (data.theme) { const tp = selectProp(data.theme); if (tp) p["主题"] = tp; }
    if (typeof data.sort === "number" && !Number.isNaN(data.sort)) p["排序"] = { number: data.sort };
  }
  return p;
}

async function findRowByName(dbId, name) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({ page_size: 100, filter: { property: "名称", title: { equals: name } } }),
  });
  if (!res.ok) throw await throwWithDetail("query by name", res);
  const data = await res.json();
  return data.results[0]?.id || null;
}

async function patchPage(pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw await throwWithDetail("patch notion", res);
  return pageId;
}

async function createPage(dbId, properties) {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({ parent: { database_id: dbId }, properties }),
  });
  if (!res.ok) throw await throwWithDetail("create notion", res);
  return (await res.json()).id;
}

async function deletePage(pageId) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}`, {
    method: "DELETE",
    headers: notionHeaders(),
  });
  if (!res.ok && res.status !== 404) throw await throwWithDetail("delete notion", res);
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    // 管理员校验
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) return Response.json({ error: "未登录" }, { status: 401 });
    const { data: me } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me || !me.is_admin) return Response.json({ error: "无管理员权限" }, { status: 403 });
    if (!NOTION_TOKEN) return Response.json({ error: "sync-notion not configured (NOTION_TOKEN)" }, { status: 501 });

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
    const { table, action, id, notion_id, data } = body || {};
    if (!table || !action || !id) return Response.json({ error: "缺少参数 table/action/id" }, { status: 400 });
    if (table !== "worlds" && table !== "hubs") return Response.json({ error: "table 非法" }, { status: 400 });
    if (action !== "save" && action !== "delete") return Response.json({ error: "action 非法" }, { status: 400 });

    // 类世界观 → 写回中心页表的保留名行
    const targetTable = table === "worlds" && data?.kind === "meta" ? "hubs" : table;
    const dbId = targetTable === "worlds" ? DB_WORLDS : DB_HUBS;

    if (action === "delete") {
      try {
        if (notion_id) await deletePage(notion_id);
        return Response.json({ ok: true }, { status: 200 });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502 });
      }
    }

    // save
    try {
      const properties = buildProperties(targetTable, data);
      if (targetTable === "hubs" && data?.kind !== "meta") {
        await ensureSelectOption(DB_HUBS, "所属世界观", data?.world);
        await ensureSelectOption(DB_HUBS, "主题", data?.theme);
      }
      let resolvedNotionId;
      if (notion_id) {
        resolvedNotionId = await patchPage(notion_id, properties);
      } else {
        const existing = await findRowByName(dbId, txt(data?.name));
        resolvedNotionId = existing ? await patchPage(existing, properties) : await createPage(dbId, properties);
      }
      return Response.json({ ok: true, notion_id: resolvedNotionId }, { status: 200 });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 502 });
    }
  }),
};
