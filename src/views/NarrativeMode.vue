<template>
  <div class="narrative-mode-container">
    
    <div class="bg-gradient"></div>
    <div class="grid-overlay"></div>
    <div class="floating-orb orb-1"></div>
    <div class="floating-orb orb-2"></div>

    
    <MapContainer 
      ref="mapRef"
      class="background-map"
      :poiFeatures="poiFeatures"
      :filterEnabled="true"
      :globalAnalysisEnabled="true"
      :showControls="false"
      @map-ready="onMapReady"
      @map-move-end="onMapMove"
    />

    
    <div class="narrative-ui">
      
      <div v-if="isPlaying && narrativeSteps.length > 0" class="progress-ring-container">
        <svg width="48" height="48" class="progress-ring-svg">
          <circle class="ring-bg" cx="24" cy="24" r="20"/>
          <circle 
            class="ring-progress" 
            cx="24" cy="24" r="20" 
            :style="{ strokeDashoffset: progressOffset }"
          />
        </svg>
        <div class="progress-text">{{ currentStepIndex + 1 }}/{{ narrativeSteps.length }}</div>
      </div>

      
      <transition name="fade-slide">
        <div v-if="scriptVisible" class="script-panel" :class="{ 'generating': isGenerating }">
          <div class="panel-header">
            <div class="brand-mini">
              <div class="brand-icon-mini">✨</div>
              <div class="brand-text-mini">
                <h1>AI 空间叙事</h1>
                <span>SPACE NARRATIVE</span>
              </div>
            </div>
            <el-button link @click="scriptVisible = false" class="close-btn">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          
          <div class="script-content" ref="scriptContentRef">
            
            <div v-if="aiResponse" class="ai-text-response">
              <div class="response-title">AI 分析报告</div>
              <div class="response-body" v-html="formattedAiResponse"></div>
            </div>

            
            <div v-if="narrativeSteps.length > 0" class="narrative-steps-section">
              <div class="response-title">漫游脚本</div>
              <div class="modern-steps">
                <div 
                  v-for="(step, index) in narrativeSteps" 
                  :key="index"
                  class="modern-step-item"
                  :class="{ 'active': currentStepIndex === index, 'finished': currentStepIndex > index }"
                >
                  <div class="step-line"></div>
                  <div class="step-dot"></div>
                  <div class="step-info">
                    <div class="step-label">STEP {{ index + 1 }}</div>
                    <div class="step-title">
                      {{ step.focus === 'overview' ? '区域全景' : step.focus }}
                    </div>
                    <div v-if="step.tagline && step.focus !== 'overview'" class="step-tagline">{{ step.tagline }}</div>
                  </div>
                </div>
              </div>
            </div>
            
            
            <div v-if="!aiResponse && !isGenerating" class="empty-state">
              <div class="empty-icon">💬</div>
              <p>点击下方按钮，按当前视口生成第一版区域导览骨架。</p>
            </div>

            
            <div v-if="isGenerating" class="loading-state">
              <div class="loader-spinner-mini"></div>
              <span>正在生成区域导览骨架...</span>
            </div>
          </div>

          <div class="panel-footer">
            <div class="action-row">
              <button 
                class="btn-modern btn-generate" 
                :disabled="isGenerating"
                @click="handleGenerate"
              >
                <el-icon v-if="isGenerating" class="is-loading"><Loading /></el-icon>
                <el-icon v-else><MagicStick /></el-icon>
                {{ isGenerating ? '导览生成中...' : '生成导览骨架' }}
              </button>
              <button 
                v-if="narrativeSteps.length > 0" 
                class="btn-modern btn-play-narrative"
                :class="{ 'playing': isPlaying }"
                @click="playNarrative" 
                :disabled="isPlaying"
              >
                <el-icon><VideoPlay /></el-icon>
                {{ isPlaying ? '播放中...' : '开始漫游' }}
              </button>
            </div>
          </div>
        </div>
      </transition>

      
      <transition name="narrator-slide">
        <div v-if="isPlaying && currentVoiceText" class="narrator-panel">
          <div class="narrator-accent-line"></div>
          <div class="narrator-inner">
            <div class="narrator-header">
              <span class="narrator-eyebrow">当前镜头</span>
              <h2 class="narrator-focus">{{ currentNarrativeFocus }}</h2>
            </div>
            <div class="narrator-body">
              <p class="narrator-text">
                {{ typedText }}<span class="typing-cursor"></span>
              </p>
              <div v-if="currentTagline" class="narrator-tagline">
                <span>{{ currentTagline }}</span>
              </div>
              <div v-if="currentWebFactHint" class="narrator-fact">
                <span class="fact-badge">{{ currentWebFactHint }}</span>
              </div>
            </div>
            <div class="narrator-footer">
              <div class="voice-visualizer">
                <div v-for="i in 5" :key="i" class="audio-bar" :style="{ animationDelay: (i * 0.2) + 's' }"></div>
              </div>
              <div class="narrator-step-badge">{{ currentStepIndex + 1 }} / {{ narrativeSteps.length }}</div>
            </div>
          </div>
        </div>
      </transition>
      
      
      <div class="action-buttons">
        <button class="round-tool-btn" @click="scriptVisible = !scriptVisible" :title="scriptVisible ? '隐藏面板' : '显示面板'">
          <el-icon><View v-if="scriptVisible" /><Hide v-else /></el-icon>
        </button>
        <button class="round-tool-btn danger" @click="goBack" title="返回主页">
          <el-icon><ArrowLeft /></el-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, shallowRef, watch, nextTick, defineAsyncComponent } from 'vue';
import { useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index';
import { ElIcon } from 'element-plus/es/components/icon/index';
import { marked } from 'marked';
import { ArrowLeft, Close, Hide, Loading, MagicStick, VideoPlay, View } from '@element-plus/icons-vue';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import { Vector as VectorLayer } from 'ol/layer';
import { fromLonLat, toLonLat } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { sendChatMessageStream } from '../utils/aiService';
import { NARRATIVE_TEXT_TEMPLATE_MARKDOWN, NARRATIVE_UI_ONLY_NOTICE } from '../utils/narrativeTextTemplate';
import { normalizeMarkdownForRender } from '../utils/markdownContract';
import { useProjection } from '../composables/map/useProjection';

// 底图为高德 GCJ02，后端 AOI/landuse boundary 全部为 WGS84（OSM），
// 必须先做 WGS84→GCJ02 偏移转换再 fromLonLat 投影到 EPSG:3857，
// 否则在武汉经纬度会产生约 500m 的系统性偏移（东南向）。
const { wgs84ToGcj02 } = useProjection();

const MapContainer = defineAsyncComponent(() => import('../components/MapContainer.vue'));



const router = useRouter();
const mapRef = ref(null);
const poiFeatures = ref([]);
const narrativeSteps = ref([]);
const aiResponse = ref(''); 
const currentStepIndex = ref(-1);
const isGenerating = ref(false);
const isPlaying = ref(false);
const scriptVisible = ref(true);
const currentVoiceText = ref('');
const boundaryData = ref(null);
const scriptContentRef = ref(null); 


const typedText = ref('');
const currentNarrativeFocus = computed(() => {
  if (currentStepIndex.value >= 0 && narrativeSteps.value[currentStepIndex.value]) {
    const focus = narrativeSteps.value[currentStepIndex.value].focus;
    return focus === 'overview' ? '区域概览' : focus;
  }
  return '空间叙事';
});


const progressOffset = computed(() => {
  if (narrativeSteps.value.length === 0) return 125.6;
  const progress = (currentStepIndex.value + 1) / narrativeSteps.value.length;
  return 125.6 * (1 - progress);
});

const overviewBoundarySource = new VectorSource();
const overviewBoundaryLayer = new VectorLayer({
  source: overviewBoundarySource,
  updateWhileAnimating: true,
  updateWhileInteracting: true,
  renderBuffer: 256,
  zIndex: 920,
  style: [
    new Style({
      stroke: new Stroke({ color: 'rgba(56, 189, 248, 0.24)', width: 10 }),
      fill: new Fill({ color: 'rgba(56, 189, 248, 0.04)' })
    }),
    new Style({
      stroke: new Stroke({ color: 'rgba(56, 189, 248, 0.95)', width: 3, lineDash: [12, 10] }),
      fill: new Fill({ color: 'rgba(56, 189, 248, 0.08)' })
    })
  ]
});
const narrativeNodeBoundarySource = new VectorSource();
const narrativeNodeBoundaryLayer = new VectorLayer({
  source: narrativeNodeBoundarySource,
  updateWhileAnimating: true,
  updateWhileInteracting: true,
  renderBuffer: 256,
  zIndex: 930,
  style: [
    new Style({
      stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.2)', width: 12 }),
      fill: new Fill({ color: 'rgba(0, 212, 255, 0.03)' })
    }),
    new Style({
      stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.96)', width: 3.5 }),
      fill: new Fill({ color: 'rgba(0, 212, 255, 0.06)' })
    })
  ]
});

