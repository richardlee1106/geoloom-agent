WITH seed_pois AS (
  SELECT p.id, p.geom
  FROM pois p
  WHERE p.name ILIKE '%{{KEYWORD}}%'
    AND ST_Intersects(
      p.geom,
      ST_Buffer({{AREA_GEOMETRY}}::geography, {{SEARCH_RADIUS_M}})::geometry
    )
  LIMIT 500
),
supporting_parcels AS (
  SELECT a.geom
  FROM aois a
  WHERE ST_Intersects(
    a.geom,
    ST_Buffer({{AREA_GEOMETRY}}::geography, {{SEARCH_RADIUS_M}})::geometry
  )
    AND ST_GeometryType(a.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND EXISTS (
      SELECT 1 FROM seed_pois p WHERE ST_Contains(a.geom, p.geom)
    )
  UNION ALL
  SELECT l.geom
  FROM landuse l
  WHERE ST_Intersects(
    l.geom,
    ST_Buffer({{AREA_GEOMETRY}}::geography, {{SEARCH_RADIUS_M}})::geometry
  )
    AND ST_GeometryType(l.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND EXISTS (
      SELECT 1 FROM seed_pois p WHERE ST_Contains(l.geom, p.geom)
    )
),
seed_blocks AS (
  SELECT DISTINCT b.id, b.geom
  FROM road_blocks b
  WHERE ST_Intersects(b.geom, {{AREA_GEOMETRY}})
    AND ST_GeometryType(b.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND (
      EXISTS (
        SELECT 1 FROM seed_pois p WHERE ST_Contains(b.geom, p.geom)
      )
      OR EXISTS (
        SELECT 1 FROM supporting_parcels s WHERE ST_Intersects(b.geom, s.geom)
      )
    )
),
neighbor_blocks AS (
  SELECT DISTINCT b.id, b.geom
  FROM road_blocks b
  WHERE ST_Intersects(b.geom, {{AREA_GEOMETRY}})
    AND ST_GeometryType(b.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND EXISTS (
      SELECT 1
      FROM seed_blocks s
      WHERE ST_DWithin(b.geom::geography, s.geom::geography, {{SEARCH_RADIUS_M}})
    )
    AND (
      EXISTS (
        SELECT 1
        FROM seed_pois p
        WHERE ST_DWithin(b.geom::geography, p.geom::geography, 120)
      )
      OR EXISTS (
        SELECT 1
        FROM supporting_parcels s
        WHERE ST_Intersects(b.geom, s.geom)
      )
    )
),
all_blocks AS (
  SELECT geom FROM seed_blocks
  UNION ALL
  SELECT geom FROM neighbor_blocks
),
unified AS (
  SELECT ST_Union(geom) AS geom FROM all_blocks
)
SELECT
  'road_block' AS source,
  ST_AsGeoJSON(ST_SimplifyPreserveTopology(u.geom, 0.00005)) AS boundary_geojson,
  CAST(ST_Area(u.geom::geography) AS bigint) AS area_m2,
  (SELECT COUNT(*) FROM all_blocks) AS block_count
FROM unified u
WHERE u.geom IS NOT NULL
LIMIT {{LIMIT}}
