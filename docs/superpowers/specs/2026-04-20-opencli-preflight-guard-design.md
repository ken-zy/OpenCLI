# opencli 0号 Chrome 预检 harness hook 设计

- 日期：2026-04-20
- 作者：jdy / Claude (Opus 4.7)
- 状态：设计定稿，待实施
- 关联前置：[2026-04-18-opencli-profile0-binding-design.md](2026-04-18-opencli-profile0-binding-design.md)

## 背景

2026-04-18 的 0号 Chrome 绑定方案依赖 6 份 SKILL.md 里的 blockquote 提醒 Claude：「执行 opencli 浏览器相关命令前先跑 `preflight_profile0.sh`」。实际使用中发现：

1. 规则是**文档层**的，依赖 Claude 读到并正确理解 blockquote。一旦漏读（长会话 context 靠后、skill 未激活等）就会直接连错浏览器。
2. blockquote 原来的三条触发场景被视觉层级误导成「枚举完毕」，Claude 遇到 `opencli <site> <cmd>` 形态时常以为「已覆盖前两条就不用预检」。
3. 原判断标准 `strategy != PUBLIC/LOCAL` 在数据层有 bug：`36kr/hot` 是 `strategy: public` 却 `browser: true`，按旧标准会被误放行，但仍需预检。

## 目标

- **真正 0 失误**：不依赖 Claude 读不读 skill，由 harness（Claude Code PreToolUse hook）在 Bash 执行前强制跑预检，失败即阻断。
- **就绪时低开销**：已连场景总开销 <100ms，不影响日常 opencli 命令节奏。
- **文档与 harness 行为一致**：blockquote 同步更正（`browser: true` 判定 + 视觉层级重排），即便 hook 未来被临时禁用也有正确文档可读。
- **opencli 相关资产集中**：Main 项目 vault 里的 opencli 专属 spec/plan/脚本迁回 opencli repo，结束跨仓库耦合。

## 非目标

- 动态查询 opencli 注册表（选项 C）：为保就绪时 <100ms，白名单用静态清单 + upstream rebase 时一键重生。
- 跨 profile 检测 / 防御其他 Chrome profile 误装扩展：仍依赖 `K-OpenCLI插件Skills.md` 的人为约束兜底（daemon 没有 profile 标识能力）。
- CI 集成：本次是 jdy 个人工作环境的 harness，不是团队协作流程。

## 架构总览

```
Claude 要跑 Bash("opencli xxx yyy")
     │
     ▼
~/.claude/settings.json hooks.PreToolUse[Bash]
  + if: "Bash(*opencli*)"      ← Claude Code 层预过滤（含 "opencli" 子串的 Bash 才起 guard）
     │
     ▼
~/.claude/scripts/opencli_preflight_guard.sh  ← 本设计新建
     │
     ├── [0] 轻量 shell 预筛：grep -qE '\bopencli\b' 命令字符串
     │        不含 → exit 0（双重保险，避免 `if` 字段被旧版 Claude Code 忽略时误阻断所有 Bash）
     │
     ├── [1] Self-check（分层）：
     │        [1a] 基础（始终检查）：preflight_profile0.sh 存在且可执行 + opencli 在 PATH
     │        [1b] bypass 文件检查延迟到 [5] 真正查 <site>/<cmd> 时，避免锁死恢复路径
     │
     ├── [2] 解析 stdin JSON（python3）→ 取 tool_input.command
     │        失败 → fail-closed（因已通过 [0]，命令里有 opencli）
     │
     ├── [3] 递归展开 shell wrapper（bash -c / zsh -c / sh -c / -lc 的内层字符串）
     │        展开失败（引号不平衡等）→ fail-closed
     │
     ├── [4] shlex 分词 effective command，找所有独立 opencli token
     │        shlex 抛错 → fail-closed
     │
     ├── [5] 查 ~/.claude/scripts/opencli_bypass_commands.txt 判定每个 opencli 点
     │
     ├── 任一 opencli 点需预检 ─▶ /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
     │                                │
     │                                ├── exit 0 (就绪) ─▶ guard exit 0（放行）
     │                                └── exit 1 (未就绪) ─▶ guard stderr 附带修复指引 + exit 2（阻断）
     │
     └── 全部 bypass ─▶ guard exit 0（放行）
```

