package com.gunakarna.jazzassistant.accessibility

import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

object AccessibilityNodeFinder {
    private fun normalize(value: CharSequence?): String = value?.toString()
        ?.lowercase(Locale.ROOT)
        ?.replace(Regex("\\s+"), " ")
        ?.trim()
        .orEmpty()

    fun findNodeByText(root: AccessibilityNodeInfo?, text: String, exact: Boolean = false): AccessibilityNodeInfo? {
        if (root == null || text.isBlank()) return null
        val target = normalize(text)
        return findFirst(root) { node ->
            val value = normalize(node.text)
            if (exact) value == target else value.contains(target)
        }
    }

    fun findNodesByText(root: AccessibilityNodeInfo?, text: String, exact: Boolean = false): List<AccessibilityNodeInfo> {
        if (root == null || text.isBlank()) return emptyList()
        val target = normalize(text)
        return findAll(root) { node ->
            val value = normalize(node.text)
            if (exact) value == target else value.contains(target)
        }
    }

    fun findNodeByContentDescription(root: AccessibilityNodeInfo?, text: String, exact: Boolean = false): AccessibilityNodeInfo? {
        if (root == null || text.isBlank()) return null
        val target = normalize(text)
        return findFirst(root) { node ->
            val value = normalize(node.contentDescription)
            if (exact) value == target else value.contains(target)
        }
    }

    fun findEditableField(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? =
        findFirst(root) { it.isEditable || it.className?.toString() == "android.widget.EditText" }

    fun findEditableFields(root: AccessibilityNodeInfo?): List<AccessibilityNodeInfo> =
        findAll(root) { it.isEditable || it.className?.toString() == "android.widget.EditText" }

    fun findScrollableNode(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? = findFirst(root) { it.isScrollable }

    fun findClickableParent(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        var current = node
        var depth = 0
        while (current != null && depth < 12) {
            if (current.isClickable && current.isEnabled) return current
            current = current.parent
            depth += 1
        }
        return node
    }

    fun findByViewId(root: AccessibilityNodeInfo?, viewId: String): AccessibilityNodeInfo? {
        if (root == null || viewId.isBlank()) return null
        return runCatching { root.findAccessibilityNodeInfosByViewId(viewId).firstOrNull() }.getOrNull()
    }

    fun findFirst(root: AccessibilityNodeInfo?, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        if (root == null) return null
        if (predicate(root)) return root
        for (index in 0 until root.childCount) {
            val child = root.getChild(index) ?: continue
            val found = findFirst(child, predicate)
            if (found != null) return found
        }
        return null
    }

    fun findAll(root: AccessibilityNodeInfo?, predicate: (AccessibilityNodeInfo) -> Boolean): List<AccessibilityNodeInfo> {
        if (root == null) return emptyList()
        val result = mutableListOf<AccessibilityNodeInfo>()
        fun walk(node: AccessibilityNodeInfo) {
            if (predicate(node)) result += node
            for (index in 0 until node.childCount) node.getChild(index)?.let(::walk)
        }
        walk(root)
        return result
    }
}
