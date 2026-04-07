import type { ComparisonPair, DeterministicIntent, EvidenceItem, EvidenceView, ResolvedAnchor } from '../chat/types.js'
import { buildAreaOverviewView } from './views/AreaOverviewView.js'
import { buildBucketView } from './views/BucketView.js'
import { buildComparisonView } from './views/ComparisonView.js'
import { buildPOIListView } from './views/POIListView.js'
import { buildSemanticCandidateView } from './views/SemanticCandidateView.js'
import { buildTransportView } from './views/TransportView.js'

export class EvidenceViewFactory {
  create(input: {
    intent: DeterministicIntent
    anchor: ResolvedAnchor
    rows?: Record<string, unknown>[]
    items?: EvidenceItem[]
    secondaryAnchor?: ResolvedAnchor
    pairs?: ComparisonPair[]
  }): EvidenceView {
    if (input.intent.queryType === 'compare_places' && input.secondaryAnchor && input.pairs) {
      return buildComparisonView({
        anchor: input.anchor,
        secondaryAnchor: input.secondaryAnchor,
        intent: input.intent,
        pairs: input.pairs,
      })
    }

    if (input.intent.queryType === 'similar_regions') {
      return buildSemanticCandidateView({
        anchor: input.anchor,
        intent: input.intent,
        items: input.items || [],
      })
    }

    if (input.intent.queryType === 'nearest_station') {
      return buildTransportView({
        anchor: input.anchor,
        rows: input.rows || [],
        intent: input.intent,
      })
    }

    if (input.intent.queryType === 'area_overview') {
      return buildAreaOverviewView({
        anchor: input.anchor,
        rows: input.rows || [],
        intent: input.intent,
      })
    }

    if (input.intent.targetCategory === '餐饮' && (input.items || []).length > 1) {
      return buildBucketView({
        anchor: input.anchor,
        intent: input.intent,
        rows: input.items || [],
      })
    }

    return buildPOIListView({
      anchor: input.anchor,
      rows: input.rows || [],
      intent: input.intent,
    })
  }
}
