# OpenCLI × profile_0 绑定：编译扩展 + 独占 0号浏览器

**日期**：2026-04-18
**作者**：jdy
**状态**：Spec（待执行）

## 背景与目标

jdy 的 Main 项目已通过软链接安装了 6 个 opencli skill（`opencli-autofix` / `opencli-browser` / `opencli-explorer` / `opencli-oneshot` / `opencli-usage` / `smart-search`）。现在需要：

1. 编译 `~/Documents/open_sources/opencli/extension/` 产出 Chrome 扩展
2. 让扩展**通过一次性手动 Load unpacked 安装到** `chrome_multi_instance.sh` 管理的 0号 Chrome 实例（`profile_0`）
3. 固定所有 opencli 浏览器自动化走 0号，主 Chrome 和 `profile_1~6` 不参与

0号实例在 `chrome_multi_instance.sh` 中本就特殊化（独家开启 `--remote-debugging-port=0`），是为自动化预留的实例。Chrome Stable 147 已禁用 `--load-extension` 命令行参数（Google 政策层面的限制）；本方案改用 Chrome 原生的 Load unpacked UI 操作，由用户一次性手动装扩展，Chrome 会将扩展持久化在 `profile_0/Default/Preferences`，之后重启 0号会自动加载。

## 非目标

- 不改动 opencli 官方默认通信协议（继续走 Browser Bridge 扩展，不启用 `OPENCLI_CDP_ENDPOINT` CDP 直连）
- 不改 1-6 号实例（保持其反 Cloudflare 检测特性）
- 不修改 opencli 源码逻辑（仅在 5 个 skill 的 SKILL.md 顶部加本项目私有的"预检段落"作为上游脏补丁）
- **不保证终端直接手敲 `opencli ...` 走 0号** —— 本方案是**软约束**，只约束"Claude 执行 opencli 相关 skill"这一路径。终端直调依赖用户自觉。升级为硬约束（wrapper 脚本 / PreToolUse hook）在澄清阶段已讨论并否决
- **不能探测扩展实际来源于哪个 Chrome profile** —— opencli daemon 的健康模型只知道"有扩展连上"（见 `src/browser/daemon-client.ts` 的 `DaemonStatus` 接口），不知道背后是 profile_0 还是其他 Chrome 实例。本方案依赖"只在 profile_0 手动 Load unpacked 装扩展、其他实例禁装"的人为约束兜底，无法检测误装场景
- **PUBLIC / LOCAL 命令不需要浏览器** —— opencli 明确区分 browser 命令和站点适配器（`src/registry.ts:147-148`：strategy 为 PUBLIC/LOCAL 时 `browser=false`）。`hackernews` / `v2ex` / `arxiv` 等纯 API 查询无需预检，本方案**不**把这类命令绑到 0号
- **不自动安装扩展到 profile_0** —— Chrome 147 禁用 `--load-extension` 参数；本方案依赖用户一次性通过 `chrome://extensions/` Load unpacked 手动安装。装完后 Chrome 持久化扩展到 `profile_0/Default/Preferences`，重启自动生效

## 前置条件（必须先完成）

**opencli CLI 必须可在 PATH 调用**。当前机器上 `command -v opencli` 返回 `not found`，直接实施本方案会在预检脚本的 `opencli doctor` 那一步 shell-level 失败。

opencli 仓库本身只通过 `package.json` 的 `bin` 字段声明二进制入口（`"bin": { "opencli": "dist/src/main.js" }`），不会自动进 PATH。选一种方式落地：

### A. 源码 `npm link`（推荐，适合本方案场景）

理由：本方案会修改 opencli 源目录的 5 个 SKILL.md（上游脏补丁），且扩展通过 Load unpacked 指向源码 `extension/` 目录；用 `npm link` 能让 `opencli` 命令与修改的源目录**同源**，不出现"CLI 走 global、skill 走源码"的错位。

