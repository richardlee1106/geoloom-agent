<template>
  <div id="app" class="app-layout">
    <!-- 硕 -->
    <header class="fixed-top-header desktop-only-flex">
      <!-- 品牌 Logo 区域 -->
      <div class="header-logo">
        <div class="logo-icon">
          <!-- 地球 + 知识网络 Logo -->
          <svg viewBox="0 0 32 32" width="32" height="32">
            <defs>
              <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#818cf8"/>
                <stop offset="100%" style="stop-color:#c084fc"/>
              </linearGradient>
            </defs>
            <!-- 地球轮廓 -->
            <circle cx="16" cy="16" r="10" fill="none" stroke="url(#logo-grad)" stroke-width="1.5"/>
            <!-- 经线 -->
            <ellipse cx="16" cy="16" rx="5" ry="10" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>
            <!-- 纬线 -->
            <ellipse cx="16" cy="16" rx="10" ry="5" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>
            <!-- 中心光点 -->
            <circle cx="16" cy="16" r="3" fill="url(#logo-grad)"/>
            <!-- 知识节点 -->
            <circle cx="16" cy="6" r="2" fill="white"/>
            <circle cx="24" cy="12" r="2" fill="white"/>
            <circle cx="24" cy="20" r="2" fill="white"/>
            <circle cx="16" cy="26" r="2" fill="white"/>
            <circle cx="8" cy="20" r="2" fill="white"/>
            <circle cx="8" cy="12" r="2" fill="white"/>
          </svg>
        </div>
        <div class="logo-type">
          <div class="logo-main-row">
            <span class="logo-text">GeoLoom<span class="logo-accent">-RAG</span></span>
            <span class="logo-subtitle">地理认知探索</span>
          </div>
          <div class="version-badge">{{ runtimeVersionLabel }} <span class="beta-tag">({{ runtimeVersionTag }})</span></div>
        </div>
      </div>

      <!-- 绝对定位锚点击-->
      
      <!-- 锚点1：数据发(右对齐至屏幕中线 50%) -->
      <div class="layout-anchor-center-left">
        <ControlPanel ref="controlPanelRefMap"
                      panel-type="map"
                      @data-loaded="handleDataLoaded"
                      @search="handleSearch"
                      @clear-search="handleClearSearch"
                      @save-result="handleSaveResult"
                      @category-change="handleCategoryChange"
                      @loading-change="isLoading = $event"
                      v-model:filterEnabled="filterEnabled"
                      v-model:heatmapEnabled="heatmapEnabled"
                      v-model:weightEnabled="weightEnabled"
                      v-model:showWeightValue="showWeightValue"
                      @data-removed="handleDataRemoved"
                      :mapBounds="mapBounds"
                      :selectedPolygon="selectedPolygon"
                      :globalAnalysisEnabled="globalAnalysisEnabled" />
      </div>

      <!-- 中线分隔符（已移除） -->

      <!-- 锚2占指 (叶幕冶缘) -->
      <div class="layout-anchor-screen-right">
        <ControlPanel ref="controlPanelRefTag"
                      panel-type="tag"
                      @toggle-draw="handleToggleDraw"
                      @debug-show="handleDebugShow"
                      @reset="handleReset"
                      @save-result="handleSaveResult"
                      @vector-polygon-uploaded="handleVectorPolygonUploaded"
                      @data-loaded="handleDataLoaded"
                      @search="handleSearch"
                      @clear-search="handleClearSearch"
                      @loading-change="isLoading = $event"
                      @category-change="handleCategoryChange"
                      @go-narrative="goToNarrative"
                      :on-run-algorithm="handleRunAlgorithm"
                      v-model:filterEnabled="filterEnabled"
                      v-model:heatmapEnabled="heatmapEnabled"
                      v-model:weightEnabled="weightEnabled"
                      v-model:showWeightValue="showWeightValue"
                      @data-removed="handleDataRemoved"
                      :mapBounds="mapBounds"
                      :selectedPolygon="selectedPolygon"
                      :globalAnalysisEnabled="globalAnalysisEnabled" />
      </div>
    </header>

    <header class="mobile-header mobile-only-block">
      <ControlPanel ref="controlPanelRefMobile"
                    panel-type="mobile"
                    @data-loaded="handleDataLoaded"
                    @toggle-draw="handleToggleDraw"
                    @debug-show="handleDebugShow"
                    @reset="handleReset"
                    @search="handleSearch"
                    @clear-search="handleClearSearch"
                    @save-result="handleSaveResult"
                    @loading-change="isLoading = $event"
                    @category-change="handleCategoryChange"
                    :on-run-algorithm="handleRunAlgorithm"
                    v-model:filterEnabled="filterEnabled"
                    v-model:heatmapEnabled="heatmapEnabled"
                    v-model:weightEnabled="weightEnabled"
                    v-model:showWeightValue="showWeightValue"
                    @data-removed="handleDataRemoved"
                    :mapBounds="mapBounds"
                    :selectedPolygon="selectedPolygon"
                    :globalAnalysisEnabled="globalAnalysisEnabled" />
    </header>
    <main 
      class="bottom-split" 
      :class="{ 'ai-expanded': aiExpanded, 'is-dragging': isDragging1 }"
      v-loading="isLoading" 
      element-loading-text="正在加载数据..."
      element-loading-background="rgba(0, 0, 0, 0.7)"
    >
      <!-- 三列横向布局（AI 展开） | 两列布局（默认） -->
      <section class="left-section" :class="{ 'three-column': aiExpanded }" 
               :style="leftSectionStyle">
        <!-- 地图面板 -->
        <div class="map-panel" :style="mapPanelStyle">
          <div class="panel-content">
            <MapContainer ref="mapComponent" 
                          :poi-features="mapPoiFeatures" 
                          :hovered-feature-id="hoveredFeatureId"
                          :user-location="userLocation"
                          :filter-enabled="filterEnabled"
                          :heatmap-enabled="heatmapEnabled"
                          :weight-enabled="weightEnabled"
                          :show-weight-value="showWeightValue"
                          :global-analysis-enabled="globalAnalysisEnabled"
                          @polygon-completed="handlePolygonCompleted" 
                          @map-ready="handleMapReady"
                          @hover-feature="handleFeatureHover"
                          @click-feature="handleFeatureClick"
                          @map-move-end="handleMapMoveEnd"
                          @toggle-filter="filterEnabled = $event"
                          @weight-change="handleWeightChange"
                          @global-analysis-change="globalAnalysisEnabled = $event"
                          @region-removed="handleRegionRemoved"
                          @regions-cleared="handleRegionsCleared" />
          </div>
        </div>
        
        <!-- 分隔条（未展开 AI 时用于调整 Map/Tag 比例） -->
        <div class="splitter-inner" v-if="!aiExpanded" @mousedown="startDrag1">
          <div class="splitter-line"></div>
        </div>
        
        <!-- 移动端 AI 面板遮罩层（点击收起） -->
        <div v-if="aiExpanded" class="mobile-ai-mask mobile-only-block" @click="aiExpanded = false"></div>

        <!-- 签 (贫兀AI 展时) -->
        <div class="tag-panel" 
             :style="tagPanelStyle" 
             :class="{ 
               'drawer-expanded': isTagDrawerExpanded, 
               'mobile-hidden': true,
               'panel-hidden': aiExpanded // AI 展开时隐藏标签云
             }">
          <!-- 移动端抽屉提拉手柄 -->
          <div class="mobile-drawer-handle mobile-only-block" @click="isTagDrawerExpanded = !isTagDrawerExpanded">
            <div class="handle-bar"></div>
          </div>
          <div class="panel-content">
            <TagCloud v-if="shouldMountTagCloud"
                      ref="tagCloudRef"
                      :data="filteredTagData" 
                      :map="map" 
                      :algorithm="selectedAlgorithm" 
                      :selectedBounds="selectedBounds" 
                      :polygonCenter="polygonCenter" 
                      :spiralConfig="spiralConfig" 
                      :boundaryPolygon="selectedPolygon"
                      :hovered-feature-id="hoveredFeatureId"
                      :clicked-feature-id="clickedFeatureId"
                      :draw-mode="selectedDrawMode"
                      :circle-center="circleCenterGeo"
                      :weight-enabled="weightEnabled"
                      :show-weight-value="showWeightValue"
                      @hover-feature="handleFeatureHover"
                      @locate-feature="handleFeatureLocate" />
          </div>
        </div>
      </section>
      
      <!-- 右侧面板：AI 对话 - 动态宽度-->
      <section 
        class="right-panel ai-panel" 
        :class="{ 'panel-hidden': !aiExpanded }"
        :style="aiPanelStyle"
      >
        <div class="panel-content">
      <div v-if="aiExpanded && !shouldMountAiChat" class="map-loading-placeholder ai-panel-placeholder">
        <div class="loading-spinner"></div>
        <span>GeoAI 助手准备中...</span>
      </div>
      <AiChat v-if="shouldMountAiChat"
                  ref="aiChatRef" 
                  :poi-features="selectedFeatures" 
                  :boundary-polygon="selectedPolygon"
                  :draw-mode="selectedDrawMode"
                  :circle-center="circleCenterGeo"
                  :circle-radius="circleRadiusMeters"
                  :map-bounds="mapBounds"
                  :map-zoom="mapZoom"
                  :user-location="userLocation"
                  :user-location-status="userLocationStatus"
                  :global-analysis-enabled="globalAnalysisEnabled"
                  :selected-categories="selectedCategoryPath"
                  :regions="regions"
                  @close="toggleAiPanel"
                  @request-current-location="requestCurrentLocation"
                  @render-to-tagcloud="handleRenderAIResult"
                  @render-pois-to-map="handleRenderPoisToMap"
                  @ai-boundary="handleAiBoundary"
                  @ai-spatial-clusters="handleAiSpatialClusters"
                  @ai-vernacular-regions="handleAiVernacularRegions"
                  @ai-fuzzy-regions="handleAiFuzzyRegions"
                  @ai-analysis-stats="handleAiAnalysisStats"
                  @clear-chat-state="handleClearAiChatState" />
        </div>
      </section>
    </main>
    <div v-if="!aiExpanded" class="ai-fab" @click="toggleAiPanel">
      <div class="ai-fab-icon">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </div>
      <span class="ai-fab-text">GeoAI 助手</span>
      <div class="ai-fab-badge" v-if="selectedFeatures.length > 0">{{ selectedFeatures.length }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, onUnmounted, nextTick, computed, watch, defineAsyncComponent, h } from 'vue';
import { useRouter } from 'vue-router';
import { vLoading } from 'element-plus/es/components/loading/index';
import { ElNotification } from 'element-plus/es/components/notification/index';
import { fromLonLat, toLonLat } from 'ol/proj';
import ControlPanel from './components/ControlPanel.vue';
function createLoadingPlaceholder(label) {
  return {
    render() {
      return h('div', { class: 'map-loading-placeholder' }, [
        h('div', { class: 'loading-spinner' }),
        h('span', label)
      ]);
    }
  };
}

// MapContainer 使用异步组件延迟加载 OpenLayers（318KB）
const MapContainer = defineAsyncComponent({
  loader: () => import('./components/MapContainer.vue'),
  loadingComponent: createLoadingPlaceholder('地图加载中...'),
  delay: 0
});
const TagCloud = defineAsyncComponent({
  loader: () => import('./components/TagCloud.vue'),
  loadingComponent: createLoadingPlaceholder('标签云加载中...'),
  delay: 0
});
const AiChat = defineAsyncComponent({
  loader: () => import('./components/AiChat.vue'),
  loadingComponent: createLoadingPlaceholder('助手加载中...'),
  delay: 0
});
import { normalizeAiEvidencePayload } from './utils/aiEvidencePayload';
import { normalizeAiMapRenderPayload } from './utils/aiMapRenderPayload';
import {
  assessBrowserUserLocation,
  createBrowserUserLocation,
  resolveLocationReferenceCenter,
  shouldRetryBrowserLocation
} from './utils/userLocationContext';
import {
  buildCoarseLocationBrowserHint,
  detectBrowserBrand
} from './utils/geolocationDiagnostics';
import { SPATIAL_API_BASE_URL } from './config';
import { useRegions } from './composables/useRegions';

