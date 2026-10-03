# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── Rust 侧 JNI 反射调用的入口 ──────────────────────────────────────────
# R8 看不见 JNI 调用（write_widget_snapshot → wry dispatch → refreshAll），
# 会把此类"无引用"方法改名/剔除——v0.2.4 即因此导致小组件永不刷新。
# 类名本身由 Manifest receiver 的 keep 规则保留，这里保住方法名与签名。
-keepclassmembers class com.syn.todolite.TodoliteWidgetProvider {
    public static void refreshAll(android.content.Context);
}