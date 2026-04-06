/**
 * 动态重心引力 + 圈层方位布局算法 v2
 * 
 * 核心改进：
 * 1. 保证所有标签都能显示（不会因为布局空间不足而丢失）
 * 2. 根据容器大小自动调整字体和间距
 * 3. 当标签过多时，使用多层螺旋布局
 */

/**
 * 自适应配置生成器
 */
function getAdaptiveConfig(width, height, tagCount) {
  const minDim = Math.min(width, height);
  const area = width * height;
  
  // 计算每个标签的平均可用面积
  const areaPerTag = area / Math.max(1, tagCount);
  
  // 根据面积计算合适的字体大小
  // 假设每个标签需要 fontSize * 3 * fontSize 的空间
  let idealFontSize = Math.sqrt(areaPerTag / 3);
  idealFontSize = Math.max(8, Math.min(16, idealFontSize));
  
  // 根据容器大小缩放
  const scaleFactor = Math.max(0.6, Math.min(1.2, minDim / 500));
  
  const fontMin = Math.max(8, idealFontSize * 0.8 * scaleFactor);
  const fontMax = Math.max(10, idealFontSize * 1.2 * scaleFactor);
  
  // 计算圈层数和间距
  const maxRadius = (minDim / 2) - 20;
  const numRings = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(tagCount / 3))));
  const ringSpacing = maxRadius / (numRings + 0.5);
  
  return {
    fontMin,
    fontMax,
    ringSpacing,
    minTagSpacing: 2,
    numRings,
    centerMargin: ringSpacing * 0.5,
    gravityStrength: 0.1,
    iterations: Math.min(80, tagCount),
    maxRadius,
  };
}

/**
 * 计算方位角
 */
function calculateBearing(centerLon, centerLat, pointLon, pointLat) {
  const toRad = deg => deg * Math.PI / 180;
  const toDeg = rad => rad * 180 / Math.PI;
  
  const dLon = toRad(pointLon - centerLon);
  const lat1 = toRad(centerLat);
  const lat2 = toRad(pointLat);
  
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  
  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * 计算距离
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => deg * Math.PI / 180;
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) ** 2;
  
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * 文本宽度估算
 */
function measureText(text, fontSize) {
  if (!text) return 0;
  let width = 0;
  for (const char of text) {
    width += /[\u4e00-\u9fa5]/.test(char) ? fontSize : fontSize * 0.5;
  }
  return width;
}

/**
 * 分配圈层
 */
function assignRings(tags, numRings) {
  if (!tags.length) return [];
  
  const sorted = [...tags].sort((a, b) => a.distance - b.distance);
  const perRing = Math.ceil(sorted.length / numRings);
  
  sorted.forEach((tag, i) => {
    tag.ring = Math.min(Math.floor(i / perRing), numRings - 1);
  });
  
  return sorted;
}

/**
 * 检测AABB重叠
 */
function checkOverlap(t1, t2, spacing) {
  const dx = Math.abs(t1.x - t2.x);
  const dy = Math.abs(t1.y - t2.y);
  const hw = (t1.width + t2.width) / 2 + spacing;
  const hh = (t1.fontSize + t2.fontSize) / 2 + spacing;
  return dx < hw && dy < hh;
}

/**
 * 简化的碰撞推开
 */