const currentTagline = computed(() => {
  if (currentStepIndex.value < 0) return null;
  const step = narrativeSteps.value[currentStepIndex.value];
  return step?.tagline || null;
});

const currentWebFactHint = computed(() => {
  if (currentStepIndex.value < 0) return null;
  const step = narrativeSteps.value[currentStepIndex.value];
  return step?.webFactHint || null;
});


let typeInterval = null;
const typeText = (text) => {
  clearInterval(typeInterval);
  typedText.value = '';
  let i = 0;
  typeInterval = setInterval(() => {
    if (i < text.length) {
      typedText.value += text[i];
      i++;
    } else {
      clearInterval(typeInterval);
    }
  }, 50); 
};


watch(currentVoiceText, (newVal) => {
  if (newVal) {
    typeText(newVal.replace(/<[^>]+>/g, '')); 
  }
});


const mapInstance = shallowRef(null);
const fuzzyRegions = ref([]);
const currentSubtitle = ref(''); 
const subtitleHistory = ref([]); 
const isSubtitleVisible = ref(false); 
const subtitleContainerRef = ref(null); 
const aiPanelRef = ref(null); 
const subtitlePosition = ref({ x: 0, y: 0 }); 
const subtitleSafeZone = ref({ left: 0, top: 0, right: 0, bottom: 0 }); 
const currentViewport = ref(null);
let narrativeBoundaryLayerAttached = false;

const NARRATIVE_DEFAULT_QUERY = '请按导览顺序介绍当前区域，挑出最值得讲的代表节点。';


function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}


function pickBoundaryGeometry(...values) {
  for (const value of values) {
    const record = asObject(value);
    if (record?.type === 'Polygon' || record?.type === 'MultiPolygon') {
      return record;
    }
    const featureGeometry = asObject(record?.geometry);
    if (record?.type === 'Feature' && (featureGeometry?.type === 'Polygon' || featureGeometry?.type === 'MultiPolygon')) {
      return featureGeometry;
    }
    if (Array.isArray(value) && value.length >= 3 && value.every((pt) => Array.isArray(pt) && pt.length >= 2)) {
      return {
        type: 'Polygon',
        coordinates: [value],
      };
    }
  }
  return null;
}

function resolveBoundaryGeometry(boundary) {
  const record = asObject(boundary);
  const layers = asObject(record?.layers);
  const transition = asObject(record?.transition || layers?.transition);
  const outer = asObject(record?.outer || layers?.outer);
  const core = asObject(record?.core || layers?.core);
  return pickBoundaryGeometry(
    record,
    record?.representative_geojson,
    transition?.geojson,
    transition?.boundary,
    outer?.geojson,
    outer?.boundary,
    core?.geojson,
    core?.boundary,
    record?.boundary_geojson,
    record?.boundary,
    record?.boundary_ring,
  );
}

