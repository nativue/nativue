// .svg imports, as components: /// <reference types="@nativue/svg/client" /> in src/env.d.ts.
declare module '*.svg' {
  import type { DefineComponent } from '@nativue/core'

  const component: DefineComponent
  export default component
}
