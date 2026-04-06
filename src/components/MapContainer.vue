<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container"></div>

    <!-- POI 名称气泡 -->
    <div
      ref="poiPopup"
      class="poi-popup"
      :class="{ 'is-bottom': popupPlacement === 'bottom' }"
      :style="popupStyle"
      v-show="popupVisible"
    >
      <div class="popup-content">
        <div class="popup-title">{{ popupName }}</div>
        <div
          v-for="(line, idx) in popupDetailLines"
          :key="'popup-line-' + idx"
          class="popup-detail"
        >
          {{ line }}
        </div>
      </div>
      <div class="popup-arrow"></div>
    </div>

    <!-- 实时过滤与热力图控制 -->
    <div v-if="showControls" class="map-filter-control">
      <div class="control-row">
        <span class="filter-label">实时过滤</span>
        <el-switch
          v-model="filterEnabled"
          @change="toggleFilter"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>
      <div class="control-row">
        <span class="filter-label">热力图</span>
        <el-switch
          v-model="heatmapEnabled"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>

      <!-- 标签权重 -->
      <div class="control-divider"></div>
      <div class="control-row">
        <span class="filter-label">标签权重</span>
        <el-switch
          v-model="weightEnabled"
          @change="handleWeightToggle"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>
      <div class="control-row">
        <span class="filter-label" :class="{ 'disabled': !weightEnabled }">显示权重</span>
        <el-switch
          v-model="showWeightValue"
          :disabled="!weightEnabled"
          @change="handleShowWeightToggle"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>

      <!-- 全域感知（仅展示） -->
      <div class="control-divider"></div>
      <div class="control-row">
        <span class="filter-label">全域感知</span>
        <el-switch
          :model-value="true"
          disabled
          inline-prompt
          active-text="开启"
          inactive-text=""
        />
      </div>
      <div class="control-hint">
        <span>GeoLoom-RAG 全域感知已启用</span>
      </div>
    </div>

    <!-- 边界可信度图例 -->
    <div v-if="aiBoundaryLegend.visible" class="ai-boundary-legend">
      <div class="legend-head">
        <span class="legend-title">边界可信度</span>
        <span class="legend-model">模型：{{ aiBoundaryLegend.model || 'composite_v5' }}</span>
      </div>
      <div class="legend-stats">
        <span>均值 {{ formatLegendPercent(aiBoundaryLegend.avg) }}</span>
        <span>最低 {{ formatLegendPercent(aiBoundaryLegend.min) }}</span>
        <span>最高 {{ formatLegendPercent(aiBoundaryLegend.max) }}</span>
      </div>
      <div
        v-if="aiBoundaryLegend.semanticAnchorCoverage !== null || aiBoundaryLegend.dominantNicheType || aiBoundaryLegend.avgWaterPenalty !== null"
        class="legend-semantic"
      >
        <span v-if="aiBoundaryLegend.anchorModel">语义 {{ aiBoundaryLegend.anchorModel }}</span>
        <span v-if="aiBoundaryLegend.semanticAnchorCoverage !== null">锚点覆盖 {{ formatLegendPercent(aiBoundaryLegend.semanticAnchorCoverage) }}</span>
        <span v-if="aiBoundaryLegend.dominantNicheType">主导生态位 {{ nicheLabel(aiBoundaryLegend.dominantNicheType) }}</span>
        <span v-if="aiBoundaryLegend.avgWaterPenalty !== null">水域惩罚 {{ formatLegendPercent(aiBoundaryLegend.avgWaterPenalty) }}</span>
      </div>
      <div class="legend-scale">
        <div class="legend-item high">
          <span class="legend-swatch"></span>
          <span>高可信 ≥ 70%（{{ aiBoundaryLegend.buckets.high }}）</span>
        </div>
        <div class="legend-item medium">
          <span class="legend-swatch"></span>
          <span>中可信 40%-69%（{{ aiBoundaryLegend.buckets.medium }}）</span>
        </div>
        <div class="legend-item low">
          <span class="legend-swatch"></span>
          <span>低可信 &lt; 40%（{{ aiBoundaryLegend.buckets.low }}）</span>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="weightDialogVisible"
      title="ѡҪȾĵȨ"
      width="360px"
      class="mirspatial-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      center
    >
      <div class="weight-dialog-content">
        <el-select
          v-model="selectedWeightType"
          placeholder="选择权重类型"
          style="width: 100%"
        >
          <el-option
            v-for="item in weightOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="cancelWeightDialog">取消</el-button>
          <el-button type="primary" @click="confirmWeightDialog" :loading="weightLoading">
            确定
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { ElNotification } from 'element-plus';
import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';
import { Vector as VectorLayer } from 'ol/layer';
import { Draw } from 'ol/interaction';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, RegularShape, Text as TextStyle } from 'ol/style';


import { useRegions, REGION_COLORS, MAX_REGIONS } from '../composables/useRegions';
import { nicheLabel } from '../utils/aiBoundaryMeta';
import { useProjection } from '../composables/map/useProjection';
import { usePopupAnchor } from '../composables/map/usePopupAnchor';
import { useDeckBridge } from '../composables/map/useDeckBridge';
import { useEvidenceLayer } from '../composables/map/useEvidenceLayer';

/**
 *
 * polygon-completed: 选区绘制完成并筛选 POI 后触发
 * map-ready: 地图初始化完成时触发
 * hover-feature: 鼠标悬停 POI 时触发
 * click-feature: 鼠标点击 POI 时触发
 * map-move-end: 地图移动结束时触发
 * toggle-filter: 切换实时过滤时触发
 * toggle-overlay: 切换叠加模式时触发
 * weight-change: 权重配置变化时触发
 * region-added: 新增选区时触发
 * region-removed: 删除选区时触发
 * regions-cleared: 清空所有选区时触发
 */
