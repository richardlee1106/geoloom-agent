<template>
  <div ref="containerRef" class="embedded-tagcloud-container">
    <div class="tagcloud-header">
      <span class="tagcloud-title">地名标签云</span>
      <div class="tagcloud-controls">
        <button
          class="control-btn"
          :class="{ active: currentMode === 'coarse' }"
          title="粗粒聚合（最多 50 个）"
          @click="switchMode('coarse')"
        >
          粗粒聚合
        </button>
        <button
          class="control-btn"
          :class="{ active: currentMode === 'fine' }"
          title="精细聚合（最多 20 个）"
          @click="switchMode('fine')"
        >
          精细聚合
        </button>
        <button
          class="control-btn render-btn"
          title="将当前标签对应 POI 渲染到地图"
          @click="renderToMap"
        >
          渲染到地图
        </button>
      </div>
    </div>

    <div
      class="tagcloud-canvas-wrapper"
      @mouseenter="lockContextScroll"
      @mouseleave="unlockContextScroll"
    >
      <canvas
        ref="canvasRef"
        class="tagcloud-canvas"
        @click="handleCanvasClick"
        @mousedown="handleCanvasMouseDown"
        @wheel.passive="handleCanvasWheel"
      ></canvas>

      <div v-if="isCalculating" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>布局计算中...</span>
      </div>
    </div>

    <div class="tagcloud-footer">
      <span class="tag-count">
        {{ placedTags.length }} / {{ currentMode === 'coarse' ? 50 : 20 }} 个标签
      </span>
      <span class="mode-indicator">{{ modeLabel }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildPlaceTags } from '../utils/tagExtraction'

const props = defineProps({
  pois: { type: Array, default: () => [] },
  intentMode: { type: String, default: 'macro' },
  intentMeta: { type: Object, default: null },
  width: { type: Number, default: 360 },
  height: { type: Number, default: 220 }
})

const emit = defineEmits(['render-to-map', 'tag-click'])

const containerRef = ref(null)
const canvasRef = ref(null)
const currentMode = ref('fine')
const isCalculating = ref(false)
const placedTags = ref([])
const canvasWidth = ref(Math.max(240, Number(props.width) || 360))

const transform = ref({ k: 1, x: 0, y: 0 })
const isDragging = ref(false)
const lastMousePos = ref({ x: 0, y: 0 })
const dragStartPos = ref({ x: 0, y: 0 })

let worker = null
let resizeObserver = null
let renderRaf = null
let originalPoiById = new Map()
let scrollLockTarget = null
let previousOverflowY = ''
let previousOverscrollBehavior = ''

const modeLabel = computed(() => {
  const mode = String(props.intentMeta?.intent_mode || props.intentMeta?.intentMode || props.intentMode || '')
    .toLowerCase()
  return mode === 'micro' || mode === 'local_search' ? '微观检索' : '宏观分析'
})

function idKey(value) {
  return String(value ?? '')
}

function scheduleRender() {
  if (renderRaf) return
  renderRaf = requestAnimationFrame(() => {
    renderRaf = null
    renderCanvas()
  })
}

function lockContextScroll() {
  if (scrollLockTarget) return
  const target = containerRef.value?.closest('.chat-messages')
  if (!target) return
  scrollLockTarget = target
  previousOverflowY = target.style.overflowY
  previousOverscrollBehavior = target.style.overscrollBehavior
  target.style.overflowY = 'hidden'
  target.style.overscrollBehavior = 'none'
}

function unlockContextScroll() {
  if (!scrollLockTarget) return
  scrollLockTarget.style.overflowY = previousOverflowY
  scrollLockTarget.style.overscrollBehavior = previousOverscrollBehavior
  scrollLockTarget = null
  previousOverflowY = ''
  previousOverscrollBehavior = ''
}