function normalizeBoundaryPoint(point) {
  if (!Array.isArray(point) || point.length < 2) return null;
  const lon = Number(point[0]);
  const lat = Number(point[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function normalizeClosedBoundaryRing(ringCandidate) {
  const ring = asArray(ringCandidate)
    .map((point) => normalizeBoundaryPoint(point))
    .filter(Boolean);
  if (ring.length < 3) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring.length >= 4 ? ring : [];
}

function toOlRingCoordinates(ringCandidate) {
  // 后端返回的 boundary 坐标均为 WGS84（aois/landuse OSM 源），
  // 必须先 wgs84→gcj02 再 fromLonLat，否则与高德 GCJ02 底图错位 ~500m。
  return normalizeClosedBoundaryRing(ringCandidate)
    .map(([lon, lat]) => wgs84ToGcj02(lon, lat))
    .map(([lon, lat]) => fromLonLat([lon, lat]));
}

function toOlBoundaryGeometry(boundary) {
  const geometry = resolveBoundaryGeometry(boundary);
  if (!geometry || typeof geometry !== 'object') return null;
  const coords = geometry.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (geometry.type === 'Polygon') {
    const polygonCoords = coords
      .map((ring) => toOlRingCoordinates(ring))
      .filter((ring) => Array.isArray(ring) && ring.length >= 4);
    return polygonCoords.length ? new Polygon(polygonCoords) : null;
  }
  if (geometry.type === 'MultiPolygon') {
    const multiPolygonCoords = coords
      .map((polygon) => asArray(polygon)
        .map((ring) => toOlRingCoordinates(ring))
        .filter((ring) => Array.isArray(ring) && ring.length >= 4))
      .filter((polygon) => Array.isArray(polygon) && polygon.length > 0);
    return multiPolygonCoords.length ? new MultiPolygon(multiPolygonCoords) : null;
  }
  return null;
}

function ensureNarrativeBoundaryLayers() {
  if (!mapInstance.value || narrativeBoundaryLayerAttached) return;
  mapInstance.value.addLayer(overviewBoundaryLayer);
  mapInstance.value.addLayer(narrativeNodeBoundaryLayer);
  narrativeBoundaryLayerAttached = true;
}

function syncBoundaryLayer(source, boundary) {
  source.clear();
  if (!mapInstance.value) return;
  ensureNarrativeBoundaryLayers();
  const geometry = toOlBoundaryGeometry(boundary);
  if (!geometry) return;
  source.addFeature(new Feature({ geometry }));
}

function cleanupNarrativeBoundaryLayers() {
  overviewBoundarySource.clear();
  narrativeNodeBoundarySource.clear();
  if (!mapInstance.value || !narrativeBoundaryLayerAttached) return;
  mapInstance.value.removeLayer(overviewBoundaryLayer);
  mapInstance.value.removeLayer(narrativeNodeBoundaryLayer);
  narrativeBoundaryLayerAttached = false;
}

function readViewportFromMap(olMap) {
  if (!olMap?.getView || !olMap?.getSize) return null;
  const size = olMap.getSize();
  if (!size) return null;
  const extent = olMap.getView().calculateExtent(size);
  const bl = toLonLat([extent[0], extent[1]]);
  const tr = toLonLat([extent[2], extent[3]]);
  return [bl[0], bl[1], tr[0], tr[1]];
}

function buildViewportCenter(viewport) {
  if (!Array.isArray(viewport) || viewport.length < 4) return null;
  return {
    lon: (Number(viewport[0]) + Number(viewport[2])) / 2,
    lat: (Number(viewport[1]) + Number(viewport[3])) / 2,
  };
}

function buildPoiFeaturesFromPayload(items) {
  return asArray(items).map((item, index) => {
    const record = asObject(item) || {};
    if (record.type === 'Feature' && record.geometry?.type === 'Point' && Array.isArray(record.geometry.coordinates)) {
      return record;
    }
    const geometry = asObject(record.geometry);
    const coordinates = Array.isArray(geometry?.coordinates)
      ? geometry.coordinates
      : (Number.isFinite(Number(record.longitude)) && Number.isFinite(Number(record.latitude))
        ? [Number(record.longitude), Number(record.latitude)]
        : null);
    if (!coordinates) return null;
    return {
      type: 'Feature',
      properties: {
        id: record.id || `narrative-${index}`,
        name: String(record.name || record.label || ''),
        名称: String(record.name || record.label || ''),
      },
      geometry: {
        type: 'Point',
        coordinates,
      },
    };
  }).filter(Boolean);
}

function applyNarrativeResult(payload) {
  const root = asObject(payload) || {};
  const results = asObject(root.results) || {};
  const narrativeTour = asObject(results.narrative_tour) || {};
  const steps = asArray(narrativeTour.narrative_steps);
  const boundary = narrativeTour.boundary || results.boundary || null;
  const pois = asArray(results.pois);
  const clusters = asObject(results.spatial_clusters);

  if (typeof root.answer === 'string' && root.answer.trim()) {
    aiResponse.value = root.answer;
  }
  if (steps.length > 0) {
    narrativeSteps.value = steps;
  }
  if (resolveBoundaryGeometry(boundary)) {
    boundaryData.value = boundary;
  }
  if (pois.length > 0) {
    poiFeatures.value = buildPoiFeaturesFromPayload(pois);
  }
  const nextFuzzyRegions = asArray(results.fuzzy_regions || results.fuzzyRegions);
  if (nextFuzzyRegions.length > 0) {
    fuzzyRegions.value = nextFuzzyRegions;
  }
}

function handleNarrativeMeta(type, data) {
  if (type === 'refined_result') {
    applyNarrativeResult(data);
    return;
  }
  if (type === 'boundary' && resolveBoundaryGeometry(data)) {
    boundaryData.value = data;
    return;
  }
  if (type === 'pois') {
    poiFeatures.value = buildPoiFeaturesFromPayload(data);
    return;
  }
  if (type === 'fuzzy_regions') {
    fuzzyRegions.value = asArray(data);
  }
}

const NARRATIVE_TEMPLATE_CONTENT = `${NARRATIVE_UI_ONLY_NOTICE}

${NARRATIVE_TEXT_TEMPLATE_MARKDOWN}`;

const formattedAiResponse = computed(() => {
  const normalized = normalizeMarkdownForRender(aiResponse.value || NARRATIVE_TEMPLATE_CONTENT);
  return marked.parse(normalized);
});


watch(aiResponse, () => {
  nextTick(() => {
    if (scriptContentRef.value) {
      scriptContentRef.value.scrollTop = scriptContentRef.value.scrollHeight;
    }
  });
});

watch(boundaryData, (nextBoundary) => {
  syncBoundaryLayer(overviewBoundarySource, nextBoundary);
});



const onMapReady = async (olMap) => {
  mapInstance.value = olMap;
  currentViewport.value = readViewportFromMap(olMap);
  ensureNarrativeBoundaryLayers();
  syncBoundaryLayer(overviewBoundarySource, boundaryData.value);
  if (currentStepIndex.value >= 0 && narrativeSteps.value[currentStepIndex.value]) {
    await renderNarrativeNodeBoundary(narrativeSteps.value[currentStepIndex.value]);
  }
};

const onMapMove = (viewport) => {
  currentViewport.value = Array.isArray(viewport) ? viewport : currentViewport.value;
};

const handleGenerate = async () => {
  if (isGenerating.value) return;

  const viewport = Array.isArray(currentViewport.value) ? currentViewport.value : readViewportFromMap(mapInstance.value);
  const center = buildViewportCenter(viewport);
  if (!viewport || !center) {
    aiResponse.value = '请先把地图移动到要解说的区域，再生成导览骨架。';
    return;
  }

  // 把当前视口写入 localStorage，供 /narrative/probe 诊断页面复用
  try {
    localStorage.setItem('narrativeLastViewport', JSON.stringify(viewport));
  } catch (e) {
    console.warn('failed to persist narrativeLastViewport', e);
  }

  isGenerating.value = true;
  narrativeSteps.value = [];
  currentStepIndex.value = -1;
  currentVoiceText.value = '';
  boundaryData.value = null;
  poiFeatures.value = [];
  fuzzyRegions.value = [];
  await renderNarrativeNodeBoundary(null);
  aiResponse.value = '';

  await nextTick();

  try {
    const fullAnswer = await sendChatMessageStream(
      [{ role: 'user', content: NARRATIVE_DEFAULT_QUERY }],
      (chunk) => {
        aiResponse.value += chunk;
      },
      {
        surface: 'narrative',
        spatialContext: {
          viewport,
          center,
        },
      },
      [],
      handleNarrativeMeta,
    );

    if (!aiResponse.value && fullAnswer) {
      aiResponse.value = fullAnswer;
    }
  } catch (error) {
    aiResponse.value = `导览生成失败：${error?.message || String(error || '未知错误')}`;
  } finally {
    isGenerating.value = false;
  }
};


/**
 * 渲染当前节点的模糊边界。空心单线描边，覆盖式更新（不累积）。
 * 支持 MultiPolygon 多环渲染（如武汉大学有多个分离校区）。
 */
const renderNarrativeNodeBoundary = async (boundary) => {
  syncBoundaryLayer(narrativeNodeBoundarySource, boundary);
};

const playNarrative = async () => {
  if (narrativeSteps.value.length === 0 || isPlaying.value) return;
  
  isPlaying.value = true;
  // 播放节点导览时，隐藏 viewport 外框，避免和节点边界视觉冲突
  boundaryData.value = null;
  
  for (let i = 0; i < narrativeSteps.value.length; i++) {
    currentStepIndex.value = i;
    const step = narrativeSteps.value[i];
    currentVoiceText.value = step.voice_text;

    // 渲染该节点的模糊边界（overview 步骤会 boundary=null，自动清空上一个节点的光带）
    await renderNarrativeNodeBoundary(step);
    
    
    
    if (step.focus !== 'overview') {
      let targetCoords = null;
      
      
      if (step.center && step.center.lon && step.center.lat) {
        targetCoords = [step.center.lon, step.center.lat];
      }
      
      
      if (!targetCoords && fuzzyRegions.value && fuzzyRegions.value.length > 0) {
        const targetRegion = fuzzyRegions.value.find(r => 
          r.id === step.region_id || 
          r.name === step.focus || 
          (r.candidates?.bestGuess === step.focus)
        );
        
        if (targetRegion && targetRegion.center) {
          targetCoords = [targetRegion.center.lon, targetRegion.center.lat];
        }
      }
      
      
      if (!targetCoords) {
        const targetPoi = poiFeatures.value.find(p => p.properties.name === step.focus);
        if (targetPoi) {
          targetCoords = targetPoi.geometry.coordinates;
        }
      }
      
      if (targetCoords && mapInstance.value) {
        mapInstance.value.getView().animate({
          center: fromLonLat(targetCoords),
          zoom: 16,
          duration: 1500
        });
      }
    } else {
      
      if (mapInstance.value) {
        mapInstance.value.getView().animate({ zoom: 14, duration: 1500 });
      }
      
    }

    await new Promise(resolve => setTimeout(resolve, step.duration || 5000));
  }
  
  isPlaying.value = false;
  currentStepIndex.value = -1;
  currentVoiceText.value = '';
  // 清理残留节点光带
  await renderNarrativeNodeBoundary(null);
};


const goBack = () => router.push('/');

onBeforeUnmount(() => {
  cleanupNarrativeBoundaryLayers();
});

</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap');

.narrative-mode-container {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #0a0a12;
    font-family: 'Inter', 'Noto Sans SC', sans-serif;
    color: rgba(255, 255, 255, 0.95);
}


.bg-gradient {
    position: fixed;
    inset: 0;
    background: 
        radial-gradient(ellipse 80% 50% at 20% 40%, rgba(0, 212, 255, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse 60% 40% at 80% 60%, rgba(123, 44, 191, 0.06) 0%, transparent 50%),
        radial-gradient(ellipse 50% 30% at 50% 100%, rgba(0, 212, 255, 0.04) 0%, transparent 50%);
    animation: bgPulse 20s ease-in-out infinite;
    pointer-events: none;
    z-index: 1;
}

@keyframes bgPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
}

.grid-overlay {
    position: fixed;
    inset: 0;
    background-image: 
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 0%, transparent 70%);
    pointer-events: none;
    z-index: 2;
}

.floating-orb {
    position: fixed;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,212,255,0.1) 0%, transparent 70%);
    pointer-events: none;
    animation: float 15s ease-in-out infinite;
    z-index: 3;
}

