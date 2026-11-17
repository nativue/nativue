// Roda o bundle com um __native falso e confere a árvore resultante.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'

const views = { 0: { type: 'root', children: [] } }
globalThis.__native = {
  create: (id, type) => (views[id] = { type, children: [], props: {} }),
  insert: (p, c, i) => {
    for (const v of Object.values(views)) v.children = v.children.filter((x) => x !== c)
    views[p].children.splice(i, 0, c)
  },
  remove: (id) => { for (const v of Object.values(views)) v.children = v.children.filter((x) => x !== id) },
  setProp: (id, k, v) => (views[id].props[k] = v),
  setText: (id, t) => (views[id].text = t),
}
;(0, eval)(readFileSync('ios/VueNative/main.bundle.js', 'utf8'))

const texts = () => Object.values(views).filter((v) => v.type === 'Text').map((v) => v.text)
const rootView = views[views[0].children[0]]
assert.equal(rootView.children.length, 3)
assert.ok(texts().includes('Contador: 0'))

const plus = Object.keys(views).find((id) => views[id].props?.title === '+1')
for (let i = 0; i < 3; i++) globalThis.__dispatch(+plus, 'press')
await Promise.resolve()
assert.ok(texts().includes('Contador: 3'))
assert.equal(rootView.children.length, 4) // v-if apareceu
console.log('ok')
