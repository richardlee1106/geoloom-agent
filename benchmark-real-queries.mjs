#!/usr/bin/env node
/**
 * 实测 3 条典型 nearby/discovery 查询的性能
 * 收集指标：intentMs, evidenceRuntimeMs, synthesisMs, llmRoundCount, toolCallCount, discovery timings
 */
import dotenv from 'dotenv'

dotenv.config({ path: 'backend/.env' })

const BASE_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3210'
const TIMEOUT_MS = 120000

const QUERIES = [
  {
    id: 'hankou-scenic',
    query: '汉口景点推荐',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
  },
  {
    id: 'guanggu-food',
    query: '光谷附近美食',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
  },
  {
    id: 'whu-coffee',
    query: '武汉大学附近咖啡店',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
  },
]

async function checkHealth() {
  const res = await fetch(`${BASE_URL}/api/geo/health`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    throw new Error(`Backend health check failed: ${res.status}`)
  }
  const payload = await res.json()
  console.log('[健康检查] 后端运行正常')
  console.log(`  - provider: ${payload.llm.provider}`)
  console.log(`  - model: ${payload.llm.model}`)
  console.log(`  - provider_ready: ${payload.provider_ready}`)
  console.log(`  - requests_total: ${payload.metrics.requests_total}`)
  console.log(`  - latency_p50: ${payload.metrics.latency.p50_ms}ms`)
  console.log(`  - latency_p95: ${payload.metrics.latency.p95_ms}ms`)
  return payload
}

function parseSSE(body) {
  const lines = body.split('\n')
  const events = []
  let currentEvent = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (currentEvent) {
        events.push(currentEvent)
        currentEvent = null
      }
      continue
    }
    if (trimmed.startsWith('event: ')) {
      currentEvent = { event: trimmed.slice(7), data: null }
    } else if (trimmed.startsWith('data: ') && currentEvent) {
      try {
        currentEvent.data = JSON.parse(trimmed.slice(6))
      } catch (e) {
        console.log(`[SSE解析错误] ${trimmed}`)
        currentEvent.data = null
      }
    }
  }
  if (currentEvent) {
    events.push(currentEvent)
  }
  return events
}

async function runQuery(queryCase) {
  console.log(`\n[查询] ${queryCase.query}`)
  const startTime = Date.now()

  const res = await fetch(`${BASE_URL}/api/geo/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: queryCase.query }],
      options: {
        requestId: queryCase.id,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Query failed: ${res.status} ${res.statusText}`)
  }

  const body = await res.text()
  const totalLatency = Date.now() - startTime
  console.log(`  [调试] 响应长度: ${body.length} 字符`)
  const events = parseSSE(body)
  console.log(`  [调试] 收到 ${events.length} 个 SSE 事件`)
  console.log(`  [调试] 事件类型: ${events.map(e => e.event).join(', ')}`)

  const refined = events.find((e) => e.event === 'refined_result')?.data
  const done = events.find((e) => e.event === 'done')?.data

  if (!refined) {
    throw new Error('Missing refined_result event')
  }
  if (!done) {
    throw new Error('Missing done event')
  }

  const stats = refined.results?.stats || refined.stats || {}
  const evidenceView = refined.results?.evidence_view || refined.evidence_view || {}

  console.log(`  ✓ query_type: ${stats.query_type}`)
  console.log(`  ✓ evidence_type: ${evidenceView.type}`)
  console.log(`  ✓ total_latency: ${totalLatency}ms`)
  console.log(`  ✓ intent_source: ${stats.intent_source || stats.llm_source || 'N/A'}`)

  // 尝试多个可能的字段名
  const intentLatency = stats.intent_latency_ms || stats.intentMs || stats.intent_latency || 'N/A'
  const evidenceLatency = stats.evidence_runtime_latency_ms || stats.evidenceMs || stats.evidence_runtime_latency || 'N/A'
  const synthesisLatency = stats.synthesis_latency_ms || stats.synthesisMs || stats.synthesis_latency || 'N/A'

  console.log(`  ✓ intent_latency: ${intentLatency}ms`)
  console.log(`  ✓ evidence_runtime_latency: ${evidenceLatency}ms`)
  console.log(`  ✓ synthesis_latency: ${synthesisLatency}ms`)
  console.log(`  ✓ llm_rounds: ${stats.llm_round_count || stats.llmRoundCount || 0}`)
  console.log(`  ✓ tool_calls: ${stats.tool_call_count || stats.toolCallCount || 0}`)
  console.log(`  ✓ answer_length: ${refined.answer?.length || 0} chars`)

  // 检查 discovery timings - 尝试多个可能的字段路径
  const traces = stats.tool_traces || stats.traces || refined.tool_calls || []
  const discoveryTrace = traces.find((t) => t.atom === 'web.poi_discovery')
    || traces.find((t) => t.skill === 'web_poi_discovery' && t.action === 'discover_pois')
  if (discoveryTrace) {
    console.log(`  [Discovery Trace] 发现 web.poi_discovery 原子`)
    console.log(`    - atom: ${discoveryTrace.atom || `${discoveryTrace.skill}.${discoveryTrace.action}`}`)
    console.log(`    - status: ${discoveryTrace.status}`)
    if (discoveryTrace.result) {
      console.log(`    - result keys: ${Object.keys(discoveryTrace.result).join(', ')}`)
      const timings = discoveryTrace.result.timings
      if (timings) {
        console.log(`  [Discovery Timings]`)
        console.log(`    - profile: ${timings.profile}ms`)
        console.log(`    - shortlist: ${timings.shortlist}ms`)
        console.log(`    - search: ${timings.search}ms`)
        console.log(`    - extract: ${timings.extract}ms`)
        console.log(`    - mentionExtraction: ${timings.mentionExtraction}ms`)
        console.log(`    - normalization: ${timings.normalization}ms`)
        console.log(`    - matching: ${timings.matching}ms`)
        console.log(`    - total: ${timings.total}ms`)
        console.log(`    - searchRounds: ${discoveryTrace.result.searchRounds}`)
        console.log(`    - dbMatchCount: ${discoveryTrace.result.dbMatchCount}`)
        console.log(`    - verifiedDbPois: ${discoveryTrace.result.verifiedDbPois?.length || 0}`)
        console.log(`    - dbOnlyPois: ${discoveryTrace.result.dbOnlyPois?.length || 0}`)
      } else {
        console.log(`  [Discovery Timings] timings 字段不存在`)
        console.log(`    - result: ${JSON.stringify(discoveryTrace.result).slice(0, 200)}`)
      }
    }
  } else {
    console.log(`  [Discovery Trace] 未找到 web.poi_discovery 原子`)
    console.log(`    - 所有原子: ${traces.map(t => t.atom || `${t.skill}.${t.action}`).join(', ')}`)
  }

  return {
    query: queryCase.query,
    totalLatency,
    intentSource: stats.intent_source,
    intentLatency: stats.intent_latency_ms,
    evidenceRuntimeLatency: stats.evidence_runtime_latency_ms,
    synthesisLatency: stats.synthesis_latency_ms,
    llmRounds: stats.llm_round_count,
    toolCalls: stats.tool_call_count,
    discoveryTimings: discoveryTrace?.result?.timings,
    dbMatchCount: discoveryTrace?.result?.dbMatchCount,
  }
}

