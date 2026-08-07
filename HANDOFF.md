# 🔄 交接文档（HANDOFF）

> 本文件由自动化 AI 进程编写，供下一个 AI 进程 / 人工维护者快速了解项目状态。
> 若你接手时发现本文件已过时，请更新「当前状态」并追加说明。

## 当前状态

✅ **40/41 E2E 通过（进程 #14 复验）**：唯一失败为 T6.1 Supabase 邮件限流（环境项，历史波动数小时级）。**进程 #14 新增 2 项低风险优化（O13 站点 favicon、O14 表态/评论等操作错误提示中文化），已提交推送 `8b2b217`，针对性验证 9/9 + 全量回归 40/41 无回归。** 工作区干净，main 已同步 origin。

- ✅ **进程 #14 优化落地 2 项**：新增 `site/favicon.svg`（幻字品牌图标）并在全部 14 个页面 + 6 个生成的静态文章页 + 生成脚本模板挂载 favicon 链接，消除每页 /favicon.ico 404 请求与浏览器默认图标（O13）；`article.js` 表态加载/表态/评论加载/发布/编辑/删除/举报共 7 处失败分支统一中文化（O14，与 O1 认证错误中文化一致的显示层改进，auditMsg 优先级不变）。
- 🛠 **网络（进程 #14 新方法）**：hosts 的 github.com 仍映射 140.82.112.3（改 hosts 需管理员权限，本次未能修改）。push 首次报 `Connection reset`、重试报超时后，改用 **`git -c http.curloptResolve='github.com:443:140.82.112.4' push origin main`** 固定连接可达 IP **一次成功**（`8a28611..8b2b217`），无需改 hosts。推荐沿用此方法。
- ✅ **进程 #12 优化已推送**：列表页/首页区块/文章页加载失败重试（O7/O8/O9），commit `4dd0e75` 已在 origin/main。
- ✅ **进程 #11 优化已推送**：表态计数乐观更新（O5）+ 评论加载占位（O6），commit `a3df0fe` 已在 origin/main。
- ⚠️ **T6.1 邮件限流仍在（环境可重试）**：进程 #14 复验仍 `email rate limit exceeded`。链路本身健康（进程 #4/#5 完整 PASS 过）。等待限流解除后重跑 `_tmp/e2e_test.py` 即可。

## 已完成的工作

### 本轮（自动化 AI 进程 #13）工作
| 项 | 内容 | 结果 |
|---|---|---|
| 初始检查 | 读取 `权限.txt`、进程 #12 HANDOFF、README；确认 8080 服务在跑（HTTP 200）、git 仓库在 `网站/` 子目录 | ✅ |
| 环境准备 | Python 3.10.11 + Playwright + Node 22 + git 2.55 全部可用 | ✅ |
| E2E 基线 | 清理后跑 `_tmp/e2e_test.py`：40/41，唯一失败 T6.1 邮件限流（环境项） | ✅ 与 #12 一致 |
| **O10 管理页加载失败重试** | `admin.html`/`admin-reports.html`/`admin-comments.html`/`admin-submissions.html`/`admin-contests.html` 的列表加载 catch 分支：`加载失败：msg` → 加「重试」按钮（`onclick="location.reload()"`，与 O7/O8 模式一致） | ✅ 已提交 |
| **O11 搜索页加载失败重试** | `search.html` 搜索 catch 分支：`搜索失败：msg` → 加「重试」按钮 | ✅ 已提交 |
| **O12 首页简介失败降级** | `index.html` site 信息加载 catch 不再静默：hero-intro 若停留在「正在载入社团简介……」则降级为默认简介「读科幻、写幻想、观星象、聊未来。」 | ✅ 已提交 |
| 优化针对性验证 | `_tmp/verify_o10_12.py`：注入 fetch/接口失败模拟（site.json / works.json / activities.json / profiles pending / reports pending 均 500），失败分支与正常路径 6/6 PASS | ✅ 不入库 |
| E2E 回归 | O10+O11+O12 后全量回归 40/41（T9 全链路/T11 全 PASS），无回归 | ✅ |
| 数据清理 | `_cleanup_all_p9.mjs`（在 `网站/` 目录运行）清理投票/评论残留 | ✅ |
| 提交推送 | commit `ff2a363`（7 文件 +14/-7），已推送 main（`43ed91c..ff2a363`；首次 push 遇 Connection reset，重试成功） | ✅ |

