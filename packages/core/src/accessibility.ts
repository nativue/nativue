// Screen readers (VoiceOver, TalkBack): what a view says it is, and what the system has turned on.

const native = globalThis.__native

// role, alt and aria-*, named as on the web. Native gets them together, by what they mean.
const NATIVE_NAME_BY_ATTRIBUTE: Record<string, string> = {
  role: 'role',
  alt: 'label',
  'aria-label': 'label',
  'aria-description': 'hint',
  'aria-hidden': 'hidden',
  'aria-disabled': 'disabled',
  'aria-selected': 'selected',
  'aria-checked': 'checked',
}
const STRING_ATTRIBUTES = new Set(['role', 'label', 'hint'])
const warnedAttributes = new Set<string>()

export type AccessibilityAttributes = Record<string, string | boolean>

export function isAccessibilityAttribute(key: string): boolean {
  return key in NATIVE_NAME_BY_ATTRIBUTE || key.startsWith('aria-')
}

/** The attributes with this one changed, or undefined when it isn't one native reads. */
export function withAccessibilityAttribute(
  attributes: AccessibilityAttributes = {},
  key: string,
  value: unknown,
): AccessibilityAttributes | undefined {
  const nativeName = NATIVE_NAME_BY_ATTRIBUTE[key]
  if (!nativeName) return warnUnsupported(key)

  const nextAttributes = { ...attributes }
  if (value == null || value === false || value === 'false') delete nextAttributes[nativeName]
  else nextAttributes[nativeName] = STRING_ATTRIBUTES.has(nativeName) ? String(value) : true

  return nextAttributes
}

function warnUnsupported(key: string): undefined {
  if (warnedAttributes.has(key)) return

  warnedAttributes.add(key)
  console.warn(`${key} isn't supported; see the accessibility docs for the attributes that are`)
}

//   AccessibilityInfo.isScreenReaderEnabled()   VoiceOver or TalkBack is on
//   AccessibilityInfo.isReduceMotionEnabled()   the user asked for less motion
//   AccessibilityInfo.announce('Saved')          spoken by the screen reader
export const AccessibilityInfo = {
  isScreenReaderEnabled(): boolean {
    return native.accessibilityInfo().screenReaderEnabled
  },

  isReduceMotionEnabled(): boolean {
    return native.accessibilityInfo().reduceMotionEnabled
  },

  announce(message: string): void {
    native.announce(message)
  },
}
