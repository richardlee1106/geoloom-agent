<template>
  <div class="tag-cloud-wrapper">
    <div ref="tagCloudContainer" class="tag-cloud-container"></div>
    <!-- 缩放控制按钮组 -->
    <div class="zoom-controls">
      <button @click="zoomIn" class="zoom-btn" title="放大">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <button @click="zoomOut" class="zoom-btn" title="缩小">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <button @click="resetZoom" class="zoom-btn" title="重置视图">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
          <path d="M13 13l6 6"></path>
        </svg>
      </button>
    </div>
    
    <!-- 颜色图例 -->
    <div v-if="showWeightLegend" class="weight-legend">
      <div class="legend-title">人口密度</div>
      <div class="legend-items">
        <div v-for="(item, index) in legendItems" :key="index" class="legend-item">
          <span class="legend-color" :style="{ backgroundColor: item.color }"></span>
          <span class="legend-label">{{ item.label }}</span>
        </div>
      </div>
    </div>
    
    <!-- 空状态提示 -->
    <div v-if="!data || data.length === 0" class="empty-state">
      <div class="empty-text">请先添加点进行渲染</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import * as d3 from 'd3';
import BasicWorker from '../workers/basic.worker?worker';
import SpiralWorker from '../workers/spiral.worker.js?worker';
import GravityWorker from '../workers/gravity.worker.js?worker';
import { fromLonLat } from 'ol/proj';
import { ElNotification } from 'element-plus/es/components/notification/index';
import { rasterExtractor } from '../utils/RasterExtractor';
import { toDisplayLonLat } from '../utils/userLocationContext';

// 定义组件事件
// hover-feature: 鼠标悬停在标签时通知地图对应 POI
// locate-feature: 点击标签时触发，通知地图飞向对应 POI
const emit = defineEmits(['hover-feature', 'locate-feature']);

// 定义组件属性
const props = defineProps({
  data: Array, // 标签数据（GeoJSON Feature 数组）
  map: Object, // OpenLayers 地图实例
  algorithm: String, // 布局算法类型 ('basic' | 'spiral' | 'geo')
  selectedBounds: Object, // 选区边界（目前未使用）
  polygonCenter: Object, // 多边形中心点（用于螺旋布局）
  spiralConfig: Object, // 螺旋布局配置
  boundaryPolygon: Array, // 边界多边形顶点
  hoveredFeatureId: Object, // 当前悬浮的 Feature 对象
  clickedFeatureId: Object, // 当前点击的 Feature 对象（常亮）
  drawMode: String, // 当前绘制模式 ('Circle' | 'Polygon' | 'None')
  circleCenter: Array, // 圆形绘制模式下的圆心坐标 [lon, lat]
  // 新增权重相关属性
  weightEnabled: { type: Boolean, default: false }, // 是否启用权重
  showWeightValue: { type: Boolean, default: false }, // 是否显示权重值
});

// ============ 权重控制相关状态 ============
const selectedWeight = ref(''); // 当前选中的权重类型
const rasterLoading = ref(false); // 栅格加载状态
const rasterLoaded = ref(false); // 栅格是否已加载

// 权重选项
const weightOptions = ref([
  { value: 'population', label: '人口密度' },
]);

// 栅格文件路径
const RASTER_URL = '/data/武汉POP.tif';

// ============ Jenks 分类配置 ============
// 暖色系：蓝-白-红 5 分类
const WEIGHT_COLORS = [
  '#2166ac', // 蓝色 (最低)
  '#67a9cf', // 浅蓝
  '#f7f7f7', // 白色 (中间)
  '#ef8a62', // 浅红
  '#b2182b', // 深红 (最高)
];

// 分类断点（将在权重计算后更新）
const classBreaks = ref([]);
const legendItems = ref([]);

// 是否显示图例
const showWeightLegend = computed(() => props.weightEnabled && classBreaks.value.length > 0);
const poiCoordSys = (import.meta.env.VITE_POI_COORD_SYS || 'gcj02').toLowerCase();

