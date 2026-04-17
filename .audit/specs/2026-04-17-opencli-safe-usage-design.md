# OpenCLI 安全使用方案（路径 C 严格版）

**日期**：2026-04-17
**状态**：Draft — 待 jdy 审阅
**作者**：jdy（via brainstorming 会话）
**适用范围**：jdy 个人使用，下载小红书等登录站点批量媒体的最小信任部署

---

## 1. 目标与约束

### 1.1 首要用例

让 AI 批量下载小红书笔记中的图片/视频。相比 Claude in Chrome（LLM 逐张识别 + 浏览器下载）的分钟级延迟，opencli 的 `xiaohongshu download` 命令走**单次 `page.evaluate` + undici 并发直连**，典型 10 图笔记耗时 5–15 秒，快 2 个数量级。

### 1.2 次要用例（未来可能扩展）

- 其他登录站点的批量抓取（B 站/X/微博等）
- Electron 桌面应用控制（Cursor / Codex / Notion）
- 匿名 HTTP 站点的脚本化查询（arxiv / HN / wikipedia 等 19 个无扩展站）

### 1.3 安全约束

严格遵循 `/Users/jdy/.claude/CLAUDE.md` 第四章《依赖安全规则》：

- §4.1 版本锁定：所有直接依赖 exact 版本，禁止 `^` `~`
- §4.2 准入检查：所有直接依赖发布 ≥ 90 天（截止日 2026-01-17）
- §4.3 升级检查：未来升级按同规则
- §4.5 原因：防御 npm 供应链投毒（axios/plain-crypto-js 事件模式）

附加约束：

- 不依赖上游 GitHub Release ZIP（扩展自编）
- 不在日常 Chrome profile 里装扩展（隔离 profile）
- 允许主版本降级换取合规（undici v8 → v7.18.2、typescript v6 → v5.9.3）

### 1.4 不做范围（YAGNI）

- ❌ **不重写 opencli**：`xiaohongshu/download.js` 180 行里 80% 是反爬 trick，重写等于从头踩坑
- ❌ **不发布到 npm**：纯本地使用，不做公开 fork
- ❌ **不给扩展上 Chrome Web Store**：本地 load unpacked 够用
- ❌ **不自动化"自动跟进上游"**：每次上游 sync 都要手动审依赖，不值得自动化
- ❌ **不覆盖其他高敏站点的 profile**：小红书一个 profile 够用，其他站点有需要再开新 profile

---

