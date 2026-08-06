# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

✅ **E2E 测试 40/41 通过（与进程 #4 基线一致）；线上站点已由进程 #5 强制重建并确认为最新版（4c98854）。剩余 1 项失败（T11）为已定性的「需人工」项（Edge Function 环境变量部署，非代码缺陷）。**

- **T6.1 注册链路通过**：Supabase 邮件限流已解除，`@qq.com` 注册成功，前端提示「验证邮件已发送」（进程 #5 重跑确认）。
- **⚠️ 重大更正（进程 #5）**：进程 #3/#4 宣称「线上已确认最新版」的结论**有误**。他们只检查了 live CSS 是否含 `flex-shrink` 字符串（早期版本也有），未做全量内容比对。进程 #5 用**全文件 SHA1 哈希比对**发现：线上实际发布的是 main 提交 **1c586d9**（落后 2 个提交，缺 2c6ab8b 导航换行修复 + 4c98854 导航间距/评论过滤/审核页邮箱展示等前端改动）。根因：最后一次成功 Pages 构建为 61b3ce7（发布 1c586d9 内容），之后 2458c1d/0798808/bea6b92 等构建全部 errored 或卡 building（GitHub Pages major_outage）。
- **✅ 部署已修复（进程 #5 核心成果）**：`POST /repos/.../pages/builds` 强制重建（HTTP 201）→ 构建 **22 秒完成 status=built**（bea6b92，GitHub Pages 队列已恢复）→ 全文件复核：**35/35 文件与 main（4c98854）一致**（含二进制图字节级 SHA256、CNAME、JS、CSS；唯一文本差异为部署期重生成的分享文章页 `js/auth.js` 无 `?v=2` 缓存号，属生成器预期行为，非缺陷）。live 全站 HTTP 200。
- **Pages API 状态**：`/pages` 与 `builds/latest` 均已恢复 `status=built`（此前 errored/building 为中断期残留）。
- **剩余 1 项（T11）需人工**：已部署的 Edge Function（`send-audit-email` / `submission-review`）仍为旧版。进程 #5 用**有效管理员 JWT** 直接探测：返回 **HTTP 500 且无 CORS 头**（仓库内 envCheck 修复 →501 + CORS 头 待人工在 Supabase 控制台配置环境变量并重新 Deploy 后生效）。注：无有效 JWT 时平台网关会先返回 401+CORS=*，勿误判为已修复。

## 已完成的工作

### 跑通的链路（40/41 PASS）
| 分组 | 内容 | 结果 |
|---|---|---|
| T1 | 首页标题 / 品牌导航 / 页脚 / hero | ✅ |
| T2 | 主题切换（light/dark）、风格切换（neon） | ✅ |
| T3 | 搜索页渲染与搜索命中 | ✅ |
| T4 | works / members / contests / about 页面内容渲染 | ✅ |
| T5 | 文章标题渲染、表态区、未登录表态/评论提示 | ✅ |
| T6.1 | **注册发送验证邮件（@qq.com）** | ✅ **本轮恢复通过（限流解除）** |
| T6.2 | 预置待审核用户（pending） | ✅ |
| T7 | 管理员昵称、管理员入口、审核列表（含邮箱）、审核通过 | ✅ |
| T8 | 普通用户无管理员入口 / 无审核权限 | ✅ |
| T9 | 表态记录与切换、评论发布/列表/编辑/举报/删除 | ✅ |
| T10 | 登出恢复、管理员入口消失 | ✅ |
| Notion | Worker 5/5 端点（site/activities/works/contests/members）本地验证通过（历史轮次） | ✅ |
| 竞赛 | anon 只读 200、管理员 CRUD 201/200、普通用户写 403（历史轮次） | ✅ |

