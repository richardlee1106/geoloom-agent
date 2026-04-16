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

function extractPort(address) {
  const match = /:(\d+)$/.exec(address.trim())
  return match ? Number.parseInt(match[1], 10) : null
}

function listWindowsListeningPids(port) {
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  const pids = new Set()

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const parts = line.split(/\s+/)
    if (parts.length < 5) continue

    const protocol = parts[0]?.toUpperCase()
    const localAddress = parts[1] || ''
    const state = parts[3]?.toUpperCase()
    const pid = Number.parseInt(parts[4] || '', 10)

    if (protocol !== 'TCP' || state !== 'LISTENING') continue
    if (extractPort(localAddress) !== port) continue
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue

    pids.add(pid)
  }

  return [...pids]
}

function listUnixListeningPids(port) {
  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    return Array.from(
      new Set(
        output
          .split(/\r?\n/)
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid),
      ),
    )
  } catch {
    return []
  }
}

function listListeningPids(port) {
  return process.platform === 'win32'
    ? listWindowsListeningPids(port)
    : listUnixListeningPids(port)
}

function killPid(pid) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/F', '/PID', String(pid)], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return
  }

  process.kill(pid, 'SIGKILL')
}

const killedPids = new Set()
let cleanedCount = 0

for (const port of ports) {
  const pids = listListeningPids(port).filter((pid) => !killedPids.has(pid))

  if (pids.length === 0) {
    console.log(`[cleanup-ports] 端口 ${port} 空闲`)
    continue
  }

  for (const pid of pids) {
    try {
      killPid(pid)
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
  await delay(300)
}

const blockedPorts = ports.filter((port) => listListeningPids(port).length > 0)

if (blockedPorts.length > 0) {
  console.error(`[cleanup-ports] 端口仍被占用: ${blockedPorts.join(', ')}`)
  process.exit(1)
}

console.log(`[cleanup-ports] 已确认端口可用: ${ports.join(', ')}`)
