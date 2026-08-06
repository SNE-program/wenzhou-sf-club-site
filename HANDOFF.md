# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

⚠️ **E2E 39/41（进程 #6 重跑，`_tmp/e2e_run_p6b.log`）：T6.1 因 Supabase 邮件限流复发（环境级 429）失败，链路本身已验证正常；T11（Edge Function 部署）仍为唯一「需人工」项。线上部署核验通过：Pages `status=built`，live 全站与仓库 34/35 一致（唯一差异为部署期重生成文章页的 `js/auth.js` 无 `?v=2`，属生成器预期行为、非缺陷）。**

- **T6.1 邮件限流复发（环境，可重试）**：进程 #4/#5 期间限流解除、T6.1 连续两轮 PASS；进程 #6 重跑时再次 429 `email rate limit exceeded`（定向重试 3/3 均限流，`_tmp/retry_signup_p6.log`）。**链路本身健康**：本轮 p6 首次运行时服务端成功创建 `signup_*@qq.com` 未确认用户（GoTrue admin API 证实 `confirmed_at=NULL`，即走验证邮件路径），且进程 #4/#5 各完整 PASS 过一次。
- **测试脚本改进（进程 #6）**：`_tmp/e2e_test.py` 的 T6.1 由固定 1.5s 等待改为 ≤10s 轮询 `#f-err`。起因：p6 首次运行中注册请求实际成功（用户已建），但 1.5s 内成功提示未渲染 → 误报 FAIL（空 detail，非限流）。改为轮询后（p6b）能正确捕获 429 限流文案。该文件在 `_tmp/`（仓库外，不入库）。
- **✅ 线上核验（进程 #6）**：`GET /pages` → `status=built`（source=gh-pages，cname=wzmssf.club）。全文件核验用 `git diff --no-index`（git 会自动忽略 CRLF 伪差）：**34/35 与仓库 `site/` 完全一致**；唯一真实差异为部署期重生成的分享文章页 `3b439fd6-4004-8013-862d-ff6427955088.html`（`js/auth.js?v=2` → `js/auth.js`，与进程 #5 判定一致，非缺陷）。⚠️ 若用裸 SHA1 比对会误报 22/35 差异——那是 Windows 工作区 CRLF 与线上 LF 的伪差，务必用换行符归一化后的比对（或直接 `git diff --no-index`）。
- **T11 复核（进程 #6，新证据）**：有效管理员 JWT 直调 `send-audit-email` → **HTTP 500 且无 CORS 头**，与进程 #5 证据一致 → 已部署函数仍为旧版（仓库内 envCheck 修复未上线），**需人工**在 Supabase 控制台配置环境变量并重新 Deploy 后生效。无有效 JWT 时平台网关会先返回 401+CORS=*，勿误判为已修复。

## 已完成的工作

### 跑通的链路（39/41 PASS，与进程 #5 基线一致；T6.1 本轮因环境限流失败）
| 分组 | 内容 | 结果 |
|---|---|---|
| T1 | 首页标题 / 品牌导航 / 页脚 / hero | ✅ |
| T2 | 主题切换（light/dark）、风格切换（neon） | ✅ |
| T3 | 搜索页渲染与搜索命中 | ✅ |
| T4 | works / members / contests / about 页面内容渲染 | ✅ |
| T5 | 文章标题渲染、表态区、未登录表态/评论提示 | ✅ |
| T6.1 | **注册发送验证邮件（@qq.com）** | ⚠️ 本轮限流复发；链路正常（见当前状态） |
| T6.2 | 预置待审核用户（pending） | ✅ |
| T7 | 管理员昵称、管理员入口、审核列表（含邮箱）、审核通过 | ✅ |
| T8 | 普通用户无管理员入口 / 无审核权限 | ✅ |
| T9 | 表态记录与切换、评论发布/列表/编辑/举报/删除 | ✅ |
| T10 | 登出恢复、管理员入口消失 | ✅ |
| T11 | 无页面 JS 错误 | ❌ Edge Function 旧版 CORS（需人工） |
| Notion | Worker 5/5 端点（site/activities/works/contests/members）本地验证通过（历史轮次） | ✅ |
| 竞赛 | anon 只读 200、管理员 CRUD 201/200、普通用户写 403（历史轮次） | ✅ |