const emit = defineEmits([
  'polygon-completed', 'map-ready', 'hover-feature', 'click-feature', 
  'map-move-end', 'toggle-filter', 'toggle-overlay', 'weight-change', 
  'global-analysis-change', 'region-added', 'region-removed', 'regions-cleared'
]);

/**
 *
 * poiFeatures: POI 数据数组（GeoJSON Feature 格式）
 * hoveredFeatureId: 当前悬停要素（来自 TagCloud 组件）
 */
const props = defineProps({
  poiFeatures: { type: Array, default: () => [] },
  hoveredFeatureId: { type: Object, default: null }, // 注释说明

  filterEnabled: { type: Boolean, default: false },
  heatmapEnabled: { type: Boolean, default: false },
  overlayEnabled: { type: Boolean, default: false },
  weightEnabled: { type: Boolean, default: false },
  showWeightValue: { type: Boolean, default: false },
  globalAnalysisEnabled: { type: Boolean, default: true },
  showControls: { type: Boolean, default: true },
});

// DOM 相关说明
const mapContainer = ref(null);
// OpenLayers 相关说明
const map = ref(null);

let drawInteraction = null;
// 注释说明
let hoveredFeature = null; 

const filterEnabled = ref(props.filterEnabled);

const heatmapEnabled = ref(props.heatmapEnabled);


// ============ ============
const weightEnabled = ref(props.weightEnabled);
const showWeightValue = ref(props.showWeightValue);
const weightDialogVisible = ref(false);
const selectedWeightType = ref('population');
const weightLoading = ref(false);

// props 同步说明
watch(() => props.filterEnabled, (val) => { filterEnabled.value = val; });
watch(() => props.heatmapEnabled, (val) => { heatmapEnabled.value = val; });

watch(() => props.weightEnabled, (val) => { weightEnabled.value = val; });
watch(() => props.showWeightValue, (val) => { showWeightValue.value = val; });

// POI 相关说明
const poiPopup = ref(null); // DOM 相关说明


const weightOptions = ref([
  { value: 'population', label: '人口密度' },
]);

const MAP_MIN_ZOOM = 4;
const MAP_MAX_ZOOM = 18;
const VECTOR_LAYER_RUNTIME_OPTIONS = {
  updateWhileAnimating: true,
  updateWhileInteracting: true,
  renderBuffer: 192
};
const { toGcj02IfNeeded } = useProjection();

// ============  ============
const { 
  regions, 
  activeRegionId, 
  canAddRegion, 
  addRegion, 
  removeRegion, 
  clearAllRegions, 
  getRegion,
  updateRegionPois,
  getRegionsContext
} = useRegions();

// ()
let currentGeometry = null;
let currentGeometryType = null; // 注释说明

/**
 *
 * @param {boolean} val - 开关值
 */
const toggleFilter = (val) => {
  emit('toggle-filter', val);
};



/**
 *
 *
 */
function handleWeightToggle(val) {
  if (val) {

    weightDialogVisible.value = true;
  } else {

    showWeightValue.value = false;
    emit('weight-change', { enabled: false, showValue: false });
  }
}

/**
 *
 */
function handleShowWeightToggle(val) {
  emit('weight-change', { enabled: weightEnabled.value, showValue: val });
}


/**
 *
 */
function cancelWeightDialog() {
  weightDialogVisible.value = false;
  weightEnabled.value = false;
}

/**
 *
 */
async function confirmWeightDialog() {
  if (!selectedWeightType.value) {
    return;
  }
  
  weightLoading.value = true;
  
  // 与 TagCloud 联动说明
  emit('weight-change', { 
    enabled: true, 
    showValue: showWeightValue.value,
    weightType: selectedWeightType.value,
    needLoad: true
  });
  

  setTimeout(() => {
    weightLoading.value = false;
    weightDialogVisible.value = false;
    // (
    emit('weight-change', { 
      enabled: true, 
      showValue: showWeightValue.value,
      weightType: selectedWeightType.value,
      needLoad: true 
    });
  }, 500);
}

// ---  ---

// OpenLayers 相关说明
const polygonLayerSource = new VectorSource();
const polygonLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: polygonLayerSource,
  style: new Style({
    stroke: new Stroke({ color: '#2ecc71', width: 2 }),
    fill: new Fill({ color: 'rgba(46,204,113,0.1)' }),
  }),
  zIndex: 50
});

// OpenLayers 相关说明
const centerLayerSource = new VectorSource();
const centerLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: centerLayerSource,
  style: new Style({
    image: new RegularShape({
      points: 5,
      radius: 10,
      radius2: 5,
      fill: new Fill({ color: '#0000FF' }),
      stroke: new Stroke({ color: '#FFFFFF', width: 2 })
    })
  }),
  zIndex: 200
});

// OpenLayers 相关说明
const hoverLayerSource = new VectorSource();
const hoverLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: hoverLayerSource,
  style: new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color: 'rgba(255, 165, 0, 0.8)' }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    zIndex: 999
  }),
  zIndex: 200
});

// 4.
const locateLayerSource = new VectorSource();
const locateLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: locateLayerSource,
  style: new Style({
    image: new RegularShape({
      points: 5,
      radius: 8,
      radius2: 6,
      fill: new Fill({ color: '#00BFFF' }),
      stroke: new Stroke({ color: '#0080FF', width: 1 })
    })
  }),
  zIndex: 300
});

