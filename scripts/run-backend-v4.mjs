import { spawn } from 'node:child_process'

const script = process.argv[2] || 'dev'

const child = spawn(
  `npm --prefix backend run ${script}`,
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      SPATIAL_ENCODER_BASE_URL: process.env.SPATIAL_ENCODER_BASE_URL || 'http://127.0.0.1:8100',
      SPATIAL_VECTOR_BASE_URL: process.env.SPATIAL_VECTOR_BASE_URL || 'http://127.0.0.1:3411',
      SPATIAL_VECTOR_HEALTH_PATH: process.env.SPATIAL_VECTOR_HEALTH_PATH || '/health/vector',
      SPATIAL_VECTOR_TIMEOUT_MS: process.env.SPATIAL_VECTOR_TIMEOUT_MS || '6000',
      ROUTING_BASE_URL: process.env.ROUTING_BASE_URL || 'http://127.0.0.1:3411',
      ROUTING_HEALTH_PATH: process.env.ROUTING_HEALTH_PATH || '/health/routing',
      ROUTING_TIMEOUT_MS: process.env.ROUTING_TIMEOUT_MS || '6000',
      GEOLOOM_ENCODER_BASE_URL: process.env.GEOLOOM_ENCODER_BASE_URL || 'http://127.0.0.1:8100',
      OSRM_BASE_URL: process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
    },
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