### 本轮（自动化 AI 进程 #4）新增工作
| 项 | 内容 | 结果 |
|---|---|---|
| 线上部署核验 | 确认 live CSS 含 `flex-shrink: 0`（导航修复已上线）；live index/auth.js 正常；gh-pages 分支内容（bea6b92）与最后成功构建 61b3ce7 文件集一致（35 文件，无新增/缺失） | ✅ |
| E2E 重跑 | **40/41**（`_tmp/e2e_run_p4.log`），T6.1 从 FAIL 转 PASS | ✅ |
| T6.1 恢复 | Supabase 邮件限流（429 over_email_send_rate_limit）已解除；`signup_*@qq.com` 注册成功 | ✅ |
| T11 复核 | 仍失败：管理员审核「通过」时前端调用 `send-audit-email` → 无 CORS 头（浏览器拦截）→ 控制台报错。根因不变：已部署函数为旧版 | 🔎 需人工 |
| GoTrue 管理 API 复核 | 用已存在邮箱 POST `/auth/v1/admin/users` 返回 500 `Database error checking email`（新邮箱创建正常 200）；确认 `_mkuser.mjs` 直插 DB 的绕过方式仍必要 | ℹ️ 已记录 |
| 测试数据清理 | 删除本轮产生的 `probe_*@qq.com`（API 探针）与 `signup_*@qq.com`（T6.1 注册）共 2 个测试用户；审核待审列表残留测试用户 = 0 | ✅ |
| 线上冒烟 | 线上首页 200、品牌文案、auth.js 正常加载 | ✅ |
| 推送触发核验 | 推送 e049f04（仅改 HANDOFF.md）**未创建 workflow 运行**（推送触发在中断期仍不可靠）；内容不受影响（仅文档变更，site/ 未变）。`workflow_dispatch` 为可靠兜底 | ℹ️ 已记录 |

### 本轮（自动化 AI 进程 #5）新增工作
| 项 | 内容 | 结果 |
|---|---|---|
| **线上版本核对（关键纠错）** | 用**全文件 SHA1 哈希比对**（live vs 各 git 提交）发现：线上实际发布的是 **1c586d9**，非进程 #3/#4 声称的最新版。全部关键文件（index/auth.js/works/members/about/CSS）均精确匹配 1c586d9 | ⚠️ 纠错 |
| **Pages 部署修复** | `POST /repos/SNE-program/wenzhou-sf-club-site/pages/builds` 强制重建（201）→ **22 秒 status=built**（bea6b92）→ `/pages` 状态恢复 `built`（此前 errored/building 残留已清除，Pages 队列恢复正常） | ✅ |
| **线上全量核验** | 重建后 35/35 文件与 main（4c98854）字节级一致（文本 SHA1 + 二进制 SHA256；CNAME 一致；唯一差异为部署重生成的分享文章页 `js/auth.js` 无 `?v=2`，属生成器预期）；live 首页/works/文章页均 200 | ✅ |
| E2E 重跑 | **40/41**（`_tmp/e2e_run_p5.log`），与基线一致；T11 仍为唯一失败项 | ✅ |
| T11 复核（新证据） | 用**有效管理员 JWT** 直接探测远端 `send-audit-email`：HTTP 500 无 CORS 头 → 确认为旧版未修复；无效 JWT 时平台网关先返回 401+CORS=*（勿误判） | 🔎 需人工 |
| 测试数据清理 | 清理本轮 `signup_*@qq.com` 1 个 + 历史残留 `pending_*@wzsf.local` 4 个（`_cleanup_p4.mjs` + 新增 `_cleanup5.mjs`，后者扩展清理已审核的 pending_* 用户）；E2E 预置用户保留，审核列表残留 = 0 | ✅ |

### 修复过的问题（历史轮次，仍有效）
1. **评论软删除 403（RLS 缺陷，T9.7）**：`comments_select` 策略已改为 `USING (status = 'active' OR auth.uid() = user_id)`，前端加 `status=eq.active` 过滤；线上库已同步执行。
2. **审核页邮箱缺失（T7.3/T7.4）**：`_mkuser.mjs` 已写 `profiles.email`。
3. **Edge Function 缺环境变量返回裸 500 且无 CORS 头（T11）**：`send-audit-email.ts`、`submission-review.ts` 已加 `envCheck()`（缺变量 → 501 + CORS 头 + 中文提示）。**需重新部署后生效**（见「需人工」#1）。
4. **导航栏品牌文字登录态下折行**：`site/css/style.css` `.nav-links a` 加 `flex-shrink:0; white-space:nowrap`（2c6ab8b）及导航间距（4c98854）。**⚠️ 更正：这两个修复在进程 #5 强制重建前并未真正上线**（线上停留在 1c586d9），进程 #5 重建后已随 4c98854 全量上线。
5. `.gitignore` 增加 `/_*.mjs`，防止含数据库凭据的临时脚本被提交。

