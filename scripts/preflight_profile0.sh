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