const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
const toMapLonLat = (lon, lat) => toGcj02IfNeeded(lon, lat, poiCoordSys);

const {
  popupVisible,
  popupName,
  popupDetailLines,
  popupStyle,
  popupPlacement,
  schedulePopupPosition,
  showPoiPopup,
  showBoundaryPopup,
  hidePopup: hidePoiPopup,
  attachPopupViewListeners,
  cleanupPopupAnchor
} = usePopupAnchor({
  mapRef: map,
  mapContainerRef: mapContainer,
  popupRef: poiPopup
});

const {
  aiEvidenceLayer,
  aiEvidenceLayerSource,
  aiBoundaryLegend,
  formatLegendPercent,
  clearAiEvidenceBoundaries: clearAiEvidenceBoundariesInternal,
  showAnalysisBoundary: showAnalysisBoundaryInternal,
  showAiSpatialEvidence: showAiSpatialEvidenceInternal,
  setBoundaryInteractionMode,
  findAiBoundaryAtCoordinate,
  buildBoundaryPopupLines
} = useEvidenceLayer({
  mapRef: map,
  locateLayerSource,
  hidePopup: hidePoiPopup,
  vectorLayerRuntimeOptions: VECTOR_LAYER_RUNTIME_OPTIONS,
  toMapLonLat
});

function clearAiEvidenceBoundaries() {
  clearAiEvidenceBoundariesInternal();
  hidePoiPopup();
}

function showAnalysisBoundary(boundary, options = {}) {
  showAnalysisBoundaryInternal(boundary, options);
  if (options?.clear !== false) {
    hidePoiPopup();
  }
}

function showAiSpatialEvidence(payload = {}, options = {}) {
  showAiSpatialEvidenceInternal(payload, options);
  if (options?.clear !== false) {
    hidePoiPopup();
  }
}

let html2canvasModulePromise = null;
let currentLocatedPoi = null;
const {
  highlightData,
  heatmapData,
  ensureDeckInitialized,
  markDeckLayersDirty,
  scheduleDeckSync,
  pickDeckObject,
  clearDeckData,
  destroyDeckBridge
} = useDeckBridge({
  mapRef: map,
  mapContainerRef: mapContainer,
  heatmapEnabledRef: heatmapEnabled,
  getCurrentLocatedPoi: () => currentLocatedPoi,
  onAfterSync: schedulePopupPosition
});

// OpenLayers 相关说明
let olPoiFeatures = [];
// OpenLayers 相关说明
let rawToOlMap = new Map();

onMounted(() => {
  // 注释说明
  const amapKey = import.meta.env.VITE_AMAP_KEY || '2b42a2f72ef6751f2cd7c7bd24139e72';
  const gaodeUrl = `https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}&key=${amapKey}`;

  const baseLayer = new TileLayer({
    source: new XYZ({ url: gaodeUrl, crossOrigin: 'anonymous' })
  });

  // OpenLayers 相关说明
  map.value = new OlMap({
    target: mapContainer.value,
    layers: [baseLayer, polygonLayer, centerLayer, hoverLayer, aiEvidenceLayer, locateLayer],
    controls: [],
    view: new View({
      center: fromLonLat([114.33, 30.58]),
      zoom: 14,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM
    }),
  });

  // OpenLayers 相关说明
  map.value.on('movestart', onMapMoveStart);
  map.value.on('moveend', onMapMoveEnd);
  map.value.on('pointermove', onPointerMove);
  map.value.on('singleclick', onMapClick);
  attachPopupViewListeners(map.value.getView());

  // POI 相关说明
  rebuildPoiOlFeatures();


  nextTick(() => {
    emit('map-ready', map.value);
  });
});

// 与 TagCloud 联动说明
watch(() => props.hoveredFeatureId, (newVal) => {
  hoverLayerSource.clear();
  if (newVal && rawToOlMap.has(newVal)) {
    const olFeature = rawToOlMap.get(newVal);
    // 注释说明
    const clone = olFeature.clone();
    // 注释说明
    // 与 TagCloud 联动说明
    clone.set('__raw', olFeature.get('__raw'));
    hoverLayerSource.addFeature(clone);
  }
});

/**
 *
 *
 */
function onMapMoveEnd() {
  setBoundaryInteractionMode(false);
  if (!map.value) return;
  const extent = map.value.getView().calculateExtent(map.value.getSize());
  const bl = toLonLat([extent[0], extent[1]]);
  const tr = toLonLat([extent[2], extent[3]]);
  // [   ]
  emit('map-move-end', [bl[0], bl[1], tr[0], tr[1]]);
  schedulePopupPosition();
}

function onMapMoveStart() {
  setBoundaryInteractionMode(true);
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}


const emitHover = debounce((feature) => {
  emit('hover-feature', feature);
}, 50); // 注释说明

/**
 *
 * deck.gl 相关说明
 */
