# TodoLite 兼容式更新指南

目标:**任何一次发版,用户都能直接覆盖安装,不需要先卸载旧版,数据始终保留。**

---

## 一、为什么以前每次更新都要先卸载?

根因在 Android:此前 CI 一直用 `pnpm tauri android build --apk --debug` 构建 **debug APK**。
debug 包使用的是"构建机自动生成的调试密钥"——每台机器、每次 CI 环境都不同,
于是每个版本的 APK 签名都不一样。Android 检测到签名与已安装应用不一致时,
会拒绝覆盖安装(报"应用未安装"/签名冲突),用户只能卸载重装,**数据全部丢失**。

## 二、各平台"覆盖安装"机制速览

| 平台 | 安装包 | 系统判断能否覆盖安装 | 用户数据位置 | 本次改动 |
|---|---|---|---|---|
| Android | `.apk` | ① `applicationId` 相同 ② **签名证书相同** ③ `versionCode` ≥ 已安装版 | 应用沙盒 `/data/data/com.syn.todolite` | ✅ 固定 release 签名 + 显式 versionCode 推导 |
| Windows | `.exe`(NSIS)/ `.msi` | NSIS 按产品识别原地升级,自动卸旧装新 | `%APPDATA%\com.syn.todolite` | 无需改动 |
| macOS | `.dmg` | 拖入「应用程序」覆盖旧 `.app` 即可 | `~/Library/Application Support/com.syn.todolite` | 无需改动(可选公证,见 §七) |

三端共同的**应用身份**是 Tauri 的 `identifier` / Android 的 `applicationId`:
`com.syn.todolite`。**发布后永不修改**——数据目录、覆盖安装判断全都挂在它上面。
(如果误改,系统会当成全新应用:旧版还在、数据看不到。)

## 三、Android:生成并托管签名密钥(仅一次性)

Android 端兼容式更新的核心 = **所有版本用同一把私钥签名**。已完成的工程改造:

- `src-tauri/gen/android/app/build.gradle.kts`
  - 支持从 `keystore.properties`(本地)或环境变量(CI secrets)读取签名配置;
  - `versionCode` 显式按 `major×1_000_000 + minor×1_000 + patch` 推导,只要版本号不降就严格递增;
- `.github/workflows/release.yml`
  - 配置了签名 secrets 时构建**已签名 release APK**;未配置时回退 debug 包并明确标注;
  - 打 tag 发版时校验「tag 版本 == `tauri.conf.json` 的 version」,防止 versionCode 倒退。

### 操作步骤(一次性)

```bash
./scripts/gen-android-keystore.sh   # 生成 todolite-release.jks,设置一个强密码(无需安装 JDK,
                                    # 脚本会自动找本机 keytool,找不到就用 openssl 生成等效 PKCS12)
```

然后二选一:

**A. GitHub Actions 签名(推荐)** — 在仓库 *Settings → Secrets and variables → Actions* 配置:

| Secret | 值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i todolite-release.jks` 的输出(macOS;Linux 用 `base64 -w0`) |
| `ANDROID_KEYSTORE_PASSWORD` | 生成时设置的密码 |
| `ANDROID_KEY_ALIAS` | `todolite`(脚本默认别名) |
| `ANDROID_KEY_PASSWORD` | PKCS12 格式下与 store 密码相同 |

**B. 本地构建签名** — 在 `src-tauri/gen/android/app/` 创建 `keystore.properties`(已被 `.gitignore` 忽略):

```properties
storeFile=/绝对/路径/todolite-release.jks
storePassword=<你的密码>
keyAlias=todolite
keyPassword=<同 storePassword>
```

### 三条保命纪律

1. **多处备份 keystore**(私有网盘 + 离线介质)。丢了它,所有已安装用户永远无法再覆盖升级;
2. **绝不提交进 git**(已由 `.gitignore` 拦截 `*.jks` / `*.keystore` / `keystore.properties`);
3. 验证两个 APK 能否互升:`apksigner verify --print-certs a.apk b.apk`,证书 SHA-256 必须一致。

> 若将来上架 Google Play:Play 会启用 Play App Signing(由 Google 托管签名密钥,
> 上传密钥可轮换),本地的 jks 届时作为"上传密钥"使用,同样要保管好。

## 四、日常发版流程(每次)

1. **递增版本号**:`src-tauri/tauri.conf.json` 的 `version`(建议同步 `package.json`);
2. 提交后打 tag:`git tag v0.1.1 && git push origin v0.1.1`
   (tag 必须与 `tauri.conf.json` 版本一致,CI 会拦截不一致的 tag);
3. CI 自动产出 macOS dmg / Windows exe+msi / Android 已签名 APK 并发布 Release;
4. 用户三端均直接覆盖安装,数据保留;
5. 若维护 Homebrew tap:同步更新 `Casks/todolite.rb` 的 `version` 与两个 `sha256`。

## 五、一次性迁移(仅此一次)

**在第一个 release 签名版之前**装过旧 debug APK 的用户,升级到该版本时仍需卸载重装
一次(从"debug 签名"切换到"发布签名"的体系切换,不可避免)。此后所有版本永久免卸载。

## 六、红线清单(违反任意一条 = 破坏兼容更新)

1. ❌ 修改 `identifier` / `applicationId`(等价于发布另一个应用);
2. ❌ 重新生成或更换 keystore;
3. ❌ 发布比线上更低的 `version` / `versionCode`;
4. ❌ 把 keystore / 密码提交进仓库或发到聊天里;
5. ⚠️ 大版本号别越界:`major/minor/patch` 每段需 < 1000(versionCode 映射上限)。

## 七、可选进阶(本次未实施,需要时可启用)

| 能力 | 机制 | 说明 |
|---|---|---|
| 桌面应用内自动更新 | `tauri-plugin-updater` + minisign 签名的更新清单 | 需静态资源托管端点 + 生成签名密钥对;桌面端可免手动下载 |
| macOS 开发者签名+公证 | Apple Developer ID + notarytool | **CI 已预留**:配置 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 这些 secrets 即自动生效。不公证时用户首次打开需右键→打开绕过 Gatekeeper,但覆盖安装与数据保留不受影响 |
| Windows 代码签名 | Authenticode 证书(ov/ev) | 消除 SmartScreen 提示;不影响覆盖安装 |
| 上架应用商店 | Android AAB + Play App Signing / Mac App Store | 商店模式下签名由平台托管 |
