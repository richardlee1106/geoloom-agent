import http from 'node:http'

function readCliArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return String(process.argv[index + 1] || fallback)
}

const port = Number(
  readCliArg('--port', process.env.GEOLOOM_ENCODER_PORT || '8100'),
)

const TEXT_VOCABULARY = [
  '高校',
  '大学',
  '学校',
  '学生',
  '咖啡',
  '地铁',
  '交通',
  '商圈',
  '夜间',
  '办公',
  '社区',
  '餐饮',
  '购物',
  '公园',
  '景区',
  '住宅',
]

function readJsonBody(request) {
  return new Promise((resolve) => {
    let buffer = ''
    request.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
    })
    request.on('end', () => {
      try {
        resolve(buffer ? JSON.parse(buffer) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function normalizeText(value = '') {
  return String(value || '').trim()
}

function tokenize(text = '') {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0))
  if (!Number.isFinite(norm) || norm <= 1e-12) {
    return vector.map((_, index) => (index === 0 ? 1 : 0))
  }
  return vector.map((value) => Number((value / norm).toFixed(6)))
}

function hashNumber(seed, offset = 0) {
  const raw = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453
  return raw - Math.floor(raw)
}

function buildTextVector(text = '') {
  const tokens = tokenize(text)
  const vector = TEXT_VOCABULARY.map((term, index) => {
    const hasKeyword = tokens.some((token) => token.includes(term) || term.includes(token))
    if (hasKeyword) return 1
    return Number((hashNumber(text.length + term.length, index) * 0.15).toFixed(6))
  })
  return {
    vector: normalizeVector(vector),
    tokens,
    dimension: vector.length,
  }
}

function buildAnchorEmbedding(payload = {}) {
  const lon = Number(payload.lon || 0)
  const lat = Number(payload.lat || 0)
  const seed = Number.isFinite(lon) && Number.isFinite(lat)
    ? Math.abs(lon) * 97.13 + Math.abs(lat) * 53.71
    : 1

  const vector = Array.from({ length: 16 }, (_, index) => {
    const hashed = hashNumber(seed, index)
    const offset = ((index % 4) - 1.5) * 0.04
    return Number((hashed + offset).toFixed(6))
  })

  return {
    embedding: normalizeVector(vector),
    dimension: vector.length,
  }
}

function inferSceneTags(text = '') {
  const normalized = normalizeText(text)
  const tags = []
  if (/[大学学院学校校区]/u.test(normalized)) tags.push('高校')
  if (/[地铁交通站]/u.test(normalized)) tags.push('交通')
  if (/[咖啡茶饮]/u.test(normalized)) tags.push('咖啡')
  if (/[商场购物便利店]/u.test(normalized)) tags.push('购物')
  if (/[公园绿地景区]/u.test(normalized)) tags.push('公园')
  if (!tags.length) tags.push('综合')
  return tags
}

function buildFallbackCells(payload = {}) {
  const anchorLon = Number(payload.anchor_lon || 114.305)
  const anchorLat = Number(payload.anchor_lat || 30.593)
  const text = normalizeText(payload.user_query || '')
  const sceneTags = inferSceneTags(text)
  const topK = Math.max(1, Math.min(Number(payload.top_k || 5), 8))
  const dominantCategory = sceneTags[0]

  const cells = Array.from({ length: topK }, (_, index) => {
    const lonOffset = 0.004 * (index + 1)
    const latOffset = 0.0025 * ((index % 2 === 0) ? 1 : -1) * (index + 1)
    return {
      cell_id: `fallback_cell_${index + 1}`,
      region_name: `${dominantCategory}相似片区 ${index + 1}`,
      dominant_category: dominantCategory,
      scene_tags: sceneTags,
      composite_score: Number((0.91 - index * 0.06).toFixed(3)),
      lon: Number((anchorLon + lonOffset).toFixed(6)),
      lat: Number((anchorLat + latOffset).toFixed(6)),
      summary: text ? `围绕“${text.slice(0, 18)}”生成的本地相似片区候选。` : '本地 fallback 生成的相似片区候选。',
    }
  })

  return {
    cells,
    scene_tags: sceneTags,
    dominant_buckets: sceneTags,
  }
}

const server = http.createServer(async (request, response) => {
  const { method = 'GET', url = '/' } = request

  if (method === 'GET' && url === '/health') {
    return sendJson(response, {
      status: 'ok',
      encoder_loaded: true,
      loaded: true,
      mode: 'fallback_js',
      service: 'geoloom-encoder-fallback',
    })
  }

  if (method === 'POST' && url === '/encode-text') {
    const body = await readJsonBody(request)
    return sendJson(response, buildTextVector(body.text))
  }

  if (method === 'POST' && url === '/encode') {
    const body = await readJsonBody(request)
    return sendJson(response, buildAnchorEmbedding(body))
  }

  if (method === 'POST' && url === '/cell/search') {
    const body = await readJsonBody(request)
    return sendJson(response, buildFallbackCells(body))
  }

  response.writeHead(404)
  response.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[encoder-fallback] listening on http://127.0.0.1:${port}`)
})

function shutdown() {
  server.close()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
