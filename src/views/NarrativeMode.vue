<template>
  <div class="narrative-shell">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"></span>
        <span class="brand-name">智能地图解说引擎</span>
        <span class="brand-tag">BETA</span>
      </div>
      <nav class="mode-switch">
        <button
          v-for="m in modes"
          :key="m.key"
          :class="['mode-btn', { active: mode === m.key }]"
          @click="mode = m.key"
        >
          <span class="mode-icon" v-html="m.icon" />
          <span>{{ m.label }}</span>
        </button>
      </nav>
      <div class="topbar-actions">
        <button class="action-btn" title="分享"><span v-html="ICONS.share" /><span>分享</span></button>
        <button class="action-btn" title="收藏"><span v-html="ICONS.bookmark" /><span>收藏</span></button>
        <button class="action-btn" title="设置"><span v-html="ICONS.settings" /><span>设置</span></button>
      </div>
    </header>

    <!-- 中部主体：左 + 中 + 右 -->
    <div class="main-grid">
      <!-- 左面板 -->
      <aside class="left-panel">
        <!-- 1. 片区筛选 -->
        <section class="panel-card">
          <div class="card-head">
            <span class="card-index">1</span>
            <span class="card-title">片区筛选</span>
            <span class="card-help" title="按行政区或自定义范围限定 narrative 候选片区">?</span>
          </div>
          <div class="search-row">
            <span class="search-icon" v-html="ICONS.search" />
            <input class="search-input" placeholder="搜索片区 / POI" />
          </div>
          <div class="select-group">
            <label class="select-label">自定义范围</label>
            <div class="select-row">
              <button class="ghost-btn"><span v-html="ICONS.draw" /><span>绘制 AOI</span></button>
              <button class="ghost-btn"><span v-html="ICONS.upload" /><span>上传文件</span></button>
            </div>
          </div>
          <div class="region-info">
            <div class="region-info-title">当前片区信息</div>
            <div class="region-info-row">
              <span>面积</span>
              <strong>{{ activeRegionAreaText }}</strong>
            </div>
            <div class="region-info-row">
              <span>POI</span>
              <strong>{{ totalPoi.toLocaleString() }}</strong>
            </div>
            <div class="region-info-row">
              <span>主体覆盖</span>
              <strong>{{ Math.round(narrative.dominant_coverage * 100) }}%</strong>
            </div>
            <div class="region-info-row">
              <span>数据状态</span>
              <strong>{{ narrativeSourceLabel }}</strong>
            </div>
          </div>
          <div v-if="analysisError" class="analysis-error">{{ analysisError }}</div>
          <button class="primary-btn" :disabled="analysisStatus === 'analyzing'" @click="analyzeCurrentViewport">
            {{ analysisStatus === 'analyzing' ? '分析中…' : '分析当前视野' }}
          </button>
        </section>

        <!-- 2. 点剔除与分层 -->
        <section class="panel-card">
          <div class="card-head">
            <span class="card-index">2</span>
            <span class="card-title">点剔除与分层</span>
            <span class="card-help" title="按相关性阈值切换 5 档渲染">?</span>
          </div>
          <ul class="tier-list">
            <li v-for="t in tierLegend" :key="t.key" class="tier-item">
              <span class="tier-dot" :style="{ background: t.color, boxShadow: `0 0 8px ${t.color}` }" />
              <span class="tier-label">{{ t.label }}</span>
              <span class="tier-count">{{ tierStats[t.key] || 0 }}</span>
            </li>
          </ul>
          <div class="slider-row">
            <span class="slider-label">相关性阈值</span>
            <span class="slider-value">{{ ui.relevanceThreshold.toFixed(2) }}</span>
          </div>
          <input class="slider-input" type="range" min="0" max="1" step="0.01" v-model.number="ui.relevanceThreshold" />
          <div class="slider-ticks"><span>0%</span><span>50%</span><span>100%</span></div>

          <div class="slider-row">
            <span class="slider-label">透明度调节</span>
            <span class="slider-value">{{ ui.opacityScale.toFixed(2) }}</span>
          </div>
          <input class="slider-input" type="range" min="0" max="1" step="0.01" v-model.number="ui.opacityScale" />
          <div class="slider-ticks"><span>0%</span><span>50%</span><span>100%</span></div>
        </section>

        <!-- 4. 尺度与重心 -->
        <section class="panel-card">
          <div class="card-head">
            <span class="card-index">4</span>
            <span class="card-title">尺度与重心</span>
          </div>
          <div class="lod-row">
            <span class="lod-key">当前尺度</span>
            <span class="lod-val">{{ lodLabel }}</span>
          </div>
          <div class="lod-row">
            <span class="lod-key">当前尺度档位</span>
            <span class="lod-val accent">Level {{ Math.round(narrative.viewport.zoom) }}</span>
          </div>
          <div class="lod-bar">
            <span>近景（深挖）</span>
            <div class="lod-track"><div class="lod-knob" :style="{ left: lodKnobLeft }" /></div>
            <span>远景（多讲）</span>
          </div>
          <div class="centroid-row">
            <span class="centroid-key">重心策略</span>
          </div>
          <div class="centroid-tabs">
            <button
              v-for="o in centroidStrategyOptions"
              :key="o.key"
              :class="['centroid-tab', { active: ui.centroidStrategy === o.key }]"
              @click="ui.centroidStrategy = o.key"
            >{{ o.label }}</button>
          </div>
          <div class="centroid-hint">
            当前视角中{{ activeRegion.display_name }}占比{{ Math.round(narrative.dominant_coverage * 100) }}%，系统将以其为重心，优先讲解核心内容，适当扩展周边。
          </div>
        </section>
      </aside>

      <!-- 中央地图区（2.5D 卫星影像视角） -->
      <main class="map-stage">
        <!-- 透视场：rotateX 让底图看起来是航拍倾斜的 -->
        <div class="map-perspective-deck">
          <div ref="mapContainerEl" class="map-canvas" :class="`mode-${baseLayerMode}`" />
        </div>
        <!-- 远端地平线渐变遮罩，让倾斜后的远端柔和过渡 -->
        <div class="map-horizon-mask" aria-hidden="true" />
        <!-- 视图边缘 vignette，加强中心聚焦 -->
        <div class="map-vignette" aria-hidden="true" />

        <!-- 当前视角覆盖分析（左上叠加，可折叠） -->
        <div class="coverage-card" :class="{ collapsed: coverageCollapsed }">
          <div class="coverage-head" @click="coverageCollapsed = !coverageCollapsed">
            <span>当前视角覆盖分析</span>
            <div class="coverage-head-actions">
              <span class="card-help" @click.stop>?</span>
              <button
                type="button"
                class="coverage-toggle"
                :title="coverageCollapsed ? '展开' : '折叠'"
                :aria-expanded="!coverageCollapsed"
                @click.stop="coverageCollapsed = !coverageCollapsed"
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

        <!-- 右上地图操作组 -->
        <div class="map-controls">
          <button class="map-ctl" title="指南针"><span v-html="ICONS.compass" /></button>
          <div class="zoom-stack">
            <button class="map-ctl" @click="zoomIn">+</button>
            <button class="map-ctl" @click="zoomOut">−</button>
          </div>
          <button class="map-ctl active" title="3D">3D</button>
          <button class="map-ctl" title="跟随"><span v-html="ICONS.locate" /></button>
          <!-- 图层切换：矢量路网 ↔ 卫星影像（互斥，不叠加） -->
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

        <!-- 比例尺 -->
        <div class="map-scale">500 m</div>

        <!-- AI 助手触发 fab：仅负责在 canvas 右下角打开抽屉 -->
        <button
          v-show="!assistantOpen"
          class="assistant-fab"
          type="button"
          title="AI 助手（Alt+A）"
          @click="assistantOpen = true"
        >
          <span class="fab-letters">AI</span>
        </button>
      </main>

      <!-- 右面板 -->
      <aside class="right-panel">
        <!-- 3. 智能解说 -->
        <section class="panel-card">
          <div class="card-head">
            <span class="card-index">3</span>
            <span class="card-title">智能解说</span>
            <label class="auto-toggle">
              <span>自动解说</span>
              <input type="checkbox" v-model="ui.autoNarrate" />
              <span class="toggle-knob" :class="{ on: ui.autoNarrate }" />
            </label>
          </div>

          <div class="theme-row">
            <span class="theme-label">当前解说主题</span>
            <strong class="theme-text">「以{{ activeRegion.display_name }}为核心的文化教育圈」</strong>
          </div>

          <!-- 波形 -->
          <div class="waveform">
            <span
              v-for="(h, i) in waveformHeights"
              :key="i"
              class="wave-bar"
              :class="{ active: i <= waveActive }"
              :style="{ height: `${h}%` }"
            />
          </div>

          <div class="narration-text">
            <p>{{ typedText }}<span class="cursor" v-if="typing">▏</span></p>
          </div>

          <div class="seq-block">
            <div class="seq-head">
              <span class="seq-title">解说顺序</span>
            </div>
            <ul class="seq-list">
              <li
                v-for="(node, i) in displayPathNodes"
                :key="node.region_id"
                :class="['seq-item', { active: i === activeStepIndex }]"
                @click="goToStep(i)"
              >
                <span class="seq-no">{{ i + 1 }}</span>
                <span class="seq-name">{{ regionMap[node.region_id]?.display_name }}{{ i === 0 ? '（核心）' : '' }}</span>
                <span class="seq-tag" :class="`tag-${node.narration_role}`">{{ node.chapter_label }}</span>
              </li>
            </ul>
            <p class="seq-foot">基于当前真实视野生成</p>
          </div>

          <div class="settings-block">
            <div class="settings-title">解说设置</div>
            <div class="settings-row">解说时长</div>
            <div class="duration-tabs">
              <button
                v-for="o in durationPresetOptions"
                :key="o.key"
                :class="['duration-tab', { active: ui.durationPreset === o.key }]"
                @click="ui.durationPreset = o.key"
              >
                <strong>{{ o.label }}</strong>
                <span>{{ o.hint }}</span>
              </button>
            </div>

            <div class="settings-row">解说风格</div>
            <div class="style-row">
              <select class="select-input" v-model="ui.tonePreset">
                <option v-for="o in tonePresetOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
              </select>
              <button class="ghost-btn" @click="restartNarration"><span v-html="ICONS.dice" /><span>重新播放</span></button>
            </div>

            <button class="primary-btn play-btn" :disabled="!canNarrate" @click="togglePlay">
              {{ analysisStatus === 'analyzing' ? '分析中，请稍候' : playing ? '暂停解说' : '开始解说' }}
              <span v-html="playing ? ICONS.pause : ICONS.play" />
            </button>
          </div>
        </section>

        <!-- 上下文感知 -->
        <section class="panel-card">
          <div class="card-head">
            <span class="card-title">上下文感知</span>
          </div>
          <ul class="ctx-list">
            <li><span class="ctx-key">时间</span><span>{{ narrative.user_context.time_label }}</span></li>
            <li><span class="ctx-key">天气</span><span>{{ narrative.user_context.weather_label }}</span></li>
            <li><span class="ctx-key">兴趣偏好</span><span>{{ narrative.user_context.preference_label }}</span></li>
            <li><span class="ctx-key">历史轨迹</span><span>{{ narrative.user_context.history_label }}</span></li>
          </ul>
          <div class="ctx-hint">
            <span class="ctx-bullet" />
            已结合当前上下文生成解说，每次生成结果可能不同。
          </div>
        </section>
      </aside>

      <!-- AI 助手抽屉：跨 center + right 两列，高度 = canvas 高，宽度 = canvas + 右面板宽
           §7.4 / §8.4 契约：组件只读 narrative state，副作用通过 emit 回传 -->
      <AssistantDock
        v-if="assistantOpen"
        :active-step-index="activeStepIndex"
        :playing="playing"
        :total-steps="displayPathNodes.length"
        :chapters="chaptersForAssistant"
        @close="assistantOpen = false"
        @pause-request="onAssistantPause"
        @resume-request="onAssistantResume"
        @jump-to-step="goToStep"
        @fly-to-region="flyToRegionById"
      />

      <!-- 底部时间线（仅占中央列宽度，左右面板可延伸到屏幕底部） -->
      <footer class="bottom-bar">
      <div class="timeline-wrap">
        <button class="tl-arrow" @click="goPrev"><span v-html="ICONS.chevronLeft" /></button>
        <ul ref="timelineEl" class="timeline" @wheel.prevent="onTimelineWheel">
          <li
            v-for="(node, i) in displayPathNodes"
            :key="`tl-${node.region_id}`"
            :class="['tl-card', { active: i === activeStepIndex }]"
            @click="goToStep(i)"
          >
            <div class="tl-thumb" :style="{ background: regionGradient(i) }">
              <span
                v-for="dot in timelineDotsByRegion[node.region_id] ?? []"
                :key="dot.key"
                class="tl-dot"
                :class="`tier-${dot.tier}`"
                :style="{ left: `${dot.x}%`, top: `${dot.y}%` }"
              />
              <span v-if="timelineDotsByRegion[node.region_id]?.length" class="tl-cluster">
                {{ timelineDotsByRegion[node.region_id].length }}
              </span>
              <span class="tl-no">{{ i + 1 }}</span>
              <span class="tl-tag-mini">{{ node.chapter_label }}</span>
            </div>
            <div class="tl-name">{{ i + 1 }} {{ regionMap[node.region_id]?.display_name }}</div>
            <div class="tl-sub">{{ subtitleForRole(node.narration_role) }}</div>
          </li>
        </ul>
        <button class="tl-arrow" @click="goNext"><span v-html="ICONS.chevronRight" /></button>
      </div>

      <div class="bottom-progress">
        <div class="player-controls">
          <button class="player-btn" @click="rewind"><span v-html="ICONS.rewind" /></button>
          <button class="player-btn" @click="goPrev"><span v-html="ICONS.skipBack" /></button>
          <button class="player-btn primary" @click="togglePlay"><span v-html="playing ? ICONS.pause : ICONS.play" /></button>
          <button class="player-btn" @click="goNext"><span v-html="ICONS.skipForward" /></button>
          <button class="player-btn" @click="forward"><span v-html="ICONS.forward" /></button>
        </div>
        <div class="progress-row">
          <div class="progress-track" @click="onSeek">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
            <div class="progress-knob" :style="{ left: progressPercent + '%' }" />
          </div>
          <span class="progress-time">{{ formatTime(elapsedMs) }} / {{ formatTime(totalDurationMs) }}</span>
          <span class="progress-rate">1.0x</span>
        </div>
      </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import VectorLayer from 'ol/layer/Vector'
