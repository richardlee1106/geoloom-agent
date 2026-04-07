function readCliArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return ''
  return String(process.argv[index + 1] || '')
}

const apiBase = String(
  readCliArg('--api-base')
    || process.env.GEOLOOM_API_BASE
    || process.env.VITE_GEOLOOM_API_BASE
    || 'http://127.0.0.1:3210',
).replace(/\/$/, '')

const frontendUrl = String(
  readCliArg('--frontend-url')
    || process.env.GEOLOOM_FRONTEND_URL
    || 'http://127.0.0.1:4173',
).replace(/\/$/, '')

const dependencyBase = String(
  readCliArg('--dependency-base')
    || process.env.GEOLOOM_DEPENDENCY_BASE
    || process.env.SPATIAL_VECTOR_BASE_URL
    || 'http://127.0.0.1:3411',
).replace(/\/$/, '')

const encoderBase = String(
  readCliArg('--encoder-base')
    || process.env.GEOLOOM_ENCODER_BASE
    || process.env.SPATIAL_ENCODER_BASE_URL
    || 'http://127.0.0.1:8100',
).replace(/\/$/, '')

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  return { response, data }
}

function parseSse(raw = '') {
  return raw
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n')
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7).trim() || 'message'
      const dataLine = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
      return {
        event,
        data: dataLine ? JSON.parse(dataLine) : null,
      }
    })
}

async function main() {
  const health = await fetchJson(`${apiBase}/api/geo/health`)
  if (!health.response.ok) {
    throw new Error(`health check failed: ${health.response.status}`)
  }

  const frontend = await fetch(frontendUrl)
  if (!frontend.ok) {
    throw new Error(`frontend check failed: ${frontend.status}`)
  }

  const encoderHealth = await fetchJson(`${encoderBase}/health`)
  if (!encoderHealth.response.ok || encoderHealth.data?.encoder_loaded !== true) {
    throw new Error(`encoder health failed: ${encoderHealth.response.status}`)
  }

  const vectorHealth = await fetchJson(`${dependencyBase}/health/vector`)
  if (!vectorHealth.response.ok || vectorHealth.data?.status !== 'ok') {
    throw new Error(`vector health failed: ${vectorHealth.response.status}`)
  }

  const routingHealth = await fetchJson(`${dependencyBase}/health/routing`)
  if (!routingHealth.response.ok || routingHealth.data?.status !== 'ok') {
    throw new Error(`routing health failed: ${routingHealth.response.status}`)
  }

  const semanticPois = await fetchJson(`${dependencyBase}/search/semantic-pois`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: '武汉大学附近适合开什么咖啡店？',
      top_k: 3,
    }),
  })
  if (!semanticPois.response.ok || !Array.isArray(semanticPois.data?.candidates) || semanticPois.data.candidates.length === 0) {
    throw new Error(`semantic poi smoke failed: ${semanticPois.response.status}`)
  }

  const similarRegions = await fetchJson(`${dependencyBase}/search/similar-regions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: '和武汉大学最像的片区有哪些？',
      top_k: 3,
    }),
  })
  if (!similarRegions.response.ok || !Array.isArray(similarRegions.data?.regions) || similarRegions.data.regions.length === 0) {
    throw new Error(`similar regions smoke failed: ${similarRegions.response.status}`)
  }

  const route = await fetchJson(`${dependencyBase}/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      origin: [114.364339, 30.536334],
      destination: [114.365339, 30.537334],
      mode: 'walking',
    }),
  })
  if (!route.response.ok || Number(route.data?.distance_m || 0) <= 0) {
    throw new Error(`route smoke failed: ${route.response.status}`)
  }

  const dependencies = health.data?.dependencies || {}
  if (dependencies.spatial_encoder?.mode !== 'remote' || dependencies.spatial_vector?.mode !== 'remote' || dependencies.route_distance?.mode !== 'remote') {
    throw new Error('backend health does not report remote dependency mode')
  }

  const chatResponse = await fetch(`${apiBase}/api/geo/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: '武汉大学附近适合开什么咖啡店？',
        },
      ],
      options: {
        requestId: 'smoke_stack_001',
      },
    }),
  })

  if (!chatResponse.ok) {
    throw new Error(`chat smoke failed: ${chatResponse.status}`)
  }

  const events = parseSse(await chatResponse.text())
  const refined = events.find((item) => item.event === 'refined_result')?.data
  const done = events.at(-1)

  if (!refined || done?.event !== 'done') {
    throw new Error('chat smoke did not finish with refined_result + done')
  }

  console.log(JSON.stringify({
    frontend: frontendUrl,
    apiBase,
    dependencyBase,
    encoderBase,
    providerReady: health.data?.provider_ready === true,
    degradedDependencies: health.data?.degraded_dependencies || [],
    remoteModes: {
      spatialEncoder: dependencies.spatial_encoder?.mode || null,
      spatialVector: dependencies.spatial_vector?.mode || null,
      routeDistance: dependencies.route_distance?.mode || null,
    },
    encoderLoaded: encoderHealth.data?.encoder_loaded === true,
    semanticPoiTop: semanticPois.data?.candidates?.[0]?.name || null,
    semanticPoiCount: semanticPois.data?.candidates?.length || 0,
    similarRegionTop: similarRegions.data?.regions?.[0]?.name || null,
    similarRegionCount: similarRegions.data?.regions?.length || 0,
    routeDistanceM: route.data?.distance_m || null,
    chatAnswer: String(refined.answer || '').slice(0, 120),
    queryType: refined.results?.stats?.query_type || null,
    events: events.map((item) => item.event),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
