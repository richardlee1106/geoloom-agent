import type { SkillExecutionResult } from '../../types.js'
import type { RouteBridge } from '../../../integration/osmBridge.js'

type PointInput = {
  type: 'Point'
  coordinates: [number, number]
}

export async function getRouteDistanceAction(
  payload: { origin: PointInput, destination: PointInput, mode?: string },
  deps: { bridge: RouteBridge },
): Promise<SkillExecutionResult<{
  distance_m: number
  duration_min: number
  mode: string
  degraded: boolean
  degraded_reason: string | null
}>> {
  const route = await deps.bridge.estimateRoute(
    payload.origin.coordinates,
    payload.destination.coordinates,
    payload.mode || 'walking',
  )

  return {
    ok: true,
    data: {
      ...route,
      mode: payload.mode || 'walking',
    },
    meta: {
      action: 'get_route_distance',
      audited: false,
    },
  }
}
