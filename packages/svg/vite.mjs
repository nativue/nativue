// SVGs as design tools export them, handled when the app is built: a <style> inside an <svg> styles the
// elements its rules select (Vue leaves <style> out of templates), and a .svg file imports as a component.
import { readFileSync } from 'node:fs'
import { parse } from 'vue/compiler-sfc'

// The suffix that hands an imported .svg to Vue's plugin, as a component.
const COMPONENT_SUFFIX = '.vue'
const ELEMENT = 1
const ATTRIBUTE = 6
const TEXT = 2

export default function svgVitePlugin() {
  return {
    name: 'nativue-svg',
    enforce: 'pre',

    async resolveId(source, importer) {
      if (!source.endsWith('.svg') || !importer) return null

      const resolved = await this.resolve(source, importer, { skipSelf: true })

      return resolved && `${resolved.id}${COMPONENT_SUFFIX}`
    },

    load(id) {
      if (!id.endsWith(`.svg${COMPONENT_SUFFIX}`)) return null

      const file = id.slice(0, -COMPONENT_SUFFIX.length)

      this.addWatchFile(file)

      return `<template>${svgMarkup(readFileSync(file, 'utf8'))}</template>\n`
    },

    transform(code, id) {
      if (!id.endsWith('.vue') || !code.includes('<style', code.indexOf('<svg'))) return null

      return inlineSvgStyles(code)
    },
  }
}

/** The file's <svg>, without what comes before it (<?xml?>, a doctype, comments). */
function svgMarkup(text) {
  const start = text.search(/<svg[\s>]/)

  return start < 0 ? text : text.slice(start)
}

/**
 * Each <style> inside an <svg> becomes its rules' declarations on the elements they select, as a
 * `svg-css` attribute the runtime reads between the element's attributes and its style="", as CSS
 * ranks them. Selectors: tags, .classes and #ids, combined and nested ("g .cls-1"). Only static
 * class and id attributes match, as design tools write them.
 */
export function inlineSvgStyles(code) {
  const template = parse(code).descriptor.template
  if (!template?.ast) return null

  const edits = []

  for (const svg of elementsIn(template.ast, (node) => node.tag === 'svg' || node.tag === 'Svg')) {
    const styles = elementsIn(svg, (node) => node.tag === 'style')
    if (styles.length === 0) continue

    const rules = styles.flatMap((style) => cssRules(textOf(style)))

    for (const style of styles)
      edits.push({ start: style.loc.start.offset, end: style.loc.end.offset, text: '' })
    visit(svg, [], (node, ancestors) => {
      const declarations = matchingDeclarations(rules, node, ancestors)
      if (!declarations) return

      const position = node.loc.start.offset + 1 + node.tag.length

      edits.push({
        start: position,
        end: position,
        text: ` svg-css="${declarations.replaceAll('"', '&quot;')}"`,
      })
    })
  }

  if (edits.length === 0) return null

  return edits
    .sort((first, second) => second.start - first.start)
    .reduce(
      (result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      code,
    )
}

function elementsIn(node, predicate) {
  return (node.children ?? []).flatMap((child) => {
    if (child.type !== ELEMENT) return []

    return predicate(child) ? [child] : elementsIn(child, predicate)
  })
}

function visit(node, ancestors, callback) {
  if (node.tag === 'style') return

  callback(node, ancestors)
  for (const child of node.children ?? []) {
    if (child.type === ELEMENT) visit(child, [...ancestors, node], callback)
  }
}

function textOf(node) {
  return (node.children ?? []).map((child) => (child.type === TEXT ? child.content : '')).join('')
}

/** [{ selectors: [[compound, ...], ...], declarations, order }], comments and CDATA left out. */
function cssRules(css) {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '')

  return [...cleaned.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
    ([, selectorList, declarations], order) => ({
      selectors: selectorList
        .split(',')
        .map((selector) => selector.replace(/>/g, ' ').trim().split(/\s+/).map(compound))
        .filter((compounds) => compounds.every(Boolean)),
      declarations: declarations.replace(/!important/g, '').trim(),
      order,
    }),
  )
}

/** "rect.cls-1#hero" as { tag, classes, id }; null for what isn't matched (pseudo-classes...). */
function compound(text) {
  const match = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)$/.exec(text)
  if (!match) return null

  const parts = match[2].match(/[.#][\w-]+/g) ?? []

  return {
    tag: match[1] === '*' ? undefined : match[1],
    classes: parts.filter((part) => part[0] === '.').map((part) => part.slice(1)),
    id: parts.find((part) => part[0] === '#')?.slice(1),
  }
}

/** The declarations of the rules that select the element, the most specific and the last ones winning. */
function matchingDeclarations(rules, node, ancestors) {
  const matches = rules.flatMap((rule) =>
    rule.selectors
      .filter((compounds) => selects(compounds, node, ancestors))
      .map((compounds) => ({ ...rule, specificity: specificity(compounds) })),
  )

  return matches
    .sort((first, second) => first.specificity - second.specificity || first.order - second.order)
    .map((match) => match.declarations)
    .filter(Boolean)
    .join('; ')
}

function selects(compounds, node, ancestors) {
  if (!matchesCompound(compounds.at(-1), node)) return false

  let remaining = compounds.length - 2

  for (let index = ancestors.length - 1; index >= 0 && remaining >= 0; index--) {
    if (matchesCompound(compounds[remaining], ancestors[index])) remaining--
  }

  return remaining < 0
}

function matchesCompound({ tag, classes, id }, node) {
  const attribute = (name) =>
    node.props.find((prop) => prop.type === ATTRIBUTE && prop.name === name)?.value?.content
  const nodeClasses = (attribute('class') ?? '').split(/\s+/)

  return (
    (!tag || tag.toLowerCase() === node.tag.toLowerCase()) &&
    classes.every((name) => nodeClasses.includes(name)) &&
    (!id || attribute('id') === id)
  )
}

function specificity(compounds) {
  return compounds.reduce(
    (total, { tag, classes, id }) =>
      total + (id ? 10000 : 0) + classes.length * 100 + (tag ? 1 : 0),
    0,
  )
}
