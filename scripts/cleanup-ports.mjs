import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const ports = Array.from(
  new Set(
    process.argv
      .slice(2)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0),
  ),
)

if (ports.length === 0) {
  console.error('[cleanup-ports] 请传入至少一个端口号')
  process.exit(1)
}

// ── Windows：单次 netstat 扫描全部端口 ──

function scanWindowsAllPorts(targetPorts) {
  const portSet = new Set(targetPorts)
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const map = new Map()
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length < 5) continue
    if (parts[0]?.toUpperCase() !== 'TCP' || parts[3]?.toUpperCase() !== 'LISTENING') continue
    const match = /:(\d+)$/.exec(parts[1] || '')
    const port = match ? Number.parseInt(match[1], 10) : null
    const pid = Number.parseInt(parts[4] || '', 10)
    if (port !== null && portSet.has(port) && Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      if (!map.has(port)) map.set(port, new Set())
      map.get(port).add(pid)
    }
  }
  return map
}

// ── Unix：逐端口 lsof ──

function scanUnixAllPorts(targetPorts) {
  const map = new Map()
  for (const port of targetPorts) {
    try {
      const output = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const pids = new Set(
        output.split(/\r?\n/)
          .map((v) => Number.parseInt(v.trim(), 10))
          .filter((v) => Number.isInteger(v) && v > 0 && v !== process.pid),
      )
      if (pids.size > 0) map.set(port, pids)
    } catch { /* 端口空闲 */ }
  }
  return map
}

// ── 主逻辑 ──

const portMap = process.platform === 'win32'
  ? scanWindowsAllPorts(ports)
  : scanUnixAllPorts(ports)

const killedPids = new Set()
let cleanedCount = 0

for (const port of ports) {
  const pids = (portMap.get(port) || new Set())
  const toKill = [...pids].filter((pid) => !killedPids.has(pid))

  if (toKill.length === 0) {
    console.log(`[cleanup-ports] 端口 ${port} 空闲`)
    continue
  }

  for (const pid of toKill) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/PID', String(pid)], {
          stdio: ['ignore', 'ignore', 'ignore'],
        })
      } else {
        process.kill(pid, 'SIGKILL')
      }
      killedPids.add(pid)
      cleanedCount += 1
      console.log(`[cleanup-ports] 端口 ${port} 已终止 PID ${pid}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[cleanup-ports] 终止 PID ${pid} 失败: ${message}`)
      process.exit(1)
    }
  }
}

if (cleanedCount > 0) {
  await delay(200)
  // 二次验证：再扫一次
  const recheckMap = process.platform === 'win32'
    ? scanWindowsAllPorts(ports)
    : scanUnixAllPorts(ports)
  const blockedPorts = ports.filter((port) => {
    const pids = recheckMap.get(port)
    return pids && [...pids].some((pid) => !killedPids.has(pid))
  })
  if (blockedPorts.length > 0) {
    console.error(`[cleanup-ports] 端口仍被占用: ${blockedPorts.join(', ')}`)
    process.exit(1)
  }
}

console.log(`[cleanup-ports] 已确认端口可用: ${ports.join(', ')}`)
