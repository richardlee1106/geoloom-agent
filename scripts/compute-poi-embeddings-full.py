#!/usr/bin/env python3
"""
GeoLoom POI 全量 Embedding 预计算脚本 (LM Studio + GGUF 版)

前置条件:
  1. pip install requests psycopg2-binary tqdm
  2. 启动 LM Studio，开启本地服务器（默认端口 1234）
  3. 脚本会自动加载 GGUF 模型（也可手动在 LM Studio 中加载）

用法:
  python scripts/compute-poi-embeddings-full.py

环境变量:
  LMSTUDIO_URL   - LM Studio 服务器地址 (默认 http://localhost:1234)
  MODEL_PATH     - GGUF 模型路径 (默认 D:\\models\\gpustack\\bge-m3-GGUF\\bge-m3-Q8_0.gguf)
  DB_HOST        - 数据库主机 (默认 127.0.0.1)
  DB_PORT        - 数据库端口 (默认 15432)
  DB_NAME        - 数据库名   (默认 geoloom)
  DB_USER        - 数据库用户 (默认 postgres)
  DB_PASSWORD    - 数据库密码 (默认 123456)
  EMBED_DIM      - 目标维度   (默认 512，兼容当前 vector(512) 列)
  BATCH_SIZE     - 每次 API 调用的文本数 (默认 64)
  WRITE_BATCH    - 每次写入数据库的行数 (默认 512)
  MAX_ROWS       - 本次最多处理行数 (默认 0=全量)
  AUTO_LOAD      - 是否自动加载模型 (默认 true)
  SKIP_CLEAR     - 是否跳过清除旧 embedding (默认 true，续跑模式)

注意:
  - bge-m3 原生输出 1024 维，脚本自动截断到 512 维（Matryoshka 兼容）
  - 截断后重新 L2 归一化，确保与在线 Jina embedding 可比
  - 支持断点续跑：中断后重跑只处理 embedding IS NULL 的行
"""

import os
import sys
import time
import json
import math
import logging
import requests
import psycopg2
import psycopg2.extras
import threading
from queue import Queue, Empty
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('embed-full')

# ── 配置 ──

LMSTUDIO_URL = os.getenv('LMSTUDIO_URL', 'http://localhost:1234')
MODEL_PATH = os.getenv('MODEL_PATH', r'D:\models\gpustack\bge-m3-GGUF\bge-m3-Q8_0.gguf')
DB_HOST = os.getenv('DB_HOST', '127.0.0.1')
DB_PORT = int(os.getenv('DB_PORT', '15432'))
DB_NAME = os.getenv('DB_NAME', 'geoloom')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', '123456')
EMBED_DIM = int(os.getenv('EMBED_DIM', '512'))
BATCH_SIZE = int(os.getenv('BATCH_SIZE', '1024'))
WRITE_BATCH = int(os.getenv('WRITE_BATCH', '4096'))
MAX_ROWS = int(os.getenv('MAX_ROWS', '0'))
AUTO_LOAD = os.getenv('AUTO_LOAD', 'true').lower() == 'true'
SKIP_CLEAR = os.getenv('SKIP_CLEAR', 'true').lower() == 'true'

# ── 品类同义词表（与 poiEmbeddingCache.ts 保持一致） ──

SYNONYM_MAP = {
    '住宿服务': ['酒店', '宾馆', '旅馆', '住宿', '旅店', '民宿'],
    '餐饮美食': ['餐厅', '餐馆', '美食', '吃饭', '小吃', '餐饮'],
    '购物服务': ['商场', '超市', '购物', '便利店', '商超'],
    '交通设施服务': ['地铁', '公交', '车站', '交通'],
    '体育休闲服务': ['健身', '运动', '体育馆', '休闲'],
    '医疗保健服务': ['医院', '诊所', '药店', '医疗'],
    '科教文化服务': ['学校', '培训', '教育', '图书馆'],
    '风景名胜': ['景点', '景区', '公园', '旅游'],
    '商务住宅': ['写字楼', '公寓', '商务', '住宅'],
    '生活服务': ['洗衣', '维修', '家政', '生活'],
}


