// 只跑武大咖啡店查询，并从后端日志提取诊断信息
const q = '武汉大学附近咖啡店'

async function run() {
  const t0 = Date.now()
  const res = await fetch('http://127.0.0.1:3210/api/geo/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: q }],
      options: { requestId: 'diag-' + Date.now() },
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
  const d = discTrace?.result || {}
  const t = d.timings || {}
  const ex = d.extractStats || {}

  console.log(`total=${totalMs}ms, disc=${discTrace?.latency_ms||'-'}ms, rds=${d.searchRounds||'-'}`)
  console.log(`extract: attempted=${ex.attemptedUrls??'-'}, succeeded=${ex.succeededUrls??'-'}, failed=${ex.failedUrls??'-'}, successRate=${ex.successRate??'-'}, blockedUrls=${ex.blockedUrls??'-'}, blockedDomains=${ex.blockedDomains??'-'}`)
  console.log(`verified=${Array.isArray(d.verifiedDbPois)?d.verifiedDbPois.length:d.verifiedDbPois??'-'}, dbOnly=${Array.isArray(d.dbOnlyPois)?d.dbOnlyPois.length:d.dbOnlyPois??'-'}, unr=${Array.isArray(d.webUnresolvedMentions)?d.webUnresolvedMentions.length:'-'}`)

  // 打印 mention 归一化结果
  const mentions = d.mentions || []
  console.log('\n=== Raw mentions from LLM ===')
  // 从 mentionExtraction 的中间结果获取
  // 但我们只能从 final result 获取，看 webUnresolvedMentions
  if (Array.isArray(d.webUnresolvedMentions)) {
    console.log('Unresolved mentions:')
    for (const m of d.webUnresolvedMentions) {
      console.log(`  - "${m.mention}" conf=${m.confidence}`)
    }
  }

  // 打印 shortlist 前 20 名
  const shortlist = d.shortlist || []
  if (Array.isArray(shortlist) && shortlist.length > 0) {
    console.log('\nShortlist names:')
    for (const p of shortlist.slice(0, 20)) {
      console.log(`  - "${p.name}" cat=${p.categorySub||p.categoryMain||'-'}`)
    }
  }

  // 打印最终 POI
  const pois = refined?.results?.pois || []
  console.log(`\n最终POI: ${pois.length} 个`)
  for (let i = 0; i < Math.min(pois.length, 10); i++) {
    const p = pois[i]
    const meta = p.meta || {}
    console.log(`  ${i+1}. "${p.name}" | cat=${p.categorySub||'-'} | dist=${typeof p.distance_m==='number'?p.distance_m.toFixed(0)+'m':'-'} | src=${meta.source||'-'} | verif=${meta.verification||'-'}`)
  }
}

run().catch(e => console.error(e))
