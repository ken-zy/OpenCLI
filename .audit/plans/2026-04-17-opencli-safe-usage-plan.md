# OpenCLI 安全使用方案 — 实施计划

> **给执行者**：推荐使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 来逐 task 执行。步骤用 `- [ ]` checkbox 标记进度。

**Goal**：在 `ken-zy/OpenCLI` fork 上完成依赖合规化 + 扩展自编 + 隔离 Chrome profile，首次成功跑通 `opencli xiaohongshu download`，端到端耗时 < 30 秒。

**Architecture**：三层防御 — (Layer 1) Fork 审计锁 baseline commit；(Layer 2) `package.json` 14 个依赖全 exact + overrides 回退 7 个 <90 天包；(Layer 3) 专用 Chrome profile 隔离小红书 cookie，扩展从源码自编。

**Spec**：`.audit/specs/2026-04-17-opencli-safe-usage-design.md`

**Tech Stack**：Node.js ≥21 / TypeScript 5.9.3 / undici 7.18.2 / ws 8.19.0 / Chrome + MV3 扩展 / Renovate bot / Git

---

## Phase 0 — 前置决策（解锁后续 Phase）

**这些决策影响后续 task 的具体内容。如果默认推荐值 OK，跳到 Phase 1；否则在执行前告知调整。**

### Task 0.1: 锁定 §9 开放项的默认值

**Files**: 无文件改动

- [ ] **Step 1: 审阅并确认/调整以下 7 个默认值**

| # | 决策项 | **默认推荐值** | 理由 |
|---|--------|--------------|------|
| 1 | Fork 可见性 | **private** | 个人用，少惹麻烦；如需对外贡献改 public |
| 2 | `.audit/` commit 策略 | **3b**（新分支 `audit/initial-review`，不 push） | 保留审计轨迹但不污染 main/upstream |
| 3 | `.gstack/` 处理 | **加到 `.gitignore`** | 防止 cso skill 后续产物误 commit |
| 4 | `@types/node` 版本 | **25.0.9**（91d） | 与 engines >=21 兼容，最新合规 major |
| 5 | 上游跟进节奏 | **脚本 + 被动订阅** 双管 | 脚本主动发现 + GitHub Watch 邮件提醒 |
| 6 | 适配器策略 | **cherry-pick** | 最小攻击面：只合并你用的站点 |
| 7 | Renovate 接入 | **接入** | 自动化最大 ROI；每周一 PR，人工 review |

- [ ] **Step 2: 确认执行（在本 checkbox 打勾即表示采用上述默认）**

---

## Phase 1 — 基线建立（审计起点锁死）

### Task 1.1: 验证 Fork Remote 配置

**Files**: 无改动，只读验证

- [ ] **Step 1: 进入 fork 目录并检查 remote**

```bash
cd ~/Documents/open_sources/opencli
git remote -v
```

Expected output:
```
origin    git@github.com:ken-zy/OpenCLI.git (fetch)
origin    git@github.com:ken-zy/OpenCLI.git (push)
upstream  git@github.com:jackwener/opencli.git (fetch)
upstream  git@github.com:jackwener/opencli.git (push)
```

若缺 `upstream`：`git remote add upstream git@github.com:jackwener/opencli.git`

- [ ] **Step 2: fetch 全部 remote**

```bash
git fetch --all --tags
```

### Task 1.2: 记录审计基线

**Files**:
- Create: `.audit-baseline`
- Create: git tag `audit-baseline-2026-04-17`

- [ ] **Step 1: 写 baseline 文件**

```bash
cd ~/Documents/open_sources/opencli
git rev-parse HEAD > .audit-baseline
cat .audit-baseline
```

Expected: `0cd6356...`（确认是 `feat: migrate academic and policy adapters`）

- [ ] **Step 2: 打 tag**

```bash
git tag "audit-baseline-$(date +%Y-%m-%d)" "$(cat .audit-baseline)"
git tag | grep audit-baseline
```

Expected: 看到 `audit-baseline-2026-04-17`

### Task 1.3: 审 baseline 相对上次扫描的高风险 diff

**Files**: 无改动，只读验证

- [ ] **Step 1: 核对扫描基线 → 当前 HEAD 的高风险目录变动**

```bash
git diff 02d637f..HEAD --stat -- \
  extension/ src/browser/ src/daemon.ts scripts/ package.json \
  .github/workflows/
```

Expected（基于 `0cd6356` 的内容）：
- 空输出 **或** 仅 `clis/` 相关文件 → 高风险目录未变，baseline 可信
- 若看到 `extension/` 或 `src/daemon.ts` 变动 → 停止，回到 spec §7.3 决策三问

