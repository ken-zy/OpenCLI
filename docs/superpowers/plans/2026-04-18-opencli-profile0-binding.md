# OpenCLI × profile_0 绑定 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 编译 opencli Browser Bridge 扩展并固定由 `chrome_multi_instance.sh` 的 0号实例独家加载；5 个 opencli 浏览器相关 skill 内置"预检 0号就绪"规则，Claude 执行这些 skill 前会自动确保 0号带扩展运行。

**Architecture:** 三条独立轨道合流 —— (A) 源码 `npm link` + `vite build` 产出扩展 → (B') 用户一次性手动 Load unpacked 装扩展到 profile_0（Chrome 147 禁用 `--load-extension`，改用原生 UI）→ (C) `preflight_profile0.sh` 以 daemon `/status` 的 `extensionConnected` 为权威判据。5 个 SKILL.md 顶部 blockquote 各引用该脚本，触发范围仅覆盖真正走 BrowserBridge 的命令（`browser <subcmd>` + `explore/generate/record/cascade` + 非 PUBLIC/LOCAL 的 site）。

**Tech Stack:** Node.js 21+, TypeScript, Vite 6, bash, Chrome Manifest V3 扩展。

**Spec 参考:** `docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md`

---

## 文件结构

| 路径 | 动作 | 说明 |
|------|------|------|
| `~/Documents/open_sources/opencli/` | `npm install && npm run build && npm link` | opencli CLI 入 PATH |
| `~/Documents/open_sources/opencli/extension/` | `npm install && npm run build` | 编译扩展到 `dist/background.js` |
| `/Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh` | **不修改** | Chrome 147 禁用 `--load-extension`；改用手动 Load unpacked |
| `/Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh` | 新建 + `chmod +x` | 预检脚本唯一正本 |
| `~/Documents/open_sources/opencli/skills/opencli-browser/SKILL.md` | 插入 blockquote | 上游脏补丁（软链接同源生效） |
| `~/Documents/open_sources/opencli/skills/opencli-explorer/SKILL.md` | 插入 blockquote | 同上 |
| `~/Documents/open_sources/opencli/skills/opencli-oneshot/SKILL.md` | 插入 blockquote | 同上 |
| `~/Documents/open_sources/opencli/skills/opencli-autofix/SKILL.md` | 插入 blockquote | 同上 |
| `~/Documents/open_sources/opencli/skills/smart-search/SKILL.md` | 插入 blockquote + 特例附加行 | 同上，多一行 PUBLIC 路由豁免 |
| `/Users/jdy/Documents/Main/30_Knowledge/K-OpenCLI插件Skills.md` | 追加一节 "本项目绑定：0号浏览器" | 正常 git commit |

---

## Task 1：前置条件 — opencli CLI 装到 PATH

**Files:**
- Modify: `~/Documents/open_sources/opencli/` (npm install + build + link)

- [ ] **Step 1.1: 确认 opencli 当前不在 PATH**

```bash
command -v opencli || echo "确认 opencli 未安装（预期）"
```
Expected: `opencli 未安装（预期）`

- [ ] **Step 1.2: 切入源码目录安装依赖**

```bash
cd /Users/jdy/Documents/open_sources/opencli
npm install
```
Expected: 依赖解析成功，无 ERR。安装时间约 30-60s。

- [ ] **Step 1.3: 编译 CLI 源码**

```bash
cd /Users/jdy/Documents/open_sources/opencli
npm run build
```
Expected: 生成 `dist/src/main.js`。检查：
```bash
ls /Users/jdy/Documents/open_sources/opencli/dist/src/main.js
```
应输出文件路径。

- [ ] **Step 1.4: 链接到全局 PATH**

```bash
cd /Users/jdy/Documents/open_sources/opencli
npm link
```
Expected: 输出形如 `/Users/jdy/.nvm/.../bin/opencli -> /Users/jdy/.nvm/.../lib/node_modules/@jackwener/opencli/dist/src/main.js`。

- [ ] **Step 1.5: 验证 opencli 可达**

```bash
command -v opencli && opencli --version
```
Expected: 输出 opencli 可执行路径 + 版本号（形如 `1.7.4`）。**此步失败则 plan 后续全部 block**，需先排查 Node 版本（需 >= 21）或 npm prefix 是否在 PATH。

- [ ] **Step 1.6: 记录 opencli 源头信息（便于调试）**

```bash
opencli --version
which opencli
readlink $(which opencli)
```
仅用于日志记录，确认命令指向源码仓库的 `dist/src/main.js`（而非全局 npm 包副本）。

---

## Task 2：编译 Browser Bridge 扩展

**Files:**
- Modify: `~/Documents/open_sources/opencli/extension/` (npm install + build)
- Produce: `~/Documents/open_sources/opencli/extension/dist/background.js`

- [ ] **Step 2.1: 切入扩展目录**

```bash
cd /Users/jdy/Documents/open_sources/opencli/extension
```

- [ ] **Step 2.2: 安装扩展专属依赖**

```bash
cd /Users/jdy/Documents/open_sources/opencli/extension
npm install
```
Expected: 安装 `@types/chrome` / `typescript` / `vite` 三个 dev deps，约 10-30s。

- [ ] **Step 2.3: 运行 vite build 编译扩展**

```bash
cd /Users/jdy/Documents/open_sources/opencli/extension
npm run build
```
Expected: 输出 `dist/background.js`。vite 只编译 `src/background.ts`，不复制 manifest/popup/icons（后者本身就在 `extension/` 根目录）。

- [ ] **Step 2.4: 验证产物完整性**

```bash
ls /Users/jdy/Documents/open_sources/opencli/extension/manifest.json \
   /Users/jdy/Documents/open_sources/opencli/extension/dist/background.js \
   /Users/jdy/Documents/open_sources/opencli/extension/popup.html \
   /Users/jdy/Documents/open_sources/opencli/extension/icons/icon-128.png
```
Expected: 4 个文件路径全部输出，无 `No such file`。

- [ ] **Step 2.5: 确认 manifest 内部引用路径未变**

```bash
grep '"service_worker"' /Users/jdy/Documents/open_sources/opencli/extension/manifest.json
```
Expected: `"service_worker": "dist/background.js"`。若值变了（比如 `dist/bg.js`），说明 opencli 升级改了结构，需同步更新 spec 的风险表条目。

---

## Task 3：~~修改 chrome_multi_instance.sh~~（**已取消**）

**取消原因**：Chrome Stable 147 silently ignores `--load-extension`（"not allowed in Google Chrome"）。加上该参数后 Chrome 明确输出警告忽略，且 `--disable-features=DisableLoadExtensionCommandLineSwitch` kill-switch 也失效。

**替代方案**：改用手动 Load unpacked（见 Task 4.5），`chrome_multi_instance.sh` **不做任何修改**。

**回滚状态**：如果已经执行了原 Task 3，脚本已通过备份文件回滚到原始状态。备份文件 `chrome_multi_instance.sh.bak.2026-04-18` 可删除。

```bash
# 清理备份（可选）
rm -f /Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh.bak.2026-04-18
```

---

## Task 4：创建预检脚本 preflight_profile0.sh

**Files:**
- Create: `/Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh`

- [ ] **Step 4.1: 确认目录存在**

```bash
mkdir -p /Users/jdy/Documents/Main/.claude/scripts
ls -d /Users/jdy/Documents/Main/.claude/scripts
```
Expected: 目录路径输出。

- [ ] **Step 4.2: 写入完整脚本内容**

将下面内容完整写入 `/Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh`：

```bash
#!/usr/bin/env bash
# preflight_profile0.sh — 0号 Chrome 浏览器预检
#
# 用途：在执行 opencli browser 或非 PUBLIC/LOCAL 的 opencli <site> 命令前调用。
# 保证 profile_0 已启动，且 Browser Bridge 扩展已连上 daemon。
#
# 扩展由用户一次性手动 Load unpacked 安装到 profile_0（见 K-OpenCLI插件Skills.md），
# 之后 Chrome 会自动持久化。本脚本不能自动装扩展。
#
# 退出码：0 = 就绪；1 = 无法就绪（需手动处理）
set -euo pipefail

PROFILE_DIR="$HOME/chrome_profiles/profile_0"
CHROME_SCRIPT="/Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh"
EXTENSION_PATH="/Users/jdy/Documents/open_sources/opencli/extension"
DAEMON_URL="http://localhost:19825"

# 0. 前置：opencli 必须在 PATH
if ! command -v opencli > /dev/null 2>&1; then
  cat >&2 <<EOF
ERROR: 未找到 opencli 命令（PATH 中没有）
预检依赖 opencli 触发 daemon 自启。请先运行：
  cd /Users/jdy/Documents/open_sources/opencli && npm link
或参见 docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md 的"前置条件"节
EOF
  exit 1
fi

# 1. 扩展是否已连上 daemon（权威：daemon /status JSON 中 extensionConnected）
#    opencli doctor 本身不设 exit code（cli.ts 只 console.log report），
#    因此必须用 daemon HTTP endpoint 判断。先跑 doctor 触发 daemon 自启副作用。
#
#    注意：daemon 无 profile 标识能力（DaemonStatus 接口不含来源字段），
#    本脚本无法辨识"扩展是否真的来自 profile_0"。依赖 K-OpenCLI插件Skills.md
#    "其他 profile 禁装扩展"的人为约束兜底。
check_daemon_ready() {
  opencli doctor > /dev/null 2>&1 || true
  curl -s -f --max-time 3 -H "X-OpenCLI: 1" "$DAEMON_URL/status" 2>/dev/null \
    | grep -q '"extensionConnected":true'
}

# 主逻辑

# Ready → exit 0
if check_daemon_ready; then
  exit 0
fi

# 未就绪：判断是否 profile_0 进程缺失
if ! pgrep -f "user-data-dir=$PROFILE_DIR" > /dev/null 2>&1; then
  # profile_0 没跑 → 启动
  "$CHROME_SCRIPT" -i 0
  sleep 3
  if check_daemon_ready; then
    exit 0
  fi
  cat >&2 <<EOF
ERROR: 0号 Chrome 已启动但扩展未连上 daemon
可能原因：
  (1) 首次使用 profile_0，还没手动装扩展
      修复：打开 0号 Chrome → chrome://extensions/ → 打开开发者模式
           → 加载已解压的扩展程序 → 选择 $EXTENSION_PATH
  (2) 扩展被禁用
      修复：chrome://extensions/ 里启用 OpenCLI 扩展
  (3) 扩展或 daemon 异常
      修复：opencli daemon stop（下次 opencli 命令会自启新的）
           然后在 chrome://extensions/ 点 OpenCLI 扩展的刷新按钮
EOF
  exit 1
fi

# profile_0 在跑但扩展未连上 → 运行时异常
cat >&2 <<EOF
ERROR: profile_0 正在运行但扩展未连上 daemon
可能原因：daemon 异常 / Chrome service worker 抖动 / 扩展被禁用
请按顺序排查：
  1. 查看 daemon 状态：curl -H "X-OpenCLI: 1" $DAEMON_URL/status
  2. 查看 daemon 日志：curl -H "X-OpenCLI: 1" $DAEMON_URL/logs
  3. 在 0号 Chrome 打开 chrome://extensions/，确认 OpenCLI 扩展已启用，点刷新按钮
  4. 若扩展列表里根本没有 OpenCLI：加载已解压的扩展程序 → 选 $EXTENSION_PATH
  5. 停 daemon（下次 opencli 命令会自启新的）：opencli daemon stop
EOF
exit 1
```

- [ ] **Step 4.3: 赋予可执行权限**

```bash
chmod +x /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh
ls -l /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh
```
Expected: `-rwxr-xr-x` 或类似，含 `x` 位。

- [ ] **Step 4.4: 语法检查**

```bash
bash -n /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh
```
Expected: 无输出（语法 OK）。

---

## Task 4.5：一次性手动 Load unpacked 扩展到 profile_0（**用户手动执行**）

**前置**：Task 2 已完成（`extension/dist/background.js` 已编译出来）。

由于 Chrome Stable 147 禁用 `--load-extension` 命令行参数，本步必须由 jdy 在 Chrome UI 里操作。

- [ ] **Step 4.5.1: 启动 profile_0（若未运行）**

```bash
pgrep -f "user-data-dir=$HOME/chrome_profiles/profile_0" > /dev/null 2>&1 \
  || /Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh -i 0
```

- [ ] **Step 4.5.2: 在 profile_0 Chrome 窗口里 Load unpacked**

1. 地址栏打开 `chrome://extensions/`
2. 右上角打开"开发者模式"（Developer mode）
3. 点"加载已解压的扩展程序"（Load unpacked）
4. 选择目录：`/Users/jdy/Documents/open_sources/opencli/extension`（manifest.json 所在根目录，**不是** `extension/dist`）
5. 扩展 "OpenCLI" v1.0.0 应出现在列表，确认开关已打开

- [ ] **Step 4.5.3: 验证扩展连上 daemon**

```bash
opencli doctor > /dev/null 2>&1
curl -s -H "X-OpenCLI: 1" http://localhost:19825/status | grep -o '"extensionConnected":[^,}]*'
```
Expected: `"extensionConnected":true`。

**持久化确认**：Chrome 将扩展元数据写入 `~/chrome_profiles/profile_0/Default/Preferences` 的 `extensions.settings`，重启 0号会自动加载，无需重装。

---

## Task 5：端到端测试扩展加载

本 task 是**验证 A + B' + C 三轨**是否正确协同的关键闸门。依赖 Task 4.5 已完成。

- [ ] **Step 5.1: 确认 profile_0 在运行**

```bash
pgrep -f "user-data-dir=$HOME/chrome_profiles/profile_0" > /dev/null 2>&1 \
  && echo "OK: profile_0 在跑" || echo "需要先启动: chrome_multi_instance.sh -i 0"
```

- [ ] **Step 5.2: 触发 daemon 自启并验证扩展连上**

```bash
opencli doctor
```
Expected 输出中包含：
- Daemon status: running
- Extension: connected

- [ ] **Step 5.3: 用 daemon HTTP /status 做权威判定**

```bash
curl -s -H "X-OpenCLI: 1" http://localhost:19825/status | grep -o '"extensionConnected":[^,}]*'
```
Expected: `"extensionConnected":true`。若为 `false`：
- 确认 Task 4.5 已完成（`chrome://extensions/` 里有 "OpenCLI" 且启用）
- 点 OpenCLI 卡片的刷新按钮
- `opencli daemon stop` 然后重跑 `opencli doctor`

- [ ] **Step 5.4: 预检脚本端到端跑通**

```bash
bash /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh && echo "OK: 预检通过"
```
Expected: `OK: 预检通过`，退出码 0。

- [ ] **Step 5.5: 端到端实跑一条浏览器命令**

```bash
opencli browser open https://example.com
sleep 2
opencli browser state | head -30
```
Expected: 0号 Chrome 打开新标签 example.com；`state` 输出结构化 DOM（包含 `[N]` 索引）。

---

## Task 6：在 4 个 SKILL.md 顶部加预检 blockquote（browser / explorer / oneshot / autofix）

smart-search 走 Task 7 单独处理（要多一行特例）。

**Files:**
- Modify: `~/Documents/open_sources/opencli/skills/opencli-browser/SKILL.md`
- Modify: `~/Documents/open_sources/opencli/skills/opencli-explorer/SKILL.md`
- Modify: `~/Documents/open_sources/opencli/skills/opencli-oneshot/SKILL.md`
- Modify: `~/Documents/open_sources/opencli/skills/opencli-autofix/SKILL.md`

**通用插入内容**（4 份文件一字不差都插这个）：

```markdown

> **本项目约定：0号浏览器预检（jdy / Main 项目，2026-04-18）**
>
> **触发预检的命令**（走 BrowserBridge，必须连 0号 Chrome）：
>
> - `opencli browser <subcmd>` — 全部 browser 子命令
> - **opencli 顶层浏览器工具命令**：`explore`（alias `probe`）/ `generate` / `record` / `cascade`
>   （`synthesize` 是本地处理，不走浏览器）
> - `opencli <site> <cmd>` — 当该 site 的 strategy **不是** `PUBLIC` / `LOCAL`
> - **兜底**：如果无法确定某命令是否走浏览器，默认预检（代价：几秒检查 vs 连错浏览器的调试时间）
>
> 预检执行：
>
> ```bash
> bash /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh
> ```
>
> 脚本会自动：① 通过 daemon `/status` 判定扩展就绪；② 需要时启动 0号；③ 若扩展未连上 daemon 给出 Load unpacked / 排查指引。失败会报错并给清理指令。
>
> **以下命令无需预检**（strategy 为 `PUBLIC` / `LOCAL`，不走浏览器）：
> `hackernews` · `v2ex` · `arxiv` · `lobsters` · 以及 `opencli list -f yaml` 中 `strategy: PUBLIC` 的所有站点。
>
> profile_0 已通过 chrome://extensions/ Load unpacked 手动装扩展；其他 profile 禁装（daemon 不能辨识来源）。

```

**插入位置规则**：frontmatter（`---` 结束行）和一级标题（`# ...`）之后、第一个二级标题（`##`）之前。若无一级标题，紧跟 frontmatter。

- [ ] **Step 6.1: 对 `opencli-browser/SKILL.md` 定位插入锚点**

```bash
head -15 /Users/jdy/Documents/open_sources/opencli/skills/opencli-browser/SKILL.md
```
记录：一级标题行内容 + 第一个二级标题行内容。

- [ ] **Step 6.2: 在 opencli-browser 一级标题后插入 blockquote**

用 Edit 工具，`old_string` 为"一级标题整行 + 紧跟的空行"，`new_string` 为原内容 + 上面那段 blockquote。

- [ ] **Step 6.3: 验证 opencli-browser 已插入**

```bash
head -30 /Users/jdy/Documents/open_sources/opencli/skills/opencli-browser/SKILL.md \
  | grep -q "0号浏览器预检" && echo "OK opencli-browser" || echo "MISS opencli-browser"
```
Expected: `OK opencli-browser`。

- [ ] **Step 6.4: 对 opencli-explorer 重复 Step 6.1-6.3**

对 `opencli-explorer/SKILL.md` 做同样操作。

- [ ] **Step 6.5: 对 opencli-oneshot 重复 Step 6.1-6.3**

对 `opencli-oneshot/SKILL.md` 做同样操作。

- [ ] **Step 6.6: 对 opencli-autofix 重复 Step 6.1-6.3**

对 `opencli-autofix/SKILL.md` 做同样操作。

- [ ] **Step 6.7: 批量验证 4 份都插入了**

```bash
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix; do
  head -40 "/Users/jdy/Documents/open_sources/opencli/skills/$s/SKILL.md" \
    | grep -q "0号浏览器预检" \
    && echo "OK  $s" || echo "MISS $s"
done
```
Expected: 4 行 `OK  ...`，无 MISS。

- [ ] **Step 6.8: 验证触发清单包含全部 4 个顶层浏览器命令**

```bash
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix; do
  doc=$(head -40 "/Users/jdy/Documents/open_sources/opencli/skills/$s/SKILL.md")
  miss=()
  for cmd in explore generate record cascade; do
    echo "$doc" | grep -qw "$cmd" || miss+=("$cmd")
  done
  if [ ${#miss[@]} -eq 0 ]; then
    echo "OK   $s"
  else
    echo "MISS $s 缺少: ${miss[*]}"
  fi
done
```
Expected: 4 行 `OK`。

---

## Task 7：在 smart-search/SKILL.md 插入 blockquote + PUBLIC 路由特例

**Files:**
- Modify: `~/Documents/open_sources/opencli/skills/smart-search/SKILL.md`

**插入内容**（通用 blockquote + 紧跟一行特例）：

```markdown

> **本项目约定：0号浏览器预检（jdy / Main 项目，2026-04-18）**
>
> **触发预检的命令**（走 BrowserBridge，必须连 0号 Chrome）：
>
> - `opencli browser <subcmd>` — 全部 browser 子命令
> - **opencli 顶层浏览器工具命令**：`explore`（alias `probe`）/ `generate` / `record` / `cascade`
>   （`synthesize` 是本地处理，不走浏览器）
> - `opencli <site> <cmd>` — 当该 site 的 strategy **不是** `PUBLIC` / `LOCAL`
> - **兜底**：如果无法确定某命令是否走浏览器，默认预检（代价：几秒检查 vs 连错浏览器的调试时间）
>
> 预检执行：
>
> ```bash
> bash /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh
> ```
>
> 脚本会自动：① 通过 daemon `/status` 判定扩展就绪；② 需要时启动 0号；③ 若扩展未连上 daemon 给出 Load unpacked / 排查指引。失败会报错并给清理指令。
>
> **以下命令无需预检**（strategy 为 `PUBLIC` / `LOCAL`，不走浏览器）：
> `hackernews` · `v2ex` · `arxiv` · `lobsters` · 以及 `opencli list -f yaml` 中 `strategy: PUBLIC` 的所有站点。
>
> profile_0 已通过 chrome://extensions/ Load unpacked 手动装扩展；其他 profile 禁装（daemon 不能辨识来源）。
>
> **smart-search 特例**：若最终路由到 PUBLIC 源（hackernews / v2ex / arxiv 等纯 API），**不触发预检**直接执行；若路由到非 PUBLIC 源（grok / doubao / gemini / xueqiu / twitter 等），按上述规则预检。

```

- [ ] **Step 7.1: 定位 smart-search 一级标题**

```bash
head -15 /Users/jdy/Documents/open_sources/opencli/skills/smart-search/SKILL.md
```
记录一级标题行。

- [ ] **Step 7.2: 用 Edit 在一级标题后插入上面的 blockquote**

`old_string` = 一级标题行 + 下一空行，`new_string` = 原内容 + 完整 blockquote（含最后那行 smart-search 特例）。

- [ ] **Step 7.3: 验证插入成功（含特例声明）**

```bash
head -50 /Users/jdy/Documents/open_sources/opencli/skills/smart-search/SKILL.md \
  | grep -q "0号浏览器预检" && echo "OK 预检段存在"
head -50 /Users/jdy/Documents/open_sources/opencli/skills/smart-search/SKILL.md \
  | grep -qE "smart-search 特例|路由到 PUBLIC" && echo "OK 特例行存在"
```
Expected: 两条都 OK。

- [ ] **Step 7.4: 验证 smart-search 触发清单完整**

```bash
doc=$(head -50 /Users/jdy/Documents/open_sources/opencli/skills/smart-search/SKILL.md)
for cmd in explore generate record cascade preflight_profile0.sh; do
  echo "$doc" | grep -qw "$cmd" && echo "OK  $cmd" || echo "MISS $cmd"
done
```
Expected: 5 行全 OK。

---

## Task 8：更新知识卡 K-OpenCLI插件Skills.md

**Files:**
- Modify: `/Users/jdy/Documents/Main/30_Knowledge/K-OpenCLI插件Skills.md`

- [ ] **Step 8.1: 定位插入锚点**

```bash
grep -n "^## 关联" /Users/jdy/Documents/Main/30_Knowledge/K-OpenCLI插件Skills.md
```
Expected: 输出 `## 关联` 所在行号。新内容要插在该行**之前**。

- [ ] **Step 8.2: 用 Edit 在 `## 关联` 之前插入新节**

`old_string` = `## 关联\n...` 开头几行（精确到唯一），`new_string` = 下面内容 + 原 `## 关联`：

```markdown
## 本项目绑定：0号浏览器（2026-04-18）

- **扩展加载路径**：`~/Documents/open_sources/opencli/extension`（manifest 所在目录；非 `dist/`）
- **编译产物**：`~/Documents/open_sources/opencli/extension/dist/background.js`（vite build 输出）
- **安装方式**：一次性手动 Load unpacked 到 profile_0 —— `chrome://extensions/` → 开启开发者模式 → 加载已解压的扩展程序 → 选 `extension/` 根目录。Chrome 会把扩展持久化到 `profile_0/Default/Preferences`，重启 0号自动加载（不走 `--load-extension` 命令行，Chrome 147 已禁用）
- **启动方式**：`chrome_multi_instance.sh -i 0`（**不**传 `--load-extension`，扩展由 Chrome 自己从 Preferences 读取）
- **预检脚本**：`~/Documents/Main/.claude/scripts/preflight_profile0.sh`（唯一正本），以 daemon `/status` 的 `extensionConnected` 为权威判据。**不要**依赖 `opencli doctor` 的退出码 —— `src/cli.ts:750-755` 只打印报告，不设 `process.exitCode`
- **预检触发**：5 个 skill（browser / explorer / oneshot / autofix / smart-search）的 SKILL.md 顶部 blockquote 各引用一次脚本
- **触发预检的命令集**：
  - `opencli browser <subcmd>` 所有子命令
  - 顶层浏览器工具：`explore`（alias `probe`）/ `generate` / `record` / `cascade`（`synthesize` 是本地处理，不走浏览器）
  - `opencli <site> <cmd>` 当 site strategy ≠ PUBLIC/LOCAL
  - 拿不准时默认预检
- **豁免**：PUBLIC/LOCAL 站点（`hackernews` / `v2ex` / `arxiv` / `lobsters` 等纯 API 查询）
- **升级流程**：opencli 仓库 `git pull` → `cd extension && npm run build` → 在 `chrome://extensions/` OpenCLI 卡片点刷新按钮（无需重启 0号，无需重装）
- **约束边界**：软约束，只覆盖 Claude 调 opencli skill 路径；终端直调靠用户自觉

主 Chrome 与 profile_1~6 禁装 Browser Bridge 扩展 —— daemon 不能辨识扩展来源 profile，装多处会连错实例。

## 关联
```

（原有 `## 关联` 下面的内容保持不动。）

- [ ] **Step 8.3: 验证新节写入**

```bash
grep -n "本项目绑定：0号浏览器" /Users/jdy/Documents/Main/30_Knowledge/K-OpenCLI插件Skills.md
grep -c "preflight_profile0.sh" /Users/jdy/Documents/Main/30_Knowledge/K-OpenCLI插件Skills.md
```
Expected: 第一条输出新节的行号；第二条输出 `1`（含 1 次脚本引用）。

- [ ] **Step 8.4: 确认 `## 关联` 节本身未被破坏**

```bash
grep -n "\[\[A-AI与工具\]\]" /Users/jdy/Documents/Main/30_Knowledge/K-OpenCLI插件Skills.md
```
Expected: 找到原有的 `[[A-AI与工具]]` 链接，说明 `## 关联` 节内容完整保留。

---

## Task 9：端到端验证清单（spec 验证节 0-11 条）

按 spec 的验证清单 0-11 条逐条跑一遍。任何一条 FAIL/MISS 都表示前面 Task 没做好，需回溯。

- [ ] **Step 9.1: #0 前置 opencli 可达**

```bash
command -v opencli && opencli --version
```
Expected: 输出路径和版本号。

- [ ] **Step 9.2: #1 干净环境（先杀 0号再测）**

```bash
pkill -f "user-data-dir=$HOME/chrome_profiles/profile_0" 2>/dev/null || true
sleep 1
pgrep -f "user-data-dir=$HOME/chrome_profiles/profile_0" && echo "FAIL" || echo "OK"
```
Expected: `OK`。

- [ ] **Step 9.3: #2 编译产物就位**

```bash
ls /Users/jdy/Documents/open_sources/opencli/extension/manifest.json \
   /Users/jdy/Documents/open_sources/opencli/extension/dist/background.js
```
Expected: 两个路径都输出。

- [ ] **Step 9.4: #3 启动 0号**

```bash
/Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh -i 0
sleep 3
```

- [ ] **Step 9.5: #4 daemon /status 权威判定**

```bash
opencli doctor > /dev/null 2>&1
curl -s -f -H "X-OpenCLI: 1" http://localhost:19825/status | grep -q '"extensionConnected":true' \
  && echo "OK: extension connected" || echo "FAIL: extension not connected"
```
Expected: `OK: extension connected`。

- [ ] **Step 9.6: #5 预检脚本端到端**

```bash
bash /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh && echo "OK: 预检通过"
```
Expected: `OK: 预检通过`，退出码 0。

- [ ] **Step 9.7: #6 实跑浏览器命令**

```bash
opencli browser open https://example.com && opencli browser state | head -15
```
Expected: 标签打开成功；state 输出结构化 DOM。

- [ ] **Step 9.8: #7 5 个 SKILL.md 预检段都在**

```bash
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  head -40 "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" | grep -q "0号浏览器预检" \
    && echo "OK  $s" || echo "MISS $s"
done
```
Expected: 5 行全 OK。

- [ ] **Step 9.9: #8 5 个 skill 包含 PUBLIC/LOCAL 豁免声明**

```bash
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  grep -qE "PUBLIC|LOCAL" "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" \
    && grep -qE "跳过|不触发|无需|豁免" "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" \
    && echo "OK   $s" || echo "MISS $s"
done
```
Expected: 5 行全 OK。

- [ ] **Step 9.10: #9 smart-search 有 PUBLIC 路由特例声明**

```bash
grep -qE "smart-search 特例|路由到 PUBLIC" \
  "/Users/jdy/Documents/Main/.claude/skills/smart-search/SKILL.md" \
  && echo "OK: 特例声明存在" || echo "FAIL"
```
Expected: `OK: 特例声明存在`。

- [ ] **Step 9.11: #10 5 个 skill 引用了预检脚本路径**

```bash
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  head -40 "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" \
    | grep -qF "preflight_profile0.sh" \
    && echo "OK  $s" || echo "MISS $s"
done
```
Expected: 5 行全 OK。

- [ ] **Step 9.12: #11 5 个 skill 触发清单包含 4 个顶层浏览器命令**

```bash
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  doc=$(head -40 "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md")
  miss=()
  for cmd in explore generate record cascade; do
    echo "$doc" | grep -qw "$cmd" || miss+=("$cmd")
  done
  if [ ${#miss[@]} -eq 0 ]; then
    echo "OK   $s"
  else
    echo "MISS $s 缺少: ${miss[*]}"
  fi
done
```
Expected: 5 行 `OK`。

---

## Task 10：Main 仓库 git commit

本方案中**只有 Main 仓库的文件会正常 commit**。opencli 源目录的修改（5 份 SKILL.md + `extension/dist/background.js`）视为本地脏状态不 commit。`chrome_multi_instance.sh` 是否入 git 由该仓库自行决定（本计划不管）。

- [ ] **Step 10.1: 查看 Main 仓库要 commit 的文件**

```bash
cd /Users/jdy/Documents/Main
git status
```
Expected 看到至少：
- `docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md` (new)
- `docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md` (new)
- `.claude/scripts/preflight_profile0.sh` (new)
- `30_Knowledge/K-OpenCLI插件Skills.md` (modified)

- [ ] **Step 10.2: 检查 .gitignore 是否把预检脚本意外排除**

```bash
cd /Users/jdy/Documents/Main
git check-ignore .claude/scripts/preflight_profile0.sh 2>&1 | head -1
```
Expected: 无输出（脚本**未被**ignore，会进 git）。若被 ignore 了，暂停，检查 `.gitignore` 里的 `.claude/` 相关规则。

- [ ] **Step 10.3: 分步 add**

```bash
cd /Users/jdy/Documents/Main
git add docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md
git add docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md
git add .claude/scripts/preflight_profile0.sh
git add 30_Knowledge/K-OpenCLI插件Skills.md
git status
```
Expected: 4 个文件在 `Changes to be committed`。

- [ ] **Step 10.4: Commit（遵循 CLAUDE.md 规则，不带 Claude 署名）**

```bash
cd /Users/jdy/Documents/Main
git commit -m "feat(opencli): 绑定 Browser Bridge 扩展到 0号 Chrome + 写入预检脚本与 skill 规则

- 新增 spec: docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md
- 新增 plan: docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md
- 新增预检脚本: .claude/scripts/preflight_profile0.sh（以 daemon /status extensionConnected 为权威判据）
- K-OpenCLI插件Skills.md 追加 0号绑定章节
"
```
Expected: 创建一个新 commit，无 hook 失败。

- [ ] **Step 10.5: 验证 commit 落地**

```bash
cd /Users/jdy/Documents/Main
git log -1 --stat
```
Expected: 最新 commit 含 4 个文件改动。

---

## 收尾与交付检查

- [ ] **全部 Task 1-10 复核**：每个 Step 的 checkbox 都勾选（注：Task 3 已取消、Task 4.5 为用户手动步骤）
- [ ] **Task 9 端到端 12 条验证全部 OK/PASS**
- [ ] **opencli 源目录的脏状态是预期内**：`cd ~/Documents/open_sources/opencli && git status` 应看到 5 份 SKILL.md + `extension/dist/background.js` 被修改；这些**不向上游提交**
- [ ] **重启 Claude Code 会话**后 `/opencli-browser`、`/smart-search` 等应能正常加载带预检段的 SKILL.md

---

## 遇到问题时的回退步骤

若 Task 5（端到端测试）失败：
1. 保留 0号 Chrome 的 log：`/Users/jdy/Documents/open_sources/opencli/logs/` 如有
2. `curl -H "X-OpenCLI: 1" http://localhost:19825/logs`
3. 在 0号 Chrome 打开 `chrome://extensions`，确认 "OpenCLI" 扩展已加载且启用

Task 3 已取消（`chrome_multi_instance.sh` 不再改动）。若过去执行过原 Task 3，可通过备份恢复：
```bash
cp /Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh.bak.2026-04-18 \
   /Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh
```

若 Task 6/7 在 opencli 源仓库里改错 SKILL.md 想回滚：
```bash
cd /Users/jdy/Documents/open_sources/opencli
git checkout -- skills/opencli-browser/SKILL.md skills/opencli-explorer/SKILL.md \
                skills/opencli-oneshot/SKILL.md skills/opencli-autofix/SKILL.md \
                skills/smart-search/SKILL.md
# 然后重新执行 Task 6/7
```

若 opencli global 链接冲突（Task 1）：
```bash
npm unlink -g @jackwener/opencli
# 然后重跑 Task 1
```
