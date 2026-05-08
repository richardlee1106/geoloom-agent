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
          @click="switchMode(m.key)"
        >
          <span class="mode-icon" v-html="m.icon" />
          <span>{{ m.label }}</span>
        </button>
      </nav>
      <div class="topbar-actions">
        <!--
        <button class="action-btn" title="分享"><span v-html="ICONS.share" /><span>分享</span></button>
        <button class="action-btn" title="收藏"><span v-html="ICONS.bookmark" /><span>收藏</span></button>
        -->
        <button v-if="showDeveloperPanel" class="action-btn" title="开发调试" @click="developerPanelOpen = !developerPanelOpen"><span>DEV</span><span>{{ developerPanelOpen ? '隐藏调试' : '显示调试' }}</span></button>
        <!--
        <button class="action-btn" title="设置"><span v-html="ICONS.settings" /><span>设置</span></button>
        -->
      </div>
    </header>

    <!-- 中部主体：左 + 中 + 右 -->
    <div :class="['main-grid', `mode-${mode}`]">
      <!-- 左面板 -->
      <aside v-if="mode === 'explore'" class="left-panel explore-tools-panel">
        <nav class="explore-tool-nav" aria-label="探索工具导航">
          <button
            v-for="tool in exploreToolTabs"
            :key="tool.key"
            :class="['explore-tool-tab', { active: activeExploreTool === tool.key }]"
            type="button"
            @click="activeExploreTool = tool.key"
          >
            <span class="tool-tab-index">{{ tool.index }}</span>
            <span class="tool-tab-copy">
              <strong>{{ tool.label }}</strong>
              <span>{{ tool.hint }}</span>
            </span>
          </button>
        </nav>
        <div class="explore-tool-shell">
        <!-- 1. 片区筛选 -->
        <section v-show="activeExploreTool === 'scope'" class="panel-card explore-tool-card">
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
          <div class="explore-param-group">
            <div class="param-title-row">
              <span>探索主题</span>
              <strong>{{ explorationThemeOptions.find((o) => o.key === exploreSettings.theme)?.label }}</strong>
            </div>
            <div class="option-grid">
              <button
                v-for="o in explorationThemeOptions"
                :key="o.key"
                :class="['option-chip', { active: exploreSettings.theme === o.key }]"
                type="button"
                @click="exploreSettings.theme = o.key"
              >
                <strong>{{ o.label }}</strong>
                <span>{{ o.hint }}</span>
              </button>
            </div>
          </div>
          <div class="explore-param-group">
            <div class="param-title-row">
              <span>片区粒度</span>
              <strong>{{ granularityOptions.find((o) => o.key === exploreSettings.granularity)?.label }}</strong>
            </div>
            <div class="option-grid compact">
              <button
                v-for="o in granularityOptions"
                :key="o.key"
                :class="['option-chip', { active: exploreSettings.granularity === o.key }]"
                type="button"
                @click="exploreSettings.granularity = o.key"
              >{{ o.label }}</button>
            </div>
          </div>
          <div class="explore-param-group">
            <div class="slider-row">
              <span class="slider-label">候选数量</span>
              <span class="slider-value">{{ exploreSettings.candidateCount }}</span>
            </div>
            <input class="slider-input" type="range" min="3" max="12" step="1" v-model.number="exploreSettings.candidateCount" />
            <div class="slider-ticks"><span>精简</span><span>均衡</span><span>展开</span></div>
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
          <button class="primary-btn" :disabled="analysisStatus === 'analyzing' || !mapStageReady" @click="analyzeCurrentViewport">
            {{ analysisStatus === 'analyzing' ? '分析中…' : mapStageReady ? '分析当前视野' : '地图加载中…' }}
          </button>
        </section>

        <!-- 2. 点剔除与分层 -->
        <section v-show="activeExploreTool === 'layers'" class="panel-card explore-tool-card">
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
          <div class="explore-param-group">
            <div class="param-title-row">
              <span>证据严格度</span>
              <strong>{{ evidenceStrictnessOptions.find((o) => o.key === exploreSettings.evidenceStrictness)?.label }}</strong>
            </div>
            <div class="option-grid compact">
              <button
                v-for="o in evidenceStrictnessOptions"
                :key="o.key"
                :class="['option-chip', { active: exploreSettings.evidenceStrictness === o.key }]"
                type="button"
                @click="exploreSettings.evidenceStrictness = o.key"
              >{{ o.label }}</button>
            </div>
          </div>
          <div class="explore-param-group">
            <div class="param-title-row">
              <span>多样性强度</span>
              <strong>{{ diversityOptions.find((o) => o.key === exploreSettings.diversity)?.label }}</strong>
            </div>
            <div class="option-grid compact">
              <button
                v-for="o in diversityOptions"
                :key="o.key"
                :class="['option-chip', { active: exploreSettings.diversity === o.key }]"
                type="button"
                @click="exploreSettings.diversity = o.key"
              >{{ o.label }}</button>
            </div>
          </div>
          <div class="slider-row">
            <span class="slider-label">相关性阈值</span>
            <span class="slider-value">{{ ui.relevanceThreshold.toFixed(2) }}</span>
          </div>
          <input class="slider-input" type="range" min="0" max="1" step="0.01" v-model.number="ui.relevanceThreshold" />
          <div class="slider-ticks"><span>0%</span><span>50%</span><span>100%</span></div>
        </section>

        <!-- 4. 尺度与重心 -->
        <section v-show="activeExploreTool === 'scale'" class="panel-card explore-tool-card">
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
            <span class="lod-val accent">Level {{ ui.viewportZoom.toFixed(1) }}</span>
          </div>
          <div class="lod-bar">
            <span>远景（多讲）</span>
            <input class="slider-input" type="range" min="10" max="17" step="0.1" v-model.number="ui.viewportZoom" @input="applyViewportZoom" />
            <span>近景（深挖）</span>
          </div>
          <div class="centroid-row">
            <span class="centroid-key">重心策略</span>
          </div>
          <div class="centroid-tabs">
            <button
              v-for="o in centroidStrategyOptions"
              :key="o.key"
              :class="['centroid-tab', { active: ui.centroidStrategy === o.key }]"
              @click="setCentroidStrategy(o.key)"
            >{{ o.label }}</button>
          </div>
          <div class="explore-param-group">
            <div class="param-title-row">
              <span>本地人倾向</span>
              <strong>{{ localnessOptions.find((o) => o.key === exploreSettings.localness)?.label }}</strong>
            </div>
            <div class="option-grid compact">
              <button
                v-for="o in localnessOptions"
                :key="o.key"
                :class="['option-chip', { active: exploreSettings.localness === o.key }]"
                type="button"
                @click="exploreSettings.localness = o.key"
              >{{ o.label }}</button>
            </div>
          </div>
          <div class="explore-param-group">
            <div class="param-title-row">
              <span>网页事实增强</span>
              <strong>{{ webFactOptions.find((o) => o.key === exploreSettings.webFacts)?.label }}</strong>
            </div>
            <div class="option-grid compact">
              <button
                v-for="o in webFactOptions"
                :key="o.key"
                :class="['option-chip', { active: exploreSettings.webFacts === o.key }]"
                type="button"
                @click="exploreSettings.webFacts = o.key"
              >{{ o.label }}</button>
            </div>
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
          </div>
          <div class="centroid-hint">
            当前重心：{{ activeRegion.display_name }}。调整尺度或重心后，再点击“分析当前视野”刷新叙事。
          </div>
        </section>
        </div>
      </aside>

      <NarrativeMapStage
        v-if="mapStageVisible"
        ref="mapStageRef"
        :narrative="narrative"
        :display-regions="displayRegions"
        :display-all-renderable-pois="displayAllRenderablePois"
        :relevance-threshold="ui.relevanceThreshold"
        :viewport-zoom="ui.viewportZoom"
        :coverage-collapsed="coverageCollapsed"
        :assistant-open="assistantOpen"
        :coverage-breakdown="coverageBreakdown"
        :donut-dash="donutDash"
        :donut-offsets="donutOffsets"
        :minimal="mode !== 'explore'"
        @update:coverage-collapsed="coverageCollapsed = $event"
        @update:viewport-zoom="ui.viewportZoom = $event"
        @open-assistant="assistantOpen = true"
        @ready="mapStageReady = true"
      />

      <NarrativeMapPlaceholder
        v-if="!mapStageReady"
        :assistant-open="assistantOpen"
        @open-assistant="assistantOpen = true"
      />

      <section v-if="mode === 'narrate'" :class="['narrate-hud', { active: playing, ready: canNarrate }]">
        <div class="narrate-command">
          <div class="hud-copy">
            <span class="hud-kicker">解说模式</span>
            <strong>{{ narrativeSourceLabel }}</strong>
            <span>{{ playbackHint }}</span>
          </div>
          <div class="hud-actions">
            <button class="primary-btn" :disabled="narratePrimaryDisabled" @click="handleNarratePrimaryAction">
              {{ narratePrimaryLabel }}
            </button>
            <button class="ghost-btn" :disabled="!canNarrate || playbackState === 'step_completed' || playbackState === 'completed'" @click="togglePlay">
              <span v-html="playing ? ICONS.pause : ICONS.play" />
              <span>{{ playing ? '暂停' : '播放' }}</span>
            </button>
          </div>
        </div>
      </section>

      <aside v-if="mode === 'narrate'" :class="['narrate-rail', { empty: displayPathNodes.length === 0 }]">
        <div class="rail-head">
          <span>解说路径</span>
          <strong>{{ displayPathNodes.length ? `${activeStepIndex + 1}/${displayPathNodes.length}` : '0/0' }}</strong>
        </div>
        <ul v-if="displayPathNodes.length" class="rail-list">
          <li
            v-for="(node, i) in displayPathNodes"
            :key="`narrate-rail-${node.region_id}`"
            :class="['rail-card', `role-${node.narration_role}`, { active: i === activeStepIndex }]"
            @click="goToStep(i)"
          >
            <span class="rail-index">{{ i + 1 }}</span>
            <span class="rail-copy">
              <strong>{{ node.display_name || regionMap[node.region_id]?.display_name || node.region_id }}</strong>
              <span>{{ pathRoleLabel(node.narration_role) }} · {{ node.chapter_label }}</span>
            </span>
            <span class="rail-count">{{ timelineDotsByRegion[node.region_id]?.length || 0 }}</span>
          </li>
        </ul>
        <div v-else class="rail-empty">
          <strong>等待路线</strong>
          <span>点击“分析并开始”后展示章节。</span>
        </div>
      </aside>

      <section v-if="mode === 'narrate' && (canNarrate || typedText || activeChapterSources.length)" class="vertical-narration" @copy.prevent @cut.prevent>
        <div class="vertical-title">{{ activeRegion.display_name }}</div>
        <p class="vertical-copy">
          <span>{{ typedText || '解说已生成，点击播放开始讲述当前视野。' }}</span>
          <a
            v-for="(source, i) in activeChapterSources"
            :key="`vertical-source-${source.url}-${i}`"
            class="vertical-source-mark"
            :href="source.url"
            target="_blank"
            rel="noreferrer"
            :title="sourceTooltipText(source)"
            @mouseenter="hoveredSourceIndex = i"
            @mouseleave="hoveredSourceIndex = null"
            @focus="hoveredSourceIndex = i"
            @blur="hoveredSourceIndex = null"
          ><sup>{{ i + 1 }}</sup></a>
          <span v-if="typing" class="vertical-cursor">▏</span>
        </p>
        <a
          v-if="previewedChapterSource"
          class="vertical-source-preview"
          :href="previewedChapterSource.url"
          target="_blank"
          rel="noreferrer"
          :title="sourceTooltipText(previewedChapterSource)"
        >
          <span class="preview-index">{{ previewedChapterSourceIndex + 1 }}</span>
          <span class="preview-copy">
            <strong>{{ previewedChapterSource.title }}</strong>
            <span>{{ sourceQualityLabel(previewedChapterSource.quality) }} · {{ sourceDomain(previewedChapterSource.url) }}</span>
            <em v-if="previewedChapterSource.snippet">{{ previewedChapterSource.snippet }}</em>
          </span>
        </a>
      </section>

      <section v-if="mode === 'compare'" class="compare-board">
        <div class="board-kicker">对比模式</div>
        <h2>多选区空间叙事对比</h2>
        <p class="board-copy">建议把对比模式做成“绘制多个区域 → 分别生成区域画像 → 横向比较主题、点簇、来源和叙事差异”的工作流。</p>
        <div class="compare-tools">
          <button class="ghost-btn" disabled><span v-html="ICONS.draw" /><span>矩形区域</span></button>
          <button class="ghost-btn" disabled><span v-html="ICONS.draw" /><span>不规则面</span></button>
          <button class="ghost-btn" disabled><span v-html="ICONS.locate" /><span>圆形范围</span></button>
        </div>
        <ul class="compare-ideas">
          <li>可对比两个商圈的消费点簇强度、业态多样性和 web 来源热度。</li>
          <li>可对比校园、公园、江滩等区域在不同尺度下的解说重点。</li>
          <li>可输出“共同点 / 差异点 / 适合讲法 / 推荐导览顺序”。</li>
        </ul>
      </section>

      <!-- 右面板 -->
      <aside v-if="mode === 'explore'" class="right-panel">
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
            <p>
              {{ typedText }}
              <template v-if="!typing">
                <a
                  v-for="(source, i) in activeChapterSources"
                  :key="`${source.url}-${i}`"
                  class="source-mark"
                  :href="source.url"
                  target="_blank"
                  rel="noreferrer"
                  :title="sourceTooltipText(source)"
                  @mouseenter="hoveredSourceIndex = i"
                  @mouseleave="hoveredSourceIndex = null"
                >{{ i + 1 }}</a>
              </template>
              <span class="cursor" v-if="typing">▏</span>
            </p>
            <div v-if="!typing && activeChapterSources.length" class="source-list">
              <a
                v-for="(source, i) in activeChapterSources"
                :key="`source-${source.url}-${i}`"
                :class="['source-item', { active: hoveredSourceIndex === i }]"
                :href="source.url"
                target="_blank"
                rel="noreferrer"
                :title="sourceTooltipText(source)"
                @mouseenter="hoveredSourceIndex = i"
                @mouseleave="hoveredSourceIndex = null"
              >
                <span class="source-item-title"><sup>{{ i + 1 }}</sup>{{ source.title }}</span>
                <span class="source-meta">{{ sourceQualityLabel(source.quality) }} · {{ sourceDomain(source.url) }}</span>
                <span v-if="source.snippet" class="source-summary">{{ source.snippet }}</span>
              </a>
            </div>
            <div v-else-if="!typing" class="source-empty">
              {{ sourceEmptyMessage }}
            </div>
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

        <NarrativeDevPanel
          v-if="showDeveloperPanel && developerPanelOpen"
          :summary-items="debugSummaryItems"
          :detail-items="debugDetailItems"
          @copy-snapshot="copyDebugSnapshot"
          @replay="analyzeCurrentViewport"
          @copy-golden="copyGoldenViewportPayload"
        />
      </aside>

      <!-- AI 助手抽屉：跨 center + right 两列，高度 = canvas 高，宽度 = canvas + 右面板宽
           §7.4 / §8.4 契约：组件只读 narrative state，副作用通过 emit 回传 -->
      <AssistantDock
        v-if="assistantOpen"
        :compact="mode !== 'explore'"
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

      <NarrativeTimelinePlayer
        v-if="mode === 'explore'"
        :path-nodes="displayPathNodes"
        :active-step-index="activeStepIndex"
        :playing="playing"
        :progress-percent="progressPercent"
        :elapsed-ms="elapsedMs"
        :total-duration-ms="totalDurationMs"
        :timeline-dots-by-region="timelineDotsByRegion"
        @previous="goPrev"
        @next="goNext"
        @rewind="rewind"
        @forward="forward"
        @toggle-play="togglePlay"
        @go-to-step="goToStep"
        @seek-ratio="seekByRatio"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { fetchNarrativeEnrichmentJob, fetchNarrativeResponse } from './narrative/narrativeApi'