- [ ] **Step 2: 如有高风险变动，逐行审阅**

```bash
git diff 02d637f..HEAD -- extension/ src/browser/ src/daemon.ts
```

### Task 1.4: 扩展源码审计（1545 行）

**Files**: 只读

- [ ] **Step 1: 确认扩展源码行数**

```bash
wc -l extension/src/background.ts extension/src/cdp.ts \
  extension/src/protocol.ts extension/src/identity.ts
```

Expected 总行数约 1545（误差 ±20 接受）

- [ ] **Step 2: 审 background.ts（消息路由 + 握手）**

读完 `extension/src/background.ts`，关注：
- 所有 `chrome.runtime.onMessage` 监听
- 与 daemon 的 WebSocket 连接点
- 是否有额外 network fetch

- [ ] **Step 3: 审 cdp.ts（CDP 命令转发）**

读完 `extension/src/cdp.ts`，关注：
- 允许从 daemon 转发的 CDP 方法白名单
- 是否有 `Runtime.evaluate` 之外的"任意代码执行"暴露

- [ ] **Step 4: 审 identity.ts（身份校验）**

读完 `extension/src/identity.ts`，关注：
- daemon ↔ 扩展的握手签名机制
- 是否防重放

- [ ] **Step 5: 审 manifest.json permissions 未变**

```bash
cat extension/manifest.json | grep -A 10 permissions
```

Expected: `debugger`, `tabs`, `cookies`, `activeTab`, `alarms` + `<all_urls>` — **与 spec §1 一致，无新增**

### Task 1.5: 安装脚本审计

**Files**: 只读

- [ ] **Step 1: 审 postinstall**

```bash
cat scripts/postinstall.js
```

Expected 内容：仅 shell completion 写入 + `~/.opencli/spotify.env` 模板，**无 network**。

- [ ] **Step 2: 审 fetch-adapters**

```bash
cat scripts/fetch-adapters.js
```

Expected：清理 stale overrides，**无 network**（名字误导）。

- [ ] **Step 3: 确认 package.json 生命周期脚本**

```bash
node -e 'const p=require("./package.json"); console.log(p.scripts.preinstall||"-", p.scripts.install||"-", p.scripts.postinstall||"-", p.scripts.preuninstall||"-")'
```

Expected: 只有 `postinstall` 和 `preuninstall` 存在；**无 preinstall/install**。

### Task 1.6: Commit Phase 1 审计产物

**Files**:
- Add: `.audit-baseline`
- Add: `.audit/` (整目录)
- Modify: `.gitignore`（新增 `.gstack/`）

- [ ] **Step 1: 更新 .gitignore**

```bash
cd ~/Documents/open_sources/opencli
grep -qE '^\.gstack/$' .gitignore || echo '.gstack/' >> .gitignore
tail -5 .gitignore
```

Expected: 末尾出现 `.gstack/`

- [ ] **Step 2: 创建审计分支**

```bash
git checkout -b audit/initial-review
```

- [ ] **Step 3: 暂存 + commit**

```bash
git add .audit-baseline .audit/ .gitignore
git status --short
```

Expected: `A  .audit-baseline`, `A  .audit/plans/...`, `A  .audit/reports/...`, `A  .audit/specs/...`, `M  .gitignore`

```bash
git commit -m "audit(baseline): establish 2026-04-17 security review baseline

- Baseline commit 0cd6356 (feat: migrate academic and policy adapters)
- Security report .audit/reports/20260417-130748.json (0 CVE, 3 medium findings)
- Implementation spec .audit/specs/2026-04-17-opencli-safe-usage-design.md
- Implementation plan .audit/plans/2026-04-17-opencli-safe-usage-plan.md
- Ignore .gstack/ (cso skill workspace)"
```

Expected: commit 成功，无 Co-Authored-By 行（对齐 CLAUDE.md §3.1）

- [ ] **Step 4: 确认分支不 push**

```bash
git status
git branch --show-current
```

Expected：`audit/initial-review` 本地存在；**未 push**。

---

## Phase 2 — 依赖合规化（核心）

### Task 2.1: 创建依赖锁定分支

**Files**: 无文件，仅 git

- [ ] **Step 1: 从 audit/initial-review 切出**

```bash
git checkout -b security/lock-deps-90d
git branch --show-current
```

Expected: `security/lock-deps-90d`

### Task 2.2: 改 package.json 生产依赖

**Files**:
- Modify: `package.json` (lines ~76-83)

