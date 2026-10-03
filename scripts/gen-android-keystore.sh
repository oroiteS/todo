#!/usr/bin/env bash
# 生成 TodoLite 的 Android 发布签名密钥。
#
# 这是「兼容式更新」的一次性操作:此后所有版本必须用同一把密钥签名,
# Android 才允许新版本直接覆盖安装旧版本(保留用户数据)。
#
# 用法:
#   ./scripts/gen-android-keystore.sh [输出路径]        # 默认 todolite-release.jks
# 环境变量:
#   KEY_ALIAS       密钥别名,默认 todolite
#   VALIDITY_DAYS   有效期天数,默认 10950(约 30 年)
set -euo pipefail

OUT_FILE="${1:-todolite-release.jks}"
KEY_ALIAS="${KEY_ALIAS:-todolite}"
VALIDITY_DAYS="${VALIDITY_DAYS:-10950}"
KEYTOOL="${KEYTOOL:-keytool}"

command -v "$KEYTOOL" >/dev/null 2>&1 || {
  echo "错误:未找到 keytool(随 JDK 安装)。可临时指定:KEYTOOL=\"\$JAVA_HOME/bin/keytool\" $0"
  exit 1
}

if [ -e "$OUT_FILE" ]; then
  echo "错误:$OUT_FILE 已存在。"
  echo "兼容式更新要求所有版本使用同一把密钥;重新生成会让全部已安装用户无法覆盖升级。"
  echo "如确要重置(明白后果),请手动删除该文件后再运行本脚本。"
  exit 1
fi

echo "==> 生成密钥库 $OUT_FILE(别名: $KEY_ALIAS,有效期: ${VALIDITY_DAYS} 天)"
echo "    请设置并牢记 keystore 密码(PKCS12 格式下 key 密码与之相同)。"
"$KEYTOOL" -genkeypair -v \
  -keystore "$OUT_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA -keysize 4096 -validity "$VALIDITY_DAYS" \
  -storetype PKCS12

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
