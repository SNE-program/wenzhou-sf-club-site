// ============================================
// Supabase 轻量客户端（fetch 直连，零外部依赖）
// 用途：登录/注册 + 评论/表态/举报 数据读写
// 说明：anon key 是公开密钥，前端使用安全
// ============================================

const SB = {
  url: "https://edfxoxcvprjzbemojshr.supabase.co",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkZnhveGN2cHJqemJlbW9qc2hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTAzMDgsImV4cCI6MjEwMTUyNjMwOH0.ytkYFmJyYb00yBtYsxPE6Sh3HVmwrJfn2HuerFiV42U",
  TOKEN_KEY: "sb_token",
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
      localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
    }
  },
  clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  // 基础请求
  async request(path, opts = {}) {
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