def build_poi_text(name: str, category_main: str = '', category_sub: str = '') -> str:
    """构造 embedding 输入文本，与后端 poiEmbeddingCache.ts 逻辑一致"""
    parts = [name or '']
    if category_main:
        parts.append(category_main)
    if category_sub and category_sub != category_main:
        parts.append(category_sub)
    synonyms = SYNONYM_MAP.get(category_main, [])
    parts.extend(synonyms)
    return ' '.join(p for p in parts if p)


def normalize_vec(vec: list[float]) -> list[float]:
    """L2 归一化"""
    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 0:
        return [x / norm for x in vec]
    return vec


def truncate_and_normalize(vec: list[float], dim: int) -> list[float]:
    """截断到目标维度并重新归一化（bge-m3 Matryoshka 兼容）"""
    return normalize_vec(vec[:dim])


# ── LM Studio API ──

class LMStudioClient:
    """LM Studio API 客户端，封装原生 API + OpenAI-compatible API"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.model_id = None

    def check_server(self) -> bool:
        """检查 LM Studio 服务器是否可用"""
        try:
            r = self.session.get(f'{self.base_url}/api/v1/models', timeout=5)
            return r.ok
        except Exception:
            return False

    def list_native_models(self) -> list[dict]:
        """获取原生 API 的模型列表"""
        try:
            r = self.session.get(f'{self.base_url}/api/v1/models', timeout=5)
            if r.ok:
                return r.json() if isinstance(r.json(), list) else r.json().get('data', [])
        except Exception:
            pass
        return []

    def load_model(self, model_path: str) -> bool:
        """通过原生 API 加载模型"""
        log.info(f'通过 API 加载模型: {model_path}')
        try:
            r = self.session.post(
                f'{self.base_url}/api/v1/models/load',
                json={'path': model_path},
                timeout=120,
            )
            if r.ok:
                log.info('加载请求已发送，等待模型就绪...')
                for i in range(90):
                    time.sleep(2)
                    models = self.list_native_models()
                    if models:
                        log.info(f'模型已就绪: {models}')
                        return True
                    if i % 10 == 0:
                        log.info(f'等待中... ({i * 2}s)')
                log.error('模型加载超时（180s）')
                return False
            else:
                log.error(f'加载失败: HTTP {r.status_code} - {r.text[:300]}')
                return False
        except Exception as e:
            log.error(f'加载请求异常: {e}')
            return False

    def get_embedding_model_id(self) -> str | None:
        """获取 OpenAI-compatible API 中的模型标识符"""
        try:
            r = self.session.get(f'{self.base_url}/v1/models', timeout=5)
            if r.ok:
                data = r.json()
                models = data.get('data', [])
                if models:
                    model_id = models[0].get('id', '')
                    log.info(f'检测到 embedding 模型: {model_id}')
                    return model_id
        except Exception:
            pass
        return None

    def embed(self, texts: list[str], retries: int = 3) -> list[list[float]]:
        """调用 OpenAI-compatible embedding API"""
        for attempt in range(retries):
            try:
                r = self.session.post(
                    f'{self.base_url}/v1/embeddings',
                    json={
                        'model': self.model_id,
                        'input': texts,
                    },
                    timeout=120,
                )
                if r.ok:
                    data = r.json()
                    results = sorted(data['data'], key=lambda x: x['index'])
                    return [r_['embedding'] for r_ in results]
                else:
                    log.warning(f'Embedding API HTTP {r.status_code}: {r.text[:200]}')
                    # 如果是 429 (rate limit) 或 5xx，重试
                    if r.status_code in (429, 500, 502, 503):
                        wait = 2 ** (attempt + 1)
                        log.info(f'等待 {wait}s 后重试...')
                        time.sleep(wait)
                        continue
                    # 其他错误不重试
                    raise Exception(f'Embedding API 错误: HTTP {r.status_code}')
            except requests.exceptions.Timeout:
                log.warning(f'API 超时，重试 {attempt + 1}/{retries}')
                time.sleep(2)
            except requests.exceptions.ConnectionError:
                log.warning(f'连接断开，重试 {attempt + 1}/{retries}')
                time.sleep(5)
            except Exception as e:
                if 'Embedding API 错误' in str(e):
                    raise
                log.warning(f'API 异常: {e}，重试 {attempt + 1}/{retries}')
                time.sleep(2)
        raise Exception(f'Embedding API 重试 {retries} 次后仍失败')

    def test_embed(self) -> int:
        """测试 embedding API，返回实际输出维度"""
        result = self.embed(['测试文本'])
        return len(result[0])


# ── 数据库操作 ──

def clear_embeddings(cur):
    """清除所有已有 embedding"""
    log.info('清除所有已有 embedding...')
    cur.execute('UPDATE pois SET embedding = NULL WHERE embedding IS NOT NULL')
    affected = cur.rowcount
    log.info(f'已清除 {affected:,} 条旧 embedding')


def get_stats(cur) -> tuple[int, int]:
    """获取统计信息: (total, done)"""
    cur.execute('SELECT COUNT(*) FROM pois')
    total = cur.fetchone()[0]
    cur.execute('SELECT COUNT(*) FROM pois WHERE embedding IS NOT NULL')
    done = cur.fetchone()[0]
    return total, done


def flush_batch(write_cur, batch_ids: list[str], batch_vecs: list[list[float]], dim: int):
    """批量写入数据库（临时表 + execute_values，可靠写入）"""
    # 清空临时表（由 writer 线程会话预创建）
    write_cur.execute("TRUNCATE _emb_tmp")

    # 批量插入临时表
    rows = [(poi_id, json.dumps(vec)) for poi_id, vec in zip(batch_ids, batch_vecs)]
    psycopg2.extras.execute_values(write_cur, "INSERT INTO _emb_tmp (id, vec) VALUES %s", rows)

    # 从临时表 UPDATE 主表
    write_cur.execute(
        f"""UPDATE pois p
            SET embedding = t.vec::vector({dim})
            FROM _emb_tmp t
            WHERE p.id::text = t.id"""
    )
    updated = write_cur.rowcount
    if updated != len(batch_ids):
        log.warning(f'flush_batch: 期望更新 {len(batch_ids)} 行，实际 {updated} 行')

    write_cur.execute("TRUNCATE _emb_tmp")


# ── 主流程 ──

def main():
    log.info('=' * 60)
    log.info('GeoLoom POI 全量 Embedding 预计算 (LM Studio + bge-m3)')
    log.info('=' * 60)

    # ── 1. 连接数据库 ──
    log.info('连接数据库...')
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
    )
    conn.autocommit = True
    cur = conn.cursor()

    # ── 2. 清除旧 embedding ──
    if not SKIP_CLEAR:
        clear_embeddings(cur)

    total, done = get_stats(cur)
    remaining = total - done
    log.info(f'POI 总量: {total:,}  已有 embedding: {done:,}  待计算: {remaining:,}')
    target_rows = min(remaining, MAX_ROWS) if MAX_ROWS > 0 else remaining
    if MAX_ROWS > 0:
        log.info(f'本次最多处理: {target_rows:,} 条')

    if remaining == 0:
        log.info('所有 POI 已有 embedding，无需计算')
        conn.close()
        return

    # ── 3. 检查 LM Studio ──
    client = LMStudioClient(LMSTUDIO_URL)

    if not client.check_server():
        log.error(f'LM Studio 服务器未响应: {LMSTUDIO_URL}')
        log.error('请先启动 LM Studio 并开启本地服务器（默认端口 1234）')
        conn.close()
        sys.exit(1)
    log.info(f'LM Studio 服务器已连接: {LMSTUDIO_URL}')

    # ── 4. 加载模型 ──
    model_id = client.get_embedding_model_id()
    if not model_id:
        if AUTO_LOAD:
            if not client.load_model(MODEL_PATH):
                log.error('自动加载模型失败，请手动在 LM Studio 中加载 bge-m3-Q8_0.gguf')
                conn.close()
                sys.exit(1)
            model_id = client.get_embedding_model_id()
        if not model_id:
            log.error('未检测到已加载的模型')
            log.error('请在 LM Studio 中加载 bge-m3-Q8_0.gguf 并重启服务器')
            conn.close()
            sys.exit(1)

    client.model_id = model_id

    # ── 5. 测试 embedding API ──
    log.info('测试 embedding API...')
    try:
        actual_dim = client.test_embed()
        log.info(f'API 测试成功，模型原始输出维度: {actual_dim}')
        if actual_dim == EMBED_DIM:
            log.info(f'维度匹配 ({EMBED_DIM})，无需截断')
        elif actual_dim > EMBED_DIM:
            log.info(f'将截断 {actual_dim} → {EMBED_DIM} 维（bge-m3 Matryoshka 兼容）')
        else:
            log.error(f'模型输出维度 {actual_dim} < 目标维度 {EMBED_DIM}，请调整 EMBED_DIM')
            conn.close()
            sys.exit(1)
    except Exception as e:
        log.error(f'Embedding API 测试失败: {e}')
        log.error('请确认 LM Studio 已加载 bge-m3 模型且支持 /v1/embeddings')
        conn.close()
        sys.exit(1)

    # ── 6. 流水线并行处理 ──
    # 生产者：GPU 计算 embedding
    # 消费者：写入数据库
    # 两者并行，GPU 不等 DB 写完就开始下一批

    processed = 0
    failed = 0
    start_time = time.time()
    need_truncate = actual_dim != EMBED_DIM

    # 写入队列：生产者放入 (ids, vecs)，消费者取出写入 DB
    # 队列容量 4：GPU 最多领先 DB 4 批
    write_queue: Queue = Queue(maxsize=4)
    write_errors: list[str] = []
    writer_done = threading.Event()

    def db_writer():
        """消费者线程：从队列取数据写入数据库"""
        wconn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
            user=DB_USER, password=DB_PASSWORD,
        )
        wcur = wconn.cursor()
        # 预创建临时表（会话级别，不依赖 ON COMMIT DROP）
        wcur.execute("CREATE TEMP TABLE IF NOT EXISTS _emb_tmp (id text PRIMARY KEY, vec text)")
        while True:
            try:
                item = write_queue.get(timeout=5)
            except Empty:
                # 检查是否该退出
                if writer_done.is_set():
                    break
                continue
            if item is None:
                # 毒丸信号，退出
                break
            ids, vecs, dim = item
            try:
                flush_batch(wcur, ids, vecs, dim)
                wconn.commit()
            except Exception as e:
                err_msg = f'写入失败: {e}'
                log.error(err_msg)
                write_errors.append(err_msg)
                wconn.rollback()
            write_queue.task_done()
        wconn.close()

    writer_thread = threading.Thread(target=db_writer, daemon=True)
    writer_thread.start()

    # 写入缓冲区
    buf_ids: list[str] = []
    buf_vecs: list[list[float]] = []

    # ID 游标：避免 WHERE embedding IS NULL 的竞态条件
    # writer 线程还没写入时，主线程会重复选到同一批
    # 改用游标推进，确保每行只处理一次
    last_id = 0

    with tqdm(total=target_rows, desc='Embedding POIs', unit='poi',
              mininterval=2) as pbar:
        while processed < target_rows:
            # 用 ID 游标取下一批（不依赖 embedding IS NULL）
            cur.execute(f"""
                SELECT id, name, category_main, category_sub
                FROM pois
                WHERE id > %s AND embedding IS NULL
                ORDER BY id
                LIMIT {min(BATCH_SIZE, target_rows - processed)}
            """, (last_id,))
            rows = cur.fetchall()
            if not rows:
                log.info('没有更多待处理的 POI')
                break

            batch_texts = [build_poi_text(r[1], r[2], r[3]) for r in rows]
            batch_ids = [str(r[0]) for r in rows]

            # 调用 embedding API（GPU 工作）
            try:
                raw_embeddings = client.embed(batch_texts)
            except Exception as e:
                log.error(f'Embedding 失败: {e}')
                failed += 1
                if failed > 30:
                    log.error('失败次数过多，终止')
                    break
                time.sleep(5)
                continue

            # 截断 + 归一化
            embeddings = []
            for emb in raw_embeddings:
                if need_truncate:
                    emb = truncate_and_normalize(emb, EMBED_DIM)
                else:
                    emb = normalize_vec(emb)
                embeddings.append(emb)

            # 加入写入缓冲区
            buf_ids.extend(batch_ids)
            buf_vecs.extend(embeddings)

            # 缓冲区满时提交给写入线程（不阻塞 GPU）
            if len(buf_ids) >= WRITE_BATCH:
                ids_to_write = buf_ids[:]
                vecs_to_write = buf_vecs[:]
                buf_ids.clear()
                buf_vecs.clear()
                # 放入队列，如果队列满则阻塞等待消费者消费
                write_queue.put((ids_to_write, vecs_to_write, EMBED_DIM))

            processed += len(rows)
            last_id = rows[-1][0]  # 推进游标到本批最大 ID
            pbar.update(len(rows))

            # 定期进度日志
            if processed % 10000 == 0:
                elapsed = time.time() - start_time
                rate = processed / elapsed if elapsed > 0 else 0
                eta = (remaining - processed) / rate if rate > 0 else 0
                log.info(
                    f'进度: {processed:,}/{remaining:,}  '
                    f'速率: {rate:.0f} poi/s  '
                    f'剩余: {eta / 60:.1f} min'
                )

    # 刷出剩余缓冲区
    if buf_ids:
        write_queue.put((buf_ids[:], buf_vecs[:], EMBED_DIM))
        buf_ids.clear()
        buf_vecs.clear()

    # 通知写入线程结束
    write_queue.put(None)
    writer_done.set()
    writer_thread.join(timeout=30)

    if write_errors:
        log.warning(f'写入线程有 {len(write_errors)} 次错误')

    # ── 7. 最终统计 ──
    total, done = get_stats(cur)
    elapsed = time.time() - start_time

    log.info('=' * 60)
    log.info('计算完成')
    log.info(f'  本次处理: {processed:,} 条')
    log.info(f'  失败批次: {failed}')
    if elapsed > 0:
        log.info(f'  总耗时: {elapsed / 60:.1f} min')
        log.info(f'  速率: {processed / elapsed:.0f} poi/s')
    log.info(f'  覆盖率: {done:,}/{total:,} = {done / total * 100:.1f}%')
    log.info('=' * 60)

    # ── 8. 创建 HNSW 索引 ──
    if done > total * 0.5:
        log.info('覆盖率 >50%，创建 HNSW 索引...')
        try:
            # 检查是否已存在
            cur.execute("""
                SELECT COUNT(*) FROM pg_indexes
                WHERE tablename='pois' AND indexname='idx_pois_embedding'
            """)
            if cur.fetchone()[0] > 0:
                log.info('HNSW 索引已存在，跳过')
            else:
                cur.execute("SET maintenance_work_mem = '1GB'")
                cur.execute("""
                    CREATE INDEX CONCURRENTLY idx_pois_embedding
                    ON pois USING hnsw (embedding vector_cosine_ops)
                    WITH (m = 16, ef_construction = 64)
                """)
                log.info('HNSW 索引创建完成')
        except Exception as e:
            log.warning(f'HNSW 索引创建失败（可稍后手动创建）: {e}')
            log.warning('手动创建命令:')
            log.warning(f'  SET maintenance_work_mem = \'1GB\';')
            log.warning(f'  CREATE INDEX idx_pois_embedding ON pois USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);')
    else:
        log.info(f'覆盖率 {done / total * 100:.1f}% < 50%，跳过索引创建')

    # ── 9. 抽样验证 ──
    log.info('抽样验证...')
    cur.execute("""
        SELECT id, name, embedding::text
        FROM pois
        WHERE embedding IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 5
    """)
    for row in cur.fetchall():
        try:
            vec = json.loads(row[2])
            dim = len(vec)
            norm = math.sqrt(sum(x * x for x in vec))
            log.info(f'  POI #{row[0]} ({row[1]}): dim={dim}, L2_norm={norm:.4f}')
        except Exception as e:
            log.warning(f'  POI #{row[0]}: 解析失败 {e}')

    conn.close()
    log.info('完成！数据库连接已关闭')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log.info('\n用户中断，已处理的数据已保存，可重新运行继续')
        sys.exit(0)
