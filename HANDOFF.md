# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

✅ **T11 已人工解决（进程 #7 核验）**：用户已在 Supabase 控制台为两个 Edge Function 配置环境变量并重新部署。实测：`send-audit-email` → `200 {"ok":true}`、`submission-review` → `200` 返回真实待审核列表，均带 CORS `*`。E2E 剩 T6.1 邮件限流（环境项，历史波动数小时级）。

✅ **新增修复（进程 #7）：JWT 过期自动续期**。真实用户登录超 1 小时后表态/评论报「操作失败：JWT expired」——根因是自制客户端 `site/js/supabase.js` 只存 `access_token`、丢弃 `refresh_token`，无续期逻辑。已修复：
- 登录/刷新时同时保存 `refresh_token`（GoTrue 新版为 12 位单次使用 opaque token，属正常格式）
- 新增 `SB.refresh()`：用 refresh_token 换新 access_token
- `SB.request()` 遇任意 401 自动续期并重试一次，失败报「登录已过期，请重新登录」并清会话
- `auth.js` 监听 `sb-auth-changed` 事件，续期失败登出时界面自动切回未登录
- 验证：浏览器内将 token 篡改为无效 JWT 后表态 → 自动续期成功（"已记录你的表态"）；E2E 重跑 T9 全 PASS，无回归

- **T6.1 邮件限流复发（环境，可重试）**：进程 #7 两轮 E2E 均 `email rate limit exceeded`（`_tmp/e2e_run_p7.log` / `_tmp/e2e_run_p7b.log`）。链路本身健康（进程 #4/#5 完整 PASS 过）。连带 T11 本轮被 429 console 报错误标 FAIL（限流触发，非 Edge Function 问题，T11 已单独核验通过）。
- **测试基线（进程 #7）**：`_tmp/e2e_results.json` 39/41（仅 T6.1 环境限流 + 其连带 T11）。T9.2 曾一次性 FAIL 后复跑 PASS——测试固有竞态（快速连点 up/down 时 PATCH 顺序竞争），非代码回归。

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
| T11 | 无页面 JS 错误 | ⚠️ 本轮 T6.1 限流连带 429 误标；Edge Function 已单独核验正常（进程 #7） |
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

### 本轮（自动化 AI 进程 #7）新增工作
| 项 | 内容 | 结果 |
|---|---|---|
| T11 人工项跟进 | 用户按教程在控制台配置 env 并重新 Deploy 两个 Edge Function；实测 `send-audit-email`→200 ok、`submission-review`→200 真实列表，均带 CORS | ✅ **已解决** |
| **JWT 过期修复** | `supabase.js`：保存 refresh_token + 新增 `SB.refresh()` + request 任意 401 自动续期重试；`auth.js` 监听 `sb-auth-changed` 事件同步界面 | ✅ |
| JWT 修复验证 | 浏览器篡改 token 为无效 JWT 后表态 → 自动续期成功（"已记录你的表态"）、token 更新、无 JS 错误（`_tmp/jwt_test.py`，一次性） | ✅ |
| E2E 回归 | 39/41（`_tmp/e2e_run_p7b.log`）：仅 T6.1 环境限流及其连带 T11（429 console）；T9 互动链路全 PASS，确认 JWT 改动无回归 | ⚠️ 环境项 |
| T9.2 偶发 FAIL 排查 | 首次运行 T9.2 FAIL（down=0），复跑 PASS → 测试固有竞态（1.2s 间隔内 up 的 PATCH 与 down 的 GET/PATCH 竞争），非代码回归 | ✅ |
| 测试数据清理 | 删除 4 个 `pending_*@wzsf.local` 测试用户；E2E 预置用户保留；审核列表残留 = 0 | ✅ |

### 修复过的问题（历史轮次，仍有效）
1. **评论软删除 403（RLS 缺陷，T9.7）**：`comments_select` 策略已改为 `USING (status = 'active' OR auth.uid() = user_id)`，前端加 `status=eq.active` 过滤；线上库已同步执行。
2. **审核页邮箱缺失（T7.3/T7.4）**：`_mkuser.mjs` 已写 `profiles.email`。
3. **Edge Function 缺环境变量返回裸 500 且无 CORS 头（T11）**：`send-audit-email.ts`、`submission-review.ts` 已加 `envCheck()`（缺变量 → 501 + CORS 头 + 中文提示）。**需重新部署后生效**（见「需人工」#1）。
4. **导航栏品牌文字登录态下折行**：`site/css/style.css` `.nav-links a` 加 `flex-shrink:0; white-space:nowrap`（2c6ab8b）及导航间距（4c98854）。进程 #5 强制重建后已随 4c98854 全量上线，本轮核验确认仍在线上。
5. `.gitignore` 增加 `/_*.mjs`，防止含数据库凭据的临时脚本被提交。
6. **JWT 过期报「操作失败：JWT expired」（进程 #7）**：自制客户端只存 access_token、无续期逻辑，登录超 1 小时后互动全挂。修复见「当前状态」。改动文件：`site/js/supabase.js`、`site/js/auth.js`。