function onMapClick(evt) {
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let foundRaw = null;
  let boundaryLabel = '';
  let boundaryMeta = null;

  // 注释说明
  map.value.forEachFeatureAtPixel(
    pixel,
    (feature) => {
      const label = feature.get('__aiBoundaryLabel');
      if (typeof label === 'string' && label.trim()) {
        boundaryLabel = label.trim();
        boundaryMeta = feature.get('__aiBoundaryMeta') || null;
        return true;
      }
      return false;
    },
    {
      hitTolerance: 12,
      layerFilter: (layer) => layer === aiEvidenceLayer
    }
  );

  if (!boundaryLabel) {
    const fallbackBoundary = findAiBoundaryAtCoordinate(evt.coordinate);
    if (fallbackBoundary) {
      boundaryLabel = fallbackBoundary.label;
      boundaryMeta = fallbackBoundary.meta;
    }
  }

  // POI 相关说明
  if (!boundaryLabel) {
    map.value.forEachFeatureAtPixel(
      pixel,
      (feature) => {
        const raw = feature.get('__raw');
        if (raw) {
          foundRaw = raw;
          return true;
        }
        return false;
      },
      {
        hitTolerance: 10,
        layerFilter: (layer) => layer === hoverLayer
      }
    );
  }

  // deck.gl 相关说明
  if (!boundaryLabel && !foundRaw && pixel && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1])) {
    const picked = pickDeckObject(pixel, 10);
    if (picked?.raw) {
      foundRaw = picked.raw;
    }
  }
  
  if (boundaryLabel) {
    showBoundaryPopup(
      boundaryLabel,
      evt.coordinate,
      buildBoundaryPopupLines(boundaryMeta)
    );
  } else if (foundRaw) {
    console.log('[MapContainer] 点击要素:', foundRaw);
    emit('click-feature', foundRaw);

    // POI 相关说明
    showPoiPopup(foundRaw, evt.coordinate);
  } else {

    hidePoiPopup();
  }
}

/**
 *
 * deck.gl 相关说明
 */
function onPointerMove(evt) {
  if (evt.dragging) return;
  
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let hitRaw = null;
  
  // OpenLayers 相关说明
  map.value.forEachFeatureAtPixel(pixel, (feature) => {
    if (feature.get('__raw')) {
      hitRaw = feature.get('__raw');
      return true;
    }
  }, {
    hitTolerance: 8,
    layerFilter: (layer) => layer === hoverLayer
  });
  
  // deck.gl 相关说明
  if (!hitRaw && pixel && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1])) {
    const picked = pickDeckObject(pixel, 8);
    if (picked?.raw) {
      hitRaw = picked.raw;
    }
  }
  
  if (hitRaw) {
    map.value.getTargetElement().style.cursor = 'pointer';
    emitHover(hitRaw);
  } else {
    map.value.getTargetElement().style.cursor = '';
    emitHover(null);
  }
}

onBeforeUnmount(() => {
  cleanupPopupAnchor();
  setBoundaryInteractionMode(false);
  destroyDeckBridge();
  
  // OpenLayers 相关说明
  if (map.value) map.value.setTarget(null);
});

// OpenLayers 相关说明
watch(() => props.poiFeatures, () => {
  rebuildPoiOlFeatures();

  if (currentGeometry && currentGeometryType) {
    if (currentGeometryType === 'Polygon') {
      onPolygonComplete(currentGeometry, true); // 注释说明
    } else if (currentGeometryType === 'Circle') {
      onCircleComplete(currentGeometry, true);
    }
  }
}, { deep: false });

/**
 * OpenLayers 相关说明
 * OpenLayers 相关说明
 */
function rebuildPoiOlFeatures() {
  olPoiFeatures = [];
  rawToOlMap.clear();
  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  for (const f of (props.poiFeatures || [])) {
    let [lon, lat] = f.geometry.coordinates;
    // 注释说明
    [lon, lat] = toGcj02IfNeeded(lon, lat, poiCoordSys);
    const feat = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
      __raw: f,
    });
    olPoiFeatures.push(feat);
    rawToOlMap.set(f, feat);
  }
}

/**
 *
 * @param {Object} feature - 要素对象
 */
let hasLocatedOnce = false;

function resolveFlyToLonLat(target) {
  if (!target) return null;

  if (Array.isArray(target) && target.length >= 2) {
    const lon = Number(target[0]);
    const lat = Number(target[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat];
    }
    return null;
  }

  if (Array.isArray(target?.geometry?.coordinates)) {
    const lon = Number(target.geometry.coordinates[0]);
    const lat = Number(target.geometry.coordinates[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat];
    }
    return null;
  }

  const lon = Number(target.lon ?? target.lng ?? target.longitude);
  const lat = Number(target.lat ?? target.latitude);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return [lon, lat];
  }

  return null;
}

function flyTo(target, options = {}) {
  if (!map.value || !target) return;
  const {
    showMarker = true,
    firstLocateZoom = true
  } = options || {};
  const lonLat = resolveFlyToLonLat(target);
  if (!lonLat) return;

  let [lon, lat] = lonLat;
  [lon, lat] = toGcj02IfNeeded(lon, lat, poiCoordSys);
  const center = fromLonLat([lon, lat]);

  const isPoiFeature = Array.isArray(target?.geometry?.coordinates);
  if (showMarker && isPoiFeature) {
    currentLocatedPoi = target;
  } else {
    currentLocatedPoi = null;
  }
  markDeckLayersDirty();
  scheduleDeckSync({ forceLayerRefresh: true });

  hoverLayerSource.clear();
  locateLayerSource.clear();
  if (showMarker) {
    locateLayerSource.addFeature(
      new Feature({
        geometry: new Point(center)
      })
    );
  }

  const view = map.value.getView();
  if (view.cancelAnimations) {
    view.cancelAnimations();
  }

  const animateOptions = {
    center,
    duration: 800,
  };

  if (firstLocateZoom && !hasLocatedOnce) {
    animateOptions.zoom = 17;
    hasLocatedOnce = true;
  }

  view.animate(animateOptions);
}

/**
 * ()
 * @param {string} mode - 绘制模式
 */
