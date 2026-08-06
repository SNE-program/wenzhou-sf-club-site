# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

⚠️ **E2E 测试 39/41 通过（与基线一致）；剩余 2 项均需人工介入（非代码缺陷）。GitHub Actions 已恢复，gh-pages 分支已含最新代码；已用 API 强制重建 Pages（状态由 errored → building），线上发布在 GitHub 队列中（基础设施延迟）。** 

- 全部核心业务链路已跑通并通过本地测试（静态站点、主题/风格切换、登录/登出、管理员审核、表态、评论增查改删举报、竞赛管理、Notion 数据链路）。
- 剩余 2 项失败均为**环境/基础设施层问题**，代码侧已做优雅降级，部署环境配置完成后即可全绿。
- **本轮（进程 #3）新增发现**：
  - GitHub 官方中断已恢复（滞留的 dispatch 运行 31126692510 已结束，结论 failure=cancelled 属旧中断遗留）。
  - 已重新 `workflow_dispatch`（ref=main，head **56e1c74**，运行 31127313616）→ **conclusion=success**，gh-pages 分支已更新至 `bea6b92`（含 4c98854 的导航 CSS 修复）。
  - **已提交并推送进程 #3 的 HANDOFF 更新**（commit **326cee5**，main 与 origin/main 一致）；再次 dispatch（运行 31127853791）排队中。
  - **Pages 状态排障（关键）**：`GET /pages` 显示 **status=errored**（中断期构建失败残留），这正是线上迟迟未更新的直接原因。已用 `POST /pages/builds` 强制重建 → 状态转为 **building**（commit=bea6b92）。构建完成 + CDN 传播后，线上 CSS 应含 `.nav-links a` 的 `flex-shrink:0; white-space:nowrap` 修复（gh-pages 分支已验证包含）。
  - **T6.1 根因升级（重要）**：确认 GoTrue 会校验注册邮箱域名的 **MX 记录**——`example.com` 为 **null MX**（RFC 7505，明确不收邮件）→ 恒被拒为「Email address is invalid」；`wzsf.local` 无公网 MX 同理。`qq.com` / `gmail.com` 等有正常 MX 可通过校验。**已修正 E2E 临时脚本注册邮箱为 `@qq.com`**（仅改 `_tmp/e2e_test.py`，不入库）。
  - T6.1 剩余阻塞仅为 Supabase 邮件发送限流（429 `over_email_send_rate_limit`，跨多进程持续，判定为共享/环境级限流），解除后重跑预期通过。

## 已完成的工作

### 跑通的链路（39/41 PASS）
| 分组 | 内容 | 结果 |
|---|---|---|
| T1 | 首页标题 / 品牌导航 / 页脚 / hero | ✅ |
| T2 | 主题切换（light/dark）、风格切换（neon） | ✅ |
| T3 | 搜索页渲染与搜索命中 | ✅ |
| T4 | works / members / contests / about 页面内容渲染 | ✅ |
| T5 | 文章标题渲染、表态区、未登录表态/评论提示 | ✅ |
| T6.2 | 预置待审核用户（pending） | ✅ |
| T7 | 管理员昵称、管理员入口、审核列表（含邮箱）、审核通过 | ✅ |
| T8 | 普通用户无管理员入口 / 无审核权限 | ✅ |
| T9 | 表态记录与切换、评论发布/列表/编辑/举报/删除 | ✅ |
| T10 | 登出恢复、管理员入口消失 | ✅ |
| Notion | Worker 5/5 端点（site/activities/works/contests/members）本地验证通过 | ✅ |
| 竞赛 | anon 只读 200、管理员 CRUD 201/200、普通用户写 403 | ✅ |

### 修复过的问题（历史轮次）
1. **评论软删除 403（RLS 缺陷，T9.7）**
   - 根因：`comments_select` 策略 `USING (status='active')`，UPDATE 将评论置为 `deleted` 后，新行无法通过 SELECT 策略，PostgreSQL 拒绝更新。
   - 修复：`scripts/supabase-setup.mjs` 中策略改为 `USING (status = 'active' OR auth.uid() = user_id)`（作者可见自己的评论）；前端 `site/js/article.js` 查询加 `status=eq.active` 过滤。
   - **线上数据库已同步执行**（`_fix_comments_select.mjs`，本地脚本，未提交）。