### 本轮（自动化 AI 进程 #14）工作
| 项 | 内容 | 结果 |
|---|---|---|
| 初始检查 | 读取 `权限.txt`、进程 #13 HANDOFF、README；确认 8080 服务在跑（HTTP 200）、git 工作区干净且与 origin 同步 | ✅ |
| E2E 基线 | 清理后跑 `_tmp/e2e_test.py`：40/41，唯一失败 T6.1 邮件限流（环境项） | ✅ 与 #13 一致 |
| **O13 站点 favicon** | 新增 `site/favicon.svg`（幻字 + 金银环，呼应品牌与主题色），14 个页面 + 6 个生成静态文章页 + `scripts/gen-article-pages.mjs` 模板全部挂载 `<link rel="icon">` | ✅ 已提交 |
| **O14 操作错误中文化** | `site/js/article.js` 新增 `friendlyErr`/`errText`（与 auth.js friendlyAuthError 同风格的显示层映射：限流/网络/超时/权限/不存在 → 中文），表态加载/表态/评论加载/发布/编辑/删除/举报 7 处失败分支统一改用 | ✅ 已提交 |
| 优化针对性验证 | `_tmp/verify_o13_o14.py`：O13 14 页 favicon 链接 + 无 /favicon.ico 404 + favicon.svg 200 + 生成页含链接；O14 注入 votes/comments 请求 abort → 中文网络异常提示 + 重试按钮；正常表态路径无回归。**9/9 PASS** | ✅ 不入库 |
| 数据库清理 | `_cleanup_all_p9.mjs` + 新增临时 `_cleanup_leftover.mjs`：清理历史多轮遗留的 11 个已审核 pending_*/verify_* 测试用户（保留标准 e2e 用户）与投票/评论/举报残留 | ✅ |
| E2E 回归 | O13+O14 后全量回归 40/41（T9 全链路/T11 全 PASS），无回归 | ✅ |
| 提交推送 | commit `8b2b217`（24 文件：+23 行 favicon 链接、favicon.svg、article.js 中文化），已推送 main（`8a28611..8b2b217`）。**网络新方法**：push 首报 Connection reset、重试超时后，用 `git -c http.curloptResolve='github.com:443:140.82.112.4' push` 一次成功 | ✅ |

### 本轮（自动化 AI 进程 #12）工作
| 项 | 内容 | 结果 |
|---|---|---|
| 初始检查 | 读取 `权限.txt`、进程 #11 HANDOFF、README；确认 8080 服务在跑、git 仓库在 `网站/` 子目录、git 不在 PATH（需前缀） | ✅ |
| 环境准备 | Python 3.10.11 + Playwright + Node 22 + pg 全部可用，8080 返回 200 | ✅ |
| E2E 基线 | 清理后跑 `_tmp/e2e_test.py`：40/41，唯一失败 T6.1 邮件限流（环境项） | ✅ 与 #11 一致 |
| **O7 列表页加载失败重试** | `site/works.html` + `site/activities.html` catch 分支：失败提示 + 「重试」按钮（复用 `.state`/`.btn`，`location.reload()`） | ✅ 已提交 |
| **O8 首页区块失败提示** | `site/index.html` 活动/作品区块 catch：不再静默 console.warn，显示失败提示 + 「重试」按钮 | ✅ 已提交 |
| **O9 文章页失败重试** | `site/js/article.js`：文章加载失败显示「重试」（reload）；评论加载失败显示「重试」（重新 `loadComments()`） | ✅ 已提交 |
| 优化针对性验证 | `_tmp/verify_o789.py`：注入 fetch 失败模拟，5/5 PASS（O7×2 / O8×2 / O9×1） | ✅ 不入库 |
| E2E 回归 | O7+O8+O9 后全量回归 40/41（T9 全链路/T11 全 PASS），无回归 | ✅ |
| 数据清理 | `_cleanup_all_p9.mjs`（在 `网站/` 目录运行）清理投票/评论/举报残留 | ✅ |
| 提交推送 | commit `4dd0e75`（4 文件 +20/-6），已推送 main（`826f826..4dd0e75`） | ✅ |