import { adaptNarrativeResponse } from './narrative/narrativeResponseAdapter'
import NarrativeMapPlaceholder from './narrative/NarrativeMapPlaceholder.vue'
import type {
  NarrativeMode as ChatMode,
  NarrativeResponse,
  NarrativeChapter,
  NarrativePoi,
  NarrativeRegion,
  NarrativeUiSettings,
  PathNarrationRole,
  ViewportBBox,
  VisualTier
} from './narrative/types'

type ChapterSourceView = NonNullable<NarrativeChapter['web_sources']>[number]
type PlaybackState = 'idle' | 'prepared' | 'auto_started' | 'manual_started' | 'paused' | 'step_completed' | 'completed'
type ExploreToolKey = 'scope' | 'layers' | 'scale'
type ExplorationThemeKey = 'comprehensive' | 'commerce' | 'nightlife' | 'memory' | 'family' | 'education' | 'commute' | 'tourism'
type GranularityKey = 'auto' | 'district' | 'aoi' | 'poi_cluster'
type EvidenceStrictnessKey = 'strict' | 'balanced' | 'loose'
type DiversityKey = 'low' | 'medium' | 'high'
type LocalnessKey = 'tourist' | 'balanced' | 'local'
type WebFactModeKey = 'off' | 'light' | 'full'
type ExploreOption<T extends string> = { key: T; label: string; hint?: string }

