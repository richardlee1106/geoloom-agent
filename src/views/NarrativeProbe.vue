<template>
  <div class="probe-root">
    <header class="probe-header">
      <div class="header-top">
        <button class="back-btn" @click="goBack">← 返回</button>
        <h1>Narrative Probe · 视口数据诊断</h1>
      </div>
      <div class="viewport-row">
        <label>swLon <input v-model.number="swLon" type="number" step="0.0001" /></label>
        <label>swLat <input v-model.number="swLat" type="number" step="0.0001" /></label>
        <label>neLon <input v-model.number="neLon" type="number" step="0.0001" /></label>
        <label>neLat <input v-model.number="neLat" type="number" step="0.0001" /></label>
        <button @click="loadFromStorage" class="ghost-btn">从 NarrativeMode 读取</button>
      </div>
      <div class="controls-row">
        <label class="checkbox"><input type="checkbox" v-model="includeEncoder" /> 同时调用 encoder</label>
        <label>topRaw <input v-model.number="topRaw" type="number" min="5" max="60" /></label>
        <button @click="runProbe" :disabled="loading" class="primary-btn">
          {{ loading ? '诊断中...' : 'Probe 当前视口' }}
        </button>
      </div>
      <p class="hint" v-if="result">
        center [{{ result.center.lon.toFixed(5) }}, {{ result.center.lat.toFixed(5) }}]
        · diagonal {{ Math.round(result.diagonalM) }} m
        · version {{ result.version }}
      </p>
      <p class="error" v-if="errorMsg">{{ errorMsg }}</p>
    </header>

    <section v-if="result" class="probe-body">
      <!-- 诊断备注 -->
      <div v-if="result.diagnostics.notes.length > 0" class="block notes-block">
        <h3>诊断备注</h3>
        <ul>
          <li v-for="(n, i) in result.diagnostics.notes" :key="i">{{ n }}</li>
        </ul>
      </div>

      <!-- 排名结果（最重要，放最上面） -->
      <div class="block">
        <h2>
          排名结果 ({{ result.ranked.selected.length }} / limit {{ result.ranked.limit }})
          <span class="tag">mode: {{ result.ranked.mode }}</span>
        </h2>
        <ol class="ranked-list">
          <li v-for="n in result.ranked.selected" :key="n.id" class="ranked-item">
            <div class="ranked-head">
              <span class="rank-name">{{ n.name }}</span>
              <span class="tag">{{ n.roleLabel }}</span>
              <span class="tag tag-src" :class="`src-${n.source}`">{{ sourceLabel(n.source) }}</span>
              <span class="score">score {{ n.score }}</span>
            </div>
            <div class="rank-meta">
              <span>categorySub: {{ n.categorySub || '-' }}</span>
              <span>center: [{{ n.center.lon.toFixed(4) }}, {{ n.center.lat.toFixed(4) }}]</span>
              <span v-if="n.childPoiIds?.length">members: {{ n.childPoiIds.length }}</span>
            </div>
          </li>
        </ol>
      </div>

      <!-- 候选节点汇总 -->
      <div class="block">
        <h2>候选池汇总 · total {{ result.candidates.total }}</h2>
        <div class="grid-2">
          <div>
            <h4>bySource</h4>
            <table class="mini-table">
              <tr v-for="(v, k) in result.candidates.bySource" :key="k">
                <td>{{ k }}</td><td>{{ v }}</td>
              </tr>
            </table>
          </div>
          <div>
            <h4>byRole</h4>
            <table class="mini-table">
              <tr v-for="(v, k) in result.candidates.byRole" :key="k">
                <td>{{ k }}</td><td>{{ v }}</td>
              </tr>
            </table>
          </div>
        </div>
        <details>
          <summary>展开全部候选节点</summary>
          <table class="data-table">
            <thead><tr><th>name</th><th>role</th><th>source</th><th>score</th><th>categorySub</th><th>selected</th></tr></thead>
            <tbody>
              <tr v-for="n in result.candidates.items" :key="n.id"
                :class="{ 'row-selected': isSelected(n.id), 'row-dropped': result.ranked.droppedIds.includes(n.id) }">
                <td>{{ n.name }}</td>
                <td>{{ n.roleLabel }}</td>
                <td>{{ sourceLabel(n.source) }}</td>
                <td>{{ n.score }}</td>
                <td>{{ n.categorySub || '-' }}</td>
                <td>{{ isSelected(n.id) ? '✓' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>

      <!-- 品牌聚合 -->
      <div class="block">
        <h2>品牌聚合</h2>
        <div class="bucket-summary">
          <span>eligible {{ result.brandAggregation.eligibleClusters.length }}</span>
          <span>ineligible {{ result.brandAggregation.ineligibleClusters.length }}</span>
          <span>covered POI ids: {{ result.brandAggregation.coveredPoiIds.length }}</span>
        </div>
        <details open>
          <summary>eligibleClusters（已成为节点）</summary>
          <div v-for="c in result.brandAggregation.eligibleClusters" :key="`${c.type}:${c.brand}`" class="cluster-item">
            <div class="cluster-head">
              <strong>{{ c.brand }}</strong>
              <span class="tag" :class="`brand-${c.type}`">{{ c.type }}</span>
              <span>count {{ c.count }}</span>
            </div>
            <div class="cluster-members">
              <span v-for="m in c.members" :key="m.id ?? m.name" class="member-chip">{{ m.name }}</span>
            </div>
          </div>
        </details>
        <details>
          <summary>ineligibleClusters（未达阈值）</summary>
          <div v-for="c in result.brandAggregation.ineligibleClusters" :key="`${c.type}:${c.brand}`" class="cluster-item">
            <div class="cluster-head">
              <strong>{{ c.brand }}</strong>
              <span class="tag" :class="`brand-${c.type}`">{{ c.type }}</span>
              <span>count {{ c.count }}</span>
            </div>
          </div>
        </details>
      </div>

      <!-- 原始数据 -->
      <div class="block">
        <h2>原始召回</h2>
        <details open>
          <summary>representativeSamples · {{ result.raw.representativeSamples.length }}</summary>
          <table class="data-table">
            <thead>
              <tr><th>name</th><th>category_main</th><th>category_sub</th><th>anchor_priority</th><th>distance_m</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in result.raw.representativeSamples" :key="i">
                <td>{{ r.name }}</td>
                <td>{{ r.category_main || '-' }}</td>
                <td>{{ r.category_sub || '-' }}</td>
                <td>{{ r.anchor_priority ?? '-' }}</td>
                <td>{{ r.distance_m?.toFixed(0) ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <details open>
          <summary>brandPool · {{ result.raw.brandPool.length }}（按 bucket 排序）</summary>
          <table class="data-table">
            <thead><tr><th>name</th><th>brand_bucket</th><th>category_sub</th><th>distance_m</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.raw.brandPool" :key="i">
                <td>{{ r.name }}</td>
                <td><span class="tag" :class="`brand-${r.brand_bucket}`">{{ r.brand_bucket }}</span></td>
                <td>{{ r.category_sub || '-' }}</td>
                <td>{{ r.distance_m?.toFixed(0) ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <details>
          <summary>aoiContext · {{ result.raw.aoiContext.length }}</summary>
          <table class="data-table">
            <thead><tr><th>name</th><th>fclass</th><th>code</th><th>population</th><th>area_sqm</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.raw.aoiContext" :key="i">
                <td>{{ r.name }}</td>
                <td>{{ r.fclass || '-' }}</td>
                <td>{{ r.code || '-' }}</td>
                <td>{{ r.population ?? '-' }}</td>
                <td>{{ r.area_sqm?.toFixed(0) ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <details>
          <summary>categoryHistogram · {{ result.raw.categoryHistogram.length }}</summary>
          <pre class="json-preview">{{ JSON.stringify(result.raw.categoryHistogram, null, 2) }}</pre>
        </details>
      </div>

      <!-- encoder 信号 -->
      <div class="block" v-if="result.encoder">
        <h2>Encoder 信号</h2>
        <p v-if="!result.encoder.available" class="error">Encoder 调用失败或不可用。</p>
        <div v-else>
          <p><strong>regionSummary:</strong> {{ result.encoder.regionSummary || '-' }}</p>
          <p><strong>sceneTags:</strong> {{ result.encoder.sceneTags.join(', ') || '-' }}</p>
          <p><strong>dominantBuckets:</strong> {{ result.encoder.dominantBuckets.join(', ') || '-' }}</p>
          <details>
            <summary>regionTags ({{ result.encoder.regionTags.length }})</summary>
            <pre class="json-preview">{{ JSON.stringify(result.encoder.regionTags, null, 2) }}</pre>
          </details>
          <details>
            <summary>cells ({{ result.encoder.cells.length }})</summary>
            <pre class="json-preview">{{ JSON.stringify(result.encoder.cells, null, 2) }}</pre>
          </details>
        </div>
      </div>

      <div class="block">
        <details>
          <summary>完整 JSON（复制给 AI 辅助分析）</summary>
          <pre class="json-preview">{{ fullJson }}</pre>
        </details>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

const swLon = ref(null);
const swLat = ref(null);
const neLon = ref(null);
const neLat = ref(null);
const includeEncoder = ref(true);
const topRaw = ref(20);
const loading = ref(false);
const errorMsg = ref('');
const result = ref(null);

const STORAGE_KEY = 'narrativeLastViewport';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      errorMsg.value = '未在 localStorage 找到 narrativeLastViewport。请先去 NarrativeMode 页面生成过一次导览。';
      return;
    }
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length < 4) {
      errorMsg.value = 'localStorage 里的视口格式不正确。';
      return;
    }
    swLon.value = Number(arr[0]);
    swLat.value = Number(arr[1]);
    neLon.value = Number(arr[2]);
    neLat.value = Number(arr[3]);
    errorMsg.value = '';
  } catch (e) {
    errorMsg.value = `读取 localStorage 失败：${e.message}`;
  }
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

async function runProbe() {
  if (!isValidNumber(swLon.value) || !isValidNumber(swLat.value) || !isValidNumber(neLon.value) || !isValidNumber(neLat.value)) {
    errorMsg.value = '请先填完整 viewport 四个数值，或点击"从 NarrativeMode 读取"。';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  result.value = null;
  try {
    const resp = await fetch('/api/geo/narrative/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        viewport: [swLon.value, swLat.value, neLon.value, neLat.value],
        includeEncoder: includeEncoder.value,
        topRaw: topRaw.value,
      }),
    });
    const payload = await resp.json();
    if (!resp.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${resp.status}`);
    }
    result.value = payload.data;
  } catch (e) {
    errorMsg.value = `Probe 失败：${e.message}`;
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push('/narrative');
}

function sourceLabel(src) {
  if (src === 'brand_cluster') return '品牌';
  if (src === 'representative_sample') return 'POI/Cell';
  if (src === 'aoi_context') return 'AOI';
  return src;
}

function isSelected(id) {
  if (!result.value) return false;
  return result.value.ranked.selected.some((n) => n.id === id);
}

const fullJson = computed(() => {
  if (!result.value) return '';
  return JSON.stringify(result.value, null, 2);
});

onMounted(() => {
  loadFromStorage();
  const params = new URLSearchParams(window.location.search);
  if (params.get('auto') === '1' && isValidNumber(swLon.value)) {
    runProbe();
  }
});
</script>

<style scoped>
.probe-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  padding: 24px;
  font-family: 'Inter', 'Noto Sans SC', sans-serif;
  background: #f5f5f7;
  color: #1a1a1a;
  overflow-y: auto;
  z-index: 999999;
  box-sizing: border-box;
}

.probe-header {
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  margin-bottom: 20px;
}

.header-top { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.back-btn {
  padding: 6px 12px; border: 1px solid #ddd; border-radius: 6px;
  background: white; cursor: pointer;
}
.probe-header h1 { font-size: 18px; margin: 0; font-weight: 600; }

.viewport-row, .controls-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.viewport-row label, .controls-row label { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #555; }
.viewport-row input, .controls-row input[type="number"] { width: 110px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; }
.checkbox { cursor: pointer; }

.primary-btn {
  padding: 8px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;
}
.primary-btn:disabled { background: #9ca3af; cursor: not-allowed; }
.ghost-btn { padding: 6px 12px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; cursor: pointer; font-size: 12px; }

.hint { font-size: 12px; color: #666; margin: 8px 0 0; font-family: monospace; }
.error { color: #dc2626; font-size: 13px; margin: 8px 0 0; }

.probe-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.block { background: white; padding: 18px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
.block h2 { font-size: 16px; margin: 0 0 12px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
.block h3 { font-size: 14px; margin: 0 0 10px; font-weight: 600; }
.block h4 { font-size: 13px; margin: 6px 0; font-weight: 500; color: #555; }
.notes-block { background: #fef3c7; border: 1px solid #fbbf24; }

.tag {
  background: #e5e7eb; padding: 2px 8px; border-radius: 4px; font-size: 11px; color: #333;
}
.tag-src { background: #ddd6fe; color: #5b21b6; }
.src-brand_cluster { background: #fce7f3; color: #9d174d; }
.brand-campus { background: #dbeafe; color: #1e40af; }
.brand-scenic { background: #d1fae5; color: #065f46; }
.brand-food_street { background: #fed7aa; color: #9a3412; }
.brand-commercial { background: #fef3c7; color: #854d0e; }

.ranked-list { list-style: none; padding: 0; margin: 0; }
.ranked-item { padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; }
.ranked-head { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
.rank-name { font-weight: 600; font-size: 15px; }
.score { color: #999; font-size: 12px; font-family: monospace; margin-left: auto; }
.rank-meta { font-size: 11px; color: #666; display: flex; gap: 14px; flex-wrap: wrap; font-family: monospace; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.mini-table { font-size: 12px; width: 100%; }
.mini-table td { padding: 3px 8px; border-bottom: 1px solid #eee; }
.mini-table td:first-child { color: #555; }
.mini-table td:last-child { font-family: monospace; text-align: right; }

.data-table { width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 8px; }
.data-table th, .data-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #eee; }
.data-table th { background: #f9fafb; font-weight: 500; color: #555; }
.row-selected { background: #ecfdf5; }
.row-dropped { opacity: 0.55; }

.cluster-item { margin: 8px 0; padding: 10px; border-left: 3px solid #ddd6fe; background: #fafbff; border-radius: 4px; }
.cluster-head { display: flex; gap: 10px; align-items: center; font-size: 13px; margin-bottom: 4px; }
.cluster-members { display: flex; flex-wrap: wrap; gap: 4px; }
.member-chip { background: #eef2ff; color: #4338ca; padding: 2px 8px; border-radius: 10px; font-size: 11px; }

.bucket-summary { display: flex; gap: 16px; font-size: 13px; color: #555; margin-bottom: 10px; font-family: monospace; }

.json-preview {
  background: #1e293b; color: #e2e8f0; padding: 12px; border-radius: 6px;
  font-size: 11px; overflow: auto; max-height: 400px; font-family: 'SF Mono', Consolas, monospace;
}

details summary {
  cursor: pointer; padding: 6px 0; font-weight: 500; font-size: 13px; color: #374151;
}
details[open] summary { margin-bottom: 6px; }
</style>