function openPolygonDraw(mode = 'Polygon') {
  if (!map.value) return;
  

  if (!canAddRegion.value) {
    ElNotification({
      title: 'ѡѴ',
      message: `ֻܻ ${MAX_REGIONS} ѡɾѡӡ`,
      type: 'warning',
      duration: 4000
    });
    return;
  }
  

  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
  }
  
  drawInteraction = new Draw({ source: polygonLayerSource, type: mode });
  
  drawInteraction.on('drawstart', () => {

    // 注释说明
    // 注释说明
    clearHighlights();
    // 注释说明
    // 注释说明
  });

  drawInteraction.on('drawend', (evt) => {
    const geometry = evt.feature.getGeometry();
    const type = geometry.getType(); // 注释说明
    const feature = evt.feature;
    
    if (type === 'Polygon') {
      onPolygonCompleteMulti(geometry, feature);
    } else if (type === 'Circle') {
      onCircleCompleteMulti(geometry, feature);
    }
    

    closePolygonDraw();
  });
  map.value.addInteraction(drawInteraction);
}

/**
 *
 * @param {Object} circleGeom - 圆形几何对象
 * @param {boolean} isRefresh - 是否为刷新触发
 */
function onCircleComplete(circleGeom, isRefresh = false) {
  if (!isRefresh) {
    currentGeometry = circleGeom;
    currentGeometryType = 'Circle';
  }
  const center = circleGeom.getCenter();
  const radius = circleGeom.getRadius(); // EPSG: 说明
  
  const insideRaw = [];
  
  // POI 相关说明
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const dx = coord[0] - center[0];
    const dy = coord[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= radius) {
      insideRaw.push(feat.get('__raw'));
    }
  }

  // 与 TagCloud 联动说明
  const centerPixelObj = { 
    x: map.value.getPixelFromCoordinate(center)[0], 
    y: map.value.getPixelFromCoordinate(center)[1] 
  };

  // (
  centerLayerSource.clear();
  const centerFeature = new Feature({
    geometry: new Point(center)
  });
  centerLayerSource.addFeature(centerFeature);

  showHighlights(insideRaw, { full: true });
  
  emit('polygon-completed', { 
    polygon: null,
    center: centerPixelObj,
    selected: insideRaw,
    type: 'Circle',
    circleCenter: toLonLat(center),
    circleRadius: radius
  });
}

/**
 *
 */
function closePolygonDraw() {
  if (!map.value) return;
  
  // 1.
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
    drawInteraction = null;
  }
  
  // 注释说明
  // "
  const interactions = map.value.getInteractions().getArray().slice();
  interactions.forEach((interaction) => {
    if (interaction instanceof Draw) {
      map.value.removeInteraction(interaction);
    }
  });
}

// ============  ============

/**
 * ()
 */
function onCircleCompleteMulti(circleGeom, feature) {
  const center = circleGeom.getCenter();
  const centerLonLat = toLonLat(center);
  const radius = circleGeom.getRadius();
  
  // POI 相关说明
  const insideRaw = [];
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const dx = coord[0] - center[0];
    const dy = coord[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= radius) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  
  // 注释说明

  const numPoints = 64;
  const wktCoords = [];
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const x = center[0] + radius * Math.cos(angle);
    const y = center[1] + radius * Math.sin(angle);
    const [lon, lat] = toLonLat([x, y]);
    wktCoords.push(`${lon} ${lat}`);
  }
  const boundaryWKT = `POLYGON((${wktCoords.join(', ')}))`;
  

  const region = addRegion({
    type: 'Circle',
    geometry: {
      type: 'Point',
      coordinates: centerLonLat,
      radius: radius
    },
    center: centerLonLat,
    boundaryWKT,
    pois: insideRaw,
    olFeature: feature
  });
  
  if (region) {

    applyRegionStyle(feature, region);
    

    addRegionLabel(center, region);
    

    createRegionDeleteButton(region);
    
    // POI 相关说明
    updateRegionPois(region.id, insideRaw);
    

    showHighlights(insideRaw, { full: true });
    

    emit('polygon-completed', { 
      polygon: null,
      center: { x: map.value.getPixelFromCoordinate(center)[0], y: map.value.getPixelFromCoordinate(center)[1] },
      selected: insideRaw,
      type: 'Circle',
      circleCenter: centerLonLat,
      circleRadius: radius,
      regionId: region.id,
      regionName: region.name
    });
  }
}

/**
 * ()
 */
function onPolygonCompleteMulti(polygonGeom, feature) {
  const ringCoords = polygonGeom.getCoordinates()[0];
  const ringPixels = ringCoords.map((c) => map.value.getPixelFromCoordinate(c));
  
  // POI 相关说明
  const insideRaw = [];
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const px = map.value.getPixelFromCoordinate(coord);
    if (pointInPolygonPixel(px, ringPixels)) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  

  const geoCenter = calculatePolygonGeoCenter(ringCoords);
  const centerLonLat = geoCenter ? toLonLat(geoCenter) : null;
  
  // 注释说明
  const wktCoords = ringCoords.map(c => {
    const [lon, lat] = toLonLat(c);
    return `${lon} ${lat}`;
  });
  const boundaryWKT = `POLYGON((${wktCoords.join(', ')}))`;
  
  // GeoJSON 相关说明
  const geoJsonGeometry = {
    type: 'Polygon',
    coordinates: [ringCoords.map(c => toLonLat(c))]
  };
  

  const region = addRegion({
    type: 'Polygon',
    geometry: geoJsonGeometry,
    center: centerLonLat,
    boundaryWKT,
    pois: insideRaw,
    olFeature: feature
  });
  
  if (region) {

    applyRegionStyle(feature, region);
    

    if (geoCenter) {
      addRegionLabel(geoCenter, region);
    }
    

    createRegionDeleteButton(region);
    
    // POI 相关说明
    updateRegionPois(region.id, insideRaw);
    

    showHighlights(insideRaw, { full: true });
    

    emit('polygon-completed', { 
      polygon: ringCoords.map((c) => toLonLat(c)),
      center: calculatePolygonCenter(ringPixels),
      selected: insideRaw,
      type: 'Polygon',
      polygonCenter: centerLonLat,
      regionId: region.id,
      regionName: region.name
    });
  }
}