interface ExploreSettings {
  theme: ExplorationThemeKey
  granularity: GranularityKey
  evidenceStrictness: EvidenceStrictnessKey
  candidateCount: number
  diversity: DiversityKey
  localness: LocalnessKey
  webFacts: WebFactModeKey
}

const AssistantDock = defineAsyncComponent(() => import('./narrative/AssistantDock.vue'))
const NarrativeDevPanel = defineAsyncComponent(() => import('./narrative/NarrativeDevPanel.vue'))
const NarrativeMapStage = defineAsyncComponent(() => import('./narrative/NarrativeMapStage.vue'))
const NarrativeTimelinePlayer = defineAsyncComponent(() => import('./narrative/NarrativeTimelinePlayer.vue'))

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
  viewportZoom: INITIAL_VIEWPORT.zoom,
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

const exploreToolTabs: Array<{ key: ExploreToolKey; index: string; label: string; hint: string }> = [
  { key: 'scope', index: '01', label: '范围', hint: '视野与片区' },
  { key: 'layers', index: '02', label: '分层', hint: '证据与剔除' },
  { key: 'scale', index: '03', label: '尺度', hint: '粒度与重心' }
]

const explorationThemeOptions: Array<ExploreOption<ExplorationThemeKey>> = [
  { key: 'comprehensive', label: '综合观察', hint: '平衡识别' },
  { key: 'commerce', label: '商业活力', hint: '商圈消费' },
  { key: 'nightlife', label: '夜生活', hint: '夜市餐饮' },
  { key: 'memory', label: '城市记忆', hint: '历史街巷' },
  { key: 'family', label: '亲子休闲', hint: '公园服务' },
  { key: 'education', label: '高校科教', hint: '校园文化' },
  { key: 'commute', label: '通勤生活', hint: '日常便利' },
  { key: 'tourism', label: '文旅打卡', hint: '地标景点' }
]

const granularityOptions: Array<ExploreOption<GranularityKey>> = [
  { key: 'auto', label: '自动' },
  { key: 'district', label: '商圈/街区' },
  { key: 'aoi', label: 'AOI' },
  { key: 'poi_cluster', label: 'POI 簇' }
]

const evidenceStrictnessOptions: Array<ExploreOption<EvidenceStrictnessKey>> = [
  { key: 'strict', label: '严格' },
  { key: 'balanced', label: '均衡' },
  { key: 'loose', label: '宽松' }
]

const diversityOptions: Array<ExploreOption<DiversityKey>> = [
  { key: 'low', label: '聚焦' },
  { key: 'medium', label: '均衡' },
  { key: 'high', label: '漫游' }
]

const localnessOptions: Array<ExploreOption<LocalnessKey>> = [
  { key: 'tourist', label: '游客友好' },
  { key: 'balanced', label: '均衡' },
  { key: 'local', label: '本地生活' }
]

const webFactOptions: Array<ExploreOption<WebFactModeKey>> = [
  { key: 'off', label: '关闭' },
  { key: 'light', label: '轻量' },
  { key: 'full', label: '完整' }
]

type CentroidStrategy = NarrativeUiSettings['centroidStrategy']

function centroidStrategyLabel(strategy: CentroidStrategy): string {
  if (strategy === 'region_first') return '片区优先'
  if (strategy === 'poi_first') return 'POI 优先'
  return '自动重心'
}