.floating-orb.orb-1 { top: 10%; left: 10%; animation-delay: 0s; }
.floating-orb.orb-2 { bottom: 20%; right: 10%; animation-delay: -5s; }

@keyframes float {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(30px, -30px) scale(1.1); }
    50% { transform: translate(-20px, 20px) scale(0.9); }
    75% { transform: translate(20px, 30px) scale(1.05); }
}


.background-map {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    filter: brightness(0.6) grayscale(0.2) contrast(1.1);
}



.narrative-ui {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
}

.narrative-ui > * { pointer-events: auto; }


.progress-ring-container {
    position: fixed;
    top: 32px;
    left: 40px;
    width: 56px;
    height: 56px;
    z-index: 100;
    background: rgba(0,0,0,0.3);
    backdrop-filter: blur(10px);
    border-radius: 50%;
    padding: 4px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
}

.progress-ring-svg { transform: rotate(-90deg); }
.progress-ring-svg circle { fill: none; stroke-width: 3; }
.progress-ring-svg .ring-bg { stroke: rgba(255,255,255,0.1); }
.progress-ring-svg .ring-progress {
    stroke: #00d4ff;
    stroke-dasharray: 125.6;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    filter: drop-shadow(0 0 5px #00d4ff);
}

.progress-text {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #00d4ff;
    letter-spacing: -0.5px;
}


.script-panel {
    position: absolute;
    left: 24px;
    top: 24px;
    width: 380px;
    max-height: calc(100vh - 48px);
    background: rgba(10, 10, 18, 0.75);
    backdrop-filter: blur(30px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    z-index: 20;
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
}

.script-panel.generating {
    border-color: rgba(0, 212, 255, 0.4);
    box-shadow: 0 0 40px rgba(0, 212, 255, 0.15);
}

.panel-header {
    padding: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%);
}

.brand-mini { display: flex; align-items: center; gap: 12px; }
.brand-icon-mini {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #00d4ff, #7b2cbf);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
}

.brand-text-mini h1 { font-size: 15px; font-weight: 700; color: #fff; margin: 0; letter-spacing: 0.5px; }
.brand-text-mini span { font-size: 9px; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 1.5px; }

.script-content {
    flex: 1;
    padding: 0 24px 24px;
    overflow-y: auto;
    scrollbar-width: none;
}

.script-content::-webkit-scrollbar { display: none; }

.response-title {
    font-size: 11px;
    color: #00d4ff;
    font-weight: 700;
    letter-spacing: 2px;
    margin: 24px 0 16px;
    opacity: 0.8;
}

.ai-text-response {
    color: rgba(255,255,255,0.8);
    font-size: 14px;
    line-height: 1.8;
}


.modern-steps { display: flex; flex-direction: column; gap: 4px; }
.modern-step-item {
    position: relative;
    padding: 12px 0 12px 32px;
    transition: all 0.3s ease;
}

.step-line {
    position: absolute;
    left: 7px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255,255,255,0.1);
}

.modern-step-item:first-child .step-line { top: 20px; }
.modern-step-item:last-child .step-line { bottom: auto; height: 20px; }

.step-dot {
    position: absolute;
    left: 4px;
    top: 20px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    border: 2px solid #0a0a12;
    z-index: 2;
    transition: all 0.4s ease;
}

.modern-step-item.active .step-dot {
    background: #00d4ff;
    box-shadow: 0 0 10px #00d4ff;
    transform: scale(1.4);
}

.modern-step-item.finished .step-dot { background: #7b2cbf; }

.step-label { font-size: 9px; color: rgba(255, 255, 255, 0.5); font-weight: 700; letter-spacing: 1px; margin-bottom: 2px; }
.step-title { font-size: 14px; color: rgba(255,255,255,0.5); font-weight: 500; transition: all 0.3s ease; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.modern-step-item.active .step-title { color: #fff; font-weight: 600; }

.step-tagline {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.45;
    color: rgba(255,255,255,0.42);
}

.fact-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 8px;
    background: rgba(0,212,255,0.12);
    color: rgba(0,212,255,0.85);
    border: 1px solid rgba(0,212,255,0.25);
    letter-spacing: 0.3px;
}


.panel-footer {
    padding: 24px;
    background: rgba(0,0,0,0.2);
    border-top: 1px solid rgba(255,255,255,0.05);
}

.action-row { display: flex; flex-direction: column; gap: 12px; }

.btn-modern {
    width: 100%;
    padding: 14px;
    border: none;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    letter-spacing: 0.5px;
}

.btn-generate {
    background: rgba(255,255,255,0.05);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.1);
}

.btn-generate:hover { background: rgba(255,255,255,0.1); transform: translateY(-2px); }

.btn-play-narrative {
    background: linear-gradient(135deg, #00d4ff 0%, #7b2cbf 100%);
    color: #fff;
    box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);
}

.btn-play-narrative:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 212, 255, 0.4); }
.btn-play-narrative:active { transform: translateY(0); }
.btn-play-narrative.playing { background: rgba(255,255,255,0.1); box-shadow: none; color: rgba(255, 255, 255, 0.5); cursor: not-allowed; }


