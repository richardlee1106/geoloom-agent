<template>
  <div class="ai-chat-container">
    <!-- 头部状态栏 -->
    <div class="chat-header">
      <div class="header-main-row">
        <!-- 左侧：头像 + 信息 -->
        <div class="header-left">
          <div class="ai-avatar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </div>
          <div class="header-info">
            <span class="ai-name">GeoAI 助手</span>
            <div class="header-status-row">
              <span class="ai-status" :class="{ online: isOnline === true, offline: isOnline === false, probing: isOnline === null }">
                {{ statusText }}
              </span>
              <div class="location-meta-pill compact" :class="`is-${userLocationSummary.tone}`">
                <span class="location-meta-label">{{ userLocationSummary.label }}</span>
                <small class="location-meta-detail">{{ compactLocationDetail }}</small>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 右侧：按钮组 -->
        <div class="header-actions">
           <!-- POI 徽章（在按钮组左侧，空间不足时可隐藏） -->
           <div class="poi-badge" v-if="poiCount > 0">
             <span class="poi-icon">📍</span>
             <span>{{ poiCount }}</span>
           </div>

           <button
             class="action-btn location-btn"
             :class="`is-${userLocationSummary.tone}`"
             :disabled="userLocationStatus === 'locating'"
             @click="emit('request-current-location')"
             :title="userLocationSummary.detail"
            >
             <span class="location-btn-icon">
               <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                 <path d="M12 21s-6-4.35-6-10a6 6 0 1112 0c0 5.65-6 10-6 10z" />
                 <circle cx="12" cy="11" r="2.5" />
               </svg>
             </span>
             <span class="location-btn-label">{{ userLocationStatus === 'locating' ? '定位中' : locationActionLabel }}</span>
           </button>

           <button class="action-btn clear-btn" @click="clearChat" title="清空">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
             </svg>
           </button>
           <button class="action-btn save-btn" @click="saveChatHistory" title="保存">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
             </svg>
           </button>
           <button
             class="action-btn refresh-btn"
             :class="{ active: forceRecomputeNext }"
             @click="toggleForceRecompute"
             :title="forceRecomputeNext ? 'Force recompute on next query (enabled)' : 'Force recompute on next query (skip cache)'"
           >
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M21 12a9 9 0 1 1-2.64-6.36" />
               <polyline points="21 3 21 9 15 9" />
             </svg>
           </button>
           <button class="action-btn close-btn" @click="emit('close')" title="收起">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M18 6L6 18M6 6l12 12" />
             </svg>
           </button>
         </div>
       </div>

     </div>

    <div class="chat-body">
      <div class="chat-messages" ref="messagesContainer">
        <!-- 欢迎消息 -->
        <div v-if="messages.length === 0" class="welcome-message">
          <section class="welcome-shell">
            <div class="welcome-hero">
              <div class="welcome-heading-row">
                <div class="welcome-kicker">
                  <span class="kicker-dot"></span>
                  <span>GeoAI 助手</span>
                </div>
                <span class="welcome-route-pill" :class="`is-${reasoningRouteTone}`">
                  {{ reasoningRouteLabel }}
                </span>
              </div>
              <div class="welcome-title-row">
                <h3>问地点、周边和选址</h3>
                <span class="welcome-location-note" :class="`is-${userLocationSummary.tone}`">
                  {{ userLocationSummary.label }}
                </span>
              </div>
              <p>
                默认按问题里的地点和当前地图范围来推理；如果要按你的位置来问，点头部“{{ locationActionLabel }}”。
              </p>
              <div class="welcome-meta-strip">
                <div
                  v-for="stat in welcomeContextStats"
                  :key="stat.label"
                  class="welcome-meta-chip"
                  :class="`is-${stat.tone}`"
                >
                  <span class="meta-chip-label">{{ stat.label }}</span>
                  <strong class="meta-chip-value">{{ stat.value }}</strong>
                </div>
              </div>
              <div class="welcome-formula">
                <span class="formula-label">输入公式</span>
                <p class="formula-text">地点 + 空间关系 + 需求，例如“湖北大学附近有哪些地铁站？”。</p>
              </div>
            </div>

            <div class="welcome-command-grid">
              <div class="welcome-section welcome-section-compact">
                <div class="welcome-section-head compact">
                  <div>
                    <span class="welcome-section-kicker">常用入口</span>
                    <h4>一键起手</h4>
                  </div>
                  <p>点一下就直接发送。</p>
                </div>

                <div class="scenario-list compact">
                  <button
                    v-for="action in welcomePrimaryScenarios"
                    :key="action.title"
                    type="button"
                    class="scenario-card compact"
                    :class="`accent-${action.accent}`"
                    @click="sendQuickAction(action.prompt)"
                  >
                    <span class="scenario-badge">{{ action.badge }}</span>
                    <strong class="scenario-title">{{ action.title }}</strong>
                  </button>
                </div>
              </div>

              <div class="welcome-section welcome-examples welcome-section-compact">
                <div class="welcome-section-head compact">
                  <div>
                    <span class="welcome-section-kicker">示例问法</span>
                    <h4>直接开问</h4>
                  </div>
                  <p>也可以改几个词继续追问。</p>
                </div>
                <div class="example-list compact">
                  <button
                    v-for="example in welcomeExamples"
                    :key="example.label"
                    type="button"
                    class="example-chip"
                    @click="sendQuickAction(example.prompt)"
                  >
                    {{ example.label }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- 消息列表 -->
        <div v-for="(msg, index) in messages" :key="index" class="message" :class="msg.role">
          <div class="message-avatar">
            <template v-if="msg.role === 'user'">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </template>
            <template v-else>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </template>
          </div>
          <div class="message-content">
            <div
              v-if="shouldShowPipelineForMessage(msg, index)"
              class="pipeline-tracker-inline"
            >
              <div class="pipeline-trace-inline">
                <template v-for="(step, idx) in stageSteps" :key="step.key">
                  <div
                    class="trace-step-inline"
                    :class="{
                      active: !msg.pipelineCompleted && getPipelineStageIndexForMessage(msg, index) === idx,
                      completed: msg.pipelineCompleted || getPipelineStageIndexForMessage(msg, index) > idx
                    }"
                  >
                    <div class="step-icon-wrapper">
                      <svg v-if="!msg.pipelineCompleted && getPipelineStageIndexForMessage(msg, index) === idx" class="step-spinner" viewBox="0 0 24 24" width="14" height="14">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="32" stroke-linecap="round"/>
                      </svg>
                      <svg v-else-if="msg.pipelineCompleted || getPipelineStageIndexForMessage(msg, index) > idx" class="step-check" viewBox="0 0 16 16" width="12" height="12">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                      </svg>
                      <span v-else class="step-number">{{ idx + 1 }}</span>
                    </div>
                  <span class="step-label-inline">{{ step.label }}</span>
                </div>
              </template>
            </div>
              <div
                v-if="msg.intentPreview && (msg.intentPreview.displayAnchor || msg.intentPreview.targetCategory)"
                class="pipeline-recognized-inline"
              >
                <span
                  v-if="msg.intentPreview.displayAnchor"
                  class="recognized-pill"
                  :class="{ tentative: msg.intentPreview.needsClarification }"
                >
                  已识别地点：{{ msg.intentPreview.displayAnchor }}
                </span>
                <span v-if="msg.intentPreview.targetCategory" class="recognized-pill">
                  已识别需求：{{ msg.intentPreview.targetCategory }}
                </span>
                <span v-if="msg.intentPreview.isAbbreviation" class="recognized-pill subtle">
                  {{ msg.intentPreview.normalizedAnchor && msg.intentPreview.normalizedAnchor !== msg.intentPreview.displayAnchor
                    ? `简称展开：${msg.intentPreview.normalizedAnchor}`
                    : '简称锚点' }}
                </span>
                <span
                  v-if="typeof msg.intentPreview.confidence === 'number'"
                  class="recognized-pill subtle"
                >
                  置信度：{{ formatIntentConfidence(msg.intentPreview.confidence) }}
                </span>
              </div>
              <div
                v-if="msg.intentPreview?.needsClarification && msg.intentPreview?.clarificationHint"
                class="pipeline-clarification-inline"
              >
                {{ msg.intentPreview.clarificationHint }}
              </div>
              <div v-if="msg.queryType || msg.intentMeta?.intentMode" class="pipeline-intent-inline">
                <span v-if="msg.queryType" class="intent-pill">Type: {{ msg.queryType }}</span>
                <span v-if="msg.intentMeta?.intentMode" class="intent-pill">Mode: {{ msg.intentMeta.intentMode }}</span>
              </div>
              <div
                v-if="DSL_META_GRAY_ENABLED && msg.prefetchDebug"
                class="pipeline-prefetch-inline"
              >
                <span class="prefetch-pill" :class="`is-${msg.prefetchDebug.status || 'unknown'}`">
                  Prefetch: {{ formatPrefetchState(msg.prefetchDebug) }}
                </span>
                <span class="prefetch-overlap-inline">
                  Δ{{ formatPrefetchOverlap(msg.prefetchDebug.overlapDeltaMs) }}
                </span>
              </div>
            </div>

            <!-- 思考过程展示组件 (V3 推理模型) -->
            <div
              v-if="msg.role === 'assistant' && shouldShowRunStatus(msg, index)"
              class="run-status-inline"
              :class="`tone-${getRunStatusForMessage(msg, index).tone}`"
            >
              <div
                class="run-status-header"
                :class="{ clickable: Boolean(msg.reasoningContent) }"
                @click="msg.reasoningContent ? msg.isReasoningExpanded = !msg.isReasoningExpanded : null"
              >
                <div class="run-status-main">
                  <svg v-if="msg.isThinking && !msg.pipelineCompleted" class="thinking-spinner" viewBox="0 0 24 24" width="16" height="16">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="32" stroke-linecap="round"/>
                  </svg>
                  <svg v-else class="thinking-check" viewBox="0 0 16 16" width="14" height="14">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                  </svg>
                  <div class="run-status-copy">
                    <span class="run-status-label">
                      {{ getRunStatusForMessage(msg, index).label }}
                    </span>
                    <small class="run-status-detail">
                      {{ getRunStatusForMessage(msg, index).detail }}
                    </small>
                  </div>
                </div>
                <svg
                  v-if="msg.reasoningContent"
                  class="thinking-expand-icon"
                  :class="{ expanded: msg.isReasoningExpanded }"
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                >
                  <path d="M7 10l5 5 5-5z" fill="currentColor"/>
                </svg>
              </div>
              <div
                v-if="msg.reasoningContent"
                class="thinking-content"
                :class="{ collapsed: !msg.isReasoningExpanded }"
              >
                <div class="thinking-text">{{ msg.reasoningContent }}</div>
              </div>
            </div>

            <div
              v-if="msg.content && msg.content.trim()"
              class="message-text"
              :class="{ 'streaming-markdown': shouldRenderStreamingMarkdown(msg, index) }"
              v-html="renderMessageHtml(msg, { streaming: shouldRenderStreamingMarkdown(msg, index) })"
            ></div>

            <div
              v-if="msg.role === 'assistant' && getMessageCacheLabel(msg)"
              class="message-meta-row"
            >
              <span class="meta-pill cache-pill" :class="{ hit: isMessageCacheHit(msg), miss: !isMessageCacheHit(msg) }">
                {{ getMessageCacheLabel(msg) }}
              </span>
            </div>
            <div
              v-if="msg.role === 'assistant' && getMessageRiskWarnings(msg).length > 0"
              class="message-risk-list"
            >
              <span
                v-for="warning in getMessageRiskWarnings(msg)"
                :key="`${index}-${warning.code}`"
                class="meta-pill risk-pill"
              >
                {{ warning.message }}
              </span>
            </div>

            <EmbeddedTagCloud 
              v-if="msg.role === 'assistant' && !isGeneralQaMessage(msg) && msg.pois && msg.pois.length > 0"
              :pois="msg.pois"
              :intent-mode="resolveEmbeddedIntentMode(msg)"
              :intent-meta="msg.intentMeta || null"
              :width="360"
              :height="200"
              @render-to-map="(pois) => handleRenderToMap(msg, pois)"
              @tag-click="handleTagClick"
            />

            <div v-if="msg.content && msg.content.trim()" class="message-time">{{ formatTime(msg.timestamp) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="chat-input-area">
      <div class="input-wrapper">
        <textarea 
          ref="inputRef"
          v-model="inputText"
          @keydown.enter.exact.prevent="sendMessage"
          @keydown.shift.enter="insertNewline"
          placeholder="例如：武汉大学附近有哪些咖啡店？这片区适合开什么店？"
          :disabled="isTyping"
          rows="1"
        ></textarea>
        <button 
          class="send-btn" 
          @click="sendMessage"
          :disabled="!inputText.trim() || isTyping"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div class="input-hint">
        <span v-if="isOnline === null" class="probing-hint">正在检测 AI 服务...</span>
        <span v-else-if="isOnline === false" class="offline-hint">
          AI 服务未连接
          <button class="retry-link" type="button" @click="checkOnlineStatus">重试连接</button>
        </span>
        <span v-else>按 Enter 发送，Shift+Enter 换行。推荐按“地点 + 空间关系 + 需求”来提问。</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue';
import {
  sendChatMessageStream, 
  checkAIService, 
  getCurrentProviderInfo
} from '../utils/aiService.js';
import { normalizeRefinedResultEvidence } from '../utils/refinedResultEvidence.js';
import { useAiStreamDispatcher } from '../composables/ai/useAiStreamDispatcher.js';
import { useSpatialRequestBuilder } from '../composables/ai/useSpatialRequestBuilder.js';
import {
  getAgentStageSteps,
  getRunStatusCopy as buildRunStatusCopy,
  normalizeAgentStage
} from '../utils/agentStageConfig.js';
import {
  refreshTemplateWeights,
  trackSessionOutcome
} from '../services/aiTelemetry.js';
import { filterV3ChatOptions } from '../utils/v3RequestOptions.js';
import EmbeddedTagCloud from './EmbeddedTagCloud.vue';
import { marked } from 'marked';
import { resolveAnalysisSignals } from '../utils/analysisSignals.js';
import { normalizeMarkdownForRender } from '../utils/markdownContract.js';
import { isGeneralQaMessage } from '../utils/analysisBoardVisibility.js';
import { buildChatHistoryExportContent } from '../utils/chatHistoryExport.js';
import {
  buildAiAnchorFeatureFromMessage
} from '../utils/aiAnchorFeature.js';
import {
  getLocationActionLabel,
  getUserLocationSummary
} from '../utils/userLocationContext.js';

const props = defineProps({
  // 当前选中的 POI 数据
  poiFeatures: {
    type: Array,
    default: () => []
  },
  // 是否开启全域感知模式
  globalAnalysisEnabled: {
    type: Boolean,
    default: false
  },
  // 空间边界几何数据
  boundaryPolygon: {
    type: Array,
    default: null
  },
  drawMode: {
    type: String,
    default: ''
  },
  circleCenter: {
    type: [Object, Array],
    default: null
  },
  circleRadius: {
    type: [Number, String],
    default: null
  },
  // 地图视野边界 [minLon, minLat, maxLon, maxLat]
  mapBounds: {
    type: Array,
    default: null
  },
  mapZoom: {
    type: Number,
    default: null
  },
  userLocation: {
    type: Object,
    default: null
  },
  userLocationStatus: {
    type: String,
    default: 'idle'
  },
  selectedCategories: {
    type: Array,
    default: () => []
  },
  // 多区数据 (新增)
  regions: {
    type: Array,
    default: () => []
  }
});

// 定义事件
const emit = defineEmits([
  'close',
  'request-current-location',
  'render-to-tagcloud',
  'render-pois-to-map',
  'ai-boundary',
  'ai-spatial-clusters',
  'ai-vernacular-regions',
  'ai-fuzzy-regions',
  'ai-analysis-stats',
  'ai-intent-meta',
  'clear-chat-state'
]);

// 响应式状态
const messages = ref([]);
const inputText = ref('');
const isTyping = ref(false);
const currentStage = ref(''); // 原始 stage 名称（来自 SSE）
const streamQueue = ref('');
const forceRecomputeNext = ref(false);

// V3 模式检测
const isV3Mode = import.meta.env.VITE_BACKEND_VERSION === 'v3';
const isV4Mode = import.meta.env.VITE_BACKEND_VERSION === 'v4';

const reasoningRouteLabel = computed(() => {
  if (isV3Mode) return 'V3 流式';
  if (isV4Mode) return 'V4 Agent';
  return 'V1 模板';
});

const reasoningRouteTone = computed(() => (isV3Mode || isV4Mode ? 'active' : 'neutral'));

const stageSteps = getAgentStageSteps({
  backendVersion: isV4Mode ? 'v4' : (isV3Mode ? 'v3' : 'v1')
});

function normalizeStageName(stageName) {
  return normalizeAgentStage(stageName);
}

const normalizedStageKey = computed(() => normalizeStageName(currentStage.value));

function formatPrefetchState(prefetchDebug = {}) {
  if (prefetchDebug?.degraded === true) return '降级';
  if (prefetchDebug?.wasted === true) return '浪费';
  return '有效';
}

function formatPrefetchOverlap(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0ms';
  const rounded = Math.round(numeric);
  return `${rounded > 0 ? '+' : ''}${rounded}ms`;
}

function formatIntentConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  const normalized = numeric <= 1 ? numeric : numeric / 100
  return `${Math.round(normalized * 100)}%`
}

function isStreamingMessage(message, index) {
  if (!message || message.role !== 'assistant') return false;
  if (message.pipelineCompleted) return false;
  if (message.isStreaming === true) return true;
  return isTyping.value && index === messages.value.length - 1;
}

function shouldShowPipelineForMessage(message, index) {
  if (!message || message.role !== 'assistant') return false;
  if (isGeneralQaMessage(message)) return false;
  return Boolean(message.pipelineCompleted || isStreamingMessage(message, index));
}

function updateMessagePipelineHighWater(message, stageKey = '') {
  if (!message) return -1;

  const idx = stageSteps.findIndex((step) => step.key === stageKey);
  const previous = Number.isInteger(message.pipelineHighWaterStageIndex)
    ? message.pipelineHighWaterStageIndex
    : -1;

  if (idx >= 0) {
    message.pipelineHighWaterStageIndex = Math.max(previous, idx);
    return message.pipelineHighWaterStageIndex;
  }

  return previous;
}

function getPipelineStageIndexForMessage(message, index) {
  if (!message) return -1;

  const candidateStage = normalizeStageName(
    message.pipelineStage
    || message.currentStage
    || (isStreamingMessage(message, index) ? normalizedStageKey.value : '')
  );
  const candidateIdx = stageSteps.findIndex((step) => step.key === candidateStage);
  const highWater = Number.isInteger(message.pipelineHighWaterStageIndex)
    ? message.pipelineHighWaterStageIndex
    : -1;

  if (candidateIdx >= 0) return Math.max(highWater, candidateIdx);
  if (highWater >= 0) return highWater;

  if (message.pipelineCompleted) {
    return Math.max(stageSteps.length - 1, 0);
  }

  return isStreamingMessage(message, index) ? 0 : -1;
}

function getPipelineHintForMessage(message, index) {
  const idx = getPipelineStageIndexForMessage(message, index);
  if (idx < 0) return '';
  return stageSteps[idx]?.hint || '';
}

function shouldShowRunStatus(message, index) {
  if (!message || message.role !== 'assistant') return false;
  if (isGeneralQaMessage(message)) return false;
  return Boolean(
    message.pipelineCompleted
    || message.isThinking
    || message.reasoningContent
    || isStreamingMessage(message, index)
  );
}

function getRunStatusForMessage(message, index) {
  const activeStageKey = normalizeStageName(
    message?.pipelineStage
    || message?.currentStage
    || (isStreamingMessage(message, index) ? normalizedStageKey.value : '')
    || 'intent'
  );

  return buildRunStatusCopy({
    pipelineCompleted: Boolean(message?.pipelineCompleted),
    isThinking: Boolean(message?.isThinking && !message?.pipelineCompleted),
    activeStageKey,
    stageSteps
  });
}

function toEmbeddedIntentMode(intentMode, queryType = '') {
  const rawMode = String(intentMode || '').trim().toLowerCase();
  const rawType = String(queryType || '').trim().toLowerCase();

  if (rawMode === 'local_search') return 'micro';
  if (rawMode === 'macro_overview') return 'macro';
  if (rawType === 'poi_search') return 'micro';
  if (rawType === 'area_analysis') return 'macro';
  return '';
}

function resolveEmbeddedIntentMode(message) {
  const fromMeta = toEmbeddedIntentMode(
    message?.intentMeta?.intentMode,
    message?.intentMeta?.queryType || message?.queryType
  );
  if (fromMeta) return fromMeta;

  const fromMessage = String(message?.intentMode || '').trim().toLowerCase();
  if (fromMessage === 'micro' || fromMessage === 'macro') return fromMessage;

  return 'macro';
}

const streamTimer = ref(null);
const activeMessageIndex = ref(-1);
const streamRenderIntervalMs = 16;
const streamDrainTimeoutMs = 12000;
const streamScrollTick = ref(0);
const isOnline = ref(null);
const messagesContainer = ref(null);
const inputRef = ref(null);
const chatSessionId = ref(`session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
const extractedPOIs = ref([]); // AI 提取的 POI 名称列表
const { dispatchMetaEvent } = useAiStreamDispatcher({
  messagesRef: messages,
  extractedPOIsRef: extractedPOIs,
  emit,
  normalizeRefinedResultEvidence,
  toEmbeddedIntentMode
});
const {
  normalizeSelectedCategories,
  hasCustomSelection,
  shouldRunDeepSpatialMode,
  shouldCaptureSnapshot,
  normalizeRegionsForBackend,
  buildSpatialContext,
  buildDslMetaSkeleton
} = useSpatialRequestBuilder();
const DSL_META_GRAY_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(import.meta.env.VITE_DSL_META_ENABLED || import.meta.env.VITE_DSL_META_GRAY || 'false')
    .trim()
    .toLowerCase()
);
let statusTimer = null;
let html2canvasModulePromise = null;
let manualScrollTimer = null;
const snapshotCache = {
  dataUrl: null,
  capturedAt: 0,
  key: ''
};
const SNAPSHOT_CACHE_TTL_MS = 25000;

// 计算 POI 数量
const poiCount = computed(() => props.poiFeatures?.length || 0);
const defaultPoiCoordSys = (import.meta.env.VITE_POI_COORD_SYS || 'gcj02').toLowerCase();
const userLocationSummary = computed(() => getUserLocationSummary({
  userLocation: props.userLocation,
  userLocationStatus: props.userLocationStatus
}));
const locationActionLabel = computed(() => getLocationActionLabel(props.userLocationStatus));
const compactLocationDetail = computed(() => {
  switch (String(props.userLocationStatus || 'idle')) {
    case 'ready':
      return userLocationSummary.value.detail;
    case 'locating':
      return '正在等待浏览器返回位置';
    case 'denied':
      return '授权后才能回答“我附近”';
    case 'error':
      return '重试定位，或改用文本地点';
    case 'unsupported':
      return '当前环境只能按文本地点检索';
    default:
      return '未启用定位时，附近按问题里的地点检索';
  }
});

const welcomeContextStats = computed(() => [
  {
    label: '当前 POI',
    value: poiCount.value > 0 ? `${poiCount.value} 个` : '未圈选',
    tone: poiCount.value > 0 ? 'active' : 'muted'
  },
  {
    label: '分析范围',
    value: props.globalAnalysisEnabled ? '全域感知' : '当前范围',
    tone: props.globalAnalysisEnabled ? 'accent' : 'neutral'
  },
  {
    label: '推理链路',
    value: reasoningRouteLabel.value,
    tone: reasoningRouteTone.value
  },
  {
    label: '类别过滤',
    value: props.selectedCategories?.length ? `${props.selectedCategories.length} 类` : '未限定',
    tone: props.selectedCategories?.length ? 'accent' : 'muted'
  }
]);

const welcomePrimaryScenarios = computed(() => welcomeScenarios.slice(0, 3));

// 欢迎态场景入口
const welcomeScenarios = [
  {
    badge: '片区速读',
    title: '快速读懂这片区',
    desc: '先做全局扫描，快速看主导业态、活力热点、异常信号和最值得关注的机会。',
    accent: 'cyan',
    prompt: '请快速读懂当前区域，用简洁但有洞察的方式总结主导业态、活力热点、异常点，以及最值得关注的机会。'
  },
  {
    badge: '周边检索',
    title: '附近有什么值得关注',
    desc: '适合围绕学校、商圈、地铁站来查咖啡店、商超、地铁站与生活配套。',
    accent: 'amber',
    prompt: '请帮我看看这里附近有什么值得关注的配套、热门业态和明显缺口，并按相关性排序。'
  },
  {
    badge: '选址机会',
    title: '这里适合开什么店',
    desc: '从供给密度、竞争关系和周边需求判断，更适合优先布局哪类业态。',
    accent: 'emerald',
    prompt: '如果要在当前区域开店，哪些业态更值得优先考虑？请结合周边供给、需求和竞争关系说明理由。'
  },
  {
    badge: '空间对比',
    title: '和另一片区比一比',
    desc: '比较两块区域的人气、业态结构、功能分工和商业机会差异。',
    accent: 'violet',
    prompt: '请把当前区域和周边热点片区做对比，说明它们在人流、业态结构和商业机会上的差异，并给出建议。'
  },
  {
    badge: '配套检查',
    title: '周边配套够不够',
    desc: '快速判断交通、生活服务、餐饮和休闲娱乐是否均衡，哪里还短板明显。',
    accent: 'rose',
    prompt: '请评估当前区域周边配套是否均衡，重点看交通、餐饮、生活服务和休闲娱乐，并指出短板。'
  },
  {
    badge: '提问灵感',
    title: '给我几个高质量问法',
    desc: '生成更容易触发空间检索、空间推理和结构化回答的自然语言问题。',
    accent: 'slate',
    prompt: '请给我 6 个高质量的 GeoAI 提问示例，覆盖附近检索、片区分析、业态判断和对比场景。'
  }
];

const welcomeExamples = [
  {
    label: '武汉大学附近有哪些咖啡店？',
    prompt: '武汉大学附近有哪些咖啡店？'
  },
  {
    label: '湖北大学附近有哪些地铁站？',
    prompt: '湖北大学附近有哪些地铁站？'
  },
  {
    label: '武汉二中附近有哪些商超？',
    prompt: '武汉二中附近有哪些商超？'
  },
  {
    label: '这片区适合开轻食店还是咖啡店？',
    prompt: '这片区适合开轻食店还是咖啡店？请从供给、竞争和周边需求角度分析。'
  }
];

const providerName = ref('');
const isLocalProvider = ref(false);

function stopStatusPolling() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

function startStatusPolling() {
  if (statusTimer) return;
  statusTimer = setInterval(() => {
    checkOnlineStatus().catch(() => {});
  }, 30000);
}

// 计算状态文本
const statusText = computed(() => {
  if (isOnline.value === null) return '检测中...';
  if (isOnline.value === false) return '离线';
  // 本地显示 "Local LM"，云端统丢显示 "在线"
  return isLocalProvider.value ? 'Local LM' : '在线';
});

// 检查 AI 服务状态
async function checkOnlineStatus() {
  isOnline.value = await checkAIService();
  if (isOnline.value) {
    const config = getCurrentProviderInfo();
    providerName.value = config.name;
    isLocalProvider.value = config.id === 'local';
    startStatusPolling();
    refreshTemplateWeights({ force: false }).catch(() => {});
  } else {
    providerName.value = '';
    isLocalProvider.value = false;
    stopStatusPolling();
  }
  return isOnline.value;
}

// 发送消息

// spatial request normalization moved to composable: useSpatialRequestBuilder
async function loadHtml2Canvas() {
  if (!html2canvasModulePromise) {
    html2canvasModulePromise = import('html2canvas')
      .then((mod) => mod.default || mod)
      .catch((error) => {
        html2canvasModulePromise = null;
        throw error;
      });
  }
  return html2canvasModulePromise;
}

async function captureMapSnapshot(snapshotKey) {
  const now = Date.now();
  if (
    snapshotCache.dataUrl &&
    snapshotCache.key === snapshotKey &&
    now - snapshotCache.capturedAt < SNAPSHOT_CACHE_TTL_MS
  ) {
    return snapshotCache.dataUrl;
  }

  const mapElement = document.querySelector('.map-container');
  if (!mapElement) return null;

  try {
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(mapElement, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#000000',
      scale: 0.65
    });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    snapshotCache.dataUrl = dataUrl;
    snapshotCache.capturedAt = now;
    snapshotCache.key = snapshotKey;
    return dataUrl;
  } catch (error) {
    console.warn('[AiChat] map snapshot capture failed:', error);
    return null;
  }
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function takeNextStreamCharacter(text) {
  if (!text) {
    return { char: '', rest: '' };
  }

  const iterator = text[Symbol.iterator]();
  const next = iterator.next();
  const char = next?.value || '';
  if (!char) {
    return { char: '', rest: '' };
  }

  return {
    char,
    rest: text.slice(char.length)
  };
}

function enqueueStreamChunk(chunk, messageIndex) {
  if (!chunk || typeof chunk !== 'string') return;

  activeMessageIndex.value = messageIndex;
  streamQueue.value += chunk;

  if (streamTimer.value) return;

  streamTimer.value = window.setInterval(() => {
    if (!streamQueue.value || activeMessageIndex.value < 0) {
      if (!streamQueue.value) {
        window.clearInterval(streamTimer.value);
        streamTimer.value = null;
      }
      return;
    }

    const currentMessage = messages.value[activeMessageIndex.value];
    if (!currentMessage) {
      streamQueue.value = '';
      window.clearInterval(streamTimer.value);
      streamTimer.value = null;
      return;
    }

    const { char: delta, rest } = takeNextStreamCharacter(streamQueue.value);
    if (!delta) {
      streamQueue.value = '';
      window.clearInterval(streamTimer.value);
      streamTimer.value = null;
      return;
    }

    streamQueue.value = rest;
    currentMessage.content += delta;

    streamScrollTick.value += 1;
    if (streamScrollTick.value % 3 === 0) {
      scrollToBottom(false, 'auto');
    }

    if (!streamQueue.value) {
      window.clearInterval(streamTimer.value);
      streamTimer.value = null;
      scrollToBottom(false, 'auto');
    }
  }, streamRenderIntervalMs);
}

async function waitForStreamQueueToDrain(timeoutMs = streamDrainTimeoutMs) {
  const startedAt = Date.now();

  while (streamQueue.value || streamTimer.value) {
    if (Date.now() - startedAt > timeoutMs) {
      await flushStreamQueue();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, streamRenderIntervalMs));
  }
}

async function flushStreamQueue() {
  if (activeMessageIndex.value < 0 || !streamQueue.value) return;

  const currentMessage = messages.value[activeMessageIndex.value];
  if (currentMessage) {
    currentMessage.content += streamQueue.value;
  }

  streamQueue.value = '';

  if (streamTimer.value) {
    window.clearInterval(streamTimer.value);
    streamTimer.value = null;
  }
  streamScrollTick.value = 0;

  await nextTick();
  scrollToBottom(false, 'auto');
}

function resetStreamState() {
  streamQueue.value = '';
  activeMessageIndex.value = -1;
  streamScrollTick.value = 0;
  if (streamTimer.value) {
    window.clearInterval(streamTimer.value);
    streamTimer.value = null;
  }
}

marked.setOptions({
  gfm: true,
  breaks: true
});
const markdownRenderCache = new WeakMap();

const REASONING_START_RE = /^(thinking process|thought process|reasoning process|思考过程|推理过程|分析步骤|分析过程|let'?s think)\s*[:：]?/i
const REASONING_HEADING_RE = /^(\d+\.\s*)?\*{0,2}\s*(analyze the request|evaluate data|evaluate data\s*&\s*constraints|drafting content|refining for tone|final polish|revised draft|final plan)\s*[:：]?/i

function stripThinkTagsFromText(text = '') {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()
}

function sanitizeAssistantVisibleText(text = '') {
  const cleaned = stripThinkTagsFromText(text)
  if (!cleaned) return ''
  if (REASONING_START_RE.test(cleaned) || REASONING_HEADING_RE.test(cleaned)) {
    return ''
  }
  return cleaned
}

function removeLastOccurrence(text = '', token = '') {
  if (!text || !token) return text
  const index = text.lastIndexOf(token)
  if (index < 0) return text
  return `${text.slice(0, index)}${text.slice(index + token.length)}`
}

function stripDanglingMarkdownTokens(text = '') {
  let normalized = String(text || '')
  const pairedTokens = ['**', '__', '`']

  pairedTokens.forEach((token) => {
    const count = normalized.split(token).length - 1
    if (count % 2 === 1) {
      normalized = removeLastOccurrence(normalized, token)
    }
  })

  return normalized
}

function normalizeInlineMarkdownArtifacts(text = '') {
  return String(text || '')
    .replace(/([：:])\s*\*\s+/g, '$1\n- ')
    .replace(/\n\s*\*\s+/g, '\n- ')
    .replace(/\*或\*/g, '或')
}

function shouldRenderStreamingMarkdown(message, index) {
  return isStreamingMessage(message, index)
}


function toggleForceRecompute() {
  forceRecomputeNext.value = !forceRecomputeNext.value;
}

function resolveMessageSignals(message) {
  const stats = message?.analysisStats && typeof message.analysisStats === 'object'
    ? message.analysisStats
    : null;
  return resolveAnalysisSignals(stats);
}

function getMessageCacheLabel(message) {
  return resolveMessageSignals(message).cacheLabel;
}

function isMessageCacheHit(message) {
  return resolveMessageSignals(message).cacheHit;
}

function getMessageRiskWarnings(message) {
  return resolveMessageSignals(message).riskWarnings;
}

async function sendMessage(directText = '') {
  const candidateText = typeof directText === 'string'
    ? directText
    : inputText.value;
  const text = String(candidateText || '').trim();
  if (!text || isTyping.value) return;

  // 先入列用户消息
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now()
  });
  inputText.value = '';

  await nextTick();
  scrollToBottom(true, 'auto');
  const onlinePromise = checkOnlineStatus();

  // 进入 AI 回复状态
  isTyping.value = true;
  resetStreamState();

  // 预定义 aiMessageIndex
  let aiMessageIndex = -1;
  let requestId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let requestSucceeded = false;
  let forceRecomputeRequest = false;
  let skipFinalize = false;

  const apiMessages = messages.value.map(m => ({
    role: m.role,
    content: m.content
  }));

  const initialRunStatus = buildRunStatusCopy({
    pipelineCompleted: false,
    isThinking: true,
    activeStageKey: 'intent',
    stageSteps
  });

  aiMessageIndex = messages.value.length;
  messages.value.push({
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isThinking: true,
    thinkingMessage: initialRunStatus.label,
    isReasoningExpanded: false,
    intentPreview: null,
    isStreaming: true,
    pipelineCompleted: false,
    pipelineStage: 'intent',
    pipelineHighWaterStageIndex: 0
  });

  await nextTick();
  scrollToBottom(true, 'auto');
  await waitForNextPaint();

  try {
    const online = await onlinePromise;
    if (!online) {
      const offlineTip = 'AI 服务未连接，请先启动后端服务后重试。';
      skipFinalize = true;
      if (aiMessageIndex >= 0) {
        messages.value.splice(aiMessageIndex, 1);
        aiMessageIndex = -1;
      }
      const lastMessage = messages.value[messages.value.length - 1];
      if (!(lastMessage?.role === 'assistant' && lastMessage?.content === offlineTip)) {
        messages.value.push({
          role: 'assistant',
          content: offlineTip,
          timestamp: Date.now()
        });
        await nextTick();
        scrollToBottom(true, 'auto');
      }
      return;
    }

    // 仅开发环境打印关键信息
    if (import.meta.env.DEV) {
      console.log('[AiChat] 发送消息, POI:', props.poiFeatures?.length || 0);
    }

    const spatialContext = buildSpatialContext({
      boundaryPolygon: props.boundaryPolygon,
      drawMode: props.drawMode,
      circleCenter: props.circleCenter,
      circleRadius: props.circleRadius,
      mapBounds: props.mapBounds,
      mapZoom: props.mapZoom,
      regions: props.regions,
      poiFeatures: props.poiFeatures,
      userLocation: props.userLocation
    });

    const normalizedRegions = normalizeRegionsForBackend(props.regions);
    // 多区约束写入 spatialContext，供 Python 直查模式按“选区并集”严格过滤
    spatialContext.regions = normalizedRegions;

    const normalizedSelectedCategories = normalizeSelectedCategories(props.selectedCategories);
    const poiCount = props.poiFeatures?.length || 0;
    const deepSpatialMode = shouldRunDeepSpatialMode(text, spatialContext, props.regions, poiCount);
    forceRecomputeRequest = forceRecomputeNext.value === true;
    const shouldSnapshot = !isV3Mode && (deepSpatialMode || shouldCaptureSnapshot(text, deepSpatialMode));
    const screenshotBase64 = shouldSnapshot
      ? await captureMapSnapshot(`${props.drawMode || 'none'}:${props.mapZoom || 0}:${poiCount}`)
      : null;
    const dslMetaSkeleton = buildDslMetaSkeleton({
      enabled: DSL_META_GRAY_ENABLED,
      requestId,
      spatialContext,
      drawMode: props.drawMode,
      regions: normalizedRegions
    });

    const rawOptions = {
      requestId,
      sessionId: chatSessionId.value,
      clientMetrics: {
        panel: 'ai-chat',
        messageCount: messages.value.length,
        poiCount,
        forceRecompute: forceRecomputeRequest
      },
      skipCache: forceRecomputeRequest,
      forceRefresh: forceRecomputeRequest,
      globalAnalysis: props.globalAnalysisEnabled,
      selectedCategories: normalizedSelectedCategories,
      sourcePolicy: {
        enforceUiConstraints: true,
        hasCustomArea: hasCustomSelection(spatialContext, props.regions),
        hasCategoryFilter: normalizedSelectedCategories.length > 0
      },
      confidenceModel: 'composite_v5',
      visualReviewEnabled: deepSpatialMode,
      visualRemoteEnabled: Boolean(deepSpatialMode && screenshotBase64),
      selfValidationEnabled: deepSpatialMode,
      skgEnabled: deepSpatialMode,
      nameAuditEnabled: true,
      nameAuditRemoteEnabled: deepSpatialMode,
      nameAuditTimeoutMs: deepSpatialMode ? 900 : 420,
      visualModel: 'qwen3.5-2b',
      ocrModel: 'glm-ocr',
      overviewEnabled: Boolean(screenshotBase64),
      overviewModel: 'qwen3.5-0.8b',
      overviewMediumEnabled: Boolean(screenshotBase64),
      overviewTimeoutMs: deepSpatialMode ? 2200 : 1400,
      visualTimeoutMs: deepSpatialMode ? 4500 : 2200,
      vlmFailureMode: 'soft',
      visualSnapshotDataUrl: screenshotBase64,
      screenshotBase64, // legacy fallback key
      reasoningEnabled: false,
      reasoningModel: 'qwen3.5-2b',
      reasoningTimeoutMs: deepSpatialMode ? 2800 : 1200,
      modelBudgetMs: deepSpatialMode ? 8000 : 5000,
      limit: deepSpatialMode ? 8000 : 4200,
      clusterMaxHdbscanPoints: deepSpatialMode ? 3500 : 1800,
      maxRegionOutputs: deepSpatialMode ? 60 : 24,
      spatialContext,
      regions: normalizedRegions,
      analysisDepth: deepSpatialMode ? 'deep' : 'fast',
      ...dslMetaSkeleton
    };
    const options = isV3Mode ? filterV3ChatOptions(rawOptions) : rawOptions;

    await sendChatMessageStream(
      apiMessages,
      (chunk) => {
        const safeChunk = sanitizeAssistantVisibleText(chunk);
        if (!safeChunk) return;
        enqueueStreamChunk(safeChunk, aiMessageIndex);
      },
      options,
      props.poiFeatures,
      (type, data) => {
        if (type === 'trace' && data?.trace_id) {
          requestId = data.trace_id;
        }
        const fallbackIntentMode = spatialContext?.mode === 'Polygon' ? 'micro' : 'macro';
        const dispatchResult = dispatchMetaEvent({
          type,
          data,
          aiMessageIndex,
          fallbackIntentMode
        });
        if (dispatchResult?.stage) {
          currentStage.value = dispatchResult.stage;
          if (messages.value[aiMessageIndex]) {
            messages.value[aiMessageIndex].pipelineStage = dispatchResult.stage;
            updateMessagePipelineHighWater(
              messages.value[aiMessageIndex],
              normalizeStageName(dispatchResult.stage)
            );
          }
        }
      }
    );

    await waitForStreamQueueToDrain();
    requestSucceeded = true;
  } catch (error) {
    console.error('[AiChat] Failed to send message:', error);
    await flushStreamQueue();
    const failedContent = `Request failed: ${error.message}`;
    if (aiMessageIndex >= 0 && messages.value[aiMessageIndex]) {
      const currentMessage = messages.value[aiMessageIndex];
      const existingContent = String(currentMessage.content || '').trim();
      currentMessage.content = existingContent ? `${existingContent}\n\n${failedContent}` : failedContent;
      currentMessage.error = true;
    } else {
      messages.value.push({
        role: 'assistant',
        content: failedContent,
        timestamp: Date.now(),
        error: true
      });
    }
  } finally {
    if (requestSucceeded) {
      await waitForStreamQueueToDrain();
    } else {
      await flushStreamQueue();
    }
    resetStreamState();
    if (!skipFinalize && aiMessageIndex >= 0 && messages.value[aiMessageIndex]) {
      messages.value[aiMessageIndex].isStreaming = false;
      messages.value[aiMessageIndex].isThinking = false;
      messages.value[aiMessageIndex].thinkingMessage = '分析已经完成';
      messages.value[aiMessageIndex].pipelineStage = 'answer';
      updateMessagePipelineHighWater(messages.value[aiMessageIndex], 'answer');
      messages.value[aiMessageIndex].pipelineCompleted = true;
    }
    const finalAssistantMessage = messages.value[aiMessageIndex] || null;
    trackSessionOutcome({
      traceId: finalAssistantMessage?.traceId || requestId,
      intentMeta: finalAssistantMessage?.intentMeta || null,
      extra: {
        status: requestSucceeded ? 'success' : 'failed',
        queryLength: text.length
      }
    }).catch(() => {});
    isTyping.value = false;
    currentStage.value = '';
    await nextTick();
    scrollToBottom(true, 'auto');
    if (forceRecomputeRequest) {
      forceRecomputeNext.value = false;
    }
  }
}

