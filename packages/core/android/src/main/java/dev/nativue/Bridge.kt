package dev.nativue

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.content.res.ColorStateList
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsAnimation
import android.view.WindowInsetsController
import android.graphics.Insets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import com.facebook.yoga.YogaDisplay
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaPositionType
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Runs the JS bundle on its own thread and applies the operations sent by the Vue renderer
 * (src/renderer.ts) to Android views + Yoga in batches on the main thread. Mirrors ios/Bridge.swift.
 */
class Bridge(private val activity: Activity, private val rootView: RootView) {
    private val mainHandler = Handler(Looper.getMainLooper())

    /** The dev server address that answered last (set by listenForReload, read when symbolicating). */
    @Volatile
    private var devServerURL = ""
    /** Ends listenForReload's loop: its thread would otherwise keep a destroyed activity alive. */
    @Volatile
    private var isDestroyed = false
    @Volatile
    private var reloadConnection: HttpURLConnection? = null

    private val javaScriptHandler = startJavaScriptThread()
    private val isDebuggable = activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    private val density = activity.resources.displayMetrics.density
    private val storage = activity.getSharedPreferences("dev.nativue.storage", Context.MODE_PRIVATE)
    private val pluginRegistry = PluginRegistry(activity)

    // Only touched on the JS thread.
    private var runtime: JavaScriptRuntime? = null
    private var pendingOperations = mutableListOf<() -> Unit>()
    /** Set by LayoutAnimation.configureNext in JS; animates the batch it's sent with. */
    private var nextLayoutAnimation: Map<*, *>? = null

    // Only touched on the main thread.
    private val nodesById = HashMap<Int, NativeNode>()
    private val animatedGraph = AnimatedGraph()
    private val modalHostsByNodeId = HashMap<Int, ModalHost>()
    private val gestureReportersByNodeId = HashMap<Int, GestureReporter>()
    /** Views with @layout, and the box they last reported. */
    private val reportedLayoutsByNodeId = mutableMapOf<Int, Map<String, Float>?>()

    /** The latest window insets, mid-animation while the keyboard moves. */
    private var windowInsets: WindowInsets? = null

    /** Whether the system back gesture has something to close or pop (NativueActivity listens). */
    var onCanGoBackChange: (canGoBack: Boolean) -> Unit = {}
    private var canGoBack = false
    /** The bundle running now, for the error screen's Reload. */
    private var bundle = ByteArray(0)
    private val errorOverlay = ErrorOverlay(activity)

    fun start() {
        NativeNode.setPixelDensity(density)
        rootView.onLayoutPass = ::layout
        NativeNode.onLayoutCalculated = ::reportLayoutChanges
        rootView.setOnApplyWindowInsetsListener { view, insets ->
            windowInsets = insets
            view.requestLayout() // safe area and keyboard paddings
            insets
        }
        // Keyboard avoiding views follow the keyboard frame by frame, like on iOS.
        rootView.setWindowInsetsAnimationCallback(object : WindowInsetsAnimation.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            override fun onProgress(insets: WindowInsets, animations: List<WindowInsetsAnimation>): WindowInsets {
                windowInsets = insets
                layout()
                return insets
            }
        })

        val bundle = runCatching { activity.assets.open("main.bundle.js").use { it.readBytes() } }.getOrNull()
        if (bundle != null) run(bundle)
        else check(isDebuggable) { "assets/main.bundle.js is missing: run `npm run build`, then build again" }

