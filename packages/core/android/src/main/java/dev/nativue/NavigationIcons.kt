package dev.nativue

import android.widget.ImageView

/**
 * The icons of tab bars and headers: an image (`image`, a url) or one a package draws (`drawnIcon`, registered
 * with PluginRegistry.addIconDrawer). SF Symbol names are iOS-only. Tinted by what shows them.
 */
object NavigationIcons {
    internal val drawersByName = mutableMapOf<String, DrawIcon>()

    /** The item's icon in [view], [size] pixels square; an image from a url once it has loaded. */
    fun show(item: Map<*, *>, view: ImageView, size: Int) {
        val source = item["image"] as? String
        val icon = item["drawnIcon"] as? Map<*, *>
        val draw = (icon?.get("drawer") as? String)?.let(drawersByName::get)

        view.tag = source
        if (source == null) return view.setImageBitmap(if (icon != null && draw != null) draw(icon, size) else null)

        view.setImageDrawable(null)
        RemoteImageView.loadBitmap(view.context, source) { bitmap -> if (view.tag == source) view.setImageBitmap(bitmap) }
    }
}