// ============================================================================
// 模式 + 状态
// ============================================================================
const narrative = ref<NarrativeResponse>(EMPTY_NARRATIVE_RESPONSE)
const analysisStatus = ref<'preset' | 'analyzing' | 'ready' | 'error'>('preset')
const analysisError = ref('')
const enrichmentStatus = ref<'idle' | 'pending' | 'running' | 'completed' | 'failed'>('idle')
const enrichmentError = ref('')
const developerPanelOpen = ref(false)
const hoveredSourceIndex = ref<number | null>(null)
const playbackState = ref<PlaybackState>('idle')
const activeExploreTool = ref<ExploreToolKey>('scope')
let enrichmentPollToken = 0
const canNarrate = computed(() => analysisStatus.value === 'ready' && displayPathNodes.value.length > 0)
const showDeveloperPanel = computed(() => import.meta.env.DEV && Boolean(narrative.value.debug))
const narrativeSourceLabel = computed(() => {
  if (analysisStatus.value === 'analyzing') return '正在分析'
  if (enrichmentStatus.value === 'pending' || enrichmentStatus.value === 'running') return '正在补充资料'
  if (enrichmentStatus.value === 'completed') return '已增强'
  if (enrichmentStatus.value === 'failed') return '资料补强失败'
  if (analysisStatus.value === 'ready') return '后端实时'
  if (analysisStatus.value === 'error') return '分析失败'
  return '等待分析'
})
const displayModel = computed(() => adaptNarrativeResponse(narrative.value))
const displayPathNodes = computed(() => displayModel.value.pathNodes)
const displayChapters = computed(() => displayModel.value.chapters)
const displayRegions = computed(() => displayModel.value.regions)
const displayAllRenderablePois = computed(() => displayModel.value.allRenderablePois)
const tierStats = computed(() => displayModel.value.tierStats)
const activeChapterSources = computed<ChapterSourceView[]>(() => {
  const chapter = displayChapters.value[activeStepIndex.value]
  const sources: ChapterSourceView[] = chapter?.web_sources?.length
    ? chapter.web_sources.map((source) => ({ ...source }))
    : chapter?.web_source
      ? [{ title: chapter.web_source.title, url: chapter.web_source.url }]
      : []
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (!source?.url || seen.has(source.url)) return false
    seen.add(source.url)
    return true
  }).slice(0, 3)
})
const sourceEmptyMessage = computed(() => {
  const summary = narrative.value.enrichment
  const error = enrichmentError.value || summary?.error || ''
  if (enrichmentStatus.value === 'pending' || enrichmentStatus.value === 'running') return '正在补充网页来源，完成后会自动回填当前章节。'
  if (enrichmentStatus.value === 'failed' || summary?.status === 'failed') {
    return error ? `网页来源补强失败：${error}` : '网页来源补强失败，请检查搜索接口配置或稍后重试。'
  }
  if (summary?.phase === 'enriched' && summary.source_count === 0) return '已完成资料补强，但当前视野没有返回可核验网页来源。'
  if ((summary?.source_count ?? 0) > 0) return '当前章节暂无网页来源，其他章节可能已有来源。'
  return '暂无网页来源，当前章节使用本地结构事实与路径关系生成。'
})
const previewedChapterSourceIndex = computed(() => {
  if (!activeChapterSources.value.length) return -1
  return hoveredSourceIndex.value === null ? 0 : Math.min(hoveredSourceIndex.value, activeChapterSources.value.length - 1)
})
const previewedChapterSource = computed(() => {
  if (previewedChapterSourceIndex.value < 0) return null
  return activeChapterSources.value[previewedChapterSourceIndex.value] ?? null
})
const playbackHint = computed(() => {
  if (analysisStatus.value === 'analyzing') return '正在生成解说路径，完成后会按你的自动解说设置处理。'
  if (!canNarrate.value) return '分析当前视野后，可以播放逐段解说。'
  if (playbackState.value === 'step_completed') return activeStepIndex.value < displayChapters.value.length - 1 ? '本段已讲完，点击“下一个”继续下一片区。' : '最后一段已讲完，可重新分析当前视野。'
  if (playing.value) return '正在播放当前片区，播完会停在本段。'
  if (playbackState.value === 'auto_started') return '已开始当前片区解说，可随时暂停或跳转。'
  if (playbackState.value === 'paused') return '解说已暂停，点击开始可从当前章节继续。'
  if (playbackState.value === 'completed') return '本轮解说已结束，可重新播放或选择章节回看。'
  return '分析完成后会停在第一章，点击开始播放当前片区。'
})
const narratePrimaryLabel = computed(() => {
  if (!mapStageReady.value) return '地图加载中…'
  if (analysisStatus.value === 'analyzing') return '正在准备…'
  if (playing.value) return '播放中…'
  if (playbackState.value === 'step_completed' && activeStepIndex.value < displayChapters.value.length - 1) return '下一个'
  if (canNarrate.value && !playing.value && playbackState.value !== 'completed') return '开始'
  return '分析并开始'
})
const narratePrimaryDisabled = computed(() => {
  if (!mapStageReady.value || analysisStatus.value === 'analyzing') return true
  if (playing.value) return true
  if (playbackState.value === 'step_completed') return activeStepIndex.value >= displayChapters.value.length - 1
  return false
})
const debugSummaryItems = computed(() => {
  const debug = narrative.value.debug
  if (!debug) return []
  return [
    { key: 'recall', label: '召回', summary: summarizeDebugValue(debug.recall) },
    { key: 'candidates', label: '候选', summary: summarizeDebugValue(debug.candidates) },
    { key: 'lod', label: '尺度', summary: summarizeDebugValue(debug.lod) },
    { key: 'path', label: '路径', summary: summarizeDebugValue(debug.path) },
    { key: 'facts', label: '事实', summary: summarizeDebugValue(debug.facts) },
    { key: 'web_facts', label: '网页事实', summary: summarizeDebugValue(debug.web_facts) },
    { key: 'golden', label: '回放', summary: `${displayPathNodes.value.length} 个章节 / ${displayRegions.value.length} 个片区` }
  ]
})
const debugDetailItems = computed(() => {
  const debug = narrative.value.debug
  if (!debug) return []
  const replayPayload = {
    viewport: narrative.value.viewport,
    tone: ui.tonePreset,
    user_context: narrative.value.user_context
  }
  return [
    { key: 'recall', label: 'Recall', value: debug.recall },
    { key: 'candidates', label: 'Candidates', value: debug.candidates },
    { key: 'lod', label: 'LOD', value: debug.lod },
    { key: 'path', label: 'Path', value: debug.path },
    { key: 'facts', label: 'Facts', value: debug.facts },
    { key: 'web_facts', label: 'Web Facts', value: debug.web_facts },
    { key: 'golden', label: 'Golden 回放参数', value: replayPayload }
  ].map((item) => ({ key: item.key, label: item.label, detail: formatDebugValue(item.value) }))
})
const ui = reactive<NarrativeUiSettings>({ ...defaultUiSettings })
const exploreSettings = reactive<ExploreSettings>({
  theme: 'comprehensive',
  granularity: 'auto',
  evidenceStrictness: 'balanced',
  candidateCount: 6,
  diversity: 'medium',
  localness: 'balanced',
  webFacts: 'light'
})
const route = useRoute()
const router = useRouter()
const mode = ref<ChatMode>(modeFromRoute(route.params.mode))

// 左上「当前视角覆盖分析」卡片的折叠状态（局部 UI state，不进 NarrativeUiSettings 契约）
const coverageCollapsed = ref<boolean>(true)

type NarrativeMapStageExpose = {
  applyViewportZoom: (zoomValue?: number) => void
  focusByCentroidStrategy: (strategy: CentroidStrategy, region: NarrativeRegion, viewportZoom?: number) => void
  flyToRegion: (region: NarrativeRegion) => void
  getCurrentMapViewport: () => ViewportBBox | null
  refreshMapLayersAfterNarrativeChange: () => void
}

const mapStageRef = ref<NarrativeMapStageExpose | null>(null)
const mapStageVisible = ref(false)
const mapStageReady = ref(false)

onMounted(() => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      mapStageVisible.value = true
    })
  })
})

const modes: Array<{ key: ChatMode; label: string; icon: string }> = [
  { key: 'narrate', label: '解说模式', icon: ICON_HEADPHONE() },
  { key: 'explore', label: '探索模式', icon: ICON_COMPASS() },
  { key: 'compare', label: '对比模式', icon: ICON_COMPARE() }
]