### Source of Truth 层级（防漂移）

```
Level 1（权威）：本 spec（2026-04-20-opencli-preflight-guard-design.md）
Level 2（运行时事实）：settings.json + guard 脚本 + bypass_commands.txt + preflight_profile0.sh
Level 3（派生文档）：6 份 SKILL.md blockquote、AGENTS.md、项目 .claude/CLAUDE.md 的相关段落

Level 3 的路径/行为描述必须与 Level 1/2 一致。upstream rebase 或 spec 修订时，按 Level 3 的文件清单统一 grep 旧路径字面量并替换。
```

### 三个独立改动域

| 域 | 位置 | git 管理 | 提交方式 |
|---|---|---|---|
| A. opencli repo | `/Users/jdy/Documents/open_sources/opencli/` | ken-zy/OpenCLI | `feat/preflight-harness-hook` 分支 → PR |
| B. Main repo | `/Users/jdy/Documents/Main/` | Main vault | 直接 commit，不 PR |
| C. 全局配置 | `/Users/jdy/.claude/` | 无 | 直接应用 |

## Guard 脚本决策逻辑

### 决策树（按执行顺序）

```
[1] Self-check（分层：基础层始终检查；bypass 文件延迟检查）
    
    [1a] 基础 self-check（最先跑；任一失败 → fail-closed 但允许顶层管理命令）
         - [ -x "$PREFLIGHT_SCRIPT" ]：preflight_profile0.sh 存在且可执行
         - command -v opencli：opencli 在 PATH
         任一失败 → stderr "guard self-check failed: <项>" + exit 2
    
    [1b] bypass 文件检查推迟到 [5] 真正需要查询 <site>/<cmd> 时
         
    理由（避免 operational deadlock）：当 bypass 文件损坏时，用户需要能跑
    `opencli list` / `opencli doctor` / `opencli daemon stop` 等恢复命令；
    这些命令在 [5] 只用顶层 bypass 判断，不查 `<site>/<cmd>` 文件。
    把 bypass 文件检查延后到真正要用时，才不会把恢复路径一起锁死。

[0] 读 stdin 为原始字节流 → raw_input
    轻量预筛：printf '%s' "$raw_input" | grep -qE '\bopencli\b' || exit 0
    
    ├── 未含 opencli 子串 → exit 0（明确不是 opencli 调用，fail-open 无风险）
    └── 含 opencli 子串 → 继续
    
    注：此处用原始 JSON 字符串做 grep。可能匹配 opencli-autofix 等子串；
    真实判定由 [5] 的 shlex 独立 token 分析完成。此步是零成本快速退出。

[2] python3 解析 raw_input JSON → tool_input.command
    JSON 解析失败 → fail-closed（因为 [0] 已确认含 opencli 子串）

[3] 递归展开 shell wrapper
    检测：shlex 分词后若出现 {bash, zsh, sh} 配 {-c, -lc, -ic} 且 next token 是字符串
    展开：对该字符串递归应用 [3]→[4]→[5]
    
    深度定义（从 0 计）：
      深度 0 = 原始命令（无 wrapper）
      深度 1 = 一层 wrapper，如 `bash -c 'opencli x'`
      深度 2 = 两层嵌套，如 `bash -c 'bash -c "opencli x"'`
      ...
    
    允许上限：深度 1（允许一层 wrapper；深度 ≥ 2 直接 fail-closed）
    其他 fail-closed：引号不闭合、shell 解析错误

[4] shlex 分词 effective command
    shlex 抛错 → fail-closed

[5] 按 shell command boundary 分段，解析每段的真实 argv[0]
    - 分隔符 {`&&` `||` `|` `;` `&`} 切分成 command segments
    - 在每段内，按顺序跳过：
      · `FOO=bar` env-assignment 前缀
      · 透明 exec-forwarding 前缀 {env / command / exec / npx}，以及它们后续的
        flags、env-assignments、`--package PKG` 等参数，直到下一个真实命令 token
    - 取到真实 argv[0] 后：
      · basename(argv[0]) == "opencli" → 进入 classify（支持 `npx opencli`、
        `env FOO=1 opencli`、`command opencli`、`/usr/local/bin/opencli` 等形式）
      · basename(argv[0]) ∈ WRAPPER_SHELLS 且后跟 `-c/-lc/-ic` → 递归 scan 内层
      · 其他 argv[0] → 该 segment 跳过（避免误把 `echo opencli` / `echo /usr/local/bin/opencli`
        / `echo bash -lc "opencli ..."` 这类文本参数当成真实调用）
    
    ├── 所有 segments 的 argv[0] 都不是 opencli/shell-wrapper → **fail-open**（exit 0）
    │     理由：[0] 的 shell grep 匹配的"opencli"只出现在参数位（`echo opencli`、
    │     `echo /usr/local/bin/opencli`、`echo bash -lc "opencli ..."`），不是真实调用
    └── 对每个命令段的 argv[0] 是 opencli 的情形，取紧邻 next1 / next2 token：
    
        ├── next1 ∈ 顶层 bypass：
        │     {list, doctor, daemon, help, -h, --help,
        │      synthesize, validate, verify, completion, plugin,
        │      version, -v, --version}
        │     → 该点 bypass
        │     （注：顶层 `opencli verify` 实际只是 validate + optional
        │      `--smoke`（vitest），不走浏览器，见 src/cli.ts:154 / src/verify.ts:32；
        │      `opencli browser verify` 走下面 browser 分支命中 NEED_PREFLIGHT）
        │
        ├── next1 ∈ 顶层 NEED_PREFLIGHT：
        │     {browser, explore, probe, generate, record, cascade}
        │     → 该点 NEED_PREFLIGHT
        │
        ├── next1 命中 bypass list 作为站点级（如 `gh` / `docker` / `obsidian` /
        │      `vercel` / `lark-cli` / `dws` / `wecom-cli` 等 external CLI passthrough）
        │     → 该点 bypass
        │
        ├── "next1/next2" 命中 opencli_bypass_commands.txt 作为命令级
        │     → 该点 bypass
        │
        ├── next1 为空（bare `opencli` 打印 help）
        │     → 该点 bypass
        │
        └── 其他（未知顶层命令 / 不在 bypass list 的 <site>/<cmd>）
              → 该点 NEED_PREFLIGHT（保守：未知即预检）

[6] 任一 opencli 点命中 NEED_PREFLIGHT → 调 preflight_profile0.sh
    ├── exit 0（就绪） → guard exit 0（放行）
    └── exit 1（未就绪）→ 透传 preflight stderr + exit 2（阻断）
```