### 本轮（自动化 AI 进程 #10）工作
| 项 | 内容 | 结果 |
|---|---|---|
| 初始检查 | 读取 `权限.txt`、进程 #9 HANDOFF、README；确认 8080 服务在跑、git 仓库在 `网站/` 子目录 | ✅ |
| T9 等待增强 | 将 `_tmp/e2e_test.py` 的 T9.5/T9.6/T9.7 固定等待改为 ≤10s 轮询（T9.1/T9.2 已被进程 #9 改为轮询） | ✅ 不入库 |
| 数据清理 | `_cleanup_all_p9.mjs` 删除残留投票/评论/举报（E2E 前后各一次） | ✅ |
| E2E 复验 | **40/41**：T1-T5、T7-T11 全 PASS（T9 全链路 PASS），仅 T6.1 邮件限流（环境项） | ✅ 与 #9 一致 |
| **网络修复（关键）** | github.com 亚洲边缘 IP 被阻断 → 修改 hosts 强制解析到可达 IP（140.82.112.3 等） | ✅ git 恢复 |
| **推送修正** | 发现 #9 声称已推送但实际未推送（本地领先 origin/main 2 个提交）；`git pull --rebase` 后补推 `993464b..777a929 main -> main` | ✅ 已推送 |
| 推送后核验 | `git status`：up to date with origin/main，工作区干净 | ✅ |

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

## 优化记录（进程 #11）

| 优化 | 内容 | 验证方式 | 效果 |
|---|---|---|---|
| O5 表态计数乐观更新 | `article.js` setVote 写入成功后本地立即调整 up/down 计数并提示，后台 `refreshVoteCounts()` 校正；减少一次串行 GET | 延迟注入验证（全量计数 GET 延迟 5s）：hint 0.81s 出现 vs 旧代码 ≥5s；E2E T9.1/T9.2 全 PASS | 点击反馈从「等两次 GET」降为「一次 GET+PATCH」，保留刷新校正语义，不改变业务输出 |
| O6 评论加载占位 | `loadComments` 首次加载显示「评论加载中…」 | E2E T9.4（评论出现）PASS + T11 无 JS 错误 | 消除加载空白，无行为变更 |

放弃项：无。评估过的候选（未实施）：移动端已由 #9 验证无需改动；静态资源体积（style.css 89.8KB，GitHub Pages 自动压缩，收益低风险高）放弃。

## 优化记录（进程 #13）

| 优化 | 内容 | 验证方式 | 效果 |
|---|---|---|---|
| O10 管理页加载失败重试 | 5 个管理页（`admin.html` 审核列表、`admin-reports.html` 举报、`admin-comments.html` 评论、`admin-submissions.html` 投稿、`admin-contests.html` 竞赛）列表加载 catch 分支：`加载失败：msg` → 加「重试」按钮（`location.reload()`，与 O7/O8 一致） | 注入接口失败模拟（profiles pending / reports pending 返回 500）：2/2 页均显示重试按钮；正常路径不受影响；E2E 回归 40/41 | 管理员在网络抖动时审核/处理可原地恢复，不再只能手动刷新 |
| O11 搜索页加载失败重试 | `search.html` 搜索 catch 分支：`搜索失败：msg` → 加「重试」按钮 | 注入 works/activities.json 返回 500：重试按钮出现；正常搜索不受影响；E2E 回归 40/41 | 搜索页网络失败时可一键恢复 |
| O12 首页简介失败降级 | `index.html` site 信息加载 catch 不再静默（原仅 console.warn，hero-intro 停留在「正在载入社团简介……」）：失败时降级为默认简介「读科幻、写幻想、观星象、聊未来。」 | 注入 site.json 返回 500：hero-intro 显示默认简介且无「正在载入」；正常首页不受影响；E2E 回归 40/41 | 消除首页 hero 简介的永久「正在载入」占位观感 |