function modeFromRoute(value: unknown): ChatMode {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'narrate' || raw === 'compare' || raw === 'explore' ? raw : 'explore'
}

function switchMode(nextMode: ChatMode) {
  if (mode.value === nextMode && route.params.mode === nextMode) return
  mode.value = nextMode
  void router.push({ name: 'NarrativeMode', params: { mode: nextMode } })
}

watch(() => route.params.mode, (value) => {
  mode.value = modeFromRoute(value)
})

const regionMap = computed(() => displayModel.value.regionMap)

const activeStepIndex = ref(0)
const activeRegion = computed(() => {
  const node = displayPathNodes.value[activeStepIndex.value]
  return regionMap.value[node?.region_id ?? displayRegions.value[0]?.id] ?? displayRegions.value[0] ?? narrative.value.regions[0] ?? EMPTY_ACTIVE_REGION
})

watch(() => displayPathNodes.value.length, (length) => {
  if (length === 0) return
  if (activeStepIndex.value >= length) activeStepIndex.value = length - 1
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
  const r = regionMap.value[regionId]
  if (!r) return
  mapStageRef.value?.flyToRegion(r)
}

function sourceQualityLabel(quality?: ChapterSourceView['quality']): string {
  if (quality === 'official') return '官方来源'
  if (quality === 'encyclopedia') return '百科资料'
  if (quality === 'media') return '媒体报道'
  return '网页来源'
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '')
  } catch {
    return '来源链接'
  }
}

function sourceTooltipText(source: ChapterSourceView): string {
  return [source.title, source.snippet].filter(Boolean).join('\n')
}

function summarizeDebugValue(value: unknown): string {
  if (value === null || value === undefined) return '无数据'
  if (Array.isArray(value)) return `${value.length} 项`
  if (typeof value !== 'object') return String(value)
  const record = value as Record<string, unknown>
  const parts = Object.entries(record)
    .filter(([, item]) => typeof item === 'number' || typeof item === 'string' || typeof item === 'boolean')
    .slice(0, 3)
    .map(([key, item]) => `${key}: ${String(item)}`)
  return parts.length ? parts.join(' / ') : `${Object.keys(record).length} 个字段`
}

function formatDebugValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function goldenViewportPayload() {
  return {
    viewport: narrative.value.viewport,
    tone: ui.tonePreset,
    debug: true,
    enrichment_mode: 'async',
    user_context: narrative.value.user_context
  }
}

async function copyDebugSnapshot() {
  await copyTextToClipboard(formatDebugValue({
    debug: narrative.value.debug,
    replay: goldenViewportPayload()
  }))
}

async function copyGoldenViewportPayload() {
  await copyTextToClipboard(formatDebugValue(goldenViewportPayload()))
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

function polygonAreaKm2(coords: Array<[number, number]>): number {
  if (coords.length < 3) return 0
  const DEG2RAD = Math.PI / 180
  const R = 6371
  let sum = 0
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    sum += (coords[j][0] * DEG2RAD - coords[i][0] * DEG2RAD) *
      (2 + Math.sin(coords[i][1] * DEG2RAD) + Math.sin(coords[j][1] * DEG2RAD))
  }
  return Math.abs(sum) * R * R / 2
}

const activeRegionAreaText = computed(() => {
  const ring = activeRegion.value?.boundary?.coordinates?.[0]
  if (!ring || ring.length < 3) return '— km²'
  const area = polygonAreaKm2(ring as Array<[number, number]>)
  return area < 1 ? `${(area * 1e6).toFixed(0)} m²` : `${area.toFixed(2)} km²`
})

const lodLabel = computed(() => {
  if (ui.viewportZoom >= 15) return '近景（深挖）'
  if (ui.viewportZoom >= 13) return '中景（横向）'
  return '远景（多讲）'
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

const PATH_ROLE_LABEL: Record<PathNarrationRole, string> = {
  core: '核心讲点',
  related: '关联区域',
  cultural: '人文线索',
  landmark: '城市地标',
  educational: '教育文化',
  ecological: '生态空间'
}

function pathRoleLabel(role: PathNarrationRole): string {
  return PATH_ROLE_LABEL[role] ?? '解说节点'
}

interface TimelineDot {
  key: string
  x: number
  y: number
  tier: VisualTier
}

function timelinePoiSource(region: NarrativeRegion): NarrativePoi[] {
  return region.pois
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

function startTyping(onComplete?: () => void) {
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
      onComplete?.()
      return
    }
    typedText.value += text[idx]
    idx += 1
    waveActive.value = Math.floor((idx / Math.max(text.length, 1)) * waveformHeights.length)
  }, 120)
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
      stopAll('completed')
    }
  }, 100)
}

function stopProgress() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

function showFullChapterText(index: number) {
  stopTyping()
  const chapter = displayChapters.value[index]
  typedText.value = chapter?.text ?? ''
  typing.value = false
  waveActive.value = chapter?.text ? waveformHeights.length : 0
}

function stepEndElapsedMs(index: number) {
  let acc = 0
  for (let i = 0; i <= index; i++) {
    acc += displayChapters.value[i]?.length_ms ?? 8000
  }
  return Math.min(acc, totalDurationMs.value)
}

function finishStepAfterTyping(index: number) {
  if (index !== activeStepIndex.value) return
  elapsedMs.value = stepEndElapsedMs(index)
  if (index >= displayChapters.value.length - 1) {
    stopAll('completed')
    return
  }
  playing.value = false
  playbackState.value = 'step_completed'
  clearAdvanceTimer()
  stopProgress()
}

function applyStep(index: number, options: { fly?: boolean; narrate?: boolean } = {}) {
  if (index < 0 || index >= displayChapters.value.length) return
  activeStepIndex.value = index
  let acc = 0
  for (let i = 0; i < index; i++) {
    acc += displayChapters.value[i]?.length_ms ?? 8000
  }
  stepStartElapsedMs.value = acc
  elapsedMs.value = acc
  hoveredSourceIndex.value = null
  clearAdvanceTimer()
  if (options.fly !== false) flyToActiveRegion()
  if (options.narrate === false) {
    showFullChapterText(index)
  } else {
    startTyping(() => finishStepAfterTyping(index))
  }
}

function clampStepIndex(index: number) {
  const maxIndex = displayChapters.value.length - 1
  if (maxIndex < 0) return 0
  return Math.max(0, Math.min(index, maxIndex))
}

function startPlayback(state: Extract<PlaybackState, 'auto_started' | 'manual_started'>, index = activeStepIndex.value) {
  if (!canNarrate.value) return
  playing.value = true
  playbackState.value = state
  applyStep(index)
  startProgress()
}

function togglePlay() {
  if (!canNarrate.value) return
  if (playbackState.value === 'step_completed') return
  if (playing.value) {
    playing.value = false
    playbackState.value = 'paused'
    stopTyping()
    typing.value = false
    clearAdvanceTimer()
    stopProgress()
    return
  }
  startPlayback('manual_started')
}

function handleNarratePrimaryAction() {
  if (analysisStatus.value === 'analyzing' || !mapStageReady.value) return
  if (playbackState.value === 'step_completed') {
    if (activeStepIndex.value < displayChapters.value.length - 1) startPlayback('manual_started', activeStepIndex.value + 1)
    return
  }
  if (canNarrate.value && !playing.value && playbackState.value !== 'completed') {
    startPlayback('manual_started', activeStepIndex.value)
    return
  }
  void analyzeCurrentViewport()
}