2. **审核页邮箱缺失（T7.3/T7.4）**：测试辅助建号脚本未写 `profiles.email`，已补全（临时脚本，未提交）。
3. **Edge Function 缺环境变量返回裸 500 且无 CORS 头（T11）**
   - 修复：`scripts/send-audit-email.ts`、`scripts/submission-review.ts` 增加 `envCheck()`，缺变量时返回 501 + 带 CORS 头 + 中文提示文案。
   - 注意：**此修复需重新部署函数后生效**（见「需人工」#2）。
4. **导航栏品牌文字登录态下折行**：`site/css/style.css` 修复（已随 4c98854 提交，gh-pages 已含，待线上发布）。
5. `.gitignore` 增加 `/_*.mjs`，防止含数据库凭据的临时脚本被提交。

### 环境准备
- 依赖：前端纯静态，无 npm install 必要；Worker 由 GitHub Actions 部署（`wrangler`）。
- 本地服务：`node scripts/serve.mjs`（端口 8080）。
- E2E：`python _tmp/e2e_test.py`（Playwright headless Chromium），结果写入 `_tmp/e2e_results.json`。注意 E2E 依赖 `_tmp` 下的临时脚本预置用户，需先运行 `_setup_e2e.mjs` / `_mkuser.mjs`（见「注意事项」）。

### 本轮（自动化 AI 进程 #3）新增工作
| 项 | 内容 | 结果 |
|---|---|---|
| E2E 重跑 | 39/41，与基线一致（`_tmp/e2e_run_p3.log`） | ✅ |
| 部署恢复处理 | GitHub Actions 已恢复；重新 dispatch（运行 31127313616，head 56e1c74）**成功**；gh-pages 分支已更新至 bea6b92 | ✅ |
| T6.1 根因升级 | 确认 GoTrue 校验邮箱域名 **MX 记录**（example.com=null MX、wzsf.local 无 MX → 恒 invalid）；已把 E2E 临时脚本注册邮箱改为 `@qq.com` | ✅ 代码侧完备 |
| T11 复核 | 管理员 JWT 直调 `send-audit-email`：仍返回**裸 500、无 CORS 头** → 已部署函数仍为旧版，需人工在控制台配环境变量并 Deploy（仓库内 envCheck 修复经验证正确） | 🔎 需人工 |
| 限流复核 | 多域名（example/gmail/qq）均 429 `over_email_send_rate_limit`，跨进程持续数小时 → 共享/环境级限流，非代码问题 | 🔎 环境 |

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T6.1 注册发送验证邮件（429） | **需人工/可重试** | Supabase GoTrue 邮件发送持续命中环境级限流（429 `over_email_send_rate_limit`，跨进程持续数小时，判定共享/环境级限流）。注册链路本身逻辑正常。**根因补充（进程 #3）**：GoTrue 校验邮箱域名 **MX 记录**，`example.com`（null MX）/`wzsf.local` 恒被判无效；E2E 临时脚本已改用 `@qq.com`（有真实 MX）。限流解除后重跑 T6.1 预期通过。 |
| T11 Edge Function 无 CORS 头（500） | **需人工** | 远端函数缺 `RESEND_API_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 环境变量（进程 #3 用管理员 JWT 复核：仍返回裸 500 且无 CORS 头）。本环境无 Supabase CLI / 控制台权限，无法配置并重新 Deploy。代码修复（envCheck→501）已在仓库且经验证正确（withSupabase 默认自动加 CORS 头），**在控制台配好环境变量并重新 Deploy 即修复**。 |
| GitHub Pages 线上发布排队（线上仍为旧版） | **环境/可重试** | Pages API 显示 `status=errored`（中断期构建失败残留）。进程 #3 已 `POST /pages/builds` 强制重建 → `status=building`（commit=bea6b92，含导航 CSS 修复）。构建完成并 CDN 传播后线上自动更新。若长时间仍未更新，见「建议 #0」。 |

## 对下一个 AI 的建议

0. **最高优先级（可自动完成）**：验证线上站点已发布新版本：
   - 检查 `GET https://api.github.com/repos/SNE-program/wenzhou-sf-club-site/pages/builds/latest`（用 `权限.txt` 的 GitHub Token）status 是否为 `built`；
   - 抓取 `https://sne-program.github.io/wenzhou-sf-club-site/css/style.css`，确认 `.nav-links a` 含 `flex-shrink: 0; white-space: nowrap;`（即 4c98854 导航 CSS 修复）；
   - 若线上仍为旧版，再次执行 `POST /pages/builds` 强制重建；若 Pages 状态又回到 errored，可先 `PUT /pages`（body `{"source":{"branch":"gh-pages","path":"/"}}`）再重建。
   - 注意：本机 git push/fetch 需走系统代理（`git -c http.proxy=http://127.0.0.1:7890`），否则 github.com 直连被网络层拦截（20.205.243.166 不可达，140.82.114.3 可达）。
