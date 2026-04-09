SELECT
  ST_AsText(grid.geom) AS grid_wkt,
  COUNT(p.id) AS poi_count
FROM ST_SquareGrid(
  {{CELL_SIZE_DEG}},
  {{AREA_GEOMETRY}}
) AS grid
LEFT JOIN pois p
  ON ST_Intersects(p.geom, grid.geom)
  AND {{AREA_JOIN_FILTER}}
{{CATEGORY_JOIN_FILTER}}
GROUP BY grid.geom
HAVING COUNT(p.id) > 0
ORDER BY poi_count DESC
LIMIT {{LIMIT}};
