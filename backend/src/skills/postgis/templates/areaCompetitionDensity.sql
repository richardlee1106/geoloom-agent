SELECT
  {{COMPETITION_DIMENSION}} AS competition_key,
  COUNT(id) AS poi_count,
  MIN(ST_Distance(geom::geography, {{POINT_GEOGRAPHY}})) AS nearest_distance_m,
  AVG(ST_Distance(geom::geography, {{POINT_GEOGRAPHY}})) AS avg_distance_m
FROM pois
WHERE {{AREA_FILTER}}
{{CATEGORY_FILTER}}
GROUP BY 1
ORDER BY poi_count DESC
LIMIT {{LIMIT}};