/**
 * 注释说明
 */
function applyRegionStyle(feature, region) {
  const color = region.color;
  feature.setStyle(new Style({
    stroke: new Stroke({ color: color.stroke, width: 2 }),
    fill: new Fill({ color: color.fill })
  }));
}

/**
 *
 */
function addRegionLabel(center, region) {
  const labelFeature = new Feature({
    geometry: new Point(center)
  });
  
  labelFeature.setStyle(new Style({
    text: new TextStyle({
      text: region.name,
      font: 'bold 14px Arial',
      fill: new Fill({ color: region.color.text }),
      stroke: new Stroke({ color: '#fff', width: 3 }),
      offsetY: -20
    }),
    image: new RegularShape({
      points: 5,
      radius: 10,
      radius2: 5,
      fill: new Fill({ color: region.color.stroke }),
      stroke: new Stroke({ color: '#fff', width: 2 })
    })
  }));
  
  centerLayerSource.addFeature(labelFeature);
  

  region.labelFeature = labelFeature;
}

/**
 * 注释说明
 */
function createRegionDeleteButton(region) {
  if (!map.value) return;
  
  let buttonPosition = null;
  
  if (region.olFeature) {
    const geometry = region.olFeature.getGeometry();
    const geometryType = geometry.getType();
    
    if (geometryType === 'Polygon') {


      const coords = geometry.getCoordinates()[0];
      if (coords && coords.length > 0) {
        // 注释说明
        let topRightVertex = coords[0];
        let maxScore = coords[0][0] + coords[0][1]; // 注释说明
        
        for (const coord of coords) {
          const score = coord[0] + coord[1];
          if (score > maxScore) {
            maxScore = score;
            topRightVertex = coord;
          }
        }
        buttonPosition = topRightVertex;
      }
    } else if (geometryType === 'Circle') {
      // 45
      const center = geometry.getCenter();
      const radius = geometry.getRadius();
      // 45
      const angle = Math.PI / 4; // 45 度
      buttonPosition = [
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle)
      ];
    } else {

      const extent = geometry.getExtent();
      buttonPosition = [extent[2], extent[3]];
    }
  }
  
  if (!buttonPosition) return;
  
  // DOM 相关说明
  const buttonElement = document.createElement('div');
  buttonElement.className = 'region-delete-btn';
  buttonElement.innerHTML = '×';
  buttonElement.title = `删除${region.name}`;
  buttonElement.style.cssText = `
    width: 24px;
    height: 24px;
    background: ${region.color.stroke};
    color: white;
    border: 2px solid white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    transition: transform 0.2s, background 0.2s;
    user-select: none;
  `;
  

  buttonElement.onmouseenter = () => {
    buttonElement.style.transform = 'scale(1.2)';
    buttonElement.style.background = '#e74c3c';
  };
  buttonElement.onmouseleave = () => {
    buttonElement.style.transform = 'scale(1)';
    buttonElement.style.background = region.color.stroke;
  };
  

  buttonElement.onclick = (e) => {
    e.stopPropagation();
    removeRegionFromMap(region.id);
  };
  
  // OpenLayers 相关说明
  const overlay = new Overlay({
    element: buttonElement,
    position: buttonPosition,
    positioning: 'bottom-left',
    offset: [5, -5],
    stopEvent: true
  });
  
  map.value.addOverlay(overlay);
  

  region.deleteOverlay = overlay;
}

/**
 * (
 */
function clearAllRegionsFromMap() {
  // 注释说明
  regions.value.forEach(region => {
    if (region.deleteOverlay && map.value) {
      map.value.removeOverlay(region.deleteOverlay);
    }
  });
  
  const count = clearAllRegions();
  polygonLayerSource.clear();
  centerLayerSource.clear();
  clearAiEvidenceBoundaries();
  clearHighlights();
  currentGeometry = null;
  currentGeometryType = null;


   if (count > 0) {
    emit('regions-cleared', { count });
  }

  return count;
}

/**
 *
 */
function removeRegionFromMap(regionId) {
  const region = getRegion(regionId);
  if (region) {
    // 注释说明
    if (region.olFeature) {
      polygonLayerSource.removeFeature(region.olFeature);
    }
    if (region.labelFeature) {
      centerLayerSource.removeFeature(region.labelFeature);
    }
    // 注释说明
    if (region.deleteOverlay && map.value) {
      map.value.removeOverlay(region.deleteOverlay);
    }

    removeRegion(regionId);
    

    emit('region-removed', { regionId, regionName: region.name });
    
    console.log(`[Map] ѡ ${region.name} ɾǰʣ ${regions.value.length} ѡ`);
  }
}

/**
 *
 */
function clearHighlights() {
  clearDeckData();
}

/**
 * deck.gl 相关说明
 * @param {Array} features - 要素列表
 * @param {Object} options - 可选参数
 */