function sendQuickAction(prompt) {
  inputText.value = '';
  void sendMessage(prompt);
}

// 标签云：渲染到地图
function buildAnchorFeatureFromMessage(message, pois = []) {
  return buildAiAnchorFeatureFromMessage(message, pois, {
    fallbackCoordSys: defaultPoiCoordSys
  });
}

function handleRenderToMap(message, pois) {
  const normalizedPois = Array.isArray(pois) ? pois : [];
  console.log('[AiChat] 渲染 POI 到地图:', normalizedPois.length);

  const anchorFeature = buildAnchorFeatureFromMessage(message, normalizedPois);
  if (anchorFeature) {
    emit('render-pois-to-map', {
      pois: normalizedPois,
      anchorFeature
    });
    return;
  }

  emit('render-pois-to-map', normalizedPois);
}

// 标签云：标签点击
function handleTagClick(tag) {
  console.log('[AiChat] 标签点击:', tag.name);
  if (tag.originalPoi) {
    emit('render-pois-to-map', [tag.originalPoi]);
  }
}

function hasSpatialEvidence(msg) {
  return msg.spatialClusters?.hotspots?.length > 0 ||
         msg.vernacularRegions?.length > 0 ||
         msg.fuzzyRegions?.length > 0;
}

function handleEvidenceLocate(center) {
  if (!center) return;
  const poi = { lon: center.lon || center[0], lat: center.lat || center[1] };
  const coordSys = String(
    center?.coordSys
    || center?.coord_sys
    || center?.properties?.coordSys
    || center?.properties?._coordSys
    || defaultPoiCoordSys
  ).trim().toLowerCase() || defaultPoiCoordSys;
  emit('render-pois-to-map', [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [poi.lon, poi.lat] },
    coordSys,
    properties: {
      _source: 'evidence_locate',
      _coordSys: coordSys
    }
  }]);
}

