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
  // 简单 XSS 过滤：剥离脚本/iframe/表单等危险元素与事件属性
  function sanitizeHtml(html) {
    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
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
      return String(html).replace(/<[^>]*>/g, "");
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
    if (article.bodyHtml && String(article.bodyHtml).trim()) return sanitizeHtml(article.bodyHtml);
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
    if (article.date) metaBits.push(`📅 ${esc(dateLabel(article.date))}`);
    if (article.location) metaBits.push(`📍 ${esc(article.location)}`);
    if (article.category) {
      metaBits.push(
        `<a class="meta-link" href="${backTarget()}?分类=${encodeURIComponent(article.category)}">🏷 ${esc(article.category)}</a>`
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
      // 加载昵称（公开视图，不暴露邮箱/状态）
      const userIds = [...new Set(rows.map((r) => r.user_id))];
      const nickMap = {};
      if (userIds.length) {
        const profs = await SB.get("profile_names", `user_id=in.(${userIds.join(",")})&select=user_id,nickname`);
        profs.forEach((p) => (nickMap[p.user_id] = p.nickname));
      }
      renderComments(rows, nickMap);
      refreshCommentForm();
    } catch (e) {
      list.innerHTML = `<div class="state">评论加载失败：${esc(errText(e))}<br><br><button class="btn" type="button" id="c-retry">重试</button></div>`;
      const retry = document.getElementById("c-retry");
      if (retry) retry.addEventListener("click", loadComments);
    }
  }

  function renderComments(rows, nickMap) {
    const list = document.getElementById("c-list");
    const user = SB.user();
    if (!rows.length) {
      list.innerHTML = `<p class="empty">还没有评论，来抢沙发吧。</p>`;
      return;
    }
    list.innerHTML = rows.map((c) => {
      const mine = user && c.user_id === user.id;
      const nick = (mine ? ((myProfile && myProfile.nickname) || (user.user_metadata && user.user_metadata.nickname)) : "") || nickMap[c.user_id] || "匿名星友";
      return `
        <div class="comment-item" data-id="${c.id}">
          <div class="c-head">
            <span class="c-nick">${esc(nick)}</span>
            <span class="c-time">${esc(timeLabel(c.created_at))}</span>
            ${c.edited_at ? `<span class="c-edited">已编辑</span>` : ""}
          </div>
          <div class="c-content" data-role="content">${esc(c.content)}</div>
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
    const original = content.textContent;
    content.innerHTML = `<textarea class="edit-area" maxlength="500">${esc(original)}</textarea>`;
    const save = document.createElement("button");
    save.className = "btn";
    save.textContent = "保存";
    content.appendChild(save);
    save.addEventListener("click", async () => {
      const newText = content.querySelector("textarea").value.trim();
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

  // ---------- 初始化 ----------
  document.getElementById("vote-up").addEventListener("click", () => setVote(1));
  document.getElementById("vote-down").addEventListener("click", () => setVote(-1));
  document.getElementById("vote-reset").addEventListener("click", () => setVote(0));
  document.getElementById("c-submit").addEventListener("click", submitComment);

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
