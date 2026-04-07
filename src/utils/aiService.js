/**
 * AI 服务模块 - 前端版本（调用后端 API）
 *
 * 所有敏感配置已移至后端，此模块仅负责：
 * 1. 调用后端 API 接口
 * 2. 处理流式响应
 * 3. 提供前端需要的辅助函数
 *
 * V3 模式：使用简化版 v3aiService
 */

// 后端 API 基础路径
import { AI_API_BASE_URL, SPATIAL_API_BASE_URL } from '../config';
import { validateSSEEventPayload } from '../../shared/sseEventSchema';
import { sendV3ChatStream, checkV3Service, getV3Models, getV3Status } from './v3aiService.js';

const BACKEND_VERSION = String(import.meta.env.VITE_BACKEND_VERSION || import.meta.env.MODE || '').toLowerCase();
const IS_V3_MODE = BACKEND_VERSION === 'v3';
const IS_V4_MODE = BACKEND_VERSION === 'v4';
const API_BASE = IS_V4_MODE ? `${AI_API_BASE_URL}/api/geo` : `${AI_API_BASE_URL}/api/ai`;

// V3 模式日志（仅在开发环境）
if (IS_V3_MODE && import.meta.env.DEV) {
  console.log('[AI Service] V3 模式已启用');
}
if (IS_V4_MODE && import.meta.env.DEV) {
  console.log('[AI Service] V4 模式已启用');
}

function createClientRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const random = Math.random().toString(36).slice(2, 10)
  return `web_${Date.now()}_${random}`
}

function formatTimingValueMs(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.round(num)
}

function extractModelTiming(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.model_timing_ms && typeof payload.model_timing_ms === 'object') {
    return payload.model_timing_ms
  }
  if (payload.results?.stats?.model_timing_ms && typeof payload.results.stats.model_timing_ms === 'object') {
    return payload.results.stats.model_timing_ms
  }
  if (payload.stats?.model_timing_ms && typeof payload.stats.model_timing_ms === 'object') {
    return payload.stats.model_timing_ms
  }
  return null
}

