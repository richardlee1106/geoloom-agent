SELECT
  land_type,
  COUNT(id) AS parcel_count,
  SUM(area_sqm) AS total_area_sqm
FROM landuse
WHERE ST_Intersects(
  geom,
  {{AREA_GEOMETRY}}
)
GROUP BY land_type
ORDER BY total_area_sqm DESC, parcel_count DESC
LIMIT {{LIMIT}}
