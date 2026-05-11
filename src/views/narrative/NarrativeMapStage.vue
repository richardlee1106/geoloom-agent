<template>
  <main class="map-stage" :class="{ 'drawing-aoi': aoiBoxSelecting || circleSelecting || polygonSelecting }">
    <div class="map-perspective-deck">
      <div ref="mapContainerEl" class="map-canvas" :class="`mode-${baseLayerMode}`" />
    </div>
    <div class="map-horizon-mask" aria-hidden="true" />
    <div class="map-vignette" aria-hidden="true" />

    <div v-if="!minimal" class="coverage-card" :class="{ collapsed: coverageCollapsed }">
      <div class="coverage-head" @click="toggleCoverage">
        <span>当前视角覆盖分析</span>
        <div class="coverage-head-actions">
          <span class="card-help" @click.stop>?</span>
          <button
            type="button"
            class="coverage-toggle"
            :title="coverageCollapsed ? '展开' : '折叠'"
            :aria-expanded="!coverageCollapsed"
            @click.stop="toggleCoverage"
          >
            <span v-html="coverageCollapsed ? ICONS.chevronDown : ICONS.chevronUp" />
          </button>
        </div>
      </div>
      <div v-show="!coverageCollapsed" class="coverage-body">
        <svg class="donut" :width="120" :height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="46" fill="none" stroke="#1e2742" stroke-width="14" />
          <circle
            cx="60" cy="60" r="46" fill="none"
            stroke="#ef4444" stroke-width="14"
            :stroke-dasharray="`${donutDash.core} 999`"
            :stroke-dashoffset="donutOffsets.core"
            transform="rotate(-90 60 60)"
          />
          <circle
            cx="60" cy="60" r="46" fill="none"
            stroke="#f59e0b" stroke-width="14"
            :stroke-dasharray="`${donutDash.surround} 999`"
            :stroke-dashoffset="donutOffsets.surround"
            transform="rotate(-90 60 60)"
          />
          <circle
            cx="60" cy="60" r="46" fill="none"
            stroke="#3b82f6" stroke-width="14"
            :stroke-dasharray="`${donutDash.others} 999`"
            :stroke-dashoffset="donutOffsets.others"
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="56" text-anchor="middle" fill="#a3aac9" font-size="11">片区覆盖占比</text>
          <text x="60" y="78" text-anchor="middle" fill="#fff" font-size="22" font-weight="700">
            {{ Math.round(coverageBreakdown.core_ratio * 100) }}%
          </text>
        </svg>
        <ul class="coverage-legend">
          <li><span class="dot core"></span><span>核心片区</span><strong>{{ Math.round(coverageBreakdown.core_ratio * 100) }}%</strong></li>
          <li><span class="dot strong"></span><span>周边片区</span><strong>{{ Math.round(coverageBreakdown.surrounding_ratio * 100) }}%</strong></li>
          <li><span class="dot weak"></span><span>其他片区</span><strong>{{ Math.round(coverageBreakdown.others_ratio * 100) }}%</strong></li>
        </ul>
      </div>
    </div>

    <div class="map-controls">
      <button class="map-ctl" title="指南针"><span v-html="ICONS.compass" /></button>
      <div class="zoom-stack">
        <button class="map-ctl" @click="zoomIn">+</button>
        <button class="map-ctl" @click="zoomOut">−</button>
      </div>
      <button class="map-ctl active" title="2.5D">2.5D</button>
      <button class="map-ctl" title="跟随"><span v-html="ICONS.locate" /></button>
      <button
        class="map-ctl layer-toggle"
        :class="{ active: baseLayerMode === 'satellite' }"
        :title="baseLayerMode === 'vector' ? '当前：矢量地图，点击切换到卫星影像' : '当前：卫星影像，点击切换到矢量地图'"
        @click="toggleBaseLayer"
      >
        <span v-html="ICONS.layers" />
        <span class="layer-tag">{{ baseLayerMode === 'vector' ? '矢量' : '影像' }}</span>
      </button>
    </div>

    <div class="map-scale">{{ scaleLabel }}</div>
    <div v-if="aoiBoxSelecting" class="aoi-draw-hint">按住鼠标拖拽，框选本次 AOI 分析范围</div>
    <div v-else-if="circleSelecting" class="aoi-draw-hint">先点击圆心，再拖拽确定半径</div>
    <div v-else-if="polygonSelecting" class="aoi-draw-hint">连续点击落点连线，双击闭合成面</div>

    <div
      v-if="!assistantOpen && assistantCue"
      class="assistant-cue-bubble"
      role="button"
      tabindex="0"
      :title="assistantCue.prompt"
      @click="$emit('assistant-cue-click', assistantCue)"
      @keydown.enter.prevent="$emit('assistant-cue-click', assistantCue)"
    >
      <span class="assistant-cue-kicker">顺手问问</span>
      <strong>{{ assistantCue.bubble_text }}</strong>
      <button
        type="button"
        class="assistant-cue-close"
        title="先不看"
        @click.stop="$emit('assistant-cue-dismiss', assistantCue.id)"
      >
        ×
      </button>
    </div>

    <button
      v-show="!assistantOpen"
      :class="['assistant-fab', `state-${assistantFabState}`]"
      type="button"
      :title="assistantHint || 'AI 助手（Alt+A）'"
      @click="$emit('open-assistant')"
    >
      <span v-if="assistantFabState === 'thinking'" class="fab-pulse" aria-hidden="true"></span>
      <span class="fab-letters">AI</span>
      <span class="fab-label">{{ assistantFabLabel }}</span>
    </button>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import VectorLayer from 'ol/layer/Vector'
