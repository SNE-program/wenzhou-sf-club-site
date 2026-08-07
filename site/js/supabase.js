// ============================================
// Supabase 轻量客户端（fetch 直连，零外部依赖）
// 用途：登录/注册 + 评论/表态/举报 数据读写
// 说明：anon key 是公开密钥，前端使用安全
// ============================================

const SB = {
  url: "https://edfxoxcvprjzbemojshr.supabase.co",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkZnhveGN2cHJqemJlbW9qc2hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTAzMDgsImV4cCI6MjEwMTUyNjMwOH0.ytkYFmJyYb00yBtYsxPE6Sh3HVmwrJfn2HuerFiV42U",
  TOKEN_KEY: "sb_token",
  REFRESH_KEY: "sb_refresh",
  USER_KEY: "sb_user",

  // 会话
  token() {
    return localStorage.getItem(this.TOKEN_KEY);
  },
  user() {
    try {
      return JSON.parse(localStorage.getItem(this.USER_KEY));
    } catch {
      return null;
    }
  },
  saveSession(data) {
    if (data && data.access_token) {
      localStorage.setItem(this.TOKEN_KEY, data.access_token);
      if (data.refresh_token) localStorage.setItem(this.REFRESH_KEY, data.refresh_token);
      if (data.user) localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
    }
  },
  clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
    localStorage.removeItem(this.USER_KEY);
    // 通知界面（auth.js）将登录态切回未登录
    window.dispatchEvent(new CustomEvent("sb-auth-changed"));
  },
  // 用 refresh_token 换新 access_token；成功返回 true，失败清会话返回 false
  async refresh() {
    const rt = localStorage.getItem(this.REFRESH_KEY);
    if (!rt) return false;
    const res = await fetch(this.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: this.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.access_token) {
      this.saveSession(data);
      return true;
    }
    this.clearSession();
    return false;
  },

  // 基础请求（isRetry 用于 JWT 过期续期后重试，防止无限循环）
  async request(path, opts = {}, isRetry = false) {
    const headers = { apikey: this.anon, ...(opts.headers || {}) };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(this.url + path, { ...opts, headers });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // 401（token 过期/被撤销/无效）：自动用 refresh_token 续期后重试一次
      if (!isRetry && res.status === 401) {
        const refreshed = await this.refresh();
        if (refreshed) return this.request(path, opts, true);
        throw new Error("登录已过期，请重新登录");
      }
      throw new Error((data && (data.msg || data.message || data.error_description)) || `请求失败 ${res.status}`);
    }
    return data;
  },

  // ---- Auth ----
  async signUp(email, password, nickname) {
    const data = await this.request("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, data: { nickname } }),
    });
    if (data.session) this.saveSession(data.session);
    return data;
  },
  async signIn(email, password) {
    const data = await this.request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.saveSession(data);
    return data;
  },
  async signOut() {
    try {
      await this.request("/auth/v1/logout", { method: "POST" });
    } catch (e) {
      /* 忽略登出网络错误 */
    }
    this.clearSession();
  },
  // 发送密码重置邮件（GoTrue /auth/v1/recover）
  async recover(email) {
    return this.request("/auth/v1/recover", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  // ---- Storage（文件上传，需登录；用于投稿封面/附件）----
  BUCKET: "uploads",
  publicUrl(path) {
    return `${this.url}/storage/v1/object/public/${path}`;
  },
  // 上传文件到公开 bucket，返回公开 URL。内部处理 401 续期重试。
  async uploadFile(path, file, isRetry = false) {
    const token = this.token();
    if (!token) throw new Error("请先登录");
    const res = await fetch(`${this.url}/storage/v1/object/${path}`, {
      method: "POST",
      headers: {
        apikey: this.anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: file,
    });
    if (res.status === 401 && !isRetry) {
      const refreshed = await this.refresh();
      if (refreshed) return this.uploadFile(path, file, true);
      throw new Error("登录已过期，请重新登录");
    }
    if (!res.ok) {
      let msg = `上传失败 ${res.status}`;
      try {
        const j = await res.json();
        if (j.message) msg = j.message;
      } catch (e) {}
      throw new Error(msg);
    }
    return this.publicUrl(path);
  },

  // ---- 数据（PostgREST）----
  get(table, query) {
    return this.request(`/rest/v1/${table}?${query}`);
  },
  insert(table, body) {
    return this.request(`/rest/v1/${table}`, { method: "POST", body: JSON.stringify(body) });
  },
  update(table, body, query) {
    return this.request(`/rest/v1/${table}?${query}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { Prefer: "return=representation" },
    });
  },
  remove(table, query) {
    return this.request(`/rest/v1/${table}?${query}`, { method: "DELETE" });
  },
};
