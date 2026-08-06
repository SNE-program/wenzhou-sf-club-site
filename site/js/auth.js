// ============================================
// 登录 / 注册 组件（导航按钮 + 弹窗）
// 依赖：supabase.js（SB）、api.js（esc）
// 职责：登录/注册弹窗、邮箱验证提示、审核状态展示、管理员导航入口
// ============================================
(function () {
  let modalEl = null;
  const PROFILE_KEY = "sb_profile";

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
        `user_id=eq.${user.id}&select=user_id,nickname,status,is_admin`
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
          <label>密码<input type="password" id="f-pass" required placeholder="至少 6 位" autocomplete="new-password"></label>
          <p class="form-err" id="f-err" hidden></p>
          <button class="btn" type="submit" id="f-submit">登录</button>
          <p class="form-note">仅记录邮箱与昵称，不采集真实姓名、学号或手机号。注册后需完成邮箱验证并经管理员审核，通过后方可评论、表态。</p>
        </form>
      </div>`;
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
    modalEl.querySelector(".modal-close").addEventListener("click", closeModal);

    const tabs = modalEl.querySelectorAll(".tab");
    const switchMode = (m) => {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
      document.querySelectorAll(".only-signup").forEach((el) => (el.hidden = m !== "signup"));
      document.getElementById("f-submit").textContent = m === "signup" ? "注册" : "登录";
      if (m === "login") document.getElementById("f-nick").removeAttribute("required");
      else document.getElementById("f-nick").setAttribute("required", "required");
    };
    tabs.forEach((t) => t.addEventListener("click", () => switchMode(t.dataset.mode)));
    switchMode(mode);

    modalEl.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("f-email").value.trim();
      const pass = document.getElementById("f-pass").value;
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
          errEl.textContent = msg || "操作失败，请重试";
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
  });

  // 供其他页面调用：打开登录弹窗 / 读取当前用户资料
  window.openAuthModal = openModal;
  window.getMyProfile = loadProfile;
})();