function resolveFeatureCoordSys(feature, fallback = poiCoordSys) {
  return String(
    feature?.coordSys
    || feature?.coord_sys
    || feature?.properties?.coordSys
    || feature?.properties?._coordSys
    || fallback
  ).trim().toLowerCase() || fallback
}

/**
 * Jenks 自然断点分类算法
 * @param {Array<number>} data - 数值数组
 * @param {number} numClasses - 分类数量
 * @returns {Array<number>} - 断点数组
 */
function jenksBreaks(data, numClasses) {
  if (!data || data.length === 0) return [];
  
  // 过滤无效值并排序
  const sortedData = data.filter(d => d !== null && d !== undefined && !isNaN(d) && d > 0).sort((a, b) => a - b);
  
  if (sortedData.length === 0) return [];
  if (sortedData.length <= numClasses) {
    return sortedData;
  }
  
  const n = sortedData.length;
  const k = numClasses;
  
  // 简化版 Jenks：使用分位数作为近似
  const breaks = [];
  for (let i = 1; i < k; i++) {
    const idx = Math.floor((i * n) / k);
    breaks.push(sortedData[idx]);
  }
  breaks.push(sortedData[n - 1]); // 最大值
  
  return breaks;
}

/**
 * 根据权重值获取颜色
 * @param {number} weight - 权重值
 * @returns {string} - 颜色值
 */
function getWeightColor(weight) {
  if (!classBreaks.value.length || weight === 0 || weight === undefined) {
    return '#bfeaf1'; // 默认颜色
  }
  
  for (let i = 0; i < classBreaks.value.length; i++) {
    if (weight <= classBreaks.value[i]) {
      return WEIGHT_COLORS[i];
    }
  }
  return WEIGHT_COLORS[WEIGHT_COLORS.length - 1];
}

// 响应式引用
const tagCloudContainer = ref(null);
let worker = null; // Web Worker 实例
let svgRef = null; // D3 SVG 选择器引用
let rootGroupRef = null; // 主分组引用 (g.main-group)
let zoomGroupRef = null; // 缩放分组引用 (g.zoom-group)
let zoomBehavior = null; // D3 Zoom 行为实例
let debounceTimer = null; // 防抖定时器

// 常量配置
const MAX_TAGS = 800; // 标签显示上限（降低以提升性能）
const RESIZE_DEBOUNCE_MS = 120;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
let currentTransform = d3.zoomIdentity;
let cachedLayoutTags = [];
let viewportCullingEnabled = true; // 启用视口裁剪优化

/**
 * 初始化 Web Worker
 * 根据当前的绘制模式 (drawMode) 和算法选择 (algorithm) 实例化对应的 Worker。
 * Worker 用于在后台线程执行耗时的力导向布局计算，避免阻塞 UI 线程。
 */
