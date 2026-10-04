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
# ⚠️ 状态（2026-10-04，macOS 27 实测）：本脚本产物可被 PlugInKit 注册，但无法
# 进入小组件画廊——chronod 拉起扩展抓取描述符时在 EXExtension 引导阶段崩溃。
# 同机 ad-hoc 签名、Xcode 构建的第三方扩展工作正常，免费签名并非阻碍；根因
# 未定位，恢复路径（改用 Xcode 工程构建扩展）与完整排查记录见
# docs/widget-adaptation.md §4.5。脚本与接口保留待恢复。
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

# 定位主应用 .app（提前定位：appex 版本号需要从主应用 Info.plist 读取）
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

echo "==> 组装 .appex…"
rm -rf "$BUILD_DIR/TodoLiteWidget.appex"
mkdir -p "$BUILD_DIR/TodoLiteWidget.appex/Contents/MacOS"
cp "$SRC_DIR/Info.plist" "$BUILD_DIR/TodoLiteWidget.appex/Contents/Info.plist"
# 版本号严格同步主应用。原因有二：
# 1. PluginKit 按 bundle-id + version 索引小组件（版本不一致会导致更新后组件消失）；
# 2. 版本串必须合法（^[0-9]+(\.[0-9]+){0,3}$），否则 ExtensionKit 在枚举阶段直接拒绝扩展
#    —— 旧脚本曾把 PlistBuddy 读 JSON 失败的报错串当版本号写进去，导致画廊永不枚举。
APP_SHORT_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
APP_BUNDLE_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
if [[ ! "$APP_SHORT_VER" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]; then
  echo "错误：主应用版本串异常（'${APP_SHORT_VER}'），拒绝写入 appex。" >&2
  exit 1
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_SHORT_VER}" \
  "$BUILD_DIR/TodoLiteWidget.appex/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_BUNDLE_VER:-$APP_SHORT_VER}" \
  "$BUILD_DIR/TodoLiteWidget.appex/Contents/Info.plist"
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
echo "下一步（画廊不显示时按序执行）："
echo "  1. 干净安装：rm -rf /Applications/TodoLite.app && cp -R \"$APP_PATH\" /Applications/"
echo "     （原位覆盖不会触发系统重新索引扩展，必须先删后拷）"
echo "  2. open /Applications/TodoLite.app 启动一次，再 killall chronod 重启小组件守护进程"
echo "  3. 通知中心 → 编辑小组件 → 搜索 TodoLite"
echo "  4. 仍不出现时的诊断："
echo "     pluginkit -m -i com.syn.todolite.widget   # 看扩展是否已注册"
echo "     log stream --predicate 'process == \"chronod\"' --level debug   # 打开画廊看拒绝原因"
