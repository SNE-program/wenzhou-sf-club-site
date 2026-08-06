// ============================================
// 登录 / 注册 组件（导航按钮 + 弹窗）
// 依赖：supabase.js（SB）、api.js（esc）
// ============================================
(function () {
  let modalEl = null;

  function render() {
    const area = document.getElementById("auth-area");
    if (!area) return;
    const user = SB.user();
    if (user) {
      const nick = (user.user_metadata && user.user_metadata.nickname) || user.email || "用户";
      area.innerHTML = `
        <span class="auth-user" title="${esc(user.email || "")}">${esc(nick)}</span>
        <button class="auth-btn" type="button" id="btn-logout">退出</button>`;
      const btn = document.getElementById("btn-logout");
      btn.addEventListener("click", async () => {
        await SB.signOut();
        render();
      });
    } else {
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
          <label>密码<input type="password" id="f-pass" required placeholder="至少 6 位" autocomplete="current-password"></label>
          <p class="form-err" id="f-err" hidden></p>
          <button class="btn" type="submit" id="f-submit">登录</button>
          <p class="form-note">仅记录邮箱与昵称，不采集真实姓名、学号或手机号。</p>
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
      errEl.hidden = true;
      submit.disabled = true;
      submit.textContent = "请稍候…";
      try {
        if (isSignup) {
          if (pass.length < 6) throw new Error("密码至少 6 位");
          await SB.signUp(email, pass, nick || "星尘");
        } else {
          await SB.signIn(email, pass);
        }
        closeModal();
        render();
      } catch (err) {
        errEl.textContent = err.message || "操作失败，请重试";
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

  // 供其他页面调用：打开登录弹窗
  window.openAuthModal = openModal;
})();
