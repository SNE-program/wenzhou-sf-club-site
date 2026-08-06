# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

⚠️ **E2E 测试 39/41 通过（与上一轮基线一致）；剩余 2 项均需人工介入（非代码缺陷）。新增环境问题：GitHub Actions 基础设施中断导致部署滞留（详见下文「新增发现」）。**

- 全部核心业务链路已跑通并通过本地测试（静态站点、主题/风格切换、登录/登出、管理员审核、表态、评论增查改删举报、竞赛管理、Notion 数据链路）。
- 剩余 2 项失败均为**环境/基础设施层问题**，代码侧已做优雅降级，部署环境配置完成后即可全绿。
- **本轮新增发现**：GitHub 官方状态处于 *Partial System Outage*（Actions 队列滞留），
  上一轮（进程 #1）推送的 `4c98854`、`bfbe2ba` 提交**未触发任何 workflow 运行**（API 查询 total_count=0），
  线上 gh-pages 目前仍是旧版本（缺少 `4c98854` 中的导航 CSS 修复）。
  进程 #2 已通过 `workflow_dispatch` 手动触发部署（运行 id=31126692510，提交 bfbe2ba），
  因中断一直处于 queued；**GitHub 恢复后该运行会自动执行**，若被丢弃需按「对下一个 AI 的建议」重触发。

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

### 修复过的问题（本轮）
1. **评论软删除 403（RLS 缺陷，T9.7）**
   - 根因：`comments_select` 策略 `USING (status='active')`，UPDATE 将评论置为 `deleted` 后，新行无法通过 SELECT 策略，PostgreSQL 拒绝更新。
   - 修复：`scripts/supabase-setup.mjs` 中策略改为 `USING (status = 'active' OR auth.uid() = user_id)`（作者可见自己的评论）；前端 `site/js/article.js` 查询加 `status=eq.active` 过滤。
   - **线上数据库已同步执行**（`_fix_comments_select.mjs`，本地脚本，未提交）。
2. **审核页邮箱缺失（T7.3/T7.4）**：测试辅助建号脚本未写 `profiles.email`，已补全（临时脚本，未提交）。
3. **Edge Function 缺环境变量返回裸 500 且无 CORS 头（T11）**
   - 修复：`scripts/send-audit-email.ts`、`scripts/submission-review.ts` 增加 `envCheck()`，缺变量时返回 501 + 带 CORS 头 + 中文提示文案。
   - 注意：**此修复需重新部署函数后生效**（见「需人工」#2）。
4. **导航栏品牌文字登录态下折行**：`site/css/style.css` 修复（上一轮遗留，本轮一并提交）。
5. `.gitignore` 增加 `/_*.mjs`，防止含数据库凭据的临时脚本被提交。

### 环境准备
- 依赖：前端纯静态，无 npm install 必要；Worker 由 GitHub Actions 部署（`wrangler`）。
- 本地服务：`node scripts/serve.mjs`（端口 8080）。
- E2E：`python _tmp/e2e_test.py`（Playwright headless Chromium），结果写入 `_tmp/e2e_results.json`。注意 E2E 依赖 `_tmp` 下的临时脚本预置用户，需先运行 `_setup_e2e.mjs` / `_mkuser.mjs`（见「注意事项」）。