function showHighlights(features, options = {}) {
  // deck.gl 相关说明
  if (!features || !features.length) {
    clearHighlights();
    return;
  }

  // deck.gl 相关说明
  const deckData = features.map(raw => {
    let [lon, lat] = raw.geometry.coordinates;
    [lon, lat] = toGcj02IfNeeded(lon, lat, poiCoordSys);
    return {
      lon,
      lat,
      groupIndex: raw.properties._groupIndex || 0,
      raw,
    };
  });
  

  highlightData.value = deckData;
  heatmapData.value = deckData;
  ensureDeckInitialized().then((instance) => {
    if (!instance) return;
    markDeckLayersDirty();
    scheduleDeckSync({ forceLayerRefresh: true });
  });
  

  if (options.fitView && map.value) {

    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    deckData.forEach(d => {
      minLon = Math.min(minLon, d.lon);
      maxLon = Math.max(maxLon, d.lon);
      minLat = Math.min(minLat, d.lat);
      maxLat = Math.max(maxLat, d.lat);
    });
    

    if (minLon <= maxLon && minLat <= maxLat) {
      // Web Mercator 坐标说明
      const extent = [
        ...fromLonLat([minLon, minLat]),
        ...fromLonLat([maxLon, maxLat])
      ];
      
      map.value.getView().fit(extent, {
        padding: [50, 50, 50, 50],
        duration: 800,
        maxZoom: 16
      });
    }
  }
}


watch(heatmapEnabled, (enabled) => {
  if (enabled) {
    ensureDeckInitialized().then((instance) => {
      if (!instance) return;
      markDeckLayersDirty();
      scheduleDeckSync({ forceLayerRefresh: true });
    });
    return;
  }
  markDeckLayersDirty();
  scheduleDeckSync({ forceLayerRefresh: true });
});

/**
 *
 * @param {Object} polygonGeom - 多边形几何对象
 * @param {boolean} isRefresh - 是否为刷新触发
 */
function onPolygonComplete(polygonGeom, isRefresh = false) {
  if (!isRefresh) {
    currentGeometry = polygonGeom;
    currentGeometryType = 'Polygon';
  }
  const ringCoords = polygonGeom.getCoordinates()[0];
  const ringPixels = ringCoords.map((c) => map.value.getPixelFromCoordinate(c));

  const insideRaw = [];
  // POI 相关说明
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const px = map.value.getPixelFromCoordinate(coord);
    if (pointInPolygonPixel(px, ringPixels)) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  
  // 注释说明

  // +
  const centerPixelObj = calculatePolygonCenter(ringPixels);
  

  const geoCenter = calculatePolygonGeoCenter(ringCoords);
  
  // ( -
  centerLayerSource.clear();
  if (geoCenter) {
    const centerFeature = new Feature({
      geometry: new Point(geoCenter)
    });
    centerLayerSource.addFeature(centerFeature);
  }

  showHighlights(insideRaw, { full: true });
  
  emit('polygon-completed', { 
    polygon: ringCoords.map((c) => toLonLat(c)), 
    center: centerPixelObj,
    selected: insideRaw,
    type: 'Polygon',
    polygonCenter: geoCenter ? toLonLat(geoCenter) : null
  });
}

/**
 *
 */
function calculatePolygonCenter(ringPixels) {
  let x = 0, y = 0;
  const n = ringPixels.length;
  
  for (let i = 0; i < n; i++) {
    x += ringPixels[i][0];
    y += ringPixels[i][1];
  }
  
  return { x: x / n, y: y / n };
}

/**
 *
 * @param {Array} ringCoords - 多边形环坐标
 * @returns {Array} 返回值说明
 */
function calculatePolygonGeoCenter(ringCoords) {
  if (!ringCoords || ringCoords.length === 0) return null;
  
  let x = 0, y = 0;
  const n = ringCoords.length;
  
  for (let i = 0; i < n; i++) {
    x += ringCoords[i][0];
    y += ringCoords[i][1];
  }
  
  return [x / n, y / n];
}

/**
 *
 * @param {Array} pt - 点坐标
 * @param {Array} ringPixels - 像素环坐标
 */
function pointInPolygonPixel(pt, ringPixels) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ringPixels.length - 1; i < ringPixels.length; j = i++) {
    const xi = ringPixels[i][0], yi = ringPixels[i][1];
    const xj = ringPixels[j][0], yj = ringPixels[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 69
function clearPolygon() {
  polygonLayerSource.clear();
  centerLayerSource.clear();
  locateLayerSource.clear();
  clearAiEvidenceBoundaries();
  clearHighlights();
  currentGeometry = null;
  currentGeometryType = null;
  hasLocatedOnce = false;
  currentLocatedPoi = null; // POI 相关说明
}

/**
 *
 * @param {Array} coordinates - GeoJSON 坐标数组
 */
function addUploadedPolygon(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    ElNotification({
      title: 'Upload failed',
      message: 'Invalid polygon coordinates in uploaded file.',
      type: 'error',
      duration: 3500
    });
    return;
  }

  // 注释说明
  if (!canAddRegion.value) {
    ElNotification({
      title: 'Region limit reached',
      message: `Only ${MAX_REGIONS} regions are allowed. Remove one before uploading another.`,
      type: 'warning',
      duration: 4000
    });
    return;
  }

  const closedCoordinates = [...coordinates];
  const first = closedCoordinates[0];
  const last = closedCoordinates[closedCoordinates.length - 1];
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    closedCoordinates.push(first);
  }

  const olCoords = closedCoordinates.map(coord => {
    let [lon, lat] = coord;
    [lon, lat] = toGcj02IfNeeded(lon, lat, poiCoordSys);
    return fromLonLat([lon, lat]);
  });

  const geometry = new Polygon([olCoords]);
  const polygonFeature = new Feature({ geometry });
  polygonLayerSource.addFeature(polygonFeature);

  currentGeometry = geometry;
  currentGeometryType = 'Polygon';

  // 注释说明
  onPolygonCompleteMulti(geometry, polygonFeature);

  const extent = geometry.getExtent();
  map.value.getView().fit(extent, {
    padding: [50, 50, 50, 50],
    duration: 500
  });

  console.log('[MapContainer] Uploaded polygon is registered as a region');
}


