import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// ===== 兼容式更新 1/2:versionCode 单调递增 =====
// Android 只有在 versionCode >= 已安装版本时才允许覆盖安装。
// 这里显式把 semver 映射为整数(major*1_000_000 + minor*1_000 + patch),
// 只要不降低 tauri.conf.json 里的 version,versionCode 就严格递增。
val androidVersionName: String = tauriProperties.getProperty("tauri.android.versionName", "0.1.1")
val androidVersionCode: Int = run {
    val match = Regex("(\\d+)\\.(\\d+)\\.(\\d+)").find(androidVersionName)
    if (match != null) {
        val (major, minor, patch) = match.destructured
        major.toInt() * 1_000_000 + minor.toInt() * 1_000 + patch.toInt()
    } else {
        tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
    }
}

// ===== 兼容式更新 2/2:固定签名密钥 =====
// 同一 applicationId 的更新包必须用同一把私钥签名,否则 Android 视为不同应用,
// 拒绝覆盖安装,用户只能卸载重装(数据全丢)。
// 签名配置优先读同目录 keystore.properties(本地,勿提交),其次读环境变量(CI secrets)。
val keystoreProperties = Properties().apply {
    val propFile = file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
val ciEnv = System.getenv()
val keystoreFile: String? = keystoreProperties.getProperty("storeFile") ?: ciEnv["ANDROID_KEYSTORE_FILE"]
val keystoreStorePassword: String? = keystoreProperties.getProperty("storePassword") ?: ciEnv["ANDROID_KEYSTORE_PASSWORD"]
val keystoreKeyAlias: String? = keystoreProperties.getProperty("keyAlias") ?: ciEnv["ANDROID_KEY_ALIAS"]
val keystoreKeyPassword: String? =
    keystoreProperties.getProperty("keyPassword")
        ?: ciEnv["ANDROID_KEY_PASSWORD"]
        ?: keystoreStorePassword
val hasReleaseSigning =
    keystoreFile != null && keystoreStorePassword != null && keystoreKeyAlias != null && keystoreKeyPassword != null

android {
    compileSdk = 37
    namespace = "com.syn.todolite"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        // 注意:applicationId 是 Android 的应用身份,发布后绝不可修改,
        // 改了就会被当成另一个应用,旧版本与数据无法延续。
        applicationId = "com.syn.todolite"
        minSdk = 24
        targetSdk = 37
        versionCode = androidVersionCode
        versionName = androidVersionName
    }
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(keystoreFile!!)
                storePassword = keystoreStorePassword
                keyAlias = keystoreKeyAlias
                keyPassword = keystoreKeyPassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
            // 有签名配置时产出已签名 release APK(可直接覆盖安装);
            // 没有时退化为未签名 release APK(CI 里此时走 debug 兜底分支)。
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
