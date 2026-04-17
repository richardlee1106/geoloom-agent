import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '123456',
  database: process.env.POSTGRES_DATABASE || 'geoloom',
});

const client = await pool.connect();

// 查关键 AOI 的几何类型
const result = await client.query(`
  SELECT
    name,
    fclass,
    ST_GeometryType(geom) AS geom_type,
    ST_IsValid(geom) AS is_valid,
    CAST(ST_Area(geom::geography) AS int) AS area_m2,
    LENGTH(ST_AsGeoJSON(geom)) AS geojson_len
  FROM aois
  WHERE name LIKE '%武汉大学%'
     OR name LIKE '%沙湖%'
     OR name LIKE '%中医药大学%'
     OR name LIKE '%东湖%'
     OR name LIKE '%楚河%'
  ORDER BY area_m2 DESC
  LIMIT 30
`);

console.log('=== AOI 几何类型检查 ===');
for (const row of result.rows) {
  console.log(`${row.name} | fclass=${row.fclass} | geom_type=${row.geom_type} | valid=${row.is_valid} | area=${row.area_m2}m² | geojson_len=${row.geojson_len}`);
}

// 统计 aois 表中各几何类型数量
const stats = await client.query(`
  SELECT ST_GeometryType(geom) AS geom_type, COUNT(*) AS cnt
  FROM aois
  GROUP BY ST_GeometryType(geom)
  ORDER BY cnt DESC
`);
console.log('\n=== AOIs 几何类型统计 ===');
for (const row of stats.rows) {
  console.log(`${row.geom_type}: ${row.cnt}`);
}

client.release();
process.exit(0);
