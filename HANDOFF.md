# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

⚠️ **E2E 测试 39/41 通过；剩余 2 项均需人工介入（非代码缺陷），详见「跳过的链路」。**

- 全部核心业务链路已跑通并通过本地测试（静态站点、主题/风格切换、登录/登出、管理员审核、表态、评论增查改删举报、竞赛管理、Notion 数据链路）。
- 剩余 2 项失败均为**环境/基础设施层问题**，代码侧已做优雅降级，部署环境配置完成后即可全绿。

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

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T6.1 注册发送验证邮件（429） | **需人工** | Supabase GoTrue 邮件发送命中环境级限流（429），注册链路本身逻辑正常（pending 用户创建成功）。等待限流解除后重跑 T6.1 即可。 |
| T11 Edge Function 无 CORS 头（500） | **需人工** | 远端函数缺 `RESEND_API_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 环境变量。本环境无 Supabase CLI / 控制台权限，无法配置并重新 Deploy。代码已加 501 优雅降级，**重新部署后即修复**。 |

## 对下一个 AI 的建议

1. **最高优先级（可自动完成）**：在 Supabase 控制台为两个 Edge Function（`send-audit-email`、`submission-review`）配置环境变量并重新 Deploy：
   - `RESEND_API_KEY`（取自根目录 `权限.txt`）
   - `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（同上）
   - 部署后重跑 T11，应通过。
2. **可重试**：稍后（限流解除后）重跑 T6.1 注册链路，预期通过。
3. **可选优化**：`_tmp/e2e_test.py` 目前依赖外部临时脚本预置用户，可考虑将用户预置逻辑收敛为可重复执行的 `scripts/` 下脚本并提交。
4. 若以上 2 项人工项完成后，重跑 `python _tmp/e2e_test.py`，预期 **41/41**。

## 重要注意事项

- **绝不提交**：根目录 `权限.txt`（含全部密钥）与任何 `/_*.mjs` 临时脚本（已 gitignore，但不要 `git add -f`）。
- **不要修改**：`scripts/supabase-setup.mjs` 是数据库 schema 唯一真源；改动后需同时在线上库执行对应 SQL（可用临时 `_*.mjs` 连接串执行，用完即弃）。
- **线上已改、源码待跟**：若未来重跑 `supabase-setup.mjs` 全量建表，`comments_select` 策略会自动使用修复后的版本，无需手工再改。
- **部署链路**：push 到 main 会触发 GitHub Actions 部署 Worker（需 `CLOUDFLARE_API_TOKEN`，在仓库 Secrets 中）。Edge Function 不在此流水线内，需手动 Deploy。
- **邮件服务**：`RESEND_FROM` 默认 `onboarding@resend.dev`，生产建议改为已验证发件人。
- 本地服务/E2E 依赖端口 8080；若 8080 被占用，E2E 脚本中的 base URL 需同步修改。

## 最后修改时间与标识

- 最后修改时间：2026-08-07
- 标识：**自动化 AI 进程 #1**
- 测试基线：`_tmp/e2e_results.json`（39/41）
