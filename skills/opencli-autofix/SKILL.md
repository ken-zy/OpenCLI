---
name: opencli-autofix
description: Automatically fix broken OpenCLI adapters when commands fail. Load this skill when an opencli command fails — it guides you through diagnosing the failure via OPENCLI_DIAGNOSTIC, patching the adapter, retrying, and filing an upstream GitHub issue after a verified fix. Works with any AI agent.
allowed-tools: Bash(opencli:*), Bash(gh:*), Read, Edit, Write
---

# OpenCLI AutoFix — Automatic Adapter Self-Repair

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


When an `opencli` command fails because a website changed its DOM, API, or response schema, **automatically diagnose, fix the adapter, and retry** — don't just report the error.

## Safety Boundaries

**Before starting any repair, check these hard stops:**

- **`AUTH_REQUIRED`** (exit code 77) — **STOP.** Do not modify code. Tell the user to log into the site in Chrome.
- **`BROWSER_CONNECT`** (exit code 69) — **STOP.** Do not modify code. Tell the user to run `opencli doctor`.
- **CAPTCHA / rate limiting** — **STOP.** Not an adapter issue.

**Scope constraint:**
- **Only modify the file at `RepairContext.adapter.sourcePath`** — this is the authoritative adapter location (may be `clis/<site>/` in repo or `~/.opencli/clis/<site>/` for npm installs)
- **Never modify** `src/`, `extension/`, `tests/`, `package.json`, or `tsconfig.json`

**Retry budget:** Max **3 repair rounds** per failure. If 3 rounds of diagnose → fix → retry don't resolve it, stop and report what was tried.

## Prerequisites

```bash
opencli doctor    # Verify extension + daemon connectivity
```

## When to Use This Skill

Use when `opencli <site> <command>` fails with repairable errors:
- **SELECTOR** — element not found (DOM changed)
- **EMPTY_RESULT** — no data returned (API response changed)
- **API_ERROR** / **NETWORK** — endpoint moved or broke
- **PAGE_CHANGED** — page structure no longer matches
- **COMMAND_EXEC** — runtime error in adapter logic
- **TIMEOUT** — page loads differently, adapter waits for wrong thing

## Before Entering Repair: "Empty" ≠ "Broken"

`EMPTY_RESULT` — and sometimes a structurally-valid `SELECTOR` that returns nothing — is often **not an adapter bug**. Platforms actively degrade results under anti-scrape heuristics, and a "not found" response from the site doesn't mean the content is actually missing. Rule this out **before** committing to a repair round:

- **Retry with an alternative query or entry point.** If `opencli xiaohongshu search "X"` returns 0 but `opencli xiaohongshu search "X 攻略"` returns 20, the adapter is fine — the platform was shaping results for the first query.
- **Spot-check in a normal Chrome tab.** If the data is visible in the user's own browser but the adapter comes back empty, the issue is usually authentication state, rate limiting, or a soft block — not a code bug. The fix is `opencli doctor` / re-login, not editing source.
- **Look for soft 404s.** Sites like xiaohongshu / weibo / douyin return HTTP 200 with an empty payload instead of a real 404 when an item is hidden or deleted. The snapshot will look structurally correct. A retry 2-3 seconds later often distinguishes "temporarily hidden" from "actually gone".
- **"0 results" from a search is an answer.** If the adapter successfully reached the search endpoint, got an HTTP 200, and the platform returned `results: []`, that is a valid answer — report it to the user as "no matches for this query" rather than patching the adapter.

Only proceed to Step 1 if the empty/selector-missing result is **reproducible across retries and alternative entry points**. Otherwise you're patching a working adapter to chase noise, and the patched version will break the next working path.

## Step 1: Collect Diagnostic Context

Run the failing command with diagnostic mode enabled:

```bash
OPENCLI_DIAGNOSTIC=1 opencli <site> <command> [args...] 2>diagnostic.json
```

This outputs a `RepairContext` JSON between `___OPENCLI_DIAGNOSTIC___` markers in stderr:

```json
{
  "error": {
    "code": "SELECTOR",
    "message": "Could not find element: .old-selector",
    "hint": "The page UI may have changed."
  },
  "adapter": {
    "site": "example",
    "command": "example/search",
    "sourcePath": "/path/to/clis/example/search.js",
    "source": "// full adapter source code"
  },
  "page": {
    "url": "https://example.com/search",
    "snapshot": "// DOM snapshot with [N] indices",
    "networkRequests": [],
    "consoleErrors": []
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

**Parse it:**
```bash
# Extract JSON between markers from stderr output
cat diagnostic.json | sed -n '/___OPENCLI_DIAGNOSTIC___/{n;p;}'
```

## Step 2: Analyze the Failure

Read the diagnostic context and the adapter source. Classify the root cause:

| Error Code | Likely Cause | Repair Strategy |
|-----------|-------------|-----------------|
| SELECTOR | DOM restructured, class/id renamed | Explore current DOM → find new selector |
| EMPTY_RESULT | API response schema changed, or data moved | Check network → find new response path |
| API_ERROR | Endpoint URL changed, new params required | Discover new API via network intercept |
| AUTH_REQUIRED | Login flow changed, cookies expired | **STOP** — tell user to log in, do not modify code |
| TIMEOUT | Page loads differently, spinner/lazy-load | Add/update wait conditions |
| PAGE_CHANGED | Major redesign | May need full adapter rewrite |

**Key questions to answer:**
1. What is the adapter trying to do? (Read the `source` field)
2. What did the page look like when it failed? (Read the `snapshot` field)
3. What network requests happened? (Read `networkRequests`)
4. What's the gap between what the adapter expects and what the page provides?

## Step 3: Explore the Current Website

Use `opencli browser` to inspect the live website. **Never use the broken adapter** — it will just fail again.

### DOM changed (SELECTOR errors)

```bash
# Open the page and inspect current DOM
opencli browser open https://example.com/target-page && opencli browser state

