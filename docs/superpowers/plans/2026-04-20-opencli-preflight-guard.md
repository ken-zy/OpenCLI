# OpenCLI 0号浏览器预检 Harness Hook 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Claude Code harness（PreToolUse hook）层强制拦截非 bypass 的 opencli 浏览器命令，未就绪自动预检/阻断，同时把 opencli 专属资产从 Main vault 迁回 opencli repo。

**Architecture:** 全局 `~/.claude/settings.json` 加 PreToolUse hook，命中 `Bash(*opencli*)` 时调用 `opencli_preflight_guard.sh`。guard 脚本按「self-check → 轻量预筛 → JSON 解析 → wrapper 展开 → shlex 分词 → bypass 查询 → preflight 调用」决策树处理，对已识别的 opencli 调用走 fail-closed 策略。

**Tech Stack:** Bash (shell wrapper)、Python 3（macOS 自带，主逻辑解析）、Claude Code PreToolUse hook、opencli 已有的 `preflight_profile0.sh`。

**Spec:** `docs/superpowers/specs/2026-04-20-opencli-preflight-guard-design.md`

---

## File Structure

| 动作 | 路径 | 职责 |
|---|---|---|
| 迁入 | `scripts/preflight_profile0.sh` | 0号 Chrome 预检脚本（内容不变，路径改变） |
| 迁入 | `docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md` | 前置 spec 归档 |
| 迁入 | `docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md` | 前置 plan 归档 |
| Create | `~/.claude/scripts/opencli_preflight_guard.sh` | PreToolUse hook 主逻辑 |
| Create | `~/.claude/scripts/gen-bypass-list.sh` | 一键重生 bypass_commands.txt |
| Create | `~/.claude/scripts/opencli_bypass_commands.txt` | `<site>/<cmd>` 白名单（browser:false） |
| Modify | `~/.claude/settings.json` | 追加 `hooks.PreToolUse[Bash]` 配置 |
| Modify | `skills/opencli-browser/SKILL.md` | blockquote 替换 |
| Modify | `skills/opencli-explorer/SKILL.md` | blockquote 替换 |
| Modify | `skills/opencli-oneshot/SKILL.md` | blockquote 替换 |
| Modify | `skills/opencli-autofix/SKILL.md` | blockquote 替换 |
| Modify | `skills/smart-search/SKILL.md` | blockquote + 特例行替换 |
| Modify | `.claude/CLAUDE.md` (line 63-68) | 路径 + 新增 harness hook 小节 |
| Modify | `AGENTS.md` (line 63) | 修 typo + 同步路径 |
| 删除 | `Main/.claude/scripts/preflight_profile0.sh` | Phase 3 验证后删 |
| 删除 | `Main/docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md` | Phase 3 验证后删 |
| 删除 | `Main/docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md` | Phase 3 验证后删 |

---

## Task 1: 分支与文件迁入

**Files:**
- 迁入: `scripts/preflight_profile0.sh`
- 迁入: `docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md`
- 迁入: `docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md`

分支 `feat/preflight-harness-hook` 已由 brainstorming 阶段创建，当前已在该分支。

- [ ] **Step 1: 确认当前分支与工作区**

```bash
cd /Users/jdy/Documents/open_sources/opencli
git branch --show-current
git status --short
```

Expected: `feat/preflight-harness-hook` + 工作区干净（AGENTS.md 已在 `.git/info/exclude` 不显示）

- [ ] **Step 2: 建 `scripts/` 目录并复制 preflight 脚本**

```bash
mkdir -p /Users/jdy/Documents/open_sources/opencli/scripts
cp /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh \
   /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
chmod +x /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
```

- [ ] **Step 3: 复制 Main 下的 spec 与 plan 归档**

```bash
cp /Users/jdy/Documents/Main/docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md \
   /Users/jdy/Documents/open_sources/opencli/docs/superpowers/specs/
cp /Users/jdy/Documents/Main/docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md \
   /Users/jdy/Documents/open_sources/opencli/docs/superpowers/plans/
```

- [ ] **Step 4: 验证迁入文件可读且内容完整**

```bash
ls -la /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
head -5 /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
wc -l /Users/jdy/Documents/open_sources/opencli/docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md
wc -l /Users/jdy/Documents/open_sources/opencli/docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md
```

Expected: 脚本 ~84 行且有 `#!/usr/bin/env bash` 开头；spec / plan 文件非空。

- [ ] **Step 5: Commit**

```bash
cd /Users/jdy/Documents/open_sources/opencli
git add scripts/preflight_profile0.sh \
        docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md \
        docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md
git commit -m "feat(scripts): migrate preflight_profile0.sh + prior design docs from Main

0号 Chrome 预检脚本及其 2026-04-18 的 spec/plan 本应驻留在 opencli repo
（而非 Main vault）。本次迁入以结束跨仓库耦合。内容不变。"
```

---

## Task 2: 更新 6 份 SKILL.md blockquote

**Files:**
- Modify: `skills/opencli-browser/SKILL.md`（lines 9-29）
- Modify: `skills/opencli-explorer/SKILL.md`（lines 9-29）
- Modify: `skills/opencli-oneshot/SKILL.md`（lines 9-29）
- Modify: `skills/opencli-autofix/SKILL.md`（lines 9-29）
- Modify: `skills/smart-search/SKILL.md`（lines 8-30）
- Modify: `skills/opencli-usage/SKILL.md`（lines 11-33）

browser/explorer/oneshot/autofix 四份 blockquote 内容完全一致；smart-search 多一行特例行；**opencli-usage** 也带着一份旧 blockquote（比 5 份多列 CLI passthrough 站点：`gh` / `docker` / `lark-cli` / `vercel` / `dws` / `wecom-cli` / `obsidian`），需要一并同步。

- [ ] **Step 1: 为 4 份一致 blockquote 准备新文本**

新 blockquote 模板（用于 browser / explorer / oneshot / autofix）：