const router = useRouter();
const runtimeMode = String(import.meta.env.VITE_BACKEND_VERSION || import.meta.env.MODE || '').toLowerCase();
const runtimeVersionLabel = computed(() => runtimeMode === 'v4' ? 'v4' : 'v1.0');
const runtimeVersionTag = computed(() => runtimeMode === 'v4' ? 'agent' : 'beta');
const DEFAULT_LOCATION_REFERENCE_CENTER = Object.freeze({ lon: 114.33, lat: 30.58 });

let semanticSearchLoader = null;

async function getSemanticSearch() {
  if (!semanticSearchLoader) {
    semanticSearchLoader = import('./utils/aiService').then((module) => module.semanticSearch);
  }
  return semanticSearchLoader;
}

// 多选区管理
const { regions, getRegionsContext } = useRegions();

// 组件引用
const controlPanelRefMap = ref(null);
const controlPanelRefTag = ref(null);
const controlPanelRefMobile = ref(null);
const tagCloudRef = ref(null);
const mapComponent = ref(null);
const aiChatRef = ref(null);

// 核心数据状态
const map = shallowRef(null); // OpenLayers 地图实例
const tagData = shallowRef([]); // 传递给 TagCloud 的数据（优化：使用 shallowRef）
const selectedAlgorithm = ref('basic'); // 当前选择的布局算法
const spiralConfig = ref(null); // 螺旋布局配置
const selectedBounds = ref(null); // 选中区域的边界
const allPoiFeatures = shallowRef([]); // 所有加载的 POI 数据（优化：使用 shallowRef
const selectedFeatures = shallowRef([]); // 当前选中 POI 集合（优化：使用 shallowRef）
const polygonCenter = ref(null); // 选中多边形的中心点（屏幕像素坐标）
const selectedPolygon = ref(null); // 选中多边形的经纬度坐标数组
const selectedCategoryPath = ref([]); // 当前选中的 POI 分类路径

// 交互状态
const hoveredFeatureId = ref(null); // 当前悬停的要素（用于联动高亮）
const clickedFeatureId = ref(null); // 当前点击的要素（常亮状态）
const filterEnabled = ref(false); // 是否开启实时视野过滤

const mapBounds = ref(null); // 当前地图视野边界 [minLon, minLat, maxLon, maxLat]
const mapZoom = ref(null); // 当前地图缩放级别
const isLoading = ref(false); // 全局/区域加载状态

// 绘图模式状态
const selectedDrawMode = ref(''); // 存储当前的绘图模式('Polygon' 'Circle')
const circleCenterGeo = ref(null); // 存储圆心经纬度（用于地理布局校正
const circleRadiusMeters = ref(null); // Circle radius in meters for strict spatial clipping

// AI 面板状态
const aiExpanded = ref(true); // 默认进入地图 + AI 的探索工作台
const shouldMountAiChat = ref(false);
const shouldMountTagCloud = ref(false); // 标签云改为按需挂载，避免首屏先把预算吃光
const aiPanelPercent = ref(33.33); // AI 面板宽度百分比（默认 1/3）
const splitPercentage1 = ref(65); // 默认展开比例：Map 65% / AI 35%
const AI_PANEL_FIXED_WIDTH_PX = 500;
const isDragging1 = ref(false);
const hSplitPercent = ref(50); // 已不再使用但保留以防依赖错误
const isTagDrawerExpanded = ref(false); // 移动端标签云抽屉展开状态
let tagDataSyncToken = 0;

// 浏览器当前位置状态
const userLocation = ref(null);
const userLocationStatus = ref('idle');
let geolocationWatchId = null;
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
};
const GEOLOCATION_REFINEMENT_TIMEOUT_MS = 22000;
const GEOLOCATION_REFINEMENT_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 0
};

// 地图面板样式（AI展开时为三列横向布局的第一列）
const mapPanelStyle = computed(() => {
  // AI 展开模式下：Map 占满左侧区域 (TagCloud 隐藏)，宽度减去分隔条
  if (aiExpanded.value) {
    return { 
      width: 'calc(100% - 5px)',
      height: '100%',
      flexShrink: 0
    };
  }

  // 普通模式下：Map 宽度splitPercentage1 决定 (TagCloud 存在)
  return { 
    width: `calc(${splitPercentage1.value}% - 5px)`,
    height: '100%',
    flexShrink: 0
  };
});

// 标签云面板样式（AI 展开时为三列横向布局的第二列）
// 标签云面板样式（AI 展开时隐藏，该样式仅在未展开时生效）
const tagPanelStyle = computed(() => {
  if (aiExpanded.value) return { display: 'none' };
  
  return { 
    width: `calc(${100 - splitPercentage1.value}% - 5px)`,
    height: '100%',
    flexShrink: 0
  };
});

const leftSectionStyle = computed(() => {
  if (!aiExpanded.value) return {}

  return {
    width: `calc(100% - ${AI_PANEL_FIXED_WIDTH_PX}px)`
  }
});

const aiPanelStyle = computed(() => ({
  width: aiExpanded.value ? `${AI_PANEL_FIXED_WIDTH_PX}px` : '0px'
}));

// 切换 AI 面板
function toggleAiPanel(forceState = null) {
  const nextExpanded = typeof forceState === 'boolean'
    ? forceState
    : !aiExpanded.value;

  if (nextExpanded) {
    shouldMountAiChat.value = true;
  } else {
    shouldMountTagCloud.value = true;
  }

  aiExpanded.value = nextExpanded;
  
  // 设置默认比例
  if (aiExpanded.value) {
    // 展开时：默认 Map 占 65%, AI 占 35% -> 65:35 比例
    splitPercentage1.value = 65;
  } else {
    // 收起时：恢复 50/50 分布
    splitPercentage1.value = 50;
  }
  
  // 切换后需要多次触发resize 确保布局正确
  nextTick(() => {
    handleResize();
    // 动画期间持续触发 resize 确保渲染平滑
    const startTime = Date.now();
    const duration = 600;
    const interval = setInterval(() => {
      handleResize();
      if (Date.now() - startTime > duration) {
        clearInterval(interval);
        // 最后确保一次刷新
        handleResize();
        if (tagCloudRef.value && typeof tagCloudRef.value.resize === 'function') {
          tagCloudRef.value.resize();
        }
      }
    }, 50); // 每 50ms 触发一次
  });
}

async function ensureAiChatReady() {
  if (!shouldMountAiChat.value) {
    shouldMountAiChat.value = true;
    await nextTick();
  }

  const startedAt = Date.now();
  while (!aiChatRef.value && Date.now() - startedAt < 1200) {
    await new Promise((resolve) => window.setTimeout(resolve, 16));
  }

  return aiChatRef.value;
}

async function ensureTagCloudReady() {
  if (!shouldMountTagCloud.value) {
    shouldMountTagCloud.value = true;
    await nextTick();
  }

  const startedAt = Date.now();
  while (!tagCloudRef.value && Date.now() - startedAt < 1600) {
    await new Promise((resolve) => window.setTimeout(resolve, 16));
  }

  return tagCloudRef.value;
}

// 叠加模式状态
function goToNarrative() {
  router.push('/narrative');
}

function stopCurrentLocationWatch() {
  if (geolocationWatchId === null) return;
  if (typeof navigator !== 'undefined' && navigator.geolocation?.clearWatch) {
    navigator.geolocation.clearWatch(geolocationWatchId);
  }
  geolocationWatchId = null;
}

function getCurrentMapDisplayCenter() {
  const center = map.value?.getView?.()?.getCenter?.();
  if (!center) return null;
  const [lon, lat] = toLonLat(center);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function evaluateCurrentLocationCandidate(location) {
  const referenceCenter = resolveLocationReferenceCenter({
    mapCenter: getCurrentMapDisplayCenter(),
    mapBounds: mapBounds.value,
    fallbackCenter: DEFAULT_LOCATION_REFERENCE_CENTER
  });
  return assessBrowserUserLocation(location, {
    referenceLon: referenceCenter?.lon ?? null,
    referenceLat: referenceCenter?.lat ?? null
  });
}

async function readGeolocationPermissionState() {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return 'unknown';
    }
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return String(result?.state || 'unknown');
  } catch {
    return 'unknown';
  }
}

function buildCurrentLocationWarningMessage(review, diagnostics = {}) {
  if (review.reason === 'far_from_reference') {
    const distanceKm = Number.isFinite(review.distanceKm) ? Math.round(review.distanceKm) : null;
    const accuracyM = Number.isFinite(review.accuracyM) ? Math.round(review.accuracyM) : null;
    const distanceText = distanceKm !== null ? `与当前地图焦点相距约 ${distanceKm} 公里` : '与当前地图焦点相距较远';
    const accuracyText = accuracyM !== null ? `，精度约 ${accuracyM} 米` : '';
    return `浏览器这次返回的位置${distanceText}${accuracyText}，可信度偏低，暂不启用当前位置。请重试定位，或直接告诉我一个地点。`;
  }

  if (review.reason === 'accuracy_too_coarse') {
    const accuracyM = Number.isFinite(review.accuracyM) ? Math.round(review.accuracyM) : null;
    const accuracyText = accuracyM !== null ? `（当前精度约 ${accuracyM} 米）` : '';
    const browserHint = buildCoarseLocationBrowserHint({
      browserBrand: diagnostics.browserBrand,
      accuracyM,
      permissionState: diagnostics.permissionState
    });
    return `浏览器返回的位置精度过粗${accuracyText}，暂不启用当前位置。${browserHint} 请检查系统定位服务后重试，或直接告诉我一个地点。`;
  }

  return '浏览器返回的位置不够稳定，暂不启用当前位置。请重试定位，或直接告诉我一个地点。';
}

function buildCurrentLocationProgressMessage(review) {
  const accuracyM = Number.isFinite(review?.accuracyM) ? Math.round(review.accuracyM) : null;
  const accuracyText = accuracyM !== null ? `当前精度约 ${accuracyM} 米` : '浏览器先给了一个粗略网络位置';

  if (review?.reason === 'far_from_reference') {
    const distanceKm = Number.isFinite(review?.distanceKm) ? Math.round(review.distanceKm) : null;
    const distanceText = distanceKm !== null ? `，与当前地图焦点相差约 ${distanceKm} 公里` : '';
    return `${accuracyText}${distanceText}，我先继续等待更精确的设备定位结果。`;
  }

  return `${accuracyText}，我先继续等待更精确的设备定位结果。`;
}

function animateToUserLocation(location, options = {}) {
  if (!map.value || !location) return;
  const view = map.value.getView?.();
  if (!view) return;

  const zoomFloor = Number.isFinite(Number(options.zoomFloor))
    ? Number(options.zoomFloor)
    : 16;
  const currentZoom = Number(view.getZoom?.()) || 14;

  view.animate({
    center: fromLonLat([location.lon, location.lat]),
    zoom: Math.max(currentZoom, zoomFloor),
    duration: 700
  });
}

function applyCurrentLocation(nextLocation, options = {}) {
  if (!nextLocation) return;
  userLocation.value = nextLocation;
  userLocationStatus.value = 'ready';

  if (options.animate !== false) {
    animateToUserLocation(nextLocation, options);
  }
}

function startCurrentLocationWatch() {
  if (geolocationWatchId !== null) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation?.watchPosition) return;

  geolocationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const nextLocation = createBrowserUserLocation(position);
      if (!nextLocation) return;
      const review = evaluateCurrentLocationCandidate(nextLocation);
      if (!review.reliable) return;
      applyCurrentLocation(nextLocation, { animate: false });
    },
    (error) => {
      if (Number(error?.code) === 1) {
        userLocationStatus.value = userLocation.value ? 'ready' : 'denied';
        stopCurrentLocationWatch();
        return;
      }

      if (!userLocation.value) {
        userLocationStatus.value = 'error';
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000
    }
  );
}

function requestCurrentLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) {
    userLocationStatus.value = 'unsupported';
    ElNotification.warning({
      title: '定位不可用',
      message: '当前浏览环境不支持获取设备位置，请直接输入一个地点。',
      offset: 80
    });
    return Promise.resolve(null);
  }

  stopCurrentLocationWatch();
  userLocationStatus.value = 'locating';

  return new Promise((resolve) => {
    const attemptDiagnostics = {
      browserBrand: detectBrowserBrand(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      permissionState: 'unknown'
    };
    let settled = false;
    let tempWatchId = null;
    let refinementTimerId = null;
    let waitingNoticeShown = false;
    let latestRetryableReview = null;

    void readGeolocationPermissionState().then((state) => {
      attemptDiagnostics.permissionState = state;
    });

    const clearTemporaryWatch = () => {
      if (tempWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation?.clearWatch) {
        navigator.geolocation.clearWatch(tempWatchId);
      }
      tempWatchId = null;

      if (refinementTimerId !== null) {
        window.clearTimeout(refinementTimerId);
        refinementTimerId = null;
      }
    };

    const finish = (location = null) => {
      if (settled) return;
      settled = true;
      clearTemporaryWatch();
      resolve(location);
    };

    const acceptLocation = (nextLocation, { animate = true } = {}) => {
      applyCurrentLocation(nextLocation, { animate, zoomFloor: 16 });
      startCurrentLocationWatch();
      ElNotification.success({
        title: '当前位置已启用',
        message: '后续“我附近 / 离我最近 / 从我这里出发”都会以你的设备位置为锚点。',
        offset: 80
      });
      finish(nextLocation);
    };

    const rejectLocation = (review = null) => {
      userLocationStatus.value = userLocation.value ? 'ready' : 'error';
      if (review && shouldRetryBrowserLocation(review)) {
        startCurrentLocationWatch();
      }
      ElNotification.warning({
        title: '定位可信度不足',
        message: review
          ? buildCurrentLocationWarningMessage(review, attemptDiagnostics)
          : '这次只拿到了粗略网络位置，还没等到更精确的设备定位。你可以再试一次，或者直接告诉我一个地点。',
        offset: 80,
        duration: 4200
      });
      finish(null);
    };

    const handleLocationCandidate = (nextLocation, { animateOnAccept = true } = {}) => {
      if (!nextLocation) {
        userLocationStatus.value = userLocation.value ? 'ready' : 'error';
        ElNotification.error({
          title: '定位失败',
          message: '浏览器返回了位置数据，但前端没有成功解析坐标。',
          offset: 80
        });
        finish(null);
        return true;
      }

      const review = evaluateCurrentLocationCandidate(nextLocation);
      if (review.reliable) {
        acceptLocation(nextLocation, { animate: animateOnAccept });
        return true;
      }

      if (shouldRetryBrowserLocation(review)) {
        latestRetryableReview = review;
        if (!waitingNoticeShown) {
          waitingNoticeShown = true;
          ElNotification.info({
            title: '正在细化定位',
            message: buildCurrentLocationProgressMessage(review),
            offset: 80,
            duration: 2600
          });
        }
        return false;
      }

      rejectLocation(review);
      return true;
    };

    if (navigator.geolocation?.watchPosition) {
      tempWatchId = navigator.geolocation.watchPosition(
        (position) => {
          if (settled) return;
          handleLocationCandidate(createBrowserUserLocation(position), { animateOnAccept: true });
        },
        (error) => {
          if (settled) return;

          if (Number(error?.code) === 1) {
            userLocationStatus.value = userLocation.value ? 'ready' : 'denied';
            ElNotification.warning({
              title: '未授权定位',
              message: '请授权当前位置，或者直接告诉我一个地点。',
              offset: 80
            });
            finish(null);
          }
        },
        GEOLOCATION_REFINEMENT_WATCH_OPTIONS
      );
    }

    refinementTimerId = window.setTimeout(() => {
      if (settled) return;
      rejectLocation(latestRetryableReview);
    }, GEOLOCATION_REFINEMENT_TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled) return;
        handleLocationCandidate(createBrowserUserLocation(position), { animateOnAccept: true });
      },
      (error) => {
        if (settled) return;

        if (Number(error?.code) === 1) {
          userLocationStatus.value = 'denied';
          ElNotification.warning({
            title: '未授权定位',
            message: '请授权当前位置，或者直接告诉我一个地点。',
            offset: 80
          });
          finish(null);
        } else if (Number(error?.code) === 3 && tempWatchId === null) {
          userLocationStatus.value = userLocation.value ? 'ready' : 'error';
          ElNotification.warning({
            title: '定位超时',
            message: '这次没等到定位结果，可以再试一次。',
            offset: 80
          });
          finish(null);
        } else if (Number(error?.code) !== 3 && tempWatchId === null) {
          userLocationStatus.value = userLocation.value ? 'ready' : 'error';
          ElNotification.error({
            title: '定位失败',
            message: error?.message || '浏览器暂时拿不到当前位置。',
            offset: 80
          });
          finish(null);
        } else {
          latestRetryableReview = latestRetryableReview || null;
        }
      },
      GEOLOCATION_OPTIONS
    );
  });
}

function scheduleTagDataSync(features, { defer = false } = {}) {
  const nextFeatures = Array.isArray(features) ? features : [];
  const token = ++tagDataSyncToken;
  const commit = () => {
    if (token !== tagDataSyncToken) return;
    tagData.value = nextFeatures;
  };

  if (!defer) {
    commit();
    return;
  }

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => commit(), { timeout: 180 });
    return;
  }

  window.setTimeout(() => commit(), 64);
}

function normalizeCategoryPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return [];

  if (Array.isArray(paths[0])) {
    return paths
      .filter(path => Array.isArray(path) && path.length > 0)
      .map(path => [...path]);
  }

  return [paths];
}

function getSelectedCategoryLeaves(paths) {
  const normalized = normalizeCategoryPaths(paths);
  return [...new Set(normalized.map(path => path[path.length - 1]).filter(Boolean))];
}

function polygonToWKT(polygon, options = {}) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;

  const { forBackend = false } = options;

  const points = polygon
    .map((pt) => {
      if (Array.isArray(pt) && pt.length >= 2) {
        return [Number(pt[0]), Number(pt[1])];
      }
      if (pt && typeof pt === 'object') {
        return [Number(pt.lon), Number(pt.lat)];
      }
      return null;
    })
    .filter((pt) => Number.isFinite(pt?.[0]) && Number.isFinite(pt?.[1]));

  if (points.length < 3) return null;

  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    points.push(first);
  }

  const coords = points
    .map(([lon, lat]) => forBackend ? toBackendPoint(lon, lat) : [lon, lat])
    .map(([lon, lat]) => `${lon} ${lat}`)
    .join(', ');
  return `POLYGON((${coords}))`;
}


