import crypto from 'node:crypto'

import type { NarrativeWebSource } from './contract.js'

export type NarrativeWebFactCacheStatus = 'hit' | 'miss' | 'stale' | 'stored' | 'error_stored' | 'disabled'

export interface NarrativeWebFactCacheEntry {
  query: string
  maxResults: number
  sources: NarrativeWebSource[]
  createdAt: number
  expiresAt: number
  error?: string
}

export interface NarrativeWebFactCacheOptions {
  ttlMs?: number
  failureTtlMs?: number
  maxEntries?: number
  now?: () => number
}

export class NarrativeWebFactCache {
  private readonly ttlMs: number
  private readonly failureTtlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly entries = new Map<string, NarrativeWebFactCacheEntry>()

  constructor(options: NarrativeWebFactCacheOptions = {}) {
    this.ttlMs = Math.max(1000, options.ttlMs ?? Number(process.env.NARRATIVE_WEB_FACT_CACHE_TTL_MS || 14 * 24 * 60 * 60 * 1000))
    this.failureTtlMs = Math.max(1000, options.failureTtlMs ?? Number(process.env.NARRATIVE_WEB_FACT_FAILURE_CACHE_TTL_MS || 30 * 60 * 1000))
    this.maxEntries = Math.max(1, options.maxEntries ?? Number(process.env.NARRATIVE_WEB_FACT_CACHE_MAX || 500))
    this.now = options.now || (() => Date.now())
  }

  key(query: string, maxResults: number): string {
    return crypto.createHash('sha1').update(`${normalizeQuery(query)}||${maxResults}`).digest('hex')
  }

  get(query: string, maxResults: number): { status: NarrativeWebFactCacheStatus; entry?: NarrativeWebFactCacheEntry } {
    const key = this.key(query, maxResults)
    const entry = this.entries.get(key)
    if (!entry) return { status: 'miss' }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return { status: 'stale' }
    }
    return { status: 'hit', entry: cloneEntry(entry) }
  }

  set(query: string, maxResults: number, sources: NarrativeWebSource[]): NarrativeWebFactCacheEntry {
    this.prune()
    const createdAt = this.now()
    const entry: NarrativeWebFactCacheEntry = {
      query: normalizeQuery(query),
      maxResults,
      sources: cloneSources(sources),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    }
    this.entries.set(this.key(query, maxResults), entry)
    return cloneEntry(entry)
  }

  setError(query: string, maxResults: number, error: string): NarrativeWebFactCacheEntry {
    this.prune()
    const createdAt = this.now()
    const entry: NarrativeWebFactCacheEntry = {
      query: normalizeQuery(query),
      maxResults,
      sources: [],
      createdAt,
      expiresAt: createdAt + this.failureTtlMs,
      error,
    }
    this.entries.set(this.key(query, maxResults), entry)
    return cloneEntry(entry)
  }

  stats() {
    const now = this.now()
    let fresh = 0
    let stale = 0
    for (const entry of this.entries.values()) {
      if (entry.expiresAt > now) fresh += 1
      else stale += 1
    }
    return { size: this.entries.size, fresh, stale, max_entries: this.maxEntries }
  }

  clear() {
    this.entries.clear()
  }

  private prune() {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
    if (this.entries.size < this.maxEntries) return
    const deleteCount = Math.max(1, Math.ceil(this.maxEntries * 0.2))
    for (const key of [...this.entries.keys()].slice(0, deleteCount)) {
      this.entries.delete(key)
    }
  }
}

function normalizeQuery(query: string): string {
  return String(query || '').replace(/\s+/gu, ' ').trim()
}

function cloneSources(sources: NarrativeWebSource[]): NarrativeWebSource[] {
  return sources.map((source) => ({ ...source }))
}

function cloneEntry(entry: NarrativeWebFactCacheEntry): NarrativeWebFactCacheEntry {
  return { ...entry, sources: cloneSources(entry.sources) }
}
