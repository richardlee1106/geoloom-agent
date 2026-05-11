<template>
  <footer :class="['bottom-bar', { empty: pathNodes.length === 0 }]">
    <div class="timeline-wrap">
      <button v-if="pathNodes.length" class="tl-arrow" @click="$emit('previous')"><span v-html="ICONS.chevronLeft" /></button>
      <ul v-if="pathNodes.length" ref="timelineEl" class="timeline" @wheel.prevent="onTimelineWheel">
        <li
          v-for="(node, i) in pathNodes"
          :key="`tl-${node.region_id}`"
          :class="['tl-card', { active: i === activeStepIndex }]"
          @click="$emit('go-to-step', i)"
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
          <div class="tl-name">{{ i + 1 }} {{ node.display_name || node.region_id }}</div>
          <div class="tl-sub">{{ subtitleForRole(node.narration_role) }}</div>
        </li>
      </ul>
      <div v-else class="timeline-empty">
        <span class="empty-orb" />
        <div class="empty-copy">
          <strong>等待生成解说路线</strong>
          <span>点击“分析当前视野”后，这里会展示章节路径与播放进度。</span>
        </div>
      </div>
      <button v-if="pathNodes.length" class="tl-arrow" @click="$emit('next')"><span v-html="ICONS.chevronRight" /></button>
    </div>

    <div :class="['bottom-progress', { idle: pathNodes.length === 0 }]">
      <div class="player-controls">
        <button class="player-btn" :disabled="pathNodes.length === 0" @click="$emit('rewind')"><span v-html="ICONS.rewind" /></button>
        <button class="player-btn" :disabled="pathNodes.length === 0" @click="$emit('previous')"><span v-html="ICONS.skipBack" /></button>
        <button class="player-btn primary" :disabled="pathNodes.length === 0" @click="$emit('toggle-play')"><span v-html="playing ? ICONS.pause : ICONS.play" /></button>
        <button class="player-btn" :disabled="pathNodes.length === 0" @click="$emit('next')"><span v-html="ICONS.skipForward" /></button>
        <button class="player-btn" :disabled="pathNodes.length === 0" @click="$emit('forward')"><span v-html="ICONS.forward" /></button>
        <button class="player-btn restart" :disabled="pathNodes.length === 0" title="重新播放" @click="$emit('restart')"><span v-html="ICONS.restart" /></button>
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
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import type { NarrativeDisplayPathNode } from './narrativeResponseAdapter'
import type { PathNarrationRole, VisualTier } from './types'

interface TimelineDot {
  key: string
  x: number
  y: number
  tier: VisualTier
}

const props = defineProps<{
  pathNodes: NarrativeDisplayPathNode[]
  activeStepIndex: number
  playing: boolean
  progressPercent: number
  elapsedMs: number
  totalDurationMs: number
  timelineDotsByRegion: Record<string, TimelineDot[]>
}>()

const emit = defineEmits<{
  (event: 'previous'): void
  (event: 'restart'): void
  (event: 'next'): void
  (event: 'rewind'): void
  (event: 'forward'): void
  (event: 'toggle-play'): void
  (event: 'go-to-step', index: number): void
  (event: 'seek-ratio', ratio: number): void
}>()

const timelineEl = ref<HTMLUListElement | null>(null)

const ROLE_SUBTITLE: Record<PathNarrationRole, string> = {
  core: '核心解说点',
  related: '关联区域',
  cultural: '历史文化区',
  landmark: '城市地标',
  educational: '百年学府',
  ecological: '自然休闲空间'
}

const ICONS = {
  rewind: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="11 19 2 12 11 5"/><polygon points="22 19 13 12 22 5"/></svg>`,
  forward: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="13 5 22 12 13 19"/><polygon points="2 5 11 12 2 19"/></svg>`,
  skipBack: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="19 20 9 12 19 4"/><rect x="5" y="4" width="2" height="16"/></svg>`,
  skipForward: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 4 15 12 5 20"/><rect x="17" y="4" width="2" height="16"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6 4 20 12 6 20"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`
}

function scrollTimelineToActive() {
  scrollTimelineCardToCenter(props.activeStepIndex, 'smooth')
}

function scrollTimelineCardToCenter(index: number, behavior: ScrollBehavior) {
  const container = timelineEl.value
  if (!container) return
  const cards = container.querySelectorAll<HTMLElement>('.tl-card')
  const card = cards[index]
  if (!card) return
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth)
  const targetLeft = card.offsetLeft - (container.clientWidth - card.clientWidth) / 2
  container.scrollTo({ left: Math.min(maxLeft, Math.max(0, targetLeft)), behavior })
}

function onTimelineWheel(e: WheelEvent) {
  const container = timelineEl.value
  if (!container) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  container.scrollBy({ left: delta, behavior: 'auto' })
}