### 边界处理

| 边界 | 处理 |
|---|---|
| 路径前缀 `npx opencli` / `./node_modules/.bin/opencli` / `/usr/local/bin/opencli` | shlex 分词后 basename 取末段匹配 |
| 环境变量前缀 `OPENCLI_DEBUG=1 opencli xx` | shlex 作为独立 token，含 `=` 的 token 跳过 |
| 链式命令 `ls && opencli a && opencli browser state` | 遍历所有 opencli 点；任一 NEED_PREFLIGHT 就跑一次预检 |
| Shell wrapper `bash -lc 'opencli browser state'` / `zsh -c "opencli list"` | 在 [3] 递归展开内层字符串；允许深度上限 1（一层 wrapper），深度 ≥ 2 fail-closed |
| 子命令 flag 混入 `opencli xiaohongshu hot --limit 10` | 只看 next1、next2（site、cmd），忽略 `--` flag |
| `opencli browser <任何子命令>`（含 `init` / `verify` / `state`） | 全部 NEED_PREFLIGHT（都读浏览器页面） |
| `opencli verify <site>/<name>` | bypass（顶层 verify 仅 validate + 可选 vitest smoke，不走浏览器；见 src/cli.ts:154 / src/verify.ts:32） |
| `opencli validate <site>` | bypass（仅 schema 检查，不走浏览器） |
| `opencli completion` / `opencli plugin ...` | bypass（CLI 管理命令） |
| `opencli doctor` | bypass（预检内部就跑 doctor，避免递归） |
| `opencli daemon *` | bypass（daemon 管理不读浏览器） |
| `opencli synthesize <site>` | bypass（纯本地 YAML 合成） |
| upstream 新增未知顶层命令 | NEED_PREFLIGHT（保守；后续人工决定是否加入 bypass） |
| heredoc / 多行命令（`cat <<EOF\nopencli ...\nEOF`） | 依 [4] shlex 结果：抛错 → fail-closed；成功但 [5] 无独立 token → fail-open |