/* ===== 右侧竖排旁白面板 ===== */
.narrator-panel {
    position: fixed;
    right: 32px;
    top: 50%;
    transform: translateY(-50%);
    width: 300px;
    max-height: 70vh;
    display: flex;
    flex-direction: row;
    z-index: 100;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55), 0 0 1px rgba(255,255,255,0.1);
}

/* 左侧青色渐变光带 */
.narrator-accent-line {
    width: 3px;
    min-height: 100%;
    background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(0, 212, 255, 0.15) 15%,
        #00d4ff 50%,
        rgba(0, 212, 255, 0.15) 85%,
        transparent 100%
    );
    flex-shrink: 0;
    box-shadow: 0 0 12px rgba(0, 212, 255, 0.4);
}

.narrator-inner {
    flex: 1;
    background: rgba(10, 10, 18, 0.72);
    backdrop-filter: blur(40px) saturate(160%);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-left: none;
    border-radius: 0 20px 20px 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.narrator-header {
    padding: 20px 20px 0;
}

.narrator-eyebrow {
    font-size: 9px;
    font-weight: 700;
    color: #00d4ff;
    text-transform: uppercase;
    letter-spacing: 3px;
    opacity: 0.65;
}

.narrator-focus {
    font-size: 20px;
    font-weight: 700;
    margin: 6px 0 0;
    letter-spacing: 1.5px;
    background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.55) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1.3;
}

