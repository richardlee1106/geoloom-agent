-- 区域品牌池：分别召回 campus / scenic / food_street / commercial 的 POI
-- 保证旅游景点、小吃街、高校、商业街不会被单一排序压住，同时避免把酒店/公寓误判成校园品牌。
WITH base AS (
  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    ST_Distance(geom::geography, {{POINT_GEOGRAPHY}}) AS distance_m
  FROM pois
  WHERE {{AREA_FILTER}}
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
        THEN 'campus'
      WHEN COALESCE(category_sub, '') IN ('景点', '景区', '风景区', '公园', '旅游景点', '名胜古迹')
        OR COALESCE(name, '') ~ '(风景区|景区|景点|旅游区|文化园|国家公园|湿地公园|森林公园|植物园|动物园|公园|博物馆|纪念馆|名胜|古迹)'
        THEN 'scenic'
      WHEN COALESCE(name, '') ~ '(小吃街|美食街|夜市|美食广场|美食城|大排档)'
        THEN 'food_street'
      WHEN COALESCE(category_sub, '') IN ('购物中心', '商场', '商业街', '步行街', '家居建材市场')
        OR COALESCE(name, '') ~* '(步行街|商业街|购物中心|购物广场|奥特莱斯|奥莱|商业广场|天地|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza|欧亚达|摩尔城|MALL)'
        THEN 'commercial'
      ELSE NULL
    END AS brand_bucket,
    CASE
      WHEN COALESCE(name, '') ~* '(万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza|购物中心|购物广场|商场|汉街|欧亚达|摩尔城|MALL)'
        OR COALESCE(category_sub, '') IN ('购物中心', '商场')
        THEN 0
      WHEN COALESCE(name, '') ~* '(步行街|商业街|天地|汉街|奥特莱斯|奥莱)'
        OR COALESCE(category_sub, '') IN ('商业街', '步行街', '家居建材市场')
        THEN 1
      ELSE 2
    END AS commercial_priority
  FROM base
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY brand_bucket
      ORDER BY commercial_priority ASC, distance_m ASC, id
    ) AS brand_rank
  FROM tagged
  WHERE brand_bucket IS NOT NULL
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
    WHEN 'commercial' THEN 0
    WHEN 'scenic' THEN 1
    WHEN 'food_street' THEN 2
    WHEN 'campus' THEN 3
    ELSE 4
  END,
  commercial_priority ASC,
  distance_m ASC
LIMIT {{LIMIT}};