function stopAll(nextState: PlaybackState = 'idle') {
  playing.value = false
  stopTyping()
  typing.value = false
  clearAdvanceTimer()
  stopProgress()
  playbackState.value = nextState
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

function seekByRatio(ratio: number) {
  elapsedMs.value = ratio * totalDurationMs.value
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
  if (!canNarrate.value) return
  stopAll()
  activeStepIndex.value = 0
  startPlayback('manual_started', 0)
}

function prepareNarrationAfterAnalysis() {
  if (!canNarrate.value) return
  activeStepIndex.value = 0
  playbackState.value = 'prepared'
  applyStep(0, { fly: false, narrate: false })
}

function refreshMapLayersAfterNarrativeChange() {
  mapStageRef.value?.refreshMapLayersAfterNarrativeChange()
}

function flyToActiveRegion() {
  mapStageRef.value?.flyToRegion(activeRegion.value)
}

function applyViewportZoom() {
  mapStageRef.value?.applyViewportZoom(ui.viewportZoom)
}

function focusByCentroidStrategy(strategy: CentroidStrategy = ui.centroidStrategy) {
  mapStageRef.value?.focusByCentroidStrategy(strategy, activeRegion.value, ui.viewportZoom)
}

function setCentroidStrategy(strategy: CentroidStrategy) {
  ui.centroidStrategy = strategy
  focusByCentroidStrategy(strategy)
}

async function analyzeCurrentViewport() {
  const viewport = mapStageRef.value?.getCurrentMapViewport()
  if (!viewport || analysisStatus.value === 'analyzing') return
  enrichmentPollToken += 1
  analysisStatus.value = 'analyzing'
  enrichmentStatus.value = 'idle'
  enrichmentError.value = ''
  analysisError.value = ''
  try {
    const response = await fetchNarrativeResponse({
      session_id: narrative.value.session_id,
      viewport,
      tone: ui.tonePreset,
      debug: import.meta.env.DEV,
      enrichment_mode: 'async',
      user_context: {
        ...narrative.value.user_context,
        preference_label: `${narrative.value.user_context.preference_label}｜${centroidStrategyLabel(ui.centroidStrategy)}｜Level ${ui.viewportZoom.toFixed(1)}`,
      }
    })
    if (import.meta.env.DEV) {
      const webFacts = response.debug?.web_facts as { source_count?: number; items?: Array<{ query?: string; error?: string }> } | undefined
      console.info('[Narrative] 后端实时分析结果', {
        runtime: response.debug?.runtime,
        viewport,
        regions: response.regions.map((region) => ({ id: region.id, name: region.display_name })),
        candidates: response.debug?.candidates,
        webFacts,
      })
      if (webFacts && !webFacts.source_count && webFacts.items?.some((item) => item.error)) {
        console.warn('[Narrative] Web fact 搜索未返回引用', webFacts.items)
      }
    }
    stopAll()
    narrative.value = response
    analysisStatus.value = 'ready'
    refreshMapLayersAfterNarrativeChange()
    const waitForEnrichmentBeforePlayback = false
    prepareNarrationAfterAnalysis()
    startPlayback('manual_started', 0)
    if (response.enrichment?.job_id) {
      pollNarrativeEnrichment(response.enrichment.job_id, enrichmentPollToken, { startPlaybackOnComplete: waitForEnrichmentBeforePlayback })
    }
  } catch (error) {
    analysisStatus.value = 'error'
    enrichmentStatus.value = 'idle'
    enrichmentError.value = ''
    analysisError.value = error instanceof Error ? error.message : '当前视野分析失败'
    if (import.meta.env.DEV) {
      console.warn('[Narrative] 当前视野分析失败', error)
    }
  }
}

async function pollNarrativeEnrichment(jobId: string, token: number, options: { startPlaybackOnComplete?: boolean } = {}) {
  enrichmentStatus.value = 'pending'
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (token !== enrichmentPollToken) return
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 3 ? 1200 : 2200))
    if (token !== enrichmentPollToken) return
    try {
      const job = await fetchNarrativeEnrichmentJob(jobId)
      enrichmentStatus.value = job.status === 'pending' ? 'pending' : job.status === 'running' ? 'running' : job.status === 'completed' ? 'completed' : 'failed'
      enrichmentError.value = job.summary?.error || job.error || ''
      if (job.status === 'completed' && job.response) {
        const shouldAutoStart = Boolean(options.startPlaybackOnComplete && ui.autoNarrate)
        const wasPlaying = playing.value
        narrative.value = job.response
        enrichmentError.value = job.response.enrichment?.error || ''
        refreshMapLayersAfterNarrativeChange()
        if (shouldAutoStart) {
          stopAll()
          activeStepIndex.value = 0
          startPlayback('auto_started', 0)
          return
        }
        const nextStepIndex = clampStepIndex(activeStepIndex.value)
        if (displayChapters.value.length > 0) applyStep(nextStepIndex, { fly: false, narrate: wasPlaying })
        return
      }
      if (job.status === 'failed') {
        if (options.startPlaybackOnComplete && ui.autoNarrate) startPlayback('auto_started', activeStepIndex.value)
        return
      }
    } catch (error) {
      enrichmentStatus.value = 'failed'
      enrichmentError.value = error instanceof Error ? error.message : '资料补强轮询失败'
      if (import.meta.env.DEV) {
        console.warn('[Narrative] 资料补强轮询失败', error)
      }
      return
    }
  }
  if (token === enrichmentPollToken) {
    enrichmentStatus.value = 'failed'
    enrichmentError.value = '资料补强超时，请检查搜索接口或稍后重试。'
  }
}