## 2. 架构

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: Fork & 审计                                      │
│    github.com/ken-zy/OpenCLI  ← upstream: jackwener/opencli │
│    · 审计基线 commit: 0cd6356（feat: migrate academic …）    │
│    · 审 extension/src/ 1545 行 TS                           │
│    · 审 scripts/postinstall.js scripts/fetch-adapters.js   │
├──────────────────────────────────────────────────────────┤
│  Layer 2: 依赖合规化                                        │
│    package.json: 14 个直接依赖全 exact                       │
│    + overrides 强锁 7 个回退版本                            │
│    + renovate.json: minimumReleaseAge = 90d                │
│    + npm audit CI gate                                     │
├──────────────────────────────────────────────────────────┤
│  Layer 3: 运行时隔离                                        │
│    专用 Chrome profile: ~/.chrome-profiles/xhs             │
│    · 只登录小红书（不登其他站）                                │
│    · Load unpacked = 本地自编扩展 dist/                      │
│    · 日常浏览用另一个 profile（零扩展暴露）                     │
│    · Electron 应用通过独立 CDP 端口（9222-9232）              │
└──────────────────────────────────────────────────────────┘
```

**信任边界**：

| 信任对象 | 信任依据 |
|---------|---------|
| Node.js runtime | 本机已信 |
| npm registry | 行业默认信任 + integrity 校验 |
| opencli 源码 | 本地 git commit 锁死 + 人眼审阅关键路径 |
| 扩展源码 | 1545 行本地可审 + 自编自装 |
| 生产依赖 6 个 | 发布 ≥90 天 + 官方 org + 无 install scripts |
| 开发依赖 8 个 | 同上（构建机风险） |
| Chrome profile 会话 | 只有 xhs 一个站的 cookie 在 profile 里 |

**被主动放弃的信任**：

- GitHub Release ZIP（不用，自编）
- Chrome Web Store 审核（不适用，load unpacked）
- 上游 release.yml 第三方 Action 的 tag pin（不用，不跑其 CI）

---

## 3. 依赖版本锁定表

完整 `package.json` 依赖段（两部分 14 个全锁）：

```json
{
  "dependencies": {
    "cli-table3": "0.6.5",
    "commander": "14.0.2",
    "js-yaml": "4.1.1",
    "turndown": "7.2.2",
    "undici": "7.18.2",
    "ws": "8.19.0"
  },
  "devDependencies": {
    "@types/js-yaml": "4.0.9",
    "@types/node": "25.0.9",
    "@types/turndown": "5.0.6",
    "@types/ws": "8.5.13",
    "tsx": "4.19.3",
    "typescript": "5.9.3",
    "vitepress": "1.6.4",
    "vitest": "4.0.17"
  },
  "overrides": {
    "commander": "14.0.2",
    "turndown": "7.2.2",
    "undici": "7.18.2",
    "ws": "8.19.0",
    "@types/node": "25.0.9",
    "typescript": "5.9.3",
    "vitest": "4.0.17"
  }
}
```

每个回退的兼容性依据：

| 依赖 | 原 (install) | → 锁定 | 年龄 | 兼容性依据 |
|------|------------|-------|-----|-----------|
| `commander` | 14.0.3 (76d) | **14.0.2** | 173d | patch 降级；无 API 差异 |
| `turndown` | 7.2.4 (13d) | **7.2.2** | 174d | 两个 patch 降级；无 API 差异 |
| `undici` | 8.1.0 (3d) | **7.18.2** | 101d | 主版本降；opencli 只用 `Agent`/`EnvHttpProxyAgent`/`fetch`/`Dispatcher`，v6+ 稳定 |
| `ws` | 8.20.0 (26d) | **8.19.0** | 101d | minor 降；只用 `WebSocketServer`/`WebSocket`/`RawData`，全 8.x 稳定 |
| `@types/node` | 25.6.0 (7d) | **25.0.9** | 91d | 同 major x.0 回退；Node engines ">=21" |
| `typescript` | 6.0.3 (0d) | **5.9.3** | 198d | 主版本降；tsconfig 用 `target:ES2022 module:Node16`，未用 TS 6 特性 |
| `vitest` | 4.1.4 (8d) | **4.0.17** | 94d | minor 降；测试 API 稳定 |

---

## 4. 实施步骤

### Step 1: 验证 Fork 就绪 & 源码审计

fork 已完成（`ken-zy/OpenCLI` 本地在 `~/Documents/open_sources/opencli`）。

```bash
cd ~/Documents/open_sources/opencli

# 1.1 验证 remote 配置
git remote -v
# 应见:
#   origin    git@github.com:ken-zy/OpenCLI.git
#   upstream  git@github.com:jackwener/opencli.git

# 1.2 记录审计基线 commit（当前 fork HEAD）
git fetch --all
BASELINE=$(git rev-parse HEAD)
echo "$BASELINE" > .audit-baseline
git tag "audit-baseline-$(date +%Y-%m-%d)" "$BASELINE"
# 当前值: 0cd6356 (feat: migrate academic and policy adapters)
# 比扫描时的 upstream@02d637f 多一个 commit — 属于适配器迁移,
# 不触及 §7.1 🔴 高风险目录; Step 1.5 会再确认

