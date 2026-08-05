# 温州中学科学及幻想文学社 · 社团展示网站

基于 **Notion（内容后台）+ Cloudflare Worker（数据中转）+ GitHub Pages（托管）** 的零成本社团网站。

## 目录结构

```
网站/
├── site/                  # 静态网站前端（部署到 GitHub Pages）
│   ├── index.html         # 首页
│   ├── activities.html    # 活动
│   ├── works.html         # 作品
│   ├── members.html       # 成员
│   ├── about.html         # 关于 / 加入我们
│   ├── 404.html
│   ├── css/style.css
│   └── js/api.js          # 调用 Cloudflare Worker 的接口
├── worker/                # Cloudflare Worker（Notion 数据中转）
│   ├── src/index.js
│   ├── wrangler.toml      # Worker 配置（含 KV 缓存）
│   └── package.json
└── .github/workflows/     # GitHub Actions 自动部署
```

## 当前状态（2026-08-05）

- 线上地址：**https://sne-program.github.io/wenzhou-sf-club-site/**（GitHub Pages，推送 main 即自动更新）
- Notion 数据中转 Worker 已部署：`wzsf-site-api`（Cloudflare），数据读取链路已本地验证通过
- 说明：`*.workers.dev` 域名在国内部分网络不可达，因此前端暂未指向 Worker，网站显示本地占位数据；当网络可达时会自动读取 Notion 实时内容
- **升级路径**：购买域名（约 ¥50~80/年）绑定到 Cloudflare 后，把 Worker 地址填到 `site/js/api.js` 的 `API_BASE` 即可切换到 Notion 实时数据

## 内容更新方式

1. 打开 Notion 中的 4 张表：`活动`、`作品`、`成员`、`站点信息`（位于"社团主页"页面下）
2. 增删改条目（支持文字、图片、链接）
3. 保存即生效（网站有缓存，最长约 60 秒后可见）

## 部署清单（已完成 ✅）

- [x] 创建 GitHub 仓库并推送代码
- [x] GitHub Pages 自动部署（.github/workflows/deploy.yml）
- [x] Cloudflare 注册并部署 Worker（wrangler）
- [x] Notion 4 张内容表初始化（scripts/init-notion.mjs）
- [ ] 自定义域名绑定（可选，按需升级）
