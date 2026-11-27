// var() in CSS values, read the same way when the app is built (convert.mjs) and when it runs (runtime.ts,
// for the variables one class sets for another).

/** The index of the parenthesis closing the one at `start`; -1 without one. */
export function closingParenthesis(text, start) {
  let depth = 0

  for (let index = start; index < text.length; index++) {
    if (text[index] === '(') depth++
    if (text[index] === ')' && --depth === 0) return index
  }

  return -1
}

/** The first var(--name, fallback) from `from`: where it starts and ends, its name and its fallback. */
export function nextVariable(value, from = 0) {
  const start = value.indexOf('var(', from)
  if (start === -1) return null

  const end = closingParenthesis(value, start + 3)
  const inside = value.slice(start + 4, end)
  const comma = inside.indexOf(',')

  return {
    start,
    end,
    name: (comma === -1 ? inside : inside.slice(0, comma)).trim(),
    fallback: comma === -1 ? null : inside.slice(comma + 1).trim(),
  }
}

/** Each var() replaced by the variable's value, else its fallback; null when one has neither. */
export function resolveVariables(value, lookup) {
  const variable = nextVariable(value)
  if (!variable) return value

  const replacement =
    lookup(variable.name) ??
    (variable.fallback === null ? null : resolveVariables(variable.fallback, lookup))
  if (replacement === null) return null

  return resolveVariables(
    value.slice(0, variable.start) + replacement + value.slice(variable.end + 1),
    lookup,
  )
}