const REASONING_START_RE = /^(thinking process|thought process|reasoning process|思考过程|推理过程|分析步骤|分析过程|let'?s think)\s*[:：]?/i
const REASONING_HEADING_RE = /^(\d+\.\s*)?\*{0,2}\s*(analyze the request|evaluate data|evaluate data\s*&\s*constraints|drafting content|refining for tone|final polish|revised draft|final plan)\s*[:：]?/i
const REASONING_MARKERS = [
  'analyze the request',
  'evaluate data',
  'constraints',
  'drafting content',
  'refining for tone',
  'final polish',
  'revised draft',
  'final plan',
  'analyze',
  'evaluate',
  'draft',
  'refine'
]

function stripThinkTags(text = '') {
  let result = String(text || '')
    // 移除 XML 格式的思考标签
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    // 移除 <thinking> 标签
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    // 移除 ThinkingProcess: 开头的思考块
    .replace(/ThinkingProcess:\s*[\s\S]*?(?=\n\s*您好|\n\s*你好|\n\s*\*\*您好|\n\s*\*\*你好|$)/gi, '')
    // 移除 **Analyze...** 等标题开头的思考块
    .replace(/\*\*(Analyze|Evaluate|Draft|Refine|Final|Thinking|Reasoning)[\s\S]*?\*\*[\s\S]*?(?=\n\s*您好|\n\s*你好|\n\s*\*{0,2}您好|$)/gi, '')
    // 移除 "1. **Analyze the Request**" 等编号列表思考块
    .replace(/1\.\s*\*\*[Aa]nalyze[\s\S]*?(?=\n\s*您好|\n\s*你好|\n\s*\*{0,2}您好|\n\s*\*{0,2}你好|$)/gi, '')
    .trim()
  return result
}

function looksLikeReasoningTranscriptStart(text = '') {
  const probe = String(text || '').trimStart()
  if (!probe) return false
  return REASONING_START_RE.test(probe) || REASONING_HEADING_RE.test(probe)
}

function looksLikeReasoningContinuation(text = '') {
  const probe = String(text || '').trim()
  if (!probe) return true
  if (looksLikeReasoningTranscriptStart(probe)) return true

  const lowered = probe.toLowerCase()
  const markerHitCount = REASONING_MARKERS.reduce(
    (count, marker) => (lowered.includes(marker) ? count + 1 : count),
    0
  )
  if (markerHitCount >= 2) return true
  if (/^(\d+\.\s+|[-*]\s+)/.test(probe) && markerHitCount >= 1) return true
  return false
}

function sanitizeAssistantOutputText(text = '') {
  if (typeof text !== 'string') return ''
  const withoutThink = stripThinkTags(text)
  if (!withoutThink) return ''
  // 过滤常见”思考过程”前缀，防止渲染到用户界面。
  if (looksLikeReasoningTranscriptStart(withoutThink)) return ''
  return withoutThink
}

// 当前服务商信息（从后端获取）
let currentProvider = {
  online: false,
  provider: null,
  providerName: 'Unknown'
}

// 位置相关关键词（前端判断用，后端也会再次判断）
const LOCATION_KEYWORDS = [
  '距离', '最近', '附近', '周边', '临近', '相邻', '多远', '位置', '坐标',
  '公里', '米', '东', '西', '南', '北', '方向', '路线', '到达',
  '哪里', '在哪', '地址', '经纬度', '空间', '分布位置'
]

/**
 * 检测用户问题是否涉及位置/距离
 * @param {string} userMessage - 用户消息
 * @returns {boolean}
 */
export function isLocationRelatedQuery(userMessage) {
  if (!userMessage) return false
  return LOCATION_KEYWORDS.some(keyword => userMessage.includes(keyword))
}

/**
 * 根据名称查找 POI（支持模糊匹配）
 * @param {Array} features - POI 数组
 * @param {string} name - 要查找的名称
 * @returns {Object|null}
 */
export function findPOIByName(features, name) {
  if (!features || !name) return null
  
  // 精确匹配
  let found = features.find(f => {
    const poiName = f.properties?.['名称'] || f.properties?.name || ''
    return poiName === name
  })
  
  // 模糊匹配
  if (!found) {
    found = features.find(f => {
      const poiName = f.properties?.['名称'] || f.properties?.name || ''
      return poiName.includes(name) || name.includes(poiName)
    })
  }
  
  return found
}

/**
 * 计算两点间距离（Haversine 公式）
 * @param {Array} coord1 - [lon, lat]
 * @param {Array} coord2 - [lon, lat]
 * @returns {number} 距离（米）
 */
export function calculateDistance(coord1, coord2) {
  const R = 6371000 // 地球半径（米）
  const lat1 = coord1[1] * Math.PI / 180
  const lat2 = coord2[1] * Math.PI / 180
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  
  return R * c
}

/**
 * 格式化 POI 上下文（简化版，用于显示）
 * 实际处理已移至后端
 * @param {Array} features - GeoJSON Feature 数组
 * @param {string} userMessage - 用户消息
 * @returns {string}
 */
export function formatPOIContext(features, userMessage = '') {
  if (!features || features.length === 0) {
    return '当前没有选中任何 POI 数据。'
  }
  return `已选中 ${features.length} 个 POI 数据`
}

/**
 * 构建系统提示词（已移至后端，此函数仅为兼容性保留）
 * @param {string} poiContext - POI 上下文信息
 * @param {boolean} isLocationQuery - 是否为位置相关查询
 * @returns {string}
 */
export function buildSystemPrompt(poiContext, isLocationQuery = false) {
  // 实际 system prompt 在后端构建
  return ''
}

/**
 * 发送聊天请求（流式）- 调用后端 API
 * @param {Array} messages - 消息历史
 * @param {Function} onChunk - 每次收到新内容时的回调 (text: string) => void
 * @param {Object} options - 可选配置
 * @param {Array} poiFeatures - POI 数据（将发送到后端处理）
 * @returns {Promise<string>} 完整的 AI 回复
 */
/**
 * 发送聊天请求（流式）- 调用后端 API
 * @param {Array} messages - 消息历史
 * @param {Function} onChunk - 每次收到新内容时的回调 (text: string) => void
 * @param {Object} options - 可选配置
 * @param {Array} poiFeatures - POI 数据（将发送到后端处理）
 * @param {Function} onMeta - [新增] 接收元数据的回调 (type: string, data: any) => void
 * @returns {Promise<string>} 完整的 AI 回复
 */
export async function sendChatMessageStream(messages, onChunk, options = {}, poiFeatures = [], onMeta = null) {
  // 仅开发环境打印关键信息
  if (import.meta.env.DEV) {
    console.log('[AI] 发送请求, POI:', poiFeatures.length)
  }

  const requestId = options?.requestId || options?.request_id || createClientRequestId()
  const normalizedOptions = {
    ...options,
    requestId
  }

  if (IS_V3_MODE) {
    return sendV3ChatStream(messages, onChunk, normalizedOptions, poiFeatures, onMeta)
  }

  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages,
      poiFeatures,
      options: normalizedOptions
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI 请求失败: ${response.status} - ${error}`)
  }

  // ========== V1 完整模式 ==========

  // 获取当前使用的服务商
  const provider = response.headers.get('X-AI-Provider')
  const providerName = response.headers.get('X-AI-Provider-Name')
  const responseTraceId = response.headers.get('X-Trace-Id') || requestId
  if (provider) {
    currentProvider.provider = provider
    currentProvider.providerName = providerName || (provider === 'local' ? 'Local LM Studio' : 'Cloud AI (GLM)')
  }

  if (onMeta) {
    try {
      onMeta('trace', {
        trace_id: responseTraceId,
        request_id: requestId
      })
    } catch (metaErr) {
      console.error('[AI Meta Handler Error]', metaErr)
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''
  let currentEvent = null // 跟踪当前 SSE 事件类型
  let lastModelTimingSignature = null
  let hasTextOutput = false
  let suppressReasoningTranscript = false

  const consumeAssistantText = (rawText) => {
    const candidate = stripThinkTags(rawText)
    if (!candidate) return ''

    if (looksLikeReasoningTranscriptStart(candidate)) {
      suppressReasoningTranscript = true
      return ''
    }

    if (suppressReasoningTranscript) {
      if (looksLikeReasoningContinuation(candidate)) {
        return ''
      }
      suppressReasoningTranscript = false
    }

    return candidate
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue // 跳过空行

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }

      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        const eventType = currentEvent

        try {
          // 统一处理具名 SSE 元事件（查表模式，消除重复分支）
          const META_EVENT_TYPES = new Set([
            'pois', 'stage', 'boundary', 'spatial_clusters',
            'vernacular_regions', 'fuzzy_regions', 'stats', 'progress',
            'partial', 'refined_result', 'schema_error', 'error'
          ])

          if (eventType && META_EVENT_TYPES.has(eventType)) {
            const payload = JSON.parse(data)
            if (eventType === 'refined_result' && typeof payload?.answer === 'string') {
              payload.answer = sanitizeAssistantOutputText(payload.answer)
            }
            const validation = validateSSEEventPayload(eventType, payload)
            if (!validation.ok && import.meta.env.DEV) {
              console.warn('[AI] SSE schema mismatch:', eventType, validation.errors.slice(0, 3))
            }
            if (!validation.ok) {
              if (onMeta) {
                try {
                  onMeta('schema_error', {
                    event: eventType,
                    errors: validation.errors,
                    trace_id: responseTraceId
                  })
                } catch (metaErr) {
                  // 静默处理
                }
              }
              currentEvent = null
              continue
            }
            // 仅开发环境打印阶段更新
            if (import.meta.env.DEV && eventType === 'stage') {
              console.log('[AI] Stage:', payload.name)
            }
            // 错误日志始终打印
            if (eventType === 'error') {
              console.error('[AI] Error:', payload?.message || payload)
            }
            if (eventType === 'stats' || eventType === 'refined_result') {
              const timing = extractModelTiming(payload)
              if (timing && import.meta.env.DEV) {
                const vlmMs = formatTimingValueMs(timing.vlm_ms)
                const llmMs = formatTimingValueMs(timing.llm_ms)
                const wallMs = formatTimingValueMs(timing.parallel_wall_ms)
                const budgetMs = formatTimingValueMs(timing.budget_ms || 5000)
                const signature = `${vlmMs}|${llmMs}|${wallMs}|${budgetMs}`
                if (signature !== lastModelTimingSignature) {
                  console.log(`[ModelTiming] VLM=${vlmMs}ms LLM=${llmMs}ms WALL=${wallMs}ms BUDGET=${budgetMs}ms`)
                  lastModelTimingSignature = signature
                }
              }
            }
            if (onMeta) {
              try {
                if (payload && typeof payload === 'object' && !Array.isArray(payload) && !payload.trace_id) {
                  payload.trace_id = responseTraceId
                }
                onMeta(eventType, payload)
              } catch (metaErr) {
                // 静默处理
              }
            }
            if (eventType === 'refined_result') {
              const answerText = consumeAssistantText(
                typeof payload?.answer === 'string' ? payload.answer : ''
              )
              if (!hasTextOutput && answerText.trim()) {
                fullContent += answerText
                hasTextOutput = true
                onChunk(answerText)
              }
            }
            if (eventType === 'error') {
              const backendErrorMessage = payload?.message || '空间分析失败'
              throw new Error(String(backendErrorMessage))
            }
            currentEvent = null
            continue
          }


          // 默认为 message chunk
          const parsed = JSON.parse(data)
          
          // 如果后端直接发的 { content: '...' } 格式 (index.js 修改后)
          if (parsed.content !== undefined) {
             const delta = consumeAssistantText(parsed.content)
             if (!delta) continue
             fullContent += delta
             hasTextOutput = true
             onChunk(delta)
             continue
          }

          // 兼容 OpenAI 格式
          const choice = parsed.choices?.[0]
          const delta = consumeAssistantText(choice?.delta?.content || choice?.text || '')
          
          if (delta) {
             fullContent += delta
             hasTextOutput = true
             onChunk(delta)
          } else if (parsed.error) {
             console.error('[AI Stream Error]', parsed.error)
             onChunk(`\n[系统错误: ${parsed.error.message || '未知错误'}]\n`)
          }
        } catch (e) {
          if (eventType === 'error') {
            throw e
          }
          console.warn('[AI Stream Parse Error]', e, line)
        }
        // 重置 event（通常 event 只对下一行 data 有效）
        currentEvent = null
      }
    }
  }

  fullContent = sanitizeAssistantOutputText(fullContent)
  return fullContent
}

/**
 * 发送聊天请求（非流式）- 兼容性保留
 * @param {Array} messages - 消息历史 [{role, content}, ...]
 * @param {Object} options - 可选配置
 * @returns {Promise<string>} AI 回复内容
 */
export async function sendChatMessage(messages, options = {}) {
  let result = ''
  await sendChatMessageStream(messages, (chunk) => {
    result += chunk
  }, options)
  return result
}

/**
 * 快速搜索（简单名词查询，绕过 LLM）
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 搜索选项
 * @returns {Promise<{ success: boolean, isComplex: boolean, pois: Array }>}
 */
export async function quickSearch(keyword, options = {}) {
  if (IS_V4_MODE) {
    return {
      success: false,
      isComplex: true,
      error: 'standalone_v4_routes_all_search_to_agent',
      pois: []
    };
  }

  const { spatialContext, colorIndex = 0 } = options;
  const kw = keyword.trim();

  // 构建查询参数
  const params = new URLSearchParams({ q: kw, limit: '100' });

  // ========== 核心业务逻辑 ==========
  // 1. 选择/圆形选区优先
  // 2. 无选区 → 使用当前地图视野 (viewport) 作为边界
  // 3. 禁止无约束全库扫描

  let hasGeometry = false;

  // 优先级1: 用户绘制的多边形选区
  if (spatialContext?.boundary && spatialContext.boundary.length >= 3) {
    const points = spatialContext.boundary;
    const closedPoints = [...points];
    // 确保多边形闭合
    if (points[0][0] !== points[points.length-1][0] || points[0][1] !== points[points.length-1][1]) {
      closedPoints.push(points[0]);
    }
    const wktPoints = closedPoints.map(p => `${p[0]} ${p[1]}`).join(', ');
    params.set('geometry', `POLYGON((${wktPoints}))`);
    hasGeometry = true;
  }
  // 优先级2: 地图视野 bbox
  else if (spatialContext?.viewport && Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) {
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport;
    // 将 bbox 转换为 WKT Polygon
    const bboxWkt = `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`;
    params.set('geometry', bboxWkt);
    hasGeometry = true;
  }

  // 添加中心点（用于距离排序）
  if (spatialContext?.center) {
    params.set('lat', spatialContext.center.lat);
    params.set('lon', spatialContext.center.lon);
  } else if (spatialContext?.viewport) {
    // 使用视野中心
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport;
    params.set('lat', ((minLat + maxLat) / 2).toString());
    params.set('lon', ((minLon + maxLon) / 2).toString());
  }

  // 如果没有空间约束，返回空结果
  if (!hasGeometry) {
    return {
      success: true,
      isComplex: false,
      pois: [],
      warning: '请先绘制选区或确保地图视野有效'
    };
  }

  try {
    const response = await fetch(`${SPATIAL_API_BASE_URL}/api/search/quick?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`搜索失败: ${response.status}`);
    }

    const data = await response.json();

    // 如果后端判断是复杂查询，返回标记
    if (data.isComplex) {
      return {
        success: true,
        isComplex: true,
        pois: []
      };
    }
    
    // 设置颜色索引
    const pois = (data.pois || []).map(poi => {
      if (poi.properties) {
        poi.properties._groupIndex = colorIndex;
      }
      return poi;
    });

    return {
      success: true,
      isComplex: false,
      expandedTerms: data.expandedTerms,
      pois
    };
  } catch (err) {
    console.error('[QuickSearch] 错误:', err);
    return {
      success: false,
      isComplex: false,
      error: err.message,
      pois: []
    };
  }
}

