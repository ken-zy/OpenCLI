# opencli 0号 Chrome 预检 harness hook 设计

- 日期：2026-04-20
- 作者：jdy / Claude (Opus 4.7)
- 状态：设计定稿，待实施
- 关联前置：[2026-04-18-opencli-profile0-binding-design.md](2026-04-18-opencli-profile0-binding-design.md)

## 背景

2026-04-18 的 0号 Chrome 绑定方案依赖 5 份 SKILL.md 里的 blockquote 提醒 Claude：「执行 opencli 浏览器相关命令前先跑 `preflight_profile0.sh`」。实际使用中发现：

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
     │
     ▼
~/.claude/scripts/opencli_preflight_guard.sh  ← 本设计新建
     │
     ├── 解析 stdin JSON（python3）
     ├── shlex 分词 command，找所有独立 opencli token
     ├── 查 ~/.claude/scripts/opencli_bypass_commands.txt（站点级/命令级白名单）
     │
     ├── 任一 opencli 点需预检 ─▶ /Users/jdy/Documents/open_sources/opencli/scripts/preflight_profile0.sh
     │                                │
     │                                ├── exit 0 (就绪) ─▶ guard exit 0（放行）
     │                                └── exit 1 (未就绪) ─▶ guard stderr 附带修复指引 + exit 2（阻断）
     │
     └── 全部 bypass ─▶ guard exit 0（放行）
```

### 三个独立改动域

| 域 | 位置 | git 管理 | 提交方式 |
|---|---|---|---|
| A. opencli repo | `/Users/jdy/Documents/open_sources/opencli/` | ken-zy/OpenCLI | `feat/preflight-harness-hook` 分支 → PR |
| B. Main repo | `/Users/jdy/Documents/Main/` | Main vault | 直接 commit，不 PR |
| C. 全局配置 | `/Users/jdy/.claude/` | 无 | 直接应用 |

## Guard 脚本决策逻辑

### 决策树

```
stdin JSON 读进来
    │
    ├── JSON 解析失败 / shlex 抛错 ─▶ exit 0 (fail-open，基础设施损坏不瘫痪 Bash)
    │
    ▼
python3 shlex 分词 command
    │
    ▼
遍历 tokens，查所有独立 opencli word（basename 取末段，跳过环境变量前缀 FOO=bar，
排除 opencli-autofix 这种子串非独立匹配）
    │
    ├── 未找到任何 opencli token ─▶ exit 0
    │
    ▼
对每个 opencli 出现点，取紧邻 next1 / next2 token：
    │
    ├── next1 ∈ {list, doctor, daemon, help, -h, --help,
    │             synthesize, version, -v, --version}  ─▶ 该点 bypass
    │
    ├── next1 ∈ {browser, explore, probe, generate,
    │             record, cascade}                      ─▶ 该点 NEED_PREFLIGHT
    │
    ├── "next1/next2" 命中 opencli_bypass_commands.txt ─▶ 该点 bypass
    │
    └── 其他                                             ─▶ 该点 NEED_PREFLIGHT
    │
    ▼
任一 opencli 点命中 NEED_PREFLIGHT ─▶ 调 preflight_profile0.sh
                                          │
                                          ├── exit 0 ─▶ guard exit 0
                                          └── exit 1 ─▶ guard stderr + exit 2
```

### 边界处理

| 边界 | 处理 |
|---|---|
| 路径前缀 `npx opencli`、`./node_modules/.bin/opencli`、`/usr/local/bin/opencli` | shlex 分词后 basename 取末段匹配 |
| 环境变量前缀 `OPENCLI_DEBUG=1 opencli xx` | shlex 作为独立 token，含 `=` 的跳过 |
| 链式命令 `ls && opencli a && opencli browser state` | 遍历所有 opencli 点；任一 NEED_PREFLIGHT 就跑一次预检 |
| 子命令 flag 混入 `opencli xiaohongshu hot --limit 10` | 只看 next1、next2（site、cmd），忽略 `--` flag |
| `opencli browser init` / `verify` | 全部 NEED_PREFLIGHT（读浏览器页面） |
| `opencli doctor` | bypass（预检内部就是跑 doctor，避免递归） |
| `opencli daemon *` | bypass（daemon 管理不读浏览器） |
| `opencli synthesize <site>` | bypass（纯本地 YAML 合成） |

### Fail-open vs Fail-closed 策略

- **默认 fail-open**：guard 脚本解析失败 / 白名单文件缺失 / preflight 脚本不可执行 → exit 0 + stderr 警告。理由：hook 基础设施坏了不该瘫痪所有 Bash，警告足够 jdy 察觉。
- **fail-closed**：仅当 preflight 正常运行且明确 exit 1（扩展未连 daemon）→ exit 2 阻断。

## 白名单文件

### 格式

`~/.claude/scripts/opencli_bypass_commands.txt`，每行一个 `site/cmd`：

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
          "timeout": 15
        }
      ]
    }
  ]
}
```

### 执行环境注意

