<template>
  <div class="narrative-shell-host">
    <Suspense>
      <NarrativeMode />
      <template #fallback>
        <div class="narrative-shell-skeleton">
          <header class="shell-topbar">
            <div class="shell-brand">
              <span class="shell-brand-mark">
                <svg viewBox="0 0 28 28" width="28" height="28" focusable="false">
                  <path d="M14 2C9.03 2 5 5.8 5 10.5 5 17 14 26 14 26s9-9 9-15.5C23 5.8 18.97 2 14 2z" fill="#60a5fa" opacity="0.88" />
                  <circle cx="14" cy="10.5" r="5" fill="#131927" />
                  <path d="M12 8.2v4.6l4-2.3z" fill="#60a5fa" />
                </svg>
              </span>
              <div>
                <strong>智能地图解说引擎</strong>
                <span>正在加载 narrative 工作台</span>
              </div>
            </div>
            <div class="shell-tabs">
              <span />
              <span />
              <span />
            </div>
          </header>

          <main class="shell-grid">
            <aside class="shell-panel">
              <span class="shell-card title" />
              <span class="shell-card" />
              <span class="shell-card" />
              <span class="shell-card short" />
            </aside>
            <section class="shell-map">
              <div class="shell-map-glow" />
              <div class="shell-map-card">
                <strong>工作台加载中</strong>
                <span>先打开叙事界面，地图底图随后加载</span>
              </div>
            </section>
            <aside class="shell-panel">
              <span class="shell-card title" />
              <span class="shell-card tall" />
              <span class="shell-card" />
            </aside>
          </main>
        </div>
      </template>
    </Suspense>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

const NarrativeMode = defineAsyncComponent(() => import('./NarrativeMode.vue'))
</script>

<style scoped>
.narrative-shell-host {
  min-height: 100vh;
  background: #070b14;
}

.narrative-shell-skeleton {
  min-height: 100vh;
  padding: 12px;
  color: #e5edff;
  background:
    radial-gradient(circle at 50% 35%, rgba(59, 130, 246, 0.22), transparent 42%),
    linear-gradient(135deg, #070b14 0%, #0b1220 48%, #060913 100%);
  box-sizing: border-box;
}

.shell-topbar {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.78);
}

.shell-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.shell-brand-mark {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.shell-brand strong,
.shell-brand span {
  display: block;
}

.shell-brand strong {
  font-size: 15px;
}

.shell-brand span {
  margin-top: 3px;
  font-size: 12px;
  color: #93a4c7;
}

.shell-tabs {
  display: flex;
  gap: 8px;
}

.shell-tabs span {
  width: 84px;
  height: 26px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
}

.shell-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 320px;
  gap: 12px;
  height: calc(100vh - 80px);
  margin-top: 12px;
}

.shell-panel,
.shell-map {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.72);
  overflow: hidden;
}

.shell-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.shell-card {
  height: 84px;
  border-radius: 14px;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0.10), rgba(96, 165, 250, 0.16), rgba(148, 163, 184, 0.10));
  background-size: 220% 100%;
  animation: shell-shimmer 1.3s ease-in-out infinite;
}

.shell-card.title {
  height: 42px;
}

.shell-card.short {
  height: 56px;
}

.shell-card.tall {
  height: 180px;
}

.shell-map {
  position: relative;
  display: grid;
  place-items: center;
  background:
    linear-gradient(rgba(96, 165, 250, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(96, 165, 250, 0.07) 1px, transparent 1px),
    radial-gradient(circle at 50% 45%, rgba(59, 130, 246, 0.18), transparent 42%),
    #08111f;
  background-size: 42px 42px, 42px 42px, auto, auto;
}

.shell-map-glow {
  position: absolute;
  width: 42%;
  aspect-ratio: 1;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  box-shadow: 0 0 60px rgba(59, 130, 246, 0.22);
  animation: shell-pulse 1.8s ease-in-out infinite;
}

.shell-map-card {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 8px;
  padding: 18px 22px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.72);
  text-align: center;
}

.shell-map-card strong {
  font-size: 16px;
}

.shell-map-card span {
  font-size: 12px;
  color: #93a4c7;
}

@keyframes shell-shimmer {
  0% { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}

@keyframes shell-pulse {
  0%, 100% { transform: scale(0.96); opacity: 0.65; }
  50% { transform: scale(1.04); opacity: 1; }
}
</style>