- [ ] **Step 1: 替换 `dependencies` 段**

用以下内容替换整段 `"dependencies": { ... }`：

```json
  "dependencies": {
    "cli-table3": "0.6.5",
    "commander": "14.0.2",
    "js-yaml": "4.1.1",
    "turndown": "7.2.2",
    "undici": "7.18.2",
    "ws": "8.19.0"
  },
```

- [ ] **Step 2: 验证改动**

```bash
node -e 'const p=require("./package.json"); console.log(JSON.stringify(p.dependencies, null, 2))'
```

Expected: 6 个字段，**无 `^` 或 `~` 前缀**

### Task 2.3: 改 package.json 开发依赖

**Files**:
- Modify: `package.json` (lines ~84-93)

- [ ] **Step 1: 替换 `devDependencies` 段**

```json
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
```

- [ ] **Step 2: 验证**

```bash
node -e 'const p=require("./package.json"); console.log(JSON.stringify(p.devDependencies, null, 2))'
```

Expected: 8 个字段，无 `^` 或 `~`

### Task 2.4: 加 overrides 段

**Files**:
- Modify: `package.json`（在 devDependencies 之后新增）

- [ ] **Step 1: 在 `devDependencies` 之后插入 overrides**

```json
  "overrides": {
    "commander": "14.0.2",
    "turndown": "7.2.2",
    "undici": "7.18.2",
    "ws": "8.19.0",
    "@types/node": "25.0.9",
    "typescript": "5.9.3",
    "vitest": "4.0.17"
  },
```

- [ ] **Step 2: 验证 package.json 仍是合法 JSON**

```bash
node -e 'JSON.parse(require("fs").readFileSync("package.json"))'
```

Expected: 无输出（成功解析）

- [ ] **Step 3: 全局复查无 caret/tilde**

```bash
grep -nE '"\^|"~' package.json
```

Expected: **空输出**（无匹配）

### Task 2.5: 清装依赖

**Files**:
- Delete: `node_modules/`（如存在）
- Delete: `package-lock.json`（如存在）
- Recreate: `package-lock.json`

- [ ] **Step 1: 清理旧 node_modules 和 lockfile**

```bash
rm -rf node_modules package-lock.json
ls -la | grep -E 'node_modules|package-lock' || echo "清理完成"
```

Expected: "清理完成"

- [ ] **Step 2: 先用 `--ignore-scripts` 安装（审过 postinstall 再跑）**

```bash
npm install --ignore-scripts 2>&1 | tail -20
```

Expected: `added N packages, and audited M packages`, 无错误

- [ ] **Step 3: 验证关键包版本**

```bash
npm ls commander turndown undici ws typescript vitest @types/node 2>&1 | head -20
```

Expected: 看到
```
├── commander@14.0.2
├── turndown@7.2.2
├── undici@7.18.2
├── ws@8.19.0
```
(和 dev 依赖的对应版本)

### Task 2.6: 重跑依赖年龄检查

**Files**:
- Use: `/tmp/check-dep-age.mjs`（已存在）

- [ ] **Step 1: 跑 check-dep-age 脚本**

```bash
node /tmp/check-dep-age.mjs
```

Expected: 所有 14 行都以 `OK` 结尾，**无 `<90d` 标记**

- [ ] **Step 2: 如有 `<90d` 残留，定位原因**

如果有 `<90d` 行：说明 overrides 没生效。检查：
```bash
npm ls <有问题的包名>
```
然后修正 overrides 字段，回 Task 2.5 重装。

### Task 2.7: npm audit

**Files**: 无改动

- [ ] **Step 1: 跑 audit**

```bash
npm audit --audit-level=moderate
```

Expected: `found 0 vulnerabilities`

- [ ] **Step 2: 如非 0，记录到 `.audit/reports/`**

```bash
npm audit --json > .audit/reports/npm-audit-$(date +%Y%m%d).json
```

只在非 0 时做；否则跳过。

### Task 2.8: 允许 lifecycle 脚本 + rebuild

**Files**: 无改动（仅触发 postinstall）

- [ ] **Step 1: 允许脚本并重建**

```bash
npm rebuild
```

Expected: 无错误；看到 shell completion 安装提示。

- [ ] **Step 2: 验证 shell completion 已装**

```bash
ls ~/.zsh/completions/_opencli 2>/dev/null || ls ~/.bash_completion.d/opencli 2>/dev/null || ls ~/.config/fish/completions/opencli.fish 2>/dev/null
```

Expected: 至少一个存在（取决于你的 shell）

### Task 2.9: typecheck + build + test