import HeatmapLayer from 'ol/layer/Heatmap'
import VectorSource from 'ol/source/Vector'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style'

import AssistantDock from './narrative/AssistantDock.vue'
import { useProjection } from '../composables/map/useProjection'
import { fetchNarrativeResponse } from './narrative/narrativeApi'
import { adaptNarrativeResponse } from './narrative/narrativeResponseAdapter'
import type {
  NarrativeMode as ChatMode,
  NarrativeResponse,
  NarrativePoi,
  NarrativeRegion,
  NarrativeUiSettings,
  ViewportBBox,
  PathNarrationRole,
  VisualTier
} from './narrative/types'

const INITIAL_VIEWPORT: ViewportBBox = {
  west: 114.278,
  south: 30.548,
  east: 114.386,
  north: 30.619,
  zoom: 13.2,
  center: [114.335, 30.583]
}

const EMPTY_ACTIVE_REGION: NarrativeRegion = {
  id: 'current-viewport',
  display_name: '当前视野',
  role: 'scene_evidence',
  core_anchor: { id: 'current-viewport-center', lon: INITIAL_VIEWPORT.center[0], lat: INITIAL_VIEWPORT.center[1] },
  boundary: { type: 'Polygon', coordinates: [[]] },
  visual_layer: { mode: 'poi_heat', poi_heat: { radius: 24, points: [] } },
  pois: [],
  narrative_facts: []
}

const EMPTY_NARRATIVE_RESPONSE: NarrativeResponse = {
  session_id: '',
  state_version: 0,
  scene_profile: 'mixed_urban',
  lod: 'meso',
  viewport: INITIAL_VIEWPORT,
  dominant_coverage: 0,
  candidate_count: 0,
  poi_density: 0,
  semantic_diversity: 0,
  regions: [],
  path: { nodes: [], seed: '', alternatives_count: 0 },
  narration: { chapters: [], tone: 'science' },
  user_context: {
    time_label: '当前时段',
    weather_label: '未指定',
    preference_label: '通用解说',
    history_label: '首次进入'
  }
}

const defaultUiSettings: NarrativeUiSettings = {
  relevanceThreshold: 0.25,
  opacityScale: 0.35,
  durationPreset: 'standard',
  tonePreset: 'science',
  centroidStrategy: 'auto',
  autoNarrate: true
}

const durationPresetOptions = [
  { key: 'casual' as const, label: '随兴', hint: '约 1 分钟' },
  { key: 'standard' as const, label: '标准', hint: '约 3 分钟' },
  { key: 'detailed' as const, label: '详尽', hint: '约 5 分钟' }
]

const tonePresetOptions = [
  { key: 'science' as const, label: '知识科普' },
  { key: 'tour' as const, label: '导览解说' },
  { key: 'humanity' as const, label: '人文叙事' }
]

