const queries = [
  '光谷附近美食',
  '东湖附近景点',
  '东湖附近公园',
  '光谷附近酒店',
]

function parseRefinedResult(body) {
  const blocks = body.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const lines = block.split('\n')
    let ev = ''
    let data = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) ev = line.slice(7)
      if (line.startsWith('data: ')) data += line.slice(6)
    }
    if (ev === 'refined_result') {
      return JSON.parse(data)
    }
  }
  return null
}

async function runOne(q) {
  const t0 = Date.now()
  const res = await fetch('http://127.0.0.1:3210/api/geo/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: q }],
      options: { requestId: 'bench4-' + Date.now() },
    }),
  })
  const body = await res.text()
  const totalMs = Date.now() - t0
  const refined = parseRefinedResult(body)

  const traces = refined?.tool_calls || []
  const discTrace = traces.find((t) => t.skill === 'web_poi_discovery')
  const d = discTrace?.result || {}
  const t = d.timings || {}
  const ex = d.extractStats || {}
  const profileKey = d.profile?.key || '-'

  console.log(`\n[${q}] profile=${profileKey} total=${totalMs}ms disc=${discTrace?.latency_ms || '-'}ms rds=${d.searchRounds || '-'} s=${t.search || 0} e=${t.extract || 0} m=${t.mentionExtraction || 0} mt=${t.matching || 0} ex=${ex.succeededUrls ?? '-'}/${ex.attemptedUrls ?? '-'} fail=${ex.failedUrls ?? '-'} rate=${ex.successRate ?? '-'} v=${Array.isArray(d.verifiedDbPois) ? d.verifiedDbPois.length : d.verifiedDbPois ?? '-'} db=${Array.isArray(d.dbOnlyPois) ? d.dbOnlyPois.length : d.dbOnlyPois ?? '-'} unr=${Array.isArray(d.webUnresolvedMentions) ? d.webUnresolvedMentions.length : '-'}`)

  const shortlist = Array.isArray(d.shortlist) ? d.shortlist : []
  if (shortlist.length > 0) {
    console.log('  Shortlist Top10:')
    shortlist.slice(0, 10).forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.name} | cat=${p.categorySub || p.categoryMain || '-'}`)
    })
  }

  const pois = refined?.results?.pois || []
  console.log(`  最终POI: ${pois.length} 个`)
  pois.slice(0, 10).forEach((p, i) => {
    const meta = p.meta || {}
    console.log(`    ${i + 1}. ${p.name} | cat=${p.categorySub || p.categoryMain || '-'} | src=${meta.source || '-'} | verif=${meta.verification || '-'}`)
  })
}

async function run() {
  for (const q of queries) {
    try {
      await runOne(q)
    } catch (e) {
      console.error(`\n[${q}] bench失败:`, e)
    }
  }
}

run().catch((e) => console.error(e))