function onSeek(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  emit('seek-ratio', ratio)
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

function subtitleForRole(role: PathNarrationRole): string {
  return ROLE_SUBTITLE[role] ?? ''
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

watch(() => props.activeStepIndex, () => {
  nextTick(scrollTimelineToActive)
})

watch(() => props.pathNodes.length, (length) => {
  if (length === 0) return
  nextTick(scrollTimelineToActive)
})
</script>

<style scoped>
.bottom-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 390px);
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(15, 23, 42, 0.72)),
    radial-gradient(circle at 12% 0%, rgba(59, 130, 246, 0.2), transparent 34%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(18px);
  min-height: 0;
  min-width: 0;
}

.bottom-bar.empty {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  padding: 12px 14px;
}

.timeline-wrap {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bottom-bar.empty .timeline-wrap {
  grid-template-columns: minmax(0, 1fr);
}

.tl-arrow {
  width: 30px;
  height: 30px;
  background: rgba(15, 23, 42, 0.58);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: var(--txt-mute);
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tl-arrow:hover {
  color: #fff;
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.38);
}

.timeline {
  --tl-card-width: 124px;
  --tl-edge-padding: max(8px, calc((100% - var(--tl-card-width)) / 2));
  list-style: none;
  padding: 3px var(--tl-edge-padding);
  margin: 0;
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-behavior: smooth;
  overscroll-behavior-inline: contain;
}

.timeline::-webkit-scrollbar {
  display: none;
}

.tl-card {
  flex: 0 0 124px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 13px;
  padding: 6px;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.tl-card:hover {
  transform: translateY(-1px);
  background: rgba(30, 41, 59, 0.72);
  border-color: rgba(96, 165, 250, 0.42);
}

.tl-card.active {
  border-color: rgba(96, 165, 250, 0.72);
  background: rgba(37, 99, 235, 0.16);
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.tl-thumb {
  position: relative;
  height: 54px;
  border-radius: 10px;
  overflow: hidden;
}

.timeline-empty {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 66px;
  padding: 0 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 15px;
  background: linear-gradient(90deg, rgba(15, 23, 42, 0.44), rgba(30, 41, 59, 0.24));
}

.empty-orb {
  position: relative;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 28%, #93c5fd, #2563eb 58%, #1e3a8a);
  box-shadow: 0 0 24px rgba(59, 130, 246, 0.34);
}

.empty-orb::after {
  content: '';
  position: absolute;
  inset: 9px;
  border-radius: inherit;
  border: 1px solid rgba(255, 255, 255, 0.72);
}

.empty-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.empty-copy strong {
  color: #e5edff;
  font-size: 13px;
  font-weight: 700;
}

.empty-copy span {
  color: var(--txt-mute);
  font-size: 12px;
}

.tl-dot {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.86);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.tl-dot.tier-core {
  width: 8px;
  height: 8px;
  background: #ef4444;
}

.tl-dot.tier-strong {
  background: #f97316;
}

.tl-dot.tier-medium {
  background: #eab308;
}

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
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.45);
}

.tl-no {
  position: absolute;
  top: 5px;
  left: 6px;
  width: 18px;
  height: 18px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.tl-tag-mini {
  position: absolute;
  top: 5px;
  right: 5px;
  font-size: 10px;
  padding: 1px 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border-radius: 4px;
}

.tl-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--txt);
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl-sub {
  font-size: 10.5px;
  color: var(--txt-mute);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bottom-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.34);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.bottom-progress.idle {
  opacity: 0.78;
}

.player-controls {
  display: flex;
  gap: 7px;
  justify-content: center;
  align-items: center;
}

.player-btn {
  width: 30px;
  height: 30px;
  background: rgba(15, 23, 42, 0.54);
  color: var(--txt-mute);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.player-btn:hover {
  color: #fff;
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.38);
}

.player-btn:disabled {
  cursor: default;
  color: rgba(148, 163, 184, 0.42);
  background: rgba(15, 23, 42, 0.24);
  border-color: rgba(148, 163, 184, 0.1);
}

.player-btn:disabled:hover {
  transform: none;
}

.player-btn.primary {
  background: linear-gradient(180deg, #3b82f6, #2563eb);
  color: #fff;
  border-color: rgba(59, 130, 246, 0.6);
  width: 38px;
  height: 38px;
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.34);
}

.player-btn.primary:disabled {
  background: rgba(37, 99, 235, 0.22);
  color: rgba(191, 219, 254, 0.56);
  box-shadow: none;
}

.progress-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  align-items: center;
  font-size: 11px;
  color: var(--txt-mute);
}

.progress-track {
  position: relative;
  height: 5px;
  background: rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  cursor: pointer;
  overflow: visible;
}

.bottom-progress.idle .progress-track {
  pointer-events: none;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: linear-gradient(90deg, #60a5fa, #2563eb);
  border-radius: 999px;
}

.progress-knob {
  position: absolute;
  top: -4.5px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transform: translateX(-50%);
  border: 3px solid #3b82f6;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.progress-time {
  font-feature-settings: 'tnum';
}

.progress-rate {
  color: var(--txt-faint);
}

@media (max-width: 1280px) {
  .bottom-bar { grid-template-columns: minmax(0, 1fr) minmax(300px, 360px); }
}

@media (max-width: 1080px) {
  .bottom-bar {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .bottom-progress {
    max-width: none;
  }
}
</style>