onBeforeUnmount(() => {
  enrichmentPollToken += 1
  stopAll()
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
  position: relative;
  display: grid;
  grid-template-columns: 300px 1fr 320px;
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas:
    "left center right"
    "left bottom right";
  min-height: 0;
  gap: 12px;
  padding: 12px;
}
.main-grid.mode-narrate {
  grid-template-columns: 1fr;
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "center";
}
.main-grid.mode-compare {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
  grid-template-areas: "center";
}
.left-panel { grid-area: left; }
.right-panel { grid-area: right; }
.map-stage { grid-area: center; }
.bottom-bar {
  grid-area: bottom;
  align-self: end;
}

.left-panel, .right-panel {
  display: flex; flex-direction: column;
  gap: 12px; min-height: 0; overflow-y: auto; overflow-x: hidden;
  padding-right: 2px;
}
.left-panel::-webkit-scrollbar, .right-panel::-webkit-scrollbar { width: 4px; }
.left-panel::-webkit-scrollbar-thumb, .right-panel::-webkit-scrollbar-thumb { background: rgba(120,140,200,0.2); border-radius: 2px; }

.explore-tools-panel {
  gap: 10px;
  overflow: hidden;
  padding-right: 0;
}
.explore-tool-nav {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(148,163,184,0.16);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(15,23,42,0.92), rgba(15,23,42,0.70)),
    radial-gradient(circle at 18% 0%, rgba(59,130,246,0.18), transparent 40%);
  box-shadow: 0 14px 34px rgba(2,6,23,0.26), inset 0 1px 0 rgba(255,255,255,0.05);
}
.explore-tool-tab {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid rgba(148,163,184,0.13);
  border-radius: 12px;
  background: rgba(2,6,23,0.22);
  color: var(--txt-mute);
  cursor: pointer;
  text-align: left;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.explore-tool-tab:hover {
  transform: translateX(2px);
  border-color: rgba(125,211,252,0.34);
  background: rgba(30,41,59,0.46);
  color: var(--txt);
}
.explore-tool-tab.active {
  border-color: rgba(59,130,246,0.64);
  background:
    linear-gradient(135deg, rgba(37,99,235,0.32), rgba(14,165,233,0.14)),
    rgba(15,23,42,0.72);
  color: #f8fafc;
  box-shadow: 0 12px 28px rgba(37,99,235,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
}
.tool-tab-index {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  color: #93c5fd;
  font-size: 11px;
  font-weight: 800;
  font-feature-settings: 'tnum';
  background: rgba(59,130,246,0.12);
  border: 1px solid rgba(96,165,250,0.18);
}
.explore-tool-tab.active .tool-tab-index {
  color: #fff;
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  box-shadow: 0 10px 22px rgba(37,99,235,0.26);
}
.tool-tab-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.tool-tab-copy strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tool-tab-copy span {
  overflow: hidden;
  color: #94a3b8;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.explore-tool-tab.active .tool-tab-copy span {
  color: #bfdbfe;
}
.explore-tool-shell {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}
.explore-tool-shell::-webkit-scrollbar { width: 4px; }
.explore-tool-shell::-webkit-scrollbar-thumb { background: rgba(120,140,200,0.22); border-radius: 2px; }
.explore-tool-card {
  min-height: min-content;
}
.explore-param-group {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid rgba(148,163,184,0.13);
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(15,23,42,0.62), rgba(2,6,23,0.34)),
    rgba(15,23,42,0.42);
}
.param-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.param-title-row span {
  color: var(--txt-mute);
  font-size: 12px;
}
.param-title-row strong {
  overflow: hidden;
  color: #bfdbfe;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.option-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.option-grid.compact {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.option-chip {
  display: grid;
  gap: 2px;
  min-height: 38px;
  align-content: center;
  padding: 7px 8px;
  border: 1px solid rgba(148,163,184,0.16);
  border-radius: 10px;
  background: rgba(2,6,23,0.24);
  color: var(--txt-mute);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease, transform 0.18s ease;
}
.option-chip:hover {
  transform: translateY(-1px);
  border-color: rgba(125,211,252,0.34);
  background: rgba(30,41,59,0.44);
  color: var(--txt);
}
.option-chip.active {
  border-color: rgba(96,165,250,0.62);
  background:
    linear-gradient(135deg, rgba(37,99,235,0.34), rgba(14,165,233,0.14)),
    rgba(15,23,42,0.74);
  color: #f8fafc;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 22px rgba(37,99,235,0.14);
}
.option-chip strong {
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.option-chip span {
  overflow: hidden;
  color: #94a3b8;
  font-size: 10.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.option-chip.active span {
  color: #bfdbfe;
}

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
.ghost-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.narrate-hud {
  position: absolute;
  z-index: 30;
  top: 18px;
  left: 50%;
  width: min(760px, calc(100vw - 56px));
  color: var(--txt);
  transform: translateX(-50%);
}
.narrate-command {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px 10px 14px;
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(15,23,42,0.86), rgba(2,6,23,0.72)),
    radial-gradient(circle at 8% 50%, rgba(59,130,246,0.24), transparent 28%);
  border: 1px solid rgba(148,163,184,0.22);
  box-shadow: 0 16px 44px rgba(2,6,23,0.36), inset 0 1px 0 rgba(255,255,255,0.06);
  backdrop-filter: blur(18px) saturate(1.12);
}
.narrate-hud.ready .narrate-command {
  border-color: rgba(96,165,250,0.34);
}
.narrate-hud.active .narrate-command {
  box-shadow: 0 16px 48px rgba(37,99,235,0.22), inset 0 1px 0 rgba(255,255,255,0.07);
}
.hud-copy {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.hud-kicker {
  display: inline-flex;
  padding: 4px 9px;
  border-radius: 999px;
  color: #bfdbfe;
  background: rgba(59,130,246,0.18);
  border: 1px solid rgba(147,197,253,0.18);
  font-size: 12px;
  font-weight: 700;
}
.hud-copy strong {
  color: #f8fafc;
  font-size: 13px;
  white-space: nowrap;
}
.hud-copy > span:last-child {
  overflow: hidden;
  color: #a8b3c7;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.hud-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}
.hud-actions .primary-btn,
.hud-actions .ghost-btn {
  width: auto;
  min-height: 36px;
  padding: 8px 13px;
  white-space: nowrap;
}
.hud-actions .ghost-btn {
  background: rgba(255,255,255,0.06);
  border-color: rgba(148,163,184,0.22);
  color: var(--txt);
}
.compare-board {
  position: absolute;
  z-index: 30;
  top: 24px;
  left: 24px;
  width: min(420px, calc(100vw - 72px));
  padding: 18px;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(15,23,42,0.92), rgba(2,6,23,0.88)),
    rgba(15,23,42,0.86);
  color: var(--txt);
  border: 1px solid rgba(148,163,184,0.22);
  box-shadow: 0 24px 80px rgba(2,6,23,0.48), inset 0 1px 0 rgba(255,255,255,0.05);
  backdrop-filter: blur(18px) saturate(1.12);
}
.compare-board {
  width: min(460px, calc(100vw - 72px));
}
.board-kicker {
  display: inline-flex;
  padding: 4px 9px;
  border-radius: 999px;
  color: #bfdbfe;
  background: rgba(59,130,246,0.18);
  border: 1px solid rgba(147,197,253,0.18);
  font-size: 12px;
  font-weight: 700;
}
.compare-board h2 {
  margin: 12px 0 8px;
  color: #f8fafc;
  font-size: 22px;
  line-height: 1.25;
}
.board-copy {
  margin: 0;
  color: #a8b3c7;
  font-size: 13px;
  line-height: 1.65;
}
.compare-tools .ghost-btn {
  width: auto;
}
.compare-tools .ghost-btn {
  background: rgba(255,255,255,0.06);
  border-color: rgba(148,163,184,0.22);
  color: var(--txt);
}
.narrate-rail {
  position: absolute;
  z-index: 28;
  top: 86px;
  bottom: 18px;
  left: 18px;
  width: min(252px, 26vw);
  display: flex;
  flex-direction: column;
  color: var(--txt);
  pointer-events: auto;
}
.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(148,163,184,0.22);
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(15,23,42,0.84), rgba(2,6,23,0.58));
  box-shadow: 0 14px 36px rgba(2,6,23,0.32), inset 0 1px 0 rgba(255,255,255,0.06);
  backdrop-filter: blur(14px);
}
.rail-head span {
  color: #dbeafe;
  font-size: 13px;
  font-weight: 700;
}
.rail-head strong {
  color: #93c5fd;
  font-size: 12px;
  font-weight: 800;
  font-feature-settings: 'tnum';
}
.rail-list {
  list-style: none;
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0 3px 0 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(147,197,253,0.45) transparent;
}
.rail-list::-webkit-scrollbar { width: 4px; }
.rail-list::-webkit-scrollbar-thumb { background: rgba(147,197,253,0.45); border-radius: 999px; }
.rail-card {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  min-height: 58px;
  padding: 8px 9px;
  border: 1px solid rgba(148,163,184,0.16);
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(15,23,42,0.66), rgba(15,23,42,0.36));
  box-shadow: 0 12px 30px rgba(2,6,23,0.28), inset 0 1px 0 rgba(255,255,255,0.04);
  backdrop-filter: blur(12px);
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.rail-card:hover {
  transform: translateX(2px);
  border-color: rgba(125,211,252,0.42);
  background: linear-gradient(135deg, rgba(30,41,59,0.76), rgba(15,23,42,0.48));
}
.rail-card.active {
  border-color: rgba(56,189,248,0.76);
  background: linear-gradient(135deg, rgba(14,165,233,0.28), rgba(15,23,42,0.58));
  box-shadow: 0 14px 36px rgba(14,165,233,0.24), inset 0 1px 0 rgba(255,255,255,0.08);
}
.rail-index {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  box-shadow: 0 8px 20px rgba(37,99,235,0.28);
}
.rail-card.role-core .rail-index { background: linear-gradient(135deg, #fb7185, #dc2626); }
.rail-card.role-cultural .rail-index { background: linear-gradient(135deg, #c084fc, #7e22ce); }
.rail-card.role-landmark .rail-index { background: linear-gradient(135deg, #34d399, #059669); }
.rail-card.role-ecological .rail-index { background: linear-gradient(135deg, #22c55e, #047857); }
.rail-card.role-related .rail-index { background: linear-gradient(135deg, #facc15, #d97706); }
.rail-card.role-educational .rail-index { background: linear-gradient(135deg, #60a5fa, #2563eb); }
.rail-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.rail-copy strong {
  overflow: hidden;
  color: #f8fafc;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rail-copy span {
  overflow: hidden;
  color: #a8b3c7;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rail-count {
  min-width: 24px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 999px;
  color: #e0f2fe;
  font-size: 11px;
  font-weight: 800;
  background: rgba(2,6,23,0.52);
  border: 1px solid rgba(125,211,252,0.28);
}
.rail-empty {
  display: grid;
  gap: 4px;
  padding: 16px;
  border: 1px solid rgba(148,163,184,0.18);
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(15,23,42,0.72), rgba(15,23,42,0.42));
  backdrop-filter: blur(12px);
}
.rail-empty strong { color: #f8fafc; font-size: 13px; }
.rail-empty span { color: #a8b3c7; font-size: 12px; line-height: 1.5; }
.vertical-narration {
  position: absolute;
  z-index: 29;
  top: 96px;
  right: 74px;
  bottom: 82px;
  width: min(420px, 36vw);
  display: flex;
  flex-direction: row-reverse;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 12px;
  padding: 4px 0;
  overflow-x: auto;
  overflow-y: hidden;
  pointer-events: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(252,211,77,0.5) transparent;
  user-select: none;
  -webkit-user-select: none;
}
.vertical-narration::-webkit-scrollbar { height: 4px; }
.vertical-narration::-webkit-scrollbar-thumb { background: rgba(252,211,77,0.5); border-radius: 999px; }
.vertical-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  flex: 0 0 auto;
  color: #22d3ee;
  font-family: SimSun, '宋体', serif;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: 0.12em;
  text-shadow: 0 2px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95);
}
.vertical-copy {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  flex: 0 0 auto;
  max-height: 100%;
  min-width: 0;
  margin: 0;
  overflow: visible;
  color: #fff4a3;
  font-family: SimSun, '宋体', serif;
  font-size: clamp(18px, 1.62vw, 24px);
  font-weight: 800;
  line-height: 1.62;
  letter-spacing: 0.06em;
  text-shadow: 0 2px 4px rgba(0,0,0,0.96), 0 0 2px rgba(0,0,0,0.95);
}
.vertical-source-mark {
  pointer-events: auto;
  color: #67e8f9;
  font-size: 0.66em;
  font-weight: 900;
  text-decoration: none;
  text-combine-upright: all;
  text-shadow: 0 2px 4px rgba(0,0,0,0.98), 0 0 2px rgba(0,0,0,0.95);
}
.vertical-source-mark:hover {
  color: #fff;
  text-shadow: 0 2px 4px rgba(0,0,0,0.98), 0 0 6px rgba(103,232,249,0.86);
}
.vertical-cursor {
  color: #fb7185;
  text-shadow: 0 2px 4px rgba(0,0,0,0.98);
}
.vertical-source-preview {
  position: absolute;
  right: 0;
  bottom: 0;
  width: min(300px, 30vw);
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid rgba(103,232,249,0.34);
  border-radius: 12px;
  background: rgba(15,23,42,0.76);
  box-shadow: 0 12px 30px rgba(2,6,23,0.24);
  color: #e0f2fe;
  text-decoration: none;
  backdrop-filter: blur(8px);
}
.preview-index {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(14,165,233,0.24);
  color: #67e8f9;
  font-size: 12px;
  font-weight: 900;
}
.preview-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.preview-copy strong {
  overflow: hidden;
  color: #f8fafc;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.preview-copy span {
  color: #93c5fd;
  font-size: 11px;
}
.preview-copy em {
  display: -webkit-box;
  overflow: hidden;
  color: #cbd5e1;
  font-size: 11px;
  font-style: normal;
  line-height: 1.35;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.main-grid.mode-narrate :deep(.assistant-fab) {
  right: 20px;
  bottom: 20px;
  z-index: 34;
}
.compare-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.compare-ideas {
  margin: 14px 0 0;
  padding-left: 18px;
  color: #cbd5e1;
  font-size: 13px;
  line-height: 1.7;
}
.compare-ideas li + li {
  margin-top: 6px;
}

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
  appearance: none;
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
.source-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 3px;
  border-radius: 999px;
  color: #bfdbfe;
  background: rgba(59,130,246,0.28);
  border: 1px solid rgba(147,197,253,0.35);
  font-size: 9px;
  line-height: 1;
  text-decoration: none;
  vertical-align: super;
}
.source-mark:hover {
  color: #fff;
  border-color: rgba(147,197,253,0.75);
  background: rgba(59,130,246,0.45);
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(148,163,184,0.16);
}
.source-list a {
  color: var(--txt-mute);
  font-size: 11px;
  line-height: 1.4;
  text-decoration: none;
}
.source-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 6px;
  border-radius: 6px;
}
.source-item.active {
  background: rgba(59,130,246,0.10);
}
.source-item-title {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-list a:hover { color: #bfdbfe; }
.source-meta {
  color: #93c5fd;
  font-size: 10px;
}
.source-list sup {
  margin-right: 5px;
  color: #93c5fd;
}
.source-summary {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--txt-faint);
  font-size: 10.5px;
  line-height: 1.45;
}
.source-empty {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(148,163,184,0.16);
  color: var(--txt-faint);
  font-size: 11px;
  line-height: 1.5;
}
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
.playback-hint {
  margin-top: 8px;
  color: var(--txt-mute);
  font-size: 11px;
  line-height: 1.45;
}

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
/* 响应式：1280 以下收起左面板宽度，1080 以下右面板缩窄 */
@media (max-width: 1280px) {
  .main-grid { grid-template-columns: 270px 1fr 290px; }
}
@media (max-width: 1080px) {
  .main-grid { grid-template-columns: 240px 1fr 260px; }
  .topbar { grid-template-columns: 240px 1fr 240px; }
}
</style>
