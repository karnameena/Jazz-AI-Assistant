package com.gunakarna.jazzassistant.accessibility

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

class ScreenObserver(private val service: AccessibilityService) {
    data class Snapshot(
        val packageName: String?,
        val windowTitle: String?,
        val nodes: List<NodeSnapshot>
    )

    data class NodeSnapshot(
        val text: String?,
        val contentDescription: String?,
        val viewId: String?,
        val className: String?,
        val clickable: Boolean,
        val editable: Boolean,
        val scrollable: Boolean,
        val enabled: Boolean,
        val visible: Boolean,
        val bounds: Rect
    )

    fun snapshot(maxNodes: Int = 350): Snapshot {
        val root = service.rootInActiveWindow
        if (root == null) return Snapshot(null, null, emptyList())
        val nodes = mutableListOf<NodeSnapshot>()
        fun walk(node: AccessibilityNodeInfo) {
            if (nodes.size >= maxNodes) return
            val rect = Rect().also(node::getBoundsInScreen)
            nodes += NodeSnapshot(
                text = node.text?.toString(),
                contentDescription = node.contentDescription?.toString(),
                viewId = node.viewIdResourceName,
                className = node.className?.toString(),
                clickable = node.isClickable,
                editable = node.isEditable,
                scrollable = node.isScrollable,
                enabled = node.isEnabled,
                visible = node.isVisibleToUser,
                bounds = rect
            )
            for (i in 0 until node.childCount) node.getChild(i)?.let(::walk)
        }
        walk(root)
        return Snapshot(
            packageName = root.packageName?.toString(),
            windowTitle = service.windows.firstOrNull { it.isActive }?.title?.toString(),
            nodes = nodes
        )
    }

    fun describe(maxNodes: Int = 120): Map<String, Any?> {
        val snap = snapshot(maxNodes)
        return mapOf(
            "ok" to true,
            "packageName" to snap.packageName,
            "windowTitle" to snap.windowTitle,
            "nodeCount" to snap.nodes.size,
            "nodes" to snap.nodes.map {
                mapOf(
                    "text" to it.text,
                    "contentDescription" to it.contentDescription,
                    "viewId" to it.viewId,
                    "className" to it.className,
                    "clickable" to it.clickable,
                    "editable" to it.editable,
                    "scrollable" to it.scrollable,
                    "enabled" to it.enabled,
                    "visible" to it.visible,
                    "bounds" to "${it.bounds.left},${it.bounds.top},${it.bounds.right},${it.bounds.bottom}"
                )
            }
        )
    }
}