/**
 * 智能语义搜索 - 自动路由到快速搜索或 RAG Pipeline
 * @param {string} keyword - 用户搜索关键词
 * @param {Array} features - (已弃用，保留参数兼容性)
 * @param {Object} options - 可选配置 { spatialContext: ..., colorIndex: ... }
 * @returns {Promise<{ pois: Array, isComplex: boolean, needsAiAssistant: boolean }>}
 */
export async function semanticSearch(keyword, features = [], options = {}) {
  if (!keyword || !keyword.trim()) {
    return { pois: [], isComplex: false, needsAiAssistant: false };
  }

  if (IS_V4_MODE) {
    return {
      pois: [],
      isComplex: true,
      needsAiAssistant: true
    };
  }

  const kw = keyword.trim();

  // 1. 先尝试快速搜索
  const quickResult = await quickSearch(kw, options);

  // 2. 如果后端判断是复杂查询，需要走 AI 助手
  if (quickResult.isComplex) {
    return {
      pois: [],
      isComplex: true,
      needsAiAssistant: true
    };
  }

  // 3. 快速搜索成功
  if (quickResult.success && quickResult.pois.length > 0) {
    return {
      pois: quickResult.pois,
      isComplex: false,
      needsAiAssistant: false,
      expandedTerms: quickResult.expandedTerms
    };
  }
  
  // 4. 快速搜索无结果，降级到 RAG Pipeline
  console.log(`[AI Search] 快速搜索无结果，尝试 RAG Pipeline`);

  let matchedPOIs = [];

  // 复用 RAG 管道进行搜索
  await sendChatMessageStream(
    [{ role: 'user', content: kw }],
    (chunk) => {
       // 忽略文本响应流，只关注结果
    },
    {
      ...options,
      isSearchOnly: true // 标记为纯搜索模式
    },
    [], // 不传前端 POI，强制走后端检索
    (type, data) => {
      if (type === 'pois' && Array.isArray(data)) {
         matchedPOIs = data;
      }
    }
  );

  // 转换为 GeoJSON Feature 格式 (如果后端返回的是 raw object)
  const pois = matchedPOIs.map(p => {
    // 如果已经是 Feature 结构就不动，否则包装一下
    if (p.type === 'Feature') {
        // 确保颜色正确
        if (!p.properties) p.properties = {};
        p.properties._groupIndex = options.colorIndex !== undefined ? options.colorIndex : 0;
        return p;
    }
    
    return {
       type: 'Feature',
       properties: {
          id: p.id,
          '名称': p.name,
          '小类': p.category || p.category_small || p.category_mid || p.category_big || p.type || '未分类',
          '地址': p.address,
          // 0 = 红色(默认), 4 = 紫色(AI推荐)
          _groupIndex: options.colorIndex !== undefined ? options.colorIndex : 0 
       },
       geometry: {
          type: 'Point',
          coordinates: [p.lon, p.lat]
       }
    };
  });
  
  return {
    pois,
    isComplex: false,
    needsAiAssistant: false
  };
}

