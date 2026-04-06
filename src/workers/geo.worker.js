/**
 * 地理感知标签云布局算法 (Geo-aware TagCloud Layout)
 * 
 * 核心原则：
 * 1. 方位保持：标签必须保持在相对于中心的正确象限（东南西北）
 * 2. 距离保持：标签距离中心的远近应反映地理距离
 * 3. ײ⣺ǩ֮䲻صײƻԼ
 * 4. 不依赖地图视图：完全基于经纬度计算，不受拖拽/缩放影响
 */

// OffscreenCanvas Polyfill
if (typeof self.document === 'undefined') {
    self.document = {
        createElement: (tagName) => {
            if (tagName === 'canvas') {
                return new OffscreenCanvas(1, 1);
            }
            return {};
        }
    };
}

self.onmessage = event => {
    const { tags, width, height, center, config } = event.data;
    runGeoLayout(tags, width, height, center, config);
};

/**
 * 主布局函数
 */
function runGeoLayout(tags, width, height, center, config) {
    if (!tags || tags.length === 0) {
        self.postMessage([]);
        return;
    }

    console.log('[GeoWorker] 开始地理布局，标签数量:', tags.length);

    // ============ 配置 ============
    const fontMin = config?.fontMin || 14;
    const fontMax = config?.fontMax || 18;
    const minGap = 2; // ǩ֮С϶

    // ============ 画布和测量 ============
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    const centerX = width / 2;
    const centerY = height / 2;
    const padding = 40; // 边缘留白

    // ============ 确定地理中心 ============
    let centerLon, centerLat;
    if (center && Array.isArray(center) && center.length === 2) {
        [centerLon, centerLat] = center;
    } else {
        // 计算质心
        let sumLon = 0, sumLat = 0, count = 0;
        tags.forEach(t => {
            if (t.lon !== undefined && t.lat !== undefined) {
                sumLon += t.lon;
                sumLat += t.lat;
                count++;
            }
        });
        centerLon = count > 0 ? sumLon / count : 0;
        centerLat = count > 0 ? sumLat / count : 0;
    }

    // ============ 创建中心标签 ============
    const centerTag = {
        name: '中心位置',
        isCenter: true,
        x: centerX,
        y: centerY,
        fontSize: fontMax + 4,
        originalIndex: -1,
        quadrant: 0, // 中心不属于任何象限
        geoAngle: 0,
        geoDistance: 0
    };
    ctx.font = `900 ${centerTag.fontSize}px sans-serif`;
    centerTag.width = Math.ceil(ctx.measureText(centerTag.name).width);
    centerTag.height = Math.ceil(centerTag.fontSize * 1.2);

    // ============ 预处理标签 ============
    // 计算每个标签的：地理角度、地理距离、目标象限
    
    // 经度校正因子（1度经度的实际距离随纬度变化）
    const latRad = centerLat * Math.PI / 180;
    const lonFactor = Math.cos(latRad);

    // 计算最大地理距离（用于归一化）
    let maxGeoDistance = 0;
    const tagsWithGeo = tags.map((tag, index) => {
        if (tag.lon === undefined || tag.lat === undefined) {
            return { ...tag, geoDistance: 0, geoAngle: 0, quadrant: 1 };
        }
        
        // 地理偏移（转换为近似米制比例）
        const dLon = (tag.lon - centerLon) * lonFactor;
        const dLat = tag.lat - centerLat;
        
        // 地理距离
        const geoDistance = Math.sqrt(dLon * dLon + dLat * dLat);
        if (geoDistance > maxGeoDistance) maxGeoDistance = geoDistance;
        
        // 地理角度（-PI 到 PI，0 为正东，逆时针为正）
        const geoAngle = Math.atan2(dLat, dLon);
        
        // 确定象限（1-4，对应数学象限定义）
        // 第一象限：x>0, y>0 (东北)
        // 第二象限：x<0, y>0 (西北)
        // 第三象限：x<0, y<0 (西南)
        // 第四象限：x>0, y<0 (东南)
        let quadrant;
        if (dLon >= 0 && dLat >= 0) quadrant = 1;      // 东北 → 屏幕右上
        else if (dLon < 0 && dLat >= 0) quadrant = 2;  // 西北 → 屏幕左上
        else if (dLon < 0 && dLat < 0) quadrant = 3;   // 西南 → 屏幕左下
        else quadrant = 4;                              // 东南 → 屏幕右下
        
        return {
            ...tag,
            geoDistance,
            geoAngle,
            quadrant,
            dLon,
            dLat,
            originalIndex: index
        };
    });

    if (maxGeoDistance === 0) maxGeoDistance = 1;

    // ============ 计算目标位置并测量尺寸 ============
    const availableRadius = Math.min(width, height) / 2 - padding;
    
    const processedTags = tagsWithGeo.map((tag, i) => {
        // 字体大小（距离近的稍大）
        const distanceRatio = 1 - (tag.geoDistance / maxGeoDistance);
        const fontSize = fontMin + distanceRatio * (fontMax - fontMin) * 0.3;
        
        ctx.font = `${fontSize}px sans-serif`;
        const textWidth = Math.ceil(ctx.measureText(tag.name).width);
        const textHeight = Math.ceil(fontSize * 1.2);
        
        // 目标位置：基于地理角度和距离
        const normalizedDistance = (tag.geoDistance / maxGeoDistance) * availableRadius * 0.9;
        
        // 屏幕坐标（注意 Y 轴反转：纬度增加 → 屏幕 Y 减少）
        const targetX = centerX + normalizedDistance * Math.cos(tag.geoAngle);
        const targetY = centerY - normalizedDistance * Math.sin(tag.geoAngle); // Y 反转
        
        return {
            ...tag,
            fontSize,
            width: textWidth,
            height: textHeight,
            targetX,
            targetY,
            x: targetX,
            y: targetY,
            placed: false
        };
    });

    // ============ 按权重或距离排序 ============
    // ȨأȨؽ򣨸Ȩȿģ
    // 否则按地理距离升序排序（近的先放）
    const hasWeights = processedTags.some(t => t.weight !== undefined && t.weight !== null && t.weight > 0);
    
    if (hasWeights) {
        processedTags.sort((a, b) => (b.weight || 0) - (a.weight || 0));
        console.log('[GeoWorker] 已按权重排序，前3个:', processedTags.slice(0, 3).map(t => `${t.name}(${(t.weight || 0).toFixed(1)})`).join(', '));
    } else {
        processedTags.sort((a, b) => a.geoDistance - b.geoDistance);
    }


    // ============ 碰撞检测与避让算法 ============
    // 已放置的标签列表（初始包含中心标签）
    const placedTags = [centerTag];
    const failedTags = [];

    for (const tag of processedTags) {
        const position = findValidPosition(tag, placedTags, centerX, centerY, minGap, width, height, padding);
        
        if (position) {
            tag.x = position.x;
            tag.y = position.y;
            tag.placed = true;
            placedTags.push(tag);
        } else {
            // 放置失败，尝试缩小字体重试
            tag.fontSize = fontMin * 0.8;
            ctx.font = `${tag.fontSize}px sans-serif`;
            tag.width = Math.ceil(ctx.measureText(tag.name).width);
            tag.height = Math.ceil(tag.fontSize * 1.2);
            
            const retryPosition = findValidPosition(tag, placedTags, centerX, centerY, minGap, width, height, padding);
            if (retryPosition) {
                tag.x = retryPosition.x;
                tag.y = retryPosition.y;
                tag.placed = true;
                placedTags.push(tag);
            } else {
                failedTags.push(tag);
            }
        }
    }

    console.log('[GeoWorker] 布局完成，成功:', placedTags.length - 1, '失败:', failedTags.length);

    // ============ 最终验证：确保象限正确 ============
    const results = placedTags.map(d => {
        // 验证象限（跳过中心标签）
        if (!d.isCenter && d.quadrant) {
            const isCorrectQuadrant = verifyQuadrant(d.x, d.y, centerX, centerY, d.quadrant);
            if (!isCorrectQuadrant) {
                console.warn('[GeoWorker] 象限错误，强制修正:', d.name);
                // 强制修正到正确象限
                const corrected = forceCorrectQuadrant(d, centerX, centerY);
                d.x = corrected.x;
                d.y = corrected.y;
            }
        }
        
        return {
            ...d,
            text: d.name,
            rotation: 0,
            placed: d.placed !== false
        };
    });

    self.postMessage(results);
}