```bash
cd ~/Documents/open_sources/opencli
npm install
npm run build      # 编译 src/ → dist/src/
npm link           # 把 bin 注册到全局 PATH（需 sudo 或 nvm 管理的 node 目录）
command -v opencli # 应返回 <node-bin>/opencli
```

升级时：`git pull && npm install && npm run build`，不用重跑 `npm link`。

### B. 全局 npm 包（opencli README 推荐）

```bash
npm install -g @jackwener/opencli
command -v opencli
```

升级：`npm update -g @jackwener/opencli`。

**注意**：方式 B 装的 CLI 与 `~/Documents/open_sources/opencli/` 源目录**版本可能不同步**；本方案的 skill 补丁在源目录，CLI 在全局包 —— 会出现"命令行为与 SKILL.md 描述不一致"的漂移。仅当 jdy 不频繁修改 opencli 源码时再选 B。

### 验证前置条件

执行后续任何步骤前都先跑：

```bash
command -v opencli && opencli --version
```

任何方式都应输出 opencli 的路径和版本号；否则停下来先解决 PATH 问题。

## 架构

```
┌─────────────────────────┐      ┌─────────────────────────┐
│ Claude 执行 opencli skill│      │ 终端手敲 opencli ...    │
│ (browser/explorer/…)    │      │ (不在软约束范围内)      │
└────────────┬────────────┘      └────────────┬────────────┘
             │                                │
             │ skill SKILL.md blockquote 要求  │  绕过预检，直接
             │ 先跑预检脚本                    │  执行 opencli CLI
             ▼                                │
┌─────────────────────────────┐               │
│ preflight_profile0.sh 脚本  │               │
│ ① opencli doctor (副作用):   │               │
│    触发 daemon 自启 + live-probe            │
│ ② curl daemon /status :     │               │
│    grep '"extensionConnected":true'         │
│ ③ 必要时 chrome_multi_instance.sh -i 0      │
│ ④ 启动后二次验证 (①②)      │               │
│                             │               │
│ 命令若是 PUBLIC/LOCAL → 跳过 │               │
└────────────┬────────────────┘               │
             │ 预检通过才放行                   │
             ▼                                ▼
┌─────────────────────────────────────────────────────────┐
│ opencli CLI → daemon (:19825, 按需自启)                  │
│   ▼ WebSocket 反向连接                                   │
│ Browser Bridge 扩展 (手动 Load unpacked 装入 profile_0) │
│   ▼ Chrome DevTools Protocol                            │
│ 0号 Chrome (profile_0)                                  │
│   - --remote-debugging-port=0   (原脚本保留)            │
│   - 扩展从 Preferences 持久化加载 (不走命令行参数)      │
└─────────────────────────────────────────────────────────┘
```

**图例说明**：左侧 Claude 路径走预检脚本（软约束生效）；右侧终端直调绕过预检（spec 非目标第 4 条明示不保证）。两条路径最终都通过 opencli CLI → daemon → 扩展 → Chrome 的标准栈。

**关键隔离**：
- 扩展只手动 Load unpacked 到 profile_0，其他实例（主 Chrome / 1-6号）禁装
- `chrome_multi_instance.sh` 脚本保持不变（无需修改，选 ② 之后回滚了 Task 3 的 `--load-extension` 改动）
- 主 Chrome 经确认未装 Browser Bridge 扩展，无需清理
- opencli 升级时 `cd extension && npm run build` + 重启 0号 → 扩展自动走新版

## 组件变更

### A. 编译扩展（一次性 + 每次升级时重做）

位置：`/Users/jdy/Documents/open_sources/opencli/extension/`

```bash
cd /Users/jdy/Documents/open_sources/opencli/extension
npm install    # 首次
npm run build  # vite build → extension/dist/
```

产物路径：`/Users/jdy/Documents/open_sources/opencli/extension/dist/background.js`（仅此一个编译产物）。

**注意**：`manifest.json` / `popup.html` / `icons/` 等**在 `extension/` 根目录**，不在 dist 里。Chrome 加载扩展时 Load unpacked 必须选 `extension/` **根目录**（manifest.json 所在位置），manifest 内部以相对路径引用 `dist/background.js`。