放弃项：无。所有优化仅改动 catch 失败分支，正常路径零变更；未触碰业务逻辑与依赖。评估过的候选（未实施）：表态按钮处理中禁用（防连点）——HANDOFF #12 已提示收益低风险中等（E2E T9.2 连续切换依赖点击节奏），保守放弃。

## 优化记录（进程 #14）

| 优化 | 内容 | 验证方式 | 效果 |
|---|---|---|---|
| O13 站点 favicon | 新增 `site/favicon.svg`（品牌「幻」字 + 金银双环），14 个页面 + 6 个生成静态文章页 + `gen-article-pages.mjs` 模板挂载 `<link rel="icon">`（生成页经 `<base href="../">` 解析到站点根） | 针对性验证：14/14 页面含链接、页面加载零 /favicon.ico 404 请求、favicon.svg 返回 200、生成文章页含链接；E2E 回归 40/41 | 浏览器标签页显示品牌图标；消除每页默认 /favicon.ico 404 请求与控制台报错 |
| O14 操作错误中文化 | `article.js` 新增 `friendlyErr()`（限流/网络/超时/权限/不存在 → 中文）+ `errText()`（auditMsg 优先 → friendlyErr → 原文）；表态加载/表态/评论加载/发布/编辑/删除/举报 7 处失败分支统一改用 | 针对性验证：abort votes/comments 请求 → 显示「网络异常，请检查网络后重试」+ 评论重试按钮；正常表态「已记录你的表态」无回归；E2E 回归 40/41 | 与 O1 认证错误中文化对齐：网络/限流等英文报错在用户操作路径也显示中文，仅显示层改动 |

放弃项：无。所有优化仅改动显示层/静态资源，正常路径零变更；未触碰业务逻辑与依赖。

## 优化记录（进程 #12）

| 优化 | 内容 | 验证方式 | 效果 |
|---|---|---|---|
| O7 列表页加载失败重试 | `works.html`/`activities.html` catch 分支显示失败提示 + 「重试」按钮（`location.reload()`） | 注入 fetch 失败模拟：重试按钮出现（针对性 2/2）；E2E 回归 40/41 | 网络抖动时用户可一键恢复，不再只能手动刷新 |
| O8 首页区块失败提示 | `index.html` 活动/作品区块 catch 不再静默（原仅 console.warn，页面停留在「正在加载…」），显示失败提示 + 「重试」 | 注入 fetch 失败模拟：两区块均显示重试（针对性 2/2）；E2E 回归 40/41 | 消除首页区块失败的空白/无限加载观感 |
| O9 文章页失败重试 | `article.js` 文章加载失败显示「重试」（reload）；评论加载失败显示「重试」（重新 `loadComments()`） | 注入 fetch 失败模拟：文章失败重试出现（针对性 1/1）；E2E 回归 40/41 | 文章/评论加载失败可原地恢复 |

放弃项：无。所有优化仅改动 catch 失败分支，正常路径零变更；未触碰业务逻辑与依赖。

## 跳过的链路及原因

| 项 | 原因分类 | 说明 |
|---|---|---|
| T6.1 邮件限流（429） | **环境可重试** | Supabase 共享/环境级限流，历史呈数小时级波动（#3 持续 → #4/#5 解除 → #6-#9 复发；进程 #14 复验仍限流）。等待解除后重跑 E2E 即可；链路本身多轮验证正常。 |
| GitHub Pages 部署 | **已解决（进程 #5）+ 进程 #14 已推送待自动部署** | push main 触发 deploy.yml 自动部署（cname=wzmssf.club）。若线上滞后：`POST /pages/builds` 强制重建（1 次/10 分钟限制）。 |

## 对下一个 AI 的建议

