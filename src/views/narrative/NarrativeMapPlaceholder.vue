<template>
  <main class="map-stage map-stage-placeholder">
    <div class="placeholder-map-surface">
      <div class="placeholder-grid" />
      <div class="placeholder-path" />
      <div class="placeholder-point p1" />
      <div class="placeholder-point p2" />
      <div class="placeholder-point p3" />
      <div class="placeholder-card">
        <strong>地图底图加载中</strong>
        <span>主界面已就绪，正在加载空间图层</span>
      </div>
    </div>

    <div class="coverage-card collapsed">
      <div class="coverage-head">
        <span>当前视角覆盖分析</span>
        <div class="coverage-head-actions">
          <span class="card-help">?</span>
          <button type="button" class="coverage-toggle" disabled>⌄</button>
        </div>
      </div>
    </div>

    <div class="map-controls">
      <button class="map-ctl" disabled>⌖</button>
      <div class="zoom-stack">
        <button class="map-ctl" disabled>+</button>
        <button class="map-ctl" disabled>−</button>
      </div>
      <button class="map-ctl active" disabled>2D</button>
      <button class="map-ctl" disabled>⌾</button>
      <button class="map-ctl layer-toggle active" disabled>
        <span>▱</span>
        <span class="layer-tag">影像</span>
      </button>
    </div>

    <button
      v-show="!assistantOpen"
      class="assistant-fab"
      type="button"
      title="AI 助手（Alt+A）"
      @click="$emit('open-assistant')"
    >
      <span class="fab-letters">AI</span>
    </button>
  </main>
</template>

<script setup lang="ts">
defineProps<{
  assistantOpen: boolean
}>()

defineEmits<{
  (event: 'open-assistant'): void
}>()
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

.map-stage-placeholder {
  isolation: isolate;
}

.placeholder-map-surface {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 32% 42%, rgba(59,130,246,0.24), transparent 24%),
    radial-gradient(circle at 68% 58%, rgba(16,185,129,0.18), transparent 28%),
    linear-gradient(135deg, #10182a 0%, #0b1120 48%, #111827 100%);
}

.placeholder-grid {
  position: absolute;
  inset: -20%;
  opacity: 0.18;
  background-image:
    linear-gradient(rgba(148,163,184,0.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148,163,184,0.18) 1px, transparent 1px);
  background-size: 52px 52px;
}

.placeholder-path {
  position: absolute;
  left: 16%;
  right: 18%;
  top: 52%;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(96,165,250,0.85), rgba(34,197,94,0.72), transparent);
  transform: rotate(-9deg);
}

.placeholder-point {
  position: absolute;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #60a5fa;
  box-shadow: 0 0 20px rgba(96,165,250,0.75);
}

.placeholder-point.p1 { left: 29%; top: 45%; }
.placeholder-point.p2 { left: 52%; top: 53%; background: #22c55e; }
.placeholder-point.p3 { left: 71%; top: 39%; background: #f97316; }

.placeholder-card {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 220px;
  padding: 14px 18px;
  border-radius: 12px;
  color: var(--txt);
  background: rgba(19,25,39,0.92);
  border: 1px solid var(--bd);
  transform: translate(-50%, -50%);
}

.placeholder-card strong {
  font-size: 14px;
}

.placeholder-card span {
  font-size: 12px;
  color: var(--txt-mute);
}

.coverage-card {
  position: absolute; top: 14px; left: 14px;
  width: 220px;
  background: var(--bg-overlay);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 10px 12px;
  z-index: 5;
}

.coverage-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; font-weight: 600;
}

.coverage-head-actions { display: flex; align-items: center; gap: 6px; }

.card-help {
  width: 16px; height: 16px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  color: var(--txt-mute);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px;
}

.coverage-toggle {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid var(--bd);
  border-radius: 5px;
  color: var(--txt-mute);
  padding: 0;
}

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
  border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600;
  opacity: 0.72;
}

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

.map-ctl.layer-toggle .layer-tag {
  font-size: 10px;
  font-weight: 500;
  color: #fff;
  letter-spacing: 0.5px;
}

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
}

.fab-letters {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.6px;
  line-height: 1;
}
</style>
