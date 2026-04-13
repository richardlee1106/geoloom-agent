WITH tiled_aoi AS (
  SELECT
    id,
    name,
    fclass,
    code,
    population,
    area_sqm,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_COLS}} - 1,
        FLOOR((ST_X(ST_Centroid(geom)) - {{VIEWPORT_MIN_LON}}) / NULLIF({{VIEWPORT_TILE_WIDTH}}, 0))
      )
    )::int AS tile_x,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_ROWS}} - 1,
        FLOOR((ST_Y(ST_Centroid(geom)) - {{VIEWPORT_MIN_LAT}}) / NULLIF({{VIEWPORT_TILE_HEIGHT}}, 0))
      )
    )::int AS tile_y,
    CASE
      WHEN COALESCE(name, '') ~ '(大学|学院|学校|校区)' OR COALESCE(fclass, '') IN ('school', 'education', 'university', 'college') THEN 0
      WHEN COALESCE(name, '') ~ '(景区|景点|风景区|旅游区|公园)' OR COALESCE(fclass, '') IN ('scenic', 'park', 'tourism') THEN 1
      WHEN COALESCE(name, '') ~ '(商圈|步行街|广场|购物中心|商业街|商场)' OR COALESCE(fclass, '') IN ('commercial', 'mall', 'retail') THEN 2
      WHEN COALESCE(name, '') ~ '地铁站' OR COALESCE(fclass, '') IN ('station', 'metro_station', 'subway_station') THEN 3
      ELSE 9
    END AS anchor_priority
  FROM aois
  WHERE ST_Intersects(
    geom,
    {{AREA_GEOMETRY}}
  )
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y
      ORDER BY anchor_priority ASC, population DESC NULLS LAST, area_sqm DESC, id
    ) AS tile_rank
  FROM tiled_aoi
)
SELECT
  id,
  name,
  fclass,
  code,
  population,
  area_sqm,
  tile_x,
  tile_y,
  anchor_priority
FROM ranked
WHERE tile_rank = 1
ORDER BY anchor_priority ASC, tile_y ASC, tile_x ASC, population DESC NULLS LAST, area_sqm DESC
LIMIT {{LIMIT}};
