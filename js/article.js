// ============================================
// 文章详情页逻辑（投票 / 评论 / 举报 / 分类跳转）
// 支持两种入口：
//   1) 静态文章页：<script>window.ARTICLE_CTX={id,type}</script> 后引入本文件
//   2) article.html 动态页：通过 ?id=&type= 参数（type=activity|works）
// ============================================
(function () {
  const CTX = window.ARTICLE_CTX || {};
  const params = new URLSearchParams(location.search);
  const ARTICLE_ID = CTX.id || params.get("id") || "";
  const TYPE =
    CTX.type === "activities"
      ? "activities"
      : params.get("type") === "activity"
        ? "activities"
        : "works";

  let article = null;
  let myVote = null; // 当前用户表态：1 / -1 / 0 / null
  let myProfile = null; // 当前用户资料（status / is_admin）

  function hint(elId, text, ok) {
    const el = document.getElementById(elId);
    if (el) {
      el.textContent = text || "";
      el.style.color = ok ? "var(--accent)" : "#f87171";
    }
  }

  // RLS 拒绝（未审核通过）时的统一提示
  function auditMsg(errMsg) {
    return /row-level security|violates row|RLS/i.test(String(errMsg))
      ? "账号需通过审核后才能执行此操作"
      : null;
  }

  // GoTrue / 网络常见英文错误 → 中文友好提示（仅显示层，不改业务逻辑；与 auth.js friendlyAuthError 一致）
  function friendlyErr(err) {
    const m = String((err && err.message) || err || "");
    const map = [
      [/rate limit/i, "操作过于频繁，请稍后再试"],
      [/too many requests/i, "请求过于频繁，请稍后再试"],
      [/network|fetch failed|failed to fetch|load failed|typeerror/i, "网络异常，请检查网络后重试"],
      [/timeout|timed out|abort/i, "请求超时，请重试"],
      [/permission denied|forbidden/i, "你没有权限执行此操作"],
      [/not found/i, "内容不存在或已删除"],
    ];
    for (const [re, text] of map) if (re.test(m)) return text;
    return null;
  }

  // 统一错误文案：审核提示优先，其次中文化，最后保留原始信息
  function errText(err) {
    const m = (err && err.message) || err || "";
    return auditMsg(m) || friendlyErr(m) || String(m);
  }

  function timeLabel(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function backTarget() {
    return TYPE === "activities" ? "activities.html" : "works.html";
  }

  // ---------- 正文渲染 ----------
  // XSS 过滤：优先使用 DOMPurify（白名单清洗，覆盖事件属性/危险协议/mXSS），不可用时降级为简单剥离
  // allowStyle=true 用于服务端 Word 转换产物（保留 inline style 渲染保真）；评论/正文 Markdown 走严格模式（禁止 style）
  function sanitizeHtml(html, allowStyle) {
    const text = String(html == null ? "" : html);
    if (!text) return "";
    try {
      if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
        return window.DOMPurify.sanitize(text, {
          USE_PROFILES: { html: true },
          ...(allowStyle ? { ADD_ATTR: ["style"] } : { FORBID_ATTR: ["style"] }),
          FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "link", "meta", "form", "input", "button", "textarea", "template", "svg", "math"],
        });
      }
    } catch (e) { /* DOMPurify 异常时降级 */ }
    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = text;
      tpl.content
        .querySelectorAll("script,iframe,object,embed,style,link,meta,form,input,button,textarea")
        .forEach((el) => el.remove());
      tpl.content.querySelectorAll("*").forEach((el) => {
        for (const a of [...el.attributes]) {
          const n = a.name.toLowerCase();
          if (n.startsWith("on") || n === "srcdoc" || (n === "href" && /^\s*javascript:/i.test(a.value))) {
            el.removeAttribute(a.name);
          }
        }
      });
      return tpl.innerHTML;
    } catch (e) {
      return text.replace(/<[^>]*>/g, "");
    }
  }

  // Markdown → HTML（marked 不可用时降级为段落渲染）
  function renderMarkdown(src) {
    const md = window.marked && typeof window.marked.parse === "function" ? window.marked.parse : null;
    const text = String(src == null ? "" : src);
    if (!md) {
      return text.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");
    }
    return sanitizeHtml(md(text, { breaks: true, gfm: true }));
  }

  // 正文渲染：服务端转换产物 bodyHtml 优先 → 正文 Markdown → 简介 → 附件提示
  function bodyHTML(article) {
    const placeholder = /^(见附件|详见附件|附件见文件|暂无|无)$/i;
    const pick = (s) => { const t = (s || "").trim(); return placeholder.test(t) ? "" : t; };
    if (article.bodyHtml && String(article.bodyHtml).trim()) return sanitizeHtml(article.bodyHtml, true);
    const text = pick(article.body) || pick(article.summary);
    if (text) return renderMarkdown(text);
    if (article.attachment && article.attachment.url)
      return `<p>本文以附件形式投稿，正文见下方附件，请下载查看。</p>`;
    return `<p>暂无内容</p>`;
  }

  // ---------- 文章渲染 ----------
  function renderArticle() {
    const box = document.getElementById("detail");
    const metaBits = [];
    // 世界观面包屑：有枝干 → 超链到枝干页；杂文 → 弱化显示
    if (article.hubId && article.hub) {
      const chain = [article.world, article.era, article.hub].filter(Boolean).join(" · ");
      metaBits.push(`<a class="meta-link" href="../worlds/${encodeURIComponent(article.hubId)}.html">🌌 ${esc(chain)}</a>`);
    } else if (article.worldId) {
      metaBits.push(`<a class="meta-link" href="../worlds/${encodeURIComponent(article.worldId)}.html">🌌 ${esc(article.world)}</a>`);
    } else if (TYPE === "works") {
      metaBits.push(`<span class="meta-plain">🌌 杂文</span>`);
    }
    if (TYPE === "activities") metaBits.push(`📅 ${esc(dateLabel(article.date))}`);
    if (article.location) metaBits.push(`📍 ${esc(article.location)}`);
    // 分类已支持多选（数组），链接取首个分类便于回列表页筛选
    const cats = Array.isArray(article.category) ? article.category : (article.category ? [article.category] : []);
    if (cats.length) {
      metaBits.push(
        cats.map((c) =>
          `<a class="meta-link" href="${backTarget()}?分类=${encodeURIComponent(c)}">🏷 ${esc(c)}</a>`
        ).join(" ")
      );
    }
    if (article.author) metaBits.push(`✍️ ${esc(article.author)}`);
    if (article.tags && article.tags.length) {
      metaBits.push(article.tags.map((t) => `<a class="meta-link" href="${backTarget()}?标签=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(" "));
    }

    box.innerHTML = `
      <div class="card-cover detail-cover" style="${coverStyle(article, article.title)}"><span class="cover-title">${esc(coverText(article.title))}</span></div>
      <h1 class="detail-title">${esc(article.title)}</h1>
      <div class="detail-meta">${metaBits.join(" · ")}</div>
      <div class="detail-body">${bodyHTML(article)}</div>
      ${article.attachment && article.attachment.url ? `
      <div class="detail-attach" style="margin-top:1.2rem">
        <a class="btn ghost" href="${esc(article.attachment.url)}" target="_blank" rel="noopener">📎 ${esc(article.attachment.name || "下载附件")}</a>
      </div>` : ""}`;

    const back = document.getElementById("back-link");
    back.href = backTarget();
    back.textContent = `← 返回${TYPE === "activities" ? "活动" : "作品"}`;
    document.title = `${article.title} · 温州中学科学及幻想文学社`;
    document.getElementById("vote-box").hidden = false;
    document.getElementById("comments-sec").hidden = false;
    loadVotes();
    loadComments();
  }

  // ---------- 表态 ----------
  async function loadVotes() {
    try {
      const all = await SB.get("votes", `article_id=eq.${encodeURIComponent(ARTICLE_ID)}&select=value`);
      let up = 0, down = 0, neutral = 0;
      all.forEach((v) => { if (v.value === 1) up++; else if (v.value === -1) down++; else neutral++; });
      document.getElementById("cnt-up").textContent = up;
      document.getElementById("cnt-down").textContent = down;

      const user = SB.user();
      if (user) {
        const mine = await SB.get("votes", `article_id=eq.${encodeURIComponent(ARTICLE_ID)}&user_id=eq.${user.id}&select=value`);
        myVote = mine.length ? mine[0].value : null;
      } else {
        myVote = null;
      }
      renderVoteButtons();
    } catch (e) {
      hint("vote-hint", "表态加载失败：" + errText(e));
    }
  }

  function renderVoteButtons() {
    const set = (btnId, active) => {
      const b = document.getElementById(btnId);
      if (b) b.classList.toggle("active", active);
    };
    set("vote-up", myVote === 1);
    set("vote-down", myVote === -1);
    set("vote-reset", myVote === 0);
    hint("vote-hint", "");
  }

  // 乐观更新本地计数：旧值扣减、新值累加（保留"刷新页面校正"语义，后台再校正）
  function adjustVoteCountsLocal(oldVal, newVal) {
    const upEl = document.getElementById("cnt-up");
    const downEl = document.getElementById("cnt-down");
    let up = parseInt(upEl.textContent, 10) || 0;
    let down = parseInt(downEl.textContent, 10) || 0;
    if (oldVal === 1) up = Math.max(0, up - 1);
    else if (oldVal === -1) down = Math.max(0, down - 1);
    if (newVal === 1) up += 1;
    else if (newVal === -1) down += 1;
    upEl.textContent = up;
    downEl.textContent = down;
  }

  // 从服务端重新拉取表态计数（setVote 成功后后台校正，不阻塞点击反馈）
  async function refreshVoteCounts() {
    try {
      const all = await SB.get("votes", `article_id=eq.${encodeURIComponent(ARTICLE_ID)}&select=value`);
      let up = 0, down = 0;
      all.forEach((x) => { if (x.value === 1) up++; else if (x.value === -1) down++; });
      document.getElementById("cnt-up").textContent = up;
      document.getElementById("cnt-down").textContent = down;
    } catch (e) { /* 后台校正失败时保留本地乐观值 */ }
  }

  async function setVote(v) {
    const user = SB.user();
    if (!user) {
      hint("vote-hint", "请先登录后再表态");
      window.openAuthModal("login");
      return;
    }
    if (myProfile && myProfile.banned) {
      hint("vote-hint", "该账号已被封禁，无法表态");
      return;
    }
    if (myProfile && myProfile.status !== "approved") {
      hint("vote-hint", myProfile.status === "pending" ? "账号审核中，通过后可表态" : "账号未通过审核，暂不可表态");
      return;
    }
    const q = `article_id=eq.${encodeURIComponent(ARTICLE_ID)}&user_id=eq.${user.id}`;
    try {
      const rows = await SB.get("votes", q + "&select=value");
      const oldVal = rows.length ? rows[0].value : null;
      let next;
      if (rows.length) {
        next = rows[0].value === v ? 0 : v;
        await SB.update("votes", { value: next, updated_at: new Date().toISOString() }, q);
      } else {
        await SB.insert("votes", { article_id: ARTICLE_ID, user_id: user.id, value: v });
        next = v;
      }
      myVote = next;
      renderVoteButtons();
      adjustVoteCountsLocal(oldVal, next);
      hint("vote-hint", "已记录你的表态", true);
      refreshVoteCounts(); // 后台校正，不阻塞
    } catch (e) {
      hint("vote-hint", "操作失败：" + errText(e));
    }
  }

  // ---------- 评论 ----------
  async function loadComments() {
    const list = document.getElementById("c-list");
    if (list && !list.children.length) {
      list.innerHTML = `<p class="empty">评论加载中…</p>`;
    }
    try {
      const rows = await SB.get(
        "comments",
        `article_id=eq.${encodeURIComponent(ARTICLE_ID)}&order=created_at.desc&select=*&status=eq.active`
      );
      // 加载昵称（公开视图，不暴露邮箱/状态；已核验学生附带实名）
      const userIds = [...new Set(rows.map((r) => r.user_id))];
      const nickMap = {};
      const realMap = {};
      if (userIds.length) {
        const profs = await SB.get("profile_names", `user_id=in.(${userIds.join(",")})&select=user_id,nickname,real_name`);
        profs.forEach((p) => {
          nickMap[p.user_id] = p.nickname;
          if (p.real_name) realMap[p.user_id] = p.real_name;
        });
      }
      renderComments(rows, nickMap, realMap);
      refreshCommentForm();
    } catch (e) {
      list.innerHTML = `<div class="state">评论加载失败：${esc(errText(e))}<br><br><button class="btn" type="button" id="c-retry">重试</button></div>`;
      const retry = document.getElementById("c-retry");
      if (retry) retry.addEventListener("click", loadComments);
    }
  }

  function renderComments(rows, nickMap, realMap) {
    const list = document.getElementById("c-list");
    const user = SB.user();
    if (!rows.length) {
      list.innerHTML = `<p class="empty">还没有评论，来抢沙发吧。</p>`;
      return;
    }
    list.innerHTML = rows.map((c) => {
      const mine = user && c.user_id === user.id;
      const nick = (mine ? ((myProfile && myProfile.nickname) || (user.user_metadata && user.user_metadata.nickname)) : "") || nickMap[c.user_id] || "匿名星友";
      // 实名弱化展示：笔名为主，实名小号、低对比度（仅已核验学生）
      const real = (mine ? (myProfile && myProfile.real_name) : "") || realMap[c.user_id] || "";
      return `
        <div class="comment-item" data-id="${c.id}">
          <div class="c-head">
            <span class="c-nick">${esc(nick)}${real ? `<span class="c-real">${esc(real)}</span>` : ""}</span>
            <span class="c-time">${esc(timeLabel(c.created_at))}</span>
            ${c.edited_at ? `<span class="c-edited">已编辑</span>` : ""}
          </div>
          <div class="c-content" data-role="content" data-raw="${esc(c.content)}">${renderCommentMd(c.content)}</div>
          <div class="c-actions">
            ${mine ? `<button class="c-btn" data-act="edit">编辑</button>
              <button class="c-btn" data-act="delete">删除</button>` : ""}
            <button class="c-btn" data-act="report">举报</button>
          </div>
        </div>`;
    }).join("");

    // 事件绑定
    list.querySelectorAll(".comment-item").forEach((item) => {
      const cid = item.dataset.id;
      item.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const act = btn.dataset.act;
          if (act === "report") doReport(cid, btn);
          else if (act === "edit") doEdit(item);
          else if (act === "delete") doDelete(item);
        });
      });
    });
  }

  function refreshCommentForm() {
    const user = SB.user();
    const input = document.getElementById("c-input");
    const submit = document.getElementById("c-submit");
    if (user && myProfile && myProfile.status === "approved" && !myProfile.banned && !myProfile.muted) {
      input.disabled = false;
      input.placeholder = "写下你的想法…";
      submit.hidden = false;
    } else if (user) {
      input.disabled = true;
      input.placeholder = myProfile && myProfile.banned
        ? "该账号已被封禁，无法评论"
        : myProfile && myProfile.muted
          ? "你已被禁言，无法评论"
          : myProfile && myProfile.status === "pending"
            ? "账号审核中，通过后可评论"
            : "账号未通过审核，暂不可评论";
      submit.hidden = true;
    } else {
      input.disabled = true;
      input.placeholder = "登录后可评论";
      submit.hidden = true;
    }
    // 工具栏按钮与输入框同禁用
    document.querySelectorAll("#comment-form .md-toolbar button").forEach((b) => (b.disabled = input.disabled));
  }

  async function submitComment() {
    const user = SB.user();
    const input = document.getElementById("c-input");
    const submit = document.getElementById("c-submit");
    const text = input.value.trim();
    if (!user) { window.openAuthModal("login"); return; }
    if (myProfile && (myProfile.banned || myProfile.muted)) {
      hint("c-hint", myProfile.banned ? "该账号已被封禁，无法评论" : "你已被禁言，无法发表评论");
      return;
    }
    if (myProfile && myProfile.status !== "approved") {
      hint("c-hint", myProfile.status === "pending" ? "账号审核中，通过后可评论" : "账号未通过审核，暂不可评论");
      return;
    }
    if (!text) { hint("c-hint", "请输入评论内容"); return; }
    if (submit.disabled) return; // 提交中，防重复点击
    submit.disabled = true;
    submit.textContent = "发布中…";
    try {
      await SB.insert("comments", { article_id: ARTICLE_ID, user_id: user.id, content: text });
      input.value = "";
      hint("c-hint", "评论已发布", true);
      loadComments();
    } catch (e) {
      if (auditMsg(e.message)) {
        hint("c-hint", auditMsg(e.message));
      } else if (/duplicate|unique/i.test(e.message)) {
        hint("c-hint", "你已评论过这篇文章（可编辑或删除）");
      } else {
        hint("c-hint", "发布失败：" + errText(e));
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "发表评论";
    }
  }

  function doEdit(item) {
    if (myProfile && (myProfile.banned || myProfile.muted)) {
      hint("c-hint", myProfile.banned ? "该账号已被封禁，无法操作" : "你已被禁言，无法操作");
      return;
    }
    const content = item.querySelector('[data-role="content"]');
    const original = content.dataset.raw || content.textContent;
    content.innerHTML = "";
    const ta = document.createElement("textarea");
    ta.className = "edit-area";
    ta.value = original;
    content.appendChild(ta);
    setupMdEditor(ta, { showHint: false });
    const save = document.createElement("button");
    save.className = "btn";
    save.textContent = "保存";
    save.style.marginTop = "0.6rem";
    content.appendChild(save);
    save.addEventListener("click", async () => {
      const newText = ta.value.trim();
      if (!newText) return;
      try {
        await SB.update(
          "comments",
          { content: newText, edited_at: new Date().toISOString() },
          `id=eq.${item.dataset.id}`
        );
        loadComments();
      } catch (e) {
        hint("c-hint", "保存失败：" + errText(e));
      }
    });
  }

  function doDelete(item) {
    if (myProfile && myProfile.banned) { hint("c-hint", "该账号已被封禁，无法操作"); return; }
    if (!confirm("确定删除这条评论吗？删除后不可恢复。")) return;
    SB.remove("comments", `id=eq.${item.dataset.id}`)
      .then(() => { hint("c-hint", "评论已删除", true); loadComments(); })
      .catch((e) => hint("c-hint", "删除失败：" + errText(e)));
  }

  function doReport(cid) {
    const user = SB.user();
    if (!user) { window.openAuthModal("login"); return; }
    if (myProfile && myProfile.banned) { alert("该账号已被封禁，无法举报"); return; }
    const reason = prompt("请输入举报原因（如：言语不当）：");
    if (!reason) return;
    SB.insert("reports", { user_id: user.id, comment_id: cid, reason })
      .then(() => alert("已提交举报，我们会尽快处理。"))
      .catch((e) => alert("举报失败：" + errText(e)));
  }

  // ---------- Markdown 评论编辑器 ----------
  const COMMENT_MAX = 1200;

  // 评论 Markdown → HTML（渲染 + 清洗 + 外链新窗口打开）；renderMarkdown 内部已做 XSS 过滤
  function renderCommentMd(src) {
    const html = renderMarkdown(src);
    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      tpl.content.querySelectorAll("a[href]").forEach((a) => {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      });
      return tpl.innerHTML;
    } catch (e) {
      return html;
    }
  }

  // 编辑器 / 评论 Markdown 展示样式（随 article.js 注入，避免全站 style.css 版本号连锁变更）
  function injectMdStyles() {
    if (document.getElementById("md-comment-style")) return;
    const st = document.createElement("style");
    st.id = "md-comment-style";
    st.textContent = `
.md-toolbar{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;align-items:center}
.md-toolbar button{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 9px;font-size:13px;line-height:1.5;cursor:pointer}
.md-toolbar button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.md-toolbar button:disabled{opacity:.45;cursor:not-allowed}
.md-toolbar .md-count{margin-left:auto;font-size:12px;color:var(--text-dim);font-family:var(--font-mono)}
.md-toolbar .md-count.over{color:var(--danger)}
.md-hint{display:block;font-size:12px;color:var(--text-dim);margin-top:4px}
.md-preview{margin-top:6px;padding:10px 14px;border:1px dashed var(--border);border-radius:10px;background:var(--surface)}
.c-content,.md-preview{white-space:normal;color:var(--text);font-size:.95rem;word-break:break-word;line-height:1.75}
.c-content> :first-child,.md-preview> :first-child{margin-top:0}
.c-content> :last-child,.md-preview> :last-child{margin-bottom:0}
.c-content p,.md-preview p{margin:.4em 0}
.c-content pre,.md-preview pre{overflow-x:auto;background:rgba(127,127,127,.12);padding:10px 12px;border-radius:10px;font-size:.85rem}
.c-content code,.md-preview code{font-family:var(--font-mono);background:rgba(127,127,127,.14);padding:1px 5px;border-radius:4px;font-size:.9em}
.c-content pre code,.md-preview pre code{background:none;padding:0}
.c-content blockquote,.md-preview blockquote{margin:.4em 0;padding-left:12px;border-left:3px solid var(--border);color:var(--text-dim)}
.c-content img,.md-preview img{max-width:100%;border-radius:8px}
.c-content a,.md-preview a{color:var(--accent);text-decoration:underline;word-break:break-all}
.c-content ul,.md-preview ul,.c-content ol,.md-preview ol{margin:.4em 0;padding-left:1.5em}
.c-content table,.md-preview table{border-collapse:collapse;margin:.4em 0}
.c-content th,.md-preview th,.c-content td,.md-preview td{border:1px solid var(--border);padding:4px 10px}
`;
    document.head.appendChild(st);
  }

  // 在光标处插入 Markdown 语法
  function insertMdSyntax(input, mode) {
    const s = input.selectionStart;
    const e = input.selectionEnd;
    const value = input.value;
    if (mode === "quote" || mode === "list") {
      // 行首型：未选中时作用于当前行
      let ls = s;
      let le = e;
      if (s === e) {
        ls = value.lastIndexOf("\n", s - 1) + 1;
        le = value.indexOf("\n", s);
        if (le === -1) le = value.length;
      }
      const seg = value.slice(ls, le);
      const prefix = mode === "quote" ? "> " : "- ";
      input.setRangeText(seg.split("\n").map((l) => prefix + l).join("\n"), ls, le, "end");
    } else if (mode === "codeblock") {
      const sel = value.slice(s, e);
      input.setRangeText("```\n" + (sel || "代码") + "\n```", s, e, "end");
    } else if (mode === "link") {
      const sel = value.slice(s, e);
      input.setRangeText("[" + (sel || "文字") + "](https://)", s, e, "end");
    } else {
      const m = mode === "bold" ? "**" : mode === "italic" ? "*" : "`";
      const ph = mode === "code" ? "code" : "文字";
      const ins = m + ph + m;
      input.setRangeText(ins, s, e, "preserve");
      // 选中占位符，直接输入即可替换
      input.setSelectionRange(s + m.length, s + m.length + ph.length);
    }
    input.dispatchEvent(new Event("input"));
    input.focus();
  }

  // 给 textarea 装配 Markdown 编辑器（工具栏 + 预览 + 字数统计）
  function setupMdEditor(textarea, opts) {
    injectMdStyles();
    textarea.maxLength = COMMENT_MAX;

    // 预览区（先建，供按钮闭包引用）
    const preview = document.createElement("div");
    preview.className = "md-preview";
    preview.hidden = true;

    // 工具栏
    const bar = document.createElement("div");
    bar.className = "md-toolbar";
    const defs = [
      ["B", "bold", "加粗"],
      ["I", "italic", "斜体"],
      ["`", "code", "行内代码"],
      ["❝", "quote", "引用"],
      ["•", "list", "无序列表"],
      ["<>", "codeblock", "代码块"],
      ["🔗", "link", "插入链接"],
    ];
    defs.forEach(([label, mode, title]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", () => {
        if (!textarea.disabled) insertMdSyntax(textarea, mode);
      });
      bar.appendChild(b);
    });

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "预览";
    prevBtn.title = "编辑 / 预览 切换";
    const togglePreview = () => {
      if (textarea.disabled) return;
      if (preview.hidden) {
        preview.innerHTML = renderCommentMd(textarea.value || "*（空白）*");
        preview.hidden = false;
        textarea.hidden = true;
        prevBtn.textContent = "编辑";
      } else {
        preview.hidden = true;
        textarea.hidden = false;
        prevBtn.textContent = "预览";
        textarea.focus();
      }
    };
    prevBtn.addEventListener("click", togglePreview);
    bar.appendChild(prevBtn);

    // 字数统计
    const counter = document.createElement("span");
    counter.className = "md-count";
    const updateCount = () => {
      const n = textarea.value.length;
      counter.textContent = n + "/" + COMMENT_MAX;
      counter.classList.toggle("over", n > COMMENT_MAX);
    };
    textarea.addEventListener("input", updateCount);
    updateCount();
    bar.appendChild(counter);

    // 装配到页面
    textarea.before(bar);
    textarea.after(preview);
    if (opts && opts.showHint) {
      const hint = document.createElement("span");
      hint.className = "md-hint";
      hint.textContent = "支持 Markdown：**加粗** *斜体* `代码` > 引用 · 列表 [链接](https://…)";
      preview.after(hint);
    }
    return { updateCount };
  }

  // ---------- 初始化 ----------
  document.getElementById("vote-up").addEventListener("click", () => setVote(1));
  document.getElementById("vote-down").addEventListener("click", () => setVote(-1));
  document.getElementById("vote-reset").addEventListener("click", () => setVote(0));
  document.getElementById("c-submit").addEventListener("click", submitComment);
  // 主评论框装配 Markdown 编辑器（工具栏 / 预览 / 字数统计，上限 1200 字）
  const cInput = document.getElementById("c-input");
  if (cInput) setupMdEditor(cInput, { showHint: true });

  (async function init() {
    if (!ARTICLE_ID) {
      document.getElementById("detail").innerHTML = `<div class="state">缺少文章参数</div>`;
      return;
    }
    try {
      const list = await fetchSection(TYPE);
      article = list.find((x) => x.id === ARTICLE_ID);
      if (!article) {
        document.getElementById("detail").innerHTML = `<div class="state">文章不存在或已下架</div>`;
        return;
      }
      try { myProfile = await window.getMyProfile(); } catch (e) { /* 资料加载失败不阻塞阅读 */ }
      renderArticle();
    } catch (e) {
      document.getElementById("detail").innerHTML = `<div class="state">文章加载失败：${esc(e.message)}<br><br><button class="btn" type="button" id="art-retry">重试</button></div>`;
      const retry = document.getElementById("art-retry");
      if (retry) retry.addEventListener("click", () => location.reload());
    }
  })();
})();
