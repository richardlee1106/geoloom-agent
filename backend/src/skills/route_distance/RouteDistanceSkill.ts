import type { DependencyStatus } from '../../integration/dependencyStatus.js'
import { LocalOSMBridge, type RouteBridge } from '../../integration/osmBridge.js'
import type { SkillActionDefinition, SkillDefinition, SkillExecutionResult } from '../types.js'
import { getMultiDestinationAction } from './actions/getMultiDestination.js'
import { getRouteDistanceAction } from './actions/getRouteDistance.js'

const actions: Record<string, SkillActionDefinition> = {
  get_route_distance: {
    name: 'get_route_distance',
    description: '估算单点到单点的路网距离',
    inputSchema: {
      type: 'object',
      required: ['origin', 'destination'],
      properties: {
        origin: { type: 'object' },
        destination: { type: 'object' },
        mode: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        distance_m: { type: 'number' },
        duration_min: { type: 'number' },
      },
    },
  },
  get_multi_destination_matrix: {
    name: 'get_multi_destination_matrix',
    description: '对多个候选目的地做距离排序',
    inputSchema: {
      type: 'object',
      required: ['origin', 'destinations'],
      properties: {
        origin: { type: 'object' },
        destinations: { type: 'array', items: { type: 'object' } },
        mode: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' } },
      },
    },
  },
}

export function createRouteDistanceSkill(options: {
  bridge?: RouteBridge
} = {}): SkillDefinition {
  const bridge = options.bridge || new LocalOSMBridge()

  return {
    name: 'route_distance',
    description: '现实可达性技能，负责距离估算和候选排序',
    capabilities: ['get_route_distance', 'get_multi_destination_matrix'],
    actions,
    async getStatus(): Promise<Record<string, DependencyStatus>> {
      return {
        route_distance: await bridge.getStatus(),
      }
    },
    async execute(action, payload): Promise<SkillExecutionResult> {
      switch (action) {
        case 'get_route_distance':
          return getRouteDistanceAction(payload as never, { bridge })
        case 'get_multi_destination_matrix':
          return getMultiDestinationAction(payload as never, { bridge })
        default:
          return {
            ok: false,
            error: {
              code: 'unsupported_action',
              message: `Unknown route_distance action "${action}"`,
            },
            meta: {
              action,
              audited: false,
            },
          }
      }
    },
  }
}
