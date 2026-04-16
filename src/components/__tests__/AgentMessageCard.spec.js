import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AgentMessageCard from '../AgentMessageCard.vue'

function createMessage() {
  return {
    role: 'assistant',
    content: '当前片区餐饮密度较高，但精品咖啡仍有结构性机会。',
    timestamp: Date.now(),
    pipelineCompleted: true,
    isStreaming: false,
    isThinking: false,
    runStartedAt: 1000,
    runCompletedAt: 5200,
    intentMeta: {
      intentMode: 'macro_overview',
      queryType: 'area_analysis',
    },
    pois: [{ id: 'poi-1', name: '测试 POI' }],
    agentEvents: [
      {
        id: 'evt-1',
        type: 'queued',
        state: 'info',
        title: '已接收问题',
        detail: '开始准备当前轮分析',
        timestamp: 1000,
      },
      {
        id: 'evt-2',
        type: 'refined_result',
        state: 'success',
        title: '汇总证据并生成回答',
        detail: '已返回结构化结果',
        timestamp: 3000,
      },
    ],
    toolCalls: [
      {
        skill: 'postgis',
        action: 'viewport_poi_scan',
        status: 'done',
        latency_ms: 182,
      },
    ],
    toolCallsRecordedAt: 2800,
  }
}

describe('AgentMessageCard', () => {
  it('renders answer-first layout and expands integrated process timeline on demand', async () => {
    const wrapper = mount(AgentMessageCard, {
      props: {
        message: createMessage(),
        messageHtml: '<p>当前片区餐饮密度较高，但精品咖啡仍有结构性机会。</p>',
        formattedTime: '14:32',
        embeddedIntentMode: 'macro',
        showTagCloud: true,
      },
      global: {
        stubs: {
          EmbeddedTagCloud: {
            template: '<div class="embedded-tagcloud-stub">地名标签云</div>',
          },
        },
      },
    })

    expect(wrapper.find('.agent-answer').text()).toContain('精品咖啡仍有结构性机会')
    expect(wrapper.find('.embedded-tagcloud-stub').exists()).toBe(true)
    expect(wrapper.find('.agent-process-panel').exists()).toBe(false)

    await wrapper.find('.agent-process-toggle').trigger('click')

    expect(wrapper.find('.agent-process-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('已接收问题')
    expect(wrapper.text()).toContain('postgis.viewport_poi_scan')
    expect(wrapper.text()).toContain('已完成分析')
    expect(wrapper.text()).toContain('用时 4.2 s')
  })

  it('renders tavily and poi discovery labels in the web search debug card', () => {
    const message = createMessage()
    message.webSearchResultCount = 10
    message.webSearchPagesRead = 10
    message.webSearchSources = ['tavily', 'poi_discovery']
    message.webSearchResults = [
      { title: '光谷步行街牛肉面' },
      { title: '世界城广场美食街' }
    ]

    const wrapper = mount(AgentMessageCard, {
      props: {
        message,
        messageHtml: '<p>测试</p>',
        formattedTime: '14:32',
        embeddedIntentMode: 'macro',
        showTagCloud: false,
      },
    })

    expect(wrapper.text()).toContain('Tavily')
    expect(wrapper.text()).toContain('POI发现')
  })
})