/**
 * 寻找有效位置：保持象限约束的螺旋搜索
 */
function findValidPosition(tag, placedTags, cx, cy, minGap, canvasWidth, canvasHeight, padding) {
    const maxAttempts = 500;
    const spiralStep = 3; // 每步移动的像素
    
    // 从目标位置开始螺旋搜索
    let theta = 0;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        // 螺旋轨迹
        const r = spiralStep * theta / (2 * Math.PI);
        const offsetX = r * Math.cos(theta);
        const offsetY = r * Math.sin(theta);
        
        const testX = tag.targetX + offsetX;
        const testY = tag.targetY + offsetY;
        
        // 检查是否在正确象限
        if (!verifyQuadrant(testX, testY, cx, cy, tag.quadrant)) {
            theta += 0.3;
            attempt++;
            continue;
        }
        
        // 检查是否在画布范围内
        const halfW = tag.width / 2;
        const halfH = tag.height / 2;
        if (testX - halfW < padding || testX + halfW > canvasWidth - padding ||
            testY - halfH < padding || testY + halfH > canvasHeight - padding) {
            theta += 0.3;
            attempt++;
            continue;
        }
        
        // 检查碰撞
        if (!hasCollision(testX, testY, tag.width, tag.height, placedTags, minGap)) {
            return { x: testX, y: testY };
        }
        
        theta += 0.3;
        attempt++;
    }
    
    return null; // 未找到有效位置
}

