#!/usr/bin/env bash
# 编译 TodoLite macOS 小组件扩展（WidgetKit）并嵌入 Tauri 产出的 .app。
#
# 本仓库没有 Xcode 工程（Tauri 桌面端用 cargo 直接构建），
# 因此用 swiftc 手工编译 Swift 源码 → 组装 .appex → ad-hoc 签名 → 嵌入 PlugIns。
#
# 用法：
#   pnpm tauri build                      # 先构建主应用
#   scripts/build-macos-widget.sh         # 编译小组件并嵌入（自动查找 .app）
#   scripts/build-macos-widget.sh /path/to/TodoLite.app   # 或显式指定 .app
#
# 嵌入后打开一次应用以注册扩展，即可在 通知中心/桌面 添加「今日待办」小组件。
# 正式分发（非 ad-hoc）需配置签名身份后再运行本脚本，见 docs/widget-adaptation.md。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/src-tauri/widgets/macos"
BUILD_DIR="$ROOT/src-tauri/target/widget-build"
SDK="$(xcrun --show-sdk-path)"
MIN_MACOS="14.0"

echo "==> 编译 Swift（universal: arm64 + x86_64）…"
mkdir -p "$BUILD_DIR/module-cache"
xcrun swiftc -O -parse-as-library -swift-version 5 \
  -target "arm64-apple-macos$MIN_MACOS" -sdk "$SDK" \
  -module-cache-path "$BUILD_DIR/module-cache" \
  -emit-executable -o "$BUILD_DIR/TodoLiteWidget-arm64" \
  "$SRC_DIR/TodoLiteWidget.swift"
xcrun swiftc -O -parse-as-library -swift-version 5 \
  -target "x86_64-apple-macos$MIN_MACOS" -sdk "$SDK" \
  -module-cache-path "$BUILD_DIR/module-cache" \
  -emit-executable -o "$BUILD_DIR/TodoLiteWidget-x86_64" \
  "$SRC_DIR/TodoLiteWidget.swift"
lipo -create -output "$BUILD_DIR/TodoLiteWidget" \
  "$BUILD_DIR/TodoLiteWidget-arm64" "$BUILD_DIR/TodoLiteWidget-x86_64"

echo "==> 组装 .appex…"
rm -rf "$BUILD_DIR/TodoLiteWidget.appex"
mkdir -p "$BUILD_DIR/TodoLiteWidget.appex/Contents/MacOS"
cp "$SRC_DIR/Info.plist" "$BUILD_DIR/TodoLiteWidget.appex/Contents/Info.plist"
# 版本号跟随主应用（可选，失败不阻断）
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :version' "$ROOT/src-tauri/tauri.conf.json" 2>/dev/null || true)"
if [[ -n "${APP_VERSION}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" \
    "$BUILD_DIR/TodoLiteWidget.appex/Contents/Info.plist" || true
fi
cp "$BUILD_DIR/TodoLiteWidget" "$BUILD_DIR/TodoLiteWidget.appex/Contents/MacOS/TodoLiteWidget"

echo "==> 解析签名身份…"
# 优先 Apple Development 证书（App Groups 沙盒形态必需）；
# 无证书环境回退 ad-hoc（扩展 entitlements 需为空形态，见 entitlements 文件内注释）
if [[ -z "${SIGN_IDENTITY:-}" ]]; then
  SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
    | awk '/Apple Development/{print $2; exit}')"
fi
[[ -n "$SIGN_IDENTITY" ]] || SIGN_IDENTITY="-"
echo "    使用身份: $SIGN_IDENTITY"

echo "==> 签名 extension…"
codesign --force --sign "$SIGN_IDENTITY" --timestamp=none \
  --entitlements "$SRC_DIR/TodoLiteWidget.entitlements" \
  "$BUILD_DIR/TodoLiteWidget.appex"

# 定位主应用 .app
APP_PATH="${1:-}"
if [[ -z "$APP_PATH" ]]; then
  for c in \
    "$ROOT/src-tauri/target/release/bundle/macos/TodoLite.app" \
    "$ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/TodoLite.app" \
    "$ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/TodoLite.app"; do
    if [[ -d "$c" ]]; then APP_PATH="$c"; break; fi
  done
fi
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "错误：未找到 TodoLite.app。请先运行 pnpm tauri build，或把 .app 路径作为参数传入。" >&2
  exit 1
fi

echo "==> 嵌入 $APP_PATH …"
mkdir -p "$APP_PATH/Contents/PlugIns"
rm -rf "$APP_PATH/Contents/PlugIns/TodoLiteWidget.appex"
cp -R "$BUILD_DIR/TodoLiteWidget.appex" "$APP_PATH/Contents/PlugIns/"

echo "==> 重签主应用（注入 App Groups entitlements，不用 --deep 以免覆盖 extension 签名）…"
codesign --force --sign "$SIGN_IDENTITY" --timestamp=none \
  --entitlements "$SRC_DIR/TodoLiteApp.entitlements" \
  "$APP_PATH"

echo ""
echo "完成 ✅  小组件已嵌入：$APP_PATH"
echo "下一步：open \"$APP_PATH\" 启动一次应用，然后在 通知中心 → 编辑小组件 里添加「今日待办」。"