import HeatmapLayer from 'ol/layer/Heatmap'
import VectorSource from 'ol/source/Vector'
import DragBox from 'ol/interaction/DragBox'
import Draw from 'ol/interaction/Draw'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import CircleGeom from 'ol/geom/Circle'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style'
import { unByKey } from 'ol/Observable'
import type { EventsKey } from 'ol/events'

import { useProjection } from '../../composables/map/useProjection'
import type { NarrativeDisplayRegion } from './narrativeResponseAdapter'
import type { NarrativeCompanionCue, NarrativePoi, NarrativeRegion, NarrativeResponse, NarrativeUiSettings, ViewportBBox, VisualTier } from './types'

type CentroidStrategy = NarrativeUiSettings['centroidStrategy']

type CoverageBreakdown = {
  core_ratio: number
  surrounding_ratio: number
  others_ratio: number
}
type AssistantFabState = 'idle' | 'ready' | 'thinking' | 'sources' | 'speaking' | 'error'

type DonutDash = {
  core: number
  surround: number
  others: number
}

type CompareSampleOverlay = {
  id: string
  method: 'rectangle' | 'freeform' | 'circle'
  title: string
  status: 'analyzing' | 'ready' | 'error'
  viewport: ViewportBBox
  ring?: Array<[number, number]>
}

type PolygonSelectionPayload = {
  viewport: ViewportBBox
  ring: Array<[number, number]>
}

const props = defineProps<{
  narrative: NarrativeResponse
  displayRegions: NarrativeDisplayRegion[]
  displayAllRenderablePois: NarrativePoi[]
  relevanceThreshold: number
  viewportZoom: number
  coverageCollapsed: boolean
  assistantOpen: boolean
  coverageBreakdown: CoverageBreakdown
  donutDash: DonutDash
  donutOffsets: DonutDash
  compareSampleOverlays?: CompareSampleOverlay[]
  minimal?: boolean
  assistantState?: AssistantFabState
  assistantHint?: string
  assistantCue?: NarrativeCompanionCue | null
}>()

const emit = defineEmits<{
  (event: 'update:coverageCollapsed', value: boolean): void
  (event: 'update:viewportZoom', value: number): void
  (event: 'open-assistant'): void
  (event: 'ready'): void
  (event: 'aoi-box-selected', value: ViewportBBox): void
  (event: 'circle-range-selected', value: ViewportBBox): void
  (event: 'polygon-area-selected', value: PolygonSelectionPayload): void
  (event: 'assistant-cue-click', value: NarrativeCompanionCue): void
  (event: 'assistant-cue-dismiss', value: string): void
}>()

const { gcj02ToWgs84, wgs84ToGcj02 } = useProjection()

const mapContainerEl = ref<HTMLDivElement | null>(null)
const baseLayerMode = ref<'vector' | 'satellite'>('satellite')
const assistantFabState = computed(() => props.assistantState ?? 'idle')
const assistantFabLabel = computed(() => {
  if (assistantFabState.value === 'thinking') return '思考中'
  if (assistantFabState.value === 'sources') return '有来源'
  if (assistantFabState.value === 'speaking') return '导览中'
  if (assistantFabState.value === 'error') return '需处理'
  if (assistantFabState.value === 'ready') return '可追问'
  return '副驾'
})

let olMap: OlMap | null = null
let baseLayer: TileLayer<XYZ> | null = null
const regionHeatSources: Record<string, VectorSource> = {}
const regionHeatLayers: HeatmapLayer[] = []
let poiBaseSource: VectorSource | null = null
let poiLayer: VectorLayer | null = null
let labelLayer: VectorLayer | null = null
let assistantHighlightSource: VectorSource | null = null
let assistantHighlightLayer: VectorLayer | null = null
let compareOverlaySource: VectorSource | null = null
let compareOverlayLayer: VectorLayer | null = null
let resolutionChangeListenerKey: EventsKey | null = null
let aoiDragBox: DragBox | null = null
let circleDraw: Draw | null = null
let polygonDraw: Draw | null = null
let renderedNarrativeSignature = ''
let assistantHighlightTimer: number | null = null

const currentResolution = ref(0)
const aoiBoxSelecting = ref(false)
const circleSelecting = ref(false)
const polygonSelecting = ref(false)

const scaleLabel = computed(() => {
  const res = currentResolution.value
  if (!res || !Number.isFinite(res)) return ''
  const nice = [1, 2, 5]
  const raw = res * 80
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const best = nice.reduce((a, b) => Math.abs(b * mag - raw) < Math.abs(a * mag - raw) ? b : a)
  const meters = best * mag
  if (meters >= 1000) return `${(meters / 1000).toFixed(Number.isInteger(meters / 1000) ? 0 : 1)} km`
  return `${Math.round(meters)} m`
})

const BASE_TILE_URL: Record<'vector' | 'satellite', string> = {
  vector: 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  satellite: 'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'
}

const DEFAULT_REGION_COLOR = '#3b82f6'

const TIER_HEAT_WEIGHT: Record<VisualTier, number> = {
  core: 1.0,
  strong: 0.7,
  medium: 0.4,
  weak: 0,
  excluded: 0
}

const regionPalette = computed<Record<string, string>>(() =>
  Object.fromEntries(props.displayRegions.map((r) => [r.id, r.visual_layer.region_glow?.color ?? DEFAULT_REGION_COLOR]))
)

const poiRegionCache = new Map<string, string>()