/**
 * 验证位置是否在正确象限
 */
function verifyQuadrant(x, y, cx, cy, targetQuadrant) {
    // 屏幕坐标系：Y 向下为正
    // 地理坐标系：纬度向上为正
    // 转换：屏幕 Y < cy 对应地理北方
    
    const isRight = x >= cx;  // 东
    const isUp = y <= cy;     // 北（屏幕 Y 反转）
    
    switch (targetQuadrant) {
        case 1: return isRight && isUp;    // 东北 → 右上
        case 2: return !isRight && isUp;   // 西北 → 左上
        case 3: return !isRight && !isUp;  // 西南 → 左下
        case 4: return isRight && !isUp;   // 东南 → 右下
        default: return true;
    }
}

/**
 * 强制修正到正确象限
 */
function forceCorrectQuadrant(tag, cx, cy) {
    let x = tag.x;
    let y = tag.y;
    const offset = 5; // 最小偏移
    
    switch (tag.quadrant) {
        case 1: // 东北 → 右上
            if (x < cx) x = cx + offset;
            if (y > cy) y = cy - offset;
            break;
        case 2: // 西北 → 左上
            if (x >= cx) x = cx - offset;
            if (y > cy) y = cy - offset;
            break;
        case 3: // 西南 → 左下
            if (x >= cx) x = cx - offset;
            if (y <= cy) y = cy + offset;
            break;
        case 4: // 东南 → 右下
            if (x < cx) x = cx + offset;
            if (y <= cy) y = cy + offset;
            break;
    }
    
    return { x, y };
}

/**
 * 碰撞检测（矩形 AABB）
 */
function hasCollision(x, y, w, h, placedTags, gap) {
    const halfW = w / 2 + gap;
    const halfH = h / 2 + gap;
    
    for (const other of placedTags) {
        const otherHalfW = other.width / 2;
        const otherHalfH = other.height / 2;
        
        const dx = Math.abs(x - other.x);
        const dy = Math.abs(y - other.y);
        
        if (dx < halfW + otherHalfW && dy < halfH + otherHalfH) {
            return true; // 有碰撞
        }
    }
    
    return false;
}