.narrator-body {
    flex: 1;
    padding: 16px 20px;
    overflow-y: auto;
    scrollbar-width: none;
}
.narrator-body::-webkit-scrollbar { display: none; }

.narrator-text {
    font-size: 13px;
    line-height: 1.85;
    color: rgba(255,255,255,0.82);
    font-weight: 400;
    letter-spacing: 0.2px;
    margin: 0;
    min-height: 48px;
}

.narrator-tagline {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(255,255,255,0.06);
}
.narrator-tagline span {
    font-size: 11px;
    line-height: 1.55;
    color: rgba(255,255,255,0.45);
}

.narrator-fact {
    margin-top: 8px;
}

.narrator-footer {
    padding: 12px 20px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid rgba(255,255,255,0.04);
}

.narrator-step-badge {
    font-size: 10px;
    font-weight: 600;
    color: rgba(255,255,255,0.35);
    letter-spacing: 0.5px;
}

.typing-cursor {
    display: inline-block;
    width: 3px;
    height: 20px;
    background: #00d4ff;
    margin-left: 6px;
    vertical-align: middle;
    animation: blink 0.8s infinite;
    box-shadow: 0 0 10px #00d4ff;
}

@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }


.voice-visualizer { display: flex; align-items: flex-end; gap: 3px; height: 20px; }
.audio-bar {
    width: 2.5px;
    height: 6px;
    background: #00d4ff;
    border-radius: 2px;
    animation: bar-dance 0.6s ease-in-out infinite alternate;
    opacity: 0.7;
}

