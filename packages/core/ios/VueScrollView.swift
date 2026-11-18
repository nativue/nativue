import UIKit

/// Scroll view behind <ScrollView>.
final class VueScrollView: UIScrollView {
    static let contentInsetAdjustmentBehaviors: [String: UIScrollView.ContentInsetAdjustmentBehavior] = [
        "automatic": .automatic,
        "scrollableAxes": .scrollableAxes,
        "never": .never,
        "always": .always,
    ]

    static let keyboardDismissModes: [String: UIScrollView.KeyboardDismissMode] = [
        "none": .none,
        "on-drag": .onDrag,
        "interactive": .interactive,
    ]

    /// keyboardShouldPersistTaps="never" (the default): a tap outside a text input closes the keyboard.
    /// "always" / "handled" turn it off.
    var dismissesKeyboardOnTap = true

    /// automatically-adjust-keyboard-insets: the keyboard insets the content, and the focused input scrolls
    /// above it.
    var adjustsForKeyboard = false

    /// Set when JS listens to @scroll. Called on every scroll step and size change (FlatList windowing).
    // ponytail: one JS call per frame while scrolling; coalesce / add scrollEventThrottle if JS falls behind.
    var onScroll: ((CGRect) -> Void)? {
        didSet { lastReportedBounds = nil }
    }

    private var lastReportedBounds: CGRect?

    /// Set when JS listens to @refresh: shows a pull-to-refresh spinner. JS owns `refreshing`.
    var onRefresh: (() -> Void)? {
        didSet { refreshControl = onRefresh == nil ? nil : makeRefreshControl() }
    }

    func setRefreshing(_ refreshing: Bool) {
        guard let refreshControl, refreshing != refreshControl.isRefreshing else { return }

        if refreshing { refreshControl.beginRefreshing() } else { refreshControl.endRefreshing() }
    }

    private func makeRefreshControl() -> UIRefreshControl {
        UIRefreshControl(frame: .zero, primaryAction: UIAction { [unowned self] _ in onRefresh?() })
    }

    override init(frame: CGRect) {
        super.init(frame: frame)

        contentInsetAdjustmentBehavior = .never // <SafeAreaView> handles it, or the prop
        alwaysBounceVertical = true
        // UIKit holds a touch for 150ms to see if it scrolls: a quick tap on a device would send pressin and
        // pressout together, and the pressed style never shows. touchesShouldCancel still lets drags scroll.
        delaysContentTouches = false

        let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tapRecognizer.cancelsTouchesInView = false // buttons inside still receive their taps
        addGestureRecognizer(tapRecognizer)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// Set by Animated.event on @scroll: the offset goes straight into animated values, without JS.
    var onOffsetChange: ((CGPoint) -> Void)?

    // UIKit lays out a scroll view on every scroll step, so this sees both scrolling and resizing.
    override func layoutSubviews() {
        super.layoutSubviews()

        onOffsetChange?(contentOffset)

        guard let onScroll, bounds != lastReportedBounds else { return }

        lastReportedBounds = bounds
        onScroll(bounds)
    }

    /// UIScrollView refuses to cancel touches on UIControls, so a drag starting on a Pressable or Button
    /// wouldn't scroll.
    override func touchesShouldCancel(in view: UIView) -> Bool {
        true
    }

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard
            adjustsForKeyboard,
            window != nil,
            let keyboardFrame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
        else { return }

        // In content coordinates, like bounds. The safe area the system already insets isn't counted twice.
        let keyboardTop = convert(keyboardFrame, from: nil).minY
        let systemBottomInset = adjustedContentInset.bottom - contentInset.bottom
        let keyboardInset = max(0, bounds.maxY - keyboardTop - systemBottomInset)

        UIView.animateAlongsideKeyboard(notification) { [self] in
            contentInset.bottom = keyboardInset
            verticalScrollIndicatorInsets.bottom = keyboardInset
            contentOffset.y = offsetRevealing(focusedInput(in: self), above: keyboardTop)
        }
    }

    /// Scrolls up just enough for `input` to sit above the keyboard; when the keyboard leaves, back within the content.
    private func offsetRevealing(_ input: UIView?, above keyboardTop: CGFloat) -> CGFloat {
        let maximumOffset = max(-adjustedContentInset.top, contentSize.height + adjustedContentInset.bottom - bounds.height)
        guard let input else { return min(contentOffset.y, maximumOffset) }

        let inputBottom = input.convert(input.bounds, to: self).maxY

        return min(contentOffset.y + max(0, inputBottom - keyboardTop), maximumOffset)
    }

    private func focusedInput(in view: UIView) -> UIView? {
        if view.isFirstResponder { return view }

        return view.subviews.lazy.compactMap(focusedInput(in:)).first
    }

    @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
        guard dismissesKeyboardOnTap else { return }

        let tappedView = hitTest(recognizer.location(in: self), with: nil)
        let tappedTextInput = sequence(first: tappedView, next: { $0?.superview }).contains { $0 is UITextField }
        guard !tappedTextInput else { return }

        window?.endEditing(true)
    }
}
