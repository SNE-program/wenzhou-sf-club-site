# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

✅ **40/41 E2E 通过（进程 #9）**：唯一失败为 T6.1 Supabase 邮件限流（环境项，历史波动数小时级）。T9 表态/评论全链路、T11 无 JS 错误均 PASS。**所有代码改动已提交并推送到 GitHub main 分支（提交 1b63aea），GitHub Actions 将自动部署 Pages。**

- ✅ **进程 #8 P0 优化已提交推送**：正文阅读 + 全文搜索、举报/评论管理闭环（2 个新管理页 + 4 条 RLS 策略 + 防重复举报索引，线上库已执行）。本轮 E2E 40/41 全量回归确认无回归。
- ✅ **进程 #9 优化落地 4 项**：认证错误中文化（O1）、E2E 脚本 429 误报过滤与竞态轮询（O2/O2b，仅 `_tmp/` 不入库）、移动端适配检查通过（O3，无需修复）、评论提交防重复（O4）。均经全量回归验证。
- ⚠️ **T6.1 邮件限流仍在（环境可重试）**：进程 #9 三轮 E2E 均 `email rate limit exceeded`。链路本身健康（进程 #4/#5 完整 PASS 过）。等待限流解除后重跑 `_tmp/e2e_test.py` 即可。
- 🔎 **本轮重要发现：环境中存在并发活动主体**。`_tmp/probe_rest_p9.mjs`（非本进程创建，13:37 出现、13:44 启动后卡在 fetch 挂起）曾修改 e2e_user 投票；e2e_user 的 uid 曾被重建（7dc67e58 → ec60b77a，旧用户级联删除导致测试评论"消失"）；评论区出现过"验证星友"的"定向验证评论"。**这不是产品 Bug，是并发操作导致的数据竞争**。请勿删除 `_tmp/probe_rest_p9.mjs`（另一主体使用中）；若你的测试数据异常消失，优先排查是否有并发进程重建了 e2e 用户。

## 已完成的工作

### 本轮（自动化 AI 进程 #9）工作
| 项 | 内容 | 结果 |
|---|---|---|
| 初始检查 | 读取 `权限.txt`、进程 #8 HANDOFF、README、package.json；8080 服务在跑；git 工作区含进程 #8 P0 改动 | ✅ |
| E2E 基线 | 首轮 39/41（仅 T6.1 环境限流 + 连带 T11） | ⚠️ 环境项 |
| **T9.4/T9.1/T9.2 竞态排查** | 失败根因：测试脚本固定等待（1.2-1.8s）不足——setVote 为 GET→PATCH→GET 串行、loadComments 的 GET 慢于固定等待；数据库验证 POST 409/PATCH 200 均正常，**产品代码无 Bug**；另有并发主体重建 e2e_user 级联删数据干扰。已改进测试脚本为 ≤10s 轮询等待（`_tmp/e2e_test.py`，不入库） | ✅ |
| E2E 终态 | **40/41**（`_tmp/e2e_run_p9d.log`）：T9.1 表态/ T9.2 切换 / T9.3-T9.7 评论 / T11 全 PASS，仅 T6.1 限流 | ✅ |
| **O1 认证错误中文化** | `site/js/auth.js` 新增 `friendlyAuthError()`：限流/邮箱已注册/密码错误/邮箱无效/密码过短/网络异常等英文错误 → 中文提示（仅显示层，不改业务逻辑）。Playwright 实测错误密码登录显示「邮箱或密码错误」 | ✅ 已提交 |
| **O2 E2E 脚本改进** | `_tmp/e2e_test.py`：T11 过滤 429 限流连带误报；T9.1/T9.2/T9.4 固定等待改轮询（≤10s） | ✅ 不入库 |
| **O3 移动端检查** | Playwright 375×812 视口扫描 9 个页面：无横向溢出、无 JS 错误 | ✅ 无需修复 |
| **O4 评论防重复提交** | `site/js/article.js` submitComment 提交中禁用按钮 + "发布中…" + finally 恢复；对照实验确认无回归 | ✅ 已提交 |
| 测试数据清理 | `_cleanup_p4.mjs` + `_cleanup5.mjs` + `_prep_e2e.mjs`：清理 3 个 pending_* 用户、e2e 用户投票/评论残留；审核列表残留 = 0 | ✅ |
| 提交推送 | commit `1b63aea`（9 文件 +424/-5），已推送 main | ✅ |