### Fail-closed vs Fail-open 策略（按调用分类）

**根本原则**：不变量 "opencli 浏览器命令必须连对浏览器" 优先于 "别把 Bash 弄挂"。

| 场景 | 决策 | 理由 |
|---|---|---|
| `[0]` 命令不含 `opencli` token | **fail-open**（exit 0） | 明确无风险，与 guard 无关 |
| `[1a]` 基础 self-check 失败（preflight 脚本缺失 / opencli 不在 PATH） | **fail-closed**（exit 2 + stderr 指引） | guard 核心基础设施坏了 |
| `[1b]` bypass 文件缺失，但命令命中顶层 bypass（`list` / `doctor` / `daemon` 等） | **fail-open** | 保留恢复路径；这些命令不查 `<site>/<cmd>` 文件 |
| `[1b]` bypass 文件缺失，命令要查 `<site>/<cmd>` | **fail-closed**（exit 2 + 指引跑 gen-bypass-list.sh） | 无法判定则保守阻断 |
| `[2]` stdin JSON 解析失败但 [0] 已确认含 opencli | **fail-closed** | 解析失败说明 hook 输入协议错乱，不能放行 opencli 调用 |
| `[3]` wrapper 展开失败（引号不闭合 / 嵌套超限） | **fail-closed** | 无法判断内层实际执行什么，保守阻断 |
| `[4]` shlex 抛错 | **fail-closed** | 同上 |
| `[5]` 命令含 `opencli` 子串但分词后找不到独立 token | **fail-open**（exit 0） | 说明 opencli 是路径名/字符串子串（如 `opencli-autofix`、`echo "opencli xxx"`），非真实调用 |
| `[5]` bypass 命中 | **fail-open**（exit 0） | 明确无需预检 |
| `[6]` preflight 正常运行 exit 1 | **fail-closed** | 明确扩展未连 |
| `[6]` preflight 正常运行 exit 0 | **fail-open**（exit 0） | 就绪放行 |
| `[6]` preflight 异常崩溃（非 0/1 exit） | **fail-closed** | preflight 自己错乱，不能假设就绪 |
| hook timeout（settings.json timeout 触发） | **Phase 3 验证项**（见风险小节） | 需实测决定；spec 默认期望阻断 |

## 白名单文件

### 格式

`~/.claude/scripts/opencli_bypass_commands.txt`，支持两种行：
- `site/cmd` — 命令级 bypass（来自 `opencli list -f json` 中 `browser: false` 的 adapter）
- `site` — 站点级整站 bypass（来自 `src/external-clis.yaml` 的 external CLI passthrough：`gh` / `docker` / `obsidian` / `vercel` / `lark-cli` / `dws` / `wecom-cli`；这些 CLI 不在 opencli 的 adapter registry，但 `opencli <name>` 走 `executeExternalCli` 透传到系统 CLI，不碰浏览器）

```
# 自动生成：2026-04-20 HH:MM:SS
# 来源：opencli list -f json | (browser == false)
apple-podcasts/episodes
apple-podcasts/search
apple-podcasts/top
arxiv/paper
arxiv/search
...
36kr/news
bloomberg/businessweek
google/news
v2ex/hot
...
```

Guard 用 `grep -Fxq "$sitecmd" opencli_bypass_commands.txt` 做 O(1) 查询（-F 固定字符串、-x 整行、-q 静默）。

### 生成脚本

`~/.claude/scripts/gen-bypass-list.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
OUT="$HOME/.claude/scripts/opencli_bypass_commands.txt"
{
  echo "# 自动生成：$(date '+%Y-%m-%d %H:%M:%S')"
  echo "# 来源：opencli list -f json | (browser == false)"
  opencli list -f json \
    | python3 -c "import json,sys; [print(x['command']) for x in json.load(sys.stdin) if not x['browser']]" \
    | sort
} > "$OUT"
echo "[gen-bypass-list] 写入 $OUT ($(wc -l <"$OUT") 行)"
```

初次和每次 upstream rebase 后跑一下即可。