function initWorker() {
  // 清理旧 worker，防止内存泄漏和重复处理
  if (worker) {
    worker.terminate();
  }
  
  // 确定 worker 类型
  // 优先级: 
  // 1. Gravity (有坐标数据时) - 只要有地理属性就优先使用重心引力布局，保证空间一致性
  // 2. Spiral / Basic - 无地理属性或手动强制选择时使用
  const hasGeoData = props.data?.some(f => f.geometry?.coordinates);
  
  if (hasGeoData && props.algorithm !== 'spiral' && props.algorithm !== 'basic') {
    // 只要有坐标数据且未强制要求普通螺旋布局，就使用 GravityWorker
    worker = new GravityWorker();
    console.log(`[TagCloud] õ֪ GravityWorker (${props.data?.length || 0}ǩ)`);
  } else if (props.algorithm === 'basic') {
    worker = new BasicWorker();
  } else {
    worker = new SpiralWorker();
  }
  
  // 设置 worker 消息处理回调
  // 当 Worker 计算完成并返回布局后的标签数据时触发
  worker.onmessage = event => {
    const tags = event.data;
    console.log('[TagCloud] 收到来自 Worker 的标签数据:', tags.length);
    
    // 缓存布局数据，用于 centerOnFeature 快速查找
    cachedLayoutTags = tags;

    // 使用 requestAnimationFrame 优化渲染
    requestAnimationFrame(() => {
      const svg = d3.select(tagCloudContainer.value).select('svg');
      const root = svg.select('g.main-group');
      rootGroupRef = root;
      const zoomGroup = svg.select('g.zoom-group');

      if (svg.empty() || root.empty() || zoomGroup.empty()) {
        console.error('[TagCloud] 错误: 未找到 SVG 元素');
        return;
      }

      // 性能优化：标签过多时禁用过渡动画
      const useTransition = tags.length < 500;
      const transitionDuration = useTransition ? 200 : 0;

      // 使用 D3 的数据绑定机制
      // 使用更唯一的 key：名称 + 坐标（避免搜索过滤后 key 冲突）
      const texts = root
        .selectAll('text')
        .data(tags, d => `${d.name}-${d.lon?.toFixed(6)}-${d.lat?.toFixed(6)}`);

      // 预计算样式值，减少函数调用
      const getFontSize = d => `${d.fontSize || 16}px`;
      
      // 颜色权重：使用 Jenks 分类色
      const getFill = d => {
        if (d.isCenter) return '#FFA500';
        if (d.selected) return '#d23';
        // 权重分布分点，使用权重颜色
        if (props.weightEnabled && classBreaks.value.length > 0 && d.weight !== undefined) {
          return getWeightColor(d.weight);
        }
        return '#bfeaf1'; // 默认颜色
      };
      
      const getFontWeight = d => d.isCenter ? '900' : (d.selected ? '700' : '400');
      const getTransform = d => `translate(${d.x},${d.y})${d.rotation ? ` rotate(${d.rotation})` : ''}`;
      
      // 文本内容：名称已经在数据预处理时包含了权重后缀（如果启用）
      const getText = d => d.name;

      // Enter + Update 合并处理
      texts.join(
        enter => enter.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '.35em')
          .style('cursor', 'pointer')
          .text(getText)
          .style('font-size', getFontSize)
          .style('fill', getFill)
          .style('font-weight', getFontWeight)
          .attr('transform', getTransform)
          .on('mouseover', (event, d) => {
            if (d.isCenter) return;
            // 使用 coordKey 从映射表中查找原始 feature
            const feature = featureMap.get(d.coordKey);
            if (feature) {
              emit('hover-feature', feature);
            }
          })
          .on('mouseout', () => emit('hover-feature', null))
          .on('click', (event, d) => {
            event.stopPropagation();
            if (d.isCenter) return;
            // 使用 coordKey 从映射表中查找原始 feature
            const feature = featureMap.get(d.coordKey);
            if (feature) {
              emit('locate-feature', feature);
            }
          }),
        update => {
          // 性能优化：根据数量决定是否使用动画
          const u = useTransition ? update.transition().duration(transitionDuration) : update;
          return u
            .text(getText) // 使用 getText 支持显示权重值
            .style('font-size', getFontSize)
            .style('fill', getFill)
            .style('font-weight', getFontWeight)
            .attr('transform', getTransform);
        },
        exit => exit.remove()
      );

      // 应用高亮状态（悬浮和点击）
      if (props.hoveredFeatureId || props.clickedFeatureId) {
        updateHighlight();
      }
    });
  };
}

// Feature 映射表：coordKey -> feature（用于点击/悬停事件的反向查找）
let featureMap = new Map();

/**
 * 生成坐标唯一键
 * @param {number} lon - 经度
 * @param {number} lat - 纬度
 * @returns {string} 唯一键
 */
function makeCoordKey(lon, lat) {
  return `${lon?.toFixed(6)}_${lat?.toFixed(6)}`;
}

/**
 * 更新标签的高亮样式（性能优化版）
 * 同时考虑悬浮和点击状态，点击状态优先级更高（常亮）
 * 权重模式下使用权重颜色
 */
