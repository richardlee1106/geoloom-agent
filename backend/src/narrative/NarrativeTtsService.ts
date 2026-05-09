import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'

export interface NarrativeTtsRequest {
  text: string
  voice?: string
  speed?: number
}

export interface NarrativeTtsResult {
  audio: Buffer
  contentType: string
  cacheKey: string
  cached: boolean
}

export interface NarrativeTtsProvider {
  synthesize(input: NarrativeTtsRequest): Promise<NarrativeTtsResult>
  health(): Promise<Record<string, unknown>> | Record<string, unknown>
}

export interface NarrativeTtsServiceOptions {
  enabled?: boolean
  /** HTTP API URL (e.g. http://127.0.0.1:8880). When set, uses OpenAI-compatible /v1/audio/speech instead of CLI. */
  httpUrl?: string
  modelPath?: string
  commandTemplate?: string
  cacheDir?: string
  outputFormat?: string
  defaultVoice?: string
  timeoutMs?: number
}

function contentTypeForFormat(format: string): string {
  if (format === 'mp3') return 'audio/mpeg'
  if (format === 'ogg') return 'audio/ogg'
  if (format === 'flac') return 'audio/flac'
  return 'audio/wav'
}

function tokenizeCommandTemplate(template: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < template.length; i += 1) {
    const char = template[i]
    if ((char === '"' || char === "'") && !quote) {
      quote = char
      continue
    }
    if (quote === char) {
      quote = null
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function replacePlaceholders(token: string, values: Record<string, string>): string {
  return token.replace(/\{(model|text|voice|speed|output)\}/g, (_, key: string) => values[key] ?? '')
}

function clampSpeed(speed: unknown): number {
  const parsed = Number(speed)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(0.55, Math.min(1.6, parsed))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

export class NarrativeTtsService implements NarrativeTtsProvider {
  private readonly enabled: boolean
  private readonly httpUrl: string
  private readonly modelPath: string
  private readonly commandTemplate: string
  private readonly cacheDir: string
  private readonly outputFormat: string
  private readonly defaultVoice: string
  private readonly timeoutMs: number

  constructor(options: NarrativeTtsServiceOptions = {}) {
    this.httpUrl = String(options.httpUrl || process.env.OMNIVOICE_HTTP_URL || '').replace(/\/+$/, '')
    this.modelPath = options.modelPath || process.env.OMNIVOICE_MODEL_PATH || 'D:\\models\\Serveurperso\\OmniVoice-GGUF\\omnivoice-base-Q8_0.gguf'
    this.commandTemplate = options.commandTemplate || process.env.OMNIVOICE_COMMAND_TEMPLATE || 'omnivoice-infer --model "{model}" --text "{text}" --instruct "{voice}" --speed "{speed}" --output "{output}"'
    this.outputFormat = String(options.outputFormat || process.env.OMNIVOICE_OUTPUT_FORMAT || 'wav').replace(/^\./, '').toLowerCase()
    this.cacheDir = options.cacheDir || process.env.OMNIVOICE_CACHE_DIR || resolve(process.cwd(), 'data', 'narrative-tts-cache')
    this.defaultVoice = options.defaultVoice || process.env.OMNIVOICE_VOICE || 'fable'
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs || process.env.OMNIVOICE_TIMEOUT_MS || 120000))

    this.enabled = options.enabled ?? !['0', 'false', 'no', 'off'].includes(String(process.env.NARRATIVE_TTS_ENABLED || 'true').toLowerCase())

    if (this.httpUrl) {
      console.log(`[NarrativeTts] HTTP API mode: ${this.httpUrl}/v1/audio/speech`)
    } else {
      console.log(`[NarrativeTts] CLI mode: ${this.commandTemplate.split(' ')[0]}`)
    }
  }

  async health(): Promise<Record<string, unknown>> {
    if (this.httpUrl) {
      try {
        const res = await fetch(`${this.httpUrl}/health`, { signal: AbortSignal.timeout(5000) })
        const data = await res.json() as Record<string, unknown>
        return {
          enabled: this.enabled,
          mode: 'http',
          ready: this.enabled && res.ok,
          httpUrl: this.httpUrl,
          ...data,
        }
      } catch (err) {
        return {
          enabled: this.enabled,
          mode: 'http',
          ready: false,
          httpUrl: this.httpUrl,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    const modelExists = await fileExists(this.modelPath)
    const command = tokenizeCommandTemplate(this.commandTemplate)[0] || ''
    return {
      enabled: this.enabled,
      mode: 'cli',
      ready: this.enabled && modelExists && Boolean(command),
      modelPath: this.modelPath,
      modelExists,
      command,
      outputFormat: this.outputFormat,
      cacheDir: this.cacheDir,
    }
  }

  async synthesize(input: NarrativeTtsRequest): Promise<NarrativeTtsResult> {
    if (!this.enabled) throw new Error('Narrative TTS is disabled')
    const text = String(input.text || '').trim()
    if (!text) throw new Error('Narrative TTS text is empty')
    const voice = String(input.voice || this.defaultVoice).trim()
    const speed = clampSpeed(input.speed)

    const cacheKey = createHash('sha256')
      .update(JSON.stringify({ engine: 'omnivoice', mode: this.httpUrl ? 'http' : 'cli', model: this.modelPath, text, voice, speed: speed.toFixed(2), format: this.outputFormat }))
      .digest('hex')
      .slice(0, 32)
    const outputPath = join(this.cacheDir, `${cacheKey}.${this.outputFormat}`)

    const cached = await fileExists(outputPath)
    if (cached) {
      return {
        audio: await readFile(outputPath),
        contentType: contentTypeForFormat(this.outputFormat),
        cacheKey,
        cached: true,
      }
    }

    await mkdir(dirname(outputPath), { recursive: true })

    if (this.httpUrl) {
      await this.synthesizeHttp(text, voice, speed, outputPath)
    } else {
      if (!(await fileExists(this.modelPath))) throw new Error(`OmniVoice model file not found: ${this.modelPath}`)
      await this.runCommand({ text, voice, speed: speed.toFixed(2), outputPath })
    }

    const outputStat = await stat(outputPath)
    if (!outputStat.isFile() || outputStat.size <= 0) throw new Error('OmniVoice did not produce an audio file')
    return {
      audio: await readFile(outputPath),
      contentType: contentTypeForFormat(extname(outputPath).replace(/^\./, '') || this.outputFormat),
      cacheKey,
      cached: false,
    }
  }

  private async synthesizeHttp(text: string, voice: string, speed: number, outputPath: string): Promise<void> {
    const res = await fetch(`${this.httpUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'omnivoice',
        input: text,
        voice,
        response_format: this.outputFormat,
        speed,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`OmniVoice HTTP API ${res.status}: ${errText.slice(0, 300)}`)
    }
    const arrayBuffer = await res.arrayBuffer()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(outputPath, Buffer.from(arrayBuffer))
  }

  private runCommand(values: { text: string; voice: string; speed: string; outputPath: string }): Promise<void> {
    const tokens = tokenizeCommandTemplate(this.commandTemplate)
    const command = tokens[0]
    if (!command) return Promise.reject(new Error('OMNIVOICE_COMMAND_TEMPLATE is empty'))
    const args = tokens.slice(1).map((token) => replacePlaceholders(token, {
      model: this.modelPath,
      text: values.text,
      voice: values.voice,
      speed: values.speed,
      output: values.outputPath,
    }))

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        rejectPromise(new Error(`OmniVoice synthesis timed out after ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk).slice(0, 4000)
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk).slice(0, 4000)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        rejectPromise(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolvePromise()
          return
        }
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`
        rejectPromise(new Error(`OmniVoice synthesis failed: ${detail}`))
      })
    })
  }
}