/**
 * 检查 AI 服务可用性 - 调用后端 API
 * @returns {Promise<boolean>}
 */
export async function checkAIService() {
  try {
    if (IS_V3_MODE) {
      const online = await checkV3Service()
      const status = getV3Status()
      currentProvider = {
        online,
        provider: 'v3-ollama',
        providerName: 'V3 GeoEncoder RAG',
        model: status.model || 'qwen3.5-2b'
      }
      return online
    }

    if (IS_V4_MODE) {
      const response = await fetch(`${API_BASE}/health`)
      if (!response.ok) {
        currentProvider.online = false
        return false
      }

      const data = await response.json()
      currentProvider = {
        online: true,
        provider: data?.llm?.provider || 'geoloom-v4',
        providerName: data?.provider_ready
          ? `GeoLoom V4 (${data?.llm?.provider || 'provider_ready'})`
          : 'GeoLoom V4 (degraded)',
        model: data?.llm?.model || 'fallback',
        providerReady: data?.provider_ready === true,
        health: data
      }
      return true
    }

    const response = await fetch(`${API_BASE}/status`)
    if (!response.ok) {
      currentProvider.online = false
      return false
    }

    const data = await response.json()

    // V1 模式
    currentProvider = data
    return data.online
  } catch (e) {
    currentProvider.online = false
    return false
  }
}

