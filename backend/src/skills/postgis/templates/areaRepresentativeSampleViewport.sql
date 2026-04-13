WITH source AS (
  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    ST_Distance(
      geom::geography,
      {{POINT_GEOGRAPHY}}
    ) AS distance_m,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_COLS}} - 1,
        FLOOR((longitude - {{VIEWPORT_MIN_LON}}) / NULLIF({{VIEWPORT_TILE_WIDTH}}, 0))
      )
    )::int AS tile_x,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_ROWS}} - 1,
        FLOOR((latitude - {{VIEWPORT_MIN_LAT}}) / NULLIF({{VIEWPORT_TILE_HEIGHT}}, 0))
      )
    )::int AS tile_y,
    CASE
      WHEN COALESCE(name, '') ~ '(大学|学院|学校|校区)' THEN 0
      WHEN COALESCE(category_sub, '') IN ('景点', '景区', '风景区', '公园') OR COALESCE(name, '') ~ '(景区|景点|风景区|旅游区|公园)' THEN 1
      WHEN COALESCE(name, '') ~ '(商圈|步行街|广场|购物中心|商业街|商场)' OR COALESCE(category_sub, '') IN ('购物中心', '商场', '商业街', '步行街') THEN 2
      WHEN COALESCE(category_sub, '') = '地铁站' OR COALESCE(name, '') ~ '地铁站' THEN 3
      ELSE 9
    END AS anchor_priority,
    CASE
      WHEN category_sub IS NOT NULL AND category_sub <> '' THEN category_sub
      WHEN category_main IS NOT NULL AND category_main <> '' THEN category_main
      ELSE '未分类'
    END AS category_bucket
  FROM pois
  WHERE {{AREA_FILTER}}
  {{CATEGORY_FILTER}}
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y
      ORDER BY anchor_priority ASC, distance_m ASC, id
    ) AS tile_rank,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y, category_bucket
      ORDER BY anchor_priority ASC, distance_m ASC, id
    ) AS tile_category_rank
  FROM source
)
SELECT
  id,
  name,
  category_main,
  category_sub,
  longitude,
  latitude,
  distance_m,
  tile_x,
  tile_y,
  anchor_priority
FROM (
  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    distance_m,
    tile_x,
    tile_y,
    anchor_priority,
    0 AS pass_order
  FROM ranked
  WHERE tile_rank = 1

  UNION ALL

  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    distance_m,
    tile_x,
    tile_y,
    anchor_priority,
    1 AS pass_order
  FROM ranked
  WHERE tile_rank > 1
    AND tile_category_rank = 1
) sampled
ORDER BY anchor_priority ASC, pass_order ASC, tile_y ASC, tile_x ASC, distance_m ASC
LIMIT {{LIMIT}};