@keyframes bar-dance { from { height: 4px; opacity: 0.3; } to { height: 18px; opacity: 1; } }


.action-buttons {
    position: absolute;
    left: 32px;
    bottom: 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.round-tool-btn {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(10, 10, 18, 0.6);
    backdrop-filter: blur(20px);
    color: #fff;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    box-shadow: 0 8px 20px rgba(0,0,0,0.3);
}

.round-tool-btn:hover { background: #00d4ff; color: #fff; transform: scale(1.1) rotate(5deg); }
.round-tool-btn.danger:hover { background: #ff6b6b; }


.loader-spinner-mini {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #00d4ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 40px 0;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
}


/* 旁白面板右侧滑入动画 */
.narrator-slide-enter-active { transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
.narrator-slide-leave-active { transition: all 0.4s ease-in; }
.narrator-slide-enter-from { opacity: 0; transform: translateY(-50%) translateX(80px); }
.narrator-slide-leave-to { opacity: 0; transform: translateY(-50%) translateX(40px); }

.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.6s ease; }
.fade-slide-enter-from, .fade-slide-leave-to { opacity: 0; transform: translateX(-50px); filter: blur(10px); }


:deep(.map-filter-control) {
  display: none !important;
}

.response-body :deep(h3) {
  color: #00f2ff;
  font-size: 1.1rem;
  margin: 16px 0 8px 0;
}
.response-body :deep(p) { margin-bottom: 12px; }
.response-body :deep(ul) { padding-left: 20px; margin-bottom: 12px; }


.script-content {
    -ms-overflow-style: none; 
}
</style>


