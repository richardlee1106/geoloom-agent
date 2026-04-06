SELECT id, name, category_big, category_mid, category_small
FROM pois
WHERE ST_Intersects(
  geom,
  ST_Buffer(
    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    $3
  )::geometry
)
LIMIT $4;