function normalizeCircleCenter(center) {
  if (Array.isArray(center) && center.length >= 2) {
    const lon = Number(center[0]);
    const lat = Number(center[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }

  if (center && typeof center === 'object') {
    const lon = Number(center.lon);
    const lat = Number(center.lat);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }

  return null;
}

function circleToWKT(center, radiusMeters, segments = 72, options = {}) {
  const centerPoint = normalizeCircleCenter(center);
  const radius = Number(radiusMeters);

  if (!centerPoint || !Number.isFinite(radius) || radius <= 0) {
    return null;
  }

  const { forBackend = false } = options;
  const [centerLonRaw, centerLatRaw] = centerPoint;
  const [centerLon, centerLat] = forBackend
    ? toBackendPoint(centerLonRaw, centerLatRaw)
    : [centerLonRaw, centerLatRaw];
  const earthRadius = 6378137;
  const angularDistance = radius / earthRadius;
  const lat1 = (centerLat * Math.PI) / 180;
  const lon1 = (centerLon * Math.PI) / 180;

  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const bearing = (i / segments) * 2 * Math.PI;
    const sinLat2 = Math.sin(lat1) * Math.cos(angularDistance)
      + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
    const lat2 = Math.asin(sinLat2);
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

    const lon = (lon2 * 180) / Math.PI;
    const lat = (lat2 * 180) / Math.PI;
    points.push(`${lon} ${lat}`);
  }

  return `POLYGON((${points.join(', ')}))`;
}

function polygonPointsFromWKT(wkt) {
  if (typeof wkt !== 'string') return [];

  const match = wkt.match(/POLYGON\s*\(\(\s*(.+?)\s*\)\)/i);
  if (!match || !match[1]) return [];

  return match[1]
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .filter((pair) => pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
    .map((pair) => [pair[0], pair[1]]);
}

function resolveRegionConstraints() {
  if (!Array.isArray(regions.value) || regions.value.length === 0) {
    return [];
  }

  return regions.value
    .map((region) => {
      const geometry = region?.geometry || {};
      const regionType = String(region?.type || geometry?.type || '').toLowerCase();

      if (regionType === 'circle' || geometry?.type === 'Point') {
        const center = normalizeCircleCenter(geometry?.coordinates || region?.center);
        const radius = Number(geometry?.radius);
        if (center && Number.isFinite(radius) && radius > 0) {
          return {
            kind: 'circle',
            center,
            radius,
            wkt: typeof region?.boundaryWKT === 'string'
              ? region.boundaryWKT
              : circleToWKT(center, radius)
          };
        }
      }

      const polygonCoords = geometry?.type === 'Polygon'
        ? geometry?.coordinates?.[0]
        : geometry?.type === 'MultiPolygon'
          ? geometry?.coordinates?.[0]?.[0]
          : null;

      const polygonPoints = normalizePolygonPoints(polygonCoords || []);
      if (polygonPoints.length >= 3) {
        return {
          kind: 'polygon',
          points: polygonPoints,
          wkt: typeof region?.boundaryWKT === 'string'
            ? region.boundaryWKT
            : polygonToWKT(polygonPoints)
        };
      }

      const fallbackWKT = typeof region?.boundaryWKT === 'string' ? region.boundaryWKT.trim() : '';
      const fallbackPoints = polygonPointsFromWKT(fallbackWKT);
      if (fallbackPoints.length >= 3) {
        return {
          kind: 'polygon',
          points: fallbackPoints,
          wkt: fallbackWKT
        };
      }

      return null;
    })
    .filter(Boolean);
}

function resolveSingleConstraintFallback() {
  const polygonPoints = normalizePolygonPoints(selectedPolygon.value);
  if (polygonPoints.length >= 3) {
    return [{
      kind: 'polygon',
      points: polygonPoints,
      wkt: polygonToWKT(polygonPoints)
    }];
  }

  if (String(selectedDrawMode.value || '').toLowerCase() === 'circle') {
    const center = normalizeCircleCenter(circleCenterGeo.value);
    const radius = Number(circleRadiusMeters.value);
    if (center && Number.isFinite(radius) && radius > 0) {
      return [{
        kind: 'circle',
        center,
        radius,
        wkt: circleToWKT(center, radius)
      }];
    }
  }

  return [];
}

function resolveSpatialConstraints() {
  const regionConstraints = resolveRegionConstraints();
  if (regionConstraints.length > 0) {
    return regionConstraints;
  }
  return resolveSingleConstraintFallback();
}

function extractBoundsFromWKT(wkt) {
  if (typeof wkt !== 'string') return null;

  const numbers = wkt.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 8) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (let i = 0; i < numbers.length - 1; i += 2) {
    const lon = Number(numbers[i]);
    const lat = Number(numbers[i + 1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return null;
  }

  return [minLon, minLat, maxLon, maxLat];
}

function resolveConstraintBounds(constraints, options = {}) {
  const { forBackend = false, padding = 0 } = options;
  if (!Array.isArray(constraints) || constraints.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const pushPoint = (lon, lat) => {
    const sourceLon = Number(lon);
    const sourceLat = Number(lat);
    if (!Number.isFinite(sourceLon) || !Number.isFinite(sourceLat)) return;

    const [targetLon, targetLat] = forBackend
      ? toBackendPoint(sourceLon, sourceLat)
      : [sourceLon, sourceLat];

    minLon = Math.min(minLon, targetLon);
    minLat = Math.min(minLat, targetLat);
    maxLon = Math.max(maxLon, targetLon);
    maxLat = Math.max(maxLat, targetLat);
  };

  constraints.forEach((constraint) => {
    if (constraint.kind === 'polygon' && Array.isArray(constraint.points)) {
      constraint.points.forEach(([lon, lat]) => pushPoint(lon, lat));
      return;
    }

    if (constraint.kind === 'circle' && Array.isArray(constraint.center)) {
      const radius = Number(constraint.radius);
      if (!Number.isFinite(radius) || radius <= 0) return;

      const latOffset = radius / 111320;
      const lonOffset = latOffset / Math.max(Math.cos((constraint.center[1] * Math.PI) / 180), 1e-6);
      pushPoint(constraint.center[0] - lonOffset, constraint.center[1] - latOffset);
      pushPoint(constraint.center[0] + lonOffset, constraint.center[1] + latOffset);
      return;
    }

    if (typeof constraint.wkt === 'string') {
      const fromWKT = extractBoundsFromWKT(constraint.wkt);
      if (fromWKT) {
        pushPoint(fromWKT[0], fromWKT[1]);
        pushPoint(fromWKT[2], fromWKT[3]);
      }
    }
  });

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return null;
  }

  return [minLon - padding, minLat - padding, maxLon + padding, maxLat + padding];
}

function constraintToGeometryWKT(constraint, forBackend = false) {
  // 统一转换为标准 WKT 格式进行查询
  if (!constraint || typeof constraint !== 'object') {
    return null;
  }

  // 优先使用选区原始 WKT，确保圆形等绘制边界与地图上看到的形状完全一致
  if (typeof constraint.wkt === 'string' && constraint.wkt.trim()) {
    if (!forBackend || !shouldProjectToGcjForFilter) {
      return constraint.wkt.trim();
    }

    const points = polygonPointsFromWKT(constraint.wkt);
    if (points.length >= 3) {
      return polygonToWKT(points, { forBackend: true });
    }
  }

  if (constraint.kind === 'polygon' && Array.isArray(constraint.points)) {
    return polygonToWKT(constraint.points, { forBackend });
  }

  if (constraint.kind === 'circle' && Array.isArray(constraint.center)) {
    return circleToWKT(constraint.center, constraint.radius, 72, { forBackend });
  }

  return null;
}

function resolveManualGeometryWKT(forBackend = false) {
  const constraints = resolveSpatialConstraints();
  if (constraints.length !== 1) {
    return null;
  }

  return constraintToGeometryWKT(constraints[0], forBackend);
}

function hasManualSpatialSelection() {
  return resolveSpatialConstraints().length > 0;
}

function syncLegacySpatialStateFromConstraints() {
  // 当选中区域集合变化时，同步更新旧有的空间选择状态
  const constraints = resolveRegionConstraints();

  if (constraints.length !== 1) {
    selectedPolygon.value = null;
    selectedDrawMode.value = '';
    circleCenterGeo.value = null;
    circleRadiusMeters.value = null;
    return;
  }

  const [constraint] = constraints;
  if (constraint.kind === 'polygon' && Array.isArray(constraint.points)) {
    selectedPolygon.value = constraint.points.map(([lon, lat]) => [lon, lat]);
    selectedDrawMode.value = 'Polygon';
    circleCenterGeo.value = null;
    circleRadiusMeters.value = null;
    return;
  }

  if (constraint.kind === 'circle' && Array.isArray(constraint.center)) {
    selectedPolygon.value = null;
    selectedDrawMode.value = 'Circle';
    circleCenterGeo.value = [...constraint.center];
    circleRadiusMeters.value = Number(constraint.radius) || null;
    return;
  }

  selectedPolygon.value = null;
  selectedDrawMode.value = '';
  circleCenterGeo.value = null;
  circleRadiusMeters.value = null;
}

async function fetchManualFilteredFeatures(categories = [], options = {}) {
  const normalizedCategories = Array.isArray(categories) ? categories : [];
  const requestLimit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 20000;

  const fetchByPayload = async (payload) => {
    const response = await fetch(`${SPATIAL_API_BASE_URL}/api/spatial/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`fetch filtered POIs failed (${response.status})`);
    }

    const data = await response.json();
    if (!data?.success || !Array.isArray(data.features)) {
      return [];
    }

    return data.features;
  };

  const constraints = resolveSpatialConstraints();
  if (constraints.length > 0) {
    // 约束统一写入 payload，后端按 OR 关系解析各片区条件
    const regionPayloads = constraints
      .map((constraint, index) => {
        const boundaryWKT = constraintToGeometryWKT(constraint, true);
        if (!boundaryWKT) {
          return null;
        }
        return {
          id: index + 1,
          kind: constraint.kind,
          boundaryWKT
        };
      })
      .filter(Boolean);

    if (regionPayloads.length > 0) {
      return fetchByPayload({
        categories: normalizedCategories,
        limit: requestLimit,
        regions: regionPayloads
      });
    }
  }

  const requestBody = {
    categories: normalizedCategories,
    limit: requestLimit
  };

  const geometryWKT = resolveManualGeometryWKT(true);
  if (geometryWKT) {
    requestBody.geometry = geometryWKT;
  } else {
    const backendBounds = boundsToBackend(mapBounds.value);
    if (backendBounds) {
      requestBody.bounds = backendBounds;
    }
  }

  if (!requestBody.bounds && !requestBody.geometry) {
    return [];
  }

  return fetchByPayload(requestBody);
}


function syncCategorySelectors(paths) {
  controlPanelRefMap.value?.setCategorySelection?.(paths);
  controlPanelRefTag.value?.setCategorySelection?.(paths);
  controlPanelRefMobile.value?.setCategorySelection?.(paths);
}

const MAX_MANUAL_FETCH_LIMIT = 500000;
let manualFilterRequestToken = 0;

// Keep filtering coordinates in the same space as map rendering (GCJ02 when POI source is WGS84).
const poiCoordSys = (import.meta.env.VITE_POI_COORD_SYS || 'gcj02').toLowerCase();
const shouldProjectToGcjForFilter = poiCoordSys === 'wgs84';

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function outOfChina(lon, lat) {
  return (lon < 72.004 || lon > 137.8347) || (lat < 0.8293 || lat > 55.8271);
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat];

  const dLat = transformLat(lon - 105.0, lat - 35.0);
  const dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const mgLat = lat + (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  const mgLon = lon + (dLon * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [mgLon, mgLat];
}

function gcj02ToWgs84(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat];

  const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat);
  return [lon * 2 - gcjLon, lat * 2 - gcjLat];
}

function toBackendPoint(lon, lat) {
  if (!shouldProjectToGcjForFilter) {
    return [lon, lat];
  }
  return gcj02ToWgs84(lon, lat);
}

function normalizeBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 4) return null;

  const minLon = Number(bounds[0]);
  const minLat = Number(bounds[1]);
  const maxLon = Number(bounds[2]);
  const maxLat = Number(bounds[3]);

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;

  return [
    Math.min(minLon, maxLon),
    Math.min(minLat, maxLat),
    Math.max(minLon, maxLon),
    Math.max(minLat, maxLat)
  ];
}

function boundsToBackend(bounds) {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return null;

  if (!shouldProjectToGcjForFilter) {
    return normalized;
  }

  const [swLon, swLat] = toBackendPoint(normalized[0], normalized[1]);
  const [neLon, neLat] = toBackendPoint(normalized[2], normalized[3]);

  return normalizeBounds([swLon, swLat, neLon, neLat]);
}

function normalizeFeatureCategoryText(feature) {
  const props = feature?.properties || {};
  // 用 push 替代 filter().join() 减少临时数组分配，在万级 POI 场景下显著减GC 压力
  const parts = [];
  if (props.name) parts.push(props.name);
  if (props['名称']) parts.push(props['名称']);
  if (props.type) parts.push(props.type);
  if (props['类型']) parts.push(props['类型']);
  if (props.category_big) parts.push(props.category_big);
  if (props.category_mid) parts.push(props.category_mid);
  if (props.category_small) parts.push(props.category_small);
  if (props['大类']) parts.push(props['大类']);
  if (props['中类']) parts.push(props['中类']);
  if (props['小类']) parts.push(props['小类']);
  return parts.join(' ').toLowerCase();
}

function normalizeFeatureCoordinate(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  if (shouldProjectToGcjForFilter) {
    return wgs84ToGcj02(lon, lat);
  }

  return [lon, lat];
}

function normalizePolygonPoints(polygon) {
  if (!Array.isArray(polygon)) return [];

  return polygon
    .map((pt) => {
      if (Array.isArray(pt) && pt.length >= 2) {
        return [Number(pt[0]), Number(pt[1])];
      }

      if (pt && typeof pt === 'object') {
        return [Number(pt.lon), Number(pt.lat)];
      }

      return null;
    })
    .filter((pt) => Number.isFinite(pt?.[0]) && Number.isFinite(pt?.[1]));
}

function pointInPolygon(point, polygonPoints) {
  if (!point || polygonPoints.length < 3) return false;
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const [xi, yi] = polygonPoints[i];
    const [xj, yj] = polygonPoints[j];
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }

  return inside;
}


function haversineDistanceMeters(from, to) {
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;
  const earthRadius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInCircle(point, center, radiusMeters) {
  const centerPoint = normalizeCircleCenter(center);
  const radius = Number(radiusMeters);
  if (!centerPoint || !Number.isFinite(radius) || radius <= 0) {
    return false;
  }
  return haversineDistanceMeters(point, centerPoint) <= radius;
}

function getConstraintClipPolygon(constraint) {
  if (!constraint || typeof constraint !== 'object') {
    return [];
  }

  if (constraint.kind === 'polygon' && Array.isArray(constraint.points) && constraint.points.length >= 3) {
    return constraint.points;
  }

  if (typeof constraint.wkt === 'string' && constraint.wkt.trim()) {
    return normalizePolygonPoints(polygonPointsFromWKT(constraint.wkt));
  }

  return [];
}

function isPointWithinAnyConstraint(point, constraints) {
  if (!Array.isArray(constraints) || constraints.length === 0) {
    return false;
  }

  return constraints.some((constraint) => {
    // 先按边界多边形判断，确保“所见即所得”的严格裁剪结果
    const clipPolygon = getConstraintClipPolygon(constraint);
    if (clipPolygon.length >= 3) {
      return pointInPolygon(point, clipPolygon);
    }

    if (constraint.kind === 'circle' && Array.isArray(constraint.center)) {
      return pointInCircle(point, constraint.center, constraint.radius);
    }

    return false;
  });
}

function filterFeaturesClientSide(features, categoryLeaves) {
  const normalizedCategories = Array.isArray(categoryLeaves)
    ? categoryLeaves.map((cat) => String(cat).toLowerCase()).filter(Boolean)
    : [];

  const hasCategoryFilter = normalizedCategories.length > 0;
  // 用 Set 做类别精确匹配前缀查找，替Array.some(includes) O(m) 搜索
  const categorySet = hasCategoryFilter ? new Set(normalizedCategories) : null;
  const constraints = resolveSpatialConstraints();
  const hasConstraintFilter = constraints.length > 0;
  const bounds = Array.isArray(mapBounds.value) && mapBounds.value.length >= 4
    ? mapBounds.value
    : null;

  // 快速路径：无任何过滤条件时直接返回原数据
  if (!hasConstraintFilter && !bounds && !hasCategoryFilter) {
    return Array.isArray(features) ? features : [];
  }

  // 预取 bounds 值循馗
  const [bMinLon, bMinLat, bMaxLon, bMaxLat] = bounds || [0, 0, 0, 0];

  return (Array.isArray(features) ? features : []).filter((feature) => {
    const coord = normalizeFeatureCoordinate(feature);
    if (!coord) return false;

    if (hasConstraintFilter) {
      if (!isPointWithinAnyConstraint(coord, constraints)) {
        return false;
      }
    } else if (bounds) {
      const [lon, lat] = coord;
      if (lon < bMinLon || lon > bMaxLon || lat < bMinLat || lat > bMaxLat) {
        return false;
      }
    }

    if (!hasCategoryFilter) {
      return true;
    }

    // 分词后用 Set.has 做精确匹配（覆盖单类别词匹配场景），
    // 同时保留 includes 作为兜底模糊匹配
    const categoryText = normalizeFeatureCategoryText(feature);
    const words = categoryText.split(/\s+/);
    for (let i = 0; i < normalizedCategories.length; i++) {
      const cat = normalizedCategories[i];
      // 优先精确匹配（O(1)），兜底子串匹配
      if (categorySet.has(cat) && (words.includes(cat) || categoryText.includes(cat))) {
        return true;
      }
    }
    return false;
  });
}

function applySelectionResults(features, options = {}) {
  const normalizedFeatures = Array.isArray(features) ? features : [];
  const {
    updateTagCloud = false,
    fitView = false,
    keepMapHighlight = true
  } = options;

  selectedFeatures.value = normalizedFeatures;

  if (updateTagCloud) {
    tagData.value = normalizedFeatures;
  }

  if (keepMapHighlight && mapComponent.value) {
    mapComponent.value.showHighlights(normalizedFeatures, { fitView });
  }

  return normalizedFeatures;
}

async function refreshManualSelectionSource(options = {}) {
  const {
    updateTagCloud = false,
    fitView = false,
    keepMapHighlight = true,
    silent = true,
    limit = MAX_MANUAL_FETCH_LIMIT,
    allowViewportFallback = false
  } = options;

  const requestToken = ++manualFilterRequestToken;
  const categoryLeaves = getSelectedCategoryLeaves(selectedCategoryPath.value);
  const hasCategoryFilter = categoryLeaves.length > 0;
  const hasCustomArea = hasManualSpatialSelection();

  // 业约未选选未选时侄筛选乇氡Ｖ空?
  // 页始时远取哟 20000 录没图一隆
  if (!hasCustomArea && !hasCategoryFilter && !allowViewportFallback) {
    return applySelectionResults([], {
      updateTagCloud,
      fitView: false,
      keepMapHighlight
    });
  }

  try {
    const features = await fetchManualFilteredFeatures(categoryLeaves, { limit });
    if (requestToken !== manualFilterRequestToken) return [];

    // 后端筛选结果仍进行一次前端严格裁剪，保证最终渲染 POI 100% 在约束内
    const strictFeatures = filterFeaturesClientSide(features, categoryLeaves);
    return applySelectionResults(strictFeatures, { updateTagCloud, fitView, keepMapHighlight });
  } catch (error) {
    if (requestToken !== manualFilterRequestToken) return [];

    console.error('[App] 刷新手动筛选数据失败，回退到前端过滤', error);
    const fallbackFeatures = filterFeaturesClientSide(allPoiFeatures.value, categoryLeaves);
    applySelectionResults(fallbackFeatures, { updateTagCloud, fitView, keepMapHighlight });

    if (!silent) {
      ElNotification.warning({
        title: '已使用本地回退',
        message: '后端筛选失败，已回退为前端近似筛选。',
        offset: 80
      });
    }

    return fallbackFeatures;
  }
}

async function handleCategoryChange(paths) {
  const normalizedPaths = normalizeCategoryPaths(paths);
  selectedCategoryPath.value = normalizedPaths;
  syncCategorySelectors(normalizedPaths);

  await refreshManualSelectionSource({
    updateTagCloud: false,
    fitView: false,
    keepMapHighlight: true,
    silent: true
  });
}

const activeGroups = ref([]); // [{ name: 'A', features: [] }, ...]
const heatmapEnabled = ref(false); // 新增热力图同步状态

// 权重渲染状态
const weightEnabled = ref(false); // 是否启用权重渲染
const showWeightValue = ref(false); // 鏄惁鏄剧ず鏉冮噸鍊?

// 全域感知模式（开启后 AI 将综合分析所有类型POI
const globalAnalysisEnabled = ref(false);

/**
 * 节流函数工具
 * 聘频录图贫拇频
 * @param {Function} func - 需要节流的函数
 * @param {number} limit - 时耄?
 */
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

/**
 * 计算属性：过滤后的标签数据
 * 如果开启了实时过滤，则只显示当前地图视野内个 POI
 * 否则显示所有tagData 中的数据（通常是绘图选中的数据）
 */
const filteredTagData = computed(() => {
  if (!filterEnabled.value || !mapBounds.value) {
    return tagData.value;
  }
  // 预取野呓纾?
  const [minLon, minLat, maxLon, maxLat] = mapBounds.value;
  return tagData.value.filter(f => {
    const coords = f.geometry.coordinates;
    const lon = coords[0];
    const lat = coords[1];
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  });
});

// Keep map rendering source aligned with AI analysis source under area/category constraints.
const mapPoiFeatures = computed(() => {
  const hasCategoryFilter = getSelectedCategoryLeaves(selectedCategoryPath.value).length > 0;
  if (hasCategoryFilter || hasManualSpatialSelection()) {
    return selectedFeatures.value;
  }
  return allPoiFeatures.value;
});

watch(
  () => regions.value.map(region => `${region.id}:${region.type}:${region.boundaryWKT || ''}`).join('|'),
  () => {
    // 选模式维选状态 boundary/圆实选一隆
    syncLegacySpatialStateFromConstraints();
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener('resize', handleResize);
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);

  // 初始化标签云为空数据；用户需要显式加载数据
  tagData.value = [];

  const deferMount = window.requestIdleCallback
    ? (callback) => window.requestIdleCallback(callback, { timeout: 220 })
    : (callback) => window.setTimeout(callback, 48);

  deferMount(() => {
    shouldMountAiChat.value = true;
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
  stopCurrentLocationWatch();
});

// 开始拖- 地图/标签云分隔条
function startDrag1(e) {
  if (e) e.preventDefault();
  isDragging1.value = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

// 拖拽过程中
function onDrag(e) {
  if (!isDragging1.value) return;
  
  e.preventDefault();
  
  // 找到左侧区域
  const leftSection = document.querySelector('.left-section');
  if (!leftSection) return;
  
  const rect = leftSection.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const totalWidth = rect.width;
  
  // 计算百分比并限制范围
  let newPercent = (x / totalWidth) * 100;
  newPercent = Math.max(10, Math.min(90, newPercent));
  splitPercentage1.value = newPercent;
  
  // 实时更新布局
  handleResize();
}

// 鍋滄鎷栨嫿
function stopDrag() {
  if (isDragging1.value) {
    isDragging1.value = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // 确保组件大小正确同步
    nextTick(() => {
      handleResize();
    });
  }
}

// 处理窗口大小调整，更新地图尺
const handleResize = () => {
  if (map.value && typeof map.value.updateSize === 'function') {
    map.value.updateSize();
  }
  if (tagCloudRef.value && typeof tagCloudRef.value.resize === 'function') {
    tagCloudRef.value.resize();
  }
};

/**
 * 处理运行算法请求
 * 当用户在控制面板点击"生成词云"时触发
 * @param {Object|string} payload - 包含算法名称和配置的对象，或仅算法名称字符串
 */

const handleRunAlgorithm = async (payload) => {
  const algorithm = typeof payload === 'string' ? payload : payload?.algorithm;
  selectedAlgorithm.value = algorithm || 'spiral';
  spiralConfig.value = typeof payload === 'object' ? payload?.config || null : null;

  const latestFeatures = await refreshManualSelectionSource({
    updateTagCloud: true,
    fitView: false,
    keepMapHighlight: true,
    silent: false,
    limit: MAX_MANUAL_FETCH_LIMIT
  });

  if (!latestFeatures.length) {
    ElNotification.warning({
      title: '暂无可渲染数据',
      message: '当前约束范围内没有可用于词云渲染的 POI。',
      offset: 80
    });
  }

  console.log('[App] 已应用手动约束，当前 POI 数量:', latestFeatures.length);
};

/**
 * 处理数据加载完成
 * 当用户上传文件或加载预设数据后触发
 * @param {Object} payload - { success, name, features }
 */
const handleDataLoaded = (payload) => {
  if (payload && payload.success && payload.features) {
    // 构造新数据
    const newGroup = { 
      name: payload.name, 
      category: payload.category || payload.name, // 使用 category 作为唯一标识
      features: payload.features 
    };
    
    // 始终采用叠加/追加模式
    // 检查该类别是否已加
    const existsIndex = activeGroups.value.findIndex(g => g.category === newGroup.category);
    
    if (existsIndex >= 0) {
      // 如果已存在，则更新数据（可能是重新加载）
      activeGroups.value[existsIndex] = newGroup;
    } else {
      // 否则追加新组
      activeGroups.value.push(newGroup);
    }
    
    updateAllPoiFeatures();

    // 分类数据变更后，重新同步“可分析 POI 池”，保证 AI 计数与词云来源一致
    const hasCategoryFilter = getSelectedCategoryLeaves(selectedCategoryPath.value).length > 0;
    const hasCustomArea = hasManualSpatialSelection();
    if (hasCategoryFilter || hasCustomArea) {
      void refreshManualSelectionSource({
        updateTagCloud: false,
        fitView: false,
        keepMapHighlight: true,
        silent: true
      });
    }
    
    // 注意：这里只加载数据，不自动渲染红点
  }
};

/**
 * 处理数据移除
 * 当用户取消勾选某个分类时触发
 * @param {string} categoryToRemove - 要移除的类别名称
 */
const handleDataRemoved = (categoryToRemove) => {
  if (!categoryToRemove) return;
  
  const initialLength = activeGroups.value.length;
  activeGroups.value = activeGroups.value.filter(g => g.category !== categoryToRemove);
  
  if (activeGroups.value.length < initialLength) {
    updateAllPoiFeatures();
    void refreshManualSelectionSource({
      updateTagCloud: false,
      fitView: false,
      keepMapHighlight: true,
      silent: true
    });
    ElNotification.info({ title: '已移除', message: `移除图层: ${categoryToRemove}`, offset: 80 });
  }
};
    


/**
 * 更新所有POI 特征，合并所有活动分组并分配颜色索引
 */
function updateAllPoiFeatures() {
  let merged = [];
  activeGroups.value.forEach((group, index) => {
    // 为每个feature 添加 _groupIndex 属
    const taggedFeatures = group.features.map(f => {
      const newProps = { ...f.properties, _groupIndex: index };
      return { ...f, properties: newProps };
    });
    merged = merged.concat(taggedFeatures);
  });
  allPoiFeatures.value = merged;
  
  // MapContainer 组件会自动监听poiFeatures 变化并根据当前geometry 重新筛选
}



/**
 * 处理权重变化事件
 * @param {Object} payload - { enabled, showValue, weightType?, needLoad? }
 */
async function handleWeightChange(payload) {
  console.log('[App] 权重变化:', payload);
  
  weightEnabled.value = payload.enabled;
  showWeightValue.value = payload.showValue;
  
  // 如果需要加载栅
  if (payload.needLoad && payload.enabled) {
    const tagCloud = await ensureTagCloudReady();
    if (!tagCloud) {
      ElNotification.error({ title: '错误', message: '标签云组件未就绪', offset: 80 });
      return;
    }
    
    ElNotification.info({ title: '加载中', message: '正在加载人口密度栅格数据...', offset: 80 });
    
    try {
      const success = await tagCloud.loadRaster();
      if (success) {
        ElNotification.success({ title: '成功', message: '人口密度栅格加载成功！权重渲染已启用', offset: 80 });
      } else {
        ElNotification.error({ title: '错误', message: '栅格加载失败，请检查文件路径', offset: 80 });
        weightEnabled.value = false;
      }
    } catch (error) {
      console.error('[App] 鏍呮牸鍔犺浇澶辫触:', error);
      ElNotification.error({ title: '错误', message: '栅格加载失败', offset: 80 });
      weightEnabled.value = false;
    }
  }
}



const handleSearch = async (keyword) => {
  if (!keyword || !keyword.trim()) {
    // 恢复显示所有选中
    tagData.value = selectedFeatures.value;
    if (mapComponent.value) {
      mapComponent.value.showHighlights(selectedFeatures.value, { full: true });
    }
    // 通知子组件无搜索结果
    if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
    return;
  }
  
  // 显示 loading 提示
  ElNotification.info({ title: '搜索中', message: '正在搜索，请稍候...', offset: 80 });
  
  try {
    const constraints = resolveSpatialConstraints();
    const singleConstraint = constraints.length === 1 ? constraints[0] : null;
    const selectedCategoryLeaves = getSelectedCategoryLeaves(selectedCategoryPath.value);

    const boundary = singleConstraint?.kind === 'polygon'
      ? singleConstraint.points
      : (Array.isArray(selectedPolygon.value) ? selectedPolygon.value : null);
    const circleCenter = singleConstraint?.kind === 'circle'
      ? singleConstraint.center
      : circleCenterGeo.value;
    const circleRadius = singleConstraint?.kind === 'circle'
      ? singleConstraint.radius
      : circleRadiusMeters.value;

    // 构建空间上下
    // 优先使用绘制/上传的多边形选区，其次是当前地图视野
    const spatialContext = {
      viewport: mapBounds.value,
      boundary,
      mode: singleConstraint?.kind === 'circle'
        ? 'Circle'
        : (boundary ? 'Polygon' : 'Viewport'),
      center: circleCenter,
      radius: circleRadius,
      regions: constraints.map((constraint) => ({
        kind: constraint.kind,
        wkt: constraintToGeometryWKT(constraint, true) || constraint.wkt || null
      }))
    };
    
    // 调用智能语义搜索（自动判断走快速路径还RAG
    const semanticSearch = await getSemanticSearch();
    const result = await semanticSearch(keyword.trim(), [], { 
      spatialContext,
      colorIndex: 0 
    });
    
    // 如果需要AI 助手处理（复杂查询）
    if (result.needsAiAssistant) {
      ElNotification.info({ title: 'AI 助手', message: '检测到复杂查询，正在启动AI 助手...', offset: 80 });
      
      // 1. 灞曞紑 AI 闈㈡澘
      if (!aiExpanded.value) {
        toggleAiPanel(true);
      }
      
      // 2. 首次打开时先确保异步组件真正挂载完成
      const aiChat = await ensureAiChatReady();
      if (aiChat?.autoSendMessage) {
        await aiChat.autoSendMessage(keyword.trim());
      }
      
      // 3. 通知子组件正在处理中
      if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
      return;
    }
    
    // 简单查询成功：直接渲染结果
    const filtered = filterFeaturesClientSide(result.pois || [], selectedCategoryLeaves);
    
    tagData.value = filtered;
    if (mapComponent.value) {
      mapComponent.value.showHighlights(filtered, { fitView: true });
    }
    
    if (filtered.length > 0) {
      const expandInfo = result.expandedTerms?.length > 1
        ? ` (同义词扩展: ${result.expandedTerms.slice(0, 3).join(', ')}...)`
        : '';
      ElNotification.success({ title: '搜索完成', message: `搜索完成，找到 ${filtered.length} 条相关信息！${expandInfo}`, offset: 80 });
      // 通知子组件有搜索结果
      if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(true);
    } else {
      ElNotification.warning({ title: '未找到结果', message: `未找到与“${keyword}”相关的 POI`, offset: 80 });
      if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
    }
  } catch (error) {
    console.error('[App] 搜索失败:', error);
    ElNotification.error({ title: '错误', message: '搜索失败，请稍后重试', offset: 80 });
    if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
  }
};

const handleClearSearch = () => {
  // 恢复显示所有选中
  tagData.value = selectedFeatures.value;
  // 通知子组件清除搜索结果
  if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
  if (mapComponent.value) {
    mapComponent.value.showHighlights(selectedFeatures.value, { fitView: true });
  }
  ElNotification.info({ title: '提示', message: '已清除查询结果', offset: 80 });
};

/**
 * 处理 AI 标签云的"渲染至地图事件
 * @param {Array} pois - 从标签云传来的POI 数组
 */
function handleRenderPoisToMap(payload) {
  const { features, anchorFeature } = normalizeAiMapRenderPayload(payload, {
    fallbackCoordSys: poiCoordSys
  });

  if (!features.length && !anchorFeature) {
    ElNotification.warning({ title: '提示', message: '没有可渲染的 POI 数据', offset: 80 });
    return;
  }

  console.log('[App] AI 标签云渲染 POI 到地图', features.length, anchorFeature ? '(含检索锚点)' : '');

  const mapFeatures = anchorFeature ? [...features, anchorFeature] : features;

  if (mapComponent.value) {
    mapComponent.value.showHighlights(mapFeatures, { fitView: true });
  }

  scheduleTagDataSync(features, { defer: aiExpanded.value });

  if (controlPanelRefMap.value?.setSearchResult) {
    controlPanelRefMap.value.setSearchResult(true);
  }

  ElNotification.success({
    title: '渲染成功',
    message: anchorFeature
      ? `已将 ${features.length} 个 POI 渲染到地图，并带上检索锚点`
      : `已将 ${features.length} 个 POI 渲染到地图`,
    offset: 80
  });
}

const AI_CHAT_RESULT_SOURCES = new Set(['ai_tagcloud', 'ai_anchor', 'evidence_locate']);

function createEmptyAiEvidence() {
  return {
    boundary: null,
    spatialClusters: null,
    vernacularRegions: null,
    fuzzyRegions: null,
    stats: null
  };
}

function isAiChatFeature(feature) {
  return AI_CHAT_RESULT_SOURCES.has(String(feature?.properties?._source || '').trim());
}

const latestAiEvidence = ref(createEmptyAiEvidence());

function renderAiEvidenceToMap({ clear = false } = {}) {
  const mapApi = mapComponent.value;
  if (!mapApi?.showAiSpatialEvidence) return;

  const rawPayload = {
    boundary: latestAiEvidence.value.boundary,
    spatial_clusters: latestAiEvidence.value.spatialClusters,
    vernacular_regions: latestAiEvidence.value.vernacularRegions,
    fuzzy_regions: latestAiEvidence.value.fuzzyRegions,
    stats: latestAiEvidence.value.stats
  };
  const normalized = normalizeAiEvidencePayload(rawPayload);
  const payload = {
    boundary: normalized.boundary,
    spatial_clusters: normalized.clusters,
    vernacular_regions: normalized.vernacularRegions,
    fuzzy_regions: normalized.fuzzyRegions,
    stats: normalized.stats
  };

  const hotspotCount = Array.isArray(payload.spatial_clusters?.hotspots)
    ? payload.spatial_clusters.hotspots.length
    : 0;
  const vernacularCount = Array.isArray(payload.vernacular_regions)
    ? payload.vernacular_regions.length
    : 0;
  const fuzzyCount = Array.isArray(payload.fuzzy_regions)
    ? payload.fuzzy_regions.length
    : 0;

  const hasEvidence =
    !!payload.boundary ||
    hotspotCount > 0 ||
    vernacularCount > 0 ||
    fuzzyCount > 0;

  if (!hasEvidence) {
    if (clear && mapApi.clearAiEvidenceBoundaries) {
      mapApi.clearAiEvidenceBoundaries();
    }
    return;
  }

  try {
    mapApi.showAiSpatialEvidence(payload, { clear });
  } catch (error) {
    console.error('[MainLayout] 渲染空间证据失败:', error);
  }
}

function collectBoundaryPoints(boundary, points = [], depth = 0) {
  if (!boundary || depth > 10) return points;

  if (Array.isArray(boundary)) {
    if (boundary.length >= 2 && Number.isFinite(Number(boundary[0])) && Number.isFinite(Number(boundary[1]))) {
      points.push([Number(boundary[0]), Number(boundary[1])]);
      return points;
    }
    boundary.forEach((item) => collectBoundaryPoints(item, points, depth + 1));
    return points;
  }

  if (typeof boundary !== 'object') return points;

  const lon = Number(boundary.lon ?? boundary.lng ?? boundary.longitude);
  const lat = Number(boundary.lat ?? boundary.latitude);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    points.push([lon, lat]);
    return points;
  }

  if (boundary.geometry) {
    collectBoundaryPoints(boundary.geometry, points, depth + 1);
  }
  if (boundary.coordinates) {
    collectBoundaryPoints(boundary.coordinates, points, depth + 1);
  }
  if (boundary.boundary) {
    collectBoundaryPoints(boundary.boundary, points, depth + 1);
  }
  if (boundary.boundary_geojson) {
    collectBoundaryPoints(boundary.boundary_geojson, points, depth + 1);
  }
  if (boundary.boundary_ring) {
    collectBoundaryPoints(boundary.boundary_ring, points, depth + 1);
  }
  if (boundary.rings) {
    collectBoundaryPoints(boundary.rings, points, depth + 1);
  }
  if (Array.isArray(boundary.features)) {
    boundary.features.forEach((feature) => collectBoundaryPoints(feature, points, depth + 1));
  }
  if (boundary.layers && typeof boundary.layers === 'object') {
    Object.values(boundary.layers).forEach((layer) => collectBoundaryPoints(layer, points, depth + 1));
  }

  return points;
}

function deriveBoundaryCenter(boundary) {
  const points = collectBoundaryPoints(boundary, []);
  if (!points.length) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  points.forEach(([lon, lat]) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
  return {
    lon: (minLon + maxLon) / 2,
    lat: (minLat + maxLat) / 2
  };
}

function handleAiBoundary(boundary) {
  const payload =
    boundary && typeof boundary === 'object' && !Array.isArray(boundary)
      ? boundary
      : { boundary };

  const normalizedBoundary = Object.prototype.hasOwnProperty.call(payload, 'boundary')
    ? payload.boundary
    : boundary;

  const source = String(payload?.source || '').toLowerCase();

  if (source === 'ui') {
    if (normalizedBoundary && mapComponent.value?.showAnalysisBoundary) {
      mapComponent.value.showAnalysisBoundary(normalizedBoundary, {
        fitView: false,
        clear: false,
        clearLocate: false,
        label: payload?.label || '片区边界'
      });
    }
    const targetCenter = payload?.center || deriveBoundaryCenter(normalizedBoundary);
    if (targetCenter && mapComponent.value?.flyTo) {
      mapComponent.value.flyTo(targetCenter, {
        showMarker: false,
        firstLocateZoom: false
      });
    }
  } else {
    latestAiEvidence.value.boundary = normalizedBoundary;
    renderAiEvidenceToMap({ clear: true });
  }

  console.log('[App] AI boundary updated:', normalizedBoundary ? 'yes' : 'no');
}

function handleAiSpatialClusters(clusters) {
  latestAiEvidence.value.spatialClusters = clusters;
  renderAiEvidenceToMap({ clear: true });
  console.log('[App] AI spatial clusters updated:', clusters?.hotspots?.length || 0);
}

function handleAiVernacularRegions(regions) {
  latestAiEvidence.value.vernacularRegions = regions;
  renderAiEvidenceToMap({ clear: true });
  console.log('[App] AI vernacular regions updated:', regions?.length || 0);
}

function handleAiFuzzyRegions(fuzzyRegions) {
  latestAiEvidence.value.fuzzyRegions = fuzzyRegions;
  renderAiEvidenceToMap({ clear: true });
  console.log('[App] AI fuzzy regions updated:', fuzzyRegions?.length || 0);
}

function handleAiAnalysisStats(stats) {
  latestAiEvidence.value.stats = stats || null;
  renderAiEvidenceToMap({ clear: false });
}

function handleClearAiChatState() {
  tagData.value = Array.isArray(tagData.value)
    ? tagData.value.filter((feature) => !isAiChatFeature(feature))
    : [];
  latestAiEvidence.value = createEmptyAiEvidence();

  mapComponent.value?.clearHighlights?.();
  mapComponent.value?.clearAiEvidenceBoundaries?.();

  controlPanelRefTag.value?.setSearchResult?.(false);
  controlPanelRefMobile.value?.setSearchResult?.(false);
  controlPanelRefMap.value?.setSearchResult?.(false);

  console.log('[App] Cleared AI chat visual state');
}

/**
 * 保存筛选结果为 CSV 文件
 * 优先级逻辑
 * 1. 如果有搜筛选后tagData（标签云数据），保存 tagData
 * 2. 如果没有 tagData 但有 selectedFeatures（绘制工具选中的点），保存 selectedFeatures
 * 3. 如果都没有，则没有可保存的数据
 */
function handleSaveResult() {
  let features = [];
  let dataSource = '';
  
  console.log('[App] 保存检查- tagData:', tagData.value?.length, 
              'selectedFeatures:', selectedFeatures.value?.length,
              'filteredTagData:', filteredTagData.value?.length);

  // 优先级1: 如果开启了视野过滤且有数据
  if (filterEnabled.value && filteredTagData.value && filteredTagData.value.length > 0) {
    features = filteredTagData.value;
    dataSource = '视野内筛选';
  }
  // 优先级2: 标签云搜索结果数据
  else if (tagData.value && tagData.value.length > 0) {
    features = tagData.value;
    dataSource = '标签云数据';
  }
  // 优先级3: 绘制工具选中的点（地图上高亮显示的点击
  else if (selectedFeatures.value && selectedFeatures.value.length > 0) {
    features = selectedFeatures.value;
    dataSource = '绘制选中区域';
  }
  // 优先级4: 所有加载的数据
  else if (allPoiFeatures.value && allPoiFeatures.value.length > 0) {
    features = allPoiFeatures.value;
    dataSource = '全部加载数据';
  }
  
  if (!features || features.length === 0) {
    ElNotification.warning({ title: '提示', message: '没有可保存的筛选结果', offset: 80 });
    return;
  }
  
  // 构建 CSV 内容
  const headers = ['名称', '大类', '中类', '小类', '经度', '纬度'];
  let csvContent = headers.join(',') + '\n';
  
  features.forEach(f => {
    const props = f.properties || {};
    const coords = f.geometry?.coordinates || ['', ''];
    const name = (props['名称'] || props.name || '').replace(/,/g, '，').replace(/"/g, '""');
    const bigCategory = (props['大类'] || props.category || '').replace(/,/g, '，');
    const midCategory = (props['中类'] || props.subcategory || '').replace(/,/g, '，');
    const smallCategory = (props['小类'] || '').replace(/,/g, '，');
    csvContent += `"${name}","${bigCategory}","${midCategory}","${smallCategory}",${coords[0]},${coords[1]}\n`;
  });
  
  // 创建并下载文件
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `POI_${dataSource}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  ElNotification.success({ title: '保存成功', message: `已保存${features.length} 个 POI 数据 (${dataSource})`, offset: 80 });
}

/**
 * 处理开启关闭绘制模式
 * @param {Object|boolean} payload - 包含模式信息的对象或布尔旧版)
 */
const handleToggleDraw = (payload) => {
  if (!mapComponent.value) return;
  
  // 支持布尔值（旧版兼容）和对象负载
  const enabled = (typeof payload === 'object') ? payload.active : payload;
  const mode = (typeof payload === 'object') ? payload.mode : 'Polygon';

  if (enabled) {
    console.log(`[App] 开启绘制模式 ${mode}`);
    mapComponent.value.openPolygonDraw(mode);
  } else {
    console.log('[App] 关闭绘制模式');
    mapComponent.value.closePolygonDraw();
  }
};

/**
 * 处理实时过滤开关切
 * @param {boolean} enabled - 是否开启
 */
const handleToggleFilter = (enabled) => {
  filterEnabled.value = enabled;
  console.log('[App] 实时状态:', enabled ? '' : '乇');
  if (!enabled) {
    // 关闭时重置或保持当前状态
  } else {
    // 开启时可能需要立即触发一次更
    if (mapComponent.value) {
       // mapComponent.value.emitBounds(); // 如果需要立即更新边界
    }
  }
};

/**
 * 处理全域感知模式切换
 * @param {boolean} enabled 
 */
const handleGlobalAnalysisChange = (enabled) => {
  globalAnalysisEnabled.value = enabled;
  console.log('[App] 全域感知模式:', enabled ? '开启' : '关闭');
};

/**
 * 处理地图移动结束
 * 使用节流函数限制频率，更新地图边界用于实时过滤
 */

const handleMapMoveEnd = throttle((bounds) => {
  mapBounds.value = bounds;

  if (mapComponent.value?.map) {
    const view = mapComponent.value.map.getView();
    if (view) mapZoom.value = view.getZoom();
  }

  const hasCategoryFilter = getSelectedCategoryLeaves(selectedCategoryPath.value).length > 0;

  if (!hasManualSpatialSelection() && hasCategoryFilter) {
    void refreshManualSelectionSource({
      updateTagCloud: false,
      fitView: false,
      keepMapHighlight: false,
      silent: true,
      limit: MAX_MANUAL_FETCH_LIMIT
    });
  }
}, 500);

/**
 * 处理要素悬停
 * 实现 MapContainer 和 TagCloud 之间的联动高亮
 * @param {Object|string} id - 悬停的要素或其 ID
 */
const handleFeatureHover = (id) => {
  hoveredFeatureId.value = id;
};

/**
 * 处理要素点击
 * 当在地图上点击要素时，对应标签橙色常亮（无定位动画）
 * @param {Object} feature - 被点击的要素对象
 */
const handleFeatureClick = (feature) => {
  console.log('[App] 处理要素点击:', feature);
  // 设置点击状态（常亮），不受悬浮状态影响
  clickedFeatureId.value = feature;
};

/**
 * 处理要素定位请求
 * 当在 TagCloud 点击标签时，只有地图飞向个 POI
 * @param {Object} feature - 鐩爣瑕佺礌瀵硅薄
 */
const handleFeatureLocate = (feature) => {
  console.log('[App] 定位到地图要素:', feature);
  
  // 1. 更新高亮状态（橙色高亮
  hoveredFeatureId.value = feature;
  
  // 2. 地图飞向个 POI（TagCloud 不动
  if (mapComponent.value) {
    mapComponent.value.flyTo(feature);
  }
};

/**
 * 处理多边界圆形绘制完成
 * 接收地图组件筛选出个 POI 数据
 * 注意：绘制完成后仅保存选中数据，不自动渲染标签云
 * 用户需要点击渲染标签云按钮才会渲染
 * @param {Object} payload - { polygon, center, selected, type, circleCenter, polygonCenter }
 */

const handlePolygonCompleted = async (payload) => {
  const inside = Array.isArray(payload?.selected) ? payload.selected : [];
  selectedFeatures.value = inside;

  polygonCenter.value = payload?.center || null;
  selectedPolygon.value = Array.isArray(payload?.polygon) ? payload.polygon : null;

  // 保留绘制模式与中心点，供词云布局与 AI 上下文使用
  selectedDrawMode.value = payload?.type || 'Polygon';
  circleCenterGeo.value = payload?.circleCenter || payload?.polygonCenter || null;
  circleRadiusMeters.value = Number.isFinite(Number(payload?.circleRadius))
    ? Number(payload.circleRadius)
    : null;
  syncLegacySpatialStateFromConstraints();

  console.log(`[App] 绘制完成 (${selectedDrawMode.value})，初${inside.length} 个要素`);

  // 同步控制面板状态，避免继续停留在绘制模式
  if (controlPanelRefTag.value) {
    controlPanelRefTag.value.setDrawEnabled(false);
  }
  if (controlPanelRefMobile.value) {
    controlPanelRefMobile.value.setDrawEnabled(false);
  }

  // 使统一约取 POI证选 + 稹卑效
  const refreshed = await refreshManualSelectionSource({
    updateTagCloud: false,
    fitView: false,
    keepMapHighlight: true,
    silent: true
  });

  const finalCount = refreshed.length;
  if (!finalCount) {
    ElNotification.success({
      title: '区域已锁定',
      message: '已应用选区约束，当前范围内未命中 POI。',
      offset: 80
    });
  } else {
    ElNotification.success({
      title: '选区已生效',
      message: `当前约束命中 ${finalCount} 个 POI，可直接渲染词云或发起 AI 分析。`,
      offset: 80
    });
  }
};

const handleRegionRemoved = async () => {
  // 删一选悴⒃贾低嘉辉?AI 一隆
  polygonCenter.value = null;
  syncLegacySpatialStateFromConstraints();

  await refreshManualSelectionSource({
    updateTagCloud: false,
    fitView: false,
    keepMapHighlight: true,
    silent: true
  });
};

const handleRegionsCleared = async () => {
  // 选说默喜裕野 + 约戮傻谋呓状态
  polygonCenter.value = null;
  syncLegacySpatialStateFromConstraints();

  await refreshManualSelectionSource({
    updateTagCloud: false,
    fitView: false,
    keepMapHighlight: true,
    silent: true
  });
};

/**
 * 处理地图初始化完
 * 获取 OpenLayers 地图实例引用
 */
const handleMapReady = (mapInstance) => {
  console.log('[App] 地图初始化完', mapInstance);
  map.value = mapInstance;
};

/**
 * 调试显示：渲染当前分组的所有POI 为高
 */
function handleDebugShow(groupName) {
  if (!allPoiFeatures.value.length) {
    ElNotification.warning({ title: '提示', message: '请先加载地理语义分组数据', offset: 80 });
    return;
  }
  console.log('[App] 调试显示所有要素');
  mapComponent.value.showHighlights(allPoiFeatures.value, { full: true });
  selectedFeatures.value = allPoiFeatures.value;
}

/**
 * 处理上传的矢量面文件
 * 将上传的 GeoJSON 多边形渲染到地图上，并筛选POI
 */
// 处理上传的矢量面文件
function handleVectorPolygonUploaded(feature) {
  console.log('[App] 收到上传的矢量面要素:', feature);
  
  if (!feature || !feature.geometry) {
    ElNotification.error({ title: '错误', message: '无效的面要素', offset: 80 });
    return;
  }
  
  // 获取多边形坐标
  const geomType = feature.geometry.type;
  let coordinates;
  
  if (geomType === 'Polygon') {
    coordinates = feature.geometry.coordinates[0]; // 取外环
  } else if (geomType === 'MultiPolygon') {
    coordinates = feature.geometry.coordinates[0][0]; // 取第一个多边形的外环
  } else {
    ElNotification.error({ title: '错误', message: '不支持的几何类型: ' + geomType, offset: 80 });
    return;
  }
  
  // 调用 MapContainer 来渲染多边形并触发筛选
  // 注意：MapContainer 内部现在会自动触发onPolygonComplete，从而发polygon-completed 事件
  // 锊灰渡秆?
  if (mapComponent.value && mapComponent.value.addUploadedPolygon) {
    mapComponent.value.addUploadedPolygon(coordinates);
    // 移除重复提示
    // ElNotification.success({ title: '成功', message: '已应用选区，正在筛选..', offset: 80 });
  } else {
    ElNotification.warning({ title: '提示', message: '地图组件未就绪', offset: 80 });
  }
}

/**
 * 处理 AI 请求渲染到标签云
 * @param {Array} data - POI 名称数组 为 GeoJSON Feature 数组
 */
function handleRenderAIResult(data) {
  if (!data || data.length === 0) return;
  
  let featuresToRender = [];

  // 情况1: 传递的Feature 数组 (后端搜索结果)
  if (typeof data[0] === 'object' && data[0].type === 'Feature') {
    featuresToRender = data;
    console.log('[App] 渲染外部 POI 数据:', featuresToRender.length);
  } 
  // 2: 莸 (呒)
  else if (typeof data[0] === 'string') {
    const nameSet = new Set(data);
    featuresToRender = allPoiFeatures.value.filter(p => 
      p.properties && (nameSet.has(p.properties['名称']) || nameSet.has(p.properties.name))
    );
    
    if (featuresToRender.length === 0) {
      ElNotification.warning({ title: '提示', message: '未在当前数据中找到匹配的 POI', offset: 80 });
      return;
    }
  }

  // 更新选中数据
  selectedFeatures.value = featuresToRender;
  // 关键修复：同时更tagData，确保标签云组件能够渲染这些数据
  tagData.value = featuresToRender;
  
  // 对于搜索结果，强制设置为组颜色（紫色），以区分常规数据
  featuresToRender.forEach(f => {
    if (f.properties) f.properties._groupIndex = 4;
  });

  // 联动地图高亮
  if (mapComponent.value) {
    // 獠枯Ｒ低枷?
    mapComponent.value.showHighlights(featuresToRender, { 
      fitView: true,
      clearPrevious: true 
    });
  }
  
  ElNotification.success({ title: '渲染完成', message: `已将 ${featuresToRender.length} 个结果渲染到标签云`, offset: 80 });
}



/**
 * 初始化：清空所有数据
 * 重置所有状态到初始
 */

function handleReset() {
  // 取诮械筛选螅煤山写
  manualFilterRequestToken++;

  // 清空词云AI 分析数据源
  tagData.value = [];
  selectedFeatures.value = [];
  polygonCenter.value = null;
  selectedPolygon.value = null;
  hoveredFeatureId.value = null;
  clickedFeatureId.value = null;

  // 重置绘制状态
  selectedDrawMode.value = '';
  circleCenterGeo.value = null;
  circleRadiusMeters.value = null;

  // 清空分类约束与已加载分组，并同步三个控制面板
  selectedCategoryPath.value = [];
  activeGroups.value = [];
  allPoiFeatures.value = [];
  syncCategorySelectors([]);

  // 清空地图上的选区和高亮
  if (mapComponent.value) {
    mapComponent.value.clearAllRegionsFromMap?.();
    mapComponent.value.clearPolygon();
    mapComponent.value.closePolygonDraw();
  }

  // 每灏磁ヌ?
  if (controlPanelRefTag.value) {
    controlPanelRefTag.value.setDrawEnabled(false);
    controlPanelRefTag.value.setSearchResult(false);
  }
  if (controlPanelRefMobile.value) {
    controlPanelRefMobile.value.setDrawEnabled(false);
    controlPanelRefMobile.value.setSearchResult(false);
  }
  if (controlPanelRefMap.value) {
    controlPanelRefMap.value.setSearchResult(false);
  }

  console.log('[App] 已完成初始化重置并同步分类状态');
  ElNotification.success({ title: '重置完成', message: '已清空选区、类别与结果数据。', offset: 80 });
}

</script>

<style>
/* ElMessage 定位到右上角 header 下方 */


html, body, #app {
  height: 100vh;
  width: 100vw;
  margin: 0;
  overflow: hidden;
  background-color: #020617;
  color: #f1f5f9;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  scrollbar-width: thin;
  scrollbar-color: rgba(99, 102, 241, 0.3) transparent;
}

/* 地图加载占位符 */
.map-loading-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  background: rgba(2, 6, 23, 0.9);
  color: #94a3b8;
  font-size: 14px;
  gap: 12px;
}

.map-loading-placeholder .loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(99, 102, 241, 0.2);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 全量统一的 Mesh 渐变背景，增强整体感 */
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%; /* Strict height */
  width: 100%;
  overflow: hidden;
  background: 
    radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 0%, rgba(168, 85, 247, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 100%, rgba(30, 64, 175, 0.2) 0px, transparent 50%),
    radial-gradient(at 0% 100%, rgba(17, 24, 39, 1) 0px, transparent 50%);
  background-attachment: fixed;
}

/* .top-controls 已移除*/

.fixed-top-header {
  flex: 0 0 68px;
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 40px;
  background: rgba(10, 15, 26, 0.8);
  backdrop-filter: blur(20px) saturate(160%);
  z-index: 2000;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08); 
  position: relative;
  box-sizing: border-box;
}

.fixed-top-header::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(168, 85, 247, 0.4), transparent);
}