- **cwd 不保证**：guard 脚本所有引用一律绝对路径。
- **PATH 可能不含自定义项**：guard 脚本开头显式 `export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH"` 兜底；若 `command -v opencli` 仍失败则 fail-open 放行。
- **stdin 格式**：Claude Code hook 标准 JSON：`{"tool_name": "Bash", "tool_input": {"command": "..."}, ...}`。

## 5 份 SKILL.md blockquote 改造

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
> **无需预检的命令**（`browser: false`，不走浏览器）：管理子命令（`list` / `doctor` / `daemon` / `help` / `synthesize` / `version`）、以及 `opencli list -f json` 中 `browser: false` 的全部命令（如 `hackernews/*` · `v2ex/hot` · `google/news` · `bloomberg/*` 等）。精确白名单见 `~/.claude/scripts/opencli_bypass_commands.txt`（由 `gen-bypass-list.sh` 一键重生）。
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
| 复制 | `scripts/preflight_profile0.sh` | 从 Main/.claude/scripts/ 原样复制 |
| 复制 | `docs/superpowers/specs/2026-04-18-opencli-profile0-binding-design.md` | 从 Main 原样复制 |
| 复制 | `docs/superpowers/plans/2026-04-18-opencli-profile0-binding.md` | 从 Main 原样复制 |
| 新建 | `docs/superpowers/specs/2026-04-20-opencli-preflight-guard-design.md` | 本文件 |
| 修改 | `skills/opencli-browser/SKILL.md` | blockquote 整块替换 |
| 修改 | `skills/opencli-explorer/SKILL.md` | 同上 |
| 修改 | `skills/opencli-oneshot/SKILL.md` | 同上 |
| 修改 | `skills/opencli-autofix/SKILL.md` | 同上 |
| 修改 | `skills/smart-search/SKILL.md` | blockquote 整块 + 特例行同步 |
| 修改 | 项目 `.claude/CLAUDE.md` | 更新"0号 Chrome 绑定"小节路径 + 新增"harness hook"小节 |

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
  1.2 改 5 份 SKILL.md blockquote（引用 opencli/scripts/ 新路径）
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
  4.2 commit -m "refactor: migrate opencli-specific docs+script to opencli repo"
  4.3 push

阶段 5：opencli PR 合并（/merge-check + /merge-to-main）
```

## 验证 case 表

```bash
test() { echo "$1" | bash ~/.claude/scripts/opencli_preflight_guard.sh; echo "exit=$?"; }

test '{"tool_input":{"command":"ls -la"}}'                                    # 0（非 opencli）
test '{"tool_input":{"command":"opencli list"}}'                              # 0（管理子命令）
test '{"tool_input":{"command":"opencli doctor"}}'                            # 0（避免递归）
test '{"tool_input":{"command":"opencli daemon stop"}}'                       # 0
test '{"tool_input":{"command":"opencli hackernews top --limit 5"}}'          # 0（bypass list 命中）
test '{"tool_input":{"command":"opencli v2ex hot"}}'                          # 0
test '{"tool_input":{"command":"opencli 36kr hot"}}'                          # 0 或 2（browser:true，看预检状态）
test '{"tool_input":{"command":"opencli xiaohongshu search xxx"}}'            # 0 或 2
test '{"tool_input":{"command":"opencli browser state"}}'                     # 0 或 2
test '{"tool_input":{"command":"ls && opencli browser open xxx && date"}}'    # 0 或 2（链式命令识别到 browser 触发预检）
test '{"tool_input":{"command":"echo opencli-autofix"}}'                      # 0（非独立 token）
test '{"tool_input":{"command":"OPENCLI_DEBUG=1 opencli list"}}'              # 0（env 前缀）
test 'malformed-json'                                                         # 0（fail-open）
```

## 维护流程（upstream rebase）

```bash
# 1. rebase upstream
cd /Users/jdy/Documents/open_sources/opencli
git fetch upstream && git rebase upstream/main

# 2. 处理 5 份 SKILL.md blockquote conflict（沿用 .claude/CLAUDE.md 原流程）

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

## 风险与未决点

### 已知风险

- **PATH 未包含 opencli**：guard 脚本尝试 `export PATH` 兜底；若仍失败则 fail-open。不致阻塞，但会绕过预检；需要 jdy 在首次启用后 sanity check 一次。
- **hook timeout 超时语义**：Claude Code 对 hook timeout 的处理未充分验证；spec 默认 15s 保守值。若超时后放行，fail-open；若超时后阻断，可能造成 chrome_multi_instance 启动慢时的短时不可用。需要在阶段 3 验证。
- **upstream 新增非 browser 类浏览器工具命令**：若 upstream 加入新的顶层命令（如 `opencli capture`），guard 的硬编码子命令列表不知道 → 默认走白名单查询 → 未命中则预检。保守策略，不致漏检。

### 未决点

无 —— 设计定稿。

## 参考

- 前置设计：[2026-04-18-opencli-profile0-binding-design.md](2026-04-18-opencli-profile0-binding-design.md)
- `preflight_profile0.sh` 原始位置：`Main/.claude/scripts/preflight_profile0.sh`（本次迁移后：`opencli/scripts/preflight_profile0.sh`）
- Claude Code PreToolUse hook 文档：见 `Skill` 工具调用 `update-config` 时加载
