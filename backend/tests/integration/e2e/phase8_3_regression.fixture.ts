import type { RegressionProviderMode } from '../helpers/chatRegressionHarness.js'
import areaInsightGoldenCases from '../../fixtures/areaInsightGoldenCases.json' with { type: 'json' }

export interface Phase83RegressionFixture {
  id: string
  query: string
  expectedQueryType: 'nearby_poi' | 'nearest_station' | 'similar_regions' | 'compare_places' | 'area_overview' | 'unsupported'
  expectedEvidenceType: 'poi_list' | 'transport' | 'semantic_candidate' | 'comparison' | 'area_overview'
  expectedKeywords: string[]
  providerMode?: RegressionProviderMode
  expectedProviderReady?: boolean
  requestOptions?: Record<string, unknown>
}

const baseRegressionFixtures: Phase83RegressionFixture[] = [
  {
    id: 'q01_nearby_coffee_default',
    query: '武汉大学附近有哪些咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedKeywords: ['武汉大学', 'luckin coffee'],
  },
  {
    id: 'q02_nearest_station_default',
    query: '湖北大学最近的地铁站，站口也列出来，并说明哪个出口最近',
    expectedQueryType: 'nearest_station',
    expectedEvidenceType: 'transport',
    expectedKeywords: ['湖北大学地铁站E口'],
  },
  {
    id: 'q03_nearest_station_recovery',
    query: '武汉大学最近的地铁站是什么？',
    expectedQueryType: 'nearest_station',
    expectedEvidenceType: 'transport',
    expectedKeywords: ['小洪山'],
    providerMode: 'nearest_station_recovery',
  },
  {
    id: 'q04_similar_regions_default',
    query: '和武汉大学周边气质相似的片区有哪些？',
    expectedQueryType: 'similar_regions',
    expectedEvidenceType: 'semantic_candidate',
    expectedKeywords: ['相似'],
  },
  {
    id: 'q05_compare_food_default',
    query: '比较武汉大学和湖北大学附近的餐饮活跃度',
    expectedQueryType: 'compare_places',
    expectedEvidenceType: 'comparison',
    expectedKeywords: ['武汉大学', '湖北大学'],
  },
  {
    id: 'q06_unresolved_anchor_clarify',
    query: '火星大学附近有哪些咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedKeywords: ['没有定位到'],
  },
  {
    id: 'q07_provider_unavailable_fallback',
    query: '武汉大学附近有哪些咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedKeywords: ['武汉大学', 'luckin coffee'],
    providerMode: 'provider_unavailable',
    expectedProviderReady: false,
  },
  {
    id: 'q08_polished_answer_provider',
    query: '武汉大学附近有哪些咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedKeywords: ['大模型的最终结论', 'luckin coffee'],
    providerMode: 'polished_answer',
    expectedProviderReady: true,
  },
  {
    id: 'q09_compare_metro_provider',
    query: '比较武汉大学和湖北大学附近的地铁分布',
    expectedQueryType: 'compare_places',
    expectedEvidenceType: 'comparison',
    expectedKeywords: ['武汉大学', '湖北大学'],
    providerMode: 'compare_metro',
  },
  {
    id: 'q10_provider_throwing_degrades',
    query: '武汉大学附近有哪些咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedKeywords: ['武汉大学', 'luckin coffee'],
    providerMode: 'provider_throwing',
  },
]

export const phase83RegressionFixtures: Phase83RegressionFixture[] = [
  ...baseRegressionFixtures,
  ...(areaInsightGoldenCases as Phase83RegressionFixture[]),
]