function handleEvidenceFollowup(prompt) {
  if (!prompt) return;
  sendQuickAction(prompt);
}

// 清空对话
function clearChat() {
  messages.value = [];
  extractedPOIs.value = [];
  currentStage.value = '';
  resetStreamState();
  emit('clear-chat-state');
}

// 保存对话记录
function saveChatHistory() {
  if (messages.value.length === 0) return;

  const content = buildChatHistoryExportContent(messages.value, {
    poiCount: props.poiFeatures.length,
    sanitizeAssistantText: sanitizeAssistantVisibleText
  });
  
  // 写入 UTF-8 BOM，避免 Windows 文本编辑器打开时出现中文乱码。
  const blob = new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `TagCloud_Chat_${new Date().getTime()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

// 滚动状态
const userScrolledUp = ref(false)
const isManualScrolling = ref(false)

onMounted(() => {
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', handleScroll)
    messagesContainer.value.addEventListener('wheel', markManualScrolling, { passive: true })
    messagesContainer.value.addEventListener('touchmove', markManualScrolling, { passive: true })
  }
})

function markManualScrolling() {
  isManualScrolling.value = true
  if (manualScrollTimer) {
    clearTimeout(manualScrollTimer)
  }
  manualScrollTimer = setTimeout(() => {
    isManualScrolling.value = false
    manualScrollTimer = null
  }, 180)
}

function handleScroll() {
  const el = messagesContainer.value
  if (!el) return
  // 如果距离底部超过 50px，认为用户向上滚动了
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  userScrolledUp.value = !isAtBottom
}

// 滚动到底部（平滑）
function scrollToBottom(force = false, behavior = 'smooth') {
  if ((userScrolledUp.value || isManualScrolling.value) && !force) return

  // 等待 nextTick，确保 DOM 已完成更新
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTo({
        top: messagesContainer.value.scrollHeight,
        behavior
      })
    }
  })
}

onUnmounted(() => {
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('scroll', handleScroll)
    messagesContainer.value.removeEventListener('wheel', markManualScrolling)
    messagesContainer.value.removeEventListener('touchmove', markManualScrolling)
  }

  if (manualScrollTimer) {
    clearTimeout(manualScrollTimer)
    manualScrollTimer = null
  }

  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }

  resetStreamState()
})

// 插入换行
function insertNewline(e) {
  const textarea = e.target;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  inputText.value = inputText.value.substring(0, start) + '\n' + inputText.value.substring(end);
  nextTick(() => {
    textarea.selectionStart = textarea.selectionEnd = start + 1;
  });
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 增强版 Markdown 渲染（支持表格）
function sanitizeRenderedHtml(html) {
  if (!html) return '';

  const baseHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');

  const container = document.createElement('div');
  container.innerHTML = baseHtml;

  const shouldDropColumn = (headerText) => {
    const text = String(headerText || '').trim().toLowerCase();
    if (!text) return false;
    return text.includes('距离')
      || text.includes('评分')
      || text.includes('distance')
      || text.includes('rating')
      || text === 'score'
      || text.includes('score');
  };

  container.querySelectorAll('table').forEach((table) => {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return;
    const headerCells = Array.from(headerRow.children);
    const removeIndexes = headerCells
      .map((cell, idx) => (shouldDropColumn(cell.textContent) ? idx : -1))
      .filter((idx) => idx >= 0)
      .sort((a, b) => b - a);

    if (removeIndexes.length === 0) return;

    table.querySelectorAll('tr').forEach((row) => {
      const cells = Array.from(row.children);
      removeIndexes.forEach((idx) => {
        if (cells[idx]) cells[idx].remove();
      });
    });
  });

  return container.innerHTML;
}

function renderMarkdown(text, options = {}) {
  if (!text) return '';

  const preparedText = options.streaming
    ? normalizeInlineMarkdownArtifacts(stripDanglingMarkdownTokens(text))
    : normalizeInlineMarkdownArtifacts(text);
  const normalizedText = normalizeMarkdownForRender(preparedText);
  const rawHtml = marked.parse(normalizedText, {
    gfm: true,
    breaks: true
  });

  return sanitizeRenderedHtml(rawHtml);
}

function renderMessageHtml(message, options = {}) {
  if (!message || typeof message !== 'object') return '';
  const rawContent = String(message.content || '');
  const content = message.role === 'assistant'
    ? sanitizeAssistantVisibleText(rawContent)
    : rawContent;
  if (!content) return '';

  const cached = markdownRenderCache.get(message);
  const cacheKey = options.streaming ? `${content}::streaming` : content;
  if (cached && cached.content === cacheKey) {
    return cached.html;
  }

  const html = renderMarkdown(content, options);
  markdownRenderCache.set(message, { content: cacheKey, html });
  return html;
}

function renderTables(text) {
  const lines = text.split('\n');
  let result = [];
  let tableLines = [];
  let inTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
      // 检测表格行（以 | 开头和结尾）
    if (line.startsWith('|') && line.endsWith('|')) {
      // 检查是否是分隔行（如 |---|---|）
      const isSeparator = /^\|[\s\-:|]+\|$/.test(line);
      
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      
      if (!isSeparator) {
        tableLines.push(line);
      }
    } else {
      // 不是表格行
      if (inTable && tableLines.length > 0) {
        // 结束表格，生成 HTML
        result.push(generateTableHTML(tableLines));
        tableLines = [];
        inTable = false;
      }
      result.push(line);
    }
  }
  
  // 处理文本末尾的表格
  if (inTable && tableLines.length > 0) {
    result.push(generateTableHTML(tableLines));
  }
  
  return result.join('\n');
}

// 生成表格 HTML
function generateTableHTML(tableLines) {
  if (tableLines.length === 0) return '';
  
  let html = '<table class="md-table">';
  
  tableLines.forEach((line, index) => {
    // 解析单元格
    const cells = line
      .split('|')
      .filter((cell, i, arr) => i !== 0 && i !== arr.length - 1) // 移除首尾空单元格
      .map(cell => cell.trim());
    
    if (index === 0) {
      // 表头
      html += '<thead><tr>';
      cells.forEach(cell => {
        html += `<th>${cell}</th>`;
      });
      html += '</tr></thead><tbody>';
    } else {
      // 表体
      html += '<tr>';
      cells.forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    }
  });
  
  html += '</tbody></table>';
  return html;
}

/**
 * 从 AI 回复中提取 POI 名称（解析 Markdown 表格）
 * @param {string} content - AI 回复内容
 * @returns {Array} POI 列表 [{name, distance}, ...]
 */
function extractPOIsFromResponse(content) {
  const pois = [];
  if (!content) return pois;
  
  const lines = content.split('\n');
  let inTable = false;
  let nameColIndex = -1;
  let distanceColIndex = -1;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 检测表格行
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').filter((c, i, arr) => i !== 0 && i !== arr.length - 1).map(c => c.trim());
      
      // 检查是否是分隔行
      if (/^[\s\-:|]+$/.test(cells.join(''))) {
        continue;
      }
      
      // 检查是否是表头（寻找“名称”列）
      if (!inTable) {
        nameColIndex = cells.findIndex(c => c.includes('名称') || c.includes('店名') || c.includes('POI'));
        distanceColIndex = cells.findIndex(c => c.includes('距离'));
        if (nameColIndex >= 0) {
          inTable = true;
        }
        continue;
      }
      
      // 表格数据行
      if (inTable && nameColIndex >= 0 && cells[nameColIndex]) {
        const name = cells[nameColIndex].replace(/\*\*/g, '').trim();
        const distance = distanceColIndex >= 0 ? cells[distanceColIndex]?.trim() : null;
        if (name && !name.includes('---')) {
          pois.push({ name, distance });
        }
      }
    } else {
      // 非表格行，重置状态
      if (inTable && pois.length > 0) {
        // 表格已结束
      }
    }
  }
  
  return pois;
}

/**
 * 将 AI 提取的 POI 渲染到标签云
 */
function renderToTagCloud() {
  // 如果提取的数据包含坐标，说明是后端下发的结构化数据，直接作为 Feature 数组传出
  if (extractedPOIs.value.length > 0 && extractedPOIs.value[0].lon) {
      const features = extractedPOIs.value.map(p => ({
        type: 'Feature',
        coordSys: resolveFeatureCoordSysHint(p, defaultPoiCoordSys),
        properties: {
           id: p.id || `temp_${Math.random()}`,
           '名称': p.name,
           '小类': p.category || p.category_small || p.category_mid || p.category_big || p.type || '未分类',
           '地址': p.address,
           '_is_temp': true // 标记为临时数据
        },
        geometry: {
           type: 'Point',
           coordinates: [p.lon, p.lat]
        }
     }));
      console.log('[AiChat] 渲染结构化 POI 到标签云:', features.length);
     emit('render-to-tagcloud', features);
     return;
  }

  const poiNames = extractedPOIs.value.map(p => p.name);
  console.log('[AiChat] 渲染到标签云:', poiNames);
  emit('render-to-tagcloud', poiNames);
}

/**
 * 清除提取的 POI
 */
function clearExtractedPOIs() {
  extractedPOIs.value = [];
}

const latestAssistantMessage = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const item = messages.value[i];
    if (item?.role === 'assistant') {
      return item;
    }
  }
  return null;
});

const latestAssistantMessageText = computed(() => {
  if (!latestAssistantMessage.value?.content) return '';
  return sanitizeAssistantVisibleText(latestAssistantMessage.value.content);
});

function normalizeNarrativeText(raw = '') {
  const safeRaw = sanitizeAssistantVisibleText(raw)
  const plain = String(safeRaw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\|.*\|/g, ' ')
    .replace(/[#>*`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!plain) return ''
  if (plain.length <= 180) return plain

  const sentenceMatch = plain.match(/^(.{40,220}?[。！？!?])(.*)$/)
  if (sentenceMatch?.[1]) return sentenceMatch[1].trim()
  return `${plain.slice(0, 180)}...`
}

