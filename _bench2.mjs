const queries = ['光谷附近美食', '武汉大学附近咖啡店']

async function run() {
  for (const q of queries) {
    const t0 = Date.now()
    const res = await fetch('http://127.0.0.1:3210/api/geo/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: q }],
        options: { requestId: 'bench-' + Date.now() },
      }),
    })
    const body = await res.text()
    const totalMs = Date.now() - t0

    const blocks = body.split('\n\n').filter(Boolean)
    let refined = null
    for (const block of blocks) {
      const lines = block.split('\n')
      let ev = ''
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) ev = line.slice(7)
        if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (ev === 'refined_result') {
        refined = JSON.parse(data)
        break
      }
    }

    const traces = refined?.tool_calls || []
    const discTrace = traces.find(t => t.skill === 'web_poi_discovery')
    const timings = discTrace?.result?.timings || {}
    const toolSummary = traces.map(t => `${t.skill}.${t.action}=${t.latency_ms}ms`).join(', ')

    const d = discTrace?.result || {}
    const t = timings
    const ex = d.extractStats || {}
    console.log(`[${q}] total=${totalMs}ms tools=${traces.length} disc=${discTrace?.latency_ms||'-'}ms rds=${d.searchRounds||'-'} s=${t.search||0} e=${t.extract||0} m=${t.mentionExtraction||0} mt=${t.matching||0} ex=${ex.succeededUrls??'-'}/${ex.attemptedUrls??'-'} fail=${ex.failedUrls??'-'} rate=${ex.successRate??'-'} blkU=${ex.blockedUrls??'-'} blkD=${ex.blockedDomains??'-'} v=${Array.isArray(d.verifiedDbPois)?d.verifiedDbPois.length:d.verifiedDbPois??'-'} db=${Array.isArray(d.dbOnlyPois)?d.dbOnlyPois.length:d.dbOnlyPois??'-'} unr=${Array.isArray(d.webUnresolvedMentions)?d.webUnresolvedMentions.length:'-'}`)

    // 输出最终返回给前端的 POI 列表
    const pois = refined?.results?.pois || []
    console.log(`  最终POI: ${pois.length} 个`)
    if (pois.length > 0) {
      console.log(`  [DEBUG] 第1个POI字段: ${JSON.stringify(Object.keys(pois[0]))}`)
      console.log(`  [DEBUG] 第1个POI: ${JSON.stringify(pois[0]).slice(0, 300)}`)
    }
    for (let i = 0; i < Math.min(pois.length, 10); i++) {
      const p = pois[i]
      const name = p.name || p.poiName || p.poi_name || '?'
      const cat = p.categorySub || p.category_sub || p.categoryMain || p.category_main || p.poiCategory || '-'
      const meta = p.meta || {}
      const score = p.poiScore ?? meta.poiScore ?? meta.poi_score ?? p.confidence ?? '-'
      const src = meta.source ?? meta.verification ?? p.source ?? '-'
      const dist = p.distance_m ?? p.distance ?? meta.distance_m ?? '-'
      const verif = meta.verification ?? '-'
      console.log(`    ${i+1}. ${name} | cat=${cat} | dist=${typeof dist==='number'?dist.toFixed(0):dist}m | src=${src} | verif=${verif} | score=${score}`)
    }
  }
}

run().catch(e => console.error(e))
