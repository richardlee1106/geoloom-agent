-- 区域品牌池：分别召回 campus / scenic / food_street / commercial 的 POI
-- 保证旅游景点、小吃街、高校、商业街不会被 anchor_priority 单一排序压住
WITH source AS (
  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) AS distance_m,
    CASE
      WHEN COALESCE(name, '') ~ '(大学|学院)'
        AND COALESCE(name, '') !~ '(小学|中学|幼儿园|附小|附中|实验学校|国际学校|九年一贯制)'
        THEN 'campus'
      WHEN COALESCE(category_sub, '') IN ('景点', '景区', '风景区', '公园', '旅游景点', '名胜古迹')
        OR COALESCE(name, '') ~ '(风景区|景区|景点|旅游区|文化园|国家公园|湿地公园|森林公园|植物园|动物园|公园|博物馆|纪念馆|名胜|古迹)'
        THEN 'scenic'
      WHEN COALESCE(name, '') ~ '(小吃街|美食街|夜市|美食广场|美食城|大排档)'
        THEN 'food_street'
      WHEN COALESCE(category_sub, '') IN ('购物中心', '商场', '商业街', '步行街', '广场')
        OR COALESCE(name, '') ~ '(商圈|步行街|商业街|购物中心|购物广场|奥特莱斯|奥莱|商业广场|天地)'
        THEN 'commercial'
      ELSE NULL
    END AS brand_bucket
  FROM pois
  WHERE {{AREA_FILTER}}
),
tagged AS (
  SELECT *
  FROM source
  WHERE brand_bucket IS NOT NULL
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY brand_bucket
      ORDER BY distance_m ASC, id
    ) AS brand_rank
  FROM tagged
)
SELECT
  id,
  name,
  category_main,
  category_sub,
  longitude,
  latitude,
  distance_m,
  brand_bucket
FROM ranked
WHERE brand_rank <= 12
ORDER BY
  CASE brand_bucket
    WHEN 'campus' THEN 0
    WHEN 'scenic' THEN 1
    WHEN 'food_street' THEN 2
    WHEN 'commercial' THEN 3
    ELSE 4
  END,
  distance_m ASC
LIMIT {{LIMIT}};
