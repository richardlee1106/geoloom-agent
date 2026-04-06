SELECT id, name, category_main, category_sub, longitude, latitude,
       ST_Distance(
  geom::geography,
  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
) AS distance_m
FROM pois
WHERE ST_DWithin(
  geom::geography,
  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
  $3
)
  AND category_main = '交通设施服务'
  AND category_sub = '地铁站'
ORDER BY distance_m ASC
LIMIT $4;