# 1.3 扩展源码审计（1545 行）
wc -l extension/src/*.ts extension/popup.js
# 目标: 自己读过每一行，重点关注:
#   - extension/src/background.ts  握手/消息路由
#   - extension/src/cdp.ts           CDP 命令转发
#   - extension/src/identity.ts      身份校验

# 1.4 安装脚本审计
cat scripts/postinstall.js      # 仅装 shell completion + ~/.opencli 模板
cat scripts/fetch-adapters.js   # 清理本地 overrides（名字误导,其实不联网）
grep -E "preinstall|install" package.json   # 已确认: 只有 postinstall/preuninstall

# 1.5 审 baseline 相对上次扫描的 diff
git diff 02d637f..HEAD --stat -- \
  extension/ src/browser/ src/daemon.ts scripts/ package.json
# 如果只有 clis/ 改动, 基线可信度高; 如高风险目录变了, 需重审
```

### Step 2: 写合规版 package.json

```bash
# 2.1 用上面《依赖版本锁定表》中的完整 JSON 覆盖 package.json 相应段
# 2.2 提交锁定
git checkout -b security/lock-deps-90d
# 编辑 package.json ...
git add package.json
git commit -m "deps(security): exact-version lock all deps, rollback 7 pkgs to >=90d per local CLAUDE.md §4"
```

### Step 3: 清装 + 验证

```bash
# 3.1 清装
rm -rf node_modules package-lock.json
npm install --ignore-scripts    # 先不跑 postinstall
ls node_modules | wc -l         # 确认 .bin 装全

# 3.2 校验装入版本
npm ls --all --omit=dev | head -30
# 应见: undici@7.18.2, ws@8.19.0, commander@14.0.2, turndown@7.2.2 ...

# 3.3 合规再扫
node /tmp/check-dep-age.mjs     # 应见 14/14 都 OK

# 3.4 审计
npm audit --audit-level=moderate   # 预期 0 漏洞

# 3.5 允许 postinstall 执行（审过内容后）
npm rebuild
# 或: 完整重装 npm install

# 3.6 构建 + 测试
npm run build
npm test
npm run typecheck
```

### Step 4: 扩展自编

```bash
cd extension

# 4.1 审 extension 自己的依赖（独立的 package.json）
cat package.json | jq '.dependencies, .devDependencies'

# 4.2 对这份依赖同样跑年龄/锁定检查
cp /tmp/check-dep-age.mjs .
node check-dep-age.mjs
# 发现 <90d 包 → 同样在 extension/package.json 里加 overrides 降级
# 把所有 ^/~ 同样去掉

# 4.3 清装
rm -rf node_modules package-lock.json
npm install --ignore-scripts

# 4.4 构建
npm run build
ls -la dist/background.js     # 确认产物存在
```

### Step 5: 打包扩展 ZIP（通常不需要）

Load unpacked 直接指向 `extension/dist/` 目录即可加载，**不需要 ZIP**。
仅当跨机器分发给自己的另一台电脑时才需要：

```bash
cd extension
node scripts/package-release.mjs    # 或手动 zip dist/ + manifest.json + icons/
# 产物: opencli-extension-local.zip
```

### Step 6: 隔离 Chrome Profile

```bash
# 6.1 建专用 profile 目录
mkdir -p ~/.chrome-profiles/xhs

# 6.2 启动专用 profile (macOS)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir=$HOME/.chrome-profiles/xhs \
  --profile-directory=Default &

# 6.3 在该 Chrome 窗口里:
#     - 访问 chrome://extensions → 开 Developer mode
#     - Load unpacked → 选 extension/dist/ 目录
#     - 访问 xiaohongshu.com → 手动登录

# 6.4 验证扩展加载
opencli doctor
# 应看到: daemon OK, extension connected
```

### Step 7: 首次下载测试

```bash
# 7.1 找一篇小红书笔记，复制完整 URL（带 xsec_token）
# 7.2 下载
opencli xiaohongshu download 'https://www.xiaohongshu.com/explore/...?xsec_token=...' \
  --output ./xhs-test

# 7.3 验证产物
ls -la ./xhs-test/
# 应见: {noteId}/{noteId}_001.jpg 等
```

### Step 8: 配置 Renovate（长期维护）

在 fork 根目录新建 `renovate.json`：

```json
{
  "extends": ["config:recommended"],
  "minimumReleaseAge": "90 days",
  "rangeStrategy": "pin",
  "packageRules": [
    {
      "matchDepTypes": ["dependencies", "devDependencies"],
      "matchManagers": ["npm"],
      "minimumReleaseAge": "90 days",
      "automerge": false,
      "dependencyDashboard": true
    }
  ],
  "schedule": ["before 9am on monday"],
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 9am on the first day of the month"]
  }
}
```

**激活**：到 https://github.com/apps/renovate 给 `ken-zy/OpenCLI` 授权即可。Renovate 会每周一早自动扫描，只对 ≥90 天的版本开 PR。

### Step 9: 日常流程

```bash
# 下载一篇
opencli xiaohongshu download <url> --output ./out

# 批量（脚本）
cat notes.txt | while read url; do
  opencli xiaohongshu download "$url" --output ./batch
done

# daemon 状态
opencli daemon status
opencli daemon stop           # 用完停掉，不常驻
```

### Step 10: 上游跟进

完整策略见 **§7 上游跟进策略**（含节奏、订阅、决策框架、紧急响应、季度复审、冻结条件）。

首次 sync 前，先完成 Step 1–9。后续节奏不再是"实施步骤"，而是持续维护。

---

## 5. 验收标准

| # | 验收项 | 命令/方法 |
|---|--------|---------|
| 1 | package.json 无 caret/tilde | `grep -E '\^\|~' package.json` 返回空 |
| 2 | 所有依赖 ≥90 天 | `node /tmp/check-dep-age.mjs` 全部 OK |
| 3 | 0 npm audit 漏洞 | `npm audit --audit-level=low` |
| 4 | 类型检查通过 | `npm run typecheck` 退出 0 |
| 5 | 测试通过 | `npm test` 退出 0 |
| 6 | 构建产物存在 | `ls dist/src/main.js` |
| 7 | 扩展自编产物存在 | `ls extension/dist/background.js` |
| 8 | 隔离 profile 只登录 xhs | `ls ~/.chrome-profiles/xhs` + Chrome 里人工确认 |
| 9 | 首次下载成功 | `opencli xiaohongshu download <url>` 产出 .jpg |
| 10 | daemon 只听 127.0.0.1 | `lsof -i :19825` 显示 `LISTEN` 且 host 是 127.0.0.1 |
| 11 | 性能达标（首要目标） | 10 图笔记下载 < 30 秒（宽松门槛；典型应在 5-15 秒） |

---

## 6. 剩余风险登记

| 风险 | 概率 | 影响 | 缓解 |
|------|-----|------|-----|
| npm registry 被攻（>90 天老版本也被重签） | 极低 | 高 | integrity 校验已锁 sha512；无力进一步 |
| 扩展代码里漏审一处后门 | 低 | 高 | 1545 行可读完；后续 upstream sync 每次 diff |
| Chrome profile 被其他本机进程翻（xhs cookie 泄露） | 低 | 中 | macOS 用户目录默认隔离；不装本机未知软件 |
| opencli daemon 被本机恶意进程连 19825 | 低 | 中 | Origin/X-OpenCLI header CSRF 已防；但本机进程可伪造 |
| Renovate 推荐的新版本刚好 90 天但被投毒 | 中 | 高 | 人工 review 每个 PR，不 automerge |
| 小红书反爬变更导致命令坏掉 | 高 | 低 | 上游 sync 时重跑测试；必要时 fork 里打 patch |
| TypeScript 5.9 → 6 未来不可避免时升级 | 中 | 低 | 到时再评估；tsconfig 保守可能自然兼容 |

---

## 7. 上游跟进策略

opencli 是活跃维护的上游项目（近期每周都有 commit），跟进不当就会陷入两端：**跟太紧** → 频繁遭遇 <90 天新版本，overrides 膨胀；**跟太松** → 错过安全修复，适配器和反爬规则失效。以下是分级策略。

### 7.1 按目录差异化（核心思路）

不同目录对安全的影响不同，跟进强度也不同：

| 目录/文件 | 风险 | 跟进方式 | 触发"高度警觉"的变化 |
|----------|-----|---------|---------------------|
| `extension/src/`, `extension/manifest.json` | 🔴 高 | diff 必读 | permissions 新增、新 service worker 事件、新消息类型 |
| `src/browser/`, `src/daemon.ts` | 🔴 高 | diff 必读 | 新 HTTP/WS 端点、CSRF 防御放宽、监听端口从 127.0.0.1 外扩 |
| `scripts/`, `package.json` | 🟡 中 | diff 必读 | 新 lifecycle script（preinstall/install/postinstall）、依赖 maintainer 变更 |
| `src/` 其他（CLI/适配器框架） | 🟢 低 | 扫过 | 大版本标签变更时精读 |
| `clis/<具体站>/` | 🟢 低 | **按需 cherry-pick** | 只合并你实际用的站点 |
| `docs/`, `website/`, `*.test.ts`, `*.md` | ⚪ 忽略 | 跳过 | — |

**含义**：不做"全仓 `git merge upstream/main`"。做的是"选择性拉取 + 强审高风险目录"。

### 7.2 订阅与提醒（一次性配置）

**GitHub 被动订阅**：

```
1. https://github.com/jackwener/opencli
   → Watch → Custom → ☑️ Releases ☑️ Security alerts
2. https://github.com/jackwener/opencli/security/advisories
   → Watch
```

**主动检查脚本**（写到 fork 根目录 `scripts/upstream-check.sh`）：

```bash
#!/usr/bin/env bash
# 评估上游变化，不做修改，纯报告
set -e
cd "$(dirname "$0")/.."

git fetch upstream --tags --quiet
CURRENT=$(cat .audit-baseline)
NEW=$(git rev-parse upstream/main)

[ "$CURRENT" = "$NEW" ] && echo "✅ 无更新" && exit 0

COMMITS=$(git rev-list --count "$CURRENT..$NEW")
echo "⚠️  $COMMITS 个新 commit (baseline → upstream/main)"

echo ""
echo "=== 🔴 高风险目录 ==="
git diff --stat "$CURRENT..$NEW" -- \
  extension/ src/browser/ src/daemon.ts src/daemon-client.ts \
  scripts/ package.json package-lock.json \
  .github/workflows/ 2>/dev/null | tail -20

echo ""
echo "=== 🟢 适配器变化（按站点分组）==="
git log --name-only --format="" "$CURRENT..$NEW" -- clis/ 2>/dev/null \
  | awk -F/ '/^clis\//{print $2}' | sort -u | head -30

echo ""
echo "=== Tags / Releases ==="
git tag --contains "$CURRENT" | head -5
command -v gh >/dev/null && gh release list --repo jackwener/opencli --limit 3 2>/dev/null

echo ""
echo "=== Security Advisories (GitHub) ==="
command -v gh >/dev/null && gh api repos/jackwener/opencli/security-advisories 2>/dev/null | head
```

**运行节奏**：手动每周一跑一次，或用 macOS `launchd` 定时（不喜欢定时的话，订阅邮件触发）。

### 7.3 Sync 决策三问（每次跑完检查脚本后）

按顺序问：

**Q1：有 CVE / Security Advisory 吗？**
- 是 → 走 **§7.4 紧急响应**（可能豁免 90 天）
- 否 → Q2

**Q2：🔴 高风险目录有动吗？**
- 是 → **完整 diff + 人眼审**，按 §7.5 半自动 sync
- 否 → Q3

**Q3：只是 `clis/` 适配器或纯文档？**
- 是 → **只 cherry-pick 你用到的站点** (§7.6)
- 否 → 按 §7.5

### 7.4 紧急 CVE 响应

上游发 CVE（罕见）时的流程：

```bash
# 1. 看清楚 CVE 影响面
gh api repos/jackwener/opencli/security-advisories

# 2. 只取修复 commit（不全量 merge）
git fetch upstream
git log upstream/main --oneline --grep="CVE\|security\|fix vuln" | head
git cherry-pick <fix-commit-sha>

# 3. 如果修复依赖某个新版本 <90 天:
#    评估 CLAUDE.md §4.4 豁免 — "安全补丁紧急场景" 符合豁免条件
#    但仍要做 §4.2 第 1/4/5 项检查:
#      - 包身份无 typosquat
#      - lifecycle scripts 审阅
#      - integrity 已锁

# 4. 重建 + 验收（§5 的 11 条）
rm -rf node_modules package-lock.json && npm install
npm run build && npm test

# 5. 更新 baseline
git rev-parse HEAD > .audit-baseline
git add . && git commit -m "security: cherry-pick CVE fix from upstream@<sha>"
```

### 7.5 半自动 sync（高风险目录有变动时）

```bash
cd ~/Documents/open_sources/opencli
git checkout -b sync/$(date +%Y-%m-%d)
git fetch upstream

# 先人眼过一遍
./scripts/upstream-check.sh

# 再完整 diff 高风险目录
git diff "$(cat .audit-baseline)..upstream/main" -- \
  extension/ src/browser/ src/daemon.ts scripts/ package.json \
  | less

# 合并（package.json 冲突是预期的 — 保留你的 exact 版本）
git merge upstream/main
# 冲突解决原则:
#   - dependencies/devDependencies → 保留你的 exact 版本
#   - 新增的依赖 → 跑 check-dep-age.mjs 判断是否能装
#   - overrides 整段 → 保留你的不变

# 重新检查依赖
node /tmp/check-dep-age.mjs
# 若 upstream 引入了新 <90d 包 → 加到 overrides

# 完整重装 + 验收
rm -rf node_modules package-lock.json
npm install
npm audit --audit-level=moderate
npm run typecheck && npm run build && npm test

# 更新 baseline + tag
git rev-parse upstream/main > .audit-baseline
git add . && git commit -m "sync: upstream@$(git rev-parse --short upstream/main)"
git tag "audit-$(date +%Y-%m-%d)"
```

### 7.6 适配器 cherry-pick（只合并你用的站点）

```bash
# 例: 只合并小红书适配器的更新
git fetch upstream
git log upstream/main --oneline -- clis/xiaohongshu/ | head -20
git cherry-pick <commit-sha>

# 如果 cherry-pick 出错（因为依赖了上游的核心改动）:
#   说明这个适配器改动跟框架耦合,不能单拿,只能走 §7.5 全量 sync
```

**好处**：不用的站点（比如你从不用 FB/IG/抖音）的代码永远不进你的 fork，**攻击面最小化**。

### 7.7 依赖升级（Renovate 驱动）

Renovate 每周一自动扫，**只对 ≥90 天的版本开 PR**（§Step 8 的配置已保证）。人工处理每个 PR：

1. 看 Renovate 贴的 release notes
2. 检查 maintainer 是否变更：
   ```bash
   npm view <pkg>@<new-ver> maintainers
   npm view <pkg>@<old-ver> maintainers
   diff <(echo "$OLD") <(echo "$NEW")
   ```
3. 跑 CI（fork 里放一个 `.github/workflows/ci.yml` 做 typecheck + test + audit）
4. 合并或关闭

### 7.8 季度强制复审（3/31、6/30、9/30、12/31）

```bash
# 1. 重扫依赖年龄（overrides 里的包可能已 "解冻"）
node /tmp/check-dep-age.mjs

# 2. 审扩展源码总行数增长
wc -l extension/src/*.ts
# 基线 (2026-04-17): 1545 行
# 增长 > 50% 时,重读一遍全部扩展代码

# 3. 审 lifecycle scripts 新增
grep -E "preinstall|install|postinstall" package.json extension/package.json

# 4. 审 maintainers 变更
for pkg in cli-table3 commander js-yaml turndown undici ws; do
  echo "=== $pkg ==="
  npm view $pkg maintainers
done
```

### 7.9 冻结条件（停止跟进）

出现以下任一情况，**停止 sync，继续用当前 fork**：

- 上游新增依赖无法回退到 >90 天版本且持续半年不达标
- 上游扩展 `manifest.json` 新增权限（特别是 `webRequest` / `proxy` / `privacy` / `management`）
- 上游 maintainer 变更为未知身份
- 上游仓库 archive / deprecated

这不是"弃用"，是"保持现状用"。fork 已是独立可运行产物，冻结等同于锁定在**当前审计过的版本**——这恰恰是安全的"更好状态"。

---

## 8. 未来扩展路径

| 需求触发 | 动作 |
|---------|-----|
| 想加 B 站/X 等站点 | 新建独立 profile `~/.chrome-profiles/<site>`，同扩展，只登该站 |
| 想操作 Cursor/Codex | 启动 `Cursor --remote-debugging-port=9226`；**不需要扩展** |
| 想批量查 arxiv/HN | `opencli arxiv search ...`；**不需要扩展** |
| 每 3 个月复审到期 | 重跑 `node /tmp/check-dep-age.mjs`；把可升的升，把坏的替 |
| 上游跳了 typescript 到 6.x 且回不去 | 评估是否需要；或保留自己的 typescript 5.x 锁 |

---

## 9. 需要 jdy 决策的开放项

1. **Fork 可见性**：fork 到公开仓库还是 private？（推荐 private，少惹麻烦）
2. **是否接入 Renovate**：会 commit 到 `ken-zy/OpenCLI` 分支，个人仓库 OK 吗？
3. **`@types/node` 25.0.9 vs 24.10.9**：都 91–93 天，哪个更合适？（25 对应 Node 25，24 对应 Node 24；opencli 只要求 >=21）
4. **`.audit/` 目录如何 commit**？已迁至 `.audit/specs/` + `.audit/reports/`，选项：3a commit 到 main+push / 3b 新分支 `audit/initial-review` 不 push / 3c 暂不 commit
5. **首次 E2E 验证要不要我陪跑**？（一起 debug 小红书 URL 提取的边角案例）
6. **上游跟进节奏偏好**：每周主动跑 `upstream-check.sh` / 纯被动等 GitHub Watch 邮件 / 两者结合？
7. **适配器策略**：是默认 cherry-pick（最小攻击面）还是全量 sync（省事但 `clis/` 下有大量未用的代码）？

---

## 附录 A：关联材料

- 安全审计报告：`.audit/reports/20260417-130748.json`（源头 `.gstack/security-reports/` 由 cso skill 生成）
- CLAUDE.md §4：`/Users/jdy/.claude/CLAUDE.md` 依赖安全规则
- OpenCLI 源码：`src/node-network.ts`（undici 使用）、`src/daemon.ts` + `src/browser/cdp.ts`（ws 使用）、`src/cli.ts`（commander 使用）
- 扩展源码：`extension/src/background.ts` 935 行、`cdp.ts` 446 行、`protocol.ts` 93 行、`identity.ts` 71 行
- 小红书适配器：`clis/xiaohongshu/download.js` 180 行

## 附录 B：依赖速览

生产直接 6 + 传递 7 = 13 个运行时包：
```
cli-table3 → string-width → [emoji-regex, is-fullwidth-code-point, strip-ansi → ansi-regex]
commander (0 deps)
js-yaml → argparse
turndown → @mixmark-io/domino
undici (0 deps)
ws (0 deps)
```

所有 13 个生产包的 `hasInstallScript` 均为 `false`，无 preinstall/install/postinstall 钩子。