function isWeakFeatureClaimText(text = '') {
  const probe = String(text || '')
  if (!probe) return false

  const weakTokens = /(道路名|道路|路口|楼栋号?|门牌号?|停车场|出入口|宾馆酒店|宾馆|酒店)/i
  const claimTokens = /(明显特征|核心特征|主特征|关键特征)/i
  return weakTokens.test(probe) && claimTokens.test(probe)
}

function buildEvidenceNarrative(message) {
  const hotspots = Array.isArray(message?.spatialClusters?.hotspots) ? message.spatialClusters.hotspots : []
  const regions = Array.isArray(message?.vernacularRegions) ? message.vernacularRegions : []
  const fuzzyRegions = Array.isArray(message?.fuzzyRegions) ? message.fuzzyRegions : []

  const hotspotCount = hotspots.length
  const regionCount = regions.length
  const fuzzyCount = fuzzyRegions.length

  if (hotspotCount === 0 && regionCount === 0 && fuzzyCount === 0) {
    return ''
  }

  const topHotspot = hotspots[0] || null
  const topRegion = regions[0] || null
  const hotspotLabel = String(
    topHotspot?.name ||
    topHotspot?.dominantCategories?.[0]?.category ||
    topHotspot?.dominant_categories?.[0]?.category ||
    ''
  ).trim()
  const regionLabel = String(
    topRegion?.name ||
    topRegion?.dominant_category ||
    topRegion?.theme ||
    ''
  ).trim()

  const parts = [
    `已识别 ${hotspotCount} 个高密度热点、${regionCount} 个主导业态片区、${fuzzyCount} 个边界模糊片区。`
  ]

  if (hotspotLabel) {
    parts.push(`当前热点锚点为「${hotspotLabel}」附近。`)
  }
  if (regionLabel) {
    parts.push(`建议优先围绕「${regionLabel}」做机会验证与对比追问。`)
  }

  return parts.join('')
}

