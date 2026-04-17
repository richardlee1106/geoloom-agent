-- 聚合边界生成：成员 POI → DBSCAN 聚类 → ConcaveHull → Buffer 软化 → Landuse 吸附
-- 输入：MEMBER_POINTS（WKT MultiPoint）、AREA_GEOMETRY（视口范围）、LANDUSE_GEOMS（可选 landuse 吸附层）
-- 输出：聚合后的 GeoJSON Polygon，面积（m²），以及 source 标识

WITH member_pts AS (
  SELECT ST_GeomFromText('{{MEMBER_POINTS}}', 4326) AS geom
),
-- DBSCAN 聚类：eps=200m（geography），minpoints=2
clustered AS (
  SELECT
    ST_ClusterDBSCAN(geom, 200, 2) OVER () AS cluster_id,
    (dump).geom AS pt
  FROM member_pts, LATERAL ST_DumpPoints((SELECT geom FROM member_pts)) AS dump
),
-- 只取有效聚类（cluster_id IS NOT NULL），对每个聚类做 ConcaveHull
hulls AS (
  SELECT
    cluster_id,
    ST_ConcaveHull(ST_Collect(pt), 0.85) AS hull_geom
  FROM clustered
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id
  HAVING COUNT(*) >= 3
),
-- Buffer 软化：50m 缓冲 + 再 -30m 内缩，形成平滑轮廓
softened AS (
  SELECT
    cluster_id,
    ST_Buffer(ST_Buffer(hull_geom::geography, 50)::geometry, -30) AS soft_geom
  FROM hulls
),
-- 尝试吸附 landuse：如果 softened 与 landuse polygon 重叠 >40%，则用 landuse 几何替代
-- LANDUSE_FILTER 是可选的 ST_Intersects 条件；当无 landuse 数据时退化为 TRUE
landuse_snap AS (
  SELECT
    s.cluster_id,
    s.soft_geom,
    COALESCE(
      (
        SELECT l.geom
        FROM landuse l
        WHERE ST_Intersects(l.geom, s.soft_geom)
          AND ST_GeometryType(l.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
          AND ST_Area(ST_Intersection(l.geom, s.soft_geom)::geography)
            > 0.4 * ST_Area(s.soft_geom::geography)
        ORDER BY ST_Area(ST_Intersection(l.geom, s.soft_geom)::geography) DESC
        LIMIT 1
      ),
      s.soft_geom
    ) AS final_geom
  FROM softened s
)
SELECT
  'aggregate_morphology' AS source,
  ST_AsGeoJSON(ST_SimplifyPreserveTopology(final_geom, 0.00005)) AS boundary_geojson,
  CAST(ST_Area(final_geom::geography) AS bigint) AS area_m2
FROM landuse_snap