function updateHighlight() {
  if (!rootGroupRef || rootGroupRef.empty()) return;
  
  // 生成目标 feature 的 coordKey
  const getTargetCoordKey = (feature) => {
    if (!feature) return null;
    const coords = feature.geometry?.coordinates;
    if (!coords) return null;
    return makeCoordKey(coords[0], coords[1]);
  };
  
  const hoveredKey = getTargetCoordKey(props.hoveredFeatureId);
  const clickedKey = getTargetCoordKey(props.clickedFeatureId);
  
  // 直接更新样式，不使用过渡动画
  rootGroupRef.selectAll('text')
    .style('fill', d => {
      if (d.isCenter) return '#FFA500';
      // 悬停或点击的标签使用橙色高亮
      if (d.coordKey === clickedKey || d.coordKey === hoveredKey) {
        return 'orange';
      }
      if (d.selected) return '#d23';
      // 权重模式：使用权重颜色
      if (props.weightEnabled && classBreaks.value.length > 0 && d.weight !== undefined) {
        return getWeightColor(d.weight);
      }
      return '#bfeaf1'; // 默认颜色
    })
    .style('font-weight', d => {
      if (d.isCenter) return '900';
      if (d.coordKey === clickedKey || d.coordKey === hoveredKey) {
        return 'bold';
      }
      return d.selected ? '700' : '400';
    });
}

// 监听悬浮和点击状态变化
watch(() => props.hoveredFeatureId, () => updateHighlight(), { flush: 'sync' });
watch(() => props.clickedFeatureId, () => updateHighlight(), { flush: 'sync' });

/**
 * 处理权重选择变更
 * 当用户选择权重类型时，加载对应的栅格数据
 */
async function handleWeightChange(value) {
  if (!value) {
    // 权重取消选择
    rasterLoaded.value = false;
    console.log('[TagCloud] Ȩѡ');
    return;
  }

  if (value === 'population') {
    // 如果栅格已加载，直接使用
    if (rasterExtractor.loaded) {
      ElNotification.success({ title: '成功', message: '人口密度栅格已就绪，权重将在下次布局时生效', offset: 80 });
      rasterLoaded.value = true;
      // 触发重新布局
      scheduleRunLayout();
      return;
    }

    // 加载栅格数据
    rasterLoading.value = true;
    console.log('[TagCloud] 开始加载人口密度栅格...');

    try {
      const success = await rasterExtractor.load(RASTER_URL);
      
      if (success) {
        rasterLoaded.value = true;
        const metadata = rasterExtractor.getMetadata();
        ElNotification.success({
          title: '加载成功',
          message: `人口密度栅格加载成功！尺寸: ${metadata.width}×${metadata.height}`,
          duration: 3000,
          offset: 80
        });
        // 触发重新布局以应用权重
        scheduleRunLayout();
      } else {
        selectedWeight.value = '';
        rasterLoaded.value = false;
        ElNotification.error({ title: '加载失败', message: '人口密度栅格加载失败，请检查文件路径', offset: 80 });
      }
    } catch (error) {
      console.error('[TagCloud] 栅格加载错误:', error);
      selectedWeight.value = '';
      rasterLoaded.value = false;
      ElNotification.error({ title: '错误', message: `加载失败: ${error.message}`, offset: 80 });
    } finally {
      rasterLoading.value = false;
    }
  }
}

/**
 * 主布局函数：准备数据并发送给 Worker
 * @param {String} algorithm - 当前使用的算法名称
 */