const ICONS = {
  compass: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><polygon points="9,9 15,15 13,7"/></svg>`,
  locate: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 22 8.5 12 15 2 8.5 12 2"/><polyline points="2 15.5 12 22 22 15.5"/></svg>`,
  chevronUp: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`
}

function toggleCoverage() {
  emit('update:coverageCollapsed', !props.coverageCollapsed)
}

function pointInRegion(lon: number, lat: number, region: NarrativeRegion): boolean {
  const ring = region.boundary.coordinates[0] ?? []
  if (ring.length < 4) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function containingRegionId(lon: number, lat: number): string {
  for (const r of props.displayRegions) {
    if (pointInRegion(lon, lat, r)) return r.id
  }
  return ''
}

function regionIdForPoi(id: string, lon: number, lat: number): string {
  const cached = poiRegionCache.get(id)
  if (cached && regionHeatSources[cached] && props.displayRegions.some((region) => region.id === cached && pointInRegion(lon, lat, region))) return cached
  const rid = containingRegionId(lon, lat)
  if (rid) poiRegionCache.set(id, rid)
  return rid
}

function toggleBaseLayer() {
  if (!baseLayer) return
  baseLayerMode.value = baseLayerMode.value === 'vector' ? 'satellite' : 'vector'
  baseLayer.setSource(new XYZ({
    url: BASE_TILE_URL[baseLayerMode.value],
    crossOrigin: 'anonymous'
  }))
}

function styleForTier(tier: VisualTier): any | null {
  if (tier === 'excluded') return null
  const palette: Record<Exclude<VisualTier, 'excluded'>, { fill: string; stroke: string; r: number; alpha: number }> = {
    core: { fill: '#ef4444', stroke: '#fff', r: 7, alpha: 1 },
    strong: { fill: '#f97316', stroke: 'rgba(255,255,255,0.85)', r: 5, alpha: 0.95 },
    medium: { fill: '#eab308', stroke: 'rgba(255,255,255,0.55)', r: 4, alpha: 0.7 },
    weak: { fill: '#3b82f6', stroke: 'rgba(255,255,255,0.25)', r: 3, alpha: 0.4 }
  }
  const cfg = palette[tier]
  return new Style({
    image: new CircleStyle({
      radius: cfg.r,
      fill: new Fill({ color: hexToRgba(cfg.fill, cfg.alpha) }),
      stroke: new Stroke({ color: cfg.stroke, width: tier === 'core' ? 2 : 1 })
    })
  })
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.substring(0, 2), 16)
  const g = parseInt(m.substring(2, 4), 16)
  const b = parseInt(m.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function rebuildPoiLayer() {
  if (!poiBaseSource) return
  poiBaseSource.clear()
  for (const src of Object.values(regionHeatSources)) src.clear()

  const tierMin: Record<VisualTier, number> = {
    excluded: 99,
    weak: 0,
    medium: 0.25,
    strong: 0.55,
    core: 0
  }

  for (const p of props.displayAllRenderablePois) {
    if (p.tier === 'excluded') continue
    if (props.relevanceThreshold > tierMin[p.tier]) continue

    const rid = regionIdForPoi(p.id, p.lon, p.lat)
    if (!rid) continue
    const coord = fromLonLat([p.lon, p.lat])

    const f = new Feature({ geometry: new Point(coord) })
    const st = styleForTier(p.tier)
    if (st) {
      f.setStyle(st)
      f.set('tier', p.tier)
      f.set('name', p.display_name)
      poiBaseSource.addFeature(f)
    }

    const heatSrc = regionHeatSources[rid]
    const heatWeight = TIER_HEAT_WEIGHT[p.tier]
    if (heatSrc && heatWeight > 0) {
      const hf = new Feature({ geometry: new Point(coord) })
      hf.set('weight', heatWeight)
      heatSrc.addFeature(hf)
    }
  }

  for (const region of props.displayRegions) {
    const heatSrc = regionHeatSources[region.id]
    if (!heatSrc || heatSrc.getFeatures().length > 0) continue
    for (const point of region.visual_layer.poi_heat?.points ?? []) {
      const isWeakFallback = point.tier === 'weak'
      if (!isWeakFallback && props.relevanceThreshold > tierMin[point.tier]) continue
      const heatWeight = isWeakFallback ? 0.14 : TIER_HEAT_WEIGHT[point.tier]
      if (heatWeight <= 0) continue
      const hf = new Feature({ geometry: new Point(fromLonLat([point.lon, point.lat])) })
      hf.set('weight', heatWeight)
      heatSrc.addFeature(hf)
    }
  }
}

function syncHeatmapRadius() {
  if (!olMap) return
  const z = olMap.getView().getZoom() ?? 14
  const radius = Math.max(8, Math.min(34, 60 - z * 3))
  const blur = Math.max(10, Math.min(38, radius + 6))
  for (const hl of regionHeatLayers) {
    hl.setRadius(radius)
    hl.setBlur(blur)
  }
}

function rebuildLabelLayer() {
  if (!labelLayer) return
  const src = labelLayer.getSource()!
  src.clear()
  for (const region of props.displayRegions) {
    const f = new Feature({
      geometry: new Point(fromLonLat([region.core_anchor.lon, region.core_anchor.lat]))
    })
    f.setStyle(
      new Style({
        text: new Text({
          text: region.display_name,
          font: '600 13px "PingFang SC","Microsoft YaHei",sans-serif',
          fill: new Fill({ color: '#fff' }),
          stroke: new Stroke({ color: 'rgba(15,18,32,0.95)', width: 4 }),
          offsetY: -16,
          padding: [4, 8, 4, 8]
        })
      })
    )
    src.addFeature(f)
  }
}

function compareOverlayColor(sample: CompareSampleOverlay): string {
  if (sample.status === 'error') return '#fb7185'
  if (sample.status === 'analyzing') return '#fbbf24'
  if (sample.method === 'circle') return '#f59e0b'
  if (sample.method === 'freeform') return '#22c55e'
  return '#60a5fa'
}

function compareOverlayRing(viewport: ViewportBBox): Array<[number, number]> {
  const points: Array<[number, number]> = [
    [viewport.west, viewport.south],
    [viewport.east, viewport.south],
    [viewport.east, viewport.north],
    [viewport.west, viewport.north],
    [viewport.west, viewport.south]
  ]
  return points.map(([lon, lat]) => wgs84ToGcj02(lon, lat))
}

function compareCircleRing(viewport: ViewportBBox): Array<[number, number]> {
  const [centerLon, centerLat] = viewport.center
  const rx = Math.abs(viewport.east - viewport.west) / 2
  const ry = Math.abs(viewport.north - viewport.south) / 2
  const points: Array<[number, number]> = []
  for (let i = 0; i <= 48; i += 1) {
    const rad = (Math.PI * 2 * i) / 48
    points.push(wgs84ToGcj02(centerLon + Math.cos(rad) * rx, centerLat + Math.sin(rad) * ry))
  }
  return points
}

function compareOverlayGeometry(sample: CompareSampleOverlay): Polygon {
  const ring = sample.ring?.length
    ? sample.ring
    : sample.method === 'circle'
      ? compareCircleRing(sample.viewport)
      : compareOverlayRing(sample.viewport)
  return new Polygon([ring.map((point) => fromLonLat(point))])
}

function rebuildCompareOverlayLayer() {
  const source = compareOverlaySource
  if (!source) return
  source.clear()
  const overlays = props.compareSampleOverlays ?? []
  overlays.forEach((sample, index) => {
    const feature = new Feature({
      geometry: compareOverlayGeometry(sample)
    })
    const color = compareOverlayColor(sample)
    feature.setStyle(new Style({
      fill: new Fill({ color: hexToRgba(color, sample.status === 'analyzing' ? 0.12 : 0.08) }),
      stroke: new Stroke({
        color: hexToRgba(color, sample.status === 'analyzing' ? 0.98 : 0.88),
        width: sample.status === 'ready' ? 2.5 : 2,
        lineDash: sample.method === 'circle' ? [7, 6] : undefined
      }),
      text: new Text({
        text: `${index + 1} ${sample.title}`,
        font: '700 12px "PingFang SC","Microsoft YaHei",sans-serif',
        fill: new Fill({ color: '#f8fafc' }),
        stroke: new Stroke({ color: 'rgba(2,6,23,0.95)', width: 4 }),
        offsetY: -12
      })
    }))
    source.addFeature(feature)
  })
}

function clearRegionHeatLayers() {
  if (!olMap) return
  for (const layer of regionHeatLayers) olMap.removeLayer(layer)
  regionHeatLayers.splice(0, regionHeatLayers.length)
  for (const key of Object.keys(regionHeatSources)) delete regionHeatSources[key]
}

function rebuildRegionHeatLayers() {
  if (!olMap || !poiLayer || !labelLayer || !compareOverlayLayer) return
  clearRegionHeatLayers()
  for (const region of props.displayRegions) {
    const src = new VectorSource()
    regionHeatSources[region.id] = src
    const color = regionPalette.value[region.id] ?? DEFAULT_REGION_COLOR
    const hl = new HeatmapLayer({
      source: src,
      weight: (f: any) => (f.get('weight') as number) ?? 0.2,
      radius: 18,
      blur: 22,
      gradient: [
        hexToRgba(color, 0),
        hexToRgba(color, 0.35),
        hexToRgba(color, 0.65),
        hexToRgba(color, 0.85),
        hexToRgba(color, 1.0)
      ],
      opacity: 0.6,
      zIndex: 5
    })
    regionHeatLayers.push(hl)
    olMap.addLayer(hl)
  }
  olMap.removeLayer(poiLayer)
  olMap.removeLayer(labelLayer)
  olMap.removeLayer(compareOverlayLayer)
  olMap.addLayer(poiLayer)
  olMap.addLayer(labelLayer)
  olMap.addLayer(compareOverlayLayer)
}

function refreshMapLayersAfterNarrativeChange() {
  const signature = `${props.narrative.session_id}:${props.narrative.state_version}:${props.narrative.path.seed}:${props.displayRegions.map((region) => region.id).join('|')}`
  if (signature !== renderedNarrativeSignature) {
    renderedNarrativeSignature = signature
    poiBaseSource?.clear()
    labelLayer?.getSource()?.clear()
    for (const src of Object.values(regionHeatSources)) src.clear()
  }
  poiRegionCache.clear()
  rebuildRegionHeatLayers()
  rebuildPoiLayer()
  rebuildLabelLayer()
  rebuildCompareOverlayLayer()
  syncHeatmapRadius()
}

function flyToRegion(region: NarrativeRegion) {
  if (!olMap) return
  olMap.getView().animate({
    center: fromLonLat([region.core_anchor.lon, region.core_anchor.lat]),
    zoom: 15.5,
    duration: 900
  })
}

function highlightRegion(region: NarrativeRegion) {
  if (!assistantHighlightSource) return
  if (assistantHighlightTimer !== null) {
    window.clearTimeout(assistantHighlightTimer)
    assistantHighlightTimer = null
  }
  assistantHighlightSource.clear()
  const points = regionBoundaryPoints(region)
  if (points.length >= 4) {
    const color = region.visual_layer.region_glow?.color ?? DEFAULT_REGION_COLOR
    const feature = new Feature({
      geometry: new Polygon([points.map((point) => fromLonLat(point))])
    })
    feature.setStyle(new Style({
      fill: new Fill({ color: hexToRgba(color, 0.16) }),
      stroke: new Stroke({ color: '#bfdbfe', width: 3.5, lineDash: [10, 7] }),
      text: new Text({
        text: 'AI 正在关注 · ' + region.display_name,
        font: '700 12px "PingFang SC","Microsoft YaHei",sans-serif',
        fill: new Fill({ color: '#eff6ff' }),
        stroke: new Stroke({ color: 'rgba(15,23,42,0.95)', width: 4 }),
        offsetY: -24
      })
    }))
    assistantHighlightSource.addFeature(feature)
  }
  const anchor = new Feature({
    geometry: new Point(fromLonLat([region.core_anchor.lon, region.core_anchor.lat]))
  })
  anchor.setStyle(new Style({
    image: new CircleStyle({
      radius: 11,
      fill: new Fill({ color: 'rgba(96,165,250,0.28)' }),
      stroke: new Stroke({ color: '#dbeafe', width: 3 })
    })
  }))
  assistantHighlightSource.addFeature(anchor)
  assistantHighlightTimer = window.setTimeout(() => {
    assistantHighlightSource?.clear()
    assistantHighlightTimer = null
  }, 3200)
}

function zoomIn() {
  if (!olMap) return
  const v = olMap.getView()
  v.animate({ zoom: (v.getZoom() ?? 14) + 1, duration: 240 })
  requestAnimationFrame(syncViewportZoomFromMap)
}

function zoomOut() {
  if (!olMap) return
  const v = olMap.getView()
  v.animate({ zoom: (v.getZoom() ?? 14) - 1, duration: 240 })
  requestAnimationFrame(syncViewportZoomFromMap)
}

function applyViewportZoom(zoomValue = props.viewportZoom) {
  if (!olMap) return
  const zoom = Math.max(10, Math.min(17, Number(zoomValue) || props.narrative.viewport.zoom))
  emit('update:viewportZoom', Number(zoom.toFixed(1)))
  olMap.getView().setZoom(zoom)
}

function syncViewportZoomFromMap() {
  if (!olMap) return
  const zoom = olMap.getView().getZoom()
  if (!Number.isFinite(zoom)) return
  emit('update:viewportZoom', Number((zoom ?? props.narrative.viewport.zoom).toFixed(1)))
}

function regionBoundaryPoints(region: NarrativeRegion): Array<[number, number]> {
  return (region.boundary.coordinates[0] ?? [])
    .filter((point): point is [number, number] => Number.isFinite(point[0]) && Number.isFinite(point[1]))
}

function regionPoiPoints(region: NarrativeRegion): Array<[number, number]> {
  const pois = region.pois.map((poi): [number, number] => [poi.lon, poi.lat])
  if (pois.length > 0) return pois
  return (region.visual_layer.poi_heat?.points ?? []).map((point): [number, number] => [point.lon, point.lat])
}

function fitLonLatPoints(points: Array<[number, number]>, viewportZoom: number) {
  if (!olMap || points.length === 0) return false
  if (points.length === 1) {
    olMap.getView().animate({ center: fromLonLat(points[0]), zoom: viewportZoom, duration: 420 })
    return true
  }
  const projected = points.map((point) => fromLonLat(point))
  const xs = projected.map((point) => point[0]).filter(Number.isFinite)
  const ys = projected.map((point) => point[1]).filter(Number.isFinite)
  if (xs.length === 0 || ys.length === 0) return false
  olMap.getView().fit(
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    { padding: [90, 90, 90, 90], duration: 480, maxZoom: Math.max(14, viewportZoom) },
  )
  return true
}

function focusByCentroidStrategy(strategy: CentroidStrategy, region: NarrativeRegion, viewportZoom = props.viewportZoom) {
  if (!olMap) return
  if (strategy === 'poi_first' && fitLonLatPoints(regionPoiPoints(region), viewportZoom)) return
  if (strategy === 'region_first' && fitLonLatPoints(regionBoundaryPoints(region), viewportZoom)) return
  olMap.getView().animate({
    center: fromLonLat([region.core_anchor.lon, region.core_anchor.lat]),
    zoom: viewportZoom,
    duration: 420,
  })
}

function getCurrentMapViewport(): ViewportBBox | null {
  if (!olMap) return null
  const size = olMap.getSize()
  if (!size) return null
  const view = olMap.getView()
  const extent3857 = view.calculateExtent(size)
  const [displayWest, displaySouth, displayEast, displayNorth] = transformExtent(extent3857, 'EPSG:3857', 'EPSG:4326')
  const [west, south] = gcj02ToWgs84(displayWest, displaySouth)
  const [east, north] = gcj02ToWgs84(displayEast, displayNorth)
  const displayCenter = toLonLat(view.getCenter() ?? fromLonLat(props.narrative.viewport.center)) as [number, number]
  const center = gcj02ToWgs84(displayCenter[0], displayCenter[1])
  return {
    west,
    south,
    east,
    north,
    zoom: view.getZoom() ?? props.narrative.viewport.zoom,
    center
  }
}

function viewportFromProjectedExtent(extent3857: [number, number, number, number]): ViewportBBox | null {
  if (!olMap) return null
  const [displayWest, displaySouth, displayEast, displayNorth] = transformExtent(extent3857, 'EPSG:3857', 'EPSG:4326')
  const [westRaw, southRaw] = gcj02ToWgs84(displayWest, displaySouth)
  const [eastRaw, northRaw] = gcj02ToWgs84(displayEast, displayNorth)
  const west = Math.min(westRaw, eastRaw)
  const east = Math.max(westRaw, eastRaw)
  const south = Math.min(southRaw, northRaw)
  const north = Math.max(southRaw, northRaw)
  if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) return null
  if (Math.abs(east - west) < 0.0001 || Math.abs(north - south) < 0.0001) return null
  return {
    west,
    south,
    east,
    north,
    zoom: olMap.getView().getZoom() ?? props.narrative.viewport.zoom,
    center: [(west + east) / 2, (south + north) / 2]
  }
}

function viewportFromCircleGeometry(circle: CircleGeom): ViewportBBox | null {
  if (!olMap) return null
  const center3857 = circle.getCenter()
  const radius = circle.getRadius()
  if (!center3857 || !Number.isFinite(radius) || radius <= 0) return null
  return viewportFromProjectedExtent([
    center3857[0] - radius,
    center3857[1] - radius,
    center3857[0] + radius,
    center3857[1] + radius
  ])
}

function polygonRingFromGeometry(polygon: Polygon): Array<[number, number]> {
  const ring3857 = polygon.getCoordinates()[0] ?? []
  const ring = ring3857
    .map((point) => toLonLat(point) as [number, number])
    .filter((point): point is [number, number] => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (ring.length < 4) return []
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first])
  return ring
}

function cancelAoiBoxSelection() {
  if (aoiDragBox && olMap) olMap.removeInteraction(aoiDragBox)
  aoiDragBox = null
  aoiBoxSelecting.value = false
}

function cancelCircleSelection() {
  if (circleDraw && olMap) olMap.removeInteraction(circleDraw)
  circleDraw = null
  circleSelecting.value = false
}

function cancelPolygonSelection() {
  if (polygonDraw && olMap) olMap.removeInteraction(polygonDraw)
  polygonDraw = null
  polygonSelecting.value = false
}

function beginAoiBoxSelection(): boolean {
  if (!olMap) return false
  cancelAoiBoxSelection()
  cancelCircleSelection()
  cancelPolygonSelection()
  const dragBox = new DragBox({ condition: () => aoiBoxSelecting.value })
  dragBox.on('boxend', () => {
    const viewport = viewportFromProjectedExtent(dragBox.getGeometry().getExtent() as [number, number, number, number])
    cancelAoiBoxSelection()
    if (viewport) emit('aoi-box-selected', viewport)
  })
  dragBox.on('boxcancel', cancelAoiBoxSelection)
  aoiDragBox = dragBox
  aoiBoxSelecting.value = true
  olMap.addInteraction(dragBox)
  return true
}

function beginCircleSelection(): boolean {
  if (!olMap) return false
  cancelAoiBoxSelection()
  cancelCircleSelection()
  cancelPolygonSelection()
  const draw = new Draw({
    source: new VectorSource(),
    type: 'Circle',
    style: new Style({
      fill: new Fill({ color: 'rgba(245,158,11,0.12)' }),
      stroke: new Stroke({ color: 'rgba(245,158,11,0.96)', width: 2, lineDash: [7, 6] })
    })
  })
  draw.on('drawend', (event) => {
    const geometry = event.feature.getGeometry()
    cancelCircleSelection()
    if (geometry instanceof CircleGeom) {
      const viewport = viewportFromCircleGeometry(geometry)
      if (viewport) emit('circle-range-selected', viewport)
    }
  })
  circleDraw = draw
  circleSelecting.value = true
  olMap.addInteraction(draw)
  return true
}

function beginPolygonSelection(): boolean {
  if (!olMap) return false
  cancelAoiBoxSelection()
  cancelCircleSelection()
  cancelPolygonSelection()
  const draw = new Draw({
    source: new VectorSource(),
    type: 'Polygon',
    style: new Style({
      fill: new Fill({ color: 'rgba(34,197,94,0.12)' }),
      stroke: new Stroke({ color: 'rgba(34,197,94,0.96)', width: 2 }),
      image: new CircleStyle({
        radius: 4,
        fill: new Fill({ color: '#22c55e' }),
        stroke: new Stroke({ color: '#fff', width: 1.5 })
      })
    })
  })
  draw.on('drawend', (event) => {
    const geometry = event.feature.getGeometry()
    cancelPolygonSelection()
    if (geometry instanceof Polygon) {
      const ring = polygonRingFromGeometry(geometry)
      const viewport = viewportFromProjectedExtent(geometry.getExtent() as [number, number, number, number])
      if (viewport && ring.length >= 4) emit('polygon-area-selected', { viewport, ring })
    }
  })
  polygonDraw = draw
  polygonSelecting.value = true
  olMap.addInteraction(draw)
  return true
}

function initMap() {
  if (!mapContainerEl.value) return
  baseLayer = new TileLayer({
    source: new XYZ({
      url: BASE_TILE_URL[baseLayerMode.value],
      crossOrigin: 'anonymous'
    })
  })

  for (const region of props.displayRegions) {
    const src = new VectorSource()
    regionHeatSources[region.id] = src
    const color = regionPalette.value[region.id] ?? DEFAULT_REGION_COLOR
    const hl = new HeatmapLayer({
      source: src,
      weight: (f: any) => (f.get('weight') as number) ?? 0.2,
      radius: 18,
      blur: 22,
      gradient: [
        hexToRgba(color, 0),
        hexToRgba(color, 0.35),
        hexToRgba(color, 0.65),
        hexToRgba(color, 0.85),
        hexToRgba(color, 1.0)
      ],
      opacity: 0.6,
      zIndex: 5
    })
    regionHeatLayers.push(hl)
  }

  poiBaseSource = new VectorSource()
  poiLayer = new VectorLayer({ source: poiBaseSource, zIndex: 10 })
  labelLayer = new VectorLayer({ source: new VectorSource(), zIndex: 20, declutter: true })
  assistantHighlightSource = new VectorSource()
  assistantHighlightLayer = new VectorLayer({ source: assistantHighlightSource, zIndex: 19 })
  compareOverlaySource = new VectorSource()
  compareOverlayLayer = new VectorLayer({ source: compareOverlaySource, zIndex: 18 })

  const WUHAN_CITY_BBOX_4326: [number, number, number, number] = [113.7, 29.9, 115.1, 31.4]
  const adminExtent3857 = transformExtent(WUHAN_CITY_BBOX_4326, 'EPSG:4326', 'EPSG:3857')

  olMap = new OlMap({
    target: mapContainerEl.value,
    layers: [baseLayer, ...regionHeatLayers, poiLayer, compareOverlayLayer, assistantHighlightLayer, labelLayer],
    controls: [],
    view: new View({
      center: fromLonLat(props.narrative.viewport.center),
      zoom: props.narrative.viewport.zoom,
      minZoom: 10,
      maxZoom: 17,
      extent: adminExtent3857,
      constrainOnlyCenter: false,
      showFullExtent: true
    })
  })

  rebuildPoiLayer()
  rebuildLabelLayer()
  rebuildCompareOverlayLayer()
  syncHeatmapRadius()
  syncViewportZoomFromMap()
  currentResolution.value = olMap.getView().getResolution() ?? 0

  resolutionChangeListenerKey = olMap.getView().on('change:resolution', () => {
    syncHeatmapRadius()
    syncViewportZoomFromMap()
    currentResolution.value = olMap?.getView().getResolution() ?? 0
  })

  emit('ready')
}

watch(() => props.relevanceThreshold, () => {
  rebuildPoiLayer()
})

watch(
  () => props.compareSampleOverlays?.map((sample) => `${sample.id}:${sample.status}:${sample.title}:${sample.viewport.west}:${sample.viewport.south}:${sample.viewport.east}:${sample.viewport.north}`).join('|') ?? '',
  () => {
    rebuildCompareOverlayLayer()
  },
  { flush: 'post' }
)

watch(() => props.viewportZoom, (zoom) => {
  if (!olMap) return
  const current = olMap.getView().getZoom() ?? props.narrative.viewport.zoom
  if (Math.abs(current - zoom) > 0.05) applyViewportZoom(zoom)
})

watch(
  () => `${props.narrative.session_id}:${props.narrative.state_version}:${props.narrative.path.seed}:${props.displayRegions.map((region) => region.id).join('|')}`,
  () => {
    if (olMap) refreshMapLayersAfterNarrativeChange()
  },
  { flush: 'post' }
)

onMounted(() => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      initMap()
    })
  })
})

onBeforeUnmount(() => {
  cancelAoiBoxSelection()
  cancelCircleSelection()
  cancelPolygonSelection()
  if (assistantHighlightTimer !== null) {
    window.clearTimeout(assistantHighlightTimer)
    assistantHighlightTimer = null
  }
  if (resolutionChangeListenerKey) {
    unByKey(resolutionChangeListenerKey)
    resolutionChangeListenerKey = null
  }
  if (olMap) {
    olMap.setTarget(undefined)
    olMap = null
  }
})

defineExpose({
  applyViewportZoom,
  focusByCentroidStrategy,
  flyToRegion,
  highlightRegion,
  getCurrentMapViewport,
  beginAoiBoxSelection,
  cancelAoiBoxSelection,
  beginCircleSelection,
  cancelCircleSelection,
  beginPolygonSelection,
  cancelPolygonSelection,
  refreshMapLayersAfterNarrativeChange,
  zoomIn,
  zoomOut
})
</script>

<style scoped>
.map-stage {
  position: relative;
  min-height: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #0b1020;
  border: 1px solid var(--bd-strong);
}
.map-stage.drawing-aoi {
  cursor: crosshair;
}

.map-stage.drawing-aoi :deep(.ol-viewport) {
  cursor: crosshair;
}

:deep(.ol-dragbox) {
  border: 2px solid rgba(96,165,250,0.95);
  background: rgba(59,130,246,0.18);
  box-shadow: 0 0 0 9999px rgba(15,23,42,0.18);
}

.map-perspective-deck {
  position: absolute;
  inset: -28% -18% -34% -18%;
  transform: perspective(1400px) rotateX(24deg) scale(1.16) translateY(-1.5%);
  transform-origin: 50% 68%;
  background: #101827;
  backface-visibility: hidden;
  will-change: transform;
}

.map-canvas {
  position: absolute;
  inset: 0;
  transform-origin: 50% 68%;
}

:deep(.ol-viewport) { background: #0a0e1c; }
.map-canvas.mode-vector :deep(.ol-viewport) { filter: none; }
.map-canvas.mode-satellite :deep(.ol-viewport) {
  filter: saturate(1.04) contrast(1.03) brightness(0.98);
}

.map-horizon-mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(10,14,26,0.18) 0%,
    rgba(10,14,26,0.05) 30%,
    rgba(10,14,26,0) 62%
  );
}

.map-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), inset 0 0 36px rgba(2,6,23,0.22);
}

.coverage-card {
  position: absolute; top: 14px; left: 14px;
  width: 280px;
  background: var(--bg-overlay);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 12px;
  z-index: 5;
  transition: width 0.2s ease, padding 0.2s ease;
}

.coverage-card.collapsed {
  width: 220px;
  padding: 10px 12px;
}

.coverage-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; font-weight: 600; margin-bottom: 10px;
  cursor: pointer;
  user-select: none;
}

.coverage-card.collapsed .coverage-head { margin-bottom: 0; }
.coverage-head-actions { display: flex; align-items: center; gap: 6px; }

.card-help {
  width: 16px; height: 16px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  color: var(--txt-mute);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; cursor: help;
}

.coverage-toggle {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid var(--bd);
  border-radius: 5px;
  color: var(--txt-mute);
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.coverage-toggle:hover {
  color: #fff;
  border-color: rgba(59,130,246,0.55);
  background: rgba(59,130,246,0.18);
}

.coverage-body {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px; align-items: center;
}

.coverage-legend { list-style: none; padding: 0; margin: 0; font-size: 12px; }
.coverage-legend li {
  display: grid; grid-template-columns: 10px 1fr auto;
  gap: 8px; padding: 3px 0; align-items: center;
}
.coverage-legend .dot { width: 8px; height: 8px; border-radius: 50%; }
.coverage-legend .dot.core { background: #ef4444; }
.coverage-legend .dot.strong { background: #f97316; }
.coverage-legend .dot.weak { background: #3b82f6; }
.coverage-legend strong { color: #fff; font-weight: 600; font-feature-settings: 'tnum'; }

.map-controls {
  position: absolute; top: 14px; right: 14px;
  display: flex; flex-direction: column;
  gap: 6px; z-index: 5;
}

.map-ctl {
  width: 36px; height: 36px;
  background: var(--bg-overlay);
  border: 1px solid var(--bd);
  color: var(--txt);
  z-index: 6;
  border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600;
}

.map-ctl:hover { background: var(--bg-elevated); }
.map-ctl.active { background: var(--primary); border-color: var(--bd-accent); color: #fff; }

.zoom-stack {
  display: flex; flex-direction: column;
  background: var(--bg-overlay);
  border: 1px solid var(--bd);
  border-radius: 8px;
  overflow: hidden;
}

.zoom-stack .map-ctl { border: 0; border-radius: 0; background: transparent; }
.zoom-stack .map-ctl + .map-ctl { border-top: 1px solid var(--bd); }

.map-ctl.layer-toggle {
  flex-direction: column;
  gap: 1px;
  padding: 4px 0;
  height: 42px;
  font-size: 11px;
  line-height: 1;
}

.map-ctl.layer-toggle :deep(svg) { width: 16px; height: 16px; }
.map-ctl.layer-toggle .layer-tag {
  font-size: 10px;
  font-weight: 500;
  color: var(--txt-soft);
  letter-spacing: 0.5px;
}
.map-ctl.layer-toggle.active .layer-tag { color: #fff; }

.map-scale {
  position: absolute; bottom: 12px; left: 14px;
  width: 80px;
  box-sizing: content-box;
  text-align: center;
  font-size: 11px; color: var(--txt-mute);
  padding: 4px 8px;
  background: var(--bg-overlay);
  border: 1px solid var(--bd);
  border-radius: 6px;
  z-index: 5;
}
.aoi-draw-hint {
  position: absolute;
  z-index: 40;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 12px;
  border: 1px solid rgba(96,165,250,0.45);
  border-radius: 999px;
  background: rgba(15,23,42,0.88);
  color: #dbeafe;
  font-size: 12px;
  box-shadow: 0 10px 28px rgba(2,6,23,0.26);
  pointer-events: none;
}

.assistant-fab {
  position: absolute;
  right: 14px; bottom: 14px;
  z-index: 20;
  min-width: 74px;
  height: 52px;
  padding: 0 13px;
  gap: 6px;
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(59, 130, 246, 0.96), rgba(37, 99, 235, 0.9)),
    radial-gradient(circle at 20% 0%, rgba(255, 255, 255, 0.24), transparent 34%);
  color: #fff;
  border: 1px solid rgba(147, 197, 253, 0.5);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16px 38px rgba(2, 6, 23, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  transition: background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
}

.assistant-fab:hover  {
  transform: translateY(-1px);
  box-shadow: 0 20px 46px rgba(2, 6, 23, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
}
.assistant-fab:active { transform: translateY(0); }

.assistant-cue-bubble {
  position: absolute;
  right: 14px;
  bottom: 78px;
  z-index: 21;
  width: min(286px, calc(100% - 28px));
  padding: 10px 36px 10px 13px;
  border: 1px solid rgba(191, 219, 254, 0.58);
  border-radius: 18px 18px 4px 18px;
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 64, 175, 0.82)),
    radial-gradient(circle at 12% 0%, rgba(125, 211, 252, 0.24), transparent 36%);
  color: #eef6ff;
  box-shadow: 0 18px 44px rgba(2, 6, 23, 0.38), 0 0 0 1px rgba(255,255,255,0.05) inset;
  cursor: pointer;
  animation: assistant-cue-in 0.28s ease-out both;
}

.assistant-cue-bubble::after {
  content: '';
  position: absolute;
  right: 24px;
  bottom: -8px;
  width: 14px;
  height: 14px;
  background: rgba(30, 64, 175, 0.86);
  border-right: 1px solid rgba(191, 219, 254, 0.36);
  border-bottom: 1px solid rgba(191, 219, 254, 0.36);
  transform: rotate(45deg);
}

.assistant-cue-kicker {
  display: block;
  margin-bottom: 3px;
  color: #93c5fd;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.assistant-cue-bubble strong {
  display: block;
  font-size: 13px;
  line-height: 1.42;
  font-weight: 700;
}

.assistant-cue-close {
  position: absolute;
  top: 7px;
  right: 8px;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.28);
  color: rgba(226, 232, 240, 0.78);
  cursor: pointer;
}

.assistant-cue-close:hover { background: rgba(15, 23, 42, 0.48); color: #fff; }

.assistant-fab.state-thinking {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.98), rgba(14, 165, 233, 0.88));
}

.assistant-fab.state-sources {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.98), rgba(16, 185, 129, 0.9));
}

.assistant-fab.state-speaking {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.98), rgba(59, 130, 246, 0.9));
}

.assistant-fab.state-error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.98), rgba(245, 158, 11, 0.88));
}

.fab-letters {
  position: relative;
  z-index: 1;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.6px;
  line-height: 1;
}

.fab-label {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
}

.fab-pulse {
  position: absolute;
  inset: -4px;
  border-radius: inherit;
  border: 1px solid rgba(191, 219, 254, 0.72);
  animation: assistant-fab-pulse 1.4s ease-out infinite;
}

@keyframes assistant-fab-pulse {
  0% { opacity: 0.74; transform: scale(0.96); }
  100% { opacity: 0; transform: scale(1.18); }
}

@keyframes assistant-cue-in {
  0% { opacity: 0; transform: translateY(8px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
