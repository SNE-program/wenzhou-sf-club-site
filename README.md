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

## 内容更新方式

1. 打开 Notion 中的 4 张表：`活动`、`作品`、`成员`、`站点信息`
2. 增删改条目（支持文字、图片、链接）
3. 保存即生效（网站有缓存，最长约 60 秒后可见）

## 部署清单（一次性）

- [ ] Cloudflare 注册账号并创建 Worker
- [ ] Worker 环境变量配置 `NOTION_TOKEN`
- [ ] 前端 `api.js` 中的 Worker 地址替换
- [ ] GitHub Actions 推送自动部署到 Pages