.header-logo {
  position: absolute; /* 潭啵?flex 苑氐 */
  left: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 2001;
}

/* --- 全新绝对定位布局系统 --- */

/* 锚点1：数据发现组 */
/* 呒Right 氲?50% (幕)荽 */
.layout-anchor-center-left {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 50%; /* 右边缘贴紧屏幕中*/
  display: flex;
  align-items: center;
  padding-right: 24px; /* 距离中线分隔符的间距 */
  
  /* 丶龋止撞 Logo (240px + some buffer) */
  max-width: calc(50vw - 260px); 
  white-space: nowrap; /* 防止内容换行 */
}

/* 锚点2：空间指挥组 */
/* 呒Right 氲?0 (幕缘)荽 */
.layout-anchor-screen-right {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0; /* 右边缘贴紧屏*/
  display: flex;
  align-items: center;
  padding-right: 40px; /* 距离屏幕边缘的安全间距 */
  white-space: nowrap;
}

/* 中线分隔（已移除） */

/* Logo 区域 */
.header-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.logo-icon {
  width: 42px;
  height: 42px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15));
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 15px rgba(99, 102, 241, 0.25);
  border: 1px solid rgba(129, 140, 248, 0.2);
}

.logo-type {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.logo-text {
  font-size: 19px;
  font-weight: 900;
  letter-spacing: -0.8px;
  color: #f8fafc;
  line-height: 1.1;
  text-transform: uppercase;
}

.logo-accent {
  background: linear-gradient(to right, #818cf8, #c084fc);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-left: 2px;
}

.logo-main-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.logo-subtitle {
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(to right, #a5b4fc, #c4b5fd, #ddd6fe);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: 2px;
  white-space: nowrap;
  position: relative;
  padding-left: 10px;
}

/* 中文副标题前的分隔线 */
.logo-subtitle::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 14px;
  background: linear-gradient(to bottom, transparent, rgba(165, 180, 252, 0.6), transparent);
}

.version-badge {
  font-size: 13px; /* 字体加大 */
  margin-top: 4px;
  color: #818cf8;
  font-weight: 700;
  letter-spacing: 0.6px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.beta-tag {
  color: #fbbf24;
}

/* 控制区整体框*/
/* 已重构为 section-discovery 与 section-command */

.control-group {
  display: flex;
  align-items: center;
  /* 移除所有垫子背景与边距，让控件自然流动 */
}

.header-divider {
  width: 2px;
  height: 40px;
  background: linear-gradient(to bottom, transparent, rgba(99, 102, 241, 0.3), transparent);
  margin: 0 8px;
  flex-shrink: 0;
}

.mobile-header {
  flex: 0 0 auto;
  width: 100%;
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(12px);
  z-index: 2000;
  border-bottom: 1px solid rgba(99, 102, 241, 0.4);
  min-height: 50px;
}

.desktop-only-flex {
  display: flex;
}

.mobile-only-block {
  display: none;
}

@media (max-width: 768px) {
  .desktop-only-flex {
    display: none !important;
  }
  .mobile-only-block {
    display: block !important;
  }
  
  .fixed-top-header {
    display: none;
  }
}

.bottom-split {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

/* 左侧区域（包含地图和标签云） */
.left-section {
  display: flex;
  flex-direction: row; /* 默认模式：左右分*/
  height: 100%;
  overflow: hidden;
  flex: 1;
  background: transparent;
}

/* 三列模式：地图| 标签云| AI面板 */
.left-section.three-column {
  flex-direction: row; 
  flex: none; /* 由 style 绑定的百分比控制宽度 */
}

.left-section {
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1), 
              flex 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 地图面板 - 增强一体化 */
.map-panel {
  overflow: hidden;
  background: transparent;
  display: flex;
  flex-direction: column;
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1), 
              flex 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 标签云面板- 增强一体化 */
.tag-panel {
  overflow: hidden;
  background: rgba(15, 23, 42, 0.6); /* 半透明背景，透出全局 mesh */
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1), 
              flex 0.6s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 右侧AI面板 */
.right-panel { 
  height: 100%; 
  overflow: hidden; 
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  background: linear-gradient(180deg, #0a0f1a 0%, #111827 100%);
}

.ai-panel {
  border-left: 1px solid rgba(99, 102, 241, 0.3);
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1), 
              flex 0.6s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.bottom-split.is-dragging .left-section,
.bottom-split.is-dragging .map-panel,
.bottom-split.is-dragging .tag-panel,
.bottom-split.is-dragging .ai-panel {
  transition: none !important;
}

.panel-hidden {
  width: 0 !important;
  opacity: 0;
  pointer-events: none;
  border-left: none !important;
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  min-height: 0;
}

/* 鍨傜洿鍒嗛殧鏉?*/
.splitter {
  width: 10px;
  background: linear-gradient(180deg, #2c3e50 0%, #1a252f 100%);
  cursor: col-resize;
  z-index: 10;
  transition: all 0.2s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}
.splitter:hover, .splitter:active {
  background: linear-gradient(180deg, #3498db 0%, #2980b9 100%);
  color: #fff;
}

/* 统一分隔条样式 */
/* 现代感分隔条 */
.splitter-inner {
  width: 14px;
  min-width: 14px;
  height: 100%;
  background: transparent;
  cursor: col-resize;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.splitter-line {
  width: 2px;
  height: 100%;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 1px;
  transition: all 0.3s ease;
  position: relative;
}

.splitter-inner:hover .splitter-line,
.splitter-inner:active .splitter-line {
  width: 4px;
  background: linear-gradient(to bottom, #6366f1, #a855f7);
  box-shadow: 0 0 15px rgba(99, 102, 241, 0.6);
}

/* AI面板固定边框 */
.ai-border-line {
  width: 1px;
  height: 100%;
  background: rgba(99, 102, 241, 0.2);
  flex-shrink: 0;
}

.ai-panel {
  border-left: none !important; /* 鎴戜滑浣跨敤 ai-border-line */
}

/* 隐藏旧类型*/
.splitter, .splitter-ai, .splitter-horizontal {
  display: none !important;
}


/* AI 娴姩鎸夐挳 */

.ai-fab {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 50px;
  color: white;
  cursor: pointer;
  z-index: 1000;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5);
  transition: all 0.4s ease;
  animation: fabPulse 2s infinite;
}

.ai-fab:hover {
  transform: translateX(-50%) scale(1.05);
  box-shadow: 0 6px 30px rgba(99, 102, 241, 0.7);
}

@keyframes fabPulse {
  0%, 100% { box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5); }
  50% { box-shadow: 0 4px 30px rgba(139, 92, 246, 0.7); }
}

.ai-fab-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-fab-text {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}



.ai-fab-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: #ef4444;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #0a0f1a;
}

/* 移动端增强布局 - 高德地图风格 */
@media (max-width: 768px) {
  .app-layout {
    background: #000;
  }

  .mobile-header {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    width: auto;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(25px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    z-index: 1000;
  }

  .bottom-split {
    flex-direction: column;
    height: 100%; /* Changed from 100vh to 100% to fill available parent space */
    width: 100%;
    position: relative;
    overflow: hidden;
  }
  
  /* 移动端地图全屏*/
  .left-section {
    width: 100% !important;
    height: 100% !important;
    flex-direction: column !important;
  }
  
  .map-panel {
    width: 100% !important;
    height: 100% !important;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
  }
  
  /* 贫吮签疲呒UI 时 */
  .tag-panel.mobile-hidden {
    display: none !important;
  }

  /* 绉诲姩绔?AI 闈㈡澘閬僵 */
  .mobile-ai-mask {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    z-index: 1500;
  }
  
  /* 移动端展开AI时：使用抽屉式全屏覆盖，平齐 Head 栏*/
  .bottom-split.ai-expanded .right-panel {
    position: absolute;
    top: 68px; /* 进一步向上调整以对齐 header */
    left: 12px;
    right: 12px;
    width: auto !important;
    height: calc(100vh - 80px) !important;
    z-index: 2000;
    background: #0a0f1a;
    animation: sheetSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
  }
  
  @keyframes sheetSlideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  /* 闅愯棌鍒嗛殧鏉?*/
  .splitter-inner, .splitter-line, .ai-border-line {
    display: none !important;
  }
  
  .ai-fab {
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) scale(0.9);
    transform-origin: center;
    padding: 12px 28px;
    border-radius: 40px;
    width: auto;
    height: auto;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    box-shadow: 0 8px 32px rgba(99, 102, 241, 0.5);
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 1000;
  }

  .ai-fab-text {
    display: block;
    font-size: 16px;
    font-weight: 700;
    color: white;
    white-space: nowrap;
  }
  
  .ai-fab:active {
    transform: translateX(-50%) scale(0.95);
  }
}

</style>

<!-- 全址歉式强聘 Element Plus 默 -->
<style>
/* 终极弹窗美化：科技极简，大道至简 */
body .el-overlay .el-dialog.mirspatial-dialog {
  background: #0b1120 !important; /* 更深邃、稳定的专业*/
  backdrop-filter: blur(24px) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 12px !important;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
  position: relative !important;
  overflow: hidden !important;
  padding: 0 !important;
}

/* 彻底移除霓虹线条 */
body .el-overlay .el-dialog.mirspatial-dialog::before {
  display: none !important;
}

body .el-overlay .el-dialog.mirspatial-dialog .el-dialog__header {
  padding: 16px 20px !important;
  margin: 0 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
  background: rgba(255, 255, 255, 0.01) !important;
}

body .el-overlay .el-dialog.mirspatial-dialog .el-dialog__title {
  color: #f1f5f9 !important;
  font-weight: 600 !important;
  font-size: 16px !important;
}

body .el-overlay .el-dialog.mirspatial-dialog .el-dialog__body {
  padding: 24px !important;
  color: #94a3b8 !important;
}

body .el-overlay .el-dialog.mirspatial-dialog .el-input__wrapper {
  background: #020617 !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
}

body .el-overlay .el-dialog.mirspatial-dialog .el-button--primary {
  background: #6366f1 !important;
  border: none !important;
  font-weight: 500 !important;
  padding: 8px 20px !important;
}

@media (max-width: 768px) {
  body .el-overlay .el-dialog.mirspatial-dialog {
    width: 94% !important;
    max-width: 94vw !important;
    margin: 10vh auto !important;
  }
  
  body .el-overlay .el-dialog.mirspatial-dialog .el-dialog__body {
    padding: 16px !important;
  }
}

@media (min-width: 769px) {
  body .el-overlay .el-dialog.mirspatial-dialog {
    width: 550px !important;
    margin-top: 15vh !important;
  }
}

.panel-hidden {
  display: none !important;
}
</style>



