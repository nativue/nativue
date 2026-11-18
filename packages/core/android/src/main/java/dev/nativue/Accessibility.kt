package dev.nativue

import android.content.Context
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo

private val CLASS_NAME_BY_ROLE = mapOf(
    "button" to "android.widget.Button",
    "img" to "android.widget.ImageView",
    "text" to "android.widget.TextView",
    "switch" to "android.widget.Switch",
    "checkbox" to "android.widget.CheckBox",
)

/** role, alt and aria-*, from the renderer: all of them, whenever one changes. */
fun View.applyAccessibility(attributes: Map<*, *>) {
    val role = attributes["role"] as? String
    val label = attributes["label"] as? String
    val isHidden = attributes["hidden"] != null
    val isElement = !isHidden && role != "none" && (role != null || label != null)

    contentDescription = label
    importantForAccessibility = when {
        isHidden -> View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        role == "none" -> View.IMPORTANT_FOR_ACCESSIBILITY_NO
        isElement -> View.IMPORTANT_FOR_ACCESSIBILITY_YES
        else -> View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    }
    // TalkBack reads a focusable container as one element: the text inside it, as a <button> does on the web.
    isScreenReaderFocusable = isElement && this is ViewGroup
    isAccessibilityHeading = role == "heading"
    accessibilityDelegate = AccessibilityAttributes(role, attributes)
}

private class AccessibilityAttributes(
    private val role: String?,
    private val attributes: Map<*, *>,
) : View.AccessibilityDelegate() {
    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(host, info)

        CLASS_NAME_BY_ROLE[role]?.let { info.className = it }
        // Where TalkBack reads a role description (androidx sets the same key).
        // Limitation: Android has no link role for views; this description is English whatever the language.
        if (role == "link") info.extras.putCharSequence("AccessibilityNodeInfo.roleDescription", "link")
        (attributes["hint"] as? String)?.let { info.hintText = it }
        if (attributes["disabled"] != null) info.isEnabled = false
        if (attributes["selected"] != null) info.isSelected = true
        if (role == "switch" || role == "checkbox") {
            info.isCheckable = true
            @Suppress("DEPRECATION") // its replacement, setChecked(Int), is API 36+
            info.isChecked = attributes["checked"] != null
        }
    }
}

/** For AccessibilityInfo; both are safe to read off the main thread. */
fun accessibilityStatus(context: Context): Map<String, Boolean> {
    val accessibilityManager = context.getSystemService(AccessibilityManager::class.java)
    val animationScale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)

    return mapOf(
        "screenReaderEnabled" to accessibilityManager.isTouchExplorationEnabled,
        "reduceMotionEnabled" to (animationScale == 0f),
    )
}
