import http from 'node:http'

const dependencyPort = 3410
const encoderPort = 8100

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

function sendJson(response, payload) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function createVectorCandidates(text = '') {
  const normalized = String(text || '')
  return [
    {
      id: 'poi_remote_001',
      name: normalized.includes('咖啡') ? '远端校园咖啡实验室' : '远端社区便利咖啡馆',
      category: '咖啡',
      score: 0.91,
      tags: ['高校', '咖啡'],
    },
    {
      id: 'poi_remote_002',
      name: '远端地铁口轻食咖啡',
      category: '咖啡',
      score: 0.84,
      tags: ['交通', '咖啡'],
    },
  ]
}

const dependencyServer = http.createServer(async (request, response) => {
  const { method = 'GET', url = '/' } = request

  if (method === 'GET' && url === '/health') {
    return sendJson(response, {
      status: 'ok',
      service: 'dependency-adapter',
    })
  }

  if (method === 'POST' && url === '/search/semantic-pois') {
    const body = await readJsonBody(request)
    return sendJson(response, {
      candidates: createVectorCandidates(body.text),
    })
  }

  if (method === 'POST' && url === '/search/similar-regions') {
    return sendJson(response, {
      regions: [
        {
          id: 'region_remote_001',
          name: '街道口-高校活力片区',
          summary: '高校密集、咖啡与轻餐饮集中。',
          score: 0.88,
          tags: ['高校', '咖啡'],
        },
      ],
    })
  }

  if (method === 'POST' && url === '/route') {
    return sendJson(response, {
      distance_m: 1280,
      duration_min: 17,
      degraded: false,
      degraded_reason: null,
    })
  }

  response.writeHead(404)
  response.end()
})

const encoderServer = http.createServer(async (request, response) => {
  const { method = 'GET', url = '/' } = request

  if (method === 'GET' && url === '/health') {
    return sendJson(response, {
      status: 'ok',
      service: 'encoder-adapter',
    })
  }

  if (method === 'POST' && url === '/encode-text') {
    const body = await readJsonBody(request)
    const tokens = String(body.text || '')
      .split(/\s+/)
      .filter(Boolean)
    const vector = Array.from({ length: 8 }, (_, index) => Number((index * 0.1 + 0.1).toFixed(3)))
    return sendJson(response, {
      vector,
      tokens,
      dimension: vector.length,
    })
  }

  response.writeHead(404)
  response.end()
})

dependencyServer.listen(dependencyPort, '127.0.0.1')
encoderServer.listen(encoderPort, '127.0.0.1')

function shutdown() {
  dependencyServer.close()
  encoderServer.close()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
