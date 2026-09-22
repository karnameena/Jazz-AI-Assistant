package com.gunakarna.jazzassistant.accessibility

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

class UiTreeReader {
    fun read(root: AccessibilityNodeInfo?, maxNodes: Int = 500): List<Map<String, Any?>> {
        if (root == null) return emptyList()
        val result = mutableListOf<Map<String, Any?>>()

        fun walk(node: AccessibilityNodeInfo, depth: Int) {
            if (result.size >= maxNodes) return
            val bounds = Rect().also(node::getBoundsInScreen)
            result += linkedMapOf(
                "index" to result.size,
                "depth" to depth,
                "className" to node.className?.toString(),
                "text" to node.text?.toString(),
                "contentDescription" to node.contentDescription?.toString(),
                "viewIdResourceName" to node.viewIdResourceName,
                "clickable" to node.isClickable,
                "editable" to node.isEditable,
                "scrollable" to node.isScrollable,
                "enabled" to node.isEnabled,
                "packageName" to node.packageName?.toString(),
                "boundsInScreen" to "${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}"
            )
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let { walk(it, depth + 1) }
            }
        }

        walk(root, 0)
        return result
    }

    fun compact(root: AccessibilityNodeInfo?, maxNodes: Int = 200): String {
        val rows = read(root, maxNodes)
        if (rows.isEmpty()) return "No active accessibility tree"
        val pkg = rows.firstOrNull()?.get("packageName")?.toString().orEmpty()
        val lines = mutableListOf("Package: $pkg", "Window: ACTIVE", "")
        rows.forEach { row ->
            val text = row["text"]?.toString().orEmpty()
            val desc = row["contentDescription"]?.toString().orEmpty()
            if (text.isBlank() && desc.isBlank() && row["editable"] != true && row["clickable"] != true) return@forEach
            lines += "[${row["index"]}] ${row["className"] ?: "View"}"
            if (text.isNotBlank()) lines += "text=$text"
            if (desc.isNotBlank()) lines += "contentDescription=$desc"
            if (row["viewIdResourceName"] != null) lines += "viewId=${row["viewIdResourceName"]}"
            lines += "clickable=${row["clickable"]} editable=${row["editable"]} scrollable=${row["scrollable"]} enabled=${row["enabled"]}"
            lines += "bounds=${row["boundsInScreen"]}"
            lines += ""
        }
        return lines.joinToString("\n")
    }
}