function resolveCollisions(tags, config, iterations = 20) {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        if (checkOverlap(tags[i], tags[j], config.minTagSpacing)) {
          const dx = tags[j].x - tags[i].x || 0.1;
          const dy = tags[j].y - tags[i].y || 0.1;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          
          const pushX = (dx / dist) * 2;
          const pushY = (dy / dist) * 2;
          
          tags[i].x -= pushX;
          tags[i].y -= pushY;
          tags[j].x += pushX;
          tags[j].y += pushY;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * 主布局函数 - 保证所有标签都被渲染
 */
function layoutTags(data) {
  const { tags, width, height, center } = data;
  
  if (!tags || tags.length === 0) {
    return [];
  }
  
  console.log(`[GravityWorker] 布局 ${tags.length} 个标签, 容器: ${width}x${height}`);
  
  const config = getAdaptiveConfig(width, height, tags.length);
  console.log(`[GravityWorker] 配置: rings=${config.numRings}, font=${config.fontMin.toFixed(1)}-${config.fontMax.toFixed(1)}, spacing=${config.ringSpacing.toFixed(1)}`);
  
  const centerX = width / 2;
  const centerY = height / 2;
  
  // 获取地理中心
  let geoCenterLon, geoCenterLat;
  
  if (center && center.length === 2) {
    [geoCenterLon, geoCenterLat] = center;
  } else {
    let sumLon = 0, sumLat = 0, count = 0;
    for (const t of tags) {
      if (t.lon && t.lat) {
        sumLon += t.lon;
        sumLat += t.lat;
        count++;
      }
    }
    if (count > 0) {
      geoCenterLon = sumLon / count;
      geoCenterLat = sumLat / count;
    }
  }
  
  // Step 1: 处理每个标签
  const processed = tags.map((tag, index) => {
    let bearing = (index / tags.length) * 360;
    let distance = 100 + index * 10;
    
    if (geoCenterLon && geoCenterLat && tag.lon && tag.lat) {
      bearing = calculateBearing(geoCenterLon, geoCenterLat, tag.lon, tag.lat);
      distance = calculateDistance(geoCenterLat, geoCenterLon, tag.lat, tag.lon);
    }
    
    const fontSize = config.fontMin + (config.fontMax - config.fontMin) * Math.random();
    
    return {
      ...tag,
      bearing,
      distance,
      fontSize,
      width: measureText(tag.name || '', fontSize),
      ring: 0,
      x: centerX,
      y: centerY,
    };
  });
  
  // Step 2: 分配圈层
  const withRings = assignRings(processed, config.numRings);
  
  // Step 3: 按方位角和圈层放置初始位置
  // 在同一圈层内，按方位角均匀分布
  const ringGroups = {};
  withRings.forEach(tag => {
    if (!ringGroups[tag.ring]) ringGroups[tag.ring] = [];
    ringGroups[tag.ring].push(tag);
  });
  
  Object.entries(ringGroups).forEach(([ring, ringTags]) => {
    // 按方位角排序
    ringTags.sort((a, b) => a.bearing - b.bearing);
    
    const ringNum = parseInt(ring);
    const radius = config.centerMargin + ringNum * config.ringSpacing;
    
    ringTags.forEach((tag, i) => {
      // 在圈层上均匀分布，但保持相对方位
      const baseAngle = (tag.bearing - 90) * Math.PI / 180;
      // 添加微小偏移避免完全重叠
      const offset = (i * 0.1) * Math.PI / 180;
      
      tag.x = centerX + Math.cos(baseAngle + offset) * radius;
      tag.y = centerY + Math.sin(baseAngle + offset) * radius;
    });
  });
  
  // Step 4: 碰撞检测和推开
  resolveCollisions(withRings, config, config.iterations);
  
  // Step 5: 边界约束（允许一定的越界以保证所有标签可见）
  withRings.forEach(tag => {
    const margin = 5;
    const halfW = tag.width / 2;
    
    // 软约束：优先保持在容器内，但不强制裁剪
    tag.x = Math.max(halfW + margin, Math.min(width - halfW - margin, tag.x));
    tag.y = Math.max(tag.fontSize, Math.min(height - margin, tag.y));
  });
  
  // 构建结果
  const result = withRings.map(t => ({
    name: t.name,
    x: t.x,
    y: t.y,
    fontSize: t.fontSize,
    lon: t.lon,
    lat: t.lat,
    coordKey: t.coordKey,
    ring: t.ring,
    bearing: Math.round(t.bearing),
    distance: Math.round(t.distance),
  }));
  
  // 添加中心标记
  result.unshift({
    name: '中心位置',
    x: centerX,
    y: centerY,
    fontSize: 12,
    isCenter: true,
  });
  
  console.log(`[GravityWorker] 完成: 渲染 ${result.length} 个标签`);
  return result;
}

// Worker 入口
self.onmessage = function(e) {
  const data = e.data;
  console.log('[GravityWorker] 收到:', data.tags?.length, '个标签');
  
  try {
    const result = layoutTags(data);
    self.postMessage(result);
  } catch (err) {
    console.error('[GravityWorker] 错误:', err);
    self.postMessage([]);
  }
};
