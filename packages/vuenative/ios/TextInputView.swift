import UIKit

/// Single-line text field behind <TextInput>.
final class TextInputView: UITextField {
    static let keyboardTypes: [String: UIKeyboardType] = [
        "default": .default,
        "numeric": .numberPad,
        "decimal-pad": .decimalPad,
        "email-address": .emailAddress,
        "phone-pad": .phonePad,
        "url": .URL,
    ]

    /// Yoga's computed padding; the text is drawn inside it.
    var contentPadding: UIEdgeInsets = .zero {
        didSet { setNeedsLayout() }
    }

    // ponytail: a value JS sets on purpose that equals text typed earlier in the same editing session is
    // ignored too; tag each change with a counter if that ever matters.
    private var textsSentToJavaScript: Set<String> = []

    override func textRect(forBounds bounds: CGRect) -> CGRect {
        bounds.inset(by: contentPadding)
    }

    override func editingRect(forBounds bounds: CGRect) -> CGRect {
        bounds.inset(by: contentPadding)
    }

    override func placeholderRect(forBounds bounds: CGRect) -> CGRect {
        bounds.inset(by: contentPadding)
    }

    func recordTextSentToJavaScript() {
        textsSentToJavaScript.insert(text ?? "")
    }

    func endEditingSession() {
        textsSentToJavaScript.removeAll()
    }

    /// JS echoes every keystroke back (v-model / :value). A late echo would overwrite characters typed
    /// meanwhile, so values this field already sent are ignored; only real changes from JS are applied.
    func setTextFromJavaScript(_ newText: String) {
        guard newText != text, !textsSentToJavaScript.contains(newText) else { return }

        text = newText
    }
}