const centroidStrategyOptions = [
  { key: 'auto' as const, label: '自动' },
  { key: 'region_first' as const, label: '片区优先' },
  { key: 'poi_first' as const, label: 'POI 优先' }
]

// ============================================================================
// 模式 + 状态
// ============================================================================
const narrative = ref<NarrativeResponse>(EMPTY_NARRATIVE_RESPONSE)
const analysisStatus = ref<'preset' | 'analyzing' | 'ready' | 'error'>('preset')
const analysisError = ref('')
const canNarrate = computed(() => analysisStatus.value !== 'analyzing')
const narrativeSourceLabel = computed(() => {
  if (analysisStatus.value === 'analyzing') return '正在分析'
  if (analysisStatus.value === 'ready') return '后端实时'
  if (analysisStatus.value === 'error') return '分析失败'
  return '等待分析'
})
const { gcj02ToWgs84 } = useProjection()
const displayModel = computed(() => adaptNarrativeResponse(narrative.value))
const displayPathNodes = computed(() => displayModel.value.pathNodes)
const displayChapters = computed(() => displayModel.value.chapters)
const displayRegions = computed(() => displayModel.value.regions)
const displayAllRenderablePois = computed(() => displayModel.value.allRenderablePois)
const tierStats = computed(() => displayModel.value.tierStats)
const ui = reactive<NarrativeUiSettings>({ ...defaultUiSettings })
const mode = ref<ChatMode>('explore')

// 左上「当前视角覆盖分析」卡片的折叠状态（局部 UI state，不进 NarrativeUiSettings 契约）
const coverageCollapsed = ref<boolean>(true)

const modes: Array<{ key: ChatMode; label: string; icon: string }> = [
  { key: 'explore', label: '探索模式', icon: ICON_COMPASS() },
  { key: 'narrate', label: '解说模式', icon: ICON_HEADPHONE() },
  { key: 'compare', label: '对比模式', icon: ICON_COMPARE() }
]

const regionMap = computed(() => displayModel.value.regionMap)

const activeStepIndex = ref(0)
const activeRegion = computed(() => {
  const node = displayPathNodes.value[activeStepIndex.value]
  return regionMap.value[node?.region_id ?? displayRegions.value[0]?.id] ?? displayRegions.value[0] ?? narrative.value.regions[0] ?? EMPTY_ACTIVE_REGION
})

// 时间线 DOM 引用：箭头切换 / 卡片点击 / 解说推进时，自动把激活卡片滚动到容器水平中央
const timelineEl = ref<HTMLUListElement | null>(null)
let timelineSnapTimer: ReturnType<typeof setTimeout> | null = null
function scrollTimelineToActive() {
  const container = timelineEl.value
  if (!container) return
  const cards = container.querySelectorAll<HTMLElement>('.tl-card')
  const card = cards[activeStepIndex.value]
  if (!card) return
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth)
  const targetLeft = card.offsetLeft - (container.clientWidth - card.clientWidth) / 2
  container.scrollTo({ left: Math.min(maxLeft, Math.max(0, targetLeft)), behavior: 'smooth' })
}
function syncStepToNearestTimelineCard() {
  const container = timelineEl.value
  if (!container) return
  const cards = [...container.querySelectorAll<HTMLElement>('.tl-card')]
  if (cards.length === 0) return
  const center = container.scrollLeft + container.clientWidth / 2
  let nearestIndex = 0
  let nearestDistance = Infinity
  for (const [index, card] of cards.entries()) {
    const cardCenter = card.offsetLeft + card.clientWidth / 2
    const distance = Math.abs(cardCenter - center)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }
  if (nearestIndex !== activeStepIndex.value) {
    applyStep(nearestIndex)
  } else {
    scrollTimelineToActive()
  }
}
function onTimelineWheel(e: WheelEvent) {
  const container = timelineEl.value
  if (!container) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  container.scrollBy({ left: delta, behavior: 'auto' })
  if (timelineSnapTimer) clearTimeout(timelineSnapTimer)
  timelineSnapTimer = setTimeout(syncStepToNearestTimelineCard, 140)
}
watch(activeStepIndex, () => {
  // DOM 更新（active class 切换）之后再算偏移量
  nextTick(scrollTimelineToActive)
})
watch(() => displayPathNodes.value.length, (length) => {
  if (length === 0) return
  if (activeStepIndex.value >= length) activeStepIndex.value = length - 1
  nextTick(scrollTimelineToActive)
})

// ============================================================================
// AI 助手所需的上下文（仅前端展示用 props，不进 §8 主契约）
// 阶段 3 接后端 /api/narrative/assistant 时，这部分由 server-side state 覆盖
// ============================================================================
const chaptersForAssistant = computed(() =>
  displayPathNodes.value.map((node, i) => ({
    region_id: node.region_id,
    display_name: regionMap.value[node.region_id]?.display_name ?? node.region_id,
    played: i < activeStepIndex.value
  }))
)

function onAssistantPause() {
  if (playing.value) togglePlay()
}
function onAssistantResume() {
  if (!playing.value) togglePlay()
}
function flyToRegionById(regionId: string) {
  if (!olMap) return
  const r = regionMap.value[regionId]
  if (!r) return
  olMap.getView().animate({
    center: fromLonLat([r.core_anchor.lon, r.core_anchor.lat]),
    zoom: 15.5,
    duration: 900
  })
}

// AI 助手抽屉开关（fab 在 .map-stage 内 / 抽屉跨 center + right）
const assistantOpen = ref<boolean>(false)
function onAssistantKeydown(e: KeyboardEvent) {
  if (e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    assistantOpen.value = !assistantOpen.value
  }
}
window.addEventListener('keydown', onAssistantKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onAssistantKeydown))

const totalPoi = computed(() => displayAllRenderablePois.value.length)
const activeRegionAreaText = computed(() => `${(8.62).toFixed(2)} km²`)

const lodLabel = computed(() => {
  switch (narrative.value.lod) {
    case 'micro':
      return '近景（深挖）'
    case 'meso':
      return '中景（横向）'
    case 'macro':
      return '远景（合并）'
  }
})

const lodKnobLeft = computed(() => {
  if (narrative.value.lod === 'micro') return '15%'
  if (narrative.value.lod === 'meso') return '50%'
  return '85%'
})

// ============================================================================
// 覆盖环形图：dasharray 计算
// ============================================================================
const CIRC = 2 * Math.PI * 46
const coverageBreakdown = computed(() => {
  const coreRatio = Math.max(0, Math.min(1, narrative.value.dominant_coverage || 0))
  const surroundingRatio = Math.max(0, Math.min(1 - coreRatio, (displayRegions.value.length - 1) * 0.08))
  return {
    core_ratio: coreRatio,
    surrounding_ratio: surroundingRatio,
    others_ratio: Math.max(0, 1 - coreRatio - surroundingRatio)
  }
})
const donutDash = computed(() => ({
  core: coverageBreakdown.value.core_ratio * CIRC,
  surround: coverageBreakdown.value.surrounding_ratio * CIRC,
  others: coverageBreakdown.value.others_ratio * CIRC
}))
const donutOffsets = computed(() => ({
  core: 0,
  surround: -coverageBreakdown.value.core_ratio * CIRC,
  others: -(coverageBreakdown.value.core_ratio + coverageBreakdown.value.surrounding_ratio) * CIRC
}))

// ============================================================================
// 左面板：分层图例（label 不暴露 role 英文）
// ============================================================================
const tierLegend: Array<{ key: VisualTier; label: string; color: string }> = [
  { key: 'core', label: '核心区域（高相关）', color: '#ef4444' },
  { key: 'strong', label: '较强相关', color: '#f97316' },
  { key: 'medium', label: '一般相关', color: '#eab308' },
  { key: 'weak', label: '低相关（边缘）', color: '#3b82f6' },
  { key: 'excluded', label: '已剔除', color: '#475569' }
]

interface TimelineDot {
  key: string
  x: number
  y: number
  tier: VisualTier
}

function timelinePoiSource(region: NarrativeRegion): NarrativePoi[] {
  if (region.pois.length > 0) return region.pois
  return (region.visual_layer.poi_heat?.points ?? []).map((point, index) => ({
    id: `timeline-heat-${region.id}-${index}`,
    lon: point.lon,
    lat: point.lat,
    display_name: region.display_name,
    tier: point.tier,
    role: region.role,
    category_main: region.display_name
  }))
}