**Files**:
- Create: `dist/` 目录（build 产物）

- [ ] **Step 1: typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 退出码 0，无错误（TypeScript 5.9.3 vs 6.0.3 可能出现 1-2 个 warning，但不应有 error）

- [ ] **Step 2: build**

```bash
npm run build 2>&1 | tail -10
```

Expected: 退出码 0，`dist/src/main.js` 生成

- [ ] **Step 3: test**

```bash
npm test 2>&1 | tail -20
```

Expected: 退出码 0，所有 test 通过（vitest 4.0.17 vs 4.1.4 可能有 1-2 个 snapshot 差异，需更新时手动更新）

- [ ] **Step 4: 如有 test 失败，记录并判断**

```bash
npm test 2>&1 | tee .audit/reports/test-$(date +%Y%m%d).log
```

判断：
- 仅 snapshot 差异 → 跑 `npm test -- -u` 更新，再提交
- 真实失败 → 回到源码修复（可能是 typescript 5.9 的编译差异）

### Task 2.10: Commit 依赖锁定

**Files**:
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 检查 diff**

```bash
git diff --stat
git diff package.json
```

Expected: 只看到 package.json 的 deps/devDeps/overrides 改动

- [ ] **Step 2: 提交**

```bash
git add package.json package-lock.json
git commit -m "deps(security): exact-version lock + rollback 7 pkgs to >=90d

Per CLAUDE.md §4.1 (exact version lock) and §4.2 (90-day rule):
- All 14 direct deps pinned exact (removed all ^/~ ranges)
- Rolled back: commander 14.0.3→14.0.2, turndown 7.2.4→7.2.2,
  undici 8.1.0→7.18.2, ws 8.20.0→8.19.0,
  @types/node 25.6.0→25.0.9, typescript 6.0.3→5.9.3, vitest 4.1.4→4.0.17
- Added overrides{} to enforce rollbacks transitively
- Verified: npm audit 0 vulns, typecheck OK, build OK, tests OK
- Baseline: 0cd6356 + .audit/specs/2026-04-17-opencli-safe-usage-design.md"
```

Expected: commit 成功

---

## Phase 3 — 扩展审计 & 自编

### Task 3.1: 审 extension/package.json 依赖

**Files**: 只读

- [ ] **Step 1: 列出扩展依赖**

```bash
cat extension/package.json | node -e '
const p = JSON.parse(require("fs").readFileSync(0, "utf8"));
console.log("deps:", p.dependencies || {});
console.log("devDeps:", p.devDependencies || {});
console.log("scripts:", Object.keys(p.scripts || {}));
'
```

记录输出的依赖列表（预期较少，扩展自身代码不多）

- [ ] **Step 2: 跑年龄检查**

```bash
cd extension
cp /tmp/check-dep-age.mjs ./check-dep-age.mjs
node check-dep-age.mjs
cd ..
```

Expected: 所有依赖年龄显示出来，记录 `<90d` 的包

### Task 3.2: （条件执行）extension 依赖合规化

**Files**:
- Modify: `extension/package.json`（如发现 `<90d` 或 `^`/`~`）

- [ ] **Step 1: 如有违规，同 Task 2.2-2.4 改 extension/package.json**

使用相同方法：去 caret、加 overrides、回退 <90d 版本。

- [ ] **Step 2: 如无违规，跳过**

在此 task 打勾，记录"extension 依赖已合规"

### Task 3.3: 扩展清装 + 构建

**Files**:
- Create: `extension/dist/background.js` 等

- [ ] **Step 1: 清装**

```bash
cd extension
rm -rf node_modules package-lock.json bun.lock
npm install --ignore-scripts
npm audit --audit-level=moderate
```

Expected: 0 漏洞

- [ ] **Step 2: 构建扩展**

```bash
npm run build
ls -la dist/
```

Expected: `dist/background.js` 存在

- [ ] **Step 3: 验证产物大小合理**

```bash
wc -l dist/background.js
```

Expected: ~1000-1500 行（bundled TS 产物）

### Task 3.4: 对比 dist/background.js 构建前后一致

**Files**: 对比

- [ ] **Step 1: 与 repo 中已有 dist 对比**

```bash
cd ~/Documents/open_sources/opencli
git diff extension/dist/background.js | head -50
```

Expected: **空或几乎无差异**（repo 已提交的 dist 是上游构建的；自己构建应 byte-equivalent 或 minor tool diff）

- [ ] **Step 2: 如差异大，记录**

```bash
git diff extension/dist/background.js > .audit/reports/extension-dist-diff-$(date +%Y%m%d).patch
```

