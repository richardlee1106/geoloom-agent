import { execSync } from 'node:child_process'

function parsePorts() {
  return process.argv
    .slice(2)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function listWindowsPids(port) {
  try {
    const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8')

    return output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/).at(-1))
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0 && value !== process.pid)
  } catch {
    return []
  }
}

function listUnixPids(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8')

    return output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isFinite(value) && value > 0 && value !== process.pid)
  } catch {
    return []
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      return true
    }

    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

const ports = parsePorts()
for (const port of ports) {
  const pids = process.platform === 'win32' ? listWindowsPids(port) : listUnixPids(port)
  for (const pid of [...new Set(pids)]) {
    killPid(pid)
  }
}