function buildTimelineDots(region: NarrativeRegion): TimelineDot[] {
  const pois = timelinePoiSource(region).filter((poi) => poi.tier !== 'excluded')
  const ring = region.boundary.coordinates[0] ?? []
  const lons = [...ring.map((point) => point[0]), ...pois.map((poi) => poi.lon)].filter(Number.isFinite)
  const lats = [...ring.map((point) => point[1]), ...pois.map((poi) => poi.lat)].filter(Number.isFinite)
  const west = Math.min(...lons, region.core_anchor.lon)
  const east = Math.max(...lons, region.core_anchor.lon)
  const south = Math.min(...lats, region.core_anchor.lat)
  const north = Math.max(...lats, region.core_anchor.lat)
  const width = Math.max(east - west, 0.000001)
  const height = Math.max(north - south, 0.000001)
  return pois.slice(0, 18).map((poi) => ({
    key: poi.id,
    x: Math.max(8, Math.min(92, 10 + ((poi.lon - west) / width) * 80)),
    y: Math.max(10, Math.min(90, 10 + ((north - poi.lat) / height) * 80)),
    tier: poi.tier
  }))
}

const timelineDotsByRegion = computed<Record<string, TimelineDot[]>>(() =>
  Object.fromEntries(displayRegions.value.map((region) => [region.id, buildTimelineDots(region)]))
)

// ============================================================================
// 解说时间线 / 打字机 / 自动播放
// ============================================================================
const playing = ref(false)
const typing = ref(false)
const typedText = ref('')

const elapsedMs = ref(0)
const stepStartElapsedMs = ref(0)
let typingTimer: ReturnType<typeof setInterval> | null = null
let advanceTimer: ReturnType<typeof setTimeout> | null = null
let progressTimer: ReturnType<typeof setInterval> | null = null

const totalDurationMs = computed(() =>
  displayChapters.value.reduce((acc, c) => acc + (c.length_ms ?? 8000), 0)
)

const progressPercent = computed(() => {
  if (totalDurationMs.value <= 0) return 0
  return Math.min(100, (elapsedMs.value / totalDurationMs.value) * 100)
})

const waveformHeights = Array.from({ length: 32 }, (_, i) =>
  30 + Math.round(Math.abs(Math.sin(i * 0.7)) * 60 + Math.cos(i * 1.3) * 12)
)
const waveActive = ref(0)

function startTyping() {
  stopTyping()
  const chapter = displayChapters.value[activeStepIndex.value]
  if (!chapter) return
  typedText.value = ''
  typing.value = true
  let idx = 0
  const text = chapter.text
  typingTimer = setInterval(() => {
    if (idx >= text.length) {
      stopTyping()
      typing.value = false
      return
    }
    typedText.value += text[idx]
    idx += 1
    waveActive.value = Math.floor((idx / text.length) * waveformHeights.length)
  }, 60)
}

function stopTyping() {
  if (typingTimer) {
    clearInterval(typingTimer)
    typingTimer = null
  }
}

function clearAdvanceTimer() {
  if (advanceTimer) {
    clearTimeout(advanceTimer)
    advanceTimer = null
  }
}

function startProgress() {
  stopProgress()
  progressTimer = setInterval(() => {
    if (!playing.value) return
    elapsedMs.value += 100
    const total = totalDurationMs.value
    if (elapsedMs.value >= total) {
      elapsedMs.value = total
      stopAll()
    }
  }, 100)
}

function stopProgress() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

function applyStep(index: number, options: { fly?: boolean } = {}) {
  activeStepIndex.value = index
  // 累计上一步的耗时基线
  let acc = 0
  for (let i = 0; i < index; i++) {
    acc += displayChapters.value[i]?.length_ms ?? 8000
  }
  stepStartElapsedMs.value = acc
  elapsedMs.value = acc
  if (options.fly !== false) flyToActiveRegion()
  startTyping()
  if (playing.value && ui.autoNarrate) {
    const ms = displayChapters.value[index]?.length_ms ?? 8000
    clearAdvanceTimer()
    advanceTimer = setTimeout(() => {
      if (index < displayPathNodes.value.length - 1) {
        applyStep(index + 1)
      } else {
        stopAll()
      }
    }, ms)
  }
}

function togglePlay() {
  if (playing.value) {
    playing.value = false
    stopTyping()
    typing.value = false
    clearAdvanceTimer()
    return
  }
  playing.value = true
  applyStep(activeStepIndex.value)
  startProgress()
}

function stopAll() {
  playing.value = false
  stopTyping()
  typing.value = false
  clearAdvanceTimer()
  stopProgress()
}

function goToStep(i: number) {
  if (i < 0 || i >= displayPathNodes.value.length) return
  applyStep(i)
}

function goPrev() {
  goToStep(Math.max(0, activeStepIndex.value - 1))
}

function goNext() {
  goToStep(Math.min(displayPathNodes.value.length - 1, activeStepIndex.value + 1))
}

function rewind() {
  elapsedMs.value = Math.max(0, elapsedMs.value - 5000)
}

function forward() {
  elapsedMs.value = Math.min(totalDurationMs.value, elapsedMs.value + 5000)
}

function onSeek(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  elapsedMs.value = ratio * totalDurationMs.value
  // 找到对应章节
  let acc = 0
  for (let i = 0; i < displayChapters.value.length; i++) {
    acc += displayChapters.value[i].length_ms ?? 8000
    if (elapsedMs.value < acc) {
      goToStep(i)
      return
    }
  }
  goToStep(displayPathNodes.value.length - 1)
}

function restartNarration() {
  stopAll()
  activeStepIndex.value = 0
  applyStep(0)
}

function regionGradient(i: number): string {
  const palette = [
    'linear-gradient(135deg,#ef4444,#b91c1c)',
    'linear-gradient(135deg,#0ea5e9,#0c4a6e)',
    'linear-gradient(135deg,#a855f7,#581c87)',
    'linear-gradient(135deg,#f59e0b,#92400e)',
    'linear-gradient(135deg,#10b981,#065f46)'
  ]
  return palette[i % palette.length]
}

const ROLE_SUBTITLE: Record<PathNarrationRole, string> = {
  core: '核心解说点',
  related: '关联区域',
  cultural: '历史文化区',
  landmark: '城市地标',
  educational: '百年学府',
  ecological: '自然休闲空间'
}
function subtitleForRole(role: PathNarrationRole): string {
  return ROLE_SUBTITLE[role] ?? ''
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ============================================================================
// OpenLayers 地图：底图 + 片区密度热力雾 + POI Cluster + 片区标签层
// 设计原则：
//   1. 每个片区一个独立 HeatmapLayer，gradient 单一色相，多层叠加时
//      在重叠区出现色相对抗，让用户辨认相邻片区边界（如橙 vs 黄）。
//   2. POI 走 Cluster source：低 zoom 多点融合成大圆+数量，高 zoom 自然散开。
//   3. 不再画死循环的椭圆环；`visual_layer.region_glow.color` 仅作为色相来源。
// ============================================================================

const mapContainerEl = ref<HTMLDivElement | null>(null)
let olMap: OlMap | null = null
let baseLayer: TileLayer<XYZ> | null = null
// 每个片区一个独立 heatmap source / layer：色相对抗
const regionHeatSources: Record<string, VectorSource> = {}
const regionHeatLayers: HeatmapLayer[] = []
// POI 散点层（按 tier 颜色直接渲染，不聚合）
let poiBaseSource: VectorSource | null = null
let poiLayer: VectorLayer | null = null
let labelLayer: VectorLayer | null = null

// 片区色相统一来自后端 visual_layer.region_glow.color
const regionPalette = computed<Record<string, string>>(() =>
  Object.fromEntries(displayRegions.value.map((r) => [r.id, r.visual_layer.region_glow?.color ?? '#3b82f6']))
)
const DEFAULT_REGION_COLOR = '#3b82f6'

// tier → heatmap 权重：核心点贡献最大热值，边缘点几乎不贡献
const TIER_HEAT_WEIGHT: Record<VisualTier, number> = {
  core: 1.0,
  strong: 0.7,
  medium: 0.4,
  weak: 0,
  excluded: 0
}

// 按最近 anchor 把 POI 分配到片区，结果缓存
const poiRegionCache = new Map<string, string>()
function nearestRegionId(lon: number, lat: number): string {
  let best = ''
  let bestD2 = Infinity
  for (const r of displayRegions.value) {
    const dx = lon - r.core_anchor.lon
    const dy = lat - r.core_anchor.lat
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) {
      bestD2 = d2
      best = r.id
    }
  }
  return best
}
function regionIdForPoi(id: string, lon: number, lat: number): string {
  const cached = poiRegionCache.get(id)
  if (cached) return cached
  const rid = nearestRegionId(lon, lat)
  poiRegionCache.set(id, rid)
  return rid
}

/**
 * 片区色相分配（地理相邻片区色相靠近但不同，在热力雾交叠时能看出边界）：
 * - 昙华林（西南）橙 ↔ 黄鹤楼（与昙华林相邻）黄【用户明确点名的对抗】
 * - 湖北大学（北）红 ↔ 沙湖公园（与 HBU 相邻）青绿
 * - 武汉大学（东南独立）紫
 */