const analysisNarrativeText = computed(() => {
  const message = latestAssistantMessage.value
  if (!message) return ''

  const fromEvidence = buildEvidenceNarrative(message)
  if (fromEvidence) return fromEvidence

  const fromContent = normalizeNarrativeText(message.content || '')
  if (fromContent && !isWeakFeatureClaimText(fromContent)) {
    return fromContent
  }

  return ''
})

// 监听最新 assistant 文本，自动提取 POI（避免 deep watch 导致频繁重算）
watch(latestAssistantMessageText, (latestText) => {
  if (isTyping.value || !latestText) return;
  const pois = extractPOIsFromResponse(latestText);
  if (pois.length > 0) {
    extractedPOIs.value = pois;
    console.log('[AiChat] extracted POI count:', pois.length);
  }
});

watch(() => props.poiFeatures, (newVal, oldVal) => {
  if (newVal?.length > 0 && newVal.length !== oldVal?.length) {
    // 可以在这里添加提示消息
    console.log(`[AiChat] POI data updated: ${newVal.length}`);
  }
}, { deep: false });

onMounted(() => {
  stopStatusPolling();
  checkOnlineStatus().catch(() => {});
});

/**
 * 自动发送消息（供父组件调用）
 * 用于复杂查询时，自动打开 AI 面板并发送用户输入
 * @param {string} message - 要发送的消息内容
 */