async function main() {
  console.log('=== GeoLoom Agent 实测 ===')
  console.log(`后端地址: ${BASE_URL}`)
  console.log(`超时设置: ${TIMEOUT_MS}ms\n`)

  try {
    await checkHealth()
  } catch (e) {
    console.error(`[错误] 后端未运行或不可访问: ${e.message}`)
    console.log('请先启动后端: node scripts/run-backend-v4.mjs')
    process.exit(1)
  }

  const results = []
  for (const queryCase of QUERIES) {
    try {
      const result = await runQuery(queryCase)
      results.push(result)
    } catch (e) {
      console.error(`[错误] 查询失败: ${e.message}`)
      results.push({ query: queryCase.query, error: e.message })
    }
  }

  console.log('\n=== 汇总 ===')
  for (const r of results) {
    if (r.error) {
      console.log(`❌ ${r.query}: ${r.error}`)
    } else {
      console.log(`✅ ${r.query}`)
      console.log(`   total: ${r.totalLatency}ms, intent: ${r.intentSource}, rounds: ${r.llmRounds}, tools: ${r.toolCalls}`)
    }
  }

  // 计算平均值（忽略失败的）
  const successful = results.filter((r) => !r.error)
  if (successful.length > 0) {
    const avgTotal = Math.round(successful.reduce((a, b) => a + b.totalLatency, 0) / successful.length)
    const avgIntent = Math.round(successful.reduce((a, b) => a + (b.intentLatency || 0), 0) / successful.length)
    const avgEvidence = Math.round(successful.reduce((a, b) => a + (b.evidenceRuntimeLatency || 0), 0) / successful.length)
    const avgSynthesis = Math.round(successful.reduce((a, b) => a + (b.synthesisLatency || 0), 0) / successful.length)
    const avgLlmRounds = Math.round(successful.reduce((a, b) => a + (b.llmRounds || 0), 0) / successful.length)
    const avgToolCalls = Math.round(successful.reduce((a, b) => a + (b.toolCalls || 0), 0) / successful.length)

    console.log(`\n[平均指标]`)
    console.log(`  total_latency: ${avgTotal}ms`)
    console.log(`  intent_latency: ${avgIntent}ms`)
    console.log(`  evidence_runtime_latency: ${avgEvidence}ms`)
    console.log(`  synthesis_latency: ${avgSynthesis}ms`)
    console.log(`  llm_rounds: ${avgLlmRounds}`)
    console.log(`  tool_calls: ${avgToolCalls}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
