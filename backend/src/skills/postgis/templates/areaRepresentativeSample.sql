SELECT
  id,
  name,
  category_main,
  category_sub,
  longitude,
  latitude,
  distance_m
FROM (
  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    distance_m,
    cell_rank,
    0 AS pass_order
  FROM (
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
      ROW_NUMBER() OVER (
        PARTITION BY ST_AsText(
          ST_SnapToGrid(
            geom,
            {{CELL_SIZE_DEG}},
            {{CELL_SIZE_DEG}}
          )
        )
        ORDER BY ST_Distance(
          geom::geography,
          {{POINT_GEOGRAPHY}}
        ) ASC, id
      ) AS cell_rank,
      ROW_NUMBER() OVER (
        PARTITION BY ST_AsText(
          ST_SnapToGrid(
            geom,
            {{CELL_SIZE_DEG}},
            {{CELL_SIZE_DEG}}
          )
        ),
        CASE
          WHEN category_sub IS NOT NULL AND category_sub <> '' THEN category_sub
          WHEN category_main IS NOT NULL AND category_main <> '' THEN category_main
          ELSE '未分类'
        END
        ORDER BY ST_Distance(
          geom::geography,
          {{POINT_GEOGRAPHY}}
        ) ASC, id
      ) AS cell_category_rank
    FROM pois
    WHERE {{AREA_FILTER}}
    {{CATEGORY_FILTER}}
  ) ranked_first
  WHERE cell_rank = 1

  UNION ALL

  SELECT
    id,
    name,
    category_main,
    category_sub,
    longitude,
    latitude,
    distance_m,
    cell_rank,
    1 AS pass_order
  FROM (
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
      ROW_NUMBER() OVER (
        PARTITION BY ST_AsText(
          ST_SnapToGrid(
            geom,
            {{CELL_SIZE_DEG}},
            {{CELL_SIZE_DEG}}
          )
        )
        ORDER BY ST_Distance(
          geom::geography,
          {{POINT_GEOGRAPHY}}
        ) ASC, id
      ) AS cell_rank,
      ROW_NUMBER() OVER (
        PARTITION BY ST_AsText(
          ST_SnapToGrid(
            geom,
            {{CELL_SIZE_DEG}},
            {{CELL_SIZE_DEG}}
          )
        ),
        CASE
          WHEN category_sub IS NOT NULL AND category_sub <> '' THEN category_sub
          WHEN category_main IS NOT NULL AND category_main <> '' THEN category_main
          ELSE '未分类'
        END
        ORDER BY ST_Distance(
          geom::geography,
          {{POINT_GEOGRAPHY}}
        ) ASC, id
      ) AS cell_category_rank
    FROM pois
    WHERE {{AREA_FILTER}}
    {{CATEGORY_FILTER}}
  ) ranked_second
  WHERE cell_rank > 1
    AND cell_category_rank = 1
) sampled
ORDER BY pass_order ASC, cell_rank ASC, distance_m ASC
LIMIT {{LIMIT}};
