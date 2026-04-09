export interface PostgisCatalog {
  tables: Record<string, string[]>
  functions: string[]
  requiredSpatialFunctions: string[]
  maxLimit: number
}

export function createPostgisCatalog(): PostgisCatalog {
  return {
    tables: {
      pois: [
        'id',
        'name',
        'category_main',
        'category_sub',
        'longitude',
        'latitude',
        'city',
        'region_label',
        'location_hint',
        'brand_category',
        'geom',
      ],
      aois: [
        'id',
        'osm_id',
        'code',
        'fclass',
        'name',
        'population',
        'area_sqm',
        'geom',
      ],
      landuse: [
        'id',
        'land_type',
        'area_sqm',
        'geom',
      ],
    },
    functions: [
      'count',
      'sum',
      'avg',
      'min',
      'max',
      'st_dwithin',
      'st_distance',
      'st_setsrid',
      'st_makepoint',
      'st_x',
      'st_y',
      'st_intersects',
      'st_contains',
      'st_buffer',
      'st_astext',
      'st_geomfromtext',
      'st_squaregrid',
      'st_hexagongrid',
      'st_snaptogrid',
      'row_number',
    ],
    requiredSpatialFunctions: ['st_dwithin', 'st_intersects', 'st_contains'],
    maxLimit: 200,
  }
}