/**
 * 底图源：矢量路网 vs 卫星影像。两者互斥，不叠加。
 * 通过右上角图层按钮切换。
 */
const BASE_TILE_URL: Record<'vector' | 'satellite', string> = {
  vector: 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  satellite: 'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'
}
const baseLayerMode = ref<'vector' | 'satellite'>('satellite')

function toggleBaseLayer() {
  if (!baseLayer) return
  baseLayerMode.value = baseLayerMode.value === 'vector' ? 'satellite' : 'vector'
  baseLayer.setSource(new XYZ({
    url: BASE_TILE_URL[baseLayerMode.value],
    crossOrigin: 'anonymous'
  }))
}

function styleForTier(tier: VisualTier, opacityScale: number): Style | null {
  if (tier === 'excluded') return null
  const palette: Record<Exclude<VisualTier, 'excluded'>, { fill: string; stroke: string; r: number; alpha: number }> = {
    core: { fill: '#ef4444', stroke: '#fff', r: 7, alpha: 1 },
    strong: { fill: '#f97316', stroke: 'rgba(255,255,255,0.85)', r: 5, alpha: 0.95 },
    medium: { fill: '#eab308', stroke: 'rgba(255,255,255,0.55)', r: 4, alpha: 0.7 },
    weak: { fill: '#3b82f6', stroke: 'rgba(255,255,255,0.25)', r: 3, alpha: 0.4 }
  }
  const cfg = palette[tier]
  const alpha = Math.max(0, Math.min(1, cfg.alpha * (0.55 + 0.9 * opacityScale)))
  const fillRgba = hexToRgba(cfg.fill, alpha)
  return new Style({
    image: new CircleStyle({
      radius: cfg.r,
      fill: new Fill({ color: fillRgba }),
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

  const threshold = ui.relevanceThreshold
  // 阈值映射：高于阈值才显示对应 tier
  // weak >= 0.0 / medium >= 0.25 / strong >= 0.55 / core 永远显示
  const tierMin: Record<VisualTier, number> = {
    excluded: 99,
    weak: 0,
    medium: 0.25,
    strong: 0.55,
    core: 0
  }
  for (const p of displayAllRenderablePois.value) {
    if (p.tier === 'excluded') continue
    if (threshold > tierMin[p.tier]) continue

    const rid = regionIdForPoi(p.id, p.lon, p.lat)
    const coord = fromLonLat([p.lon, p.lat])

    // 1. 散点：直接按 tier 颜色渲染
    const f = new Feature({ geometry: new Point(coord) })
    const st = styleForTier(p.tier, ui.opacityScale)
    if (st) {
      f.setStyle(st)
      f.set('tier', p.tier)
      f.set('name', p.display_name)
      poiBaseSource.addFeature(f)
    }

    // 2. 片区 heat source：用于密度雾
    const heatSrc = regionHeatSources[rid]
    const heatWeight = TIER_HEAT_WEIGHT[p.tier]
    if (heatSrc && heatWeight > 0) {
      const hf = new Feature({ geometry: new Point(coord) })
      hf.set('weight', heatWeight)
      heatSrc.addFeature(hf)
    }
  }
  for (const region of displayRegions.value) {
    const heatSrc = regionHeatSources[region.id]
    if (!heatSrc || heatSrc.getFeatures().length > 0) continue
    for (const point of region.visual_layer.poi_heat?.points ?? []) {
      const isWeakFallback = point.tier === 'weak'
      if (!isWeakFallback && threshold > tierMin[point.tier]) continue
      const heatWeight = isWeakFallback ? 0.14 : TIER_HEAT_WEIGHT[point.tier]
      if (heatWeight <= 0) continue
      const hf = new Feature({ geometry: new Point(fromLonLat([point.lon, point.lat])) })
      hf.set('weight', heatWeight)
      heatSrc.addFeature(hf)
    }
  }
}

// 根据当前 zoom 同步密度雾半径：远景大融合，近景小拆解
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
  for (const region of displayRegions.value) {
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

function clearRegionHeatLayers() {
  if (!olMap) return
  for (const layer of regionHeatLayers) olMap.removeLayer(layer)
  regionHeatLayers.splice(0, regionHeatLayers.length)
  for (const key of Object.keys(regionHeatSources)) delete regionHeatSources[key]
}

function rebuildRegionHeatLayers() {
  if (!olMap || !poiLayer || !labelLayer) return
  clearRegionHeatLayers()
  for (const region of displayRegions.value) {
    const src = new VectorSource()
    regionHeatSources[region.id] = src
    const color = regionPalette.value[region.id] ?? DEFAULT_REGION_COLOR
    const hl = new HeatmapLayer({
      source: src,
      weight: (f) => (f.get('weight') as number) ?? 0.2,
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
  olMap.addLayer(poiLayer)
  olMap.addLayer(labelLayer)
}

function refreshMapLayersAfterNarrativeChange() {
  poiRegionCache.clear()
  rebuildRegionHeatLayers()
  rebuildPoiLayer()
  rebuildLabelLayer()
  syncHeatmapRadius()
}

function flyToActiveRegion() {
  if (!olMap) return
  const r = activeRegion.value
  const view = olMap.getView()
  view.animate({
    center: fromLonLat([r.core_anchor.lon, r.core_anchor.lat]),
    zoom: 15.5,
    duration: 900
  })
}

function zoomIn() {
  if (!olMap) return
  const v = olMap.getView()
  v.animate({ zoom: (v.getZoom() ?? 14) + 1, duration: 240 })
}

function zoomOut() {
  if (!olMap) return
  const v = olMap.getView()
  v.animate({ zoom: (v.getZoom() ?? 14) - 1, duration: 240 })
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
  const displayCenter = toLonLat(view.getCenter() ?? fromLonLat(narrative.value.viewport.center)) as [number, number]
  const center = gcj02ToWgs84(displayCenter[0], displayCenter[1])
  return {
    west,
    south,
    east,
    north,
    zoom: view.getZoom() ?? narrative.value.viewport.zoom,
    center
  }
}

async function analyzeCurrentViewport() {
  const viewport = getCurrentMapViewport()
  if (!viewport || analysisStatus.value === 'analyzing') return
  analysisStatus.value = 'analyzing'
  analysisError.value = ''
  try {
    const response = await fetchNarrativeResponse({
      session_id: narrative.value.session_id,
      viewport,
      tone: ui.tonePreset,
      user_context: narrative.value.user_context
    })
    stopAll()
    narrative.value = response
    analysisStatus.value = 'ready'
    activeStepIndex.value = 0
    refreshMapLayersAfterNarrativeChange()
    applyStep(0, { fly: false })
  } catch (error) {
    analysisStatus.value = 'error'
    analysisError.value = error instanceof Error ? error.message : '当前视野分析失败'
    if (import.meta.env.DEV) {
      console.warn('[Narrative] 当前视野分析失败', error)
    }
  }
}

function initMap() {
  if (!mapContainerEl.value) return
  // 单一底图：默认卫星影像，可通过右上角「图层」按钮切到矢量路网。
  // 不做叠加，保持画面干净。
  baseLayer = new TileLayer({
    source: new XYZ({
      url: BASE_TILE_URL[baseLayerMode.value],
      crossOrigin: 'anonymous'
    })
  })

  // 1. 每个片区独立 heatmap，gradient 用片区色相
  for (const region of displayRegions.value) {
    const src = new VectorSource()
    regionHeatSources[region.id] = src
    const color = regionPalette.value[region.id] ?? DEFAULT_REGION_COLOR
    const hl = new HeatmapLayer({
      source: src,
      weight: (f) => (f.get('weight') as number) ?? 0.2,
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

  // 2. POI 散点层（按 tier 颜色直接渲染）
  poiBaseSource = new VectorSource()
  poiLayer = new VectorLayer({
    source: poiBaseSource,
    zIndex: 10
  })

  labelLayer = new VectorLayer({ source: new VectorSource(), zIndex: 20, declutter: true })

  // LOD 限制（按规范 §0.2 + 用户约束）：
  // - 最大范围（minZoom 方向）：武汉市行政区划 bbox，视野不能拖出市域之外
  // - 最小范围（maxZoom 方向）：17 级
  //
  // TODO(阶段 3)：接入 docker PostGIS 的 districts 表后，把这个常量换成
  //   SELECT ST_AsGeoJSON(ST_Envelope(geom)) FROM districts WHERE name='武汉市'
  //   的真实结果，由后端通过 NarrativeResponse.admin_boundary 字段下发。
  const WUHAN_CITY_BBOX_4326: [number, number, number, number] = [113.7, 29.9, 115.1, 31.4]
  const adminExtent3857 = transformExtent(WUHAN_CITY_BBOX_4326, 'EPSG:4326', 'EPSG:3857')

  olMap = new OlMap({
    target: mapContainerEl.value,
    layers: [baseLayer, ...regionHeatLayers, poiLayer, labelLayer],
    controls: [],
    view: new View({
      center: fromLonLat(narrative.value.viewport.center),
      zoom: narrative.value.viewport.zoom,
      // minZoom 10：武汉市 bbox 大约 1.4° × 1.5°，zoom 10 时能完整看到全市
      minZoom: 10,
      maxZoom: 17,
      extent: adminExtent3857,
      // 严格限制视野矩形不能拖出武汉市，不仅仅是中心点
      constrainOnlyCenter: false,
      showFullExtent: true
    })
  })

  rebuildPoiLayer()
  rebuildLabelLayer()
  syncHeatmapRadius()

  // zoom 变化时同步热力雾半径，实现 "密度雾随尺度融合 / 拆解" 的效果
  olMap.getView().on('change:resolution', syncHeatmapRadius)
}

watch(() => [ui.relevanceThreshold, ui.opacityScale], () => {
  rebuildPoiLayer()
})

onMounted(() => {
  initMap()
  applyStep(0, { fly: false })
  // 地图渲染后自动触发一次当前视野分析
  nextTick(() => { setTimeout(() => void analyzeCurrentViewport(), 400) })
})

onBeforeUnmount(() => {
  stopAll()
  if (timelineSnapTimer) clearTimeout(timelineSnapTimer)
  if (olMap) {
    olMap.setTarget(undefined)
    olMap = null
  }
})

// ============================================================================
// 内嵌 SVG 图标（避免引入额外图标库）
// ============================================================================
function ICON_COMPASS() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><polygon points="9,9 15,15 13,7"/></svg>`
}
function ICON_HEADPHONE() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 14v-3a9 9 0 1 1 18 0v3"/><rect x="2" y="14" width="5" height="6" rx="1.2"/><rect x="17" y="14" width="5" height="6" rx="1.2"/></svg>`
}
function ICON_COMPARE() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="8" height="14"/><rect x="13" y="5" width="8" height="14"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`
}

const ICONS = {
  share: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.3a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  draw: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17.25V21h3.75L17 10.75 13.25 7 3 17.25z"/><path d="M14.7 5.3l3 3"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  compass: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><polygon points="9,9 15,15 13,7"/></svg>`,
  locate: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 22 8.5 12 15 2 8.5 12 2"/><polyline points="2 15.5 12 22 22 15.5"/></svg>`,
  dice: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="16" cy="16" r="1.4" fill="currentColor"/><circle cx="16" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="16" r="1.4" fill="currentColor"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6 4 20 12 6 20"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`,
  rewind: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="11 19 2 12 11 5"/><polygon points="22 19 13 12 22 5"/></svg>`,
  forward: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="13 5 22 12 13 19"/><polygon points="2 5 11 12 2 19"/></svg>`,
  skipBack: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="19 20 9 12 19 4"/><rect x="5" y="4" width="2" height="16"/></svg>`,
  skipForward: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 4 15 12 5 20"/><rect x="17" y="4" width="2" height="16"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
  chevronUp: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`
}
</script>

<style scoped>
/* ============================================================================
   主题变量
   ============================================================================ */
.narrative-shell {
  /* 扁平化色板：实色阶梯，不用 alpha + blur 制造拟态 */
  --bg-base: #0a0e1a;            /* 整页背景（最深） */
  --bg-deep: #0a0e1a;            /* 旧引用兼容，与 base 同色 */
  --bg-panel: #131927;           /* 主面板：左 / 右 / 底栏 / topbar */
  --bg-card: #1a2236;            /* 嵌套卡片 */
  --bg-elevated: #232c45;        /* hover / active 高亮 */
  --bg-overlay: #131927;         /* 地图上方覆盖控件（实色，与 panel 一致） */

  /* 边框：实色硬边，无柔光 */
  --bd: #2a3348;
  --bd-strong: #3a455e;
  --bd-accent: #3b82f6;

  --txt: #e6eaf6;
  --txt-mute: #8a93b6;
  --txt-faint: #5a6386;
  --primary: #3b82f6;
  --primary-dim: rgba(59, 130, 246, 0.16);  /* 仅用于 hover bg / 弱填充 */
  --core: #ef4444;
  --strong: #f97316;
  --medium: #eab308;
  --weak: #3b82f6;

  position: absolute;
  inset: 0;
  /* 扁平化：整页改为实色，不再用 radial-gradient 模拟深度 */
  background: var(--bg-base);
  color: var(--txt);
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  display: grid;
  grid-template-rows: 56px 1fr;
  overflow: hidden;
  font-size: 13px;
}

/* ============================================================================
   顶部栏
   ============================================================================ */
.topbar {
  display: grid;
  grid-template-columns: 320px 1fr 320px;
  align-items: center;
  padding: 0 18px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--bd);
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark {
  width: 22px; height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
  position: relative;
}
.brand-mark::before {
  content: '';
  position: absolute; inset: 4px;
  border: 1.5px solid rgba(255,255,255,0.85);
  border-radius: 3px;
}
.brand-name { font-size: 15px; font-weight: 600; letter-spacing: 0.5px; }
.brand-tag {
  font-size: 10px; padding: 1px 6px;
  border-radius: 4px;
  background: rgba(59,130,246,0.18);
  color: #7ab0ff;
  border: 1px solid rgba(59,130,246,0.3);
}
.mode-switch {
  display: flex; gap: 8px; justify-self: center;
  background: var(--bg-card);
  padding: 4px; border-radius: 10px;
  border: 1px solid var(--bd);
}
.mode-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px; font-size: 13px;
  background: transparent; border: 0; color: var(--txt-mute);
  border-radius: 7px; cursor: pointer;
  transition: all 0.2s ease;
}
.mode-btn.active {
  background: var(--primary);
  color: #fff;
}
.mode-icon { display: inline-flex; align-items: center; }
.topbar-actions { display: flex; gap: 6px; justify-self: end; }
.action-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 10px; background: transparent; color: var(--txt-mute);
  border: 1px solid transparent; border-radius: 7px; cursor: pointer; font-size: 12px;
}
.action-btn:hover { background: rgba(255,255,255,0.04); color: var(--txt); border-color: var(--bd); }

/* ============================================================================
   主体三栏 + 中央列内嵌底栏
   左右面板纵向跨满 main-grid（顶到底），底栏只占中央列下方
   ============================================================================ */
.main-grid {
  display: grid;
  grid-template-columns: 300px 1fr 320px;
  grid-template-rows: 1fr 168px;
  grid-template-areas:
    "left center right"
    "left bottom right";
  min-height: 0;
  gap: 12px;
  padding: 12px;
}
.left-panel { grid-area: left; }
.right-panel { grid-area: right; }
.map-stage { grid-area: center; }
.bottom-bar { grid-area: bottom; }

.left-panel, .right-panel {
  display: flex; flex-direction: column;
  gap: 12px; min-height: 0; overflow-y: auto; overflow-x: hidden;
  padding-right: 2px;
}
.left-panel::-webkit-scrollbar, .right-panel::-webkit-scrollbar { width: 4px; }
.left-panel::-webkit-scrollbar-thumb, .right-panel::-webkit-scrollbar-thumb { background: rgba(120,140,200,0.2); border-radius: 2px; }

.panel-card {
  background: var(--bg-panel);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 14px;
}

.card-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px;
}
.card-index {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  background: rgba(59,130,246,0.16);
  color: #7ab0ff;
  border: 1px solid rgba(59,130,246,0.35);
  border-radius: 6px;
  font-size: 12px; font-weight: 600;
}
.card-title { font-size: 13.5px; font-weight: 600; flex: 1; }
.card-help {
  width: 16px; height: 16px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  color: var(--txt-mute);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; cursor: help;
}

/* ----- 片区筛选 ----- */
.search-row {
  position: relative; margin-bottom: 12px;
}
.search-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: var(--txt-faint); display: inline-flex;
}
.search-input {
  width: 100%; padding: 8px 10px 8px 30px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 7px; color: var(--txt);
  font-size: 12.5px;
  outline: none;
}
.search-input::placeholder { color: var(--txt-faint); }
.search-input:focus { border-color: var(--primary); }

.select-group { margin-bottom: 12px; }
.select-label {
  display: block; font-size: 12px;
  color: var(--txt-mute); margin-bottom: 6px;
}
.select-input {
  width: 100%;
  padding: 7px 10px;
  background: var(--bg-card);
  color: var(--txt);
  border: 1px solid var(--bd);
  border-radius: 7px;
  font-size: 12.5px;
  outline: none;
  margin-bottom: 6px;
}
.select-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ghost-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 7px 8px;
  background: var(--bg-card);
  color: var(--txt);
  border: 1px solid var(--bd);
  border-radius: 7px;
  font-size: 12px;
  cursor: pointer;
}
.ghost-btn:hover { background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.4); }

.region-info {
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.region-info-title {
  font-size: 11.5px; color: var(--txt-mute); margin-bottom: 6px;
}
.region-info-row {
  display: flex; justify-content: space-between;
  font-size: 12.5px; padding: 3px 0;
}
.region-info-row strong { color: #fff; font-weight: 600; }

.primary-btn {
  width: 100%;
  padding: 9px 12px;
  background: linear-gradient(180deg, #3b82f6, #2563eb);
  color: #fff; border: 0; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.primary-btn:hover { background: #2563eb; }
.primary-btn:disabled {
  cursor: not-allowed;
  opacity: 0.58;
  background: #334155;
}
.analysis-error {
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(248,113,113,0.35);
  background: rgba(127,29,29,0.28);
  color: #fecaca;
  font-size: 12px;
  line-height: 1.45;
}

/* ----- 点剔除与分层 ----- */
.tier-list { list-style: none; padding: 0; margin: 0 0 14px 0; }
.tier-item {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 5px 0;
  font-size: 12.5px;
  color: var(--txt);
}
.tier-dot { width: 9px; height: 9px; border-radius: 50%; }
.tier-label { color: var(--txt-mute); }
.tier-count { color: #fff; font-weight: 600; font-feature-settings: 'tnum'; }

.slider-row {
  display: flex; justify-content: space-between;
  font-size: 12px; color: var(--txt-mute);
  margin: 10px 0 6px;
}
.slider-value { color: #fff; font-weight: 600; font-feature-settings: 'tnum'; }
.slider-input {
  -webkit-appearance: none;
  width: 100%;
  height: 4px;
  background: linear-gradient(90deg, var(--primary), rgba(59,130,246,0.2));
  border-radius: 2px;
  outline: none;
}
.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px;
  border-radius: 50%; background: #fff;
  border: 3px solid var(--primary);
  cursor: pointer;
}
.slider-ticks {
  display: flex; justify-content: space-between;
  font-size: 10.5px; color: var(--txt-faint);
  margin-top: 4px;
}

/* ----- 尺度与重心 ----- */
.lod-row {
  display: flex; justify-content: space-between;
  font-size: 12.5px; padding: 3px 0;
}
.lod-row .lod-key { color: var(--txt-mute); }
.lod-row .lod-val { color: #fff; font-weight: 500; }
.lod-row .lod-val.accent { color: #7ab0ff; }
.lod-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px; align-items: center;
  font-size: 11px; color: var(--txt-mute);
  margin: 10px 0 12px;
}
.lod-track {
  position: relative; height: 4px;
  background: rgba(120,140,200,0.18);
  border-radius: 2px;
}
.lod-knob {
  position: absolute; top: -4px;
  width: 12px; height: 12px;
  background: var(--primary);
  border-radius: 50%;
  transform: translateX(-50%);
}
.centroid-row { font-size: 12px; color: var(--txt-mute); margin: 8px 0 6px; }
.centroid-tabs {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 4px; padding: 3px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 7px;
}
.centroid-tab {
  padding: 6px 8px; background: transparent; color: var(--txt-mute);
  border: 0; border-radius: 5px; cursor: pointer; font-size: 12px;
}
.centroid-tab.active { background: rgba(59,130,246,0.22); color: #fff; }
.centroid-hint {
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(59,130,246,0.10);
  border: 1px solid rgba(59,130,246,0.22);
  border-radius: 8px;
  font-size: 11.5px; color: #b4cdfb;
  line-height: 1.55;
  position: relative;
}
.centroid-hint::before {
  content: 'i'; display: inline-flex;
  align-items: center; justify-content: center;
  width: 14px; height: 14px;
  background: #3b82f6; color: #fff;
  border-radius: 50%; font-style: italic; font-size: 10px;
  margin-right: 6px;
}

/* ============================================================================
   中央地图（2.5D 卫星影像航拍视角）
   ============================================================================ */
.map-stage {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--bd-strong);
  background: #0a0e1c;
  min-height: 0;
  /* 给透视层一个深度场 */
  perspective: 2200px;
  perspective-origin: 50% 60%;
}

/* 透视场：包住真正的 OL canvas，让 rotateX 不影响兄弟控件层 */
.map-perspective-deck {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: auto;
}

/* OL canvas 本体：rotateX 30° 模拟航拍倾斜
   scale 1.18 补偿倾斜后视觉宽度收缩，避免边缘露背景
   transform-origin 偏下，让"前景"留在画面下方、"远景"延伸到上方 */
.map-canvas {
  position: absolute;
  inset: 0;
  transform-origin: 50% 78%;
  transform: rotateX(30deg) scale(1.18) translateZ(0);
  transform-style: preserve-3d;
  will-change: transform;
}

:deep(.ol-viewport) { background: #0a0e1c; }
/* 矢量底图：不加 filter，保持高德矢量原本的亮度和色彩 */
.map-canvas.mode-vector :deep(.ol-viewport) { filter: none; }
/* 卫星底图：略压暗 + 加饱和，让 POI/光晕在卫星纹理上更醒目 */
.map-canvas.mode-satellite :deep(.ol-viewport) {
  filter: saturate(1.08) contrast(1.06) brightness(0.88);
}

/* 远端地平线渐变：从顶部深蓝雾化到中段透明，强化"远处"感 */
.map-horizon-mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  background:
    linear-gradient(
      to bottom,
      rgba(11, 16, 32, 0.92) 0%,
      rgba(11, 16, 32, 0.55) 8%,
      rgba(11, 16, 32, 0.18) 22%,
      rgba(11, 16, 32, 0) 38%,
      rgba(11, 16, 32, 0) 100%
    );
}

/* 边缘晕影：四角微暗，中心通透，强化视觉焦点 */
.map-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  background:
    radial-gradient(
      120% 90% at 50% 65%,
      rgba(0, 0, 0, 0) 50%,
      rgba(0, 0, 0, 0.25) 80%,
      rgba(0, 0, 0, 0.55) 100%
    );
}

.coverage-card {
  position: absolute; top: 14px; left: 14px;
  width: 280px;
  background: var(--bg-overlay);
  border: 1px solid var(--bd-strong);
  border-radius: 10px;
  padding: 12px 14px;
  z-index: 5;
  transition: width 0.2s ease, padding 0.2s ease;
}
/* 折叠态：仅保留头部，宽度收窄到刚好容下标题，避免遮挡地图 */
.coverage-card.collapsed {
  width: 220px;
  padding: 10px 12px;
}
.coverage-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12.5px; color: var(--txt-mute);
  margin-bottom: 8px;
  cursor: pointer;
  user-select: none;
}
.coverage-card.collapsed .coverage-head { margin-bottom: 0; }
.coverage-head-actions {
  display: flex; align-items: center; gap: 6px;
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
.coverage-legend .dot {
  width: 8px; height: 8px; border-radius: 50%;
}
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

/* 图层切换按钮：图标 + 当前模式标签（矢量 / 影像）双层布局 */
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
  font-size: 11px; color: var(--txt-mute);
  padding: 4px 8px;
  background: var(--bg-overlay);
  border: 1px solid var(--bd);
  border-radius: 6px;
  z-index: 5;
}

/* AI 助手 fab：固定在 canvas 右下角 */
.assistant-fab {
  position: absolute;
  right: 14px; bottom: 14px;
  z-index: 20;
  width: 52px; height: 52px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  border: 1px solid var(--bd-accent);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, transform 0.15s ease;
}
.assistant-fab:hover  { background: #2563eb; transform: translateY(-1px); }
.assistant-fab:active { transform: translateY(0); }
.fab-letters {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.6px;
  line-height: 1;
}

/* ============================================================================
   右面板（智能解说 + 上下文）
   ============================================================================ */
.auto-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--txt-mute); cursor: pointer;
}
.auto-toggle input { display: none; }
.toggle-knob {
  position: relative;
  width: 30px; height: 16px;
  background: rgba(120,140,200,0.25);
  border-radius: 8px;
  transition: background 0.2s ease;
}
.toggle-knob::after {
  content: '';
  position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px;
  background: #fff; border-radius: 50%;
  transition: transform 0.2s ease;
}
.toggle-knob.on { background: var(--primary); }
.toggle-knob.on::after { transform: translateX(14px); }

.theme-row { margin-bottom: 12px; }
.theme-label { font-size: 12px; color: var(--txt-mute); }
.theme-text { display: block; font-size: 14px; font-weight: 600; margin-top: 4px; line-height: 1.5; }

.waveform {
  display: flex; align-items: end; gap: 2px;
  height: 56px; padding: 6px 4px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 8px;
  margin-bottom: 12px;
}
.wave-bar {
  flex: 1;
  background: rgba(120,140,200,0.4);
  border-radius: 1px;
  transition: background 0.2s ease;
}
.wave-bar.active { background: linear-gradient(180deg, #60a5fa, #3b82f6); }

.narration-text {
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--txt);
  min-height: 88px;
  margin-bottom: 14px;
}
.narration-text p { margin: 0; }
.cursor {
  color: var(--primary);
  animation: blink 1s steps(2) infinite;
}
@keyframes blink { 50% { opacity: 0; } }

.seq-block { margin-bottom: 14px; }
.seq-head { display: flex; justify-content: space-between; align-items: center; }
.seq-title { font-size: 12.5px; color: var(--txt-mute); }
.seq-list { list-style: none; padding: 0; margin: 8px 0 4px; }
.seq-item {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  gap: 8px; align-items: center;
  padding: 7px 10px;
  border-radius: 7px;
  cursor: pointer;
  margin-bottom: 4px;
  background: var(--bg-card);
  border: 1px solid transparent;
  font-size: 12.5px;
}
.seq-item:hover { background: rgba(59,130,246,0.10); }
.seq-item.active {
  background: rgba(59,130,246,0.18);
  border-color: rgba(59,130,246,0.45);
}
.seq-no {
  width: 22px; height: 22px;
  background: rgba(255,255,255,0.06);
  border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600;
}
.seq-item.active .seq-no { background: var(--primary); color: #fff; }
.seq-name { color: var(--txt); }
.seq-tag {
  font-size: 10.5px; padding: 2px 7px;
  border-radius: 10px;
  font-weight: 500;
}
.tag-core { background: rgba(239,68,68,0.18); color: #fca5a5; }
.tag-related, .tag-ecological { background: rgba(245,158,11,0.18); color: #fcd34d; }
.tag-cultural { background: rgba(168,85,247,0.18); color: #d8b4fe; }
.tag-landmark { background: rgba(34,197,94,0.18); color: #86efac; }
.tag-educational { background: rgba(59,130,246,0.18); color: #93c5fd; }

.seq-foot { font-size: 10.5px; color: var(--txt-faint); margin: 4px 0 0; }

.settings-block { padding-top: 6px; border-top: 1px solid var(--bd); }
.settings-title { font-size: 12.5px; color: var(--txt-mute); margin: 8px 0; }
.settings-row { font-size: 11.5px; color: var(--txt-faint); margin-top: 8px; margin-bottom: 6px; }

.duration-tabs {
  display: flex; gap: 4px;
  padding: 3px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 7px;
}
.duration-tab {
  flex: 1;
  padding: 6px 6px;
  background: transparent;
  color: var(--txt-mute);
  border: 0; border-radius: 5px;
  cursor: pointer;
  display: flex; flex-direction: column; gap: 2px;
  font-size: 11.5px;
}
.duration-tab strong { color: var(--txt); font-weight: 500; }
.duration-tab.active { background: rgba(59,130,246,0.2); }
.duration-tab.active strong { color: #fff; }

.style-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  margin-top: 4px;
}
.play-btn { margin-top: 12px; }

/* 上下文 */
.ctx-list { list-style: none; padding: 0; margin: 0; }
.ctx-list li {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 8px; padding: 5px 0;
  font-size: 12.5px; color: var(--txt);
  border-bottom: 1px dashed rgba(120,140,200,0.12);
}
.ctx-list li:last-child { border-bottom: 0; }
.ctx-key { color: var(--txt-mute); }
.ctx-list li::before {
  content: '·'; color: var(--primary); font-weight: 700;
  position: absolute; margin-left: -10px;
}
.ctx-hint {
  margin-top: 10px;
  font-size: 11.5px; color: var(--txt-mute);
  line-height: 1.55;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 7px;
  border: 1px solid var(--bd);
  position: relative; padding-left: 24px;
}
.ctx-bullet {
  position: absolute; left: 8px; top: 11px;
  width: 8px; height: 8px;
  background: var(--primary);
  border-radius: 50%;
}

/* ============================================================================
   底部时间线
   ============================================================================ */
/* 卡片化：与 map-stage 同样的圆角和边框，视觉保持一致
   两段：左侧时间线（拉伸）+ 右侧播放器进度条（固定宽度） */
.bottom-bar {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--bd-strong);
  border-radius: 12px;
  background: var(--bg-panel);
  min-height: 0;
  min-width: 0;
}

.timeline-wrap {
  display: grid;
  grid-template-columns: 28px 1fr 28px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tl-arrow {
  width: 28px; height: 28px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  color: var(--txt-mute);
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.tl-arrow:hover { color: #fff; background: rgba(59,130,246,0.15); }

.timeline {
  list-style: none; padding: 4px 0; margin: 0;
  display: flex; gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-behavior: smooth;
  scroll-snap-type: x mandatory;
  overscroll-behavior-inline: contain;
}
.timeline::-webkit-scrollbar { display: none; }

.tl-card {
  flex: 0 0 132px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 6px;
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease;
  scroll-snap-align: center;
}
.tl-card:hover { background: var(--bg-elevated); border-color: var(--bd-accent); }
.tl-card.active {
  border-color: var(--bd-accent);
  background: var(--bg-elevated);
}
.tl-thumb {
  position: relative;
  height: 60px;
  border-radius: 7px;
  overflow: hidden;
}
.tl-dot {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.86);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.tl-dot.tier-core {
  width: 8px;
  height: 8px;
  background: #ef4444;
}
.tl-dot.tier-strong { background: #f97316; }
.tl-dot.tier-medium { background: #eab308; }
.tl-dot.tier-weak {
  width: 4px;
  height: 4px;
  background: #60a5fa;
  opacity: 0.72;
}
.tl-cluster {
  position: absolute;
  right: 7px;
  bottom: 6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  background: rgba(15,23,42,0.72);
  border: 1px solid rgba(255,255,255,0.45);
}
.tl-no {
  position: absolute; top: 5px; left: 6px;
  width: 18px; height: 18px;
  background: rgba(0,0,0,0.55);
  color: #fff; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600;
}
.tl-tag-mini {
  position: absolute; top: 5px; right: 5px;
  font-size: 10px; padding: 1px 5px;
  background: rgba(0,0,0,0.55);
  color: #fff; border-radius: 4px;
}
.tl-name {
  font-size: 12px; font-weight: 600; color: var(--txt);
  margin-top: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tl-sub {
  font-size: 10.5px; color: var(--txt-mute);
  margin-top: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* 进度 + 控制 */
.bottom-progress {
  display: flex; flex-direction: column;
  gap: 6px;
  justify-content: center;
}
.player-controls {
  display: flex; gap: 6px; justify-content: center; align-items: center;
}
.player-btn {
  width: 32px; height: 32px;
  background: transparent; color: var(--txt-mute);
  border: 1px solid var(--bd);
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.player-btn:hover { color: #fff; background: rgba(59,130,246,0.15); }
.player-btn.primary {
  background: linear-gradient(180deg, #3b82f6, #2563eb);
  color: #fff;
  border-color: rgba(59,130,246,0.6);
  width: 36px; height: 36px;
}

.progress-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px; align-items: center;
  font-size: 11px; color: var(--txt-mute);
}
.progress-track {
  position: relative;
  height: 4px;
  background: rgba(120,140,200,0.18);
  border-radius: 2px;
  cursor: pointer;
}
.progress-fill {
  position: absolute; left: 0; top: 0;
  height: 100%;
  background: linear-gradient(90deg, #60a5fa, #3b82f6);
  border-radius: 2px;
}
.progress-knob {
  position: absolute; top: -4px;
  width: 12px; height: 12px;
  background: #fff;
  border-radius: 50%;
  transform: translateX(-50%);
  border: 3px solid var(--primary);
}
.progress-time { font-feature-settings: 'tnum'; }
.progress-rate { color: var(--txt-faint); }

/* 响应式：1280 以下收起左面板宽度，1080 以下右面板缩窄
   底栏内部 2 段：时间线 1fr + 播放器固定宽度，窄屏时压缩播放器段 */
@media (max-width: 1280px) {
  .main-grid { grid-template-columns: 270px 1fr 290px; }
  .bottom-bar { grid-template-columns: 1fr 280px; }
}
@media (max-width: 1080px) {
  .main-grid { grid-template-columns: 240px 1fr 260px; }
  .topbar { grid-template-columns: 240px 1fr 240px; }
  .bottom-bar { grid-template-columns: 1fr 240px; }
}
</style>