async function autoSendMessage(message) {
  if (!message || !message.trim()) return;

  await sendMessage(message.trim());
}

// 暴露方法给父组件
defineExpose({
  clearChat,
  checkOnlineStatus,
  autoSendMessage
});
</script>

<style scoped>
.ai-chat-container {
  --panel-bg-1: #071224;
  --panel-bg-2: #0c1c34;
  --panel-bg-3: #0f2f44;
  --line-soft: rgba(132, 171, 207, 0.2);
  --line-strong: rgba(90, 170, 230, 0.42);
  --text-main: #e6eef8;
  --text-dim: rgba(194, 213, 233, 0.76);
  --primary: #2eb8ff;
  --surface: rgba(10, 20, 38, 0.8);
  --surface-2: rgba(12, 26, 46, 0.78);
  --ok: #34d399;
  --warn: #fb7185;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--text-main);
  font-family: 'Manrope', 'Noto Sans SC', 'PingFang SC', sans-serif;
  background:
    radial-gradient(circle at 82% 0%, rgba(31, 113, 162, 0.24), transparent 44%),
    radial-gradient(circle at 0% 30%, rgba(24, 75, 126, 0.25), transparent 38%),
    linear-gradient(160deg, var(--panel-bg-1), var(--panel-bg-2) 52%, var(--panel-bg-3));
  border-left: 1px solid var(--line-soft);
  box-shadow: -8px 0 34px rgba(2, 8, 20, 0.35);
}

.chat-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line-soft);
  background: linear-gradient(180deg, rgba(8, 18, 33, 0.9), rgba(8, 18, 33, 0.62));
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}

.header-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.header-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.header-meta-row {
  display: flex;
  margin-top: 10px;
}

.location-meta-pill {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid rgba(120, 154, 189, 0.2);
  background: rgba(8, 19, 34, 0.56);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.location-meta-pill.compact {
  padding: 4px 8px;
  gap: 6px;
  background: rgba(8, 19, 34, 0.42);
}

.location-meta-pill.is-active {
  border-color: rgba(67, 189, 148, 0.32);
  background: rgba(11, 60, 58, 0.28);
}

.location-meta-pill.is-accent {
  border-color: rgba(86, 175, 255, 0.34);
  background: rgba(18, 55, 92, 0.34);
}

.location-meta-pill.is-warning {
  border-color: rgba(250, 181, 92, 0.3);
  background: rgba(88, 55, 23, 0.28);
}

.location-meta-pill.is-neutral {
  border-color: rgba(122, 146, 179, 0.22);
}

.location-meta-label {
  font-size: 12px;
  font-weight: 700;
  color: #e8f0fa;
  white-space: nowrap;
}

.location-meta-detail {
  min-width: 0;
  color: rgba(196, 212, 230, 0.78);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: #f8fbff;
  border: 1px solid rgba(133, 183, 221, 0.35);
  background: linear-gradient(145deg, rgba(36, 88, 142, 0.55), rgba(24, 46, 82, 0.85));
}

.header-info {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.header-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.ai-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.ai-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
}

.ai-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 999px;
}

.ai-status.online {
  color: #9ceec9;
}

.ai-status.online::before {
  background: var(--ok);
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.18);
}

.ai-status.offline {
  color: #fda4af;
}

