import type { SkillExecutionResult } from '../../types.js'
import type { RouteBridge } from '../../../integration/osmBridge.js'

type PointInput = {
  id?: string
  type: 'Point'
  coordinates: [number, number]
}

export async function getMultiDestinationAction(
  payload: { origin: PointInput, destinations: PointInput[], mode?: string },
  deps: { bridge: RouteBridge },
): Promise<SkillExecutionResult<{
  results: Array<{ id: string, distance_m: number, duration_min: number, rank: number }>
}>> {
  const results = (await Promise.all(
    payload.destinations.map(async (destination) => ({
      id: destination.id || 'candidate',
      ...await deps.bridge.estimateRoute(
        payload.origin.coordinates,
        destination.coordinates,
        payload.mode || 'walking',
      ),
    })),
  ))
    .sort((a, b) => a.distance_m - b.distance_m)
    .map((item, index) => ({
      id: item.id,
      distance_m: item.distance_m,
      duration_min: item.duration_min,
      rank: index + 1,
    }))

  return {
    ok: true,
    data: { results },
    meta: {
      action: 'get_multi_destination_matrix',
      audited: false,
    },
  }
}