### 本轮（自动化 AI 进程 #6）新增工作
| 项 | 内容 | 结果 |
|---|---|---|
| 环境检查 | node v25 / Python 3.12 / Playwright 可用；8080 本地服务正常；`pg` 依赖在位；git 工作区干净（main=origin/main=3f4f8b8） | ✅ |
| E2E 重跑 | **39/41**（`_tmp/e2e_run_p6b.log`）：T6.1 限流复发、T11 旧版 Edge Function；其余 39 项全 PASS | ⚠️ 环境项 |
| T6.1 时序抖动修复 | p6 首次运行：注册服务端成功建号但 1.5s 内提示未渲染 → 误报；`_tmp/e2e_test.py` 改为 ≤10s 轮询，p6b 正确捕获 429 限流文案 | ✅ |
| T6.1 定向重试 | `_tmp/retry_signup.py` 3 次（间隔 60s）均 `email rate limit exceeded` → 判定环境限流复发，等待解除后可重试 | 🔎 环境可重试 |
| **线上部署核验（纠正方法）** | 用 `git diff --no-index`（CRLF 归一化）比对 live vs 仓库 site/：**34/35 一致**，唯一差异为部署期重生成文章页的 `?v=2`（预期）；裸 SHA1 比对会误报 CRLF 伪差 | ✅ |
| Pages API 状态 | `GET /pages` → `status=built`、cname=wzmssf.club（无滞后，无需强制重建） | ✅ |
| T11 复核 | 有效管理员 JWT 直调 `send-audit-email` → 500 无 CORS 头 → 部署函数仍为旧版 | 🔎 需人工 |
| 测试数据清理 | 删除 `signup_1786057381898@qq.com`、`pending_1786057385012@wzsf.local`、`pending_1786057771945@wzsf.local`；限流失败的 signup_* 未建号无需清理；E2E 预置用户保留；审核列表残留 = 0 | ✅ |

### 修复过的问题（历史轮次，仍有效）
1. **评论软删除 403（RLS 缺陷，T9.7）**：`comments_select` 策略已改为 `USING (status = 'active' OR auth.uid() = user_id)`，前端加 `status=eq.active` 过滤；线上库已同步执行。
2. **审核页邮箱缺失（T7.3/T7.4）**：`_mkuser.mjs` 已写 `profiles.email`。
3. **Edge Function 缺环境变量返回裸 500 且无 CORS 头（T11）**：`send-audit-email.ts`、`submission-review.ts` 已加 `envCheck()`（缺变量 → 501 + CORS 头 + 中文提示）。**需重新部署后生效**（见「需人工」#1）。
4. **导航栏品牌文字登录态下折行**：`site/css/style.css` `.nav-links a` 加 `flex-shrink:0; white-space:nowrap`（2c6ab8b）及导航间距（4c98854）。进程 #5 强制重建后已随 4c98854 全量上线，本轮核验确认仍在线上。
5. `.gitignore` 增加 `/_*.mjs`，防止含数据库凭据的临时脚本被提交。

### 环境准备
- 依赖：前端纯静态，无 npm install 必要（`网站/` 的 `pg` 已安装，供临时 `_*.mjs` 直连 DB）；Worker 由 GitHub Actions 部署。
- 本地服务：`node scripts/serve.mjs`（端口 8080，本轮已有服务在跑）。
- E2E：`python _tmp/e2e_test.py`（Playwright headless Chromium，在仓库根目录 `c:\Users\sneeg\Desktop\Github 极简文章网站` 运行），结果写入 `_tmp/e2e_results.json` 与 `_tmp/e2e_run_p6b.log`。
- E2E 依赖 `网站/_mkuser.mjs`（直插 DB）预置用户；`e2e_user_1786038139005@wzsf.local` / `e2e_admin_1786038169301@wzsf.local` 已在库中（approved）。
- **注意**：本机 node 的 fetch 不走系统代理会连 github.io 失败；PowerShell `Invoke-WebRequest` 走系统代理正常。线上核验脚本请用 PowerShell（`_tmp/verify_live.ps1` / `_tmp/download_live.ps1` + git diff）。

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T11 Edge Function 无 CORS 头（500） | **需人工** | 远端函数缺 `RESEND_API_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 环境变量（进程 #6 复核：有效管理员 JWT 直调仍 500 无 CORS）。本环境无 Supabase CLI / 控制台权限（无 `SUPABASE_ACCESS_TOKEN`，`权限.txt` 中也没有），无法配置并重新 Deploy。代码修复（envCheck→501）已在仓库，**在控制台配好环境变量并重新 Deploy 即修复**，重跑 E2E 后 T11 应通过（预期 41/41）。 |
| T6.1 邮件限流（429） | **环境可重试** | 本轮复发（`email rate limit exceeded`，定向重试 3/3 均限流）。属 Supabase 共享/环境级限流，历史上呈数小时级波动（进程 #3 持续数小时 → #4/#5 解除 → #6 复发）。等待解除后重跑 E2E 即可；链路本身已被多轮验证正常。 |
| GitHub Pages 部署 | **已解决（进程 #5）+ 本轮核验通过** | 进程 #5 已用 `POST /pages/builds` 强制重建至最新版；本轮 `GET /pages` 状态 `built`、live 34/35 与仓库一致，无需再操作。若未来再出现线上滞后：先 `GET /pages/builds/latest` 看 status，若 errored/building 卡住，直接 `POST /pages/builds` 强制重建（约 1 次/10 分钟限制）。 |

## 对下一个 AI 的建议

0. **核验线上部署状态**（可自动完成，方法已升级）：
   - **不要用裸 SHA1 比对 live vs 本地文件**（会因 CRLF 伪差误报，进程 #6 已验证）。正确姿势：PowerShell 下载 live 全站 → `git diff --no-index` 比对（git 自动忽略换行符）；或对比 `gh-pages` 分支与线上。预期结果：唯一真实差异为部署期重生成文章页的 `?v=2` 缓存号。
   - 若线上滞后：`POST https://api.github.com/repos/SNE-program/wenzhou-sf-club-site/pages/builds`（Authorization: Bearer <Token>）强制重建，轮询 `GET /pages/builds/latest` 至 status=built；若仍 errored，先 `PUT /pages`（body `{"source":{"branch":"gh-pages","path":"/"}}`）再重建。
   - 注意：本机 git push/fetch 需走系统代理（`git -c http.proxy=http://127.0.0.1:7890`）；api.github.com 直连正常；node fetch 不走系统代理（github.io 连不上），PowerShell 正常。