/**
 * 获取当前服务商信息
 */
export function getCurrentProviderInfo() {
  // V3 模式
  if (IS_V3_MODE) {
    return {
      id: currentProvider.provider || 'v3-ollama',
      name: currentProvider.providerName || 'V3 GeoEncoder RAG',
      apiBase: API_BASE,
      modelId: currentProvider.model || 'qwen3.5-2b'
    }
  }
  if (IS_V4_MODE) {
    return {
      id: currentProvider.provider || 'geoloom-v4',
      name: currentProvider.providerName || 'GeoLoom V4',
      apiBase: API_BASE,
      modelId: currentProvider.model || 'fallback'
    }
  }
  // V1 模式
  return {
    id: currentProvider.provider,
    name: currentProvider.providerName,
    apiBase: API_BASE,
    modelId: currentProvider.provider === 'local' ? 'qwen3.5-2b' : 'mimo-v2-flash'
  }
}

/**
 * 获取可用模型列表 - 调用后端 API
 * @returns {Promise<Array>}
 */
export async function getAvailableModels() {
  try {
    if (IS_V3_MODE) {
      return getV3Models()
    }

    if (IS_V4_MODE) {
      if (!currentProvider.model) {
        await checkAIService()
      }
      return currentProvider.model
        ? [{ id: currentProvider.model, name: currentProvider.model }]
        : []
    }

    const response = await fetch(`${API_BASE}/models`)
    if (!response.ok) return []
    const data = await response.json()

    return data.models || []
  } catch {
    return []
  }
}
