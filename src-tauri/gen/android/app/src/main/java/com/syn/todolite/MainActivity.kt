package com.syn.todolite

import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 边到边布局（Android 15+ 强制）下，WebView 会铺到系统栏底下，
    // 而前端没有安全区适配（Android WebView 的 env(safe-area-inset-*) 恒为 0），
    // 应用顶栏会被状态栏遮挡且无法点击。这里给内容容器加系统栏/刘海/键盘 insets
    // 的 padding，使网页内容始终位于系统栏之内。
    // 注意：WebView 由 Rust 侧异步挂载，因此监听器挂在始终存在的 content 容器上。
    val content = window.decorView.findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime(),
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
