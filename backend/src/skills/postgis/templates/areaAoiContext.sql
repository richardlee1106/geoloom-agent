SELECT
  id,
  name,
  fclass,
  code,
  population,
  area_sqm
FROM aois
WHERE ST_Intersects(
  geom,
  {{AREA_GEOMETRY}}
)
ORDER BY population DESC NULLS LAST, area_sqm DESC
LIMIT {{LIMIT}}