const runLayout = (algorithm) => {
  console.log('[TagCloud] runLayout . :', props.data?.length); 
  if (!props.data) {
    console.log('[TagCloud] runLayout 提前返回. Data 为空');
    return;
  }

  if (!tagCloudContainer.value) {
     console.warn('[TagCloud] 容器未就绪，跳过布局');
     return;
  }

  const width = tagCloudContainer.value.clientWidth;
  const height = tagCloudContainer.value.clientHeight;

  // 始终重新选择 SVG 以确保引用不是过期的
  let svg = d3.select(tagCloudContainer.value).select('svg');
  if (svg.empty()) {
    svg = d3.select(tagCloudContainer.value).append('svg');
    // 创建嵌套的组结构用于缩放和平移 (zoom/pan)
    svg.append('g').attr('class', 'zoom-group');
  }

  // 获取 zoom group 并在其中设置 main group
  const zoomGroup = svg.select('g.zoom-group');
  let root = zoomGroup.select('g.main-group');
  if (root.empty()) {
    root = zoomGroup.append('g').attr('class', 'main-group');
  }

  svg.attr('width', width)
     .attr('height', height)
     .style('background-color', 'rgba(255, 255, 255, 0.1)'); // 调试用背景色

  // 设置缩放行为 (Zoom Behavior) - 性能优化版
  if (!zoomBehavior) {
    let lastZoomTime = 0;
    const ZOOM_THROTTLE = 8; // 提高到 ~120fps 的检测频率
    
    zoomBehavior = d3.zoom()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .filter((event) => {
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        const now = performance.now();
        if (now - lastZoomTime < ZOOM_THROTTLE) return;
        lastZoomTime = now;
        
        currentTransform = event.transform;
        zoomGroup.attr('transform', currentTransform);
        
        // 注意：视口裁剪功能暂时禁用，因为可能导致标签显示不稳定
        // if (viewportCullingEnabled) {
        //   cullingViewport(width, height);
        // }
      });
  }

  // 始终应用缩放行为，确保事件监听器存在
  svg.call(zoomBehavior);
  
  if (!svgRef || !zoomGroupRef) {
    svgRef = svg;
    zoomGroupRef = zoomGroup;
  }

  // 计算标签位置和选择标记
  // ȡҪԣ͸ Worker
  
  // 清空并重建 featureMap
  featureMap.clear();
  
  let tags = (props.data || []).map((feature, index) => {
    const name = feature?.properties?.['名称'] ?? feature?.properties?.name ?? feature?.properties?.Name ?? '';
    
    // 提取地理坐标用于 Geo 布局
    let rawLon, rawLat;
    let displayLon, displayLat;
    if (feature.geometry && feature.geometry.coordinates) {
      // 假设坐标是 [lon, lat] (GeoJSON 标准)
      [rawLon, rawLat] = feature.geometry.coordinates;
      [displayLon, displayLat] = toDisplayLonLat(rawLon, rawLat, resolveFeatureCoordSys(feature));
    }

    // 权重：优先使用自带权重，其次使用提取权重
    let weight = feature?.properties?.weight ?? 0;
    
    // 如果启用了权重且栅格已加载，从栅格中提取权重
    if (props.weightEnabled && rasterLoaded.value && rasterExtractor.loaded) {
      if (rawLon !== undefined && rawLat !== undefined) {
        weight = rasterExtractor.extractValue(rawLon, rawLat);
      }
    }

    // 生成唯一坐标键
    const coordKey = makeCoordKey(rawLon, rawLat);
    
    // 建立映射表：coordKey -> 原始 feature
    if (Number.isFinite(rawLon) && Number.isFinite(rawLat)) {
      featureMap.set(coordKey, feature);
    }

    // 显示权重值：在名称后缀添加括号值
    // 这样 Worker 可以正确测量完整文本的宽度
    let displayName = name;
    if (props.showWeightValue && weight > 0) {
      displayName = `${name} (${Math.round(weight)})`;
    }

    return {
      name: displayName, // 传递完整显示名称给 worker
      weight, // 权重值用于颜色和排序
      lon: displayLon, lat: displayLat, // 用地图显示坐标参与空间布局，避免与地图视图错位
      rawLon, rawLat,
      coordKey, // 唯一坐标键
      x: width / 2, // 初始位置
      y: height / 2,
      originalIndex: index, // 保留原始索引（仅用于调试）
    };
  }).filter(t => t.name && t.name.trim() !== '');

  // 去重逻辑：相同名称+相同坐标的只保留一个
  // 相同名称但不同坐标的保留（视为不同位置的同名地点）
  const dedupeMap = new Map();
  for (const tag of tags) {
    // 使用"名称+坐标"作为唯一键
    const dedupeKey = `${tag.name}_${tag.coordKey}`;
    if (!dedupeMap.has(dedupeKey)) {
      dedupeMap.set(dedupeKey, tag);
    }
  }
  const deduplicatedCount = tags.length - dedupeMap.size;
  tags = Array.from(dedupeMap.values());
  
  if (deduplicatedCount > 0) {
    console.log(`[TagCloud] ȥأƳ ${deduplicatedCount} ظǩ ${tags.length} `);
  }

  console.log('[TagCloud] 名称提取后数量:', tags.length, '映射表大小:', featureMap.size);

  // 权重：使用 Jenks 算法计算权重分布
  if (props.weightEnabled && rasterLoaded.value) {
    // 提取所有权重值
    const allWeights = tags.map(t => t.weight).filter(w => w > 0);
    
    // 计算 Jenks 分类断点（5 类）
    const breaks = jenksBreaks(allWeights, 5);
    classBreaks.value = breaks;
    
    // 生成图例项
    if (breaks.length > 0) {
      const newLegendItems = [];
      let prevBreak = 0;
      for (let i = 0; i < breaks.length; i++) {
        newLegendItems.push({
          color: WEIGHT_COLORS[i],
          label: `${Math.round(prevBreak)} - ${Math.round(breaks[i])}`,
          min: prevBreak,
          max: breaks[i]
        });
        prevBreak = breaks[i];
      }
      legendItems.value = newLegendItems;
      console.log('[TagCloud] Jenks 分类断点:', breaks);
    }
    
    // 按权重降序排序
    tags.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    console.log('[TagCloud] 已按权重排序. 前5个权重:', tags.slice(0, 5).map(t => (t.weight || 0).toFixed(1)));
  } else {
    // 清空分类
    classBreaks.value = [];
    legendItems.value = [];
  }

  // 削减非常大的数据集以保持 DOM 大小可控
  if (tags.length > MAX_TAGS) {
    // 权重模式：按权重选取（保留最重要的节点）
    // 如果没有权重，按密度排序后选取
    if (props.weightEnabled && rasterLoaded.value) {
      // 权重模式：直接截取前 MAX_TAGS 个（已按权重排序）
      tags = tags.slice(0, MAX_TAGS);
      console.log('[TagCloud] 按权重削减至上限:', tags.length);
    } else {
      // 原有逻辑：按密度选取前 MAX_TAGS 个主要节点
      const tempTags = calculateDensityGrid(tags, 64, width, height);
      tempTags.sort((a, b) => b.normalizedDensity - a.normalizedDensity);
      tags = tempTags.slice(0, MAX_TAGS);
      console.log('[TagCloud] 按密度削减至上限:', tags.length);
    }
  }

  // 使用网格快速计算近似密度，用于字体大小插值
  if (tags.length <= MAX_TAGS) {
    tags = calculateDensityGrid(tags, 64, width, height);
  }


  // 高亮显示在选中边界内的标签（如果有）
  const rect = getSelectedRect(props.selectedBounds);
  if (rect) {
    tags = tags.map(t => ({
      ...t,
      selected: t.x >= rect.xMin && t.x <= rect.xMax && t.y >= rect.yMin && t.y <= rect.yMax,
    }));
  } else {
    tags = tags.map(t => ({ ...t, selected: false }));
  }

  console.log('[TagCloud] 发送给 Worker 的数据量:', tags.length);
  
  // 传递多边形中心给 worker 用于螺旋算法（确保可序列化）
  const serializablePolygonCenter = (props.polygonCenter && typeof props.polygonCenter.x === 'number' && typeof props.polygonCenter.y === 'number')
    ? { x: props.polygonCenter.x, y: props.polygonCenter.y }
    : { x: width / 2, y: height / 2 };
  
  // 转换配置对象为普通对象
  const plainConfig = props.spiralConfig ? {
    initialDistance: Number(props.spiralConfig.initialDistance ?? 5),
    spiralSpacing: Number(props.spiralConfig.spiralSpacing ?? 8),
    angleStep: Number(props.spiralConfig.angleStep ?? 0.2),
    minTagSpacing: Number(props.spiralConfig.minTagSpacing ?? 25),
    fontMin: 18,
    fontMax: 22
  } : null;
  
  let boundaryPixels = null;
  if (Array.isArray(props.boundaryPolygon) && props.boundaryPolygon.length && props.map) {
    try {
      boundaryPixels = props.boundaryPolygon.map(([lng, lat]) => {
        const coord = fromLonLat([lng, lat]);
        const px = props.map.getPixelFromCoordinate(coord);
        return [px[0], px[1]];
      });
    } catch (e) {
      boundaryPixels = null;
    }
  }
  
  // 移除 Vue Proxies 防止 postMessage 错误
  const sanitizedTags = JSON.parse(JSON.stringify(tags));
  const sanitizedCenter = props.circleCenter ? JSON.parse(JSON.stringify(props.circleCenter)) : null;

  worker.postMessage({ 
    tags: sanitizedTags, 
    algorithm, 
    width, 
    height,
    polygonCenter: serializablePolygonCenter,
    config: plainConfig,
    boundary: boundaryPixels,
    // Geo Worker 参数
    center: sanitizedCenter,
  });
};

