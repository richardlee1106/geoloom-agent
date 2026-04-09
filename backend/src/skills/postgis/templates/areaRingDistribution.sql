SELECT
  CASE
    WHEN ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) < 300 THEN '0-300m'
    WHEN ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) < 600 THEN '300-600m'
    WHEN ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) < 900 THEN '600-900m'
    ELSE '900m+'
  END AS ring_label,
  CASE
    WHEN ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) < 300 THEN 1
    WHEN ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) < 600 THEN 2
    WHEN ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) < 900 THEN 3
    ELSE 4
  END AS ring_order,
  COUNT(id) AS poi_count
FROM pois
WHERE {{AREA_FILTER}}
{{CATEGORY_FILTER}}
GROUP BY ring_label, ring_order
ORDER BY ring_order ASC;