**副作用**：opencli 仓库 `.gitignore` 第 3 行 `!extension/dist/` 强制追踪 dist，`git status` 会出现 `dist/background.js` 改动；视为本机私有脏状态，不向上游提交。

### B. ~~修改 `chrome_multi_instance.sh`~~（**已取消** —— 因 Chrome 147 禁用 `--load-extension`）

**原计划**：在 0号分支的 `debug_args` 加 `--load-extension=/Users/jdy/Documents/open_sources/opencli/extension`。

**取消原因**：Chrome Stable 147 silently ignores `--load-extension`（"not allowed in Google Chrome"）—— 测试中 Chrome 明确输出 `WARNING: --load-extension is not allowed in Google Chrome, ignoring.`，且 `--disable-features=DisableLoadExtensionCommandLineSwitch` kill-switch 也失效。

**替代**：扩展改用 Chrome 原生 UI 一次性 Load unpacked 安装（见组件 B'）；`chrome_multi_instance.sh` **不做任何修改**。

### B'. 一次性手动 Load unpacked 扩展到 profile_0

**操作**（一次性，由用户执行）：
1. 在 profile_0 Chrome 窗口打开 `chrome://extensions/`
2. 右上角打开"开发者模式"（Developer mode）
3. 点"加载已解压的扩展程序"（Load unpacked）
4. 选择目录：`/Users/jdy/Documents/open_sources/opencli/extension`（manifest.json 所在根目录，不是 `extension/dist`）
5. 扩展 "OpenCLI" v1.0.0 出现在列表，确认已启用

**持久化**：Chrome 将扩展元数据写入 `~/chrome_profiles/profile_0/Default/Preferences` 的 `extensions.settings` 字段。profile_0 之后重启会自动加载该扩展，**不需要命令行参数**。

**升级**：opencli 源码更新后，重跑 `cd extension && npm run build` 重新生成 `dist/background.js`；在 `chrome://extensions/` OpenCLI 卡片点"刷新"按钮即生效（无需重装）。

**约束**：主 Chrome 和 profile_1~6 **禁止** Load unpacked 此扩展 —— 因为 opencli daemon 不能辨识扩展来源 profile（`DaemonStatus` 接口无 profile 字段），装多处会导致 daemon 连错 Chrome。

### C. 新增预检脚本 `preflight_profile0.sh`

**路径**：`/Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh`

**动机**：预检逻辑较复杂（daemon HTTP 判定 + profile_0 进程存活判定 + 启动后二次验证）；若直接内联到 5 份 SKILL.md 会变成维护地狱。抽成单一正本脚本，5 个 SKILL.md 只调用脚本。

**内容**（`set -euo pipefail` 省略，按标准 bash header 写）：

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

# 1. 扩展是否已连上 daemon（权威:daemon /status JSON 中 extensionConnected）
#    opencli doctor 本身不设 exit code（cli.ts 只 console.log report），
#    因此必须用 daemon HTTP endpoint 判断。先跑 doctor 触发 daemon 自启副作用。
#
#    注意:daemon 无 profile 标识能力（DaemonStatus 接口不含来源字段），
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

**可执行权限**：落地时 `chmod +x` 赋予。

### D. 5 个 SKILL.md 顶部加预检段落

**受影响文件**（通过软链接指向上游，直接写入意味着改上游仓库源码）：
- `~/Documents/open_sources/opencli/skills/opencli-browser/SKILL.md`
- `~/Documents/open_sources/opencli/skills/opencli-explorer/SKILL.md`
- `~/Documents/open_sources/opencli/skills/opencli-oneshot/SKILL.md`
- `~/Documents/open_sources/opencli/skills/opencli-autofix/SKILL.md`
- `~/Documents/open_sources/opencli/skills/smart-search/SKILL.md`

**不动**：`opencli-usage/SKILL.md`（纯命令速查，无浏览器触发）