onMounted(() => {
  initWorker();
  runLayout(props.algorithm);

  // 监听窗口大小调整，防抖动重新布局
  window.addEventListener('resize', resize);
});

// 公开的 resize 方法，供父组件调用（如卷帘调整时）
const resize = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runLayout(props.algorithm), RESIZE_DEBOUNCE_MS);
};

function scheduleRunLayout() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runLayout(props.algorithm), 80);
}

// 监听属性变化以触发更新
watch([
  () => props.algorithm,
  () => props.data,
  () => props.selectedBounds,
  () => props.polygonCenter,
  () => props.boundaryPolygon,
  () => props.drawMode,
  () => props.circleCenter,
  () => props.weightEnabled,
  () => props.showWeightValue
], ([newAlgorithm, newData, newBounds, newCenter, newPoly, newMode, newCircleCenter, newWeightEnabled, newShowWeightValue], [oldAlgorithm, oldData, oldBounds, oldCenter, oldPoly, oldMode, oldCircleCenter, oldWeightEnabled, oldShowWeightValue]) => {
  // 检查是否需要重新初始化 worker (算法改变 或 模式改变)
  const modeChanged = newMode !== oldMode;
  const algChanged = newAlgorithm !== oldAlgorithm;
  
  if (modeChanged || algChanged) {
    initWorker();
  }
  scheduleRunLayout();
});

