// TodoLite 桌面小组件（AppWidget / RemoteViews）
//
// 内容：离今天最近的 8 个任务（2 列 × 4 行；快照 nearest 数组，最多 10 条，
// >8 条时底部"……"提示溢出）。行前圆点按任务自身状态着色：
// 逾期红 / 今天灰 / 高优橙 / 普通灰；未来到期的任务标题后追加「·明天 / ·M/D」角标。
// 数据：主应用（Rust）每次数据变更后把 WidgetSnapshot（camelCase JSON）写到
// 应用私有目录 widget/widget-snapshot.json，并经 JNI 调 refreshAll() 实时刷新；
// updatePeriodMillis = 30 分钟兜底轮询（系统最小值）。
//   - Tauri `app_data_dir()` 在 Android 上解析为 dataDir（/data/user/0/<pkg>），
//     因此快照实际落点为 dataDir/widget/；filesDir/widget/ 作为兼容回退一并探测。
// 兼容：旧版快照无 nearest 字段时，回退为 逾期→今日→高优 三桶合并展示。
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
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class TodoliteWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val views = render(context)
    for (appWidgetId in appWidgetIds) {
      manager.updateAppWidget(appWidgetId, views)
    }
  }

  companion object {
    private const val TAG = "TodoliteWidget"

    /** 每列可稳定展示的任务行数（4x2 布局） */
    private const val MAX_ROWS = 4

    /** 列数上限：任务数 >MAX_ROWS 时自动两列，不再增加 */
    private const val MAX_COLS = 2

    /** 合计最多展示条数（两列 × 每列 4 行） */
    private const val MAX_VISIBLE = MAX_ROWS * MAX_COLS

    /** 单条标题超过该字数即截断并追加"……" */
    private const val MAX_CHARS = 6

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
        R.id.todolite_widget_task4,
        R.id.todolite_widget_task5,
        R.id.todolite_widget_task6,
        R.id.todolite_widget_task7,
      )
      taskIds.forEach { views.setViewVisibility(it, View.GONE) }
      views.setViewVisibility(R.id.todolite_widget_col1, View.GONE)
      views.setViewVisibility(R.id.todolite_widget_more, View.GONE)
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
      val nearest = snapshot.optJSONArray("nearest")
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

      // 任务行：来自快照 nearest（离今天最近，前端已按到期日升序排好）。
      // 圆点颜色按任务自身状态：逾期红 → 今天灰 → 高优橙 → 普通灰；
      // 未来到期追加「·明天 / ·M/D」日期角标。>8 条只展示前 8 条，底部"……"提示溢出。
      // 旧版快照（无 nearest 字段）回退为 逾期→今日→高优 三桶合并。
      val rows = ArrayList<CharSequence>()
      val seen = HashSet<String>()
      val dotOverdue = ContextCompat.getColor(context, R.color.todolite_widget_danger)
      val dotToday = ContextCompat.getColor(context, R.color.todolite_widget_dot_today)
      val dotHigh = ContextCompat.getColor(context, R.color.todolite_widget_warn)
      if (nearest != null) {
        collectNearestRows(
          rows, seen, nearest,
          dotNormal = dotToday, dotToday = dotToday,
          dotHigh = dotHigh, dotOverdue = dotOverdue,
          today = todayString(), tomorrow = tomorrowString(),
        )
      } else {
        collectBucket(rows, seen, overdue, dotOverdue)
        collectBucket(rows, seen, today, dotToday)
        collectBucket(rows, seen, highPriority, dotHigh)
      }

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
        val visible = rows.take(MAX_VISIBLE)
        visible.forEachIndexed { index, row ->
          views.setTextViewText(taskIds[index], row)
          views.setViewVisibility(taskIds[index], View.VISIBLE)
        }
        // 第二列：仅在条数超过单列容量时出现（否则左列占满整行）
        views.setViewVisibility(
          R.id.todolite_widget_col1,
          if (visible.size > MAX_ROWS) View.VISIBLE else View.GONE,
        )
        // 溢出提示
        if (rows.size > MAX_VISIBLE) {
          views.setViewVisibility(R.id.todolite_widget_more, View.VISIBLE)
        }
      }

      bindOpenAppClick(context, views)
      return views
    }

    /**
     * 追加 nearest 分组的任务行（不设上限，由调用方截取），按 id 去重。
     * 每行 = 彩色 □ 方框（按任务状态着色）+ 标题（超 6 字截断）+ 可选日期角标。
     * dueDate 用 ISO "yyyy-MM-dd" 字典序与 [today] 直接比较。
     */
    private fun collectNearestRows(
      rows: MutableList<CharSequence>,
      seen: MutableSet<String>,
      tasks: JSONArray?,
      dotNormal: Int,
      dotToday: Int,
      dotHigh: Int,
      dotOverdue: Int,
      today: String,
      tomorrow: String,
    ) {
      if (tasks == null) return
      for (i in 0 until tasks.length()) {
        val task = tasks.optJSONObject(i) ?: continue
        val id = task.optString("id")
        if (id.isNotEmpty() && !seen.add(id)) continue
        val title = task.optString("title")
        if (title.isEmpty()) continue
        val due = task.optString("dueDate")
        val dot = when {
          due.isNotEmpty() && due < today -> dotOverdue
          due == today -> dotToday
          task.optInt("priority", 0) >= 3 -> dotHigh
          else -> dotNormal
        }
        val row = SpannableStringBuilder()
        row.append("□ ")
        row.append(truncate(title, MAX_CHARS))
        val suffix = dateSuffix(due, today, tomorrow)
        if (suffix != null) {
          row.append(suffix)
          row.setSpan(
            ForegroundColorSpan(dotNormal),
            row.length - suffix.length,
            row.length,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
          )
        }
        row.setSpan(ForegroundColorSpan(dot), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        rows.add(row)
      }
    }

    /** 旧版快照兜底：追加一个分组的任务行（纯色方框 + 标题），按 id 去重 */
    private fun collectBucket(
      rows: MutableList<CharSequence>,
      seen: MutableSet<String>,
      tasks: JSONArray?,
      dotColor: Int,
    ) {
      if (tasks == null) return
      for (i in 0 until tasks.length()) {
        val task = tasks.optJSONObject(i) ?: continue
        val id = task.optString("id")
        if (id.isNotEmpty() && !seen.add(id)) continue
        val title = task.optString("title")
        if (title.isEmpty()) continue
        val row = SpannableString("□ ${truncate(title, MAX_CHARS)}")
        row.setSpan(
          ForegroundColorSpan(dotColor),
          0,
          1,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        rows.add(row)
      }
    }

    /** 未来到期的日期角标：明天用「·明天」，更远用「·M/D」；逾期/今天/无日期不加 */
    private fun dateSuffix(due: String, today: String, tomorrow: String): String? = when {
      due.isEmpty() || due <= today -> null
      due == tomorrow -> " ·明天"
      else -> " ·${shortDate(due)}"
    }

    /** "yyyy-MM-dd" → "M/D"（去前导零；格式异常时原样返回） */
    private fun shortDate(due: String): String {
      val parts = due.split("-")
      val month = parts.getOrNull(1)?.trimStart('0').orEmpty()
      val day = parts.getOrNull(2)?.trimStart('0').orEmpty()
      return if (month.isEmpty() || day.isEmpty()) due else "$month/$day"
    }

    // --------------------------------------------------------------- 日期

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    /** 本地今天，"yyyy-MM-dd"（组件渲染时实时计算，跨天自动纠正颜色/角标） */
    private fun todayString(): String = dateFormat.format(Date())

    private fun tomorrowString(): String {
      val cal = Calendar.getInstance()
      cal.add(Calendar.DATE, 1)
      return dateFormat.format(cal.time)
    }

    /** 按字数（码点）截断：超过 [max] 个字时保留前 [max] 字并追加省略号 */
    private fun truncate(text: String, max: Int): String {
      if (text.codePointCount(0, text.length) <= max) return text
      return text.substring(0, text.offsetByCodePoints(0, max)) + "……"
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