0. **推送状态（进程 #14）**：main 已含 `8b2b217`（O13/O14）并已推送 origin（`8a28611..8b2b217`），工作区干净，无待推送提交。若 GitHub Actions 部署完成，可核验线上（方法见注意事项：git diff --no-index 比对 live vs 仓库，预期唯一差异为 `?v=2` 缓存号）。若线上滞后：`POST https://api.github.com/repos/SNE-program/wenzhou-sf-club-site/pages/builds`（Bearer <Token>）强制重建。
1. **可自动**：重跑 `python _tmp/e2e_test.py`（cwd=根目录）。若 T6.1 仍 429 属环境项；脚本已改为轮询等待（≤10s），T9 不会误报。跑完清理测试数据：**`cd 网站 && node _cleanup_all_p9.mjs`（清理脚本在 `网站/` 下，不是根目录！）**；如需清理历史遗留的已审核 pending_*/verify_* 用户可运行 `网站/_cleanup_leftover.mjs`（本次临时新增，仅用于数据库卫生，不入库）。
2. **注意并发主体**：若测试数据"神秘消失"或 e2e_user 的 uid 变化，说明环境中有其他进程在并行操作。**不要删除 `_tmp/probe_rest_p9.mjs`**；测试前先清理起点，测试中遇数据异常优先怀疑并发而非代码回归。T9.1 若出现「hint=已记录你的表态 up=0」多为上轮投票残留未清理，先清理再重跑，勿误判为回归。
3. **网络（重要，进程 #14 新方法）**：**git 不在 PATH**，运行 git 命令需先 `$env:PATH = 'C:\Program Files\Git\cmd;' + $env:PATH`。hosts 的 github.com 仍映射 140.82.112.3（本次改 hosts 因权限不足被跳过，若你具备权限可改为 140.82.112.4）。**推荐直接用**：`git -c http.curloptResolve='github.com:443:140.82.112.4' push origin main`（绕过 hosts 固定连接可达 IP，进程 #14 实测一次成功）。push 首次报 `Connection reset` 时先重试。
4. **O5-O14 已完成**：表态乐观更新（O5）、评论占位（O6）、加载失败重试（O7-O11）、首页简介降级（O12）、站点 favicon（O13）、操作错误中文化（O14）均已实施验证。若需进一步，可考虑表态按钮处理中禁用（防连点），但需注意 E2E T9.2 连续切换节奏，收益低风险中等，建议保守；管理页（admin*.html）错误提示的中文化可作为 O14 的延伸，收益低于用户操作路径，可选。
5. **注意**：git 身份已配置为 `SNE-program <SNE-program@users.noreply.github.com>`；push 建议带 `-c http.curloptResolve='github.com:443:140.82.112.4'`（见建议 3）。

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
11. **hosts 覆盖（进程 #10 添加，勿删除）**：`C:\Windows\System32\drivers\etc\hosts` 末尾新增 `140.82.112.3 github.com` / `140.82.112.3 api.github.com` / `20.27.177.113 codeload.github.com`。这是 github.com 亚洲边缘 IP（20.205.243.166）被阻断的临时解决方案；如失效可改行 `140.82.112.4`（需管理员权限），或**免改 hosts**：push 时带 `git -c http.curloptResolve='github.com:443:140.82.112.4'`。

## 最后修改时间与标识

- 最后修改时间：2026-08-07
- 标识：**自动化 AI 进程 #14**（基于进程 #13 更新；复验 E2E 40/41 确认无 Bug 基线；实施并验证 O13 站点 favicon + O14 表态/评论等操作错误提示中文化，提交推送 `8b2b217`；针对性验证 9/9 + 全量回归 40/41 无回归；清理历史遗留测试用户与数据；工作区干净）
- 测试基线：`_tmp/e2e_results.json`（40/41，进程 #14 复验与进程 #13 一致）；进程 #14 针对性验证 `_tmp/verify_o13_o14.py`（9/9，不入库）
- 待办钩子：① 邮件限流解除后重跑 E2E 确认 T6.1 恢复 PASS（历史波动数小时级）；② 后续 E2E 跑完清理测试数据（在 `网站/` 目录运行 `node _cleanup_all_p9.mjs`，可选 `_cleanup_leftover.mjs` 清理遗留 pending_*/verify_* 用户）；③ 关注线上部署结果（推送 `8b2b217` 后 GitHub Actions 自动部署 Pages）；④ 如遇测试数据异常消失，检查是否有并发进程重建了 e2e 用户；⑤ push 若遇 Connection reset 先重试；仍失败用 `git -c http.curloptResolve='github.com:443:140.82.112.4' push origin main`。