**插入位置**：frontmatter（`---` 结束行）和一级标题（`# ...`）之后、第一个二级标题（`##`）之前。若该 skill 无一级标题，则紧跟 frontmatter 插入。

**插入内容**（通用 blockquote，所有 5 份 skill 一致）：

~~~markdown

> **本项目约定：0号浏览器预检（jdy / Main 项目，2026-04-18）**
>
> **触发预检的命令**（走 BrowserBridge，必须连 0号 Chrome）：
>
> - `opencli browser <subcmd>` — 全部 browser 子命令
> - **opencli 顶层浏览器工具命令**：`explore`（alias `probe`）/ `generate` / `record` / `cascade`（经精确 grep 验证走 BrowserBridge；`synthesize` 是纯本地文件处理，不走浏览器）
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
> `hackernews` · `v2ex` · `arxiv` · `lobsters` · 以及 `opencli list -f yaml` 中 `strategy: PUBLIC` 的所有站点。可通过 `opencli list -f yaml` 查看目标 site 的 strategy。
>
> 不得在主 Chrome 或 profile_1~6 中运行 opencli —— 其他实例未装扩展，不参与自动化。
~~~

**smart-search 额外附加一行**（紧跟上面 blockquote 之后）：

~~~markdown
> **smart-search 特例**：若最终路由到 PUBLIC 源（hackernews / v2ex / arxiv 等纯 API），**不触发预检**直接执行；若路由到非 PUBLIC 源（grok / doubao / gemini / xueqiu / twitter 等），按上述规则预检。
~~~

**逻辑要点**：
1. 预检以 **daemon `/status` HTTP endpoint** 为真相（opencli doctor 不设 exit code，`src/cli.ts:750-755` 只打印报告）
2. `ps` 命令行签名校验能检测"旧 profile_0 进程无扩展"场景；但**不能**辨识"扩展是否来自 profile_0"（daemon 无此能力，`DaemonStatus` 无来源字段）
3. **PUBLIC / LOCAL 命令跳过预检** —— 尊重 opencli `src/registry.ts:147-148` 的 strategy 分类，避免阻塞纯 API 查询

### E. 更新知识卡 `K-OpenCLI插件Skills.md`

路径：`/Users/jdy/Documents/Main/30_Knowledge/K-OpenCLI插件Skills.md`

在卡片末尾、`## 关联` 之前，追加一节：

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

主 Chrome 与 profile_1~6 禁装 Browser Bridge 扩展 —— 否则 daemon 会连错实例。
```

## 错误处理

| 场景 | 预检现象 | 处理策略 |
|------|---------|---------|
| 0号未启动 | daemon `/status` 不通 或 `extensionConnected:false` + `pgrep` 空 | 脚本自动启动 0号，sleep 3 后二次验证；仍失败则报错中止 |
| **首次使用，profile_0 未装扩展** | daemon `extensionConnected:false` + `chrome://extensions/` 里无 OpenCLI | 用户在 `chrome://extensions/` 开启开发者模式 → Load unpacked → 选 `extension/` 根目录 |
| 扩展编译产物缺失（`dist/background.js` 不存在） | daemon `extensionConnected:false` + `chrome://extensions/` 里没有 OpenCLI 项或其刷新报错 | 运行 `cd extension && npm install && npm run build` 后在 `chrome://extensions/` 点 OpenCLI 刷新按钮 |
| **profile_0 已运行，但 daemon/扩展不健康**（service worker 抖动、扩展暂断、daemon 异常、扩展被禁用） | daemon `/status` 连不通或 `extensionConnected:false` + profile_0 进程存在 | 脚本显式识别并报错（不再重启 0号，避免污染会话）；报错中给出 daemon status/logs、`opencli daemon stop`、`chrome://extensions/` 刷新等排查步骤 |
| daemon 端口 19825 被占（罕见：非 opencli 的进程占用） | curl `/status` 返回非预期内容 | 脚本落入"进程在跑但扩展未连"分支报错；根治需 `lsof -i :19825` 排查占用进程，不在本方案范围 |
| 主 Chrome 或 profile_1~6 意外装了扩展 | daemon 静默连错实例；预检脚本无法识别（`DaemonStatus` 不含 profile 来源字段） | 已确认未装；若未来装上，必须在该实例 `chrome://extensions/` 禁用/移除 Browser Bridge；依赖 K 卡禁装约束 |

