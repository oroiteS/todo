// TodoLite 桌面小组件（AppWidget / RemoteViews）
//
// 内容：今日待办 + 高优先级任务（与 macOS WidgetKit 小组件同一数据通道）。
// 数据：主应用（Rust）每次数据变更后把 WidgetSnapshot（camelCase JSON）写到
// 应用私有目录 widget/widget-snapshot.json，并经 JNI 调 refreshAll() 实时刷新；
// updatePeriodMillis = 30 分钟兜底轮询（系统最小值）。
//   - Tauri `app_data_dir()` 在 Android 上解析为 dataDir（/data/user/0/<pkg>），
//     因此快照实际落点为 dataDir/widget/；filesDir/widget/ 作为兼容回退一并探测。
// 快照 schema：src/bridge/widget.ts ↔ src-tauri/src/widget/mod.rs，
// 契约与落点详见 docs/widget-adaptation.md。

package com.syn.todolite

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.SpannableStringBuilder
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.annotation.Keep
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class TodoliteWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val views = render(context)
    for (appWidgetId in appWidgetIds) {
      manager.updateAppWidget(appWidgetId, views)
    }
  }

  companion object {
    private const val TAG = "TodoliteWidget"

    /** 4x2 布局可稳定展示的任务行数 */
    private const val MAX_ROWS = 4

    /**
     * 主应用写完快照后立即刷新所有已添加的组件实例。
     * 由 Rust 侧通过 JNI 反射调用（wry dispatch）——⚠️ 必须加 @Keep：
     * release 构建 R8 看不见 JNI 调用，不加会被改名/剔除（v0.2.4 即因此失效）。
     * 没有已添加实例时静默返回。
     */
    @Keep
    @JvmStatic
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        ComponentName(context, TodoliteWidgetProvider::class.java),
      )
      Log.i(TAG, "refreshAll invoked: ${ids.size} instance(s)")
      if (ids.isEmpty()) return
      runCatching {
        val views = render(context)
        for (id in ids) manager.updateAppWidget(id, views)
        Log.i(TAG, "refreshAll ok: ${ids.size} updated")
      }.onFailure { Log.w(TAG, "refreshAll failed", it) }
    }

    // --------------------------------------------------------------- 渲染

    fun render(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.todolite_widget)
      val taskIds = intArrayOf(
        R.id.todolite_widget_task0,
        R.id.todolite_widget_task1,
        R.id.todolite_widget_task2,
        R.id.todolite_widget_task3,
      )
      taskIds.forEach { views.setViewVisibility(it, View.GONE) }
      views.setViewVisibility(R.id.todolite_widget_empty, View.GONE)
      views.setViewVisibility(R.id.todolite_widget_high_badge, View.GONE)

      val snapshot = readSnapshot(context)
      if (snapshot == null) {
        // 尚无快照：应用从未启动过，或文件损坏。给一条引导文案，不崩。
        views.setTextViewText(R.id.todolite_widget_title, context.getString(R.string.app_name))
        views.setTextViewText(
          R.id.todolite_widget_empty,
          context.getString(R.string.todolite_widget_no_snapshot),
        )
        views.setTextColor(
          R.id.todolite_widget_empty,
          ContextCompat.getColor(context, R.color.todolite_widget_ink2),
        )
        views.setViewVisibility(R.id.todolite_widget_empty, View.VISIBLE)
        bindOpenAppClick(context, views)
        return views
      }

      val today = snapshot.optJSONArray("today")
      val overdue = snapshot.optJSONArray("overdue")
      val highPriority = snapshot.optJSONArray("highPriority")
      val counts = snapshot.optJSONObject("counts")

      // 标题：今天 · N（+ 红色「逾期 K」后缀）
      val todayCount = counts?.optInt("today", len(today)) ?: len(today)
      val overdueCount = len(overdue)
      val title = SpannableStringBuilder(context.getString(R.string.todolite_widget_title_prefix, todayCount))
      if (overdueCount > 0) {
        val suffix = " · " + context.getString(R.string.todolite_widget_overdue_suffix, overdueCount)
        title.append(suffix)
        title.setSpan(
          ForegroundColorSpan(ContextCompat.getColor(context, R.color.todolite_widget_danger)),
          title.length - suffix.length,
          title.length,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
      }
      views.setTextViewText(R.id.todolite_widget_title, title)

      // 高优先级徽标：❗ M
      val highCount = counts?.optInt("highPriority", len(highPriority)) ?: len(highPriority)
      if (highCount > 0) {
        views.setTextViewText(
          R.id.todolite_widget_high_badge,
          context.getString(R.string.todolite_widget_high_badge, highCount),
        )
        views.setTextColor(
          R.id.todolite_widget_high_badge,
          ContextCompat.getColor(context, R.color.todolite_widget_warn),
        )
        views.setViewVisibility(R.id.todolite_widget_high_badge, View.VISIBLE)
      }

      // 任务行：逾期（红点）→ 今日（灰点）→ 高优先级（橙点），按 id 去重，最多 4 行
      val rows = ArrayList<CharSequence>(MAX_ROWS)
      val seen = HashSet<String>()
      val dotOverdue = ContextCompat.getColor(context, R.color.todolite_widget_danger)
      val dotToday = ContextCompat.getColor(context, R.color.todolite_widget_dot_today)
      val dotHigh = ContextCompat.getColor(context, R.color.todolite_widget_warn)
      collectRows(rows, seen, overdue, dotOverdue)
      collectRows(rows, seen, today, dotToday)
      collectRows(rows, seen, highPriority, dotHigh)

      if (rows.isEmpty()) {
        views.setTextViewText(
          R.id.todolite_widget_empty,
          context.getString(R.string.todolite_widget_empty),
        )
        views.setTextColor(
          R.id.todolite_widget_empty,
          ContextCompat.getColor(context, R.color.todolite_widget_ink2),
        )
        views.setViewVisibility(R.id.todolite_widget_empty, View.VISIBLE)
      } else {
        rows.take(MAX_ROWS).forEachIndexed { index, row ->
          views.setTextViewText(taskIds[index], row)
          views.setViewVisibility(taskIds[index], View.VISIBLE)
        }
      }

      bindOpenAppClick(context, views)
      return views
    }

    /** 追加一个分组的任务行（带彩色圆点前缀），按 id 去重 */
    private fun collectRows(
      rows: MutableList<CharSequence>,
      seen: MutableSet<String>,
      tasks: JSONArray?,
      dotColor: Int,
    ) {
      if (tasks == null) return
      for (i in 0 until tasks.length()) {
        if (rows.size >= MAX_ROWS) return
        val task = tasks.optJSONObject(i) ?: continue
        val id = task.optString("id")
        if (id.isNotEmpty() && !seen.add(id)) continue
        val title = task.optString("title")
        if (title.isEmpty()) continue
        val row = SpannableString("●  $title")
        row.setSpan(
          ForegroundColorSpan(dotColor),
          0,
          1,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        rows.add(row)
      }
    }

    // --------------------------------------------------------------- 数据

    /** 按落点优先级读取快照；不存在或解析失败返回 null（调用方须容忍） */
    private fun readSnapshot(context: Context): JSONObject? {
      val candidates = listOfNotNull(
        // Tauri app_data_dir() 的实际落点（tauri 2.x：activity.dataDir）
        context.dataDir?.let { File(it, "widget/widget-snapshot.json") },
        // 文档口径的落点（filesDir），兼容 Tauri 未来调整
        File(context.filesDir, "widget/widget-snapshot.json"),
        // 外部存储兜底（一般不会用到）
        context.getExternalFilesDir(null)?.let { File(it, "widget/widget-snapshot.json") },
      )
      val file = candidates.firstOrNull { it.isFile } ?: return null
      return runCatching { JSONObject(file.readText()) }.getOrNull()
    }

    private fun len(array: JSONArray?): Int = array?.length() ?: 0

    // --------------------------------------------------------------- 交互

    /** 点击组件任意位置打开主应用（PendingIntent 直达 Activity，不用 trampoline） */
    private fun bindOpenAppClick(context: Context, views: RemoteViews) {
      val intent = Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val pendingIntent = PendingIntent.getActivity(
        context,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(android.R.id.background, pendingIntent)
    }
  }
}
