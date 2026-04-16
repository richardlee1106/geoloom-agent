const TAVILY_API_KEY = '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'

async function testTavily() {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query: '武汉 光谷咖啡店',
      search_depth: 'advanced',
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
    }),
  })

  const data = await res.json()
  console.log(`Tavily 返回 ${data.results?.length || 0} 条结果`)
  data.results?.slice(0, 5).forEach((r, i) => {
    console.log(`\n结果${i + 1}:`)
    console.log(`  title: ${r.title}`)
    console.log(`  url: ${r.url}`)
    console.log(`  snippet: ${r.content?.substring(0, 150)}`)
  })
}

testTavily().catch(console.error)