- [ ] **Step 3: 判断差异来源**

接受的差异：bundler 元数据（时间戳、路径哈希）。
**不接受的差异**：实际代码逻辑、新增 API 调用——若见，停下审查。

### Task 3.5: Commit 扩展改动

**Files**:
- Modify: `extension/package.json`（如有）
- Modify: `extension/package-lock.json`
- Modify: `extension/dist/background.js`（自编产物）

- [ ] **Step 1: 查看差异**

```bash
cd ~/Documents/open_sources/opencli
git status extension/
git diff --stat extension/
```

- [ ] **Step 2: 提交**

```bash
git add extension/package.json extension/package-lock.json extension/dist/
git commit -m "ext(security): self-build extension dist from audited source

- Reviewed 1545 lines of extension/src/*.ts + popup.js
- manifest.json permissions unchanged (debugger+tabs+cookies+<all_urls>)
- Self-built extension/dist/background.js to avoid GitHub Release ZIP
- Deps locked per CLAUDE.md §4 (same rules as root package.json)"
```

---

## Phase 4 — 自动化长期维护

### Task 4.1: 配置 Renovate

**Files**:
- Create: `renovate.json`

- [ ] **Step 1: 写 renovate.json**

```bash
cat > renovate.json <<'EOF'
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
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
  },
  "vulnerabilityAlerts": {
    "enabled": true,
    "labels": ["security"]
  }
}
EOF
```

- [ ] **Step 2: 验证 JSON 合法**

```bash
node -e 'JSON.parse(require("fs").readFileSync("renovate.json"))'
```

Expected: 无输出

### Task 4.2: 写上游检查脚本

**Files**:
- Create: `scripts/audit/upstream-check.sh`

- [ ] **Step 1: 建目录**

```bash
mkdir -p scripts/audit
```

- [ ] **Step 2: 写 upstream-check.sh**

```bash
cat > scripts/audit/upstream-check.sh <<'SHELL'
#!/usr/bin/env bash
# 评估上游变化，纯报告，不做修改
# Per .audit/specs/2026-04-17-opencli-safe-usage-design.md §7.2
set -e
cd "$(git rev-parse --show-toplevel)"

git fetch upstream --tags --quiet
CURRENT=$(cat .audit-baseline)
NEW=$(git rev-parse upstream/main)

if [ "$CURRENT" = "$NEW" ]; then
  echo "✅ 无上游更新"
  exit 0
fi

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
echo "=== Security Advisories ==="
command -v gh >/dev/null && gh api repos/jackwener/opencli/security-advisories 2>/dev/null | head
SHELL
chmod +x scripts/audit/upstream-check.sh
```

- [ ] **Step 3: 运行一次验证**

```bash
./scripts/audit/upstream-check.sh
```

Expected: 看到上游变化报告（因 baseline=HEAD，当前应为"✅ 无上游更新"）

### Task 4.3: 写依赖年龄检查脚本（持久化）

**Files**:
- Create: `scripts/audit/check-dep-age.mjs`（从 /tmp 复制）

- [ ] **Step 1: 复制并持久化**

```bash
cp /tmp/check-dep-age.mjs scripts/audit/check-dep-age.mjs
chmod +x scripts/audit/check-dep-age.mjs
```

- [ ] **Step 2: 验证能跑**

```bash
node scripts/audit/check-dep-age.mjs | head -5
```

Expected: 看到依赖列表

### Task 4.4: Commit 自动化脚本

**Files**:
- Add: `renovate.json`
- Add: `scripts/audit/upstream-check.sh`
- Add: `scripts/audit/check-dep-age.mjs`

- [ ] **Step 1: 暂存 + commit**

```bash
git add renovate.json scripts/audit/
git commit -m "audit(tooling): add upstream-check + dep-age scripts + renovate config

- renovate.json: minimumReleaseAge=90d, range=pin, weekly schedule
- scripts/audit/upstream-check.sh: reports upstream diff across risk tiers
- scripts/audit/check-dep-age.mjs: verifies all deps >=90 days old
- Per spec §7.2 and Step 8"
```

### Task 4.5: 在 GitHub 启用 Renovate

**Files**: 无本地文件（GitHub UI 操作）

- [ ] **Step 1: 访问 Renovate 安装页**

浏览器打开：https://github.com/apps/renovate

- [ ] **Step 2: 授权 `ken-zy/OpenCLI`**

- Install → Select repositories → `ken-zy/OpenCLI` → Install
- 等待 Renovate 开第一个 PR（通常是 `Configure Renovate`，直接 merge 即激活）

