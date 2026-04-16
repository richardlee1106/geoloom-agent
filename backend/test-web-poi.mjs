#!/usr/bin/env node
/**
 * 直接测试 WebPoiDiscoverySkill，绕过 server tsx 缓存
 */
import { createWebPoiDiscoverySkill } from './src/skills/web_poi_discovery/index.js'
import { createLogger } from './src/utils/logger.js'

const skill = createWebPoiDiscoverySkill({
  tavilyApiKey: process.env.TAVILY_API_KEY || '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',
  crawl4aiUrl: process.env.CRAWL4AI_URL || 'http://127.0.0.1:11235',
  nerUrl: process.env.NER_URL || 'http://127.0.0.1:5100',
  query: async (sql, params) => {
    console.log('[DB] SQL:', sql)
    console.log('[DB] params:', params)
    return { rows: [] } // Mock DB
  },
})

const tests = [
  { query: '光谷咖啡店推荐', districts: ['洪山区'], max_results: 10 },
  { query: '武大附近餐馆', districts: ['武昌区'], max_results: 10 },
  { query: '江汉路美食', districts: ['江汉区'], max_results: 10 },
  { query: '光谷东酒店', districts: ['洪山区'], max_results: 10 },
  { query: '东湖公园景点', districts: ['武昌区'], max_results: 10 },
]

async function runTest(test, idx) {
  console.log(`\n=== Q${idx + 1}: ${test.query} ===`)
  const start = Date.now()
  const result = await skill.execute(
    'discover_pois',
    test,
    {
      traceId: `test-${idx}`,
      logger: createLogger(),
    },
  )
  const latency = Date.now() - start

  if (result.ok) {
    const { profile, timings, topVenues, dbMatchCount, totalCandidates, searchRounds } = result.data
    console.log(`profile=${profile.key} label=${profile.label}`)
    console.log(`dbMatch=${dbMatchCount} total=${totalCandidates} rounds=${searchRounds}`)
    console.log(`timings: search=${timings.search}ms fetch=${timings.fetch}ms ner=${timings.ner}ms filter=${timings.filter}ms dbMatch=${timings.dbMatch}ms`)
    console.log(`latency=${latency}ms`)
    console.log(`Top 5:`)
    topVenues.slice(0, 5).forEach((v) => {
      console.log(`  ${v.nerName} | poi=${v.poiName || 'null'} | match=${v.matchType}`)
    })
  } else {
    console.log(`ERROR: ${result.error.code} - ${result.error.message}`)
  }
}

for (let i = 0; i < tests.length; i++) {
  await runTest(tests[i], i)
}
