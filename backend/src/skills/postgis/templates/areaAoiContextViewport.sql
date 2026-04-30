WITH base AS (
  SELECT
    id,
    name,
    fclass,
    code,
    population,
    area_sqm,
    geom,
    ST_Centroid(geom) AS centroid_geom
  FROM aois
  WHERE ST_Intersects(
    geom,
    {{AREA_GEOMETRY}}
  )
),
tiled_aoi AS (
  SELECT
    id,
    name,
    fclass,
    code,
    population,
    area_sqm,
    ST_X(centroid_geom) AS longitude,
    ST_Y(centroid_geom) AS latitude,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001)) AS boundary_geojson,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_COLS}} - 1,
        FLOOR((ST_X(centroid_geom) - {{VIEWPORT_MIN_LON}}) / NULLIF({{VIEWPORT_TILE_WIDTH}}, 0))
      )
    )::int AS tile_x,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_ROWS}} - 1,
        FLOOR((ST_Y(centroid_geom) - {{VIEWPORT_MIN_LAT}}) / NULLIF({{VIEWPORT_TILE_HEIGHT}}, 0))
      )
    )::int AS tile_y,
    CASE
      WHEN (
        COALESCE(fclass, '') = 'university'
        OR (
          COALESCE(fclass, '') = 'college'
          AND COALESCE(name, '') ~ '^(?:.{2,18}?(?:大学|学院))(?:$|[-·•_—[:space:]]|[(（]|(?:校区|校园|图书馆|体育馆|教学楼|实验楼|行政楼|礼堂|研究院|校医院|操场))'
        )
      )
      AND COALESCE(name, '') !~ '(小学|中学|幼儿园|附小|附中|实验学校|国际学校|九年一贯制|职业学院|职业技术学院|职业大学|职业学校|职业技术学校|高等专科学校|专科学校|高职|中专|中等专业学校|技师学院|技工学校|老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院|神学院|佛学院|道学院|修道院|修院|神哲学院|党校|团校|干部学院|行政学院)'
        THEN 1
      ELSE 0
    END AS is_strict_campus_anchor,
    CASE
      WHEN COALESCE(name, '') ~ '(景区|景点|风景区|旅游区|公园|湖|江|河|湿地)'
        OR COALESCE(fclass, '') IN ('scenic', 'park', 'tourism', 'water', 'wetland', 'forest', 'nature_reserve', 'reservoir', 'lake', 'river')
        THEN 1
      ELSE 0
    END AS is_scenic_anchor,
    CASE
      WHEN COALESCE(name, '') ~* '(步行街|购物中心|商业街|商场|天地|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza|欧亚达|摩尔城|MALL)'
        OR COALESCE(fclass, '') IN ('commercial', 'mall', 'retail')
        THEN 1
      ELSE 0
    END AS is_commercial_anchor,
    CASE
      WHEN COALESCE(name, '') ~ '(地铁站|换乘站|轨道交通)'
        OR COALESCE(fclass, '') IN ('station', 'metro_station', 'subway_station')
        THEN 1
      ELSE 0
    END AS is_transit_anchor
  FROM base
),
scored AS (
  SELECT
    *,
    CASE
      WHEN is_strict_campus_anchor = 1 THEN 0
      WHEN is_scenic_anchor = 1 THEN 1
      WHEN is_commercial_anchor = 1 THEN 2
      WHEN is_transit_anchor = 1 THEN 3
      ELSE 9
    END AS anchor_priority,
    CASE
      WHEN is_commercial_anchor = 1
        AND (
          COALESCE(name, '') ~* '(万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza|购物中心|商场|欧亚达|MALL)'
          OR COALESCE(fclass, '') IN ('mall', 'retail')
        )
        THEN 0
      WHEN is_commercial_anchor = 1 THEN 1
      ELSE 2
    END AS commercial_priority,
    CASE
      WHEN is_commercial_anchor = 1 THEN 'commercial'
      WHEN is_scenic_anchor = 1 THEN 'scenic'
      WHEN is_transit_anchor = 1 THEN 'transit'
      WHEN is_strict_campus_anchor = 1 THEN 'campus'
      ELSE COALESCE(NULLIF(fclass, ''), 'other')
    END AS anchor_bucket
  FROM tiled_aoi
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y
      ORDER BY anchor_priority ASC, commercial_priority ASC, population DESC NULLS LAST, area_sqm DESC, id
    ) AS tile_rank,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y, anchor_bucket
      ORDER BY anchor_priority ASC, commercial_priority ASC, population DESC NULLS LAST, area_sqm DESC, id
    ) AS tile_bucket_rank,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y, CASE WHEN is_commercial_anchor = 1 THEN 'commercial' ELSE 'other' END
      ORDER BY commercial_priority ASC, population DESC NULLS LAST, area_sqm DESC, id
    ) AS tile_commercial_rank
  FROM scored
),
sampled AS (
  SELECT
    id,
    name,
    fclass,
    code,
    population,
    area_sqm,
    longitude,
    latitude,
    boundary_geojson,
    tile_x,
    tile_y,
    anchor_priority,
    commercial_priority,
    0 AS pass_order
  FROM ranked
  WHERE tile_rank = 1

  UNION ALL

  SELECT
    id,
    name,
    fclass,
    code,
    population,
    area_sqm,
    longitude,
    latitude,
    boundary_geojson,
    tile_x,
    tile_y,
    anchor_priority,
    commercial_priority,
    1 AS pass_order
  FROM ranked
  WHERE tile_rank > 1
    AND tile_bucket_rank = 1

  UNION ALL

  SELECT
    id,
    name,
    fclass,
    code,
    population,
    area_sqm,
    longitude,
    latitude,
    boundary_geojson,
    tile_x,
    tile_y,
    anchor_priority,
    commercial_priority,
    2 AS pass_order
  FROM ranked
  WHERE is_commercial_anchor = 1
    AND tile_commercial_rank <= 2
),
deduped AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY id
      ORDER BY pass_order ASC, anchor_priority ASC, commercial_priority ASC, population DESC NULLS LAST, area_sqm DESC
    ) AS dedupe_rank
  FROM sampled
)
SELECT
  id,
  name,
  fclass,
  code,
  population,
  area_sqm,
  longitude,
  latitude,
  boundary_geojson,
  tile_x,
  tile_y,
  anchor_priority
FROM deduped
WHERE dedupe_rank = 1
ORDER BY pass_order ASC, anchor_priority ASC, commercial_priority ASC, tile_y ASC, tile_x ASC, population DESC NULLS LAST, area_sqm DESC
LIMIT {{LIMIT}};