### 历史链路基线（进程 #5-#8 验证，仍有效）
| 分组 | 内容 | 结果 |
|---|---|---|
| T1 | 首页标题 / 品牌导航 / 页脚 / hero | ✅ |
| T2 | 主题切换（light/dark）、风格切换（neon） | ✅ |
| T3 | 搜索页渲染与搜索命中（含正文 body） | ✅ |
| T4 | works / members / contests / about 页面内容渲染 | ✅ |
| T5 | 文章标题渲染、表态区、未登录表态/评论提示 | ✅ |
| T6.1 | 注册发送验证邮件（@qq.com） | ⚠️ 限流（环境可重试） |
| T6.2 | 预置待审核用户（pending） | ✅ |
| T7 | 管理员昵称、入口、审核列表、审核通过 | ✅ |
| T8 | 普通用户无管理员入口 / 无审核权限 | ✅ |
| T9 | 表态记录与切换、评论发布/列表/编辑/举报/删除 | ✅ |
| T10 | 登出恢复、管理员入口消失 | ✅ |
| T11 | 无页面 JS 错误 | ✅（429 已过滤） |
| Notion | Worker 5/5 端点（site/activities/works/contests/members）本地验证通过（历史轮次） | ✅ |
| 竞赛 | anon 只读 200、管理员 CRUD 201/200、普通用户写 403（历史轮次） | ✅ |
| P0 管理页 | 评论管理 / 举报处理端到端验证 7/7（进程 #8） | ✅ |

### 修复过的问题（历史轮次，仍有效）
1. **评论软删除 403（RLS 缺陷，T9.7）**：`comments_select` 策略已改为 `USING (status = 'active' OR auth.uid() = user_id)`，前端加 `status=eq.active` 过滤。
2. **审核页邮箱缺失（T7.3/T7.4）**：`_mkuser.mjs` 已写 `profiles.email`。
3. **Edge Function 缺环境变量返回裸 500 且无 CORS 头（T11）**：`send-audit-email.ts`、`submission-review.ts` 已加 `envCheck()`。**已人工解决（进程 #7）**：用户配置 env 并重新 Deploy，实测 200 + CORS。
4. **导航栏品牌文字登录态下折行**：`style.css` `.nav-links a` 加 `flex-shrink:0; white-space:nowrap`。
5. `.gitignore` 增加 `/_*.mjs`，防止含数据库凭据的临时脚本被提交。
6. **JWT 过期报「操作失败：JWT expired」（进程 #7）**：`supabase.js` 保存 refresh_token + `SB.refresh()` + 401 自动续期重试；`auth.js` 监听 `sb-auth-changed`。已提交（993464b）。

## 优化记录（进程 #9）

| 优化 | 内容 | 验证方式 | 效果 |
|---|---|---|---|
| O1 认证错误中文化 | `auth.js` friendlyAuthError 映射 7 类英文错误 | Playwright 错误密码登录 → 中文提示；E2E 回归 | 中文用户可理解错误原因 |
| O2 E2E T11 429 过滤 | T11 忽略 429 限流连带 console 错误 | E2E T11 由误报 FAIL → PASS | 测试判断更准确 |
| O2b T9 轮询等待 | T9.1/T9.2/T9.4 固定等待改 ≤10s 轮询 | E2E T9 全 PASS | 消除网络慢时的竞态误报 |
| O3 移动端适配 | 375×812 视口扫描 9 页 | 无横向溢出/无 JS 错误 | 确认移动端良好，无需改动 |
| O4 评论防重复提交 | 提交中禁用按钮 + 发布中… | 对照实验（回滚后仍 FAIL 证明非回归）+ E2E 回归 | 防连点重复提交 |

放弃项：无（未实施任何放弃项）。

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T6.1 邮件限流（429） | **环境可重试** | Supabase 共享/环境级限流，历史呈数小时级波动（#3 持续 → #4/#5 解除 → #6-#9 复发）。等待解除后重跑 E2E 即可；链路本身多轮验证正常。 |
| GitHub Pages 部署 | **已解决（进程 #5）+ 本轮提交待部署** | push main 触发 deploy.yml 自动部署。若线上滞后：`POST /pages/builds` 强制重建（1 次/10 分钟限制）。 |

## 对下一个 AI 的建议