.ai-status.offline::before {
  background: var(--warn);
  box-shadow: 0 0 0 4px rgba(251, 113, 133, 0.15);
}

.ai-status.probing {
  color: #93c5fd;
}

.ai-status.probing::before {
  background: #60a5fa;
  box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.15);
}

.poi-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(94, 186, 245, 0.35);
  background: rgba(6, 85, 128, 0.34);
  font-size: 11px;
  color: #d8efff;
}

.poi-icon {
  font-size: 10px;
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
  color: #d8e7f7;
}

.location-btn {
  width: auto;
  min-width: 118px;
  height: 32px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(28, 72, 116, 0.82), rgba(20, 44, 74, 0.78));
  border-color: rgba(112, 184, 255, 0.4);
  font-size: 12px;
  font-weight: 700;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.location-btn-icon {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.location-btn-label {
  white-space: nowrap;
}

.location-btn.is-active {
  background: linear-gradient(135deg, rgba(20, 109, 86, 0.86), rgba(11, 70, 58, 0.82));
  border-color: rgba(102, 222, 182, 0.42);
  color: #dbfff3;
}

.location-btn.is-warning {
  background: linear-gradient(135deg, rgba(118, 74, 23, 0.82), rgba(79, 49, 16, 0.8));
  border-color: rgba(245, 184, 92, 0.4);
  color: #ffedc9;
}

.location-btn.is-neutral {
  background: linear-gradient(135deg, rgba(24, 55, 88, 0.78), rgba(17, 37, 64, 0.76));
}

.location-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.clear-btn {
  background: rgba(183, 45, 63, 0.25);
  border-color: rgba(240, 101, 123, 0.3);
}

.save-btn {
  background: rgba(25, 126, 99, 0.24);
  border-color: rgba(87, 222, 175, 0.3);
}

.refresh-btn {
  background: rgba(33, 124, 201, 0.24);
  border-color: rgba(117, 195, 255, 0.3);
}

.refresh-btn.active {
  background: rgba(9, 165, 120, 0.32);
  border-color: rgba(109, 237, 186, 0.5);
  color: #d9fff2;
}

.close-btn {
  background: rgba(38, 91, 150, 0.24);
  border-color: rgba(111, 188, 255, 0.3);
}

.action-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(179, 221, 255, 0.42);
}

.chat-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  padding: 10px 10px 0;
  flex: 1;
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 8px 14px;
  scroll-behavior: smooth;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(123, 168, 209, 0.4);
}

.welcome-message {
  min-height: auto;
  padding: 4px 2px 14px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.welcome-shell {
  display: grid;
  gap: 12px;
  width: 100%;
}

.welcome-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.welcome-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.welcome-hero {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(114, 169, 223, 0.18);
  background: linear-gradient(180deg, rgba(8, 21, 37, 0.96), rgba(9, 24, 42, 0.9));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.welcome-kicker {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(117, 198, 255, 0.22);
  background: rgba(12, 31, 55, 0.44);
  color: #dcefff;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.welcome-route-pill,
.welcome-location-note {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(112, 158, 205, 0.24);
  background: rgba(8, 26, 45, 0.64);
  color: #dff2ff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
}

.welcome-route-pill.is-active,
.welcome-location-note.is-active {
  border-color: rgba(74, 222, 128, 0.34);
  background: rgba(14, 78, 55, 0.34);
  color: #dcfff0;
}

.welcome-route-pill.is-accent,
.welcome-location-note.is-accent {
  border-color: rgba(125, 211, 252, 0.34);
  background: rgba(8, 59, 89, 0.34);
  color: #dff4ff;
}

.welcome-route-pill.is-warning,
.welcome-location-note.is-warning {
  border-color: rgba(245, 184, 92, 0.34);
  background: rgba(94, 57, 19, 0.34);
  color: #ffebc7;
}

.welcome-command-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
}

.welcome-section-compact {
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(115, 170, 214, 0.16);
  background: rgba(8, 19, 34, 0.72);
}

.kicker-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #38bdf8;
}

.welcome-hero h3 {
  margin: 0;
  font-size: clamp(18px, 2.2vw, 22px);
  line-height: 1.2;
  color: #f7fbff;
  letter-spacing: -0.015em;
}

.welcome-hero p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(214, 230, 247, 0.78);
}

.welcome-meta-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.welcome-meta-chip {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(118, 160, 201, 0.16);
  background: rgba(8, 18, 31, 0.58);
}

.welcome-meta-chip.is-active {
  border-color: rgba(74, 222, 128, 0.34);
  background: rgba(10, 44, 36, 0.42);
}

.welcome-meta-chip.is-accent {
  border-color: rgba(125, 211, 252, 0.34);
  background: rgba(11, 48, 69, 0.38);
}

.welcome-meta-chip.is-neutral {
  border-color: rgba(148, 163, 184, 0.2);
}

.welcome-meta-chip.is-muted {
  opacity: 0.86;
}

.meta-chip-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(163, 191, 220, 0.72);
}

.meta-chip-value {
  color: #f4f9ff;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.welcome-formula {
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(119, 182, 235, 0.16);
  background: rgba(9, 24, 43, 0.58);
}

.formula-label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #a8ddff;
}

.formula-text {
  margin: 5px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(220, 234, 248, 0.8);
}

.welcome-section {
  display: grid;
  gap: 8px;
}

.welcome-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.welcome-section-head.compact {
  align-items: flex-start;
}

.welcome-section-head h4 {
  margin: 3px 0 0;
  font-size: 14px;
  color: #f4f9ff;
}

.welcome-section-head p {
  margin: 0;
  max-width: 320px;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(168, 192, 215, 0.68);
}

.welcome-section-kicker {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8fd8ff;
}

.scenario-list {
  display: grid;
  gap: 8px;
}

.scenario-list.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.scenario-card {
  --accent: 123, 170, 226;
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(var(--accent), 0.18);
  background: rgba(8, 18, 31, 0.72);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform 180ms ease,
    border-color 220ms ease,
    background 220ms ease;
}

.scenario-card.compact {
  gap: 8px;
  align-content: start;
  min-height: 88px;
}

.scenario-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.scenario-card:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--accent), 0.34);
  background: rgba(10, 23, 39, 0.9);
}

.scenario-card.accent-cyan {
  --accent: 56, 189, 248;
}

.scenario-card.accent-amber {
  --accent: 251, 191, 36;
}

.scenario-card.accent-emerald {
  --accent: 52, 211, 153;
}

.scenario-card.accent-violet {
  --accent: 167, 139, 250;
}

.scenario-card.accent-rose {
  --accent: 251, 113, 133;
}

.scenario-card.accent-slate {
  --accent: 148, 163, 184;
}

.scenario-badge {
  width: fit-content;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(var(--accent), 0.12);
  color: #e8f5ff;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.scenario-title {
  font-size: 14px;
  line-height: 1.35;
  color: #f8fbff;
}

.scenario-desc {
  font-size: 11px;
  line-height: 1.45;
  color: rgba(214, 230, 247, 0.74);
}

.welcome-examples {
  padding-top: 0;
}

.example-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.example-list.compact {
  gap: 6px;
}

.example-chip {
  border: 1px solid rgba(116, 169, 218, 0.24);
  border-radius: 12px;
  background: rgba(9, 24, 42, 0.74);
  color: #deefff;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  padding: 9px 12px;
  text-align: left;
  cursor: pointer;
  transition: transform 200ms ease, border-color 200ms ease, background 200ms ease;
}

.example-chip:hover {
  transform: translateY(-1px);
  border-color: rgba(136, 207, 255, 0.34);
  background: rgba(10, 31, 54, 0.88);
}

.message {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
  max-width: 100%;
  animation: msg-enter 220ms ease;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
}

.user .message-avatar {
  background: rgba(35, 98, 167, 0.7);
}

.assistant .message-avatar {
  border: 1px solid rgba(121, 171, 214, 0.28);
  background: rgba(13, 38, 69, 0.65);
}

.message-content {
  min-width: 0;
  display: grid;
  gap: 6px;
}

/* 思考过程展示组件样式 */
.thinking-process-container {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1));
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 8px;
  margin: 4px 0;
  overflow: hidden;
}

.thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.thinking-header:hover {
  background: rgba(139, 92, 246, 0.1);
}

.thinking-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.thinking-spinner {
  animation: spin 1s linear infinite;
  color: #8b5cf6;
}

.thinking-check {
  color: #22c55e;
}

.thinking-label {
  font-size: 12px;
  font-weight: 500;
  color: #a78bfa;
}

.thinking-expand-icon {
  color: #6b7280;
  transition: transform 0.2s;
}

.thinking-expand-icon.expanded {
  transform: rotate(180deg);
}

.thinking-content {
  max-height: 300px;
  overflow: hidden;
  transition: max-height 0.3s ease-out;
}

.thinking-content.collapsed {
  max-height: 0;
}

.thinking-text {
  padding: 8px 12px 12px;
  font-size: 12px;
  line-height: 1.68;
  color: #9ca3af;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(139, 92, 246, 0.2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 250px;
  overflow-y: auto;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.assistant .message-content {
  width: calc(100% - 42px);
}

.user .message-content {
  justify-items: end;
}

.message-text {
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.78;
  word-break: break-word;
}

.streaming-markdown {
  transition: opacity 120ms ease;
}

.user .message-text {
  background: linear-gradient(145deg, rgba(29, 102, 171, 0.38), rgba(25, 58, 101, 0.52));
  border: 1px solid rgba(112, 187, 250, 0.35);
  color: #eef6ff;
}

.assistant .message-text {
  background: linear-gradient(150deg, rgba(11, 27, 47, 0.88), rgba(11, 34, 58, 0.74));
  border: 1px solid rgba(116, 163, 205, 0.24);
  color: #e7f0fa;
}

.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3),
.message-text :deep(h4) {
  margin: 0 0 8px;
  line-height: 1.35;
  font-weight: 700;
  color: #f7fbff;
}

.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3) {
  padding-left: 10px;
  border-left: 3px solid rgba(91, 192, 255, 0.65);
}

.message-text :deep(h3) {
  font-size: 15px;
  color: #dff2ff;
}

.message-text :deep(p) {
  margin: 0;
  line-height: 1.78;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  margin: 2px 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
}

.message-text :deep(li) {
  padding-left: 2px;
  line-height: 1.72;
}