1. **次高优先级（需人工，自动进程无法完成）**：在 Supabase 控制台为两个 Edge Function（`send-audit-email`、`submission-review`）配置环境变量并重新 Deploy：
   - `RESEND_API_KEY`（取自根目录 `权限.txt`）
   - `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（同上）
   - 部署后重跑 E2E，T11 应通过（预期 41/41）。
2. **可自动**：重跑 `python _tmp/e2e_test.py`。若 T6.1 仍 429（邮件限流复发中），属环境项，等待解除后重试即可；脚本已改为轮询等待（≤10s），不会再误报时序抖动。**跑完记得清理 signup/pending 用户**（见注意事项 #5）。
3. **可选优化**：注册限流时前端直接透传英文错误「email rate limit exceeded」，可考虑在 `site/js/auth.js` 增加中文提示（非阻断，不急；保守原则下本轮未改产品代码）。
4. 若人工项（Edge Function Deploy）完成后，重跑 E2E，预期 **41/41**。

## 重要注意事项

1. **绝不提交**：根目录 `权限.txt`（含全部密钥）与任何 `/_*.mjs` 临时脚本（已 gitignore，但不要 `git add -f`）。
2. **不要修改**：`scripts/supabase-setup.mjs` 是数据库 schema 唯一真源；改动后需同时在线上库执行对应 SQL（可用临时 `_*.mjs` 连接串执行，用完即弃）。
3. **线上已改、源码待跟**：若未来重跑 `supabase-setup.mjs` 全量建表，`comments_select` 策略会自动使用修复后的版本，无需手工再改。
4. **更正（进程 #2 核验）**：`.github/workflows/deploy.yml` **只部署 GitHub Pages（gh-pages 分支），不部署 Worker**。Worker `wzsf-site-api` 是手动 `wrangler deploy` 的（部署记录 2026-08-06）；wrangler 用 `权限.txt` 的 Cloudflare Token 以 `CLOUDFLARE_API_TOKEN` 环境变量执行。
5. **E2E 会产生测试数据**：T6.1 注册成功时新增 `signup_*@qq.com` 未确认用户（限流时不会建号）；`_mkuser.mjs pending` 新增 `pending_*@wzsf.local`（审核通过后转 approved）。跑完 E2E 后用 `网站/_cleanup_p4.mjs`（清理 probe_*/signup_*）+ `网站/_cleanup5.mjs`（清理已审核的 pending_* 用户）保持 DB 整洁。
6. **GoTrue 管理 API 已知怪癖**：用「已存在邮箱」POST `/auth/v1/admin/users` 会返回 500 `Database error checking email`（新邮箱正常）。因此预置/重建用户请使用 `_mkuser.mjs`（直插 DB），不要用 `_setup_e2e.mjs`（走 GoTrue 管理 API，重跑会 500）。
7. **部署链路**：push 到 main 触发 `deploy.yml`（GitHub Pages，含 cname=wzmssf.club）。本轮线上核验通过（34/35 一致，Pages built）。Edge Function 不在 CI 流水线内，需手动在 Supabase 控制台 Deploy。
8. **邮件服务**：`RESEND_FROM` 默认 `onboarding@resend.dev`，生产建议改为已验证发件人。
9. **E2E 预置用户**：`e2e_user_1786038139005@wzsf.local`（E2E测试员）、`e2e_admin_1786038169301@wzsf.local`（E2E管理员）已在库且 approved；如被误删，用 `_mkuser.mjs user|admin` 重建。
10. 本地服务/E2E 依赖端口 8080；若 8080 被占用，E2E 脚本中的 base URL 需同步修改。

## 最后修改时间与标识

- 最后修改时间：2026-08-07
- 标识：**自动化 AI 进程 #6**（基于进程 #5 更新；E2E 39/41：T6.1 邮件限流复发=环境可重试、T11=需人工；线上核验通过 34/35 一致；测试脚本 T6.1 改为轮询消除时序抖动）
- 测试基线：`_tmp/e2e_results.json`（39/41，本轮重跑）
- 待办钩子：① 人工在 Supabase 控制台配置 Edge Function 环境变量并重新 Deploy（T11 → 41/41）；② 邮件限流解除后重跑 E2E 确认 T6.1 恢复 PASS（历史波动数小时级）；③ 后续 E2E 跑完用 `_cleanup_p4.mjs` + `_cleanup5.mjs` 清理测试用户。git 操作需走代理 `-c http.proxy=http://127.0.0.1:7890`。