# Look for elements that match the adapter's intent
# Compare the snapshot with what the adapter expects
```

### API changed (API_ERROR, EMPTY_RESULT)

```bash
# Open page with network interceptor, then trigger the action manually
opencli browser open https://example.com/target-page && opencli browser state

# Interact to trigger API calls
opencli browser click <N> && opencli browser network

# Inspect specific API response
opencli browser network --detail <index>
```

## Step 4: Patch the Adapter

Read the adapter source file at the path from `RepairContext.adapter.sourcePath` and make targeted fixes. This path is authoritative — it may be in the repo (`clis/`) or user-local (`~/.opencli/clis/`).

```bash
# Read the adapter (use the exact path from diagnostic)
cat <RepairContext.adapter.sourcePath>
```

### Common Fixes

**Selector update:**
```typescript
// Before: page.evaluate('document.querySelector(".old-class")...')
// After:  page.evaluate('document.querySelector(".new-class")...')
```

**API endpoint change:**
```typescript
// Before: const resp = await page.evaluate(`fetch('/api/v1/old-endpoint')...`)
// After:  const resp = await page.evaluate(`fetch('/api/v2/new-endpoint')...`)
```

**Response schema change:**
```typescript
// Before: const items = data.results
// After:  const items = data.data.items  // API now nests under "data"
```

**Wait condition update:**
```typescript
// Before: await page.waitForSelector('.loading-spinner', { hidden: true })
// After:  await page.waitForSelector('[data-loaded="true"]')
```

### Rules for Patching

1. **Make minimal changes** — fix only what's broken, don't refactor
2. **Keep the same output structure** — `columns` and return format must stay compatible
3. **Prefer API over DOM scraping** — if you discover a JSON API during exploration, switch to it
4. **Use `@jackwener/opencli/*` imports only** — never add third-party package imports
5. **Test after patching** — run the command again to verify

## Step 5: Verify the Fix

```bash
# Run the command normally (without diagnostic mode)
opencli <site> <command> [args...]
```

If it still fails, go back to Step 1 and collect fresh diagnostics. You have a budget of **3 repair rounds** (diagnose → fix → retry). If the same error persists after a fix, try a different approach. After 3 rounds, stop and report what was tried.

## Step 6: File an Upstream Issue

If the retry **passes**, the local adapter has drifted from upstream. File a GitHub issue so the fix flows back to `jackwener/OpenCLI`.

**Do NOT file for:**
- `AUTH_REQUIRED`, `BROWSER_CONNECT`, `ARGUMENT`, `CONFIG` — environment/usage issues, not adapter bugs
- CAPTCHA or rate limiting — not fixable upstream
- Failures you couldn't actually fix (3 rounds exhausted)

**Only file after a verified local fix** — the retry must pass first.

**Procedure:**

1. Prepare the issue content from the RepairContext you already have:
   - **Title:** `[autofix] <site>/<command>: <error_code>` (e.g. `[autofix] zhihu/hot: SELECTOR`)
   - **Body** (use this template):

```markdown
## Summary
OpenCLI autofix repaired this adapter locally, and the retry passed.

## Adapter
- Site: `<site>`
- Command: `<command>`
- OpenCLI version: `<version from opencli --version>`

## Original failure
- Error code: `<error_code>`

~~~
<error_message>
~~~

## Local fix summary

~~~
<1-2 sentence description of what you changed and why>
~~~

_Issue filed by OpenCLI autofix after a verified local repair._
```

2. **Ask the user before filing.** Show them the draft title and body. Only proceed if they confirm.

3. If the user approves and `gh auth status` succeeds:

```bash
gh issue create --repo jackwener/OpenCLI \
  --title "[autofix] <site>/<command>: <error_code>" \
  --body "<the body above>"
```

If `gh` is not installed or not authenticated, tell the user and skip — do not error out.

## When to Stop

**Hard stops (do not modify code):**
- **AUTH_REQUIRED / BROWSER_CONNECT** — environment issue, not adapter bug
- **Site requires CAPTCHA** — can't automate this
- **Rate limited / IP blocked** — not an adapter issue

**Soft stops (report after attempting):**
- **3 repair rounds exhausted** — stop, report what was tried and what failed
- **Feature completely removed** — the data no longer exists
- **Major redesign** — needs full adapter rewrite via `opencli-explorer` skill

In all stop cases, clearly communicate the situation to the user rather than making futile patches.

## Example Repair Session

```
1. User runs: opencli zhihu hot
   → Fails: SELECTOR "Could not find element: .HotList-item"

2. AI runs: OPENCLI_DIAGNOSTIC=1 opencli zhihu hot 2>diag.json
   → Gets RepairContext with DOM snapshot showing page loaded

3. AI reads diagnostic: snapshot shows the page loaded but uses ".HotItem" instead of ".HotList-item"

4. AI explores: opencli browser open https://www.zhihu.com/hot && opencli browser state
   → Confirms new class name ".HotItem" with child ".HotItem-content"

5. AI patches: Edit adapter at RepairContext.adapter.sourcePath — replace ".HotList-item" with ".HotItem"

6. AI verifies: opencli zhihu hot
   → Success: returns hot topics

7. AI prepares upstream issue draft, shows it to the user

8. User approves → AI runs: gh issue create --repo jackwener/OpenCLI --title "[autofix] zhihu/hot: SELECTOR" --body "..."
```