        if (isDebuggable) thread(isDaemon = true) { listenForReload() }
    }

    /** On the main thread, when the activity is destroyed. */
    fun destroy() {
        isDestroyed = true
        reloadConnection?.disconnect()
        animatedGraph.reset() // a looping animation would keep running on the dead views
        javaScriptHandler.post {
            runtime?.destroy()
            runtime = null
            Looper.myLooper()?.quit()
        }
    }

    /** (callId, ...arguments): settles the call with __asyncFunctionFinished; a throw rejects it. */
    private fun asyncCall(function: AsyncFunction): NativeFunction = { arguments ->
        val callId = int(arguments[0])
        val owner = runtime
        val promise = Promise { value, errorMessage ->
            callIfStillRunning(owner, "__asyncFunctionFinished", callId, value, errorMessage)
        }

        runCatching { function(arguments.drop(1), promise) }.onFailure { promise.reject(it.message ?: it.toString()) }
        null
    }

    fun onConfigurationChanged() {
        updateFontScale()
        updateColorScheme()
        updateWindowSize()
    }

    /** Rotation and split view resize the window. */
    private fun updateWindowSize() {
        val nextWindowSize = windowSize()
        if (nextWindowSize == windowSize) return

        windowSize = nextWindowSize
        evaluate { runtime?.call("__windowSizeChanged", nextWindowSize) }
    }

    private var fontScale = activity.resources.configuration.fontScale

    /** The system's text size changed: text is sized again, and laid out again. */
    private fun updateFontScale() {
        val nextFontScale = activity.resources.configuration.fontScale
        if (nextFontScale == fontScale) return

        val nodeViews = nodesById.values.mapTo(HashSet()) { it.view }
        rescaleText(activity.window.decorView, nodeViews, nextFontScale / fontScale)
        fontScale = nextFontScale
        nodesById.values.forEach { it.updateFontSize() }
        rootView.requestLayout()
    }

    /**
     * Headers set their text in sp once: scale it by as much as the system's text size changed. Text in dp
     * (tab labels) keeps its size.
     */
    private fun rescaleText(view: View, nodeViews: Set<View>, ratio: Float) {
        if (view is TextView && view !in nodeViews && view.textSizeUnit != TypedValue.COMPLEX_UNIT_DIP) {
            view.setTextSize(TypedValue.COMPLEX_UNIT_PX, view.textSize * ratio)
        }
        if (view !is ViewGroup) return

        for (index in 0 until view.childCount) rescaleText(view.getChildAt(index), nodeViews, ratio)
    }

    /** The system may have switched between light and dark: nativue's views repaint, then JS is told. */
    private fun updateColorScheme() {
        if (!ThemeColors.update(activity)) return

        applyThemeColors(activity.window.decorView)
        // Content not in the window now, like a hidden <Modal>'s, is repainted too.
        nodesById.values.forEach { applyThemeColors(it.view) }
        // The theme set them when the window was created; it isn't recreated (configChanges has uiMode).
        val lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        activity.window.insetsController?.setSystemBarsAppearance(if (ThemeColors.isDark) 0 else lightBars, lightBars)
        evaluate { runtime?.call("__colorSchemeChanged", colorScheme()) }
    }

    private fun colorScheme(): String {
        val nightMode = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK

        return if (nightMode == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
    }

    /** A URL the app was opened with (deep link), for the router (`__openURL`); after the bundle has run. */
    fun openURL(url: String) {
        evaluate { runtime?.call("__openURL", url) }
    }

    /**
     * Discards the current node tree and runtime, then runs the bundle from scratch: JavaScript, or
     * Hermes bytecode (production builds).
     */
    fun run(bundle: ByteArray) {
        this.bundle = bundle
        errorOverlay.hide()

        evaluate {
            enqueue(::resetNodeTree)

            runtime?.destroy()
            runtime = JavaScriptRuntime(nativeFunctions(), ::reportError)
            runtime?.evaluate(bundle, "main.bundle.js")
        }
    }

    /**
     * Runs [work] on the JS thread, then applies every native operation it produced, in one batch, on
     * the main thread. bridge.cpp drains promise jobs after each call, so Vue's updates are included.
     */
    private fun evaluate(work: () -> Unit) {
        javaScriptHandler.post {
            work()

            val operations = pendingOperations
            val layoutAnimationConfig = nextLayoutAnimation
            pendingOperations = mutableListOf()
            nextLayoutAnimation = null

            mainHandler.post { apply(operations, layoutAnimationConfig?.let(::LayoutAnimation)) }
        }
    }

    /** An animated batch lays out right away, so the new frames animate from the old ones. */
    private fun apply(operations: List<() -> Unit>, layoutAnimation: LayoutAnimation?) {
        if (layoutAnimation == null || !rootView.isLaidOut) {
            operations.forEach { it() }
            rootView.requestLayout()
            return
        }

        layoutAnimation.captureStart(nodesById.values)
        operations.forEach { it() }
        layout()
        layoutAnimation.animateChanges(nodesById.values)
    }

    private fun startJavaScriptThread(): Handler {
        var looper: Looper? = null
        val ready = Object()

        // Hermes recurses on this thread's stack: deep component trees need more than the default.
        Thread(null, {
            Looper.prepare()
            synchronized(ready) {
                looper = Looper.myLooper()
                ready.notify()
            }
            Looper.loop()
        }, "nativue.javascript", JAVASCRIPT_STACK_SIZE).start()

        synchronized(ready) {
            while (looper == null) ready.wait()
        }

        return Handler(looper!!)
    }

    private fun layout() {
        val root = nodesById[0] ?: return
        val width = rootView.width / density
        val height = rootView.height / density

        root.calculateLayout(width, height)
        // Insets depend on where views landed: one more pass when they change a padding.
        if (applyInsets()) root.calculateLayout(width, height)

        val windowInsetTop = currentWindowInsets()?.getInsets(SYSTEM_BARS)?.top ?: 0
        for (modalHost in modalHostsByNodeId.values) {
            modalHost.dismissIfDetached()
            modalHost.layout(windowInsetTop)
        }

        updateCanGoBack()
    }

    /** System back: closes the top <Modal>, else pops the innermost visible stack. */
    fun goBack(): Boolean {
        modalHostsByNodeId.values.filter { it.isShowing }.maxByOrNull { it.presentationOrder }?.let {
            it.requestClose()
            return true
        }

        val stack = innermostStackThatCanGoBack() ?: return false
        stack.goBack()

        return true
    }

    private fun updateCanGoBack() {
        val canGoBack = modalHostsByNodeId.values.any { it.isShowing } || innermostStackThatCanGoBack() != null
        if (canGoBack == this.canGoBack) return

        this.canGoBack = canGoBack
        onCanGoBackChange(canGoBack)
    }

    /** The deepest showing stack wins: a tab's stack over the root one, a modal's group over both. */
    private fun innermostStackThatCanGoBack(): ScreenStackView? = nodesById.values
        .mapNotNull { it.view as? ScreenStackView }
        .filter { it.isShown && it.canGoBack }
        .maxByOrNull { stack -> generateSequence(stack as View) { it.parent as? View }.count() }

    // ---------- JS thread ----------

    private fun enqueue(operation: () -> Unit) {
        pendingOperations.add(operation)
    }

    private fun nativeFunctions(): Map<String, NativeFunction> = buildMap {
        put("log") { arguments -> Log.i(TAG, "[JS] ${arguments[0]}") }
        put("reportError") { arguments -> reportError(arguments[0] as String, arguments[1] as String) }
        put("windowSize") { _ -> windowSize }
        put("platform") { _ -> "android" }
        put("colorScheme") { _ -> colorScheme() }
        put("accessibilityInfo") { _ -> accessibilityStatus(activity) }
        put("announce") { arguments ->
            val message = arguments[0] as String
            @Suppress("DEPRECATION") // its replacements (live regions, pane titles) need a view to describe
            mainHandler.post { rootView.announceForAccessibility(message) }
        }
        // Prefixed, so a plugin can't replace nativue's own functions.
        pluginRegistry.functions.forEach { (name, function) -> put("plugin:$name", function) }
        pluginRegistry.asyncFunctions.forEach { (name, function) -> put("pluginAsync:$name", asyncCall(function)) }
        put("create") { arguments ->
            val id = int(arguments[0])
            val type = arguments[1] as String
            enqueue { nodesById[id] = makeNode(type, id) }
        }
        put("insert") { arguments ->
            val (parentId, childId, index) = arguments.map(::int)
            enqueue { insertNode(childId, parentId, index) }
        }
        put("remove") { arguments ->
            val id = int(arguments[0])
            val subtreeIds = (arguments[1] as List<*>).map(::int)
            enqueue { removeNode(id, subtreeIds) }
        }
        put("setText") { arguments ->
            val id = int(arguments[0])
            val text = arguments[1] as String
            enqueue { setText(text, id) }
        }
        put("setProp") { arguments ->
            val id = int(arguments[0])
            val key = arguments[1] as String
            enqueue { setProp(key, arguments[2], id) }
        }
        put("setTimer") { arguments -> setTimer(int(arguments[0]), int(arguments[1])) }
        put("dismissKeyboard") { _ -> enqueue(::dismissKeyboard) }
        putAll(storageFunctions())
        putAll(animatedFunctions())
        putAll(layoutAnimationFunctions())
        putAll(fetchFunctions())
    }

    /** Read from JS, off the main thread: the window's size doesn't need the views. */
    @Volatile private var windowSize = windowSize()

    private fun windowSize(): Map<String, Float> {
        val bounds = activity.windowManager.currentWindowMetrics.bounds

        return mapOf("width" to bounds.width() / density, "height" to bounds.height() / density)
    }

    /** A timer of a runtime that has since been reloaded doesn't fire. */
    private fun setTimer(timerId: Int, delay: Int) {
        val owner = runtime

        javaScriptHandler.postDelayed({ callIfStillRunning(owner, "__fireTimer", timerId) }, delay.toLong())
    }

    /** For results that arrive later: a reloaded runtime starts its timer, request and call ids over. */
    private fun callIfStillRunning(owner: JavaScriptRuntime?, function: String, vararg arguments: Any?) {
        evaluate { if (runtime === owner) runtime?.call(function, *arguments) }
    }

    private fun storageFunctions(): Map<String, NativeFunction> = mapOf(
        "storageGet" to { arguments -> storage.getString(arguments[0] as String, null) },
        "storageSet" to { arguments -> storage.edit().putString(arguments[0] as String, arguments[1] as String).apply() },
        "storageRemove" to { arguments -> storage.edit().remove(arguments[0] as String).apply() },
        "storageKeys" to { _ -> storage.all.keys.toList() },
        "storageClear" to { _ -> storage.edit().clear().apply() },
    )

    private fun animatedFunctions(): Map<String, NativeFunction> = mapOf(
        "createAnimatedNode" to { arguments ->
            val id = int(arguments[0])
            enqueue { animatedGraph.createNode(id, arguments[1] as Map<*, *>) }
        },
        "setAnimatedValue" to { arguments ->
            val id = int(arguments[0])
            val value = (arguments[1] as Number).toDouble()
            enqueue { animatedGraph.setValue(value, id) }
        },
        "startAnimation" to { arguments ->
            val (animationId, nodeId) = arguments.take(2).map(::int)
            enqueue { animatedGraph.startAnimation(animationId, nodeId, arguments[2] as Map<*, *>) }
        },
        "stopAnimation" to { arguments ->
            val nodeId = int(arguments[0])
            enqueue { animatedGraph.stopAnimation(nodeId) }
        },
        "setAnimatedStyle" to { arguments ->
            val viewId = int(arguments[0])
            enqueue {
                nodesById[viewId]?.let { node -> animatedGraph.bind(node.view, viewId, arguments[1] as? Map<*, *>) }
            }
        },
        "setAnimatedEvent" to { arguments ->
            val viewId = int(arguments[0])
            val eventName = arguments[1] as String
            enqueue { setAnimatedEvent(eventName, arguments[2] as? Map<*, *>, viewId) }
        },
    )

    private fun layoutAnimationFunctions(): Map<String, NativeFunction> = mapOf(
        "configureNextLayoutAnimation" to { arguments -> nextLayoutAnimation = arguments[0] as? Map<*, *> },
    )

    /**
     * fetch: HttpURLConnection runs the request; JS hears back through
     * __fetchFinished(requestId, response, error).
     */
    // Limitation: Text bodies only (no binary, FormData or streaming) and no abort, like on iOS.
    private fun fetchFunctions(): Map<String, NativeFunction> = mapOf(
        "fetch" to { arguments ->
            val requestId = arguments[0]
            val url = arguments[1] as String
            val method = arguments[2] as String
            val headers = arguments[3] as? Map<*, *> ?: emptyMap<String, String>()
            val body = arguments[4] as? String
            val owner = runtime

            thread {
                val (response, error) = runCatching { request(url, method, headers, body) }
                    .fold({ Pair(it, null) }, { Pair(null, it.message ?: it.toString()) })
                callIfStillRunning(owner, "__fetchFinished", requestId, response, error)
            }
        },
    )

    private fun request(url: String, method: String, headers: Map<*, *>, body: String?): Map<String, Any> {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = method
        headers.forEach { (name, value) -> connection.setRequestProperty(name.toString(), value.toString()) }

        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray()) }
        }

        val status = connection.responseCode
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        val responseHeaders = connection.headerFields.filterKeys { it != null }.mapValues { it.value.joinToString(", ") }

        return mapOf(
            "status" to status,
            "headers" to responseHeaders,
            "body" to (stream?.bufferedReader()?.use { it.readText() } ?: ""),
        )
    }

    // ---------- Errors ----------

    /** Errors outside Vue (timers, the bundle itself) come from bridge.cpp; Vue's through `__native`. */
    private fun reportError(message: String, details: String) {
        Log.e(TAG, "$message\n$details")
        if (!isDebuggable) return

        thread {
            val symbolicatedDetails = symbolicated(details)
            mainHandler.post { errorOverlay.show(message, symbolicatedDetails) { run(bundle) } }
        }
    }

    /** The dev server maps the stack to the app's files; without it, the bundle's lines stay. */
    private fun symbolicated(text: String): String = runCatching {
        val connection = URL("$devServerURL/symbolicate").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.connectTimeout = SYMBOLICATE_TIMEOUT_MS
        connection.readTimeout = SYMBOLICATE_TIMEOUT_MS
        connection.outputStream.use { it.write(text.toByteArray()) }

        connection.inputStream.reader().use { it.readText() }
    }.getOrDefault(text)

    // ---------- Development ----------

    /**
     * The emulator reaches the computer at 10.0.2.2. A device tries the computer's address on the local
     * network (written by the debug build), then localhost, through `adb reverse tcp:40836 tcp:40836`.
     */
    private fun devServerURLs(): List<String> {
        if (Build.HARDWARE == "ranchu" || Build.FINGERPRINT.contains("generic")) return listOf("http://10.0.2.2:$DEV_SERVER_PORT")

        @SuppressLint("DiscouragedApi") // the resource only exists in debug builds
        val hostId = activity.resources.getIdentifier("nativue_dev_server_host", "string", activity.packageName)
        val hosts = listOfNotNull(if (hostId == 0) null else activity.getString(hostId), "localhost")

        return hosts.map { "http://$it:$DEV_SERVER_PORT" }
    }

    /** The dev server sends `data: reload` on connect and after each rebuild. */
    private fun listenForReload() {
        val candidateURLs = devServerURLs()
        var attempt = 0

        while (!isDestroyed) {
            devServerURL = candidateURLs[attempt++ % candidateURLs.size]
            runCatching {
                val connection = URL("$devServerURL/events").openConnection() as HttpURLConnection
                connection.readTimeout = 0
                reloadConnection = connection

                connection.inputStream.bufferedReader().useLines { lines ->
                    lines.filter { it == "data: reload" }.forEach { _ ->
                        val bundle = URL("$devServerURL/bundle.js").readBytes()
                        Log.i(TAG, "reload")
                        mainHandler.post { run(bundle) }
                    }
                }
            }

            Thread.sleep(RECONNECT_DELAY_MS) // dev server is down: retry
        }
    }

    // ---------- Main thread ----------

    /** Vue removes only a subtree's root: the nodes under it are forgotten with it. */
    private fun removeNode(id: Int, subtreeIds: List<Int>) {
        nodesById[id]?.removeFromParent()
        subtreeIds.forEach(::forgetNode)
    }

    /** Its view left the tree: what refers to it by id goes too, and a modal inside closes. */
    private fun forgetNode(id: Int) {
        nodesById.remove(id)
        gestureReportersByNodeId.remove(id)
        reportedLayoutsByNodeId.remove(id)
        modalHostsByNodeId.remove(id)?.let {
            it.onEvent = {} // its "dismiss" would reach a node JS has forgotten
            it.setVisible(false)
        }
    }

    private fun resetNodeTree() {
        modalHostsByNodeId.values.forEach {
            it.onEvent = {} // its "dismiss" would reach the new tree's node with the same id
            it.setVisible(false)
        }
        modalHostsByNodeId.clear()
        gestureReportersByNodeId.clear() // node ids start over
        reportedLayoutsByNodeId.clear()
        animatedGraph.reset()
        animatedGraph.onAnimationEnd = { animationId, finished ->
            evaluate { runtime?.call("__animationFinished", animationId, finished) }
        }
        rootView.removeAllViews()
        nodesById.clear()
        nodesById[0] = NativeNode(rootView, measuresContent = false)
    }

    private fun insertNode(childId: Int, parentId: Int, index: Int) {
        val parent = nodesById[parentId] ?: return
        val child = nodesById[childId] ?: return

        if (!parent.canHaveChildren) {
            Log.w(TAG, "<${parent.view.javaClass.simpleName}> can't have native children; use <View>")
            return
        }

        (parent.contentNode ?: parent).insertChild(child, index)
    }

    private fun makeNode(type: String, id: Int): NativeNode = when (type) {
        "Text" -> NativeNode(makeTextView(), measuresContent = true)

        // A text button: tinted title, a ripple on press, faded when disabled.
        "Button" -> {
            val button = makeTextView()
            button.styleColor = BUTTON_TINT
            button.gravity = Gravity.CENTER
            button.foreground = ripple(button.dp(8f).toFloat())
            button.setOnClickListener { dispatchEvent("press", id) }
            NativeNode(button, measuresContent = true)
        }

        "ScrollView" -> {
            val scrollView = ScrollContainerView(activity)
            NativeNode(scrollView, measuresContent = false).also { it.childContainer = scrollView.content }
        }

        "ScreenStack" -> NativeNode(ScreenStackView(activity), measuresContent = false)

        "TabBar" -> {
            val tabBar = TabBarView(activity)
            tabBar.onTabChange = { index -> dispatchEvent("tabchange", id, mapOf("index" to index)) }
            NativeNode(tabBar, measuresContent = false)
        }

        // Fills its stack or tab bar; the header pads its content.
        "Screen" -> {
            val screen = ScreenView(activity)
            screen.onEvent = { eventName, payload -> dispatchEvent(eventName, id, payload) }
            NativeNode(screen, measuresContent = false).also { node ->
                node.childContainer = screen.content
                fillParent(node)
            }
        }

        "Modal" -> {
            val modalHost = ModalHost(activity)
            modalHost.onEvent = { eventName -> dispatchEvent(eventName, id) }
            modalHost.onNeedsLayout = rootView::requestLayout
            modalHostsByNodeId[id] = modalHost

            NativeNode(modalHost.placeholder, measuresContent = false).also { node ->
                node.yogaNode.setDisplay(YogaDisplay.NONE)
                node.contentNode = modalHost.contentNode
            }
        }

        "Image" -> {
            val imageView = RemoteImageView(activity)
            NativeNode(imageView, measuresContent = true).also { node ->
                imageView.onImageChange = {
                    node.markContentChanged()
                    rootView.requestLayout()
                }
            }
        }

        "SwipeableView" -> NativeNode(SwipeableView(activity), measuresContent = false)

        "PressableView" -> {
            val pressableView = PressableView(activity)
            pressableView.onEvent = { eventName -> dispatchEvent(eventName, id) }
            NativeNode(pressableView, measuresContent = false)
        }

        "SafeAreaView" -> NativeNode(SafeAreaView(activity), measuresContent = false).also {
            it.insetTypes = SYSTEM_BARS
        }

        "KeyboardAvoidingView" -> NativeNode(KeyboardAvoidingView(activity), measuresContent = false).also {
            it.insetTypes = IME
        }

        "TextInput" -> NativeNode(makeTextInput(id), measuresContent = true)

        "Switch" -> {
            val toggle = ToggleSwitch(activity)
            toggle.setOnCheckedChangeListener { _, isChecked ->
                // Every change but JS's own: touch, keyboard and accessibility toggles alike.
                if (!toggle.isSettingFromJavaScript) dispatchEvent("valuechange", id, isChecked)
            }
            NativeNode(toggle, measuresContent = true)
        }

        "ActivityIndicator" -> NativeNode(ProgressBar(activity), measuresContent = false).also { node ->
            setIndicatorSize(node, "medium")
        }

        "Svg" -> NativeNode(SvgView(activity), measuresContent = false)

        else -> {
            val makeView = pluginRegistry.viewMakers[type]
            val view = makeView?.invoke { eventName, payload -> dispatchEvent(eventName, id, payload) }

            NativeNode(view ?: ContainerView(activity), measuresContent = false)
        }
    }

    private fun makeTextView() = TextLabel(activity).apply {
        applyThemeColors()
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
        includeFontPadding = false
    }

    private fun makeTextInput(id: Int): TextInputView {
        val textInput = TextInputView(activity)
        textInput.background = null
        textInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
        textInput.applyThemeColors()
        textInput.isSingleLine = true
        textInput.gravity = Gravity.CENTER_VERTICAL
        textInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) {}

            override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) {}

            override fun afterTextChanged(text: Editable?) {
                if (textInput.isSettingTextFromJavaScript) return // autofill and accessibility do count

                textInput.recordTextSentToJavaScript()
                dispatchEvent("changetext", id, text.toString())
            }
        })
        // The return key closes the keyboard and ends editing, as single-line inputs do on iOS too.
        textInput.setOnEditorActionListener { _, _, _ ->
            dispatchEvent("submitediting", id, textInput.text.toString())
            hideKeyboard(textInput)
            true
        }
        textInput.setOnFocusChangeListener { _, hasFocus -> dispatchEvent(if (hasFocus) "focus" else "blur", id, null) }

        return textInput
    }

    private fun fillParent(node: NativeNode) {
        node.yogaNode.setPositionType(YogaPositionType.ABSOLUTE)
        listOf(YogaEdge.LEFT, YogaEdge.TOP, YogaEdge.RIGHT, YogaEdge.BOTTOM).forEach { node.yogaNode.setPosition(it, 0f) }
    }

    private fun setIndicatorSize(node: NativeNode, size: String) {
        val side = if (size == "large") 36f else 20f
        node.yogaNode.setWidth(side)
        node.yogaNode.setHeight(side)
    }

    /** @layout fires for the views whose box changed: { x, y, width, height }, in dp, in its parent. */
    private fun reportLayoutChanges() {
        for ((id, reportedLayout) in reportedLayoutsByNodeId) {
            val yogaNode = nodesById[id]?.yogaNode ?: continue
            val layout = mapOf(
                "x" to yogaNode.layoutX,
                "y" to yogaNode.layoutY,
                "width" to yogaNode.layoutWidth,
                "height" to yogaNode.layoutHeight,
            )
            if (yogaNode.layoutWidth.isNaN() || layout == reportedLayout) continue

            reportedLayoutsByNodeId[id] = layout
            dispatchEvent("layout", id, layout)
        }
    }

    private fun dispatchEvent(eventName: String, id: Int, payload: Any? = null) {
        evaluate { runtime?.call("__dispatch", id, eventName, payload) }
    }

    private fun dismissKeyboard() {
        val inputMethodManager = activity.getSystemService(InputMethodManager::class.java)
        inputMethodManager.hideSoftInputFromWindow(rootView.windowToken, 0)
        activity.currentFocus?.clearFocus()
    }

    private fun setText(text: String, id: Int) {
        val node = nodesById[id] ?: return

        (node.view as? TextView)?.text = text
        node.markContentChanged()
    }

    private fun setProp(key: String, value: Any?, id: Int) {
        val node = nodesById[id] ?: return
        val view = node.view

        if (key != "style" && view is PluginView) return view.setProp(key, value)

        when (key) {
            "style" -> {
                @Suppress("UNCHECKED_CAST")
                node.applyStyle(value as? Map<String, Any?> ?: emptyMap())
            }

            "title" -> {
                (view as? TextView)?.text = value as? String
                (view as? ScreenView)?.header?.setTitle(value as? String)
                node.markContentChanged()
            }

            "headerShown" -> (view as? ScreenView)?.headerShown = isTruthyAttribute(value)

            "headerLargeTitle" -> (view as? ScreenView)?.header?.isLarge = isTruthyAttribute(value)

            "headerTintColor" -> (view as? ScreenView)?.header?.tintColor = androidColor(value)

            "headerRightItems" -> (view as? ScreenView)?.header?.setItems(value, side = "right")

            "headerLeftItems" -> (view as? ScreenView)?.header?.setItems(value, side = "left")

            "stackPresentation" -> (view as? ScreenView)?.stackPresentation = value as? String ?: "push"

            "tabBarItem" -> (view as? ScreenView)?.tabBarItem = value as? Map<*, *> ?: emptyMap<String, Any>()

            "selectedIndex" -> (view as? TabBarView)?.selectedIndex = int(value)

            "activeTintColor" -> (view as? TabBarView)?.activeTintColor = androidColor(value)

            "inactiveTintColor" -> (view as? TabBarView)?.inactiveTintColor = androidColor(value)

            "barBackgroundColor" -> (view as? TabBarView)?.barBackgroundColor = androidColor(value)

            "visible" -> modalHostsByNodeId[id]?.setVisible(isTruthyAttribute(value))

            "animationType" -> modalHostsByNodeId[id]?.animationType = value as? String ?: "none"

            "presentationStyle" -> modalHostsByNodeId[id]?.presentationStyle = value as? String ?: "fullScreen"

            "transparent" -> modalHostsByNodeId[id]?.transparent = isTruthyAttribute(value)

            // A scroll view pads its scrollable area by the system bars it's under, unless "never".
            "contentInsetAdjustmentBehavior" -> if (view is ScrollContainerView) {
                val systemBars = if (value == null || value == "never") 0 else SYSTEM_BARS
                node.insetTypes = (node.insetTypes and IME) or systemBars
            }

            // The keyboard pads it too, and the focused input scrolls above it.
            "automaticallyAdjustKeyboardInsets" -> if (view is ScrollContainerView) {
                val keyboard = if (isTruthyAttribute(value)) IME else 0
                node.insetTypes = (node.insetTypes and IME.inv()) or keyboard
            }

            "horizontal" -> setScrollDirection(node, isTruthyAttribute(value))

            "pagingEnabled" -> (view as? ScrollContainerView)?.pagingEnabled = isTruthyAttribute(value)

            "showsHorizontalScrollIndicator" -> (view as? ScrollContainerView)?.showsHorizontalScrollIndicator = isTruthyAttribute(value)

            "showsVerticalScrollIndicator" -> (view as? ScrollContainerView)?.showsVerticalScrollIndicator = isTruthyAttribute(value)

            // A new handler on every render re-registers: only a first one waits for a report.
            "onLayout" -> if (!isTruthyAttribute(value)) reportedLayoutsByNodeId.remove(id)
                else if (id !in reportedLayoutsByNodeId) reportedLayoutsByNodeId[id] = null

            "onScroll" -> (view as? ScrollContainerView)?.onScroll = if (isTruthyAttribute(value)) reportScroll(node, id) else null

            "value" -> {
                (view as? TextInputView)?.setTextFromJavaScript(value as? String ?: "")
                (view as? ToggleSwitch)?.setCheckedFromJavaScript(isTruthyAttribute(value))
            }

            "accessibility" -> view.applyAccessibility(value as? Map<*, *> ?: emptyMap<Any, Any>())

            "disabled" -> {
                view.isEnabled = !isTruthyAttribute(value)
                if (view is TextView && view !is EditText) view.alpha = if (view.isEnabled) 1f else 0.38f
            }

            "onRefresh" -> (view as? ScrollContainerView)?.onRefresh = if (isTruthyAttribute(value)) {
                { dispatchEvent("refresh", id) }
            } else {
                null
            }

            "refreshing" -> (view as? ScrollContainerView)?.setRefreshing(isTruthyAttribute(value))

            "keyboardDismissMode" -> (view as? ScrollContainerView)?.keyboardDismissMode = value as? String ?: "none"

            "keyboardShouldPersistTaps" -> (view as? ScrollContainerView)?.dismissesKeyboardOnTap = (value as? String ?: "never") == "never"

            "onPan", "onPinch", "onRotate" -> gestureReporter(id, view)?.setReporting(key.drop(2).lowercase(), isTruthyAttribute(value))

            "animating" -> view.visibility = if (isTruthyAttribute(value)) View.VISIBLE else View.INVISIBLE

            "size" -> if (view is ProgressBar) setIndicatorSize(node, value as? String ?: "medium")

            "color" -> {
                (view as? ProgressBar)?.indeterminateTintList = androidColor(value)?.let(ColorStateList::valueOf)
                (view as? SvgView)?.color = androidColor(value) ?: SVG_DEFAULT_COLOR
            }

            "viewBox" -> SvgView.rect(value)?.let { (view as? SvgView)?.viewBox = it }

            "elements" -> (view as? SvgView)?.elements = value as? List<*> ?: emptyList<Any>()

            "strokeWidth" -> (view as? SvgView)?.strokeWidth = number(value) ?: 2f

            "placeholder" -> (view as? EditText)?.hint = value as? String

            "secureTextEntry", "keyboardType" -> (view as? EditText)?.let { setInputType(it, key, value) }

            "source" -> (view as? RemoteImageView)?.load(value as? String)

            "resizeMode" -> (view as? RemoteImageView)?.scaleType = RemoteImageView.scaleTypes[value] ?: ImageView.ScaleType.CENTER_CROP

            "onLongPress" -> (view as? PressableView)?.reportsLongPress = isTruthyAttribute(value)

            else -> {} // event props (onPress...): the handler lives in JS
        }
    }

    private fun setInputType(textInput: EditText, key: String, value: Any?) {
        val baseType = if (key == "keyboardType") keyboardInputTypes[value] ?: InputType.TYPE_CLASS_TEXT
        else textInput.inputType and InputType.TYPE_MASK_CLASS
        val isSecure = if (key == "secureTextEntry") isTruthyAttribute(value) else textInput.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD != 0

        textInput.inputType = if (isSecure) baseType or InputType.TYPE_TEXT_VARIATION_PASSWORD else baseType
    }

    private fun setScrollDirection(node: NativeNode, horizontal: Boolean) {
        val scrollView = node.view as? ScrollContainerView ?: return

        node.yogaNode.setFlexDirection(if (horizontal) YogaFlexDirection.ROW else YogaFlexDirection.COLUMN)
        scrollView.setHorizontal(horizontal)
    }

    /**
     * `Animated.event` on a scroll view (its offset) or a gesture (its fields): they drive the values,
     * with no JS per frame.
     */
    private fun setAnimatedEvent(eventName: String, mapping: Map<*, *>?, viewId: Int) {
        val view = nodesById[viewId]?.view ?: return
        val scrollView = view as? ScrollContainerView
        if (scrollView == null || eventName != "scroll") {
            val fieldsToNodeIds = mapping?.entries?.associate { (field, nodeId) -> field.toString() to int(nodeId) }
            gestureReporter(viewId, view)?.setAnimatedMapping(eventName, fieldsToNodeIds)
            return
        }

        if (mapping == null) {
            scrollView.onOffsetChange = null
            return
        }

        val xNodeId = (mapping["x"] as? Number)?.toInt()
        val yNodeId = (mapping["y"] as? Number)?.toInt()
        scrollView.onOffsetChange = { x, y ->
            xNodeId?.let { animatedGraph.setValue(x / density.toDouble(), it) }
            yNodeId?.let { animatedGraph.setValue(y / density.toDouble(), it) }
        }
    }

    /** Gestures are on <View>s, which are containers. */
    private fun gestureReporter(id: Int, view: View): GestureReporter? {
        if (view !is ContainerView) return null

        return gestureReportersByNodeId.getOrPut(id) { makeGestureReporter(id, view) }
    }

    private fun makeGestureReporter(id: Int, view: ContainerView) =
        GestureReporter(
            view,
            report = { eventName, payload -> dispatchEvent(eventName, id, payload) },
            setAnimatedValue = { nodeId, value -> animatedGraph.setValue(value, nodeId) },
        )

    private fun reportScroll(node: NativeNode, id: Int): (Int, Int) -> Unit = { x, y ->
        val payload = mapOf(
            "x" to x / density,
            "y" to y / density,
            "width" to node.view.width / density,
            "height" to node.view.height / density,
        )
        dispatchEvent("scroll", id, payload)
    }

    /**
     * Fits views to the system bars and the keyboard: safe area views and scroll views are padded by what
     * they're under, a screen's header extends under the status bar, a tab bar under the navigation bar
     * (and its screens stop above it), a sheet starts below the status bar. Returns whether the layout
     * needs another pass.
     */
    private fun applyInsets(): Boolean {
        val windowInsets = currentWindowInsets() ?: return false
        var didChange = false

        for (node in nodesById.values.filter { it.view.isAttachedToWindow }) {
            didChange = when (val view = node.view) {
                is ScreenView -> fitScreen(node, view, windowInsets)
                is TabBarView -> fitTabBar(node, view, windowInsets)
                is ScrollContainerView -> {
                    if (node.insetTypes != 0) fitScrollContent(view, windowInsets.getInsets(node.insetTypes))
                    false
                }
                else -> node.insetTypes != 0 && padByInsets(node, windowInsets.getInsets(node.insetTypes))
            } || didChange
        }

        return didChange
    }

    private fun currentWindowInsets(): WindowInsets? = windowInsets ?: rootView.rootWindowInsets

    private fun fitScreen(node: NativeNode, screen: ScreenView, windowInsets: WindowInsets): Boolean {
        var didChange = false

        if (screen.isSheet) {
            val sheetTop = windowInsets.getInsets(SYSTEM_BARS).top / density + SHEET_TOP_GAP
            didChange = node.yogaNode.getPosition(YogaEdge.TOP).value != sheetTop
            node.yogaNode.setPosition(YogaEdge.TOP, sheetTop)
        }

        screen.topInset = (overlap(screen, windowInsets.getInsets(SYSTEM_BARS))[1] * density).toInt()

        val contentTop = screen.contentTop
        if (node.yogaNode.getPadding(YogaEdge.TOP).value != contentTop) {
            node.yogaNode.setPadding(YogaEdge.TOP, contentTop)
            didChange = true
        }

        return didChange
    }

    private fun fitTabBar(node: NativeNode, tabBar: TabBarView, windowInsets: WindowInsets): Boolean {
        tabBar.bottomInset = (overlap(tabBar, windowInsets.getInsets(SYSTEM_BARS))[3] * density).toInt()

        var didChange = false
        for (index in 0 until node.yogaNode.childCount) {
            val screen = node.yogaNode.getChildAt(index)
            if (screen.getPosition(YogaEdge.BOTTOM).value == tabBar.barHeight) continue

            screen.setPosition(YogaEdge.BOTTOM, tabBar.barHeight)
            didChange = true
        }

        return didChange
    }

    private fun fitScrollContent(scrollView: ScrollContainerView, insets: Insets) {
        val (left, top, right, bottom) = overlap(scrollView, insets).map { (it * density).toInt() }
        scrollView.setContentInsets(left, top, right, bottom)
    }

    private fun padByInsets(node: NativeNode, insets: Insets): Boolean {
        val padding = overlap(node.view, insets)
        if (padding == node.insetPadding) return false

        node.insetPadding = padding
        EDGES.forEachIndexed { index, edge -> node.yogaNode.setPadding(edge, padding[index]) }

        return true
    }

    /**
     * How far each inset reaches into the view, in dp: left, top, right, bottom. From the view's place in
     * the window without transforms, so a sliding screen keeps its insets.
     */
    private fun overlap(view: View, insets: Insets): List<Float> {
        val window = view.rootView
        val (x, y) = view.offsetIn(window)
        val distanceToRight = window.width - x - view.width
        val distanceToBottom = window.height - y - view.height

        return listOf(
            insets.left - x,
            insets.top - y,
            insets.right - distanceToRight,
            insets.bottom - distanceToBottom,
        ).map { it.coerceAtLeast(0) / density }
    }

    private companion object {
        const val TAG = "Nativue"
        const val JAVASCRIPT_STACK_SIZE = 8L * 1024 * 1024
        const val SYMBOLICATE_TIMEOUT_MS = 2000
        const val RECONNECT_DELAY_MS = 2000L
        const val SVG_DEFAULT_COLOR = 0xFF000000.toInt()
        const val BUTTON_TINT = 0xFF007AFF.toInt()
        val EDGES = listOf(YogaEdge.LEFT, YogaEdge.TOP, YogaEdge.RIGHT, YogaEdge.BOTTOM)
        val SYSTEM_BARS = WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
        val IME = WindowInsets.Type.ime()
        const val SHEET_TOP_GAP = 12f

        val keyboardInputTypes = mapOf(
            "numeric" to InputType.TYPE_CLASS_NUMBER,
            "number-pad" to InputType.TYPE_CLASS_NUMBER,
            "decimal-pad" to (InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL),
            "phone-pad" to InputType.TYPE_CLASS_PHONE,
            "email-address" to (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS),
            "url" to (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI),
        )

        const val DEV_SERVER_PORT = 40836 // 0x9F84, from #0E9F84, the nativue green

        fun int(value: Any?): Int = (value as Number).toInt()

        /** `<ScrollView horizontal>` arrives as an empty string, `:horizontal="true"` as a boolean. */
        fun isTruthyAttribute(value: Any?): Boolean = when (value) {
            is Boolean -> value
            is String -> value != "false"
            else -> false
        }
    }
}