- [ ] **Step 3: 验证激活**

```bash
gh pr list --repo ken-zy/OpenCLI --author app/renovate
```

Expected: 看到 Renovate 的首个 PR 出现（几分钟内）

---

## Phase 5 — 隔离 Chrome Profile

### Task 5.1: 建专用 profile 目录

**Files**:
- Create: `~/.chrome-profiles/xhs/`

- [ ] **Step 1: 建目录**

```bash
mkdir -p ~/.chrome-profiles/xhs
ls -la ~/.chrome-profiles/
```

Expected: `xhs` 目录存在

### Task 5.2: 启动 Chrome 专用 profile

**Files**: 无文件操作

- [ ] **Step 1: 启动 Chrome（保持窗口开着）**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir=$HOME/.chrome-profiles/xhs \
  --profile-directory=Default &
```

Expected: 新 Chrome 窗口打开，**与日常 profile 完全隔离**（无书签、无已登录账号）

- [ ] **Step 2: 验证这是新 profile**

在 Chrome 里：
- 访问 `chrome://version` → 看 `Profile Path` 应含 `/xhs`
- 访问 `chrome://settings` → 未登录任何 Google 账号

### Task 5.3: Load unpacked 扩展

**Files**: 无文件

- [ ] **Step 1: 在该 Chrome 窗口里访问扩展管理页**

地址栏：`chrome://extensions`

- [ ] **Step 2: 开启 Developer mode**

右上角 toggle → 打开

- [ ] **Step 3: Load unpacked**

点击左上角 `Load unpacked` → 选择 `~/Documents/open_sources/opencli/extension/`（整个目录，不只 dist）

Expected: 扩展加载成功，卡片显示 `OpenCLI` + version

- [ ] **Step 4: 验证扩展 ID**

记录 Chrome 显示的 extension ID（类似 `abcd1234...`），贴到 `.audit/reports/extension-install-log.txt`：

```bash
echo "Installed $(date): extension ID = <粘贴 ID>" \
  >> .audit/reports/extension-install-log.txt
```

### Task 5.4: 登录小红书

**Files**: 无

- [ ] **Step 1: 在该 Chrome 访问 xiaohongshu.com**

- [ ] **Step 2: 扫码登录**

用手机小红书 app 扫码（或用户名+密码）

- [ ] **Step 3: 验证登录成功**

访问你自己的个人主页，确认能看到"只有我能看到"的信息（如编辑按钮）

- [ ] **Step 4: 关键 — 不登录任何其他站**

此 profile **只能**有小红书一个登录态。切到淘宝/B站/微博都应是未登录状态。

### Task 5.5: opencli doctor 验证

**Files**: 无

- [ ] **Step 1: 确保 opencli 已 link**

```bash
cd ~/Documents/open_sources/opencli
npm link 2>&1 | tail -3
which opencli
```

Expected: `opencli` 指向 `~/Documents/open_sources/opencli/dist/src/main.js`

- [ ] **Step 2: 跑 doctor**

```bash
opencli doctor
```

Expected: 看到
- `✅ daemon running` 或 `daemon will auto-start`
- `✅ extension connected` （在 Task 5.3 的扩展加载状态下）

- [ ] **Step 3: 如 extension 未连，排查**

```bash
opencli daemon status
lsof -i :19825
```

检查：daemon 在跑吗？Chrome 那个 profile 是否开着？扩展是否 enabled？

---

## Phase 6 — 首次端到端 + 验收

### Task 6.1: 准备测试用笔记 URL

**Files**: 无

- [ ] **Step 1: 在 Chrome 专用 profile 里找一篇笔记**

- 浏览 xhs 首页推荐
- 进入一篇**包含 5+ 图片**的笔记
- 复制浏览器地址栏完整 URL（含 `?xsec_token=...`）

- [ ] **Step 2: 记录 URL（临时文件，不 commit）**

```bash
echo '<粘贴 URL>' > /tmp/xhs-test-url.txt
```

### Task 6.2: 首次下载（计时）

**Files**:
- Create: `./xhs-test/` 目录（输出）

- [ ] **Step 1: 计时执行下载**

```bash
cd ~/Documents/open_sources/opencli
mkdir -p ./xhs-test
time opencli xiaohongshu download "$(cat /tmp/xhs-test-url.txt)" --output ./xhs-test
```

Expected:
- 退出码 0
- 输出表格列：`index / type / status / size` 每张图一行
- `real` 时间 **< 30 秒**（理想 5-15 秒）

- [ ] **Step 2: 记录耗时**