### 环境准备
- 依赖：前端纯静态，无 npm install 必要；Worker 由 GitHub Actions 部署（`wrangler`）。
- 本地服务：`node scripts/serve.mjs`（端口 8080，进程 #5 运行时端口 8080 已有服务在跑）。
- E2E：`python _tmp/e2e_test.py`（Playwright headless Chromium，在仓库根目录 `c:\Users\sneeg\Desktop\Github 极简文章网站` 运行），结果写入 `_tmp/e2e_results.json` 与 `_tmp/e2e_run_p5.log`。
- E2E 依赖 `网站/_mkuser.mjs`（直插 DB）预置用户；`e2e_user_1786038139005@wzsf.local` / `e2e_admin_1786038169301@wzsf.local` 已在库中（approved）。

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T11 Edge Function 无 CORS 头（500） | **需人工** | 远端函数缺 `RESEND_API_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 环境变量（本轮 E2E 复核：审核「通过」触发调用时浏览器报 CORS 拦截）。本环境无 Supabase CLI / 控制台权限，无法配置并重新 Deploy。代码修复（envCheck→501）已在仓库，**在控制台配好环境变量并重新 Deploy 即修复**，重跑 E2E 后 T11 应通过。 |
| GitHub Pages 部署（线上为旧版 1c586d9） | **已解决（进程 #5）** | 进程 #3/#4 期间 Pages 组件 major_outage 导致 bea6b92 构建卡 building/errored，线上停留在最后一次成功构建 61b3ce7（即 1c586d9 内容）。进程 #5 用 `POST /pages/builds` 强制重建，22 秒 built，线上已全量更新为 4c98854（35/35 文件一致）。若未来再出现线上滞后：先 `GET /pages/builds/latest` 看 status，若 errored/building 卡住，直接 `POST /pages/builds` 强制重建（约 1 次/10 分钟限制）。 |
| 邮件限流（T6.1） | **已解除** | 本轮注册链路已通过；若未来再次 429，属 Supabase 共享/环境级限流，等待解除后重试即可。 |

## 对下一个 AI 的建议

0. **核验线上部署状态**（可自动完成，方法已升级）：
   - **不要只 grep 字符串**（进程 #3/#4 因此误判）。用**全文件哈希比对**：`GET https://sne-program.github.io/wenzhou-sf-club-site/css/style.css` 等关键文件，SHA1 后与 `git show 4c98854:site/...` 对比；或直接对比 `gh-pages` 分支（raw.githubusercontent.com/SNE-program/wenzhou-sf-club-site/gh-pages/...）与线上内容是否一致。
   - 若线上滞后：`POST https://api.github.com/repos/SNE-program/wenzhou-sf-club-site/pages/builds`（Authorization: Bearer <Token>）强制重建，轮询 `GET /pages/builds/latest` 至 status=built；若仍 errored，先 `PUT /pages`（body `{"source":{"branch":"gh-pages","path":"/"}}`）再重建。
   - 注意：本机 git push/fetch 需走系统代理（`git -c http.proxy=http://127.0.0.1:7890`）；api.github.com 直连正常。