### 环境准备
- 依赖：前端纯静态，无 npm install 必要（`网站/` 的 `pg` 已安装，供临时 `_*.mjs` 直连 DB）；Worker 由 GitHub Actions 部署。
- 本地服务：`node scripts/serve.mjs`（端口 8080，本轮已有服务在跑）。
- E2E：`python _tmp/e2e_test.py`（Playwright headless Chromium，在仓库根目录 `c:\Users\sneeg\Desktop\Github 极简文章网站` 运行），结果写入 `_tmp/e2e_results.json` 与 `_tmp/e2e_run_p6b.log`。
- E2E 依赖 `网站/_mkuser.mjs`（直插 DB）预置用户；`e2e_user_1786038139005@wzsf.local` / `e2e_admin_1786038169301@wzsf.local` 已在库中（approved）。
- **注意**：本机 node 的 fetch 不走系统代理会连 github.io 失败；PowerShell `Invoke-WebRequest` 走系统代理正常。线上核验脚本请用 PowerShell（`_tmp/verify_live.ps1` / `_tmp/download_live.ps1` + git diff）。

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T11 Edge Function 无 CORS 头（500） | **已解决（进程 #7）** | 用户已在控制台为两个函数配置 env 并重新 Deploy，实测均 200 + CORS `*`。 |
| T6.1 邮件限流（429） | **环境可重试** | 进程 #7 两轮均限流（`email rate limit exceeded`）。属 Supabase 共享/环境级限流，历史上呈数小时级波动（进程 #3 持续数小时 → #4/#5 解除 → #6/#7 复发）。等待解除后重跑 E2E 即可；链路本身已被多轮验证正常。 |
| GitHub Pages 部署 | **已解决（进程 #5）+ 本轮核验通过** | 进程 #5 已用 `POST /pages/builds` 强制重建至最新版；本轮 `GET /pages` 状态 `built`、live 34/35 与仓库一致，无需再操作。若未来再出现线上滞后：先 `GET /pages/builds/latest` 看 status，若 errored/building 卡住，直接 `POST /pages/builds` 强制重建（约 1 次/10 分钟限制）。 |

## 对下一个 AI 的建议

0. **核验线上部署状态**（可自动完成，方法已升级）：
   - **不要用裸 SHA1 比对 live vs 本地文件**（会因 CRLF 伪差误报，进程 #6 已验证）。正确姿势：PowerShell 下载 live 全站 → `git diff --no-index` 比对（git 自动忽略换行符）；或对比 `gh-pages` 分支与线上。预期结果：唯一真实差异为部署期重生成文章页的 `?v=2` 缓存号。
   - 若线上滞后：`POST https://api.github.com/repos/SNE-program/wenzhou-sf-club-site/pages/builds`（Authorization: Bearer <Token>）强制重建，轮询 `GET /pages/builds/latest` 至 status=built；若仍 errored，先 `PUT /pages`（body `{"source":{"branch":"gh-pages","path":"/"}}`）再重建。
   - 注意：本机 git push/fetch 需走系统代理（`git -c http.proxy=http://127.0.0.1:7890`）；api.github.com 直连正常；node fetch 不走系统代理（github.io 连不上），PowerShell 正常。
1. ~~次高优先级（需人工）：Edge Function 环境变量~~ **已完成（进程 #7）**，T11 已通过单独核验。
2. **可自动**：重跑 `python _tmp/e2e_test.py`。若 T6.1 仍 429（邮件限流复发中），属环境项，等待解除后重试即可；脚本已改为轮询等待（≤10s），不会再误报时序抖动。**跑完记得清理 signup/pending 用户**（见注意事项 #5）。
3. **可选优化**：注册限流时前端直接透传英文错误「email rate limit exceeded」，可考虑在 `site/js/auth.js` 增加中文提示（非阻断，不急；保守原则下本轮未改产品代码）。
4. **待验证**：JWT 自动续期修复改动尚未提交/上线（工作区已改 `site/js/supabase.js`、`site/js/auth.js`）。提交推送到 main 后由 GitHub Actions 自动部署到线上；线上核验时注意这两处 `?v=` 缓存号更新。

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
- 标识：**自动化 AI 进程 #7**（基于进程 #6 更新；T11 Edge Function 已人工解决并核验通过；新增 JWT 过期自动续期修复并验证无回归；E2E 39/41：仅 T6.1 环境限流及其连带 T11；测试数据已清理）
- 测试基线：`_tmp/e2e_results.json`（39/41，进程 #7 重跑）
- 待办钩子：① 邮件限流解除后重跑 E2E 确认 T6.1 恢复 PASS（历史波动数小时级）；② 后续 E2E 跑完用 `_cleanup_p4.mjs` + `_cleanup5.mjs` 清理测试用户；③ JWT 修复已改工作区，待提交推送部署。git 操作需走代理 `-c http.proxy=http://127.0.0.1:7890`。
