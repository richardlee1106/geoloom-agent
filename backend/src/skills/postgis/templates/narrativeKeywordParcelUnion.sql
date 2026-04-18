-- 关键字驱动的地块合并（BFS 邻接扩散版）
--
-- 设计意图：
--   当一个 narrative 节点（如 "武汉生物工程学院"、"黄鹤楼公园"）在视口内没有现成的
--   aoi_native 多边形时，不再用"在节点 center 上套 150m 圆"的 point_halo 兜底——
--   这种兜底对横跨视口的校园/园区/景区效果极差，还会出现"圆在西侧商业区、标题却写
--   黄鹤楼"的位置偏离。
--
--   本模板用关键字驱动：
--     1) 在 视口 外扩 SEARCH_RADIUS_M 的范围里找出所有 name 含关键字的 POI（seed）
--     2) 在 视口内 找出"含至少一个 seed POI"的 aoi / landuse 地块（种子地块）
--     3) 从种子地块做 BFS 邻接扩散：向外 SEARCH_RADIUS_M 内、同样也含关键字 POI
--        的 aoi / landuse 地块也吸附进来（hop=1，结合空间邻接 + 关键字语义）
--     4) 对所有命中地块做 ST_Union 合并，相邻地块融合成整体，不相邻保留 MultiPolygon
--
-- 输入 token：
--   {{KEYWORD}}          —— 已做 SQL 单引号转义的关键字字面量（无需自带 %）
--   {{AREA_GEOMETRY}}    —— 视口 polygon（WGS84，SRID=4326）
--   {{SEARCH_RADIUS_M}}  —— BFS 邻接半径（米，建议 500）
--   {{LIMIT}}            —— 结果行数上限（本查询实际只返 1 行）
--
-- 输出列：
--   source           —— 固定 'landuse_parcel'
--   boundary_geojson —— 合并后 MultiPolygon 的 GeoJSON（WGS84）
--   area_m2          —— 合并几何面积（平方米）
--   parcel_count    —— 参与合并的地块个数
--
-- 失败约定：seed_pois 空或没有种子地块时，unified.geom 为 NULL，WHERE 裁掉 → 0 行。

WITH seed_pois AS (
  SELECT p.id, p.name, p.geom
  FROM pois p
  WHERE p.name ILIKE '%{{KEYWORD}}%'
    AND ST_Intersects(
      p.geom,
      ST_Buffer({{AREA_GEOMETRY}}::geography, {{SEARCH_RADIUS_M}})::geometry
    )
  LIMIT 500
),
seed_aoi_parcels AS (
  SELECT a.id, a.geom
  FROM aois a
  WHERE ST_Intersects(a.geom, {{AREA_GEOMETRY}})
    AND ST_GeometryType(a.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND EXISTS (
      SELECT 1 FROM seed_pois p WHERE ST_Contains(a.geom, p.geom)
    )
),
seed_landuse_parcels AS (
  SELECT l.id, l.geom
  FROM landuse l
  WHERE ST_Intersects(l.geom, {{AREA_GEOMETRY}})
    AND ST_GeometryType(l.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND EXISTS (
      SELECT 1 FROM seed_pois p WHERE ST_Contains(l.geom, p.geom)
    )
),
neighbor_aoi_parcels AS (
  SELECT DISTINCT a.id, a.geom
  FROM aois a
  WHERE ST_GeometryType(a.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND EXISTS (
      SELECT 1 FROM seed_pois p WHERE ST_Contains(a.geom, p.geom)
    )
    AND (
      EXISTS (
        SELECT 1 FROM seed_aoi_parcels s
        WHERE ST_DWithin(a.geom::geography, s.geom::geography, {{SEARCH_RADIUS_M}})
      )
      OR EXISTS (
        SELECT 1 FROM seed_landuse_parcels s
        WHERE ST_DWithin(a.geom::geography, s.geom::geography, {{SEARCH_RADIUS_M}})
      )
    )
),
neighbor_landuse_parcels AS (
  SELECT DISTINCT l.id, l.geom
  FROM landuse l
  WHERE ST_GeometryType(l.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND EXISTS (
      SELECT 1 FROM seed_pois p WHERE ST_Contains(l.geom, p.geom)
    )
    AND (
      EXISTS (
        SELECT 1 FROM seed_aoi_parcels s
        WHERE ST_DWithin(l.geom::geography, s.geom::geography, {{SEARCH_RADIUS_M}})
      )
      OR EXISTS (
        SELECT 1 FROM seed_landuse_parcels s
        WHERE ST_DWithin(l.geom::geography, s.geom::geography, {{SEARCH_RADIUS_M}})
      )
    )
),
all_parcels AS (
  SELECT geom FROM seed_aoi_parcels
  UNION ALL
  SELECT geom FROM seed_landuse_parcels
  UNION ALL
  SELECT geom FROM neighbor_aoi_parcels
  UNION ALL
  SELECT geom FROM neighbor_landuse_parcels
),
unified AS (
  SELECT ST_Union(geom) AS geom FROM all_parcels
)
SELECT
  'landuse_parcel' AS source,
  ST_AsGeoJSON(ST_SimplifyPreserveTopology(u.geom, 0.00005)) AS boundary_geojson,
  CAST(ST_Area(u.geom::geography) AS bigint) AS area_m2,
  (SELECT COUNT(*) FROM all_parcels) AS parcel_count
FROM unified u
WHERE u.geom IS NOT NULL
LIMIT {{LIMIT}}
