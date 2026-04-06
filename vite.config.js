import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

const childProcessShimPath = fileURLToPath(
  new URL('./src/shims/child-process-browser.js', import.meta.url)
)
const earcutEsmPath = fileURLToPath(
  new URL('./node_modules/earcut/src/earcut.js', import.meta.url)
)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_API_BASE || (mode === 'v4'
    ? 'http://127.0.0.1:3210'
    : mode === 'v3'
      ? 'http://127.0.0.1:3300'
      : 'http://127.0.0.1:3200')

  return {
    plugins: [
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
        dts: false
      }),
      Components({
        resolvers: [
          ElementPlusResolver({
            importStyle: 'css',
            directives: true
          })
        ],
        dts: false
      })
    ],
    resolve: {
      alias: {
        'child_process': childProcessShimPath,
        'node:child_process': childProcessShimPath,
        'earcut': earcutEsmPath
      }
    },
    optimizeDeps: {
      exclude: ['three', '@deck.gl/core', '@deck.gl/layers', '@deck.gl/aggregation-layers'],
      include: ['vue', 'vue-router', 'axios', 'd3', 'd3-cloud', 'marked', 'earcut']
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/')
            if (!normalizedId.includes('node_modules')) {
              if (normalizedId.includes('/src/views/NarrativeMode.vue')) return 'route-narrative'
              return
            }

            if (normalizedId.includes('/@vue/') || normalizedId.includes('/vue/')) return 'vendor-vue'
            if (normalizedId.includes('vue-router')) return 'vendor-vue-router'
            if (normalizedId.includes('/ol/')) return 'vendor-ol'
            if (normalizedId.includes('@deck.gl') || normalizedId.includes('@luma.gl')) return 'vendor-deckgl'
            if (normalizedId.includes('element-plus')) return 'vendor-element-plus'
            if (normalizedId.includes('@element-plus/icons-vue')) return 'vendor-element-icons'
            if (normalizedId.includes('/d3') || normalizedId.includes('d3-cloud')) return 'vendor-d3'
            if (normalizedId.includes('geotiff') || normalizedId.includes('@loaders.gl') || normalizedId.includes('pako')) return 'vendor-raster'
            if (normalizedId.includes('@turf')) return 'vendor-turf'
            if (normalizedId.includes('three')) return 'vendor-three'
            if (normalizedId.includes('axios')) return 'vendor-axios'
            if (normalizedId.includes('html2canvas')) return 'vendor-capture'
            if (normalizedId.includes('marked')) return 'vendor-marked'
            if (normalizedId.includes('rbush')) return 'vendor-utils'
            return 'vendor'
          }
        }
      }
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      proxy: {
        '/api/geo': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 120000,
        },
        '/api/ai': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 120000,
        },
        '/api/category': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/api/spatial': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 120000,
        },
        '/api/search': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 30000,
        },
      }
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
  }
})