```bash
echo "首次 E2E $(date): N 图耗时 <记录 real 值>" >> .audit/reports/e2e-runs.txt
```

### Task 6.3: 验证产物

**Files**: 验证 `./xhs-test/` 内容

- [ ] **Step 1: 检查文件数**

```bash
find ./xhs-test -type f | wc -l
```

Expected: 等于笔记实际图片数（视频则 +1）

- [ ] **Step 2: 抽查图片完整性**

```bash
file ./xhs-test/*/*.jpg | head -3
```

Expected: 每个都是 `JPEG image data, JFIF standard`（不是 `HTML document` 或 `data`）

- [ ] **Step 3: 检查图片尺寸**

```bash
ls -la ./xhs-test/*/*.jpg | awk '{print $5}' | sort -n | head
```

Expected: 最小图片 > 50KB（说明是原图不是缩略图）

### Task 6.4: 跑完整验收标准 11 条（spec §5）

**Files**: 验证清单

- [ ] **Step 1: 逐条核验**

```bash
echo "=== 验收 1: package.json 无 ^/~ ==="
! grep -nE '"\^|"~' package.json && echo "✅" || echo "❌"

echo "=== 验收 2: 所有依赖 >=90 天 ==="
node scripts/audit/check-dep-age.mjs | grep -q '<90d' && echo "❌" || echo "✅"

echo "=== 验收 3: 0 npm audit 漏洞 ==="
npm audit --audit-level=low 2>&1 | grep -q 'found 0' && echo "✅" || echo "❌"

echo "=== 验收 4: typecheck ==="
npm run typecheck 2>&1 >/dev/null && echo "✅" || echo "❌"

echo "=== 验收 5: tests ==="
npm test 2>&1 >/dev/null && echo "✅" || echo "❌"

echo "=== 验收 6: build 产物 ==="
[ -f dist/src/main.js ] && echo "✅" || echo "❌"

echo "=== 验收 7: 扩展构建产物 ==="
[ -f extension/dist/background.js ] && echo "✅" || echo "❌"

echo "=== 验收 10: daemon 只听 127.0.0.1 ==="
lsof -i :19825 2>/dev/null | grep -q 'localhost\|127.0.0.1' && echo "✅" || echo "⚠️ 非监听态(daemon 不在跑)"
```

- [ ] **Step 2: 手工核验 8, 9, 11**

```
验收 8 (隔离 profile 只登录 xhs):
  Chrome 专用 profile 里,浏览 taobao.com/weibo.com → 应全未登录 → ✅/❌

验收 9 (首次下载成功):
  Task 6.3 已过 → ✅

验收 11 (性能 <30s):
  Task 6.2 real 时间 → ✅/❌
```

- [ ] **Step 3: 汇总写入报告**

```bash
cat > .audit/reports/acceptance-$(date +%Y%m%d).md <<EOF
# 验收报告 $(date +%Y-%m-%d)

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 无 caret/tilde | ✅/❌ |
| 2 | 全部 >=90d | ✅/❌ |
| 3 | npm audit 0 | ✅/❌ |
| 4 | typecheck | ✅/❌ |
| 5 | tests | ✅/❌ |
| 6 | build 产物 | ✅/❌ |
| 7 | 扩展产物 | ✅/❌ |
| 8 | profile 只登 xhs | ✅/❌ |
| 9 | 首次下载成功 | ✅/❌ |
| 10 | daemon 127.0.0.1 | ✅/❌ |
| 11 | 性能 <30s (实测 __s) | ✅/❌ |
EOF
```

---

## Phase 7 — 长期维护激活

### Task 7.1: 订阅 GitHub 通知

**Files**: 无（GitHub UI）

- [ ] **Step 1: 设置 Watch on upstream**

浏览器访问 https://github.com/jackwener/opencli
- 点右上角 `Watch` → `Custom` → ☑️ `Releases` ☑️ `Security alerts`

- [ ] **Step 2: 订阅 Security Advisories 页**

访问 https://github.com/jackwener/opencli/security/advisories
- 如有 Watch 按钮则点击订阅

### Task 7.2: （可选）加 launchd 周检

**Files**:
- Create: `~/Library/LaunchAgents/com.jdy.opencli-upstream-check.plist`

- [ ] **Step 1: 如想自动周检，写 plist**

否则跳过，每周一手动 `./scripts/audit/upstream-check.sh` 即可。

```bash
cat > ~/Library/LaunchAgents/com.jdy.opencli-upstream-check.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jdy.opencli-upstream-check</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd /Users/jdy/Documents/open_sources/opencli && ./scripts/audit/upstream-check.sh > /tmp/opencli-upstream.log 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.jdy.opencli-upstream-check.plist
```