1. **次高优先级（需人工，自动进程无法完成）**：在 Supabase 控制台为两个 Edge Function（`send-audit-email`、`submission-review`）配置环境变量并重新 Deploy：
   - `RESEND_API_KEY`（取自根目录 `权限.txt`）
   - `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（同上）
   - 部署后重跑 E2E，T11 应通过（预期 41/41）。
2. **可自动**：重跑 `python _tmp/e2e_test.py` 确认 40/41 稳定（T6.1 依赖邮件限流已解除；若复现 429 则等待后重试）。**跑完记得清理 signup 用户**（见注意事项 #5，可用 `网站/_cleanup_p4.mjs` 思路）。
3. **可选优化**：注册限流时前端直接透传英文错误「email rate limit exceeded」，可考虑在 `site/js/auth.js` 增加中文提示（非阻断，不急）。
4. 若人工项（Edge Function Deploy）完成后，重跑 E2E，预期 **41/41**。

## 重要注意事项

1. **绝不提交**：根目录 `权限.txt`（含全部密钥）与任何 `/_*.mjs` 临时脚本（已 gitignore，但不要 `git add -f`）。
2. **不要修改**：`scripts/supabase-setup.mjs` 是数据库 schema 唯一真源；改动后需同时在线上库执行对应 SQL（可用临时 `_*.mjs` 连接串执行，用完即弃）。
3. **线上已改、源码待跟**：若未来重跑 `supabase-setup.mjs` 全量建表，`comments_select` 策略会自动使用修复后的版本，无需手工再改。
4. **更正（进程 #2 核验）**：`.github/workflows/deploy.yml` **只部署 GitHub Pages（gh-pages 分支），不部署 Worker**。Worker `wzsf-site-api` 是手动 `wrangler deploy` 的（部署记录 2026-08-06）；wrangler 用 `权限.txt` 的 Cloudflare Token 以 `CLOUDFLARE_API_TOKEN` 环境变量执行。
5. **E2E 会产生测试数据**：T6.1 注册现在能成功，每次运行会新增一个 `signup_*@qq.com` 未确认用户（会出现在管理员待审列表）；`_mkuser.mjs pending` 会新增一个 `pending_*@wzsf.local`（审核通过后转 approved，不出现在待审列表但仍占 DB）。跑完 E2E 后用 `网站/_cleanup_p4.mjs`（清理 probe_*/signup_*）+ `网站/_cleanup5.mjs`（进程 #5 新增，扩展清理已审核的 pending_* 用户）保持 DB 整洁。
6. **GoTrue 管理 API 已知怪癖**：用「已存在邮箱」POST `/auth/v1/admin/users` 会返回 500 `Database error checking email`（新邮箱正常）。因此预置/重建用户请使用 `_mkuser.mjs`（直插 DB），不要用 `_setup_e2e.mjs`（走 GoTrue 管理 API，重跑会 500）。
7. **部署链路**：push 到 main 触发 `deploy.yml`（GitHub Pages，含 cname=wzmssf.club）。**进程 #5 时 GitHub Pages 队列已恢复正常**（强制重建 22 秒 built），但仍建议每次改完 site/ 后核对线上哈希。Edge Function 不在 CI 流水线内，需手动在 Supabase 控制台 Deploy。
8. **邮件服务**：`RESEND_FROM` 默认 `onboarding@resend.dev`，生产建议改为已验证发件人。
9. **E2E 预置用户**：`e2e_user_1786038139005@wzsf.local`（E2E测试员）、`e2e_admin_1786038169301@wzsf.local`（E2E管理员）已在库且 approved；如被误删，用 `_mkuser.mjs user|admin` 重建。
10. 本地服务/E2E 依赖端口 8080；若 8080 被占用，E2E 脚本中的 base URL 需同步修改。

## 最后修改时间与标识

- 最后修改时间：2026-08-07
- 标识：**自动化 AI 进程 #5**（基于进程 #4 更新；E2E 40/41 稳定；**纠正"线上已最新"误判并强制重建 Pages，线上已全量更新至 4c98854**）
- 测试基线：`_tmp/e2e_results.json`（40/41，本轮重跑）
- 待办钩子：① 人工在 Supabase 控制台配置 Edge Function 环境变量并重新 Deploy（T11 → 41/41）；② 后续 E2E 跑完用 `_cleanup_p4.mjs` + `_cleanup5.mjs` 清理测试用户；③ 改 site/ 后按「建议 #0」全文件哈希核验线上。git 操作需走代理 `-c http.proxy=http://127.0.0.1:7890`。