// 工具函数：获取选择区域矩形（暂时禁用）
function getSelectedRect(bounds) {
  return null; 
}

/**
 * 计算网格密度
 * 将画布划分为网格，统计每个单元格内的点数，用于近似计算局部密度
 * 用于动态调整标签字体大小（密度高的区域字体小，密度低的区域字体大）
 */
function calculateDensityGrid(items, cellSize, width, height) {
  if (!items || items.length === 0) return [];
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  
  // 填充网格计数
  for (const t of items) {
    const ci = Math.min(cols - 1, Math.max(0, Math.floor(t.x / cellSize)));
    const ri = Math.min(rows - 1, Math.max(0, Math.floor(t.y / cellSize)));
    grid[ri][ci] += 1;
  }
  
  // 计算每个点的平滑密度（包含周围3x3网格）
  const densities = items.map(t => {
    const ci = Math.min(cols - 1, Math.max(0, Math.floor(t.x / cellSize)));
    const ri = Math.min(rows - 1, Math.max(0, Math.floor(t.y / cellSize)));
    let sum = 0, count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = ri + dr, c = ci + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          sum += grid[r][c];
          count++;
        }
      }
    }
    return sum / Math.max(1, count);
  });
  const max = Math.max(1, ...densities);
  // 归一化密度，用于调整字体大小
  return items.map((t, i) => ({ ...t, normalizedDensity: densities[i] / max }));
}

// 缩放控制方法
const zoomIn = () => {
  if (svgRef) {
    svgRef.transition().duration(300).call(
      d3.zoom().scaleBy, 1.5
    );
  }
};

const zoomOut = () => {
  if (svgRef) {
    svgRef.transition().duration(300).call(
      d3.zoom().scaleBy, 1 / 1.5
    );
  }
};

const resetZoom = () => {
  if (svgRef) {
    currentTransform = d3.zoomIdentity;
    svgRef.transition().duration(300).call(
      d3.zoom().transform, d3.zoomIdentity
    );
  }
};

/**
 * 定位到指定要素 (Center On Feature) - 性能优化版
 * @param {Object} feature - 目标地理要素
 */
