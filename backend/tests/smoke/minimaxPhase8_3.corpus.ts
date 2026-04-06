export interface MiniMaxPhase83SmokeCase {
  id: string
  query: string
  expectedQueryType: 'nearby_poi' | 'nearest_station' | 'similar_regions' | 'compare_places'
  expectedEvidenceType: 'poi_list' | 'transport' | 'semantic_candidate' | 'comparison'
  expectedAnchorKeyword?: string
  expectedKeyword?: string
}

export const minimaxPhase83SmokeCases: MiniMaxPhase83SmokeCase[] = [
  {
    id: 'smoke_nearby_wuda_coffee_direct',
    query: '武汉大学附近有哪些咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedAnchorKeyword: '武汉大学',
    expectedKeyword: 'luckin coffee',
  },
  {
    id: 'smoke_nearby_wuda_coffee_list',
    query: '武汉大学周边有什么咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedAnchorKeyword: '武汉大学',
    expectedKeyword: 'luckin coffee',
  },
  {
    id: 'smoke_nearby_guanggu_coffee',
    query: '光谷步行街附近有哪些咖啡店？',
    expectedQueryType: 'nearby_poi',
    expectedEvidenceType: 'poi_list',
    expectedAnchorKeyword: '光谷',
    expectedKeyword: 'luckin coffee',
  },
  {
    id: 'smoke_nearest_hubei_university_station',
    query: '湖北大学最近的地铁站是什么？',
    expectedQueryType: 'nearest_station',
    expectedEvidenceType: 'transport',
    expectedAnchorKeyword: '湖北大学',
    expectedKeyword: '湖北大学地铁站',
  },
  {
    id: 'smoke_nearest_hubei_university_exit_detail',
    query: '湖北大学最近的地铁站，站口也列出来，并说明哪个出口最近',
    expectedQueryType: 'nearest_station',
    expectedEvidenceType: 'transport',
    expectedAnchorKeyword: '湖北大学',
    expectedKeyword: '湖北大学地铁站E口',
  },
  {
    id: 'smoke_nearest_wuda_station',
    query: '武汉大学最近的地铁站是什么？',
    expectedQueryType: 'nearest_station',
    expectedEvidenceType: 'transport',
    expectedAnchorKeyword: '武汉大学',
    expectedKeyword: '小洪山',
  },
  {
    id: 'smoke_compare_food_activity',
    query: '比较武汉大学和湖北大学附近的餐饮活跃度',
    expectedQueryType: 'compare_places',
    expectedEvidenceType: 'comparison',
    expectedAnchorKeyword: '武汉大学',
    expectedKeyword: '湖北大学',
  },
  {
    id: 'smoke_compare_metro_distribution',
    query: '比较武汉大学和湖北大学附近的地铁分布',
    expectedQueryType: 'compare_places',
    expectedEvidenceType: 'comparison',
    expectedAnchorKeyword: '武汉大学',
    expectedKeyword: '湖北大学',
  },
  {
    id: 'smoke_similar_regions_direct',
    query: '和武汉大学周边气质相似的片区有哪些？',
    expectedQueryType: 'similar_regions',
    expectedEvidenceType: 'semantic_candidate',
    expectedAnchorKeyword: '武汉大学',
  },
  {
    id: 'smoke_similar_regions_variant',
    query: '哪些片区和武汉大学周边气质相似？',
    expectedQueryType: 'similar_regions',
    expectedEvidenceType: 'semantic_candidate',
    expectedAnchorKeyword: '武汉大学',
  },
]