## 验证清单

实施完毕后依次执行：

```bash
# 0. 前置：opencli CLI 可达（硬阻塞，必须先过）
command -v opencli && opencli --version   # 输出路径 + 版本号

# 1. 0号当前未运行（干净环境）
pgrep -f "user-data-dir=$HOME/chrome_profiles/profile_0"   # 无输出

# 2. 扩展根目录 + 编译产物同时就位（manifest 在根，background.js 在 dist）
ls /Users/jdy/Documents/open_sources/opencli/extension/manifest.json \
   /Users/jdy/Documents/open_sources/opencli/extension/dist/background.js

# 3. 启动 0号（扩展应自动加载）
/Users/jdy/Documents/web3/ChromeScript/chrome_multi_instance.sh -i 0
sleep 3

# 4. daemon /status 权威判定（opencli doctor 不设 exit code，不能作为判据）
opencli doctor > /dev/null 2>&1
curl -s -f -H "X-OpenCLI: 1" http://localhost:19825/status | grep -q '"extensionConnected":true' \
  && echo "OK: extension connected" || echo "FAIL: extension not connected"

# 5. 预检脚本端到端
bash /Users/jdy/Documents/Main/.claude/scripts/preflight_profile0.sh && echo "OK: 预检通过"

# 6. 实跑浏览器命令
opencli browser open https://example.com && opencli browser state

# 7. 5 个 SKILL.md 预检段都在
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  head -30 "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" | grep -q "0号浏览器预检" \
    && echo "OK  $s" || echo "MISS $s"
done

# 8. 5 个 skill 文档中正确声明了"PUBLIC/LOCAL 跳过预检"
#    (注：终端直跑 opencli hackernews 是绕开 skill 的，无法验证 skill 文档内容)
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  grep -qE "PUBLIC|LOCAL" "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" \
    && grep -qE "跳过|不触发|无需|豁免" "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" \
    && echo "OK   $s: 有 PUBLIC/LOCAL 豁免声明" \
    || echo "MISS $s: 缺少 PUBLIC/LOCAL 豁免声明"
done

# 9. smart-search 有 PUBLIC 路由特例声明（独有要求）
grep -qE "smart-search 特例|路由到 PUBLIC" \
  "/Users/jdy/Documents/Main/.claude/skills/smart-search/SKILL.md" \
  && echo "OK   smart-search PUBLIC 路由特例声明存在"

# 10. 5 个 skill 顶部都引用了预检脚本路径
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  head -40 "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md" \
    | grep -qF "preflight_profile0.sh" \
    && echo "OK   $s 已引用预检脚本" \
    || echo "MISS $s 未引用预检脚本"
done

# 11. 5 个 skill 触发清单包含 opencli 顶层浏览器命令（explore / generate / record / cascade）
#     防止 agent 按文案字面执行时漏掉这些走 BrowserBridge 的非-browser 命令
#     注：synthesize 不在清单（cli.ts:205-214 只调 synthesizeFromExplore，纯本地文件处理）
for s in opencli-browser opencli-explorer opencli-oneshot opencli-autofix smart-search; do
  doc=$(head -40 "/Users/jdy/Documents/Main/.claude/skills/$s/SKILL.md")
  miss=()
  for cmd in explore generate record cascade; do
    echo "$doc" | grep -qw "$cmd" || miss+=("$cmd")
  done
  if [ ${#miss[@]} -eq 0 ]; then
    echo "OK   $s 列出全部 4 个顶层浏览器命令"
  else
    echo "MISS $s 缺少: ${miss[*]}"
  fi
done
```

全部通过即视为落地成功。