0. **推送已由本进程完成（1b63aea）**：若 GitHub Actions 部署完成，建议核验线上（方法见注意事项：git diff --no-index 比对 live vs 仓库，预期唯一差异为 `?v=2` 缓存号）。若线上滞后：`POST https://api.github.com/repos/SNE-program/wenzhou-sf-club-site/pages/builds`（Bearer <Token>）强制重建。
1. **可自动**：重跑 `python _tmp/e2e_test.py`。若 T6.1 仍 429 属环境项；脚本已改为轮询等待（≤10s），T9 不会误报。跑完用 `网站/_cleanup_p4.mjs` + `网站/_cleanup5.mjs` + `网站/_prep_e2e.mjs` 清理测试数据。
2. **注意并发主体**：若测试数据"神秘消失"或 e2e_user 的 uid 变化，说明环境中有其他进程在并行操作（本轮已观察到 `_tmp/probe_rest_p9.mjs` 与 e2e_user 重建）。**不要删除 `_tmp/probe_rest_p9.mjs`**；测试前先跑 `_prep_e2e.mjs` 清理起点，测试中遇数据异常优先怀疑并发而非代码回归。
3. **可选优化（低风险）**：setVote 成功后本地乐观更新计数（减少一次串行 GET，点击反馈更快）；需保持"刷新页面校正"语义，不得改变业务输出。本轮保守未做。
4. **注意**：git 操作需走代理 `git -c http.proxy=http://127.0.0.1:7890`（本进程 push 未加代理参数但成功，若失败请加）；git 身份已配置为 `SNE-program <SNE-program@users.noreply.github.com>`。

## 重要注意事项

1. **绝不提交**：根目录 `权限.txt`（含全部密钥）与任何 `/_*.mjs` 临时脚本（已 gitignore，不要 `git add -f`）。
2. **不要修改**：`scripts/supabase-setup.mjs` 是数据库 schema 唯一真源，但**已落后于线上库现状**（线上已有 status/is_admin/email 列、guard 触发器、contests 策略、进程 #8 的 4 条管理策略 + one_report_per_comment 索引）。**切勿直接重跑该文件**；如需重建参考进程 #8 HANDOFF 附录 SQL。
3. **线上已改、源码待跟**：若重跑 `supabase-setup.mjs` 全量建表，`comments_select` 策略会自动使用修复后的版本。
4. **更正（进程 #2 核验）**：`.github/workflows/deploy.yml` **只部署 GitHub Pages，不部署 Worker**。Worker `wzsf-site-api` 手动 `wrangler deploy`（CLOUDFLARE_API_TOKEN 来自 `权限.txt`）。
5. **E2E 会产生测试数据**：跑完用 `网站/_cleanup_p4.mjs` + `网站/_cleanup5.mjs` 清理（`_prep_e2e.mjs` 可清投票/评论残留）。
6. **GoTrue 管理 API 怪癖**：用「已存在邮箱」POST `/auth/v1/admin/users` 返回 500。预置/重建用户请用 `_mkuser.mjs`（直插 DB），不要用 `_setup_e2e.mjs`。
7. **部署链路**：push main 触发 deploy.yml（GitHub Pages，cname=wzmssf.club）。Edge Function 不在 CI 内，需手动在 Supabase 控制台 Deploy。
8. **邮件服务**：`RESEND_FROM` 默认 `onboarding@resend.dev`，生产建议改为已验证发件人。
9. **E2E 预置用户**：`e2e_user_1786038139005@wzsf.local`（E2E测试员）、`e2e_admin_1786038169301@wzsf.local`（E2E管理员）已在库且 approved（**注意：uid 可能被并发进程重建，以 email 为准**）；如被误删用 `_mkuser.mjs user|admin` 重建。
10. 本地服务/E2E 依赖端口 8080；若 8080 被占用，E2E 脚本中的 base URL 需同步修改。

## 最后修改时间与标识

- 最后修改时间：2026-08-07
- 标识：**自动化 AI 进程 #9**（基于进程 #8 更新；E2E 40/41 确认无 Bug 基线；落地优化 O1-O4；修复 T9 测试竞态误报；提交推送 1b63aea）
- 测试基线：`_tmp/e2e_results.json`（40/41，进程 #9 终态）
- 待办钩子：① 邮件限流解除后重跑 E2E 确认 T6.1 恢复 PASS（历史波动数小时级）；② 后续 E2E 跑完清理测试数据（`_cleanup_p4.mjs` + `_cleanup5.mjs` + `_prep_e2e.mjs`）；③ 关注线上部署结果（1b63aea 推送后 GitHub Actions 自动部署）；④ 如遇测试数据异常消失，检查是否有并发进程重建了 e2e 用户。