```markdown
> **本项目约定：0号浏览器预检（jdy / Main 项目，2026-04-18；harness hook 兜底 2026-04-20）**
>
> **harness 层已强制**：`~/.claude/scripts/opencli_preflight_guard.sh` 作为 PreToolUse hook 自动拦截非 bypass 的 opencli 命令并跑预检，未就绪会 exit 2 阻断 + 回显修复指引。以下文档规则与 hook 行为一致，仅作阅读参考（即便 AI 漏读也由 harness 兜底）。
>
> **触发预检的命令**（走 BrowserBridge，必须连 0号 Chrome）：
>
> **通用规则（先看这条）**：所有 `browser: true` 的 opencli 命令（见 `opencli list -f json` 中 `browser` 字段）。不确定 → 默认预检。
>
> 具体已知触发场景（仅举例，**不是穷尽**）：
>
> - `opencli browser <subcmd>` — 全部 browser 子命令（含 `init` / `verify`）
> - `opencli explore` / `probe` / `generate` / `record` / `cascade` — 顶层浏览器工具
>
> 预检执行（hook 自动调用；如需手动验证）：
>
> ```bash
> bash /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
> ```
>
> 脚本会自动：① 通过 daemon `/status` 判定扩展就绪；② 需要时启动 0号；③ 若扩展未连上 daemon 给出 Load unpacked / 排查指引。失败会报错并给清理指令。
>
> **无需预检的命令**（`browser: false`，不走浏览器）：管理子命令（`list` / `doctor` / `daemon` / `help` / `synthesize` / `validate` / `completion` / `plugin` / `version`）、以及 `opencli list -f json` 中 `browser: false` 的全部命令（如 `hackernews/*` · `v2ex/hot` · `google/news` · `bloomberg/*` 等）。精确白名单见 `~/.claude/scripts/opencli_bypass_commands.txt`（由 `gen-bypass-list.sh` 一键重生）。
>
> 不得在主 Chrome 或 profile_1~6 中运行 opencli —— 其他实例未装扩展，不参与自动化。
```

- [ ] **Step 2: 替换 opencli-browser SKILL.md blockquote**

用 Edit 工具精确替换 lines 9-29 的整块 blockquote 为 Step 1 的新文本。旧块开头是 `> **本项目约定：0号浏览器预检（jdy / Main 项目，2026-04-18）**`，结尾是 `> 不得在主 Chrome 或 profile_1~6 中运行 opencli —— 其他实例未装扩展，不参与自动化。` 及其后一空行。

- [ ] **Step 3: 对 explorer / oneshot / autofix 重复 Step 2**

对 `skills/opencli-explorer/SKILL.md`、`skills/opencli-oneshot/SKILL.md`、`skills/opencli-autofix/SKILL.md` 应用相同替换。

- [ ] **Step 4: 更新 smart-search SKILL.md（blockquote + 特例行）**

替换 lines 8-30。新 blockquote 在 Step 1 模板基础上，额外追加一行特例：

```markdown
>
> **smart-search 特例**：若最终路由到 `browser: false` 的源（hackernews / v2ex/hot / arxiv 等纯 API），**不触发预检**直接执行；若路由到 `browser: true` 源（grok / doubao / gemini / xueqiu / twitter 等），按上述规则预检（harness hook 也会自动兜底）。
```

这行放在 blockquote 最后（在"不得在主 Chrome 或 profile_1~6..."之后）。

- [ ] **Step 4b: 更新 opencli-usage SKILL.md（blockquote，保留 CLI passthrough 说明）**

`opencli-usage` 原 blockquote 比 5 份基础模板多一段"无需预检"的详细列表（含 CLI passthrough：`gh` / `docker` / `lark-cli` / `vercel` / `dws` / `wecom-cli` / `obsidian`）和一行"权威判据"说明。替换 lines 11-33 为：

```markdown
> **本项目约定：0号浏览器预检（jdy / Main 项目，2026-04-18；harness hook 兜底 2026-04-20）**
>
> **harness 层已强制**：`~/.claude/scripts/opencli_preflight_guard.sh` 作为 PreToolUse hook 自动拦截非 bypass 的 opencli 命令并跑预检，未就绪会 exit 2 阻断 + 回显修复指引。以下文档规则与 hook 行为一致，仅作阅读参考（即便 AI 漏读也由 harness 兜底）。
>
> **触发预检的命令**（走 BrowserBridge，必须连 0号 Chrome）：
>
> **通用规则（先看这条）**：所有 `browser: true` 的 opencli 命令（见 `opencli list -f json` 中 `browser` 字段）。不确定 → 默认预检。
>
> 具体已知触发场景（仅举例，**不是穷尽**）：
>
> - `opencli browser <subcmd>` — 全部 browser 子命令（含 `init`；`verify` 属于 browser 子命令时预检）
> - `opencli explore` / `probe` / `generate` / `record` / `cascade` — 顶层浏览器工具
>
> 预检执行（hook 自动调用；如需手动验证）：
>
> ```bash
> bash /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
> ```
>
> **无需预检的命令**（`browser: false`，不走浏览器）：管理子命令（`list` / `doctor` / `daemon` / `help` / `synthesize` / `validate` / `verify` / `completion` / `plugin` / `version`）、以及 `opencli list -f json` 中 `browser: false` 的全部命令。包含 CLI passthrough：`gh` / `docker` / `lark-cli` / `vercel` / `dws` / `wecom-cli` / `obsidian` 等（只要 opencli registry 里 `browser: false`，都自动进入 `~/.claude/scripts/opencli_bypass_commands.txt`）。精确白名单由 `gen-bypass-list.sh` 一键重生。
>
> **权威判据**：以 daemon `/status` 的 `extensionConnected` 为准。**不要**依赖 `opencli doctor` 的退出码（只打印报告，不设 exitCode）。
>
> 不得在主 Chrome 或 `profile_1~6` 中运行 opencli —— 其他实例未装扩展，不参与自动化。
```

- [ ] **Step 5: 交叉验证 4 份 blockquote 完全一致**

```bash
cd /Users/jdy/Documents/open_sources/opencli
for f in skills/opencli-browser/SKILL.md skills/opencli-explorer/SKILL.md \
         skills/opencli-oneshot/SKILL.md skills/opencli-autofix/SKILL.md; do
  sed -n '/^> \*\*本项目约定/,/^> 不得在主 Chrome/p' "$f" | md5sum
done
```

Expected: 4 行哈希值完全一致。如不一致，用 diff 对比修复。

- [ ] **Step 6: 验证 smart-search 有特例行**

```bash
grep -c "smart-search 特例" skills/smart-search/SKILL.md
grep -c "不得在主 Chrome 或 profile_1~6" skills/smart-search/SKILL.md
```

Expected: 特例行 1 次，主约束行 1 次。

- [ ] **Step 7: Commit**

```bash
git add skills/opencli-browser/SKILL.md skills/opencli-explorer/SKILL.md \
        skills/opencli-oneshot/SKILL.md skills/opencli-autofix/SKILL.md \
        skills/smart-search/SKILL.md skills/opencli-usage/SKILL.md
git commit -m "docs(skills): sync 6 SKILL.md blockquotes to harness-hook-aware rules

- 加入 harness 层已强制首段（让未来读者知道 hook 兜底）
- 通用规则置顶 + 具体场景改为\"仅举例不是穷尽\"
- 判定标准由 strategy 改为 browser:true/false（数据层更准确）
- 预检脚本路径迁至 opencli/scripts/preflight_profile0.sh
- 管理命令清单补齐 validate/completion/plugin"
```

---

## Task 3: 更新项目 `.claude/CLAUDE.md` + `AGENTS.md`（全量同步而非仅 line 63）

**Files:**
- Modify: `.claude/CLAUDE.md`（lines 63-68 全部更新 + 新增 harness hook 小节）
- Modify: `AGENTS.md`（同上，本地私有）

`.claude/CLAUDE.md` 已 git tracked；`AGENTS.md` 本地私有（在 `.git/info/exclude` 里）。原"0号 Chrome 绑定"小节里不只 line 63 路径过时，line 68 的 `strategy != PUBLIC/LOCAL` 判据和 line 72 的 `blockquote 硬编码 Main 路径` 说明也与新 spec 冲突——本 Task 全量更新这整节。

- [ ] **Step 1: 更新 `.claude/CLAUDE.md` 的整节"背景与设计"（lines 61-68）**

把原 lines 61-68 的整节：

```
### 背景与设计

- **唯一正本预检脚本**：`/Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh`（Main 项目 repo 里，非本 fork）
- **真相源**：daemon HTTP `/status` 的 `extensionConnected` 字段（`opencli doctor` 不设 exit code，见 `src/cli.ts:750-755`）
- **0号 Chrome profile**：`~/chrome_profiles/profile_0`，由 `/Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh` 管理，本就独家开 `--remote-debugging-port=0` 作为自动化专用实例
- **扩展安装方式**：`chrome://extensions/` 开发者模式 → Load unpacked → 选 `extension/` 根目录。Chrome 147 已禁用 `--load-extension` 命令行参数（Google 政策，且 `--disable-features=DisableLoadExtensionCommandLineSwitch` kill-switch 也失效）
- **路径约束**：`--load-extension`（废弃路径）或 Load unpacked 都要选 `extension/` **根目录**（manifest 所在），**不是** `extension/dist`（dist 里只有 `background.js`）
- **预检范围**：仅 `opencli browser <subcmd>` + 顶层浏览器命令（`explore`/`generate`/`record`/`cascade`；`synthesize` 本地处理不走浏览器）+ 非 PUBLIC/LOCAL 的 site。PUBLIC（hackernews/v2ex/arxiv/lobsters 等）豁免
```

替换为：

```
### 背景与设计

- **唯一正本预检脚本**：`/Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh`（本 repo 内，2026-04-20 从 Main/.claude/scripts/ 迁入）
- **真相源**：daemon HTTP `/status` 的 `extensionConnected` 字段（`opencli doctor` 不设 exit code，见 `src/cli.ts:750-755`）
- **0号 Chrome profile**：`~/chrome_profiles/profile_0`，由 `/Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh` 管理，本就独家开 `--remote-debugging-port=0` 作为自动化专用实例
- **扩展安装方式**：`chrome://extensions/` 开发者模式 → Load unpacked → 选 `extension/` 根目录。Chrome 147 已禁用 `--load-extension` 命令行参数（Google 政策，且 `--disable-features=DisableLoadExtensionCommandLineSwitch` kill-switch 也失效）
- **路径约束**：`--load-extension`（废弃路径）或 Load unpacked 都要选 `extension/` **根目录**（manifest 所在），**不是** `extension/dist`（dist 里只有 `background.js`）
- **预检范围判据**：所有 `opencli list -f json` 中 `browser: true` 的命令。精确白名单（`browser: false`）由 `~/.claude/scripts/opencli_bypass_commands.txt` 维护，由 `gen-bypass-list.sh` 一键重生。旧 `strategy != PUBLIC/LOCAL` 判据已淘汰（存在 `36kr/hot` 这类 `strategy: public` 但 `browser: true` 的反例）。
```

- [ ] **Step 2: 更新"不向 upstream 提 PR"小节（line 72 附近）**

把原 line 72：

```
这些 blockquote 硬编码了 jdy 的 Main 项目绝对路径（`/Users/jdy/Documents/Main/...`），对其他用户无意义。**永久驻留在 `ken-zy/OpenCLI` 私 fork**。
```

替换为：

```
这些 blockquote 硬编码了 jdy 个人绝对路径（`/Users/jdy/Documents/open_sources/opencli/scripts/` 和 `~/.claude/scripts/`），对其他用户无意义。**永久驻留在 `ken-zy/OpenCLI` 私 fork**。
```

- [ ] **Step 3: 在"### upstream rebase 时的处理"之前（约 line 74 位置）插入 harness hook 小节**

```markdown
### Harness Hook 强制层（2026-04-20）

除 6 份 SKILL.md 的 blockquote 文档层外，另有 harness 层强制兜底：

- `~/.claude/scripts/opencli_preflight_guard.sh` — PreToolUse hook 主逻辑
- `~/.claude/scripts/opencli_bypass_commands.txt` — `<site>/<cmd>` 白名单
- `~/.claude/scripts/gen-bypass-list.sh` — 一键重生白名单
- `~/.claude/settings.json` 的 `hooks.PreToolUse[Bash]` 绑定（`if: "Bash(*opencli*)"` 预过滤）

即便 AI 漏读 skill blockquote，Bash 执行前 hook 会自动拦截非 bypass 的 opencli 命令并跑预检。详见 `docs/superpowers/specs/2026-04-20-opencli-preflight-guard-design.md`。
```

- [ ] **Step 4: 修改 `AGENTS.md` 同步 CLAUDE.md 变更**

AGENTS.md 是 CLAUDE.md 的本地私有副本（line 63 有 typo `.Codex` 实应 `.claude`，迁移后整行重写为新路径后 typo 自然消失）。把 AGENTS.md 的 "## jdy Main 项目私有补丁：0号 Chrome 绑定（2026-04-18）" 小节整体替换为 CLAUDE.md 对应小节的最新内容（包括 Step 1-3 的全部更新）。

一种实现方式：直接用 CLAUDE.md 的完整小节覆盖 AGENTS.md 的对应小节：

```bash
# 先备份
cp /Users/jdy/Documents/open_sources/opencli/AGENTS.md \
   /Users/jdy/Documents/open_sources/opencli/AGENTS.md.bak

# 手动 Edit AGENTS.md：把 "## jdy Main 项目私有补丁：0号 Chrome 绑定（2026-04-18）"
# 到文件末尾的部分替换为 CLAUDE.md 对应段落（即 Step 1-3 全部更新）
```

Edit 工具操作：找到 AGENTS.md 中 line 63 附近的 typo 块以及后续所有"0号 Chrome 绑定"子节，与更新后的 CLAUDE.md 对应节保持一致。

- [ ] **Step 5: 验证**

```bash
# CLAUDE.md 应指向新路径且不再有旧 strategy 判据
grep "唯一正本预检脚本" /Users/jdy/Documents/open_sources/opencli/.claude/CLAUDE.md
! grep "非 PUBLIC/LOCAL 的 site" /Users/jdy/Documents/open_sources/opencli/.claude/CLAUDE.md
! grep "/Users/jdy/Documents/Main/\\.claude/scripts" /Users/jdy/Documents/open_sources/opencli/.claude/CLAUDE.md
# AGENTS.md 不应再有 .Codex typo / 旧判据 / 旧路径
! grep "\.Codex/scripts" /Users/jdy/Documents/open_sources/opencli/AGENTS.md
! grep "非 PUBLIC/LOCAL 的 site" /Users/jdy/Documents/open_sources/opencli/AGENTS.md
# 两个文件都应有 harness hook 小节
grep -c "Harness Hook 强制层" /Users/jdy/Documents/open_sources/opencli/.claude/CLAUDE.md
grep -c "Harness Hook 强制层" /Users/jdy/Documents/open_sources/opencli/AGENTS.md
```

Expected: 新路径命中、旧路径/旧判据未命中；AGENTS.md 无 `.Codex`；两文件各有 1 处"Harness Hook 强制层"。

- [ ] **Step 6: Commit（仅 CLAUDE.md；AGENTS.md 在 exclude 中不入 git）**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(claude-md): update preflight script path + add harness hook section

- line 63: preflight_profile0.sh 路径从 Main 迁到 opencli/scripts/
- 新增\"Harness Hook 强制层\"小节说明 hook 与白名单的位置
- AGENTS.md（本地私有）同步更新，顺带修 .Codex typo"
```

---

## Task 4: 写 guard 脚本（核心）

**Files:**
- Create: `~/.claude/scripts/opencli_preflight_guard.sh`
- Test: `~/.claude/scripts/test_opencli_preflight_guard.sh`（临时测试驱动，验证后可删）

guard 脚本用 bash 做 outer + python3 做主逻辑（JSON 解析 / shlex 分词 / bypass 查询 / preflight 子进程）。

- [ ] **Step 1: 建目录**

```bash
mkdir -p /Users/jdy/.claude/scripts
```

- [ ] **Step 2: 写测试驱动 `test_opencli_preflight_guard.sh`**

Create `/Users/jdy/.claude/scripts/test_opencli_preflight_guard.sh`:

```bash
#!/usr/bin/env bash
# 测试驱动：覆盖 spec 验证 case 表。失败即报错。
set -u

GUARD="$HOME/.claude/scripts/opencli_preflight_guard.sh"
PASS=0
FAIL=0

run_test() {
  local desc="$1" json="$2" expected="$3"
  local actual
  actual=$(echo "$json" | bash "$GUARD" 2>/dev/null; echo "RC=$?")
  local rc="${actual##*RC=}"
  if [ "$rc" = "$expected" ] || { [ "$expected" = "01" ] && { [ "$rc" = "0" ] || [ "$rc" = "2" ]; }; }; then
    PASS=$((PASS+1))
    echo "PASS: $desc (exit=$rc)"
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $desc expected=$expected got=$rc"
    echo "  input: $json"
  fi
}

# —— fail-open（exit 0）
run_test "非 opencli"              '{"tool_input":{"command":"ls -la"}}' 0
run_test "子串非独立 token"         '{"tool_input":{"command":"echo opencli-autofix"}}' 0
run_test "env 前缀 + 管理"          '{"tool_input":{"command":"OPENCLI_DEBUG=1 opencli list"}}' 0
run_test "opencli list"            '{"tool_input":{"command":"opencli list"}}' 0
run_test "opencli doctor"          '{"tool_input":{"command":"opencli doctor"}}' 0
run_test "opencli daemon stop"     '{"tool_input":{"command":"opencli daemon stop"}}' 0
run_test "opencli validate"        '{"tool_input":{"command":"opencli validate hn/top"}}' 0
run_test "opencli completion"      '{"tool_input":{"command":"opencli completion bash"}}' 0
run_test "bypass list 命中"         '{"tool_input":{"command":"opencli hackernews top --limit 5"}}' 0
run_test "v2ex/hot bypass"         '{"tool_input":{"command":"opencli v2ex hot"}}' 0

# —— 状态依赖（预检就绪/未就绪）
run_test "browser:true 36kr/hot"   '{"tool_input":{"command":"opencli 36kr hot"}}' 01
run_test "browser:true browser"    '{"tool_input":{"command":"opencli browser state"}}' 01
run_test "browser:true explore"    '{"tool_input":{"command":"opencli explore https://x.com"}}' 01
run_test "wrapper bash -lc"        '{"tool_input":{"command":"bash -lc \"opencli browser state\""}}' 01
run_test "wrapper zsh -c bypass"   '{"tool_input":{"command":"zsh -c \"opencli hackernews top\""}}' 0

# —— fail-closed（exit 2）
run_test "wrapper 深度 2"          '{"tool_input":{"command":"bash -c \"bash -c \\\"opencli browser state\\\"\""}}' 2
run_test "含 opencli 但 JSON 坏"    'malformed-with-opencli-inside' 2

# —— 明确 fail-open
run_test "JSON 坏且无 opencli"      'malformed-json-random' 0

echo
echo "RESULTS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
```

```bash
chmod +x /Users/jdy/.claude/scripts/test_opencli_preflight_guard.sh
```

- [ ] **Step 3: 运行测试（此时 guard 不存在）验证 harness 能探测到失败**

```bash
bash /Users/jdy/.claude/scripts/test_opencli_preflight_guard.sh
```

Expected: 大部分 FAIL（因为 guard 脚本还没写）。这一步目的是确认测试驱动能区分 pass/fail。

- [ ] **Step 4: 写 guard 脚本**

Create `/Users/jdy/.claude/scripts/opencli_preflight_guard.sh`:

```bash
#!/usr/bin/env bash
# opencli_preflight_guard.sh — PreToolUse hook for opencli browser command enforcement
# Spec: /Users/jdy/Documents/open_sources/opencli/docs/superpowers/specs/2026-04-20-opencli-preflight-guard-design.md

set -u

# Ensure opencli + python3 + preflight find their tools
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH"

PREFLIGHT_SCRIPT="/Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh"
BYPASS_FILE="$HOME/.claude/scripts/opencli_bypass_commands.txt"

# [0] Read stdin once; do a shell grep on raw bytes for fast-path exit
raw_input="$(cat)"
if ! printf '%s' "$raw_input" | grep -qE '\bopencli\b'; then
  # Command clearly has no opencli token — fail-open, guard not needed
  exit 0
fi

# [1a] Basic self-check (always required)
basic_fail=""
[ -x "$PREFLIGHT_SCRIPT" ] || basic_fail="preflight not executable: $PREFLIGHT_SCRIPT"
[ -z "$basic_fail" ] && ! command -v opencli >/dev/null 2>&1 && \
  basic_fail="opencli not in PATH"

if [ -n "$basic_fail" ]; then
  cat >&2 <<EOF
[opencli-preflight-guard] FAIL-CLOSED (basic self-check): $basic_fail
命令可能涉及 opencli 但 guard 核心基础设施未就绪。修复建议：
  - 检查 $PREFLIGHT_SCRIPT 是否存在且 +x
  - 检查 opencli 是否在 PATH（which opencli）
EOF
  exit 2
fi

# [1b] bypass file check is deferred to [5] (only required when scanning <site>/<cmd>)
# [2]-[5] Main decision logic in python3
python3 - "$raw_input" "$BYPASS_FILE" "$PREFLIGHT_SCRIPT" <<'PYEOF'
import json, shlex, os, subprocess, sys

raw_input, bypass_file, preflight_script = sys.argv[1], sys.argv[2], sys.argv[3]

# Verify: 'opencli verify' 顶层仅 validate + optional vitest smoke (src/cli.ts:154,
# src/verify.ts:32) — 不走浏览器，归入 TOP_BYPASS。
# 'opencli browser verify' 会在 [5] 先命中 browser → NEED_PREFLIGHT。
TOP_BYPASS = {"list", "doctor", "daemon", "help", "-h", "--help",
              "synthesize", "validate", "verify", "completion", "plugin",
              "version", "-v", "--version"}
TOP_NEED_PREFLIGHT = {"browser", "explore", "probe", "generate",
                      "record", "cascade"}
WRAPPER_SHELLS = {"bash", "zsh", "sh"}
WRAPPER_FLAGS = {"-c", "-lc", "-ic"}
MAX_WRAPPER_DEPTH = 1

# Lazy-loaded bypass set (only load when <site>/<cmd> lookup needed — avoids
# locking out recovery commands when bypass file is missing)
_bypass_set = None
def get_bypass_set():
    global _bypass_set
    if _bypass_set is not None:
        return _bypass_set
    try:
        with open(bypass_file, "r") as f:
            _bypass_set = {line.strip() for line in f
                           if line.strip() and not line.startswith("#")}
    except Exception as e:
        sys.stderr.write(
            f"[opencli-preflight-guard] FAIL-CLOSED: bypass list unreadable "
            f"({bypass_file}): {e}\n"
            f"修复：bash ~/.claude/scripts/gen-bypass-list.sh\n"
        )
        sys.exit(2)
    return _bypass_set

def fail_closed(reason):
    sys.stderr.write(f"[opencli-preflight-guard] FAIL-CLOSED: {reason}\n")
    sys.exit(2)

def fail_open():
    sys.exit(0)

# [2] Parse stdin JSON
try:
    evt = json.loads(raw_input)
    command = evt["tool_input"]["command"]
except Exception as e:
    fail_closed(f"stdin JSON parse: {e}")

def classify_occurrence(tokens, pos):
    """Evaluate a single opencli token position.
    Returns 'bypass' / 'need_preflight' / 'fail_closed:<reason>'."""
    next1 = tokens[pos + 1] if pos + 1 < len(tokens) else ""
    next2 = tokens[pos + 2] if pos + 2 < len(tokens) else ""

    if next1 in TOP_BYPASS:
        return "bypass"
    if next1 in TOP_NEED_PREFLIGHT:
        return "need_preflight"
    if next1 and next2:
        site_cmd = f"{next1}/{next2}"
        if site_cmd in get_bypass_set():
            return "bypass"
    # Unknown top-level command or unmatched <site>/<cmd>
    return "need_preflight"

def scan(cmd_str, depth=0):
    """Recursively scan cmd_str, collecting verdicts from ALL opencli occurrences
    (including those inside shell wrappers).
    Returns 'bypass' / 'need_preflight' / 'fail_closed:<reason>'."""
    try:
        tokens = shlex.split(cmd_str, posix=True)
    except ValueError as e:
        return f"fail_closed:shlex: {e}"

    verdicts = []

    # [5] Outer-level opencli token occurrences
    for i, tok in enumerate(tokens):
        # env var prefix FOO=bar (only at start of command)
        if "=" in tok and i == 0:
            continue
        if os.path.basename(tok) == "opencli":
            verdicts.append(classify_occurrence(tokens, i))

    # [3] Wrapper detection — recursively scan each inner command string
    for i, tok in enumerate(tokens):
        if os.path.basename(tok) in WRAPPER_SHELLS \
           and i + 2 < len(tokens) and tokens[i+1] in WRAPPER_FLAGS:
            inner = tokens[i+2]
            if depth + 1 > MAX_WRAPPER_DEPTH:
                return f"fail_closed:wrapper depth > {MAX_WRAPPER_DEPTH}"
            verdicts.append(scan(inner, depth + 1))

    # Merge verdicts: any fail_closed dominates; any need_preflight triggers preflight;
    # no verdicts means no independent opencli token in this scope (likely substring
    # match on opencli-autofix etc.) → fail-open at outer caller, bypass here.
    for v in verdicts:
        if isinstance(v, str) and v.startswith("fail_closed:"):
            return v
    if any(v == "need_preflight" for v in verdicts):
        return "need_preflight"
    if not verdicts:
        # No opencli token found in this scope. [0] grep may have matched a substring.
        return "bypass"
    return "bypass"  # all verdicts are bypass

result = scan(command)

if result == "bypass":
    fail_open()
elif result == "need_preflight":
    pass  # fall through to [6]
elif result.startswith("fail_closed:"):
    fail_closed(result.split(":", 1)[1])
else:
    fail_closed(f"unexpected scan result: {result}")

# [6] Run preflight with 10s internal timeout (macOS-safe)
try:
    r = subprocess.run(["bash", preflight_script],
                       timeout=10, capture_output=True, text=True)
    if r.returncode == 0:
        sys.exit(0)  # ready → fail-open
    elif r.returncode == 1:
        sys.stderr.write(r.stderr or "[preflight returned 1 with no stderr]\n")
        sys.exit(2)  # not ready → fail-closed
    else:
        sys.stderr.write(f"[opencli-preflight-guard] preflight abnormal exit={r.returncode}\n")
        sys.stderr.write(r.stderr or "")
        sys.exit(2)  # abnormal → fail-closed
except subprocess.TimeoutExpired:
    sys.stderr.write("[opencli-preflight-guard] FAIL-CLOSED: preflight timeout after 10s\n")
    sys.exit(2)
except Exception as e:
    sys.stderr.write(f"[opencli-preflight-guard] FAIL-CLOSED: preflight run error: {e}\n")
    sys.exit(2)
PYEOF
exit $?
```

```bash
chmod +x /Users/jdy/.claude/scripts/opencli_preflight_guard.sh
```

- [ ] **Step 5: 跑测试驱动**

```bash
bash /Users/jdy/.claude/scripts/test_opencli_preflight_guard.sh
```

Expected: 所有用例 PASS。如有 FAIL，用 `set -x` 或添加 `echo` 调试并修复 guard 脚本。注意：bypass list 相关用例需要 Task 5 完成后再全量跑（见 Step 6）。

- [ ] **Step 6: 记录：bypass-list-dependent case 需要 Task 5 完成后重跑**

由于 self-check 已分层（`[1a]` 基础必检 + `[1b]` bypass 文件延迟到 `[5]` 查询 `<site>/<cmd>` 时才加载），以下 case 在 Task 4 完成时即可通过：

- 非 opencli、子串非独立 token
- 顶层管理命令 bypass：`opencli list` / `doctor` / `daemon stop` / `validate` / `verify` / `completion` / `plugin` / `version`
- 顶层 NEED_PREFLIGHT：`opencli browser state` / `explore https://x.com` 等（会走到 preflight，就绪/未就绪依 0号 Chrome 状态）
- wrapper 内层是顶层 bypass：`zsh -c "opencli list"`
- wrapper 深度 ≥ 2：fail-closed
- 基础 self-check 失败（chmod -x preflight）：fail-closed

以下 case 需要 Task 5 生成的 bypass_commands.txt，Task 5 完成后再重跑（Step 7 不提前 commit）：

- `<site>/<cmd>` bypass list 查询：`opencli hackernews top` / `v2ex hot` / `36kr news` / `bloomberg/*` / `google/news` / `zsh -c "opencli hackernews top"` 等
- bypass 文件缺失且命令需 `<site>/<cmd>` 查询：fail-closed

---

## Task 5: gen-bypass-list.sh + 首次生成 bypass_commands.txt

**Files:**
- Create: `~/.claude/scripts/gen-bypass-list.sh`
- Create: `~/.claude/scripts/opencli_bypass_commands.txt`（脚本生成）

- [ ] **Step 1: 写 gen-bypass-list.sh**

Create `/Users/jdy/.claude/scripts/gen-bypass-list.sh`:

```bash
#!/usr/bin/env bash
# 由 opencli list -f json 生成命令级白名单（browser:false）
set -euo pipefail

OUT="$HOME/.claude/scripts/opencli_bypass_commands.txt"

command -v opencli >/dev/null 2>&1 || {
  echo "ERROR: opencli not in PATH" >&2
  exit 1
}

{
  echo "# 自动生成：$(date '+%Y-%m-%d %H:%M:%S')"
  echo "# 来源：opencli list -f json | (browser == false)"
  opencli list -f json \
    | python3 -c "
import json, sys
items = json.load(sys.stdin)
for x in items:
    if not x['browser']:
        print(x['command'])
" \
    | sort
} > "$OUT"

echo "[gen-bypass-list] 写入 $OUT ($(wc -l <"$OUT") 行)"
```

```bash
chmod +x /Users/jdy/.claude/scripts/gen-bypass-list.sh
```

- [ ] **Step 2: 运行生成 bypass_commands.txt**

```bash
bash /Users/jdy/.claude/scripts/gen-bypass-list.sh
```

Expected: 写入 `~/.claude/scripts/opencli_bypass_commands.txt`，约 100 多行。

- [ ] **Step 3: 抽样验证白名单内容**

```bash
head -5 /Users/jdy/.claude/scripts/opencli_bypass_commands.txt
grep -c "hackernews/" /Users/jdy/.claude/scripts/opencli_bypass_commands.txt
grep -c "v2ex/hot$" /Users/jdy/.claude/scripts/opencli_bypass_commands.txt
grep -c "36kr/news$" /Users/jdy/.claude/scripts/opencli_bypass_commands.txt
# 不应有任何 browser:true 的命令
grep -c "xiaohongshu/" /Users/jdy/.claude/scripts/opencli_bypass_commands.txt
```

Expected: 前 2 行是注释；hackernews 多于 5 行；v2ex/hot 1 行；36kr/news 1 行；xiaohongshu 0 行（xiaohongshu 全是 browser:true）。

- [ ] **Step 4: 重跑 guard 测试驱动（完整覆盖）**

```bash
bash /Users/jdy/.claude/scripts/test_opencli_preflight_guard.sh
```

Expected: 所有 fail-open case 全 PASS（包括 hackernews/v2ex 等 bypass list 相关的）。预检状态相关的 case（browser:true）返回 01（可 0 或 2，取决于 0号 Chrome 是否就绪）。

---

## Task 6: 修改 `~/.claude/settings.json`

**Files:**
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: 备份 settings.json**

```bash
cp /Users/jdy/.claude/settings.json /Users/jdy/.claude/settings.json.backup-$(date +%Y%m%d-%H%M%S)
```

- [ ] **Step 2: 追加 hooks 字段**

用 Edit 工具把 `~/.claude/settings.json` 的末尾（最后一个字段 `"skipDangerousModePermissionPrompt": true` 之后）追加：

```json
,
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash /Users/jdy/.claude/scripts/opencli_preflight_guard.sh",
            "if": "Bash(*opencli*)",
            "timeout": 20
          }
        ]
      }
    ]
  }
```

即：把原来末尾的 `"skipDangerousModePermissionPrompt": true` 行改为 `"skipDangerousModePermissionPrompt": true,`（加逗号），然后在 `}` 前插入上述 `hooks` 字段。

- [ ] **Step 3: 验证 JSON 合法**

```bash
python3 -c "import json; json.load(open('/Users/jdy/.claude/settings.json'))" && echo "JSON OK"
```

Expected: `JSON OK`。如失败，检查语法（多逗号、少逗号、引号）。

- [ ] **Step 4: 验证 hook 字段就位**

```bash
python3 -c "
import json
d = json.load(open('/Users/jdy/.claude/settings.json'))
h = d['hooks']['PreToolUse'][0]
assert h['matcher'] == 'Bash'
sub = h['hooks'][0]
assert 'opencli_preflight_guard.sh' in sub['command']
assert sub.get('if') == 'Bash(*opencli*)'
assert sub.get('timeout') == 20
print('HOOK CONFIG OK')
"
```

Expected: `HOOK CONFIG OK`。

---

## Task 7: Phase 3 验证（rollout 前 merge gate）

**Files:** 无新文件；仅运行验证。

这 4 项是 spec 定义的 hard gate，任一失败都应阻止 PR 合并。

- [ ] **Step 1: 验证项 #1 — Hook `if` 字段是否生效**

在一个新 Claude Code 会话里（或当前会话继续），跑两条命令观察：

```bash
# 先打标记
date > /tmp/guard_invoked.log
# 以 debug 形式让 guard 记录自己被调用
# 临时在 guard 脚本顶部加一行：echo "$(date) invoked: $1" >> /tmp/guard_invoked.log
```

然后让 Claude 分别跑：
- `ls -la`（不含 opencli）— 如果 `if` 生效，guard 不应被调用
- `opencli list`（含 opencli）— guard 应被调用

检查 `/tmp/guard_invoked.log`。Expected: 仅 `opencli list` 一次调用记录。

若 `if` 未生效（guard 被调了两次），这属于旧版 Claude Code 兼容性问题，guard `[0]` 预筛已兜底正确性，性能略降可接受。

验证完成后移除调试 echo 行。

- [ ] **Step 2: 验证项 #2 — Hook `timeout` 超时语义实测**

```bash
# 临时改 preflight 为 sleep 模拟超时
cp /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh \
   /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh.real

cat > /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh <<'EOF'
#!/usr/bin/env bash
sleep 60
EOF
chmod +x /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
```

在 Claude Code 会话里跑 `opencli browser state`，观察：
- 预期（A）：超时后放行 Bash 继续执行
- 预期（B）：超时后阻断 Bash
- 预期（C）：超时后 hook 报非 0 但放行

**可接受结果：只有 B**。

恢复 preflight：

```bash
mv /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh.real \
   /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
```

若实测是 A 或 C：guard 内已有 python3 subprocess 10s 兜底，即 guard 自己会先 exit 2 于 settings.json timeout 之前触发。Step 2 的行为应是 guard 在 10s 报 FAIL-CLOSED 并 exit 2，Claude Code 看到 exit 2 阻断 Bash。重跑确认。

- [ ] **Step 3: 验证项 #3 — Wrapper 递归展开**

在 Claude Code 会话里跑：

```bash
bash -lc "opencli browser state"
```

Expected: guard 识别到内层 browser 调用，触发 preflight（就绪则放行，未就绪则阻断）。

然后跑嵌套：

```bash
bash -c 'bash -c "opencli browser state"'
```

Expected: guard 识别为 wrapper 深度 2，fail-closed 阻断 Bash 执行。stderr 应包含 `"wrapper depth > 1"`。

- [ ] **Step 4: 验证项 #4 — Fail-closed 全场景**

```bash
# 场景 A：preflight 脚本不可执行
chmod -x /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh

# 在 Claude Code 跑：opencli xiaohongshu hot
# Expected: exit 2，stderr 含 "preflight not executable"

# 恢复
chmod +x /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
```

```bash
# 场景 B：bypass list 缺失
mv /Users/jdy/.claude/scripts/opencli_bypass_commands.txt{,.tmp}

# 在 Claude Code 跑：opencli hackernews top
# Expected: exit 2，stderr 含 "bypass list unreadable"

# 恢复
mv /Users/jdy/.claude/scripts/opencli_bypass_commands.txt{.tmp,}
```

验证完成：guard stderr 明确带出具体问题与修复指引。

- [ ] **Step 5: 记录验证结果**

在 `docs/superpowers/plans/2026-04-20-opencli-preflight-guard.md` 末尾追加"验证结果"小节，或在 PR 描述里贴四个验证点的实际观察。

---

## Task 8: Main repo 收尾

**Files:**
- 删除: `Main/.claude/scripts/preflight_profile0.sh`
- 删除: `Main/docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md`
- 删除: `Main/docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md`

仅在 Task 7 全部通过后才执行此任务。

- [ ] **Step 1: 进入 Main repo 并确认干净工作区**

```bash
cd /Users/jdy/Documents/Main
git status --short
```

Expected: 干净工作区（或无关的既有改动）。

- [ ] **Step 2: git rm 三个迁出文件**

```bash
cd /Users/jdy/Documents/Main
git rm .claude/scripts/preflight_profile0.sh \
       docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md \
       docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md
```

- [ ] **Step 3: 验证无其他文件仍引用旧路径**

```bash
cd /Users/jdy/Documents/Main
grep -rn "Main/.claude/scripts/preflight_profile0.sh" . 2>/dev/null | grep -v "^./.git/"
```

Expected: 若有输出（如 `K-OpenCLI插件Skills.md` 引用），记录并决定是否一并更新引用（本 plan 不含 K-OpenCLI 更新，可 jdy 决策）。

- [ ] **Step 4: Commit**

```bash
cd /Users/jdy/Documents/Main
git commit -m "chore(vault): migrate opencli-specific docs+script to opencli repo

preflight_profile0.sh 及 2026-04-18 的 spec/plan 已迁入
/Users/jdy/Documents/open_sources/opencli/。Main 下不再保留副本。"
```

- [ ] **Step 5: Push**

```bash
cd /Users/jdy/Documents/Main
git push
```

---

## Task 9: opencli PR 合并

**Files:** 无；仅合并。

- [ ] **Step 1: rebase + push opencli 分支**

```bash
cd /Users/jdy/Documents/open_sources/opencli
git fetch origin
git rebase origin/main
# 若有冲突，按 CLAUDE.md "5 份 SKILL.md blockquote 冲突处理"流程解决
git push -u origin feat/preflight-harness-hook --force-with-lease
```

- [ ] **Step 2: 创建 PR**

```bash
cd /Users/jdy/Documents/open_sources/opencli
gh pr create --base main --title "feat: opencli preflight harness hook + asset migration" --body "$(cat <<'EOF'
## Summary

- PreToolUse hook 强制 0号 Chrome 预检（harness 层兜底 skill blockquote）
- 迁回 Main vault 里的 opencli 专属 spec/plan/preflight 脚本
- 5 份 SKILL.md blockquote 精准化（browser:true/false + 通用规则置顶 + harness hook 说明）
- 项目 .claude/CLAUDE.md 同步新 harness hook 小节

## Spec / Plan

- Spec: docs/superpowers/specs/2026-04-20-opencli-preflight-guard-design.md
- Plan: docs/superpowers/plans/2026-04-20-opencli-preflight-guard.md

## Phase 3 验证（merge gate）

- [ ] Hook \`if\` 字段生效
- [ ] Hook \`timeout\` 阻断（B 结果）
- [ ] Wrapper 递归展开（深度 1 就绪/未就绪；深度 ≥ 2 fail-closed）
- [ ] Fail-closed 全场景（preflight 不可执行 / bypass list 缺失）

## Test plan

- [ ] 本地跑 \`test_opencli_preflight_guard.sh\` 全 PASS
- [ ] Phase 3 验证 4 项全绿
- [ ] Main repo 已同步迁出并 push
EOF
)"
```

- [ ] **Step 3: 等待 review / CI（当前项目无 CI）**

```bash
gh pr view --json number,state,url,mergeStateStatus
```

Expected: `mergeStateStatus: CLEAN`，可合并。

- [ ] **Step 4: 合并**

调用 `/merge-to-main` skill 或手动：

```bash
gh pr merge --merge --delete-branch
git checkout main
git pull origin main
```

---

## Rollback

如果 hook 上线后出问题，紧急关闭：

```bash
# 方案 A：让 guard 永远 exit 0（保 hook 配置，绕过逻辑）
mv ~/.claude/scripts/opencli_preflight_guard.sh{,.bak}
printf '#!/usr/bin/env bash\nexit 0\n' > ~/.claude/scripts/opencli_preflight_guard.sh
chmod +x ~/.claude/scripts/opencli_preflight_guard.sh

# 方案 B：settings.json 全量回滚
cp ~/.claude/settings.json.backup-YYYYMMDD-HHMMSS ~/.claude/settings.json
```

完整回滚：

```bash
# 1. 全局配置清空
rm -rf ~/.claude/scripts/opencli_preflight_guard.sh \
       ~/.claude/scripts/opencli_bypass_commands.txt \
       ~/.claude/scripts/gen-bypass-list.sh \
       ~/.claude/scripts/test_opencli_preflight_guard.sh
cp ~/.claude/settings.json.backup-YYYYMMDD-HHMMSS ~/.claude/settings.json

# 2. Main repo 恢复（revert 删除 commit）
cd /Users/jdy/Documents/Main && git log --oneline -5
git revert <delete-commit-hash>
git push

# 3. opencli 分支放弃（或 revert PR）
cd /Users/jdy/Documents/open_sources/opencli
git checkout main && git branch -D feat/preflight-harness-hook
```

---

## Self-Review（完成后 inline 检查清单）

- [ ] 所有 spec Section 都有对应 Task：架构（Task 4/5/6）、blockquote（Task 2）、迁移（Task 1/3/8）、验证（Task 7）、合并（Task 9）
- [ ] 无 "TBD" / "TODO" / "fill in" placeholder
- [ ] 每个代码 step 都有完整代码或具体 Edit 定位
- [ ] Commit message 格式符合 jdy 规范（`<type>(<scope>): <description>`，无 Co-Authored-By）
- [ ] 回滚方案具体可执行
