-- 视口内 landuse polygon 输出 geom，用于聚合边界吸附
-- land_type 优先级：residential > commercial > industrial > 其他
SELECT
  id,
  land_type,
  area_sqm,
  ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001)) AS boundary_geojson
FROM landuse
WHERE ST_Intersects(geom, {{AREA_GEOMETRY}})
  AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
  AND ST_Area(geom::geography) > 500
ORDER BY
  CASE land_type
    WHEN 'residential' THEN 0
    WHEN 'commercial' THEN 1
    WHEN 'retail' THEN 2
    WHEN 'industrial' THEN 3
    ELSE 4
  END,
  area_sqm DESC
LIMIT {{LIMIT}}
