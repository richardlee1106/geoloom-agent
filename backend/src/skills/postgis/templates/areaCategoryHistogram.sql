SELECT
  category_main,
  COUNT(id) AS poi_count
FROM pois
WHERE {{AREA_FILTER}}
{{CATEGORY_FILTER}}
GROUP BY category_main
ORDER BY poi_count DESC
LIMIT {{LIMIT}};
