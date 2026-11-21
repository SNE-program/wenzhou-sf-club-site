// ============================================
// 登录 / 注册 组件（导航按钮 + 弹窗）
// 依赖：supabase.js（SB）、api.js（esc）
// 职责：登录/注册弹窗、邮箱验证提示、审核状态展示、管理员导航入口
// ============================================
(function () {
  let modalEl = null;
  const PROFILE_KEY = "sb_profile";

  // GoTrue / Supabase 常见英文错误 → 中文友好提示（仅显示层翻译，不改业务逻辑）
  function friendlyAuthError(msg) {
    const m = String(msg || "");
    const map = [
      [/duplicate key value violates unique constraint/i, "该昵称已被占用，请更换昵称"],
      [/rate limit/i, "操作过于频繁，请稍后再试（邮件服务限流）"],
      [/user already registered/i, "该邮箱已注册，请直接登录"],
      [/invalid login credentials/i, "邮箱或密码错误"],
      [/unable to validate email/i, "邮箱地址无效，请检查后重试"],
      [/password should be at least/i, "密码长度至少 6 位"],
      [/too many requests/i, "请求过于频繁，请稍后再试"],
      [/network|fetch failed|failed to fetch/i, "网络异常，请检查网络后重试"],
    ];
    for (const [re, text] of map) if (re.test(m)) return text;
    return null;
  }

  // 顶部轻提示（邮箱验证结果等），自带样式，无需改 CSS 版本号
  function showToast(msg, kind = "ok") {
    const old = document.getElementById("auth-toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.id = "auth-toast";
    const bg = kind === "error" ? "rgba(220,38,38,.95)" : "rgba(6,150,90,.95)";
    t.style.cssText =
      "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;" +
      "max-width:min(92vw,560px);padding:12px 18px;border-radius:12px;color:#fff;" +
      "font-size:14px;line-height:1.6;box-shadow:0 8px 24px rgba(0,0,0,.35);background:" + bg + ";";
    t.textContent = msg;
    document.body.appendChild(t);
    t.addEventListener("click", () => t.remove());
    setTimeout(() => {
      t.style.transition = "opacity .4s";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 400);
    }, 7000);
  }

  // 读取当前用户资料（status / is_admin / nickname / real_name），带本地缓存
  async function loadProfile() {
    const user = SB.user();
    if (!user) {
      localStorage.removeItem(PROFILE_KEY);
      return null;
    }
    try {
      const rows = await SB.get(
        "profiles",
        `user_id=eq.${user.id}&select=user_id,nickname,status,is_admin,muted,banned,warned`
      );
      const p = rows[0] || null;
      if (p) {
        // 实名信息存于 student_verifications，经公开视图 profile_names 读取（仅已核验学生返回）
        try {
          const pn = await SB.get("profile_names", `user_id=eq.${user.id}&select=user_id,nickname,real_name`);
          if (pn && pn[0]) p.real_name = pn[0].real_name || null;
        } catch (e) { /* 实名读取失败不影响主流程 */ }
        localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
      }
      return p;
    } catch (e) {
      try {
        return JSON.parse(localStorage.getItem(PROFILE_KEY));
      } catch {
        return null;
      }
    }
  }

  async function render() {
    const area = document.getElementById("auth-area");
    if (!area) return;
    const user = SB.user();
    const adminLink = document.querySelector("#nav-links a[data-nav-admin]");

    if (user) {
      const profile = await loadProfile();
      // 封禁账号：不允许登录使用（登出并提示）
      if (profile && profile.banned) {
        try { await SB.signOut(); } catch (e) { /* 忽略登出失败 */ }
        const banLink = document.querySelector("#nav-links a[data-nav-admin]");
        if (banLink) banLink.remove();
        area.innerHTML = `
          <span class="auth-tag rejected" title="该账号已被封禁，如有疑问请联系管理员">已封禁</span>
          <button class="auth-btn" type="button" id="btn-login">登录 / 注册</button>`;
        document.getElementById("btn-login").addEventListener("click", () => openModal("login"));
        return;
      }
      const nick =
        (profile && profile.nickname) ||
        (user.user_metadata && user.user_metadata.nickname) ||
        user.email ||
        "用户";
      const tag = profile
        ? profile.status === "pending"
          ? `<span class="auth-tag" title="账号审核中，通过后可评论/表态">待审核</span>`
          : profile.status === "rejected"
            ? `<span class="auth-tag rejected" title="账号未通过审核，如有疑问请联系管理员">未通过</span>`
            : ""
        : "";
      area.innerHTML = `
        <span class="auth-user" title="${esc(user.email || "")}">${esc(nick)}${profile && profile.warned ? `<span class="auth-warn" title="你已被管理员警告，请注意遵守站规">⚠</span>` : ""}${profile && profile.real_name ? `<span class="c-real">${esc(profile.real_name)}</span>` : ""}</span>
        ${tag}
        <button class="auth-btn" type="button" id="btn-rename" title="修改昵称（7 天内仅可修改一次）">改名</button>
        <button class="auth-btn" type="button" id="btn-logout">退出</button>`;
      document.getElementById("btn-logout").addEventListener("click", async () => {
        await SB.signOut();
        await render();
      });
      const renameBtn = document.getElementById("btn-rename");
      if (renameBtn) renameBtn.addEventListener("click", () => openRenameModal());

      // 管理员入口（幂等）
      if (profile && profile.is_admin && !adminLink) {
        area.insertAdjacentHTML("beforebegin", `<a href="admin.html" data-nav-admin>审核</a>`);
      } else if ((!profile || !profile.is_admin) && adminLink) {
        adminLink.remove();
      }
    } else {
      localStorage.removeItem(PROFILE_KEY);
      if (adminLink) adminLink.remove();
      area.innerHTML = `<button class="auth-btn" type="button" id="btn-login">登录 / 注册</button>`;
      document.getElementById("btn-login").addEventListener("click", () => openModal("login"));
    }
  }

  function openModal(mode) {
    if (modalEl) modalEl.remove();
    modalEl = document.createElement("div");
    modalEl.className = "modal-mask";
    modalEl.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" type="button" aria-label="关闭">✕</button>
        <div class="modal-tabs">
          <button type="button" class="tab" data-mode="login">登录</button>
          <button type="button" class="tab" data-mode="signup">注册</button>
        </div>
        <form class="modal-form" id="auth-form">
          <label>邮箱<input type="email" id="f-email" required placeholder="you@example.com" autocomplete="email"></label>
          <label class="only-signup">昵称<span class="only-signup">（用于展示）</span><input type="text" id="f-nick" class="only-signup" placeholder="如：星尘" maxlength="20"></label>
          <div class="verify-path only-signup">
            <p class="path-title">请选择注册通道</p>
            <div class="path-opts">
              <label class="path-opt"><input type="radio" name="reg-path" value="student"><span class="po-t">在校学生</span><span class="po-d">填写学号与姓名，经名册核验免人工审核</span></label>
              <label class="path-opt"><input type="radio" name="reg-path" value="guest"><span class="po-t">非在校用户</span><span class="po-d">不填写学号，由管理员人工审核</span></label>
            </div>
          </div>
          <div class="f-row" id="f-row-student" hidden>
            <label>学号<span class="only-signup">（在校必填）</span><input type="text" id="f-sid" class="only-signup" placeholder="学号" maxlength="20" autocomplete="off"></label>
            <label>姓名<span class="only-signup">（与名册一致）</span><input type="text" id="f-real" class="only-signup" placeholder="真实姓名" maxlength="20" autocomplete="off"></label>
          </div>
          <label>密码<span class="pass-wrap"><input type="password" id="f-pass" required placeholder="至少 6 位" autocomplete="new-password"><button type="button" class="pass-toggle" data-target="f-pass" aria-pressed="false" aria-label="显示密码" title="显示/隐藏密码"><svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg><svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></span></label>
          <label class="only-signup">确认密码<span class="only-signup">（再次输入）</span><span class="pass-wrap only-signup"><input type="password" id="f-pass2" placeholder="再次输入密码" autocomplete="new-password"><button type="button" class="pass-toggle" data-target="f-pass2" aria-pressed="false" aria-label="显示密码" title="显示/隐藏密码"><svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg><svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></span></label>
          <p class="form-err" id="f-err" hidden></p>
          <div class="rules-consent only-signup" id="rules-consent" hidden>
            <p class="rules-consent-title">注册前请阅读《网站站规》</p>
            <p class="rules-consent-body">一个邮箱仅可注册一个账号；在校学生填写学号与姓名将经学校名册自动核验（学号不公开、实名仅以笔名为主弱化展示），非在校用户由管理员人工审核；评论须文明友善，每人每篇限 1 条（≤1200 字）；投稿须为原创或已获授权；作品将按 CC BY-SA 4.0 公开展示。完整条款见<a href="rules.html" target="_blank" rel="noopener">《网站站规》全文</a>。</p>
            <label class="rules-consent-check">
              <input type="checkbox" id="f-agree">
              <span>我已阅读并同意《网站站规》</span>
            </label>
          </div>
          <button class="btn" type="submit" id="f-submit">登录</button>
          <div id="auth-reset" hidden>
            <p>忘记密码？输入你的邮箱，我们将发送一封密码重置链接。</p>
            <p class="form-err" id="r-err" hidden></p>
            <p class="form-ok" id="r-ok" hidden></p>
            <button class="btn" type="button" id="r-send">发送重置链接</button>
            <button class="btn ghost" type="button" id="r-back">返回登录</button>
          </div>
          <p class="form-note">注册时请先选择通道：在校学生填写学号与姓名，经名册自动核验——匹配即自动通过，不匹配将自动拒绝；非在校用户不填写学号，由管理员人工审核。实名仅用于身份核验，公开区以笔名为主展示，学号不公开。</p>
          <p class="form-link"><a href="#" id="f-forgot">忘记密码？</a></p>
        </form>
      </div>`;
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", (e) => {
      // 密码可见性切换
      const tg = e.target.closest(".pass-toggle");
      if (tg) {
        const inp = document.getElementById(tg.dataset.target);
        if (inp) {
          const show = inp.type === "password";
          inp.type = show ? "text" : "password";
          tg.classList.toggle("on", show);
          tg.setAttribute("aria-pressed", String(show));
          tg.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
        }
        return;
      }
      if (e.target === modalEl) closeModal();
    });
    modalEl.querySelector(".modal-close").addEventListener("click", closeModal);

    const tabs = modalEl.querySelectorAll(".tab");
    const form = modalEl.querySelector("#auth-form");
    const resetBox = document.getElementById("auth-reset");
    const emailLabel = document.getElementById("f-email").closest("label");

    const switchMode = (m) => {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
      document.querySelectorAll(".only-signup").forEach((el) => (el.hidden = m !== "signup"));
      // 重置注册通道选择（学号/姓名字段仅在「在校学生」通道显示）
      document.querySelectorAll('input[name="reg-path"]').forEach((r) => (r.checked = false));
      const fRow = document.getElementById("f-row-student");
      if (fRow) fRow.hidden = true;
      document.getElementById("f-submit").textContent = m === "signup" ? "注册" : "登录";
      document.getElementById("f-nick").required = m === "signup";
      document.getElementById("f-pass2").required = m === "signup";
      document.getElementById("f-forgot").hidden = m !== "login";
      // 退出“忘记密码”视图，恢复常规表单（仅恢复非注册专用字段，避免残留空标签文字）
      modalEl.querySelector(".modal-tabs").hidden = false;
      resetBox.hidden = true;
      form.querySelectorAll("label:not(.only-signup)").forEach((l) => (l.hidden = false));
      document.getElementById("f-submit").hidden = false;
    };
    tabs.forEach((t) => t.addEventListener("click", () => switchMode(t.dataset.mode)));
    switchMode(mode);

    // 注册通道选择：在校学生 → 显示学号/姓名；非在校用户 → 隐藏并清空
    const applyPath = (isStudent) => {
      const fRow = document.getElementById("f-row-student");
      if (fRow) fRow.hidden = !isStudent;
      const sidEl = document.getElementById("f-sid");
      const realEl = document.getElementById("f-real");
      if (!isStudent) {
        if (sidEl) { sidEl.value = ""; sidEl.required = false; }
        if (realEl) { realEl.value = ""; realEl.required = false; }
      } else {
        if (sidEl) sidEl.required = true;
        if (realEl) realEl.required = true;
      }
      const errEl = document.getElementById("f-err");
      if (errEl && !errEl.hidden) errEl.hidden = true;
    };
    document.querySelectorAll('input[name="reg-path"]').forEach((r) =>
      r.addEventListener("change", () => {
        if (r.checked) applyPath(r.value === "student");
      })
    );

    // 找回密码：切换为“仅邮箱”视图
    const showReset = (e) => {
      if (e) e.preventDefault();
      form.querySelectorAll("label").forEach((l) => {
        l.hidden = l !== emailLabel;
      });
      form.querySelectorAll(".f-row").forEach((el) => (el.hidden = true));
      document.getElementById("rules-consent").hidden = true;
      document.getElementById("f-submit").hidden = true;
      document.getElementById("f-forgot").hidden = true;
      document.getElementById("f-err").hidden = true;
      modalEl.querySelector(".modal-tabs").hidden = true;
      resetBox.hidden = false;
    };

    const handleRecover = async () => {
      const email = document.getElementById("f-email").value.trim();
      const rErr = document.getElementById("r-err");
      const rOk = document.getElementById("r-ok");
      const send = document.getElementById("r-send");
      rErr.hidden = true;
      rOk.hidden = true;
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        rErr.textContent = "请输入有效的邮箱地址";
        rErr.hidden = false;
        return;
      }
      send.disabled = true;
      send.textContent = "发送中…";
      try {
        await SB.recover(email);
        rOk.textContent = "重置链接已发送至你的邮箱，请查收并按邮件提示设置新密码。";
        rOk.hidden = false;
      } catch (err) {
        rErr.textContent = friendlyAuthError(err.message) || String(err.message || "发送失败，请重试");
        rErr.hidden = false;
      } finally {
        send.disabled = false;
        send.textContent = "发送重置链接";
      }
    };

    document.getElementById("f-forgot").addEventListener("click", showReset);
    document.getElementById("r-send").addEventListener("click", handleRecover);
    document.getElementById("r-back").addEventListener("click", () => openModal("login"));

    modalEl.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      // 找回密码视图下，回车直接发送重置链接
      if (!document.getElementById("auth-reset").hidden) {
        return handleRecover();
      }
      const email = document.getElementById("f-email").value.trim();
      const pass = document.getElementById("f-pass").value;
      const pass2 = document.getElementById("f-pass2").value;
      const nick = document.getElementById("f-nick").value.trim();
      const sid = document.getElementById("f-sid").value.trim();
      const real = document.getElementById("f-real").value.trim();
      const errEl = document.getElementById("f-err");
      const submit = document.getElementById("f-submit");
      const isSignup = document.querySelector(".tab.active").dataset.mode === "signup";
      errEl.className = "form-err";
      errEl.hidden = true;
      submit.disabled = true;
      submit.textContent = "请稍候…";
      try {
        if (isSignup) {
          if (pass.length < 6) throw new Error("密码至少 6 位");
          if (pass !== pass2) throw new Error("两次输入的密码不一致");
          if (!document.getElementById("f-agree").checked)
            throw new Error("请先阅读并勾选同意《网站站规》");
          // 通道分流：注册前必须明确选择「在校学生」或「非在校用户」
          const pathEl = document.querySelector('input[name="reg-path"]:checked');
          if (!pathEl) throw new Error("请先选择注册通道：在校学生 / 非在校用户");
          const isStudent = pathEl.value === "student";
          if (isStudent) {
            if (!sid || !real) throw new Error("在校学生请填写学号与姓名");
            if (!/^\d+$/.test(sid)) throw new Error("学号应为数字");
          }
          // 封禁邮箱预检（尽力而为；失败时由数据库注册触发器兜底拦截）
          try {
            const emailBlocked = await SB.rpc("check_email_banned", { check_email: email });
            if (emailBlocked) throw new Error("该邮箱已被封禁，无法注册");
          } catch (e) {
            if (e.message === "该邮箱已被封禁，无法注册") throw e;
          }
          const data = await SB.signUp(
            email, pass, nick || "星尘",
            isStudent ? { student_id: sid, real_name: real } : {}
          );
          if (data.session) {
            // 未开启邮箱确认时的自动登录（保留兼容）
            closeModal();
            await render();
          } else {
            errEl.className = "form-ok";
            errEl.textContent = isStudent
              ? "注册成功！验证邮件已发送至你的邮箱，请点击邮件中的链接完成验证。在校学生将自动与名册核验：匹配即自动通过，不匹配将自动拒绝（可登录后核对学号与姓名重试）。"
              : "注册成功！验证邮件已发送至你的邮箱，请点击邮件中的链接完成验证，再返回登录等待管理员审核。";
            errEl.hidden = false;
          }
        } else {
          await SB.signIn(email, pass);
          closeModal();
          await render();
        }
      } catch (err) {
        const msg = String(err.message || "");
        if (/not confirmed|unconfirmed|email_not_confirmed|未验证/i.test(msg)) {
          errEl.textContent = "该邮箱尚未完成验证，请先到邮箱点击验证链接，再重新登录。";
        } else {
          errEl.textContent = friendlyAuthError(msg) || msg || "操作失败，请重试";
        }
        errEl.className = "form-err";
        errEl.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = isSignup ? "注册" : "登录";
      }
    });
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  // 修改昵称弹窗：全站唯一（不区分大小写），7 天内仅可修改一次（RPC change_nickname 服务端校验）
  function openRenameModal() {
    if (modalEl) modalEl.remove();
    modalEl = document.createElement("div");
    modalEl.className = "modal-mask";
    modalEl.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" type="button" aria-label="关闭">✕</button>
        <div class="modal-tabs"><button type="button" class="tab active">修改昵称</button></div>
        <form class="modal-form" id="rename-form">
          <p class="form-note">昵称全站唯一（不区分大小写），7 天内仅可修改一次。</p>
          <label>新昵称<input type="text" id="r-new" required maxlength="20" placeholder="新昵称（≤20 字）" autocomplete="off"></label>
          <p class="form-err" id="r-err" hidden></p>
          <button class="btn" type="submit" id="r-submit">确认修改</button>
        </form>
      </div>`;
    document.body.appendChild(modalEl);
    if (modalEl.querySelector(".modal-close")) {
      modalEl.querySelector(".modal-close").addEventListener("click", closeModal);
    }
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
    modalEl.querySelector("#rename-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nick = document.getElementById("r-new").value.trim();
      const errEl = document.getElementById("r-err");
      const submit = document.getElementById("r-submit");
      errEl.hidden = true;
      if (!nick) {
        errEl.textContent = "请输入新昵称";
        errEl.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = "提交中…";
      try {
        const r = await SB.rpc("change_nickname", { p_new_nickname: nick });
        closeModal();
        if (r && r.ok) {
          // 同步本地资料缓存，界面即时生效
          try {
            const cached = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
            if (cached) {
              cached.nickname = r.nickname || nick;
              localStorage.setItem(PROFILE_KEY, JSON.stringify(cached));
            }
          } catch (e) { /* 忽略缓存同步失败 */ }
          showToast(r.unchanged ? "昵称未变化" : `昵称已修改为「${r.nickname || nick}」`, "ok");
        } else {
          const reason = r && r.reason;
          const msg =
            reason === "taken"
              ? "该昵称已被占用，请更换"
              : reason === "too_soon"
                ? `7 天内仅可修改一次昵称，请于 ${(r && r.next_allowed) || "一周后"} 再试`
                : reason === "invalid"
                  ? "昵称需为 1~20 个字符"
                  : reason === "not_found"
                    ? "账号不存在，请重新登录"
                    : "修改失败，请重试";
          showToast(msg, "error");
        }
        await render();
      } catch (err) {
        submit.disabled = false;
        submit.textContent = "确认修改";
        errEl.textContent = friendlyAuthError(err.message) || String(err.message || "操作失败，请重试");
        errEl.hidden = false;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const links = document.querySelector("#nav-links");
    if (!links) return;
    links.insertAdjacentHTML("beforeend", `<span id="auth-area"></span>`);
    // 处理邮箱验证 / 密码重置链接跳回时的 token：校验并保存登录态、清理 URL、给用户提示
    Promise.resolve(SB.handleAuthRedirect())
      .then((r) => {
        if (r) {
          let msg = null;
          let kind = "ok";
          if (r.error) {
            msg = "验证未通过：" + r.error + "。请重新操作，或联系管理员。";
            kind = "error";
          } else if (r.type === "signup" && r.loggedIn) {
            msg = "邮箱验证成功！在校学生将自动与名册核验（匹配即通过、不匹配自动拒绝），非在校用户请等待管理员审核。";
          } else if (r.loggedIn) {
            msg = "验证成功。";
          }
          if (msg) showToast(msg, kind);
        }
        render();
      });
    // 会话被清除（如刷新 token 失败、登出）时同步界面
    window.addEventListener("sb-auth-changed", render);
  });

  // 供其他页面调用：打开登录弹窗 / 读取当前用户资料
  window.openAuthModal = openModal;
  window.getMyProfile = loadProfile;
})();
