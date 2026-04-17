WITH clipped AS (
  SELECT
    row_index,
    col_index,
    pop_value,
    geom,
    center_lon,
    center_lat,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_COLS}} - 1,
        FLOOR((center_lon - {{VIEWPORT_MIN_LON}}) / NULLIF({{VIEWPORT_TILE_WIDTH}}, 0))
      )
    )::int AS tile_x,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_ROWS}} - 1,
        FLOOR((center_lat - {{VIEWPORT_MIN_LAT}}) / NULLIF({{VIEWPORT_TILE_HEIGHT}}, 0))
      )
    )::int AS tile_y
  FROM population_grid_100m
  WHERE pop_value > 0
    AND ST_Intersects(geom, {{AREA_GEOMETRY}})
),
aggregated AS (
  SELECT
    tile_x,
    tile_y,
    ST_AsText(ST_Envelope(ST_Collect(geom))) AS grid_wkt,
    AVG(center_lon) AS center_lon,
    AVG(center_lat) AS center_lat,
    SUM(pop_value) AS pop_sum,
    MAX(pop_value) AS pop_peak,
    COUNT(*) AS cell_count
  FROM clipped
  GROUP BY tile_x, tile_y
)
SELECT
  grid_wkt,
  center_lon,
  center_lat,
  pop_sum,
  pop_peak,
  cell_count,
  tile_x,
  tile_y
FROM aggregated
WHERE cell_count > 0
ORDER BY pop_sum DESC, pop_peak DESC, cell_count DESC, tile_y ASC, tile_x ASC
LIMIT {{LIMIT}};
