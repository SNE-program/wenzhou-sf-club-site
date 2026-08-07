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
│   ├── submit.html        # 投稿（需登录）
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

## 当前状态（2026-08-07）

- 线上地址：**https://sne-program.github.io/wenzhou-sf-club-site/**（GitHub Pages，推送 main 即自动更新）
- Notion 数据中转 Worker 已部署：`wzsf-site-api`（Cloudflare），数据读取链路已本地验证通过
- **内容同步（近实时）**：Worker 每 5 分钟对比 Notion 与仓库 main 分支的数据指纹，内容变化时通过 `repository_dispatch` 触发 `sync-notion` 工作流重建静态数据并提交回 main，push 自动触发 GitHub Pages 部署（不再依赖不可靠的 GitHub 定时任务）
- 说明：`*.workers.dev` 域名在国内部分网络不可达，因此前端暂未指向 Worker，网站显示本地静态数据；静态数据由上述同步机制保持与 Notion 一致
- **升级路径**：购买域名（约 ¥50~80/年）绑定到 Cloudflare 后，把 Worker 地址填到 `site/js/api.js` 的 `API_BASE` 即可切换到 Notion 实时数据

## 已实现功能

- 内容展示：首页（五环浑天仪三维动画）、活动、作品、成员、关于
- 互动（Supabase）：注册/登录（邮箱验证）、入站审核（管理员审核页）、评论（每人每篇一条，可编辑/删除）、表态 up/down/no、举报
- **投稿（仅注册用户）**：`site/submit.html` 登录后投稿（标题/类型/正文/封面图片本地上传/可附 1 个附件）→ Supabase Edge Function `submit-work` 服务端校验身份并写入 Notion 投稿箱 → 管理员在 `admin-submissions.html` 审核（可查看附件）→ 通过后自动发布到「作品」并在文章页提供附件下载 + 邮件通知投稿人
- 分享卡片：所有页面含 OG meta；每条活动/作品自动生成静态详情页 `site/articles/<id>.html`（微信转发可正确显示卡片）
- 主题：深空暗色 / 清新亮色一键切换，记忆选择，首次跟随系统
- 筛选：作品按分类、活动按标签筛选（分类/标签反映在网址，可分享直达）
- 搜索：导航搜索框 + 结果页（作品/活动分组、关键词高亮）

## 静态文章页生成

`site/articles/*.html` 由 `scripts/gen-article-pages.mjs` 根据 `site/data/*.json` 自动生成（含默认分享图 `site/images/og-default.png`），部署时由 GitHub Actions 自动执行。改动数据后可直接推送，无需本地手动生成。

## 内容更新方式

1. 打开 Notion 中的 4 张表：`活动`、`作品`、`成员`、`站点信息`（位于"社团主页"页面下）
2. 增删改条目（支持文字、图片、链接）
3. 保存后约 **5~10 分钟**内自动同步到网站（Worker 检测到变化 → 触发重建 → GitHub Pages 部署；GitHub Pages CDN 缓存最长约 10 分钟）

> 说明：内容同步由 Cloudflare Worker 触发，不依赖 GitHub 定时任务（后者是 best-effort 且仓库闲置 60 天会停摆）。若 Worker 未部署或未配置 `GH_TOKEN` 密钥，则退回 GitHub 定时任务兜底（`.github/workflows/deploy.yml` 的 schedule）。

## 部署清单（已完成 ✅）

- [x] 创建 GitHub 仓库并推送代码
- [x] GitHub Pages 自动部署（.github/workflows/deploy.yml）
- [x] Cloudflare 注册并部署 Worker（wrangler）
- [x] Notion 4 张内容表初始化（scripts/init-notion.mjs）
- [ ] 自定义域名绑定（可选，按需升级）
