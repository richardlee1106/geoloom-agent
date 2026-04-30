WITH base AS (
  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    ST_Distance(
      geom::geography,
      {{POINT_GEOGRAPHY}}
    ) AS distance_m,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_COLS}} - 1,
        FLOOR((longitude - {{VIEWPORT_MIN_LON}}) / NULLIF({{VIEWPORT_TILE_WIDTH}}, 0))
      )
    )::int AS tile_x,
    GREATEST(
      0,
      LEAST(
        {{VIEWPORT_TILE_ROWS}} - 1,
        FLOOR((latitude - {{VIEWPORT_MIN_LAT}}) / NULLIF({{VIEWPORT_TILE_HEIGHT}}, 0))
      )
    )::int AS tile_y
  FROM pois
  WHERE {{AREA_FILTER}}
  {{CATEGORY_FILTER}}
),
tagged AS (
  SELECT
    *,
    CASE
      WHEN (
        COALESCE(category_main, '') = '科教文化服务'
        OR COALESCE(category_sub, '') IN ('学校', '高等院校', '高等学校', '科教文化场所')
      )
      AND COALESCE(name, '') ~ '^(?:.{2,18}?(?:大学|学院))(?:$|[-·•_—[:space:]]|[(（]|(?:校区|校园|图书馆|体育馆|教学楼|实验楼|行政楼|礼堂|研究院|校医院|操场))'
      AND COALESCE(name, '') !~ '(小学|中学|幼儿园|附小|附中|实验学校|国际学校|九年一贯制|职业学院|职业技术学院|职业大学|职业学校|职业技术学校|高等专科学校|专科学校|高职|中专|中等专业学校|技师学院|技工学校|老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院|神学院|佛学院|道学院|修道院|修院|神哲学院|党校|团校|干部学院|行政学院)'
      AND COALESCE(name, '') !~ '(酒店|宾馆|公寓|小区|停车场|出入口|门市部|报名处|营业部|旅馆|教师公寓|家属区|驾校|培训|门店|共享设备|便利店|驿站|快递|药店|超市|餐厅|银行|旅行社|代理|充电|洗车|主题酒店)'
        THEN 1
      ELSE 0
    END AS is_strict_campus_anchor,
    CASE
      WHEN COALESCE(category_sub, '') IN ('景点', '景区', '风景区', '公园', '旅游景点', '名胜古迹')
        OR COALESCE(name, '') ~ '(景区|景点|风景区|旅游区|公园|博物馆|纪念馆|湿地公园|森林公园|植物园|动物园)'
        THEN 1
      ELSE 0
    END AS is_scenic_anchor,
    CASE
      WHEN COALESCE(category_sub, '') IN ('购物中心', '商场', '商业街', '步行街', '家居建材市场')
        OR COALESCE(name, '') ~* '(步行街|商业街|购物中心|购物广场|商业广场|商场|天地|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza|欧亚达|摩尔城|MALL)'
        THEN 1
      ELSE 0
    END AS is_commercial_anchor,
    CASE
      WHEN COALESCE(category_sub, '') = '地铁站'
        OR COALESCE(name, '') ~ '(地铁站|换乘站|轨道交通)'
        THEN 1
      ELSE 0
    END AS is_transit_anchor,
    CASE
      WHEN category_sub IS NOT NULL AND category_sub <> '' THEN category_sub
      WHEN category_main IS NOT NULL AND category_main <> '' THEN category_main
      ELSE '未分类'
    END AS category_bucket_base
  FROM base
),
source AS (
  SELECT
    *,
    CASE
      WHEN is_strict_campus_anchor = 1 THEN 0
      WHEN is_scenic_anchor = 1 THEN 1
      WHEN is_commercial_anchor = 1 THEN 2
      WHEN is_transit_anchor = 1 THEN 3
      ELSE 9
    END AS anchor_priority,
    CASE
      WHEN is_commercial_anchor = 1
        AND (
          COALESCE(name, '') ~* '(万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza|购物中心|购物广场|商场|汉街|欧亚达|摩尔城|MALL)'
          OR COALESCE(category_sub, '') IN ('购物中心', '商场')
        )
        THEN 0
      WHEN is_commercial_anchor = 1
        AND (
          COALESCE(name, '') ~* '(步行街|商业街|天地|汉街|奥特莱斯|奥莱)'
          OR COALESCE(category_sub, '') IN ('商业街', '步行街', '家居建材市场')
        )
        THEN 1
      ELSE 2
    END AS commercial_priority,
    CASE
      WHEN is_commercial_anchor = 1 THEN 'commercial'
      WHEN is_scenic_anchor = 1 THEN 'scenic'
      WHEN is_transit_anchor = 1 THEN 'transit'
      WHEN is_strict_campus_anchor = 1 THEN 'campus'
      ELSE category_bucket_base
    END AS category_bucket
  FROM tagged
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y
      ORDER BY anchor_priority ASC, commercial_priority ASC, distance_m ASC, id
    ) AS tile_rank,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y, category_bucket
      ORDER BY anchor_priority ASC, commercial_priority ASC, distance_m ASC, id
    ) AS tile_category_rank,
    ROW_NUMBER() OVER (
      PARTITION BY tile_x, tile_y, CASE WHEN is_commercial_anchor = 1 THEN 'commercial' ELSE 'other' END
      ORDER BY commercial_priority ASC, distance_m ASC, id
    ) AS tile_commercial_rank
  FROM source
),
sampled AS (
  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    distance_m,
    tile_x,
    tile_y,
    anchor_priority,
    commercial_priority,
    0 AS pass_order
  FROM ranked
  WHERE tile_rank = 1

  UNION ALL

  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    distance_m,
    tile_x,
    tile_y,
    anchor_priority,
    commercial_priority,
    1 AS pass_order
  FROM ranked
  WHERE tile_rank > 1
    AND tile_category_rank = 1

  UNION ALL

  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    distance_m,
    tile_x,
    tile_y,
    anchor_priority,
    commercial_priority,
    2 AS pass_order
  FROM ranked
  WHERE is_commercial_anchor = 1
    AND tile_commercial_rank <= 2
),
deduped AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY id
      ORDER BY pass_order ASC, anchor_priority ASC, commercial_priority ASC, distance_m ASC
    ) AS dedupe_rank
  FROM sampled
)
SELECT
  id,
  name,
  category_main,
  category_sub,
  longitude,
  latitude,
  distance_m,
  tile_x,
  tile_y,
  anchor_priority
FROM deduped
WHERE dedupe_rank = 1
ORDER BY pass_order ASC, anchor_priority ASC, commercial_priority ASC, tile_y ASC, tile_x ASC, distance_m ASC
LIMIT {{LIMIT}};