function getTagColor(index) {
  const hue = 198 + (index % 12) * 7
  const saturation = 68 + (index % 4) * 4
  const lightness = 66 + (index % 3) * 5
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

function sanitizeTagForWorker(tag, index, fallbackWeight) {
  const rawId = tag?.id
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : `${index}`
  const name = String(tag?.name || '未知')
  const type = String(tag?.type || '')
  const numericWeight = Number(tag?.weight)
  const weight = Number.isFinite(numericWeight) ? numericWeight : fallbackWeight

  return { id, name, type, weight }
}

function makeFallbackLayout(tags, width, height) {
  const safeWidth = Math.max(200, width || 360)
  const safeHeight = Math.max(120, height || 220)
  const radiusStep = 16
  const angleStep = Math.PI / 6

  return tags.map((tag, index) => {
    const fontSize = Math.max(12, 19 - Math.floor(index / 3))
    const ring = Math.floor(index / 10)
    const radius = 24 + ring * radiusStep + (index % 10) * 2
    const angle = index * angleStep
    const x = safeWidth / 2 + Math.cos(angle) * radius
    const y = safeHeight / 2 + Math.sin(angle) * radius
    const widthEstimate = Math.max(24, tag.name.length * fontSize * 0.62)
    const heightEstimate = Math.max(16, fontSize * 1.2)

    return {
      ...tag,
      text: tag.name,
      fontSize,
      width: widthEstimate,
      height: heightEstimate,
      x,
      y,
      placed: true,
      rotation: 0
    }
  })
}

function applyLayout(layoutTags) {
  placedTags.value = (Array.isArray(layoutTags) ? layoutTags : []).map((tag, index) => ({
    ...tag,
    id: tag?.id ?? index,
    text: String(tag?.text || tag?.name || '未知'),
    originalPoi: originalPoiById.get(idKey(tag?.id ?? index)) || null
  }))
  isCalculating.value = false
  fitToView()
}

function calculateLayout() {
  const pois = Array.isArray(props.pois) ? props.pois : []
  if (!pois.length) {
    placedTags.value = []
    scheduleRender()
    return
  }

  const topK = currentMode.value === 'coarse' ? 50 : 20
  const intentMeta = props.intentMeta || {
    intentMode: props.intentMode === 'micro' ? 'local_search' : 'macro_overview'
  }

  const builtTags = buildPlaceTags(pois, { topK, intentMeta })
  const tags = builtTags.map((tag, index) => ({
    ...sanitizeTagForWorker(tag, index, topK - index),
    originalPoi: tag?.originalPoi || null
  }))

  originalPoiById = new Map(tags.map((tag) => [idKey(tag.id), tag.originalPoi]))
  const workerTags = tags.map(({ originalPoi, ...safe }) => safe)

  if (!worker || !workerTags.length) {
    applyLayout(makeFallbackLayout(workerTags, canvasWidth.value, props.height))
    return
  }

  isCalculating.value = true

  try {
    worker.postMessage({
      tags: workerTags,
      width: canvasWidth.value || 380,
      height: props.height,
      config: {
        fontMin: 12,
        fontMax: 18,
        padding: 3,
        spiralStep: 4
      }
    })
  } catch (error) {
    console.warn('[EmbeddedTagCloud] worker postMessage failed, fallback to local layout:', error)
    applyLayout(makeFallbackLayout(workerTags, canvasWidth.value, props.height))
  }
}

function renderCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const w = Math.max(200, canvasWidth.value)
  const h = props.height

  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(20, 25, 35, 0.64)'
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(transform.value.x, transform.value.y)
  ctx.scale(transform.value.k, transform.value.k)

  for (let index = 0; index < placedTags.value.length; index += 1) {
    const tag = placedTags.value[index]
    if (!tag?.placed) continue

    ctx.save()
    ctx.translate(tag.x || 0, tag.y || 0)

    ctx.fillStyle = getTagColor(index)
    ctx.font = `${tag.fontSize || 13}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.82)'
    ctx.shadowBlur = 4
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    ctx.fillText(String(tag.text || tag.name || ''), 0, 0)

    ctx.restore()
  }

  ctx.restore()
}

function fitToView() {
  if (!placedTags.value.length) {
    transform.value = { k: 1, x: 0, y: 0 }
    scheduleRender()
    return
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let hasPlaced = false

  for (const tag of placedTags.value) {
    if (!tag?.placed) continue
    hasPlaced = true
    const halfW = (Number(tag.width) || 20) / 2
    const halfH = (Number(tag.height) || 14) / 2
    minX = Math.min(minX, (Number(tag.x) || 0) - halfW)
    maxX = Math.max(maxX, (Number(tag.x) || 0) + halfW)
    minY = Math.min(minY, (Number(tag.y) || 0) - halfH)
    maxY = Math.max(maxY, (Number(tag.y) || 0) + halfH)
  }

  if (!hasPlaced) {
    transform.value = { k: 1, x: 0, y: 0 }
    scheduleRender()
    return
  }

  const padding = 20
  const w = Math.max(200, canvasWidth.value)
  const h = props.height
  const contentWidth = Math.max(1, maxX - minX + padding * 2)
  const contentHeight = Math.max(1, maxY - minY + padding * 2)

  const scaleX = w / contentWidth
  const scaleY = h / contentHeight
  const scale = Math.min(scaleX, scaleY, 1.15)

  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  transform.value = {
    k: scale,
    x: w / 2 - contentCenterX * scale,
    y: h / 2 - contentCenterY * scale
  }

  scheduleRender()
}

function switchMode(mode) {
  if (mode === currentMode.value) return
  currentMode.value = mode
  calculateLayout()
}

function handleCanvasMouseDown(event) {
  isDragging.value = true
  lastMousePos.value = { x: event.clientX, y: event.clientY }
  dragStartPos.value = { x: event.clientX, y: event.clientY }
  document.body.style.cursor = 'grabbing'

  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
}

function handleWindowMouseMove(event) {
  if (!isDragging.value) return

  const dx = event.clientX - lastMousePos.value.x
  const dy = event.clientY - lastMousePos.value.y

  transform.value.x += dx
  transform.value.y += dy
  lastMousePos.value = { x: event.clientX, y: event.clientY }
  scheduleRender()
}

function handleWindowMouseUp() {
  isDragging.value = false
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
}

function handleCanvasWheel(event) {
  const zoomIntensity = 0.1
  const delta = event.deltaY > 0 ? 1 - zoomIntensity : 1 + zoomIntensity

  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top

  const newK = transform.value.k * delta
  if (newK < 0.1 || newK > 10) return

  transform.value.x = mouseX - (mouseX - transform.value.x) * delta
  transform.value.y = mouseY - (mouseY - transform.value.y) * delta
  transform.value.k = newK

  scheduleRender()
}

function handleCanvasClick(event) {
  const dx = Math.abs(event.clientX - dragStartPos.value.x)
  const dy = Math.abs(event.clientY - dragStartPos.value.y)
  if (dx > 3 || dy > 3) return

  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  const rawX = event.clientX - rect.left
  const rawY = event.clientY - rect.top
  const worldX = (rawX - transform.value.x) / transform.value.k
  const worldY = (rawY - transform.value.y) / transform.value.k

  for (const tag of placedTags.value) {
    if (!tag?.placed) continue
    const halfW = (Number(tag.width) || 20) / 2
    const halfH = (Number(tag.height) || 14) / 2
    if (
      worldX >= (Number(tag.x) || 0) - halfW
      && worldX <= (Number(tag.x) || 0) + halfW
      && worldY >= (Number(tag.y) || 0) - halfH
      && worldY <= (Number(tag.y) || 0) + halfH
    ) {
      emit('tag-click', tag)
      return
    }
  }
}

function renderToMap() {
  const sourcePois = Array.isArray(props.pois)
    ? props.pois.filter(Boolean)
    : []

  if (sourcePois.length > 0) {
    emit('render-to-map', sourcePois)
    return
  }

  const poisToRender = placedTags.value
    .filter((tag) => tag?.placed && tag?.originalPoi)
    .map((tag) => tag.originalPoi)

  emit('render-to-map', poisToRender)
}

onMounted(() => {
  worker = new Worker(new URL('../workers/basic.worker.js', import.meta.url), { type: 'module' })

  worker.onmessage = (event) => {
    const layoutTags = Array.isArray(event.data) ? event.data : []
    applyLayout(layoutTags)
  }

  worker.onerror = (error) => {
    console.warn('[EmbeddedTagCloud] worker runtime error, fallback to local layout:', error)
    const topK = currentMode.value === 'coarse' ? 50 : 20
    const intentMeta = props.intentMeta || {
      intentMode: props.intentMode === 'micro' ? 'local_search' : 'macro_overview'
    }
    const fallbackTags = buildPlaceTags(props.pois, { topK, intentMeta })
      .map((tag, index) => sanitizeTagForWorker(tag, index, topK - index))
    applyLayout(makeFallbackLayout(fallbackTags, canvasWidth.value, props.height))
  }

  worker.onmessageerror = (error) => {
    console.warn('[EmbeddedTagCloud] worker message decode error:', error)
  }

  if (containerRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width <= 0) continue
        canvasWidth.value = Math.max(240, Math.floor(entry.contentRect.width))
        if (placedTags.value.length > 0) {
          scheduleRender()
        } else if (props.pois.length > 0 && !isCalculating.value) {
          calculateLayout()
        }
      }
    })
    resizeObserver.observe(containerRef.value)
  }

  if (props.pois.length > 0) {
    calculateLayout()
  } else {
    scheduleRender()
  }
})

onUnmounted(() => {
  unlockContextScroll()

  if (renderRaf) {
    cancelAnimationFrame(renderRaf)
    renderRaf = null
  }

  if (worker) {
    worker.terminate()
    worker = null
  }

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
})

watch(
  () => [props.pois, props.intentMode, props.intentMeta],
  () => {
    calculateLayout()
  },
  { deep: true }
)
</script>

<style scoped>
.embedded-tagcloud-container {
  width: 100%;
  margin: 12px 0;
  overflow: hidden;
  border: 1px solid rgba(100, 120, 180, 0.3);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(25, 32, 48, 0.95), rgba(15, 20, 30, 0.98));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.tagcloud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(100, 120, 180, 0.2);
  background: rgba(40, 50, 70, 0.5);
}

.tagcloud-title {
  color: rgba(200, 210, 230, 0.9);
  font-size: 13px;
  font-weight: 600;
}

.tagcloud-controls {
  display: flex;
  gap: 6px;
}

.control-btn {
  padding: 4px 10px;
  border: 1px solid rgba(100, 140, 200, 0.4);
  border-radius: 6px;
  background: rgba(60, 80, 120, 0.3);
  color: rgba(180, 200, 230, 0.9);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.control-btn:hover {
  border-color: rgba(120, 160, 220, 0.6);
  background: rgba(80, 100, 150, 0.5);
}

.control-btn.active {
  border-color: rgba(100, 160, 240, 0.7);
  background: rgba(60, 120, 200, 0.5);
  color: #fff;
}

.control-btn.render-btn {
  border-color: rgba(100, 180, 140, 0.5);
  background: linear-gradient(135deg, rgba(80, 160, 120, 0.4), rgba(60, 140, 100, 0.5));
}

.control-btn.render-btn:hover {
  background: linear-gradient(135deg, rgba(100, 180, 140, 0.6), rgba(80, 160, 120, 0.7));
}

.tagcloud-canvas-wrapper {
  position: relative;
  background: rgba(20, 25, 35, 0.6);
  overscroll-behavior: contain;
}

.tagcloud-canvas {
  display: block;
  cursor: grab;
  user-select: none;
}

.tagcloud-canvas:active {
  cursor: grabbing;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(20, 25, 35, 0.82);
  color: rgba(180, 200, 230, 0.9);
  font-size: 12px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(100, 150, 220, 0.3);
  border-top-color: rgba(100, 180, 255, 0.9);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.tagcloud-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid rgba(100, 120, 180, 0.15);
  background: rgba(40, 50, 70, 0.4);
  color: rgba(150, 170, 200, 0.7);
  font-size: 11px;
}

.mode-indicator {
  font-weight: 500;
}
</style>
