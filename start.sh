#!/usr/bin/env bash
# 启动脚本 —— 在转换产出的项目目录中运行
# 自动检测 pi、加载 extension.ts 并进入游戏，支持透传参数（如 --model）
set -euo pipefail

if ! command -v pi &>/dev/null; then
  echo "错误: pi 未安装，请先安装 pi coding agent" >&2
  echo "安装指引: https://github.com/earendil-works/pi-coding-agent" >&2
  exit 1
fi

# 切换到脚本所在目录（项目根目录）
cd "$(dirname "$(readlink -f "$0")")"

echo "启动《$(basename "$PWD")》..."
# 会话存档放在项目内，方便打包带走；发布前删除 sessions/。
mkdir -p ./sessions

# state/ 是 session-backed 状态的 debug export / legacy fallback，真实存档在 pi session 快照中。
# 生成项目时应把 state/ 写进 .gitignore；发布包不要包含 state/。

# ---- 项目隔离 ----
# PI_CODING_AGENT_DIR 将 pi 的配置目录从 ~/.pi/agent/ 切换到 .pi/agent/，
# 实现全局配置/skills 的隔离。项目自己的 extension.ts 通过 -e 显式加载。
#
# --no-skills 禁用所有自动发现的 skill（全局、npm 包内置等），
# 然后 --skill ./skills/ 显式加载项目自己的 skills 目录。
# 确保 reviewer/coder/oracle 等开发用 skill 不会泄漏到游戏会话中。
#
# 项目级 pi 包（例如 npm:pi-subagents / npm:pi-powerline-footer）应声明在
# 项目根 .pi/settings.json 的 packages 数组中；pi 首次启动会自动安装到 .pi/npm/。
# 发布包保留 .pi/settings.json 和 .pi/agents/，不要打包 .pi/npm/。
#
# 首次启动时自动初始化 .pi/agent/：
#   1. 如有全局 auth，复制过来（也可在后续手动 /login）
#   2. 创建最小 settings.json

mkdir -p .pi/agent

if [ ! -f .pi/agent/auth.json ] && [ -f "$HOME/.pi/agent/auth.json" ]; then
  cp "$HOME/.pi/agent/auth.json" .pi/agent/auth.json
  echo "✓ 已复制认证信息到项目隔离环境"
fi

if [ ! -f .pi/agent/settings.json ]; then
  cat >.pi/agent/settings.json <<-'EOF'
{
  "theme": "dark"
}
EOF
  echo "✓ 已创建项目隔离配置 (.pi/agent/settings.json)"
  echo "  （如需指定默认模型，编辑此文件添加 defaultProvider / defaultModel）"
fi

# 普通玩家模式禁用 pi-subagents 内置 coding agents，避免 reviewer/worker/oracle 等出现在游戏运行时。
# 开发时如需保留内置 agents：TAVERN2AGENT_DEV=1 ./start.sh
node - <<'NODE'
const fs = require('fs');
const path = '.pi/agent/settings.json';
const dev = process.env.TAVERN2AGENT_DEV === '1';
let settings = {};
try {
  if (fs.existsSync(path)) settings = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch {
  settings = {};
}
settings.theme ??= 'dark';
settings.subagents ??= {};
settings.subagents.disableBuiltins = !dev;
fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
NODE
if [ "${TAVERN2AGENT_DEV:-}" = "1" ]; then
  echo "✓ 开发模式：保留 pi-subagents 内置 agents"
else
  echo "✓ 玩家模式：已禁用 pi-subagents 内置 coding agents（开发模式: TAVERN2AGENT_DEV=1 ./start.sh）"
fi

# ---- 后台 director sessions ----
# run_parallel_line 由引擎直接 fork 后台导演（detached `pi -p`，见 ADR 0005），
# 导演 session（含隐藏事实）持久落在 gitignored 的 .pi/agent/backstage-sessions/。
# 引擎首次 spawn 会自建该目录；此处预建只为显式留痕。
mkdir -p .pi/agent/backstage-sessions

# 双模型：渲染轮（玩家可见正文）可与结算轮用不同模型，详见 README “Model Notes”。
if [ -n "${RENDER_MODEL:-}" ]; then
  echo "✓ 渲染轮模型覆盖：RENDER_MODEL=$RENDER_MODEL（未命中会回退结算模型）"
else
  echo "ℹ 渲染轮复用结算模型（可用 RENDER_MODEL=provider/model-id 单独指定文笔模型）"
fi
if [ -n "${DIGEST_MODEL:-}" ]; then
  echo "✓ digest writer 模型覆盖：DIGEST_MODEL=$DIGEST_MODEL（未命中会回退渲染模型）"
fi

export PI_CODING_AGENT_DIR=".pi/agent"
export PI_CLAUDE_OAUTH_REINJECT_SCOPE=never

# ---- pi-webui（基于 @firstpick/pi-package-webui） ----
# 检测并启动 webui 服务器；端口 31415，已支持 EADDRINUSE 优雅处理。
# webui RPC 子进程通过 env var 继承游戏扩展和技能。
export PI_WEBUI_EXTENSION_PATHS="./extension.ts:./extensions/compaction/index.ts:./extensions/player-panel/index.ts:./extensions/player-choices/index.ts:./extensions/rewind/index.ts:./extensions/render/index.ts:$HOME/.pi/agent/npm/node_modules/pi-intercom/index.ts"
export PI_WEBUI_SKILL_PATHS="./skills"
PI_WEBUI_HOST="127.0.0.1"
PI_WEBUI_PORT=31415
PI_WEBUI_URL="http://$PI_WEBUI_HOST:$PI_WEBUI_PORT"
WEBUI_PID=

# 脚本退出时关闭 webui
cleanup_webui() {
  if [ -n "$WEBUI_PID" ] && kill -0 "$WEBUI_PID" 2>/dev/null; then
    # 先尝试优雅关闭
    curl -s -X POST "$PI_WEBUI_URL/api/shutdown" >/dev/null 2>&1 || true
    sleep 0.5
    kill "$WEBUI_PID" 2>/dev/null || true
    wait "$WEBUI_PID" 2>/dev/null || true
  fi
}
trap cleanup_webui EXIT

if curl -sf "$PI_WEBUI_URL/api/health" >/dev/null 2>&1; then
  echo "✓ webui 已在运行: $PI_WEBUI_URL"
else
  echo "ℹ 启动 webui 服务器..."
  node ./packages/pi-webui/bin/pi-webui.mjs \
    --host "$PI_WEBUI_HOST" --port "$PI_WEBUI_PORT" --cwd "$PWD" \
    &>/dev/null &
  WEBUI_PID=$!
  # 等几秒让服务就绪
  for i in $(seq 1 10); do
    if curl -sf "$PI_WEBUI_URL/api/health" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  echo "✓ webui 已启动: $PI_WEBUI_URL"
fi
pi_exit=0
pi \
  --no-skills \
  --skill ./skills/ \
  -e ./extension.ts \
  -e ./extensions/compaction/index.ts \
  -e ./extensions/player-panel/index.ts \
  -e ./extensions/player-choices/index.ts \
  -e ./extensions/rewind/index.ts \
  -e ./extensions/render/index.ts \
  -e $HOME/.pi/agent/npm/node_modules/pi-intercom/index.ts \
  -e ./packages/pi-webui/index.ts \
  --session-dir ./sessions \
  --no-context-files \
  "$@" || pi_exit=$?

cat <<'MSG'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  提示：如要分享此项目（git push / 打包发送等），
    请删除 .pi/agent/auth.json（包含 API 密钥）、sessions/（会话存档）和 state/（调试导出）。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
exit $pi_exit
