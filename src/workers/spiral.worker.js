// ============================================================================
// Web Worker 中 OffscreenCanvas 的 Polyfill
// ============================================================================
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
    const { tags, width, height, config: userConfig } = event.data;
    runSpiralLayout(tags, width, height, userConfig);
};

// 阿基米德螺旋算法（高级布局）
function runSpiralLayout(tags, width, height, configOverrides) {
    if (!tags || tags.length === 0) {
        self.postMessage([]);
        return;
    }

    console.log('[Worker] Running Spiral Layout');

    const config = {
        fontMin: 18,
        fontMax: 22,
        minGap: 5,
        density: 1.0,
        spiralB: 20,
        angleStep: 0.3,
        ...configOverrides
    };

    const centerX = width / 2;
    const centerY = height / 2;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 检测是否有权重数据，并计算最大权重用于归一化
    const hasWeights = tags.some(t => t.weight !== undefined && t.weight !== null && t.weight > 0);
    let maxWeight = 1;
    if (hasWeights) {
        maxWeight = Math.max(...tags.map(t => t.weight || 0), 1);
        console.log('[Worker Spiral] 检测到权重数据, 最大权重:', maxWeight);
    }

    const processedTags = tags.map((tag, index) => {
        const totalTags = tags.length;
        let fontSize;

        if (hasWeights && tag.weight !== undefined && tag.weight !== null) {
            // 使用实际最大权重进行归一化
            const w = Math.min(1, Math.max(0, tag.weight / maxWeight));
            fontSize = config.fontMin + w * (config.fontMax - config.fontMin);
        } else {
            const normalizedIndex = index / Math.max(1, totalTags - 1);
            const sizeRatio = 1 - Math.pow(normalizedIndex, 0.5);
            fontSize = config.fontMin + sizeRatio * (config.fontMax - config.fontMin);
        }

        ctx.font = `${fontSize}px sans-serif`;
        const metrics = ctx.measureText(tag.name);
        const textWidth = Math.ceil(metrics.width);
        const textHeight = Math.ceil(fontSize * 1.2);

        return {
            ...tag,
            text: tag.name,
            fontSize: fontSize,
            width: textWidth,
            height: textHeight,
            x: 0,
            y: 0,
            placed: false,
            rotation: 0
        };
    });

    // ȨؽȨأС
    if (hasWeights) {
        processedTags.sort((a, b) => (b.weight || 0) - (a.weight || 0));
        console.log('[Worker Spiral] 已按权重排序, 前3个:', processedTags.slice(0, 3).map(t => `${t.name}(${(t.weight || 0).toFixed(1)})`).join(', '));
    } else {
        processedTags.sort((a, b) => b.fontSize - a.fontSize);
    }


    const placedTags = [];
    let failedCount = 0;
    const failedSamples = [];

    for (const tag of processedTags) {
        const position = findBestPosition(tag, placedTags, centerX, centerY, width, height, config);

        if (position) {
            tag.x = position.x;
            tag.y = position.y;
            tag.placed = true;
            placedTags.push(tag);
        } else {
            failedCount++;
            if (failedSamples.length < 3) {
                failedSamples.push(tag.name);
            }
        }
    }

    if (failedCount > 0) {
        console.warn('[Worker] Spiral: 有标签未能放置', {
            failedCount,
            total: processedTags.length,
            samples: failedSamples
        });
    }

    console.log('[Worker] Spiral Layout complete. Placed:', placedTags.length, 'Failed:', failedCount, 'Total:', processedTags.length);
    self.postMessage(placedTags);
}

// 寻找最佳位置的核心函数
// ö׶ԣ𲽼СԳԷñǩӶʵֽղ

function findBestPosition(tag, placedTags, centerX, centerY, canvasWidth, canvasHeight, config) {
    const originalMinGap = config.minGap;
    const maxAttempts = 100000;
    const maxRadius = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) * 5;

    // ׶Σ𲽼С minGapСࣩ
    // ڵǰ޷ãԸСļֱ࣬ﵽСֵ
    // 这种策略允许在布局外围或拥挤区域以更紧密的间距放置标签
    const searchPhases = [
        { factor: 1.0, maxAttempts: maxAttempts }, // 阶段 1：标准间距
        { factor: 0.8, maxAttempts: maxAttempts }, // 阶段 2：80% 间距
        { factor: 0.6, maxAttempts: maxAttempts }, // 阶段 3：60% 间距
        { factor: 0.4, maxAttempts: maxAttempts }, // 阶段 4：40% 间距
        { factor: 0.2, maxAttempts: maxAttempts }  // 阶段 5：20% 间距
    ];

    for (const phase of searchPhases) {
        const currentMinGap = originalMinGap * phase.factor;
        let theta = 0;

        const a = 0;
        const b = config.spiralB;
        const density = config.density;
        const angleStep = 0.1;

        for (let i = 0; i < phase.maxAttempts; i++) {
            // 阿基米德螺旋线公式: r = a + b * theta
            // 引入 density 参数来控制螺旋线的疏密
            const r = a + (b * theta / density);

            if (r > maxRadius) {
                break;
            }

            const x = centerX + r * Math.cos(theta);
            const y = centerY + r * Math.sin(theta);

            // 检查碰撞
            // 如果当前位置没有与已放置的标签发生碰撞，则认为找到了有效位置
            if (!checkCollision(tag, x, y, placedTags, currentMinGap)) {
                return { x, y };
            }

            theta += angleStep;
        }
    }

    return null;
}

// 碰撞检测函数
// 检查新标签的包围盒是否与任何已放置标签的包围盒重叠
function checkCollision(newTag, x, y, placedTags, minGap) {
    // 计算新标签的包围盒（考虑 minGap）
    const newRect = {
        left: x - newTag.width / 2 - minGap,
        right: x + newTag.width / 2 + minGap,
        top: y - newTag.height / 2 - minGap,
        bottom: y + newTag.height / 2 + minGap
    };

    for (const placedTag of placedTags) {
        const placedRect = {
            left: placedTag.x - placedTag.width / 2,
            right: placedTag.x + placedTag.width / 2,
            top: placedTag.y - placedTag.height / 2,
            bottom: placedTag.y + placedTag.height / 2
        };

        if (!(newRect.right < placedRect.left ||
            newRect.left > placedRect.right ||
            newRect.bottom < placedRect.top ||
            newRect.top > placedRect.bottom)) {
            return true;
        }
    }
    return false;
}
