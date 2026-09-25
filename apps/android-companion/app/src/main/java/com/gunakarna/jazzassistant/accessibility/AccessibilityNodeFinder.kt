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

    fun findNodesByContentDescription(root: AccessibilityNodeInfo?, text: String, exact: Boolean = false): List<AccessibilityNodeInfo> {
        if (root == null || text.isBlank()) return emptyList()
        val target = normalize(text)
        return findAll(root) { node ->
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
            if (current.isClickable && current.isEnabled && current.isVisibleToUser) return current
            current = current.parent
            depth += 1
        }
        return node?.takeIf { it.isEnabled && it.isVisibleToUser }
    }

    fun findByViewId(root: AccessibilityNodeInfo?, viewId: String): AccessibilityNodeInfo? {
        if (root == null || viewId.isBlank()) return null
        return runCatching {
            root.findAccessibilityNodeInfosByViewId(viewId)
                .firstOrNull { it.isEnabled && it.isVisibleToUser }
        }.getOrNull()
    }

    /**
     * Screen-aware selector used by generic commands such as "Click Skip".
     * Priority is resource-id hint, exact label, accessible description, partial label.
     * Only visible/enabled candidates are returned. If several top candidates tie,
     * null is returned so Jazz can ask for clarification instead of guessing.
     */
    fun findBestActionNode(
        root: AccessibilityNodeInfo?,
        query: String,
        viewIdHint: String? = null
    ): AccessibilityNodeInfo? {
        if (root == null || query.isBlank()) return null
        val q = normalize(query)
        data class Candidate(val node: AccessibilityNodeInfo, val score: Int)
        val candidates = findAll(root) { it.isEnabled && it.isVisibleToUser }.mapNotNull { node ->
            val text = normalize(node.text)
            val desc = normalize(node.contentDescription)
            val id = normalize(node.viewIdResourceName)
            var score = 0
            if (!viewIdHint.isNullOrBlank() && id == normalize(viewIdHint)) score += 100
            if (text == q) score += 80 else if (text.contains(q) && q.length >= 2) score += 35
            if (desc == q) score += 75 else if (desc.contains(q) && q.length >= 2) score += 30
            if (id.substringAfterLast('/').substringAfterLast(':') == q.replace(" ", "_")) score += 55
            if (node.isClickable) score += 15
            if (node.isFocusable) score += 3
            if (score > 0) Candidate(findClickableParent(node) ?: node, score) else null
        }
        if (candidates.isEmpty()) return null
        val sorted = candidates.sortedByDescending { it.score }
        val top = sorted.first()
        val second = sorted.drop(1).firstOrNull()
        if (second != null && second.score == top.score && second.node !== top.node) return null
        return top.node
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
