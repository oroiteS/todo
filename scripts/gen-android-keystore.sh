#!/usr/bin/env bash
# 生成 TodoLite 的 Android 发布签名密钥。
#
# 这是「兼容式更新」的一次性操作:此后所有版本必须用同一把密钥签名,
# Android 才允许新版本直接覆盖安装旧版本(保留用户数据)。
#
# 无需安装 JDK:脚本会依次寻找本机可用的 keytool(JAVA_HOME / Android Studio
# 自带 JBR / 常见 JDK 安装位置),全部找不到时退回用系统 openssl 直接生成
# 等效的 PKCS12 密钥库(AGP / CI 的 Java 均可直接读取)。
#
# 用法:
#   ./scripts/gen-android-keystore.sh [输出路径]     # 默认 todolite-release.jks
# 环境变量(均可选):
#   KEY_ALIAS      密钥别名,默认 todolite
#   VALIDITY_DAYS  有效期天数,默认 10950(约 30 年)
#   KEYTOOL        显式指定 keytool 路径
#   STORE_PASS     非交互指定密码(默认交互式输入,推荐)
#   SUBJECT        证书主题,默认 /CN=TodoLite Release/O=TodoLite
set -euo pipefail

OUT_FILE="${1:-todolite-release.jks}"
KEY_ALIAS="${KEY_ALIAS:-todolite}"
VALIDITY_DAYS="${VALIDITY_DAYS:-10950}"
SUBJECT="${SUBJECT:-/CN=TodoLite Release/O=TodoLite}"

note() { printf '%s\n' "$*"; }
die()  { printf '错误:%s\n' "$*" >&2; exit 1; }

if [ -e "$OUT_FILE" ]; then
  die "$OUT_FILE 已存在。兼容式更新要求所有版本使用同一把密钥;重新生成会让全部已安装用户无法覆盖升级。如确要重置(明白后果),请手动删除该文件后再运行。"
fi

# ---- 找一个真正能运行的 keytool ----
# macOS 的 /usr/bin/keytool 是个桩程序,command -v 找得到但一运行就报
# “Unable to locate a Java Runtime”,所以候选者必须实际执行验证。
keytool_ok() { "$1" -help >/dev/null 2>&1; }

find_keytool() {
  local cand
  if [ -n "${KEYTOOL:-}" ] && keytool_ok "$KEYTOOL" 2>/dev/null; then
    printf '%s\n' "$KEYTOOL"; return 0
  fi
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ] && keytool_ok "$JAVA_HOME/bin/keytool"; then
    printf '%s\n' "$JAVA_HOME/bin/keytool"; return 0
  fi
  # Android Studio 自带 JBR,装了 AS 就等于有了 JDK
  for cand in \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
    "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home/bin/keytool"; do
    if [ -x "$cand" ] && keytool_ok "$cand"; then printf '%s\n' "$cand"; return 0; fi
  done
  for cand in "$HOME"/.jdks/*/Contents/Home/bin/keytool \
              "$HOME"/.jdks/*/bin/keytool \
              /Library/Java/JavaVirtualMachines/*/Contents/Home/bin/keytool \
              /opt/homebrew/opt/openjdk*/bin/keytool; do
    if [ -x "$cand" ] && keytool_ok "$cand"; then printf '%s\n' "$cand"; return 0; fi
  done
  if command -v keytool >/dev/null 2>&1 && keytool_ok "$(command -v keytool)"; then
    command -v keytool; return 0
  fi
  return 1
}

gen_with_keytool() {
  note "==> 使用 keytool: $1"
  note "    请设置并牢记 keystore 密码(PKCS12 格式下 key 密码与之相同)。"
  # SUBJECT 是 openssl 风格斜杠格式(/CN=X/O=Y),keytool -dname 需要逗号格式(CN=X, O=Y)
  local dname="${SUBJECT#/}"; dname="${dname//\//, }"
  if [ -n "${STORE_PASS:-}" ]; then
    "$1" -genkeypair -v \
      -keystore "$OUT_FILE" -alias "$KEY_ALIAS" \
      -keyalg RSA -keysize 4096 -validity "$VALIDITY_DAYS" \
      -storetype PKCS12 -storepass "$STORE_PASS" -keypass "$STORE_PASS" \
      -dname "$dname"
  else
    "$1" -genkeypair -v \
      -keystore "$OUT_FILE" -alias "$KEY_ALIAS" \
      -keyalg RSA -keysize 4096 -validity "$VALIDITY_DAYS" \
      -storetype PKCS12
  fi
}

gen_with_openssl() {
  command -v openssl >/dev/null 2>&1 || die "本机既没有可用的 JDK/keytool,也没有 openssl"
  note "==> 本机没有可用的 JDK,改用 openssl 生成 PKCS12 密钥库(与 keytool 产物等效,CI 的 Java 可直接读取)"
  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days "$VALIDITY_DAYS" \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -subj "$SUBJECT" >/dev/null 2>&1
  note "==> 请设置并牢记 keystore 密码(PKCS12 下 key 密码与 store 密码相同)。"
  if [ -n "${STORE_PASS:-}" ]; then
    openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
      -name "$KEY_ALIAS" -out "$OUT_FILE" -passout "pass:$STORE_PASS" 2>/dev/null
  else
    openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
      -name "$KEY_ALIAS" -out "$OUT_FILE"
  fi
  chmod 600 "$OUT_FILE"
}

if KEYTOOL_BIN="$(find_keytool)"; then
  gen_with_keytool "$KEYTOOL_BIN"
else
  gen_with_openssl
fi

[ -s "$OUT_FILE" ] || die "密钥库生成失败,请重试"
ABS_PATH="$(cd "$(dirname "$OUT_FILE")" && pwd)/$(basename "$OUT_FILE")"

cat <<EOF

==> 完成!请立即多处备份(丢失 = 再也无法对已安装用户推送覆盖更新):
    $ABS_PATH

==> 方式 A:本地构建签名
    在 src-tauri/gen/android/app/ 下创建 keystore.properties(已被 .gitignore 忽略):
      storeFile=$ABS_PATH
      storePassword=<你设置的密码>
      keyAlias=$KEY_ALIAS
      keyPassword=<同 storePassword>
    然后:pnpm tauri android build --apk

==> 方式 B(推荐):GitHub Actions 签名
    1) 生成 base64 并复制:
         macOS:  base64 -i "$OUT_FILE" | pbcopy
         Linux:  base64 -w0 "$OUT_FILE"
    2) 在仓库 Settings → Secrets and variables → Actions 配置:
         ANDROID_KEYSTORE_BASE64 = 上面复制的 base64
         ANDROID_KEYSTORE_PASSWORD = 你设置的密码
         ANDROID_KEY_ALIAS         = $KEY_ALIAS
         ANDROID_KEY_PASSWORD      = 同 storePassword
    3) 打 tag 发版,CI 会自动产出已签名 release APK。

==> 验证两个 APK 是否可互相覆盖安装(证书一致):
    apksigner verify --print-certs app1.apk app2.apk   # 证书 SHA-256 必须相同
EOF
