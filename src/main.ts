import { createApp } from 'vue'

import App from './App.vue'
import router from './router'

declare global {
  interface Window { __GEOLOOM_PERF_T0?: number }
}

// element-plus CSS 统一在入口预加载，避免 MainLayout lazy load 时的 CSS 瀑布流
import 'element-plus/es/components/base/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/cascader/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/drawer/style/css'
import 'element-plus/es/components/icon/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/loading/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/notification/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/switch/style/css'
import 'element-plus/es/components/tooltip/style/css'

const app = createApp(App)

app.use(router)

const STARTUP_RELOAD_KEY = 'geoloom-startup-reload'

function removeInitialLoader() {
  const initialLoader = document.getElementById('initial-loader')
  if (initialLoader) {
    initialLoader.remove()
  }
  // 首屏加载计时终点
  if (window.__GEOLOOM_PERF_T0 != null) {
    const elapsed = (performance.now() - window.__GEOLOOM_PERF_T0).toFixed(0)
    console.log(`[GeoLoom Perf] #initial-loader 移除，首屏耗时 ${elapsed}ms`)
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function reloadOnceForStartupImportError(error: unknown) {
  const message = errorMessage(error)
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) {
    return false
  }
  try {
    if (sessionStorage.getItem(STARTUP_RELOAD_KEY) === '1') return false
    sessionStorage.setItem(STARTUP_RELOAD_KEY, '1')
  } catch {
    window.location.reload()
    return true
  }
  window.location.reload()
  return true
}

function showStartupError(error: unknown) {
  const initialLoader = document.getElementById('initial-loader')
  if (!initialLoader) return
  initialLoader.textContent = ''
  const title = document.createElement('div')
  title.textContent = 'GeoLoom 启动失败'
  title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:8px;'
  const detail = document.createElement('div')
  detail.textContent = errorMessage(error)
  detail.style.cssText = 'max-width:560px;font-size:12px;line-height:1.6;opacity:.72;text-align:center;'
  initialLoader.append(title, detail)
}

router
  .isReady()
  .then(() => {
    try {
      sessionStorage.removeItem(STARTUP_RELOAD_KEY)
    } catch {}
    app.mount('#app')
    requestAnimationFrame(removeInitialLoader)
  })
  .catch((error) => {
    console.error('[GeoLoom] 初始路由加载失败:', error)
    if (reloadOnceForStartupImportError(error)) return
    showStartupError(error)
  })
