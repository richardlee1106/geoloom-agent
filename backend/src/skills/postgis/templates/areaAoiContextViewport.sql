WITH tiled_aoi AS (
  SELECT
    id,
    name,
    fclass,
    code,
    population,
    area_sqm,
    ST_X(ST_Centroid(geom)) AS longitude,
    ST_Y(ST_Centroid(geom)) AS latitude,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001)) AS boundary_geojson,
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
      WHEN ((COALESCE(name, '') ~ '(大学|学院|高校|校区)' AND COALESCE(name, '') !~ '(小学|中学|幼儿园|附小|附中|实验学校|国际学校|老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院|神学院|佛学院|道学院|修道院|修院|神哲学院)')
        OR COALESCE(fclass, '') IN ('university', 'college')) THEN 0
      WHEN COALESCE(name, '') ~ '(景区|景点|风景区|旅游区|公园|湖|江|河|湿地)'
        OR COALESCE(fclass, '') IN ('scenic', 'park', 'tourism', 'water', 'wetland', 'forest', 'nature_reserve', 'reservoir', 'lake', 'river') THEN 1
      WHEN COALESCE(name, '') ~* '(商圈|步行街|广场|购物中心|商业街|商场|天地|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza)' OR COALESCE(fclass, '') IN ('commercial', 'mall', 'retail') THEN 2
      WHEN COALESCE(name, '') ~ '(地铁站|换乘站|轨道交通)' OR COALESCE(fclass, '') IN ('station', 'metro_station', 'subway_station') THEN 3
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
  longitude,
  latitude,
  boundary_geojson,
  tile_x,
  tile_y,
  anchor_priority
FROM ranked
WHERE tile_rank = 1
ORDER BY anchor_priority ASC, tile_y ASC, tile_x ASC, population DESC NULLS LAST, area_sqm DESC
LIMIT {{LIMIT}};