defineExpose({
  map,
  openPolygonDraw,
  closePolygonDraw,
  showHighlights,
  showAnalysisBoundary,
  showAiSpatialEvidence,
  clearAiEvidenceBoundaries,
  clearHighlights,
  clearPolygon,
  clearAllRegionsFromMap,
  flyTo,
  addUploadedPolygon,
  clearPOIs: () => {
    centerLayerSource.clear();
    showHighlights([]);
  },
  highlightPOIs: (features, opts) => showHighlights(features, opts),
  setRegions: (newRegions) => {
    regions.value = newRegions;
    if (newRegions.length > 0) {
      if (globalAnalysisEnabled.value) {
        globalAnalysisEnabled.value = false;
        emit('global-analysis-change', false);
      }
    }
  },
  captureMapScreenshot
});

/**
 * 捕获当前地图和叠加层的截图
 * 用于发给 VLM 进行视觉审查和地图文字/形态解析
 */
async function captureMapScreenshot() {
  if (!mapContainer.value) return null;
  try {
    if (!html2canvasModulePromise) {
      html2canvasModulePromise = import('html2canvas')
        .then((mod) => mod.default || mod)
        .catch((error) => {
          html2canvasModulePromise = null;
          throw error;
        });
    }
    const html2canvas = await html2canvasModulePromise;
    const canvas = await html2canvas(mapContainer.value, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#000000',
      scale: 0.75,
    });
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('[MapContainer] Screenshot capture failed:', err);
    return null;
  }
}


</script>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.map-container {
  width: 100%;
  height: 100%;
  background-color: #000;
}

.map-filter-control {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.7); /*  */
  backdrop-filter: blur(12px); /**/
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(99, 102, 241, 0.3); /**/
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  min-width: 160px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.filter-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.filter-label.disabled {
  color: rgba(255, 255, 255, 0.3);
}

.control-divider {
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.4), transparent);
  margin: 4px 0;
  border: none;
  flex-shrink: 0;
}

.weight-dialog-content {
  padding: 10px 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/*  */
.control-hint {
  font-size: 11px;
  color: #67c23a;
  padding: 4px 0 0 0;
  animation: fadeIn 0.3s ease-out;
}

.control-hint span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-boundary-legend {
  position: absolute;
  left: 10px;
  bottom: 12px;
  z-index: 1100;
  min-width: 220px;
  max-width: 320px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(10px);
  color: #e2e8f0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
  pointer-events: none;
}

.legend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.legend-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.legend-model {
  font-size: 10px;
  color: #93c5fd;
}

.legend-stats {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.9);
  margin-bottom: 8px;
}

.legend-semantic {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 8px;
  font-size: 10px;
  color: rgba(191, 219, 254, 0.88);
}

.legend-scale {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.92);
}

.legend-swatch {
  width: 18px;
  height: 0;
  border-top-width: 2px;
  border-top-style: solid;
  border-radius: 999px;
  flex-shrink: 0;
}

.legend-item.high .legend-swatch {
  border-top-color: rgba(16, 185, 129, 0.95);
}

.legend-item.medium .legend-swatch {
  border-top-color: rgba(251, 191, 36, 0.88);
  border-top-style: dashed;
}

.legend-item.low .legend-swatch {
  border-top-color: rgba(239, 68, 68, 0.86);
  border-top-style: dashed;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

/* POI 相关说明 */
.poi-popup {
  position: absolute;
  color: #fff;
  display: block;
  pointer-events: none;
  z-index: 2000;
  will-change: left, top;
}

.popup-content {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  white-space: normal;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 300px;
  overflow: hidden;
}

.popup-title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.3;
}

.popup-detail {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(226, 232, 240, 0.92);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.popup-arrow {
  position: absolute;
  left: var(--popup-arrow-left, 50%);
  bottom: -8px;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid #16213e;
}

.poi-popup.is-bottom .popup-arrow {
  top: -8px;
  bottom: auto;
  border-top: none;
  border-bottom: 8px solid #16213e;
}

@keyframes popupFadeIn {
  from { 
    opacity: 0; 
    transform: translate(-50%, -90%); 
  }
  to { 
    opacity: 1; 
    transform: translate(-50%, -100%); 
  }
}

@media (max-width: 768px) {
  .map-filter-control {
    display: none !important;
  }

  .ai-boundary-legend {
    left: 8px;
    right: 8px;
    bottom: 8px;
    min-width: 0;
    max-width: none;
    padding: 9px 10px;
  }

  .legend-stats {
    flex-wrap: wrap;
    gap: 6px 10px;
  }
}

/* 注释说明 */
/* 注释说明 */
.map-filter-control :deep(.el-switch:not(.is-checked)) {
  --el-switch-off-color: #475569; /* 注释说明 */
}

/* 注释说明 */
.map-filter-control :deep(.el-switch:not(.is-checked) .el-switch__core) {
  background-color: #475569 !important;
  border-color: #475569 !important;
}

/* 注释说明 */
.map-filter-control :deep(.el-switch.is-checked .el-switch__core) {
  background-color: #4338ca !important;
  border-color: #4338ca !important;
}

/*  */
.map-filter-control :deep(.el-switch:not(.is-checked) .el-switch__inner .is-text) {
  color: #ffffff !important;
  font-weight: 500;
}
</style>