### 当前数据分布参考（2026-04-20 opencli list snapshot）

- 总命令数：99 个站点下全部命令
- `browser: false`（全部放行）：19 个整站 + 11 个混合型站点下的部分命令 ≈ 100 条左右
- `browser: true`（全部预检）：其余

## settings.json 改动

在 `/Users/jdy/.claude/settings.json` 顶层 object 追加：

```json
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

### 字段说明

| 字段 | 语义 | 作用 |
|---|---|---|
| `matcher: "Bash"` | Claude Code 只在 Bash tool 调用时启动该 hook chain | 粗筛 |
| `if: "Bash(*opencli*)"` | Claude Code permission rule 语法（参见官方 hooks 文档）—— Bash 命令字符串含 "opencli" 子串才进 handler | 细筛，避免每个 `ls/git/npm` 都启动 python3 |
| `command` | 绝对路径调用 guard | 避免 `~` 展开在某些 shell 抽风 |
| `timeout: 20` | 保守默认值。就绪路径 <100ms；冷启动 ~5s；留 3× 余量给 guard 自身的 10s python subprocess 超时 | 见 Phase 3 验证项 |

### 执行环境处理

- **cwd 不保证**：guard 脚本所有引用一律绝对路径，不依赖 cwd。
- **PATH 可能不含自定义项**：guard 脚本开头显式：
  ```bash
  export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH"
  ```
  兜底后做 self-check [1]。`command -v opencli` 仍失败 → **fail-closed**（见 Fail-closed 策略）。不再 fail-open，因为命令已被 [0] 判定含 `opencli`，PATH 缺失时无法正确路由。
- **stdin 格式**：Claude Code hook 标准 JSON：
  ```json
  {"tool_name": "Bash", "tool_input": {"command": "..."}, "session_id": "...", ...}
  ```
- **`if` 字段兼容性**：若当前 Claude Code 版本不支持 `if` 字段，预期行为是忽略该字段（所有 Bash 都进 handler）。guard 的 [0] 轻量预筛是双重保险：不支持 `if` 时性能稍降但不影响正确性。Phase 3 验证项。

## 6 份 SKILL.md blockquote 改造

### 4 份一致（browser / explorer / oneshot / autofix）的新 blockquote

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
> **无需预检的命令**（`browser: false`，不走浏览器）：管理子命令（`list` / `doctor` / `daemon` / `help` / `synthesize` / `validate` / `verify` / `completion` / `plugin` / `version`）、以及 `opencli list -f json` 中 `browser: false` 的全部命令（如 `hackernews/*` · `v2ex/hot` · `google/news` · `bloomberg/*` 等）。精确白名单见 `~/.claude/scripts/opencli_bypass_commands.txt`（由 `gen-bypass-list.sh` 一键重生）。注：此处 `verify` 指顶层 `opencli verify`（仅 validate + optional vitest smoke）；`opencli browser verify` 属于 browser 子命令仍需预检。
>
> 不得在主 Chrome 或 profile_1~6 中运行 opencli —— 其他实例未装扩展，不参与自动化。
```

### smart-search 额外的特例行

```markdown
> **smart-search 特例**：若最终路由到 `browser: false` 的源（hackernews / v2ex/hot / arxiv 等纯 API），**不触发预检**直接执行；若路由到 `browser: true` 源（grok / doubao / gemini / xueqiu / twitter 等），按上述规则预检（harness hook 也会自动兜底）。
```

### 相对原版的关键变更

| 旧 | 新 | 原因 |
|---|---|---|
| 首段无 hook 说明 | 加一段"harness 层已强制... hook 兜底" | 未来 Claude 读 skill 时知道不是唯一防线 |
| `strategy 不是 PUBLIC/LOCAL` | `browser: true` | 数据层正确性（36kr/hot 等反例） |
| `opencli list -f yaml` / `strategy: PUBLIC` | `opencli list -f json` / `browser: false` | 同上；json 也便于脚本消费 |
| 罗列 `hn/v2ex/arxiv/lobsters` 4 个站 | 指向 `opencli_bypass_commands.txt` | 命令级精度（~100 条）不适合罗列 |
| 脚本路径 `Main/.claude/scripts/` | `opencli/scripts/` | 脚本迁移后的新路径 |
| "通用规则 + 具体场景"混成一个 bullet list | 视觉层级拆开：通用规则先看 → 具体场景仅举例 | 消除"前两条已枚举完"错觉 |

## 文件变更清单

### A. opencli repo（新分支 `feat/preflight-harness-hook`）

| 动作 | 路径 | 内容 |
|---|---|---|
| 迁入并 patch | `scripts/preflight_profile0.sh` | 从 Main/.claude/scripts/ 迁入；**非原样复制**——需审核 error message 里的 `docs/...` 相对路径仍然成立（迁到 opencli 后"docs/superpowers/..."语义正确，无需修改），但需在 spec review 时确认 |
| 迁入 | `docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md` | 从 Main 迁入；内容不改 |
| 迁入 | `docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md` | 从 Main 迁入；内容不改 |
| 新建 | `docs/superpowers/specs/2026-04-20-opencli-preflight-guard-design.md` | 本文件（即当前 spec） |
| 修改 | `skills/opencli-browser/SKILL.md` | blockquote 整块替换 |
| 修改 | `skills/opencli-explorer/SKILL.md` | 同上 |
| 修改 | `skills/opencli-oneshot/SKILL.md` | 同上 |
| 修改 | `skills/opencli-autofix/SKILL.md` | 同上 |
| 修改 | `skills/smart-search/SKILL.md` | blockquote 整块 + 特例行同步 |
| 修改 | `skills/opencli-usage/SKILL.md` | blockquote 整块（保留 CLI passthrough 列表 `gh`/`docker`/`lark-cli`/`vercel`/`dws`/`wecom-cli`/`obsidian` + daemon 权威判据说明） |
| 修改 | 项目 `.claude/CLAUDE.md` | 全节同步 lines 61-72：路径（`Main/.claude/scripts/` → `opencli/scripts/`）+ 判据（旧 `strategy != PUBLIC/LOCAL` → 新 `browser: true`）+ blockquote 来源描述；新增"harness hook 强制层"小节 |
| 修改 | 项目 `AGENTS.md`（本地私有 untracked） | 同上；顺带修 line 63 typo `.Codex` → `.claude`（迁移后整行重写为新路径） |

### B. Main repo（直接 commit）

| 动作 | 路径 |
|---|---|
| git rm | `.claude/scripts/preflight_profile0.sh` |
| git rm | `docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md` |
| git rm | `docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md` |

### C. 全局配置（无 git）

| 动作 | 路径 |
|---|---|
| 新建 | `~/.claude/scripts/opencli_preflight_guard.sh` (chmod +x) |
| 新建 | `~/.claude/scripts/gen-bypass-list.sh` (chmod +x) |
| 新建（脚本生成） | `~/.claude/scripts/opencli_bypass_commands.txt` |
| 修改 | `~/.claude/settings.json`（追加 hooks 字段，先备份） |

## 落地顺序

```
阶段 1：opencli repo 准备（feat/preflight-harness-hook 分支）
  1.1 复制（不删 Main 原件——暂保留为回滚兜底）
  1.2 改 6 份 SKILL.md blockquote（引用 opencli/scripts/ 新路径）
  1.3 更新项目 .claude/CLAUDE.md
  1.4 写本 spec

阶段 2：全局配置落地（无 git）
  2.1 mkdir ~/.claude/scripts
  2.2 写 opencli_preflight_guard.sh + chmod +x
  2.3 写 gen-bypass-list.sh + chmod +x
  2.4 跑 gen-bypass-list.sh 生成 opencli_bypass_commands.txt
  2.5 cp ~/.claude/settings.json ~/.claude/settings.json.backup
  2.6 改 ~/.claude/settings.json 加 hooks 字段

阶段 3：验证
  3.1 guard 脚本单元测试（下述 case 表）
  3.2 Claude Code 里实际跑 opencli 命令测 hook
  3.3 预检失败场景模拟（关 0号 Chrome 测阻断）

阶段 4：Main repo 收尾（阶段 3 全部通过后）
  4.1 cd Main && git rm 三个原件
  4.2 commit -m "chore(vault): migrate opencli-specific docs+script to opencli repo"
  4.3 push

阶段 5：opencli PR 合并（/merge-check + /merge-to-main）
```

## 验证 case 表

```bash
test() { echo "$1" | bash ~/.claude/scripts/opencli_preflight_guard.sh; echo "exit=$?"; }

# —— fail-open（明确非 opencli 或命中 bypass）
test '{"tool_input":{"command":"ls -la"}}'                                    # 0（非 opencli，[0] 放行）
test '{"tool_input":{"command":"echo opencli-autofix"}}'                      # 0（子串非独立 token，[5] 无 opencli point）
test '{"tool_input":{"command":"OPENCLI_DEBUG=1 opencli list"}}'              # 0（env 前缀 + 管理子命令）
test '{"tool_input":{"command":"opencli list"}}'                              # 0（管理子命令）
test '{"tool_input":{"command":"opencli doctor"}}'                            # 0（避免递归）
test '{"tool_input":{"command":"opencli daemon stop"}}'                       # 0
test '{"tool_input":{"command":"opencli validate hn/top"}}'                   # 0（非浏览器）
test '{"tool_input":{"command":"opencli completion bash"}}'                   # 0
test '{"tool_input":{"command":"opencli hackernews top --limit 5"}}'          # 0（bypass list 命中）
test '{"tool_input":{"command":"opencli v2ex hot"}}'                          # 0

# —— fail-open 或 fail-closed（取决于 preflight 状态，0号 Chrome 就绪则 0，否则 2）
test '{"tool_input":{"command":"opencli 36kr hot"}}'                          # 0 或 2（browser:true）
test '{"tool_input":{"command":"opencli xiaohongshu search xxx"}}'            # 0 或 2
test '{"tool_input":{"command":"opencli browser state"}}'                     # 0 或 2
test '{"tool_input":{"command":"opencli browser init hn/top"}}'               # 0 或 2（browser 子命令）
test '{"tool_input":{"command":"opencli verify hn/top"}}'                     # 0（顶层 verify 仅 validate + optional vitest smoke，非浏览器）
test '{"tool_input":{"command":"ls && opencli browser open xxx && date"}}'    # 0 或 2（链式命令）
test '{"tool_input":{"command":"opencli explore https://xx.com"}}'            # 0 或 2

# —— wrapper 场景（[3] 递归展开）
test '{"tool_input":{"command":"bash -lc \"opencli browser state\""}}'        # 0 或 2（内层展开）
test '{"tool_input":{"command":"zsh -c \"opencli hackernews top\""}}'         # 0（内层 bypass）
test '{"tool_input":{"command":"sh -c \"opencli xiaohongshu search x\""}}'    # 0 或 2

# —— fail-closed 场景（均应 exit 2）
test '{"tool_input":{"command":"opencli xiaohongshu hot"}}'                   # 预先临时 chmod -x preflight → 2（self-check [1] 失败）
test '{"tool_input":{"command":"bash -c \"opencli xx; unclosed-quote"}}'      # 2（wrapper 展开失败）
test 'malformed-json-with-opencli-word-inside'                                # 2（[0] 含 opencli，[2] 解析失败 → fail-closed）
test 'malformed-json'                                                         # 0（[0] 不含 opencli，与 guard 无关）

# —— timeout 验证（Phase 3 实测项）
# 临时把 preflight_profile0.sh 改成 `sleep 60` 模拟超时：
#   验证 hook timeout 行为：Claude Code 是阻断还是放行？
#   预期：guard 脚本内 10s python subprocess timeout 会先于 settings.json timeout: 20s 触发 → exit 2 阻断
```

## 维护流程（upstream rebase）

```bash
# 1. rebase upstream
cd /Users/jdy/Documents/open_sources/opencli
git fetch upstream && git rebase upstream/main

# 2. 处理 6 份 SKILL.md blockquote conflict（沿用 .claude/CLAUDE.md 原流程）

# 3. 重生白名单
bash ~/.claude/scripts/gen-bypass-list.sh

# 4. 若 upstream 调整了 browser 字段或新增浏览器工具命令（如新增 explore 级命令），
#    review blockquote 是否需要同步
```

## 回滚方案

### 紧急关闭 hook

```bash
# 方案 A：让 guard 脚本永远 exit 0（保 hook 配置，绕过逻辑）
mv ~/.claude/scripts/opencli_preflight_guard.sh{,.bak}
printf '#!/usr/bin/env bash\nexit 0\n' > ~/.claude/scripts/opencli_preflight_guard.sh
chmod +x ~/.claude/scripts/opencli_preflight_guard.sh

# 方案 B：settings.json 全量回滚
cp ~/.claude/settings.json.backup ~/.claude/settings.json
```

### 完整回滚

```bash
# 1. 恢复 Main 原件（若 Main 阶段已 commit 删除）
cd /Users/jdy/Documents/Main && git revert <commit-hash>

# 2. opencli 分支放弃
cd /Users/jdy/Documents/open_sources/opencli
git checkout main && git branch -D feat/preflight-harness-hook

# 3. 删全局配置
rm -rf ~/.claude/scripts/opencli_*
cp ~/.claude/settings.json.backup ~/.claude/settings.json
```

## 风险与 Phase 3 验证项

### 已知风险（接受）

- **PATH 未包含 opencli**：guard 脚本 `export PATH` 兜底；仍失败时 fail-closed（阻断 + 指引），不再默默 fail-open。这是主动选择，代价是首次环境异常时 Bash 会短暂不可用直到 jdy 修 PATH。
- **upstream 新增非 browser 类顶层命令**：若 upstream 加入新顶层命令（如 `opencli capture`），guard 硬编码列表不知道 → 默认走 `<site>/<cmd>` 白名单查询 → 未命中则预检。保守策略不漏检，但可能造成新命令误预检，rebase 时人工 review 加入 bypass list。

### Phase 3 验证项（必须在落地前完成）

以下 4 项任一失败都应阻止 PR 合并：

1. **Hook `if` 字段实测**
   - 喂 `{"command": "ls"}` 和 `{"command": "opencli list"}`，前者不应启动 guard 进程（通过进程监控或 guard 内打点日志验证）
   - 若 `if` 被忽略（旧版 Claude Code）：guard `[0]` 轻量预筛兜底，测试 `opencli list` 仍能正确路由
   
2. **Hook `timeout` 超时语义实测**
   - 临时将 `preflight_profile0.sh` 第一行改为 `sleep 60` 模拟超时
   - 喂 `opencli browser state` 观察：Claude Code 是（A）超时后放行、（B）超时后阻断、还是（C）超时后把 hook 算作非 0 exit 但仍放行 Bash
   - **唯一可接受结果：B（阻断）**。A 和 C 都违背"0 失误"不变量
   - 若实测是 A 或 C：在 guard 脚本内用 python3 subprocess 兜底（macOS 默认无 GNU `timeout` 命令）：
     ```python
     import subprocess
     try:
         r = subprocess.run(["bash", PREFLIGHT_SCRIPT], timeout=10, capture_output=True)
         # 用 r.returncode 和 r.stderr 决定 guard 最终退出
     except subprocess.TimeoutExpired:
         sys.stderr.write("preflight timeout after 10s\n")
         sys.exit(2)  # fail-closed
     ```
     settings.json 的 timeout 设为 `timeout: 20` 给 guard 自身的 subprocess 兜底留余量
   
3. **Wrapper 递归展开实测**
   - 测试 case 表里的 `bash -lc "opencli browser state"` 真的触发预检
   - 测试嵌套深度：`bash -c 'bash -c "opencli x"'` 应 fail-closed（深度超限）
   
4. **Fail-closed 全场景实测**
   - 临时 `chmod -x preflight_profile0.sh` 喂 `opencli xiaohongshu hot` → 应 exit 2
   - 临时 `mv opencli_bypass_commands.txt{,.bak}` 喂 `opencli hackernews top` → 应 exit 2
   - 确认 stderr 包含具体修复指引

### 未决点

无 —— 设计定稿。所有开放问题已转化为 Phase 3 验证项。

## 参考

- 前置设计：[2026-04-18-opencli-profile0-binding-design.md](2026-04-18-opencli-profile0-binding-design.md)
- `preflight_profile0.sh` 原始位置：`Main/.claude/scripts/preflight_profile0.sh`（本次迁移后：`opencli/scripts/preflight_profile0.sh`）
- Claude Code PreToolUse hook 文档：见 `Skill` 工具调用 `update-config` 时加载
