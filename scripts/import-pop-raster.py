import argparse
import os
from pathlib import Path

import numpy as np
import psycopg2
from psycopg2.extras import execute_values
from PIL import Image


def load_env_file(path: Path):
    if not path.exists():
        return
    raw_bytes = path.read_bytes()
    text = None
    for encoding in ('utf-8', 'utf-8-sig', 'gbk'):
        try:
            text = raw_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw_bytes.decode('utf-8', errors='ignore')
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_default_env_files():
    root_dir = Path(__file__).resolve().parent.parent
    load_env_file(root_dir / '.env')
    load_env_file(root_dir / 'backend' / '.env')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tif', default='public/三镇pop.tif')
    parser.add_argument('--table', default='population_grid_100m')
    parser.add_argument('--source-name', default='三镇pop.tif')
    parser.add_argument('--host', default=os.getenv('POSTGRES_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.getenv('POSTGRES_PORT', '15432')))
    parser.add_argument('--user', default=os.getenv('POSTGRES_USER', 'postgres'))
    parser.add_argument('--password', default=os.getenv('POSTGRES_PASSWORD', '123456'))
    parser.add_argument('--database', default=os.getenv('POSTGRES_DATABASE', 'geoloom'))
    parser.add_argument('--min-value', type=float, default=0.0)
    parser.add_argument('--batch-size', type=int, default=5000)
    parser.add_argument('--limit-cells', type=int, default=0)
    parser.add_argument('--truncate', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    return parser.parse_args()


def read_raster(path: Path):
    image = Image.open(path)
    array = np.asarray(image, dtype=np.float32)
    tags = getattr(image, 'tag_v2', {})
    tiepoint = tuple(tags.get(33922, (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)))
    scale = tuple(tags.get(33550, (1.0, 1.0, 0.0)))
    srid = 4326
    geo_key = tuple(tags.get(34735, ()))
    if len(geo_key) >= 8 and geo_key[7] == 4326:
        srid = 4326
    return {
        'array': array,
        'origin_lon': float(tiepoint[3]),
        'origin_lat': float(tiepoint[4]),
        'pixel_width': float(scale[0]),
        'pixel_height': float(scale[1]),
        'srid': srid,
    }


def iter_rows(raster, source_name: str, min_value: float, limit_cells: int):
    array = raster['array']
    rows, cols = np.nonzero(array > min_value)
    if limit_cells > 0:
        rows = rows[:limit_cells]
        cols = cols[:limit_cells]
    for row_index, col_index in zip(rows.tolist(), cols.tolist()):
        value = float(array[row_index, col_index])
        min_lon = raster['origin_lon'] + col_index * raster['pixel_width']
        max_lon = min_lon + raster['pixel_width']
        max_lat = raster['origin_lat'] - row_index * raster['pixel_height']
        min_lat = max_lat - raster['pixel_height']
        center_lon = (min_lon + max_lon) / 2
        center_lat = (min_lat + max_lat) / 2
        geom_wkt = (
            f"POLYGON(({min_lon} {min_lat}, {max_lon} {min_lat}, {max_lon} {max_lat}, "
            f"{min_lon} {max_lat}, {min_lon} {min_lat}))"
        )
        yield (
            source_name,
            row_index,
            col_index,
            value,
            center_lon,
            center_lat,
            geom_wkt,
            center_lon,
            center_lat,
        )


def ensure_table(cur, table_name: str, srid: int):
    cur.execute('CREATE EXTENSION IF NOT EXISTS postgis')
    cur.execute(f'''
        CREATE TABLE IF NOT EXISTS {table_name} (
            id BIGSERIAL PRIMARY KEY,
            source_name TEXT NOT NULL,
            row_index INTEGER NOT NULL,
            col_index INTEGER NOT NULL,
            pop_value DOUBLE PRECISION NOT NULL,
            center_lon DOUBLE PRECISION NOT NULL,
            center_lat DOUBLE PRECISION NOT NULL,
            geom geometry(Polygon, {srid}) NOT NULL,
            center_geom geometry(Point, {srid}) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (source_name, row_index, col_index)
        )
    ''')
    cur.execute(f'CREATE INDEX IF NOT EXISTS {table_name}_geom_gix ON {table_name} USING GIST (geom)')
    cur.execute(f'CREATE INDEX IF NOT EXISTS {table_name}_center_geom_gix ON {table_name} USING GIST (center_geom)')
    cur.execute(f'CREATE INDEX IF NOT EXISTS {table_name}_pop_value_idx ON {table_name} (pop_value DESC)')


def truncate_table(cur, table_name: str):
    cur.execute(f'TRUNCATE TABLE {table_name}')


def insert_batches(cur, table_name: str, rows, batch_size: int):
    batch = []
    inserted = 0
    for row in rows:
        batch.append(row)
        if len(batch) >= batch_size:
            execute_values(
                cur,
                f'''
                INSERT INTO {table_name} (
                    source_name,
                    row_index,
                    col_index,
                    pop_value,
                    center_lon,
                    center_lat,
                    geom,
                    center_geom
                ) VALUES %s
                ON CONFLICT (source_name, row_index, col_index) DO UPDATE SET
                    pop_value = EXCLUDED.pop_value,
                    center_lon = EXCLUDED.center_lon,
                    center_lat = EXCLUDED.center_lat,
                    geom = EXCLUDED.geom,
                    center_geom = EXCLUDED.center_geom,
                    updated_at = NOW()
                ''',
                batch,
                template='(%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s,4326),ST_SetSRID(ST_MakePoint(%s,%s),4326))',
                page_size=len(batch),
            )
            inserted += len(batch)
            print(f'inserted={inserted}')
            batch = []
    if batch:
        execute_values(
            cur,
            f'''
            INSERT INTO {table_name} (
                source_name,
                row_index,
                col_index,
                pop_value,
                center_lon,
                center_lat,
                geom,
                center_geom
            ) VALUES %s
            ON CONFLICT (source_name, row_index, col_index) DO UPDATE SET
                pop_value = EXCLUDED.pop_value,
                center_lon = EXCLUDED.center_lon,
                center_lat = EXCLUDED.center_lat,
                geom = EXCLUDED.geom,
                center_geom = EXCLUDED.center_geom,
                updated_at = NOW()
            ''',
            batch,
            template='(%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s,4326),ST_SetSRID(ST_MakePoint(%s,%s),4326))',
            page_size=len(batch),
        )
        inserted += len(batch)
        print(f'inserted={inserted}')
    return inserted


def main():
    load_default_env_files()
    args = parse_args()
    tif_path = Path(args.tif)
    raster = read_raster(tif_path)
    positive_count = int((raster['array'] > args.min_value).sum())
    print(f"tif={tif_path}")
    print(f"shape={raster['array'].shape}")
    print(f"srid={raster['srid']}")
    print(f"origin=({raster['origin_lon']}, {raster['origin_lat']})")
    print(f"pixel_size=({raster['pixel_width']}, {raster['pixel_height']})")
    print(f"positive_count={positive_count}")
    if args.limit_cells > 0:
        print(f"limit_cells={args.limit_cells}")
    if args.dry_run:
        return

    connection = psycopg2.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        dbname=args.database,
    )
    connection.autocommit = False
    try:
        with connection.cursor() as cur:
            ensure_table(cur, args.table, raster['srid'])
            if args.truncate:
                truncate_table(cur, args.table)
            inserted = insert_batches(
                cur,
                args.table,
                iter_rows(raster, args.source_name, args.min_value, args.limit_cells),
                args.batch_size,
            )
            connection.commit()
            print(f'done={inserted}')
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == '__main__':
    main()
