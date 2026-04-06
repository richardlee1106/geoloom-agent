/**
 * V3 AI 服务模块 - 简化版前端
 *
 * 专为 V3-GeoEncoder-RAG 后端设计
 * 不依赖 V1 的复杂 SSE 事件（模糊边界、VLM timing 等）
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

import { AI_API_BASE_URL } from '../config';
import { validateSSEEventPayload } from '../../shared/sseEventSchema.js';

// V3 后端 API 基础路径
const V3_API_BASE = `${AI_API_BASE_URL}/api`;
const V3_META_EVENTS = new Set([
  'stage',
  'thinking',
  'reasoning',
  'intent_preview',
  'pois',
  'boundary',
  'spatial_clusters',
  'vernacular_regions',
  'fuzzy_regions',
  'stats',
  'partial',
  'progress',
  'refined_result',
  'done',
  'error'
]);

// 当前服务状态
let serviceStatus = {
  online: false,
  model: null,
  models: [],
};

/**
 * 检查 V3 服务状态
 */
export async function checkV3Service() {
  try {
    const response = await fetch(`${V3_API_BASE}/ai/status`);
    if (!response.ok) {
      serviceStatus.online = false;
      return false;
    }

    const data = await response.json();
    serviceStatus = {
      online: data.online,
      model: data.model,
      models: data.models || [],
      ollama: data.ollama,
    };

    console.log(`[V3 AI] 服务状态: ${data.online ? '在线' : '离线'}, 模型: ${data.model}`);
    return data.online;
  } catch (e) {
    console.debug('[V3 AI] 状态检查失败:', e.message);
    serviceStatus.online = false;
    return false;
  }
}

/**
 * 发送聊天消息（SSE 流式）
 *
 * @param {Array} messages - 消息历史 [{role, content}, ...]
 * @param {Function} onChunk - 文本块回调 (text: string) => void
 * @param {Object} options - 可选配置
 * @param {Array} poiFeatures - POI 数据（可选）
 * @param {Function} onMeta - 元数据回调 (type: string, data: any) => void
 * @returns {Promise<string>} 完整回复
 */
export async function sendV3ChatStream(messages, onChunk, options = {}, poiFeatures = [], onMeta = null) {
  const requestId =
    options?.requestId ||
    options?.request_id ||
    `v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log('[V3 AI] 发送聊天请求, 消息数:', messages.length);

  const response = await fetch(`${V3_API_BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      poiFeatures,
      options: { ...options, requestId },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`V3 AI 请求失败: ${response.status} - ${error}`);
  }

  // SSE 流式读取
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  let currentEvent = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
        continue;
      }

      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const eventType = String(parsed?.type || currentEvent || '').trim();
        const payload = parsed?.type ? extractEventPayload(parsed) : parsed;

        switch (eventType) {
          case 'meta': {
            if (onMeta) {
              onMeta('trace', {
                trace_id: payload?.traceId || payload?.trace_id || requestId,
                schema_version: payload?.schema_version || null,
                capabilities: Array.isArray(payload?.capabilities) ? payload.capabilities : null
              });
            }
            break;
          }

          case 'text': {
            if (payload?.content) {
              const visibleChunk = stripThinkTags(payload.content);
              if (visibleChunk) {
                fullContent += visibleChunk;
                onChunk(visibleChunk);
              }
            }
            break;
          }

          default: {
            if (!V3_META_EVENTS.has(eventType)) {
              currentEvent = null;
              break;
            }

            const validation = validateStructuredEvent(eventType, payload);
            if (!validation.ok) {
              if (onMeta) {
                onMeta('schema_error', {
                  event: eventType,
                  errors: validation.errors
                });
              }
              break;
            }

            if (eventType === 'error') {
              if (onMeta) onMeta('error', payload);
              const streamError = new Error(payload?.message || 'V3 AI 错误');
              streamError.name = 'V3AIStreamError';
              throw streamError;
            }

            if (onMeta) {
              onMeta(eventType, payload);
            }
            break;
          }
        }
      } catch (e) {
        if (e?.name === 'V3AIStreamError' || e.message.includes('V3')) throw e;
        console.warn('[V3 AI] 解析 SSE 失败:', e.message);
      } finally {
        currentEvent = null;
      }
    }
  }

  return fullContent;
}

/**
 * 发送空间查询（V3 核心功能）
 *
 * @param {string} query - 用户查询
 * @param {Object} options - 可选配置
 * @returns {Promise<{ answer: string, results: Array }>}
 */
export async function askV3(query, options = {}) {
  const topK = options.topK || 10;

  console.log('[V3 AI] 空间查询:', query);

  const response = await fetch(`${V3_API_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`V3 查询失败: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    answer: data.answer,
    results: data.results || [],
    intent: data.intent,
    pipeline: data.pipeline,
    totalDuration: data.total_duration_ms,
  };
}

/**
 * 获取当前服务状态
 */
export function getV3Status() {
  return { ...serviceStatus };
}

/**
 * 获取可用模型列表
 */
export async function getV3Models() {
  try {
    const response = await fetch(`${V3_API_BASE}/ai/models`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.models || [];
  } catch {
    return [];
  }
}

/**
 * 清理思考标签（Qwen3.5 推理模型）
 */
function stripThinkTags(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

function extractEventPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed

  if (parsed.payload !== undefined) {
    return parsed.payload
  }

  if (parsed.data !== undefined) {
    return parsed.data
  }

  const payload = { ...parsed }
  delete payload.type
  return payload
}

function validateStructuredEvent(eventType, payload) {
  if (eventType === 'thinking') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['$: expected object'] }
    }
    return { ok: true, errors: [] }
  }

  if (eventType === 'done') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['$: expected object'] }
    }
    return { ok: true, errors: [] }
  }

  if (eventType === 'reasoning') {
    if (!payload || typeof payload !== 'object' || typeof payload.content !== 'string') {
      return { ok: false, errors: ['$.content: expected string'] }
    }
    return { ok: true, errors: [] }
  }

  return validateSSEEventPayload(eventType, payload)
}

/**
 * 兼容 V1 aiService 的接口
 * 用于前端组件无缝切换
 */
export const v3Compat = {
  // 兼容 sendChatMessageStream
  sendChatMessageStream: sendV3ChatStream,

  // 兼容 checkAIService
  checkAIService: checkV3Service,

  // 兼容 getAvailableModels
  getAvailableModels: getV3Models,

  // 兼容 getCurrentProviderInfo
  getCurrentProviderInfo: () => ({
    id: 'v3-ollama',
    name: 'V3 GeoEncoder RAG',
    apiBase: V3_API_BASE,
    modelId: serviceStatus.model || 'qwen3.5-2b',
  }),
};

export default {
  checkV3Service,
  sendV3ChatStream,
  askV3,
  getV3Status,
  getV3Models,
  v3Compat,
};
