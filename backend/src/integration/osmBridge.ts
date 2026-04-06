import { createDependencyStatus, type DependencyStatus } from './dependencyStatus.js'
import { requestJson } from './httpClient.js'

export interface RouteEstimate {
  distance_m: number
  duration_min: number
  degraded: boolean
  degraded_reason: string | null
}

export interface RouteBridge {
  estimateRoute(origin: [number, number], destination: [number, number], mode: string): Promise<RouteEstimate>
  getStatus(): Promise<DependencyStatus>
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function haversineDistanceMeters(origin: [number, number], destination: [number, number]) {
  const earthRadiusMeters = 6371000
  const deltaLat = toRadians(destination[1] - origin[1])
  const deltaLon = toRadians(destination[0] - origin[0])
  const lat1 = toRadians(origin[1])
  const lat2 = toRadians(destination[1])

  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMeters * c
}

export class LocalOSMBridge implements RouteBridge {
  async estimateRoute(origin: [number, number], destination: [number, number], mode: string): Promise<RouteEstimate> {
    const directDistance = haversineDistanceMeters(origin, destination)
    const distance = directDistance * 1.25
    const speed = mode === 'driving' ? 600 : 75

    return {
      distance_m: Number(distance.toFixed(1)),
      duration_min: Math.max(1, Math.round(distance / speed)),
      degraded: true,
      degraded_reason: 'routing_service_unavailable',
    }
  }

  async getStatus(): Promise<DependencyStatus> {
    return createDependencyStatus({
      name: 'route_distance',
      ready: true,
      mode: 'local',
      degraded: true,
      reason: 'remote_unconfigured',
    })
  }
}

export interface RemoteFirstOSMBridgeOptions {
  baseUrl?: string
  routePath?: string
  healthPath?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  fallback?: RouteBridge
}

export class RemoteFirstOSMBridge implements RouteBridge {
  private readonly baseUrl: string

  private readonly routePath: string

  private readonly healthPath: string

  private readonly timeoutMs: number

  private readonly fallback: RouteBridge

  private lastStatus: DependencyStatus

  constructor(private readonly options: RemoteFirstOSMBridgeOptions = {}) {
    this.baseUrl = String(
      this.options.baseUrl || process.env.ROUTING_BASE_URL || '',
    ).trim()
    this.routePath = String(
      this.options.routePath || process.env.ROUTING_ROUTE_PATH || '/route',
    ).trim()
    this.healthPath = String(
      this.options.healthPath || process.env.ROUTING_HEALTH_PATH || '/health',
    ).trim()
    this.timeoutMs = Number(
      this.options.timeoutMs || process.env.ROUTING_TIMEOUT_MS || '3000',
    )
    this.fallback = options.fallback || new LocalOSMBridge()
    this.lastStatus = this.baseUrl
      ? createDependencyStatus({
        name: 'route_distance',
        ready: false,
        mode: 'remote',
        degraded: true,
        reason: 'awaiting_probe',
        target: this.baseUrl,
      })
      : createDependencyStatus({
        name: 'route_distance',
        ready: true,
        mode: 'local',
        degraded: true,
        reason: 'remote_unconfigured',
      })
  }

  async estimateRoute(origin: [number, number], destination: [number, number], mode: string): Promise<RouteEstimate> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.estimateRoute(origin, destination, mode)
    }

    try {
      const response = await requestJson<RouteEstimate>({
        baseUrl: this.baseUrl,
        path: this.routePath,
        method: 'POST',
        body: { origin, destination, mode },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = createDependencyStatus({
        name: 'route_distance',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
      return {
        distance_m: response.distance_m,
        duration_min: response.duration_min,
        degraded: Boolean(response.degraded),
        degraded_reason: response.degraded_reason ?? null,
      }
    } catch (error) {
      this.lastStatus = createDependencyStatus({
        name: 'route_distance',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
      return this.fallback.estimateRoute(origin, destination, mode)
    }
  }

  async getStatus(): Promise<DependencyStatus> {
    if (!this.baseUrl) {
      return this.lastStatus
    }

    try {
      await requestJson({
        baseUrl: this.baseUrl,
        path: this.healthPath,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = createDependencyStatus({
        name: 'route_distance',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
    } catch (error) {
      this.lastStatus = createDependencyStatus({
        name: 'route_distance',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }

    return this.lastStatus
  }
}
