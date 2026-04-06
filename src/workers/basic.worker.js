import RBush from 'rbush';

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
    runDynamicGravityLayout(tags, width, height, userConfig);
};

// 动态重心算法（基础布局）
function runDynamicGravityLayout(tags, width, height, configOverrides) {
    if (!tags || tags.length === 0) {
        self.postMessage([]);
        return;
    }

    console.log('[Worker] Running Dynamic Gravity Layout');

    const config = {
        fontMin: 18,
        fontMax: 22,
        padding: 2, // 最小间距
        spiralStep: 5, // 紧凑布局的小步长
        ...configOverrides
    };

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. 预处理：测量和计算字体大小
    // 如果有权重，先找出最大权重用于归一化
    const hasWeights = tags.some(t => t.weight !== undefined && t.weight !== null && t.weight > 0);
    let maxWeight = 1;
    if (hasWeights) {
        maxWeight = Math.max(...tags.map(t => t.weight || 0), 1);
        console.log('[Worker] 检测到权重数据, 最大权重:', maxWeight);
    }

    const processedTags = tags.map((tag, index) => {
        const totalTags = tags.length;
        let fontSize;

        if (hasWeights && tag.weight !== undefined && tag.weight !== null) {
            // 使用实际最大权重进行归一化（0-1 范围）
            const w = Math.min(1, Math.max(0, tag.weight / maxWeight));
            fontSize = config.fontMin + w * (config.fontMax - config.fontMin);
        } else {
            // 无权重时，按索引位置线性分配字体大小
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
            rotation: 0 // 基础布局不旋转
        };
    });

    // ȨؽȨأС
    // 这确保高权重的标签优先放置在中心位置
    if (hasWeights) {
        processedTags.sort((a, b) => (b.weight || 0) - (a.weight || 0));
        console.log('[Worker] 已按权重排序, 前3个:', processedTags.slice(0, 3).map(t => `${t.name}(${(t.weight || 0).toFixed(1)})`).join(', '));
    } else {
        processedTags.sort((a, b) => b.fontSize - a.fontSize);
    }


    // 2. 状态定义
    const placedTags = [];
    // 使用 RBush 空间索引树来加速碰撞检测
    const tree = new RBush();
    let currentCentroid = { x: width / 2, y: height / 2 };

    // 3. 核心循环：逐个放置标签
    let failedCount = 0;
    const failedSamples = [];

    for (let i = 0; i < processedTags.length; i++) {
        const tag = processedTags[i];

        // 确定搜索起点
        // 第一个词放置在画布中心，后续词放置在当前已放置词的重心位置
        const startX = i === 0 ? width / 2 : currentCentroid.x;
        const startY = i === 0 ? height / 2 : currentCentroid.y;

        // 径向搜索（寻找最近的无碰撞位置）
        const position = findPositionRadial(tag, startX, startY, tree, config, width, height);

        if (position) {
            tag.x = position.x;
            tag.y = position.y;
            tag.placed = true;

            // 更新状态
            placedTags.push(tag);

            // 将新放置的标签插入 RBush 索引树
            // 插入格式为 {minX, minY, maxX, maxY} 的包围盒
            const item = {
                minX: tag.x - tag.width / 2 - config.padding,
                minY: tag.y - tag.height / 2 - config.padding,
                maxX: tag.x + tag.width / 2 + config.padding,
                maxY: tag.y + tag.height / 2 + config.padding,
                tag: tag
            };
            tree.insert(item);

            // ¼ģƽ
            // Ļ±ǩļƶǩµľۼ
            // 公式: newCx = (oldCx * n + currentWordCx) / (n + 1)
            if (i === 0) {
                currentCentroid = { x: tag.x, y: tag.y };
            } else {
                const n = placedTags.length - 1;
                currentCentroid.x = (currentCentroid.x * n + tag.x) / (n + 1);
                currentCentroid.y = (currentCentroid.y * n + tag.y) / (n + 1);
            }
        } else {
            failedCount++;
            if (failedSamples.length < 3) {
                failedSamples.push(tag.name);
            }
        }
    }

    if (failedCount > 0) {
        console.warn('[Worker] Basic: 有标签未能放置', {
            failedCount,
            total: processedTags.length,
            samples: failedSamples
        });
    }

    console.log('[Worker] Basic Layout complete. Placed:', placedTags.length, 'Total:', processedTags.length);
    self.postMessage(placedTags);
}

function findPositionRadial(tag, startX, startY, tree, config, canvasWidth, canvasHeight) {
    const step = config.spiralStep;
    let theta = 0;
    const maxRadius = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) * 5;

    while (true) {
        // 螺旋轨迹公式: r = step * theta
        // 随着角度 theta 增加，半径 r 线性增加，形成阿基米德螺旋线
        const r = step * theta;

        if (r > maxRadius) break;

        const x = startX + r * Math.cos(theta);
        const y = startY + r * Math.sin(theta);

        // 构建候选位置的包围盒（包含 padding）
        const minX = x - tag.width / 2 - config.padding;
        const minY = y - tag.height / 2 - config.padding;
        const maxX = x + tag.width / 2 + config.padding;
        const maxY = y + tag.height / 2 + config.padding;

        const candidateBox = { minX, minY, maxX, maxY };

        // 使用 RBush 进行高效的碰撞检测
        // tree.collides 检查候选框是否与树中任何已存在的框重叠
        if (!tree.collides(candidateBox)) {
            return { x, y };
        }

        // 增加 theta（步长），继续沿螺旋线向外搜索
        theta += 0.1;
    }
    return null;
}
