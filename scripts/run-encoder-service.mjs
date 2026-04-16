import { spawn } from 'node:child_process'

function readCliArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return String(process.argv[index + 1] || fallback)
}

const port = readCliArg('--port', process.env.GEOLOOM_ENCODER_PORT || '8100')
const startupGraceMs = Number(process.env.GEOLOOM_ENCODER_STARTUP_GRACE_MS || '5000')
const pythonExecutable = process.env.GEOLOOM_ENCODER_PYTHON || 'python'

let activeChild = null
let fallbackStarted = false
let startupCommitted = false

function wireSignals(child) {
  const forward = (signal) => {
    if (child && !child.killed) {
      child.kill(signal)
    }
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))
}

function startFallback(reason) {
  if (fallbackStarted) return
  fallbackStarted = true
  console.warn(`[encoder-launcher] real encoder unavailable, switching to fallback: ${reason}`)
  const fallbackChild = spawn(
    process.execPath,
    ['scripts/encoder-fallback-service.mjs', '--port', port],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        GEOLOOM_ENCODER_PORT: port,
      },
    },
  )
  activeChild = fallbackChild
  wireSignals(fallbackChild)
  fallbackChild.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

let realChild = null

try {
  realChild = spawn(
    pythonExecutable,
    ['..\\vector-encoder\\run.py', 'serve', '--port', port],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GEOLOOM_ENCODER_PORT: port,
      },
      shell: true,
    },
  )
} catch (error) {
  startFallback(error instanceof Error ? error.message : String(error))
}

if (realChild) {
  activeChild = realChild
  wireSignals(realChild)

  realChild.stdout?.on('data', (chunk) => {
    process.stdout.write(chunk)
  })

  realChild.stderr?.on('data', (chunk) => {
    const text = chunk.toString()
    process.stderr.write(chunk)
    if (!startupCommitted && /ModuleNotFoundError|No module named|ImportError/iu.test(text)) {
      startFallback(text.trim())
    }
  })

  realChild.on('error', (error) => {
    startFallback(error.message)
  })

  const startupTimer = setTimeout(() => {
    if (!fallbackStarted) {
      startupCommitted = true
      console.log('[encoder-launcher] real vector-encoder is running')
    }
  }, startupGraceMs)

  realChild.on('exit', (code, signal) => {
    clearTimeout(startupTimer)
    if (!startupCommitted && !fallbackStarted) {
      startFallback(`startup exit code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      return
    }

    if (fallbackStarted) return

    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
} else if (!fallbackStarted) {
  startFallback('real encoder process was not created')
}