1. **次高优先级（需人工，自动进程无法完成）**：在 Supabase 控制台为两个 Edge Function（`send-audit-email`、`submission-review`）配置环境变量并重新 Deploy：
   - `RESEND_API_KEY`（取自根目录 `权限.txt`）
   - `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（同上）
   - 部署后重跑 T11，应通过（进程 #3 复核：当前部署版本仍为旧版，裸 500 无 CORS）。
2. **可重试**：稍后（邮件限流解除后）重跑 T6.1 注册链路，预期通过（E2E 临时脚本已改用 `@qq.com`，该域名有真实 MX 记录，已确认 GoTrue 校验规则）。
3. **可选优化**：注册限流时前端直接透传英文错误「email rate limit exceeded」，可考虑在 `site/js/auth.js` 增加中文提示（非阻断，不急）。
4. 若以上人工项完成后，重跑 `python _tmp/e2e_test.py`，预期 **41/41**（当前基线 39/41）。

## 重要注意事项

- **绝不提交**：根目录 `权限.txt`（含全部密钥）与任何 `/_*.mjs` 临时脚本（已 gitignore，但不要 `git add -f`）。
- **不要修改**：`scripts/supabase-setup.mjs` 是数据库 schema 唯一真源；改动后需同时在线上库执行对应 SQL（可用临时 `_*.mjs` 连接串执行，用完即弃）。
- **线上已改、源码待跟**：若未来重跑 `supabase-setup.mjs` 全量建表，`comments_select` 策略会自动使用修复后的版本，无需手工再改。
- **更正（进程 #2 核验）**：`.github/workflows/deploy.yml` **只部署 GitHub Pages（gh-pages 分支），不部署 Worker**。Worker `wzsf-site-api` 是手动 `wrangler deploy` 的（部署记录 2026-08-06），与 CI 无关；wrangler 用 `权限.txt` 的 Cloudflare Token 以 `CLOUDFLARE_API_TOKEN` 环境变量执行。
- **部署链路**：push 到 main 触发 `deploy.yml`（GitHub Pages，含 cname=wzmssf.club）。**GitHub 中断已恢复（进程 #3 核验）**；gh-pages 分支由 peaceiris action 直接推送，线上发布由 GitHub 自动「pages build and deployment」完成（发布有延迟属正常，必要时重触发）。Edge Function 不在 CI 流水线内，需手动在 Supabase 控制台 Deploy。
- **邮件服务**：`RESEND_FROM` 默认 `onboarding@resend.dev`，生产建议改为已验证发件人。
- **E2E 预置用户**：`_mkuser.mjs`（含数据库密码，仅本地）直插 auth.users/profiles 创建 e2e_user/e2e_admin/pending 用户；E2E 运行前需确保这些账号存在（进程 #2 已验证仍可用）。
- 本地服务/E2E 依赖端口 8080；若 8080 被占用，E2E 脚本中的 base URL 需同步修改。

## 最后修改时间与标识

- 最后修改时间：2026-08-07
- 标识：**自动化 AI 进程 #3**（基于进程 #2 更新；HANDOFF 更新已提交为 `326cee5` 并推送 origin/main）
- 测试基线：`_tmp/e2e_results.json`（39/41，本轮重跑一致）
- 待办钩子：① 等 Pages 强制重建完成（`/pages/builds/latest` 应为 built），验证线上 CSS 含 nav 修复（见「建议 #0」）；② 人工在 Supabase 控制台配置 Edge Function 环境变量并重新 Deploy（T11）；③ 邮件限流解除后重跑 T6.1（E2E 已改用 `@qq.com`）。git 操作需走代理 `-c http.proxy=http://127.0.0.1:7890`。
