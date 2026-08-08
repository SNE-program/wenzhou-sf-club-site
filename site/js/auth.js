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

  // 读取当前用户资料（status / is_admin / nickname），带本地缓存
  async function loadProfile() {
    const user = SB.user();
    if (!user) {
      localStorage.removeItem(PROFILE_KEY);
      return null;
    }
    try {
      const rows = await SB.get(
        "profiles",
        `user_id=eq.${user.id}&select=user_id,nickname,status,is_admin,muted,banned`
      );
      const p = rows[0] || null;
      if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
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
        <span class="auth-user" title="${esc(user.email || "")}">${esc(nick)}</span>
        ${tag}
        <button class="auth-btn" type="button" id="btn-logout">退出</button>`;
      document.getElementById("btn-logout").addEventListener("click", async () => {
        await SB.signOut();
        await render();
      });

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
          <label>昵称<span class="only-signup">（用于展示）</span><input type="text" id="f-nick" class="only-signup" placeholder="如：星尘" maxlength="20"></label>
          <label>密码<span class="pass-wrap"><input type="password" id="f-pass" required placeholder="至少 6 位" autocomplete="new-password"><button type="button" class="pass-toggle" data-target="f-pass" aria-pressed="false" aria-label="显示密码" title="显示/隐藏密码"><svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg><svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></span></label>
          <label>确认密码<span class="only-signup">（再次输入）</span><span class="pass-wrap only-signup"><input type="password" id="f-pass2" placeholder="再次输入密码" autocomplete="new-password"><button type="button" class="pass-toggle" data-target="f-pass2" aria-pressed="false" aria-label="显示密码" title="显示/隐藏密码"><svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg><svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></span></label>
          <p class="form-err" id="f-err" hidden></p>
          <button class="btn" type="submit" id="f-submit">登录</button>
          <div id="auth-reset" hidden>
            <p>忘记密码？输入你的邮箱，我们将发送一封密码重置链接。</p>
            <p class="form-err" id="r-err" hidden></p>
            <p class="form-ok" id="r-ok" hidden></p>
            <button class="btn" type="button" id="r-send">发送重置链接</button>
            <button class="btn ghost" type="button" id="r-back">返回登录</button>
          </div>
          <p class="form-note">仅记录邮箱与昵称，不采集真实姓名、学号或手机号。注册后需完成邮箱验证并经管理员审核，通过后方可评论、表态。</p>
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
      document.getElementById("f-submit").textContent = m === "signup" ? "注册" : "登录";
      document.getElementById("f-nick").required = m === "signup";
      document.getElementById("f-pass2").required = m === "signup";
      document.getElementById("f-forgot").hidden = m !== "login";
      // 退出“忘记密码”视图，恢复常规表单
      modalEl.querySelector(".modal-tabs").hidden = false;
      resetBox.hidden = true;
      form.querySelectorAll("label").forEach((l) => (l.hidden = false));
      document.getElementById("f-submit").hidden = false;
    };
    tabs.forEach((t) => t.addEventListener("click", () => switchMode(t.dataset.mode)));
    switchMode(mode);

    // 找回密码：切换为“仅邮箱”视图
    const showReset = (e) => {
      if (e) e.preventDefault();
      form.querySelectorAll("label").forEach((l) => {
        l.hidden = l !== emailLabel;
      });
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
          // 封禁邮箱预检（尽力而为；失败时由数据库注册触发器兜底拦截）
          try {
            const emailBlocked = await SB.rpc("check_email_banned", { check_email: email });
            if (emailBlocked) throw new Error("该邮箱已被封禁，无法注册");
          } catch (e) {
            if (e.message === "该邮箱已被封禁，无法注册") throw e;
          }
          const data = await SB.signUp(email, pass, nick || "星尘");
          if (data.session) {
            // 未开启邮箱确认时的自动登录（保留兼容）
            closeModal();
            await render();
          } else {
            errEl.className = "form-ok";
            errEl.textContent = "注册成功！验证邮件已发送至你的邮箱，请点击邮件中的链接完成验证，再返回登录。";
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

  document.addEventListener("DOMContentLoaded", () => {
    const links = document.querySelector("#nav-links");
    if (links) {
      links.insertAdjacentHTML("beforeend", `<span id="auth-area"></span>`);
      render();
    }
    // 会话被清除（如刷新 token 失败、登出）时同步界面
    window.addEventListener("sb-auth-changed", render);
  });

  // 供其他页面调用：打开登录弹窗 / 读取当前用户资料
  window.openAuthModal = openModal;
  window.getMyProfile = loadProfile;
})();