- [ ] **Step 2: 验证已加载**

```bash
launchctl list | grep opencli
```

Expected: 看到 `com.jdy.opencli-upstream-check` 条目

### Task 7.3: 写日历提醒（季度复审）

**Files**: 无（日历 app）

- [ ] **Step 1: 在日历里建 4 个年度循环事件**

- `2026-06-30 季度复审 opencli 依赖 (run scripts/audit/check-dep-age.mjs)`
- `2026-09-30` 同上
- `2026-12-31` 同上
- `2027-03-31` 同上

提醒内容指向 spec §7.8 的 4 条复审动作。

### Task 7.4: Commit Phase 5-7 的配置（如有）

**Files**:
- Modify: `.audit/reports/*`（验收 + e2e 日志）
- Modify: `.audit/reports/extension-install-log.txt`（如 Task 5.3 生成）

- [ ] **Step 1: 提交**

```bash
git add .audit/reports/
git status --short
```

如有 `.audit/reports/` 下新文件：

```bash
git commit -m "audit(reports): acceptance + e2e logs for initial rollout

- .audit/reports/acceptance-2026-04-17.md: 11-item acceptance verdict
- .audit/reports/e2e-runs.txt: first xhs download perf measurement
- .audit/reports/extension-install-log.txt: extension ID record"
```

---

## Phase 8 — 日常使用

### Task 8.1: 日常下载流程（参考，不执行）

**Files**: 无

- [ ] **Step 1: 单篇下载**

```bash
opencli xiaohongshu download '<url>' --output ./my-downloads
```

- [ ] **Step 2: 批量（写入 notes.txt）**

```bash
cat notes.txt | while read url; do
  opencli xiaohongshu download "$url" --output ./batch
  sleep 2  # 礼貌节流
done
```

- [ ] **Step 3: 用完停 daemon（省资源）**

```bash
opencli daemon stop
```

---

## 最终 Commit / Push 决策

**执行完上面所有 task 后**，当前状态：

```
branch: security/lock-deps-90d (或 audit/initial-review)
commits: 多个（baseline audit, deps lock, ext build, automation, reports）
```

### Task 9.1: 合并分支到本地 audit/initial-review

**Files**: 无，仅 git

- [ ] **Step 1: 切回 audit/initial-review**

```bash
git checkout audit/initial-review
git merge security/lock-deps-90d --no-ff -m "merge: security/lock-deps-90d"
```

- [ ] **Step 2: 决定是否 push**

**默认不 push**（§9 开放项 #4 推荐 3b）。保留本地即可。

如要 push：
```bash
git push -u origin audit/initial-review
```

**不要** push 到 main 或 master。

---

## 自审清单（执行者完成后自检）

- [ ] **A.** 所有 8 个 Phase 全部 commit 完成
- [ ] **B.** `npm audit` 报告 0 漏洞
- [ ] **C.** `node scripts/audit/check-dep-age.mjs` 全 OK
- [ ] **D.** 扩展装在隔离 profile，日常 Chrome 未动
- [ ] **E.** xhs 下载 E2E < 30 秒
- [ ] **F.** 所有验收 11 条 ✅
- [ ] **G.** `.audit/` 已 commit 到 `audit/initial-review` 分支，未 push 到 origin
- [ ] **H.** Renovate 已激活（Task 4.5 看到 PR）
- [ ] **I.** 上游订阅已配（Task 7.1）

---

## 失败回滚

### 如果 Phase 2 依赖验证失败（测试崩）

```bash
git checkout -- package.json package-lock.json
rm -rf node_modules
git checkout main
# 回到分析: 哪个包降级造成的,是否需要保留在较新版本(走 §4.4 豁免)
```

### 如果 Phase 5 扩展不连 daemon

```bash
# 清理扩展
# Chrome → chrome://extensions → 删 OpenCLI
# 清 daemon 状态
opencli daemon stop
rm -rf ~/.opencli  # 谨慎, 备份 spotify.env 先
# 重 load unpacked
```

### 如果 Phase 6 下载失败（小红书风控）

- 检查 `SECURITY_BLOCK` 错误
- 等待数小时或换专用 profile 的登录账号
- 用 `search_result` 的 URL 带 `xsec_token` 重试

---

## 参考

- Spec: `.audit/specs/2026-04-17-opencli-safe-usage-design.md`
- 安全报告: `.audit/reports/20260417-130748.json`
- CLAUDE.md §4: `/Users/jdy/.claude/CLAUDE.md`
