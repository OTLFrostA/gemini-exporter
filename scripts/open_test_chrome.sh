#!/usr/bin/env bash
# scripts/open_test_chrome.sh - 一键拉起携带固化登录态与自动加载插件的独立 Chrome 窗口

set -e

PROFILE_DIR="$HOME/.gemini-exporter-test-profile"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -f "$CHROME_BIN" ]; then
  echo "❌ 错误: 未在标准路径找到 Google Chrome: $CHROME_BIN"
  exit 1
fi

mkdir -p "$PROFILE_DIR"

echo "=================================================="
echo "🚀 正在启动 Gemini Exporter 专属持久化测试浏览器"
echo "📁 测试 Profile 目录: $PROFILE_DIR"
echo "🧩 自动挂载扩展源码: $REPO_DIR"
echo "💡 提示: 首次打开请在弹出的窗口中登录 Google 账号，后续将永远保持登录与插件就绪状态！"
echo "=================================================="

exec "$CHROME_BIN" \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$REPO_DIR" \
  --disable-extensions-except="$REPO_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://gemini.google.com" "$@"