.message-text :deep(strong) {
  color: #ffffff;
}

.message-text :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 3px solid rgba(91, 192, 255, 0.5);
  background: rgba(9, 21, 36, 0.52);
  color: rgba(226, 242, 255, 0.92);
}


.message-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.message-risk-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11px;
  line-height: 1.3;
}

.cache-pill {
  border: 1px solid rgba(121, 182, 232, 0.38);
  background: rgba(16, 64, 104, 0.34);
  color: #d7ecff;
}

.cache-pill.hit {
  border-color: rgba(91, 220, 170, 0.45);
  background: rgba(13, 120, 89, 0.28);
  color: #c9ffeb;
}

.cache-pill.miss {
  border-color: rgba(141, 194, 238, 0.34);
  background: rgba(17, 60, 99, 0.3);
}

.risk-pill {
  border: 1px solid rgba(251, 146, 60, 0.45);
  background: rgba(146, 64, 14, 0.3);
  color: #ffe7cc;
}

.message-text :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(4, 11, 23, 0.66);
  overflow-x: auto;
}

.message-text :deep(code) {
  border-radius: 6px;
  background: rgba(7, 17, 34, 0.75);
  padding: 2px 5px;
  font-family: 'Fira Code', monospace;
  font-size: 12px;
}

.message-text :deep(table),
.message-text :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  background: rgba(7, 19, 35, 0.65);
  border-radius: 8px;
  overflow: hidden;
}

.message-text :deep(th),
.message-text :deep(td) {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(116, 163, 205, 0.2);
}

.message-text :deep(th) {
  background: rgba(20, 65, 108, 0.5);
}

.message-time {
  font-size: 11px;
  color: rgba(177, 199, 223, 0.62);
  padding: 0 2px;
}

.pipeline-tracker-inline {
  border-radius: 12px;
  border: 1px solid rgba(93, 154, 210, 0.22);
  background: linear-gradient(145deg, rgba(10, 25, 43, 0.92), rgba(15, 41, 68, 0.75));
  padding: 10px 10px 8px;
}

.pipeline-trace-inline {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(60px, 1fr));
  gap: 6px;
}

.trace-step-inline {
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 5px;
  position: relative;
}

.trace-step-inline::after {
  content: '';
  position: absolute;
  top: 11px;
  left: calc(50% + 14px);
  width: calc(100% - 26px);
  height: 1px;
  background: rgba(120, 164, 205, 0.3);
}

.trace-step-inline:last-child::after {
  display: none;
}

.trace-step-inline.completed::after,
.trace-step-inline.active::after {
  background: linear-gradient(90deg, rgba(46, 184, 255, 0.8), rgba(52, 211, 153, 0.8));
}

.step-icon-wrapper {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(128, 170, 206, 0.35);
  background: rgba(11, 31, 54, 0.8);
  display: grid;
  place-items: center;
  color: rgba(193, 215, 236, 0.72);
}

.trace-step-inline.active .step-icon-wrapper {
  border-color: rgba(46, 184, 255, 0.84);
  color: #dff4ff;
}

.trace-step-inline.completed .step-icon-wrapper {
  border-color: rgba(52, 211, 153, 0.78);
  background: rgba(10, 77, 67, 0.46);
  color: #dcfff5;
}

.step-spinner {
  animation: spin 900ms linear infinite;
}

.step-label-inline {
  font-size: 10px;
  text-align: center;
  line-height: 1.2;
  color: rgba(176, 199, 223, 0.72);
}

.trace-step-inline.active .step-label-inline {
  color: #dff4ff;
}

.trace-step-inline.completed .step-label-inline {
  color: #b9f4dc;
}

.step-number {
  font-size: 10px;
  font-weight: 700;
}

.pipeline-hint-inline {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  color: rgba(173, 211, 244, 0.74);
}

.pipeline-recognized-inline {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.recognized-pill {
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.45);
  background: rgba(15, 23, 42, 0.72);
  color: #eff6ff;
  font-size: 11px;
  padding: 4px 10px;
  line-height: 1.3;
}

.recognized-pill.subtle {
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(30, 41, 59, 0.55);
  color: #cbd5e1;
}

.recognized-pill.tentative {
  border-color: rgba(250, 204, 21, 0.55);
  background: rgba(113, 63, 18, 0.48);
  color: #fef3c7;
}

.pipeline-clarification-inline {
  margin-top: 7px;
  text-align: center;
  font-size: 11px;
  color: #fef3c7;
}

.pipeline-intent-inline {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.intent-pill {
  border-radius: 999px;
  border: 1px solid rgba(108, 176, 231, 0.5);
  background: rgba(15, 59, 97, 0.55);
  color: #dff4ff;
  font-size: 10px;
  padding: 3px 8px;
}

.pipeline-prefetch-inline {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px;
}

.prefetch-pill {
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.52);
  background: rgba(8, 47, 73, 0.55);
  color: #dff4ff;
  font-size: 10px;
  padding: 2px 8px;
}

.prefetch-pill.is-effective {
  border-color: rgba(74, 222, 128, 0.65);
  background: rgba(21, 78, 50, 0.48);
  color: #dcfce7;
}

.prefetch-pill.is-wasted {
  border-color: rgba(250, 204, 21, 0.72);
  background: rgba(113, 63, 18, 0.52);
  color: #fef3c7;
}

.prefetch-pill.is-degraded {
  border-color: rgba(251, 146, 60, 0.72);
  background: rgba(124, 45, 18, 0.52);
  color: #ffedd5;
}

.prefetch-overlap-inline {
  font-size: 10px;
  color: rgba(191, 219, 254, 0.85);
}

.analysis-board {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background:
    radial-gradient(circle at 15% 10%, rgba(31, 109, 163, 0.15), transparent 40%),
    linear-gradient(180deg, rgba(7, 20, 37, 0.94), rgba(9, 27, 47, 0.9));
  box-shadow: inset 0 1px 0 rgba(165, 210, 247, 0.06);
  overflow: hidden;
  transition: border-color 220ms ease;
}

.analysis-board-inline {
  margin: 8px 0 10px 42px;
  width: calc(100% - 42px);
}

.analysis-board-header {
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  border-bottom: 1px solid rgba(122, 166, 202, 0.2);
}

.analysis-kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #9bd5ff;
}

.analysis-title {
  margin: 2px 0 0;
  font-size: 14px;
  color: #eff7ff;
}

.analysis-meta {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #d8efff;
  background: rgba(8, 74, 114, 0.38);
  border: 1px solid rgba(109, 178, 233, 0.35);
}

.analysis-board-content {
  padding: 10px;
}

.analysis-narrative {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(115, 170, 214, 0.24);
  background: linear-gradient(140deg, rgba(10, 31, 56, 0.7), rgba(9, 24, 43, 0.78));
  color: rgba(226, 239, 252, 0.92);
  font-size: 13px;
  line-height: 1.6;
}

.analysis-empty-state {
  border: 1px dashed rgba(112, 163, 206, 0.4);
  border-radius: 12px;
  background: rgba(8, 27, 47, 0.55);
  padding: 14px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.analysis-empty-title {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
  color: #e8f5ff;
}

.chat-input-area {
  padding: 12px 12px 14px;
  border-top: 1px solid var(--line-soft);
  background: linear-gradient(180deg, rgba(10, 24, 43, 0.88), rgba(7, 16, 28, 0.96));
  box-shadow: 0 -16px 30px rgba(3, 8, 18, 0.18);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  border-radius: 18px;
  border: 1px solid rgba(120, 166, 206, 0.35);
  background: linear-gradient(145deg, rgba(10, 24, 42, 0.94), rgba(8, 19, 34, 0.92));
  padding: 10px 12px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.input-wrapper:focus-within {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 2px rgba(46, 184, 255, 0.18);
}

.input-wrapper textarea {
  flex: 1;
  border: none;
  resize: none;
  outline: none;
  max-height: 120px;
  line-height: 1.45;
  font-size: 14px;
  color: #edf6ff;
  background: transparent;
  font-family: inherit;
}

.input-wrapper textarea::placeholder {
  color: rgba(178, 201, 227, 0.5);
}

.send-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(96, 185, 244, 0.55);
  color: #eff8ff;
  background: linear-gradient(140deg, rgba(27, 132, 198, 0.95), rgba(28, 87, 182, 0.92));
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 16px rgba(19, 90, 164, 0.4);
}

.send-btn:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.input-hint {
  margin-top: 6px;
  padding: 0 2px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(172, 196, 223, 0.65);
}

.offline-hint {
  color: #fda4af;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.probing-hint {
  color: #93c5fd;
}

.retry-link {
  border: 0;
  background: transparent;
  color: #60a5fa;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  text-decoration: underline;
}

.retry-link:hover {
  color: #93c5fd;
}

@keyframes msg-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .chat-header {
    padding: 10px 12px;
  }

  .header-main-row {
    align-items: flex-start;
  }

  .header-actions {
    gap: 6px;
  }

  .location-btn {
    min-width: 88px;
    padding: 0 10px;
  }

  .location-meta-pill {
    width: 100%;
  }

  .chat-body {
    padding: 8px 8px 0;
  }

  .analysis-board-inline {
    margin-left: 0;
    width: 100%;
  }

  .pipeline-trace-inline {
    gap: 2px;
  }

  .step-icon-wrapper {
    width: 20px;
    height: 20px;
  }

  .step-label-inline {
    font-size: 9px;
  }

  .welcome-message {
    min-height: auto;
    padding: 2px 0 14px;
  }

  .welcome-hero {
    padding: 16px;
  }

  .welcome-section-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .welcome-command-grid {
    grid-template-columns: 1fr;
  }

  .scenario-list.compact {
    grid-template-columns: 1fr;
  }

  .welcome-meta-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .welcome-hero h3 {
    font-size: 22px;
  }

  .header-main-row {
    flex-wrap: wrap;
  }

  .header-actions {
    width: 100%;
  }

  .location-btn {
    order: -1;
  }

  .welcome-meta-strip {
    grid-template-columns: 1fr;
  }

  .example-chip {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .message,
  .scenario-card,
  .example-chip,
  .action-btn,
  .send-btn,
  .analysis-board,
  .input-wrapper,
  .step-spinner {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }

  .chat-messages {
    scroll-behavior: auto;
  }
}
</style>

