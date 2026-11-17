import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const nativeComponentTags = ['View', 'Text', 'Button']

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: { isCustomElement: (tag) => nativeComponentTags.includes(tag) },
      },
    }),
  ],
  // compiled templates import from 'vue' -> point them to our renderer
  resolve: {
    alias: [
      { find: /^vue$/, replacement: fileURLToPath(new URL('./src/renderer.js', import.meta.url)) },
    ],
  },
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    lib: {
      entry: 'src/main.js',
      formats: ['iife'],
      name: 'VueNativeApp',
      fileName: () => 'main.bundle.js',
    },
    outDir: 'ios/VueNative',
    emptyOutDir: false,
    minify: false,
  },
})