## 执行顺序与依赖

```
0. 前置条件：opencli 装到 PATH （A/B 二选一，见"前置条件"节） ──► command -v opencli
                   │（前置通过才能继续）
                   ▼
1. 编译扩展 (A)
2. 写预检脚本 (C)
3. 一次性手动 Load unpacked (B') ← 用户手动操作
4. 改 5 份 SKILL.md (D)
5. 更新 K-OpenCLI 卡 (E)
6. 跑完整验证清单（0-11 条）
```

**步骤 0 是硬阻塞**：没装 opencli，后续任何 `opencli doctor` / `opencli browser` / 预检脚本都 shell-level 失败。
A / C 相互独立可并行；B' 依赖 A（需要已编译扩展才能 Load unpacked）；D 依赖 C（引用脚本）；E 总收尾；验证必须最后统一跑。

## 文件变更汇总

| 文件 | 动作 | 归属 | git 影响 |
|------|------|------|---------|
| （**前置**）`opencli` 安装到 PATH | `npm link` 于源目录 或 `npm install -g @jackwener/opencli` | 全局/本地 node_modules | 不入 git |
| `opencli/extension/dist/background.js` | `npm run build` 生成 | 上游 opencli 仓库 | dist 被 `!extension/dist/` 强制追踪，`git status` 脏 |
| `Main/.claude/scripts/preflight_profile0.sh` | **新建**共享预检脚本 + `chmod +x` | Main | 正常 commit |
| `opencli/skills/{browser,explorer,oneshot,autofix,smart-search}/SKILL.md` | 各加 blockquote 预检段（smart-search 多一行特例） | 上游 opencli 仓库 | 5 个未提交修改，视为本地脏状态 |
| `Main/30_Knowledge/K-OpenCLI插件Skills.md` | 追加一节 "本项目绑定：0号浏览器" | Main Vault | 正常 commit |
| `Main/docs/superpowers/specs/2026-04-18-*-design.md` | 新建本 spec | Main | 正常 commit |

## 风险与缓解

| 风险 | 可能后果 | 缓解 |
|------|---------|------|
| opencli 仓库 `git pull` 后上游 SKILL.md 有变更，与本地脏补丁冲突 | 合并冲突 | 升级前先备份 5 个 SKILL.md 的 blockquote 段，pull 后重新粘贴；长期可考虑转 δ-a 方案（断软链+复制） |
| Chrome 开发者模式警告栏（"开发者模式扩展可能威胁您的隐私"） | 视觉噪音 | 每次启动 profile_0 会出现；点 × 关闭不影响功能；profile_0 本就是自动化专用实例 |
| opencli 升级后 `src/background.ts` 逻辑变或 manifest 改动 | 扩展功能漂移 | `npm run build` 后在 `chrome://extensions/` 点 OpenCLI 刷新按钮 |
| **扩展被误装到主 Chrome 或 profile_1~6** | daemon 静默连错 Chrome 实例；预检无法识别（已在非目标列出） | 依赖人为约束："只在 profile_0 装扩展"；发现后必须在该实例 `chrome://extensions` 禁用/移除；若反复发生，考虑在 `chrome_multi_instance.sh` 其他分支加显式 `--disable-extensions` |
| opencli 升级后 daemon `/status` JSON 字段重命名或 endpoint 变更 | 预检脚本 grep 失配 → 误判扩展未就绪 | 预检脚本本地保留版本；如 opencli >= 某版本变更字段，按 `src/daemon.ts:120-135` 同步改 grep 模式 |

## 后续（不在本方案范围内）

- 考虑写 `update-opencli-skills.sh` 脚本：自动化 "pull opencli + build extension + 重贴 5 个 SKILL.md 补丁" 的升级流程
- 若未来需要让终端手敲 `opencli ...` 也自动预检（非 Claude 路径），再评估 wrapper 脚本 `opencli-0` 方案（原澄清 β）

---

**Spec 结束。下一步：writing-plans 拆解成可执行的 step-by-step 实施计划。**