const centerOnFeature = (feature) => {
  if (!feature || !svgRef || !zoomBehavior) return;

  const targetCoords = feature.geometry?.coordinates;
  if (!targetCoords) return;
  const targetCoordKey = makeCoordKey(targetCoords[0], targetCoords[1]);
  
  let targetD = null;
  for (const tag of cachedLayoutTags) {
    if (tag.coordKey === targetCoordKey) {
      targetD = tag;
      break;
    }
  }
  
  if (targetD) {
    const width = tagCloudContainer.value.clientWidth;
    const height = tagCloudContainer.value.clientHeight;
    const scale = 2.0;
    const duration = 500; // 缩短动画时长
    
    const t = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-targetD.x, -targetD.y);
    
    // 使用 requestAnimationFrame 避免阻塞
    requestAnimationFrame(() => {
      svgRef.transition().duration(duration).call(
        zoomBehavior.transform, t
      );
    });
  }
};

/**
 * 加载栅格文件
 * 供父组件调用，用于加载人口密度栅格
 * @returns {Promise<boolean>} 是否加载成功
 */
async function loadRaster() {
  if (rasterExtractor.loaded) {
    rasterLoaded.value = true;
    return true;
  }
  
  rasterLoading.value = true;
  console.log('[TagCloud] 开始加载栅格文件...');
  
  try {
    const success = await rasterExtractor.load(RASTER_URL);
    if (success) {
      rasterLoaded.value = true;
      console.log('[TagCloud] 栅格加载成功');
      return true;
    } else {
      rasterLoaded.value = false;
      return false;
    }
  } catch (error) {
    console.error('[TagCloud] 栅格加载失败:', error);
    rasterLoaded.value = false;
    return false;
  } finally {
    rasterLoading.value = false;
  }
}

// 暴露方法给父组件调用
defineExpose({
  centerOnFeature,
  resize,
  loadRaster
});
</script>

<style scoped>
.tag-cloud-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.tag-cloud-container {
  width: 100%;
  height: 100%;
  background-color: #001018; /* 深海蓝背景 */
}

/* 性能优化: 启用 GPU 加速和减少重绘 */
.tag-cloud-container :deep(svg) {
  will-change: transform;
  contain: layout style paint;
  touch-action: none; /* 优化触摸事件 */
}

.tag-cloud-container :deep(g.zoom-group) {
  will-change: transform;
}

.tag-cloud-container :deep(g.main-group) {
  will-change: transform;
}

.tag-cloud-container :deep(text) {
  /* 减少文本渲染开销 */
  text-rendering: optimizeSpeed;
  font-kerning: none;
  shape-rendering: optimizeSpeed;
  /* 禁用可能导致重排的属性 */
  pointer-events: auto;
  user-select: none;
}

.zoom-controls {
  position: absolute;
  top: 20px;
  left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px;
  border-radius: 8px;
  z-index: 10;
}

.zoom-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.zoom-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* 权重图例 */
.weight-legend {
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 10;
  background: rgba(0, 0, 0, 0.75);
  padding: 12px 16px;
  border-radius: 8px;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.legend-title {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  text-align: center;
  letter-spacing: 0.5px;
}

.legend-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.legend-color {
  width: 24px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.legend-label {
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.empty-state {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5; /* 确保在 canvas 上方，但可能在 tooltip 下方 */
  pointer-events: none; /* 不阻挡底层可能的交互，但这里本来就空 */
}

.empty-text {
  font-size: 20px;
  color: #6366f1;
  font-weight: 700;
  letter-spacing: 4px;
  text-transform: uppercase;
  background: linear-gradient(to right, #6366f1, #a855f7);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: breathing 3s ease-in-out infinite;
  user-select: none;
}

@keyframes breathing {
  0%, 100% { transform: scale(0.95); opacity: 0.5; filter: drop-shadow(0 0 5px rgba(99, 102, 241, 0.2)); }
  50% { transform: scale(1.05); opacity: 1; filter: drop-shadow(0 0 15px rgba(99, 102, 241, 0.6)); }
}
</style>