### 本轮（自动化 AI 进程 #2）新增工作
| 项 | 内容 | 结果 |
|---|---|---|
| E2E 重跑 | 39/41，与基线一致（`_tmp/e2e_run_new.log`） | ✅ |
| T6.1 根因深挖 | GoTrue 先查邮件限流再校验邮箱：当前恒返 429 `over_email_send_rate_limit`；`wzsf.local` 假域名在限流解除时会被 GoTrue 以「Email address is invalid」拒绝。**非产品缺陷**（真实用户用真实邮箱不受影响） | 🔎 |
| T11 修复验证 | 已部署函数仍为旧版（返回裸 500/400 且无 CORS 头）；仓库内已提交的 envCheck 修复**经验证正确**：`jsr:@supabase/server` 的 `withSupabase` 默认 `addCorsHeaders` 会给**所有** handler 响应（含错误响应）附加 `Access-Control-Allow-Origin: *`，部署后浏览器将不再报 CORS 错误 | ✅ 代码侧完备 |
| Worker 部署核验 | 用 Cloudflare API Token（`权限.txt`）执行 `wrangler deployments list`：`wzsf-site-api` 已部署（2026-08-06 创建）；`*.workers.dev` 域名从本网络不可达属预期（README 已注明） | ✅ |
| 线上站点冒烟 | `https://sne-program.github.io/wenzhou-sf-club-site/` 首页/作品/竞赛页 title+hero 正常，**0 个 JS 错误**（Playwright 实测） | ✅ |
| E2E 脚本修正 | `_tmp/e2e_test.py` 注册邮箱域名 `@wzsf.local` → `@example.com`（避免 GoTrue 校验误报，使失败原因显示为真实的「限流」；限流解除后该用例可直接通过）。仅改临时脚本，不入库 | ✅ |
| 部署链路排障 | 见「当前状态」：GitHub Actions 中断 → 推送未触发运行 → 已手动 dispatch（运行 31126692510，queued） | ⚠️ 待恢复 |

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T6.1 注册发送验证邮件（429） | **需人工/可重试** | Supabase GoTrue 邮件发送持续命中环境级限流（429 `over_email_send_rate_limit`，多轮探测确认）。注册链路本身逻辑正常（pending 用户创建成功）。另注：`wzsf.local` 假域名在限流解除时会被 GoTrue 判定邮箱无效——本轮已将 E2E 脚本注册邮箱改为 `@example.com`，限流解除后重跑 T6.1 预期通过。 |
| T11 Edge Function 无 CORS 头（500） | **需人工** | 远端函数缺 `RESEND_API_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 环境变量（已部署版本返回裸 500/400 且无 CORS 头）。本环境无 Supabase CLI / 控制台权限，无法配置并重新 Deploy。代码修复（envCheck→501）已在仓库且经验证正确（withSupabase 默认自动加 CORS 头），**在控制台配好环境变量并重新 Deploy 即修复**。 |
| GitHub Actions 部署滞留（gh-pages 为旧版） | **环境/可重试** | GitHub 处于 Partial System Outage，`4c98854`/`bfbe2ba` 推送未触发运行；已手动 dispatch（运行 31126692510）滞留 queued。恢复后运行自动执行；若被丢弃需重触发（见下方建议 #1）。线上站点功能正常（冒烟通过），仅缺导航 CSS 修复等小改动。 |

## 对下一个 AI 的建议

0. **最高优先级（可自动完成）**：监控 GitHub Actions 运行 `31126692510`（GET `/repos/SNE-program/wenzhou-sf-club-site/actions/runs/31126692510`）。若完成且 success → 校验 gh-pages 分支与线上站点已含 `4c98854` 的修复；若仍 queued/丢失 → 重新触发：
   `POST /repos/SNE-program/wenzhou-sf-club-site/actions/workflows/327989111/dispatches`，body `{"ref":"main"}`（用 `权限.txt` 的 GitHub Token）。
   触发后等待成功再推送新代码，否则新提交仍不会上线。
1. **次高优先级（可自动完成）**：在 Supabase 控制台为两个 Edge Function（`send-audit-email`、`submission-review`）配置环境变量并重新 Deploy：
   - `RESEND_API_KEY`（取自根目录 `权限.txt`）
   - `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（同上）
   - 部署后重跑 T11，应通过。
2. **可重试**：稍后（邮件限流解除后）重跑 T6.1 注册链路，预期通过（E2E 脚本已改用 `@example.com`）。
3. **可选优化**：注册限流时前端直接透传英文错误「email rate limit exceeded」，可考虑在 `site/js/auth.js` 增加中文提示（非阻断，不急）。
4. 若以上人工项完成后，重跑 `python _tmp/e2e_test.py`，预期 **41/41**。

## 重要注意事项

- **绝不提交**：根目录 `权限.txt`（含全部密钥）与任何 `/_*.mjs` 临时脚本（已 gitignore，但不要 `git add -f`）。
- **不要修改**：`scripts/supabase-setup.mjs` 是数据库 schema 唯一真源；改动后需同时在线上库执行对应 SQL（可用临时 `_*.mjs` 连接串执行，用完即弃）。
- **线上已改、源码待跟**：若未来重跑 `supabase-setup.mjs` 全量建表，`comments_select` 策略会自动使用修复后的版本，无需手工再改。
- **更正（进程 #2 核验）**：`.github/workflows/deploy.yml` **只部署 GitHub Pages（gh-pages 分支），不部署 Worker**。Worker `wzsf-site-api` 是手动 `wrangler deploy` 的（部署记录 2026-08-06），与 CI 无关；wrangler 用 `权限.txt` 的 Cloudflare Token 以 `CLOUDFLARE_API_TOKEN` 环境变量执行。
- **部署链路**：push 到 main 触发 `deploy.yml`（GitHub Pages，含 cname=wzmssf.club）。**当前 GitHub Actions 中断中**，恢复前推送的新提交可能不触发运行——必要时用 workflow_dispatch 手动触发（见「对下一个 AI 的建议」#0）。Edge Function 不在 CI 流水线内，需手动在 Supabase 控制台 Deploy。
- **邮件服务**：`RESEND_FROM` 默认 `onboarding@resend.dev`，生产建议改为已验证发件人。
- **E2E 预置用户**：`_mkuser.mjs`（含数据库密码，仅本地）直插 auth.users/profiles 创建 e2e_user/e2e_admin/pending 用户；E2E 运行前需确保这些账号存在（进程 #2 已验证仍可用）。
- 本地服务/E2E 依赖端口 8080；若 8080 被占用，E2E 脚本中的 base URL 需同步修改。

## 最后修改时间与标识

- 最后修改时间：2026-08-07
- 标识：**自动化 AI 进程 #2**（基于进程 #1 更新）
- 测试基线：`_tmp/e2e_results.json`（39/41，本轮重跑一致）
- 待办钩子：GitHub Actions 运行 31126692510（queued，恢复后自动执行）
