#!/usr/bin/env python3
"""
LTP POS + 通用规则 POI 提取 HTTP 服务
用 LTP 做分词+词性标注，通过通用 POS 规则提取 POI 候选名

启动：python ner_server.py [--port 5100]
调用：curl -X POST http://localhost:5100/extract -d '{"contents":[...],"query":"..."}'
"""

import sys
import json
import re
import argparse
import time
import warnings
from collections import Counter
from http.server import HTTPServer, BaseHTTPRequestHandler

warnings.filterwarnings("ignore")

try:
    from ltp import LTP
except ImportError:
    print("LTP 未安装，请运行: pip install ltp", file=sys.stderr)
    sys.exit(1)

# ── 全局模型 ──
ltp_model = None

def load_model():
    """加载 LTP 模型"""
    global ltp_model
    if ltp_model is not None:
        return ltp_model

    print("[NER] 加载 LTP/base 模型...", file=sys.stderr)
    start = time.time()
    ltp_model = LTP("LTP/base")

    elapsed = time.time() - start
    print(f"[NER] LTP 模型加载完成 ({elapsed:.1f}s)", file=sys.stderr)
    return ltp_model


# ── 泛化词过滤 ──
GENERIC_WORDS = {
    # 纯品类词
    "餐厅", "饭店", "火锅", "烧烤", "咖啡", "茶馆", "奶茶",
    "商场", "购物中心", "百货", "公园", "博物馆", "酒店", "宾馆",
    "景区", "步行街", "餐饮", "购物", "娱乐", "休闲",
    "咖啡店", "咖啡厅", "咖啡馆", "咖啡屋",
    "茶餐厅", "火锅店", "烧烤店", "面馆", "小吃店", "快餐店",
    # 带修饰词的品类描述（非品牌名）
    "毛肚火锅", "牛肉火锅", "鲜牛肉火锅", "高分餐厅",
    "必吃榜餐厅", "西式餐饮", "老牌咖啡店", "热门餐厅",
    "人气商场", "传统百货", "社区咖啡店", "创业咖啡",
    "创业咖啡馆", "光谷咖啡", "社区咖啡", "独立咖啡店",
    "宝藏社区咖啡店", "前街咖啡门店", "新店咖啡",
    "精致咖啡店", "精品咖啡店", "特色餐厅", "主题餐厅",
    "休闲餐厅", "料理餐厅", "调味餐厅", "名菜餐厅",
    "武汉火锅", "武昌上榜美食店", "黑珍珠餐厅",
    "热门咖啡店", "新开咖啡店", "新潮咖啡厅",
    "高分咖啡店", "网红咖啡店", "本地咖啡店",
    "特色咖啡厅", "独立小店", "精致小店",
    # SEO 碎片
    "区引进各类首店", "中百仓储卖场",
    "各类首店", "首店", "卖场",
    "繁华步行街", "超市百货", "河汉街夹娃娃店",
    "餐饮业协会", "秘制武昌鱼",
    "把门店", "等把门店", "咖啡等把门店",
}

# ── 修饰词前缀（剥离后检查是否为泛化词） ──
MODIFIER_PREFIXES = re.compile(
    r'^(热门|高分|新开|新潮|网红|精品|精致|特色|独立|本地|老牌|传统|'
    r'人气|必吃|宝藏|推荐|经典|正宗|地道|正宗|原味|原创|'
    r'高端|高档|平价|亲民|实惠|性价比|小众|隐秘|私藏|'
    r'复古|文艺|清新|简约|工业|极简|日式|韩式|泰式|欧式|'
    r'连锁|品牌|旗舰|概念|主题|旗舰|体验|创意|'
    r'这家|那家|一家|这家店|那家店|'
    r'很多|各种|各类|这些|那些|'
    r'出很多|得一试|值得一试|值得推荐|'
    r'索|超|最|很|太|真|好|挺|特别|非常|相当|'
    r'空间包含了|包含了|包括了|'
    r'试的|要试|必试|去试|来试)'
)

# ── SEO 碎片模式（含动词/代词/量词 → 不是品牌名） ──
SEO_FRAGMENT_PATTERNS = re.compile(
    r'(^或|了|着|过|的|得|地|吧|呢|吗|啊|呀|哦|哈|嗯|'
    r'有|是|在|到|去|来|会|能|让|被|把|给|'
    r'这|那|一|些|个|种|样|件|条|家|间|'
    r'很|太|最|更|还|也|都|又|就|才|已|将|'
    r'等|及|与|和|或|但|而|'
    r'把|对|从|向|往|按|照|比|'
    r'出|得|试|吃|喝|买|卖|开|关|找|看|说|走|'
    r'推荐|攻略|打卡|必去|必吃|必逛|收藏|分享|'
    r'深圳|广州|北京|上海|南京|成都|杭州|重庆|长沙)'
)

# NER 关注的实体类型（保留兼容）
LOCATION_LABELS = {"GPE", "LOC", "FAC", "ORG"}
ORG_BLACKLIST = {"有限公司", "股份", "集团", "公司", "银行", "保险", "证券"}

# ── LTP POS 通用规则常量 ──
# 专有名词标签（品牌名、地名等）
PROPER_POS = {'ns', 'nz', 'ni'}  # ns=地名, nz=其他专有名词, ni=机构名
# 名词标签
NOUN_POS = {'n', 'ni', 'ns', 'nz', 'nd', 'nh'}
# 品类名词后缀（用于判断 n 是否为场所品类词）
# 通用判断：名词可独立指代一类场所 → 品类名词
# 不硬编码品类列表，而是通过语义特征判断
VENUE_NOUN_SEMANTIC_SUFFIXES = (
    '店', '厅', '馆', '楼', '城', '场', '院', '所', '站', '台',
    '街', '路', '区', '园', '阁', '坊', '居', '舍',
    '屋', '吧', '铺', '庄', '寨', '寺', '庙', '观', '塔',
)
# 品类名词集合（非品牌核心，是场所类型描述）
# 这些词单独出现时是品类描述，不是品牌名
VENUE_TYPE_NOUNS = {
    '餐厅', '饭店', '酒店', '宾馆', '旅馆', '旅店', '民宿',
    '咖啡', '咖啡店', '咖啡厅', '咖啡馆', '咖啡屋',
    '火锅', '火锅店', '烧烤', '烧烤店', '茶馆', '奶茶', '奶茶店',
    '商场', '购物中心', '百货', '超市', '便利店', '市场',
    '公园', '博物馆', '景区', '风景区', '步行街', '商业街',
    '体育馆', '体育场', '健身房', '游泳馆', '图书馆',
    '大学', '学院', '学校', '中学', '小学', '幼儿园',
    '医院', '诊所', '药店', '银行', '邮局',
    '电影院', '剧院', 'KTV', '酒吧', '网吧',
    '地铁站', '火车站', '汽车站', '机场', '码头',
    '广场', '大厦', '中心', '大楼', '公寓', '小区',
    '酒楼', '食府', '菜馆', '面馆', '小吃店', '快餐店',
    '茶餐厅', '西餐厅', '日料', '韩料', '自助餐',
    '客栈', '招待所', '青旅', '度假村',
    '寺庙', '教堂', '清真寺', '祠堂',
    '游乐场', '水上乐园', '滑雪场', '高尔夫',
    '美容院', '理发店', '洗浴', 'SPA',
}


def _is_seo_fragment(name):
    """检测名称是否为 SEO 碎片（含动词/代词/量词等，不是品牌名）"""
    # 短名称（<=3字）不做碎片检测，避免误杀
    if len(name) <= 3:
        return False
    # 已知品牌名保护：含常见品牌关键词的不算碎片
    BRAND_KEYWORDS = ('星巴克', '瑞幸', 'Manner', 'Costa', '奈雪', '喜茶', '肯德基',
                      '麦当劳', '海底捞', '必胜客', '沃尔玛', '万达', '万象城',
                      '永辉', '盒马', 'luckin', 'Starbucks', 'NOWWA', '挪瓦',
                      '蜜雪冰城', '茶百道', '古茗', '书亦', '沪上阿姨')
    for bk in BRAND_KEYWORDS:
        if bk in name:
            return False
    # 检测 SEO 碎片模式
    # 1. 含"的" → 仅在"的"后紧跟品类后缀时判定为碎片（如"好吃的餐厅"）
    # 如果"的"在末尾或后面不是品类词，保留（如"胖哥的"可能是品牌名）
    if '的' in name:
        de_idx = name.index('的')
        rest_after_de = name[de_idx+1:]
        if rest_after_de and any(rest_after_de.startswith(s) for s in ['咖啡', '餐厅', '店', '厅', '馆', '商场', '购物', '酒店', '宾馆', '火锅', '烧烤']):
            return True
        if de_idx == 0:
            return True
    # 2. 含动词 → 不是品牌名（如"出很多新潮的咖啡厅"中的"出"）
    VERB_CHARS = {'有', '是', '在', '到', '去', '来', '会', '能', '让', '被',
                  '把', '给', '出', '得', '吃', '喝', '买', '卖', '开', '找', '看', '走'}
    for vc in VERB_CHARS:
        if vc in name and name.index(vc) > 0:  # 不在开头（如"开出"→品牌名可能含"开"）
            # 但检查是否在品牌核心中（如"开味"不是动词）
            # 简单规则：动词字后面紧跟品类后缀 → SEO碎片
            idx = name.index(vc)
            rest = name[idx+1:]
            if rest and any(rest.startswith(s) for s in ['咖啡', '餐厅', '店', '厅', '馆', '商场', '购物']):
                return True
    # 3. 含量词/代词 → 不是品牌名（如"一家咖啡店"中的"一家"）
    QUANTIFIER_WORDS = ('一家', '这家', '那家', '很多', '各种', '各类', '这些', '那些',
                        '几个', '一些', '每个', '某个', '某个')
    for qw in QUANTIFIER_WORDS:
        if qw in name:
            return True
    # 4. 以"家"开头且含品类后缀 → SEO碎片（如"家高颜值咖啡店"）
    if name.startswith('家') and any(name.endswith(suf) for suf in ['店', '厅', '馆', '楼']):
        return True
    # 5. 以副词/连词/介词开头 → SEO碎片（如"正如咖啡店"、"不过咖啡厅"）
    ADVERB_STARTS = ('正如', '不过', '而且', '同时', '另外', '此外', '因此', '所以',
                     '虽然', '尽管', '无论', '不管', '既然', '如果', '假如',
                     '还是', '或者', '以及', '并且', '而且', '不仅', '不但',
                     '适合', '包括', '包含', '其中', '尤其', '特别', '非常',
                     '尼克', '简直', '真的', '确实', '绝对', '完全', '十分')
    for ads in ADVERB_STARTS:
        if name.startswith(ads):
            return True
    # 5.5 含"是"字且"是"后面紧跟品类词 → SEO碎片（如"尼克是新店"中的"是"）
    if '是' in name[1:]:  # 不在第一个字
        idx = name.index('是', 1)
        rest = name[idx+1:]
        if rest and any(rest.startswith(s) for s in ['咖啡', '餐厅', '店', '厅', '馆', '商场', '购物', '新店', '热门']):
            return True
    # 6. 含"等"结尾 → 列举式描述（如"瑞咖啡等把门店"）
    if name.endswith('等') or '等把' in name or '等门' in name:
        return True
    # 7. 新闻动词 → 不是POI名（如"经宣布闭店"、"决定还是闭店"）
    NEWS_VERBS = ('闭店', '宣布', '探访', '决定', '实施', '改为', '即将', '已经', '曾经')
    for nv in NEWS_VERBS:
        if nv in name:
            return True
    # 8. "获"字开头 → SEO标题（如"获中华餐饮名店"）
    if name.startswith('获'):
        return True
    # 9. 比较短语/评价片段（如"比一般的牛杂店"、"分以上口碑店"、"10大必吃"）
    if re.search(r'比一般|分以上|口碑店|性价比|人均|评分|好评率|上榜|必吃榜|必去榜|必买|必玩|排行榜|排名|TOP\d|第[一二三四五六七八九十]名', name):
        return True
    return False


def _is_category_description(name):
    """检测名称是否为纯品类描述（无品牌核心，如"手冲咖啡"、"休闲餐厅"）"""
    # 品类后缀
    CATEGORY_SUFFIXES = ('咖啡店', '咖啡厅', '咖啡馆', '咖啡屋', '餐厅', '饭店', '火锅店', '烧烤店',
                        '商场', '购物中心', '百货', '酒店', '宾馆', '茶馆', '奶茶店', '面馆',
                        '小吃店', '快餐店', '步行街', '公园', '博物馆', '景区',
                        '咖啡', '火锅', '烧烤', '茶馆', '奶茶')
    # 品类核心词（不是品牌名）
    CATEGORY_CORE_WORDS = {'手冲', '拿铁', '美式', '卡布', '摩卡', '浓缩', '冷萃', '冰滴',
                           '清咖', '黑咖', '白咖', '速溶', '现磨', '鲜榨', '特调',
                           '自助', '快餐', '正餐', '简餐', '大排档', '夜宵', '早茶',
                           '休闲', '料理', '调味', '名菜', '特色', '主题', '创意', '精品'}
    # 修饰词前缀
    MODIFIER_WORDS = {'热门', '高分', '新开', '新潮', '网红', '独立', '本地', '老牌', '传统',
                      '人气', '必吃', '宝藏', '推荐', '经典', '正宗', '精致', '高端', '高档',
                      '平价', '亲民', '实惠', '小众', '复古', '文艺', '清新', '连锁', '品牌',
                      '旗舰', '体验', '美', '好', '新', '大', '小', '老', '真',
                      '高颜值', '新加坡', '新加坡', '正如', '不过', '而且'}

    # 去掉品类后缀后检查核心
    core = name
    for suf in sorted(CATEGORY_SUFFIXES, key=len, reverse=True):
        if core.endswith(suf):
            core = core[:-len(suf)]
            break
    # 核心为空或太短 → 纯品类描述
    if len(core) < 2:
        return True
    # 核心是品类词 → 纯品类描述
    if core in CATEGORY_CORE_WORDS:
        return True
    # 核心是修饰词 → 纯品类描述
    if core in MODIFIER_WORDS:
        return True
    # 空格分隔的品类组合（如"火锅 餐厅"、"探鱼 烧烤"）
    # 如果空格前后都是品类词 → 纯品类描述
    if ' ' in name:
        parts = name.split(' ')
        if all(p in CATEGORY_CORE_WORDS or p in CATEGORY_SUFFIXES or p in MODIFIER_WORDS for p in parts if len(p) >= 2):
            return True
    return False



def _preprocess_text(text):
    """预处理网页文本：去除导航、SEO、重复行等噪声"""
    lines = text.split('\n')
    cleaned = []
    seen_lines = set()
    for line in lines:
        line = line.strip()
        if not line or len(line) < 4:
            continue
        # 跳过导航/菜单行
        if line.startswith(('首页', '导航', '菜单', '搜索', '登录', '注册', '下载', '分享到', '关注', '版权', '备案',
                           '关于', '联系', '客服', '帮助', '反馈', '举报', '投诉', '意见', '建议')):
            continue
        # 跳过 SEO/广告行（仅匹配行首的 SEO 前缀，避免误杀含"周边"、"推荐"等正常词汇的内容行）
        if re.match(r'^(下载App|关注我们|扫码|二维码|点击查看|查看更多|展开全部|收起|阅读全文|查看原文|来源：|编辑：|责任编辑|攻略|查询|搜索|位置|周边|推荐)', line):
            continue
        # 跳过包含明确 SEO 广告片段的行（这些词不可能出现在正常内容中）
        if re.search(r'(下载App|关注我们|扫码|二维码|点击查看|查看更多|展开全部|收起|阅读全文|查看原文|来源：|编辑：|责任编辑)', line):
            continue
        # 去除 SEO 查询词前缀，如"查询光谷新店咖啡厅" → "光谷新店咖啡厅"
        line = re.sub(r'^(查询|搜索|查找|附近|周边|推荐|攻略|位置|地址)[^\u4e00-\u9fff]*', '', line)
        if not line:
            continue
        # 跳过纯数字/符号/URL行
        if re.match(r'^[\d\s\-/|.,:;]+$', line) or re.match(r'^https?://', line):
            continue
        # 跳过超短行（可能是标签/按钮）
        if len(line) < 6 and not re.search(r'[\u4e00-\u9fff]{2,}', line):
            continue
        # 去重行
        if line in seen_lines:
            continue
        seen_lines.add(line)
        cleaned.append(line)
    return '\n'.join(cleaned)


def _is_venue_type_noun(word, pos):
    """判断一个词是否为场所品类名词（可独立指代一类场所）"""
    if pos not in NOUN_POS:
        return False
    # 1. 在已知品类名词集合中
    if word in VENUE_TYPE_NOUNS:
        return True
    # 2. 以场所语义后缀结尾（如"店"、"厅"、"馆"等）
    if any(word.endswith(suf) for suf in VENUE_NOUN_SEMANTIC_SUFFIXES):
        return True
    return False


def _extract_poi_from_ltp(tokens, pos_tags, raw_text):
    """从 LTP 分词+POS 结果中用通用规则提取 POI 候选

    通用规则：
    1. 专有名词(ns/nz/ni) + 品类名词(n) → 品牌+品类组合（如"湖锦+酒楼"）
    2. 连续专有名词 + 品类名词 → 多品牌词+品类（如"万达+嘉年华+酒店"）
    3. 独立地名(ns) ≥2字 → 地名实体
    4. 品类名词 + 品类名词 → 复合品类（如"火锅+餐厅"）
    5. 普通名词(非修饰词) + 品类名词 → 品牌+品类（如"参差+咖啡屋"、"云端+咖啡"）
    """
    venues = []
    seen = set()
    n = len(tokens)

    # 修饰词/品类词集合：这些词+品类名词 = 泛化描述，不是品牌名
    NON_BRAND_NOUNS = {
        '高分', '热门', '新开', '新店', '老牌', '老字号', '网红', '特色', '人气',
        '必吃', '宝藏', '经典', '正宗', '精致', '精品', '高端', '平价', '亲民',
        '实惠', '小众', '复古', '文艺', '连锁', '品牌', '旗舰', '主题', '创意',
        '休闲', '美', '好', '新', '大', '小', '老', '真', '高', '低',
        '手冲', '拿铁', '美式', '卡布', '摩卡', '浓缩', '冷萃', '冰滴',
        '自助', '快餐', '正餐', '简餐', '夜宵', '早茶',
        '西式', '日式', '韩式', '泰式', '欧式',
        # 非品牌普通名词（+品类名词 = 泛化描述）
        '资本', '美食', '环境', '服务', '品质', '口味', '味道', '价格', '人均',
        '装修', '氛围', '体验', '口碑', '评价', '评分', '人气', '颜值',
        # 非品牌地名词（道路/区域描述）
        '大道', '中路', '东路', '西路', '南路', '北路',
    }

    # ── 规则1/2：专有名词 + 品类名词组合 ──
    i = 0
    while i < n:
        # 收集连续的专有名词
        if pos_tags[i] in PROPER_POS:
            proper_start = i
            proper_parts = [tokens[i]]
            j = i + 1
            while j < n and pos_tags[j] in PROPER_POS:
                proper_parts.append(tokens[j])
                j += 1
            proper_end = j  # proper_end 是品类名词候选位置
            # 排除专有名词中的 SEO 碎片（如"中华"、"鄂菜"）
            SEO_PROPER_KEYWORDS = ('中华', '鄂菜')
            if any(pp in SEO_PROPER_KEYWORDS for pp in proper_parts):
                i = proper_end
                continue

            # 收集后面连续的普通名词（如"巴奴+毛肚+火锅"中的"毛肚+火锅"）
            # 只要求最后一个名词是品类名词
            venue_parts = []
            venue_end = proper_end
            found_venue_type = False
            SEO_FRAGMENT_KEYWORDS = ('本土', '十大', '名店', '高分', '热门', '必吃', '网红', '人气', '宝藏', '经典', '正宗', '精品', '特色', '主题', '创意', '老字号', '老牌', '新开', '新派', '高分', '人气', '推荐', '榜单', '必去', '必玩', '中华', '鄂菜', '老店', '烟火', '爆火')
            while venue_end < n and pos_tags[venue_end] in NOUN_POS and pos_tags[venue_end] not in PROPER_POS:
                # 排除 SEO 碎片关键词
                if tokens[venue_end] in SEO_FRAGMENT_KEYWORDS:
                    venue_end += 1
                    break
                venue_parts.append(tokens[venue_end])
                is_venue = _is_venue_type_noun(tokens[venue_end], pos_tags[venue_end])
                if is_venue:
                    found_venue_type = True
                venue_end += 1
                # 遇到品类名词后，如果下一个词不是品类名词则停止
                if found_venue_type and (venue_end >= n or not _is_venue_type_noun(tokens[venue_end], pos_tags[venue_end])):
                    break

            if venue_parts and _is_venue_type_noun(venue_parts[-1], pos_tags[venue_end-1]):
                # 如果专有名词全是地名(ns)且多个 → 不提取 ns+n 组合
                # 如"洪山区+光谷+步行街"不是品牌，只提取独立地名
                all_ns = all(pos_tags[k] == 'ns' for k in range(proper_start, proper_end))
                if all_ns and len(proper_parts) > 1:
                    # 多地名合并+品类 → 只提取独立地名，跳过组合
                    for k in range(proper_start, proper_end):
                        word = tokens[k]
                        if word not in seen and len(word) >= 2:
                            ctx_start = max(0, sum(len(t) for t in tokens[:k]) - 10)
                            ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:k+1]) + 10)
                            snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                            venues.append({
                                "name": word,
                                "label": "GPE",
                                "tags": [],
                                "snippet": snippet,
                                "source": "pos_rule",
                            })
                            seen.add(word)
                    i = venue_end
                    continue

                # 专有名词 + 名词组合（末尾为品类名词） → POI 候选
                full_name = ''.join(proper_parts + venue_parts)
                # 长度限制：组合名 ≤12 字（品牌+地名+品类组合可较长）
                if full_name not in seen and len(full_name) >= 3 and len(full_name) <= 12:
                    # 单地名+品类组合：检查中间是否有非品牌词
                    # 如"光谷+资本+大厦"中"资本"是非品牌词 → 跳过
                    # 如"关山+大道+光谷+创业街"中"大道"是非品牌词 → 跳过
                    if all_ns and len(venue_parts) > 1:
                        # 检查 venue_parts 中除最后一个品类名词外，是否有非品牌词
                        non_brand_in_venue = any(vp in NON_BRAND_NOUNS for vp in venue_parts[:-1])
                        if non_brand_in_venue:
                            # 只提取独立地名，跳过组合
                            for k in range(proper_start, proper_end):
                                word = tokens[k]
                                if word not in seen and len(word) >= 2:
                                    ctx_start = max(0, sum(len(t) for t in tokens[:k]) - 10)
                                    ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:k+1]) + 10)
                                    snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                                    venues.append({
                                        "name": word,
                                        "label": "GPE",
                                        "tags": [],
                                        "snippet": snippet,
                                        "source": "pos_rule",
                                    })
                                    seen.add(word)
                            i = venue_end
                            continue
                    # 计算上下文 snippet
                    ctx_start = max(0, sum(len(t) for t in tokens[:proper_start]) - 10)
                    ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:venue_end]) + 10)
                    snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()

                    # 判断标签类型
                    brand_core = ''.join(proper_parts)
                    if pos_tags[proper_start] == 'ns':
                        label = 'FAC'  # 地名+品类 → 设施
                    elif pos_tags[proper_start] == 'ni':
                        label = 'ORG'  # 机构名+品类 → 机构
                    else:
                        label = 'FAC'  # nz+品类 → 设施

                    venues.append({
                        "name": full_name,
                        "label": label,
                        "tags": [brand_core],
                        "snippet": snippet,
                        "source": "pos_rule",
                    })
                    seen.add(full_name)
                i = venue_end
                continue

            # 专有名词后面没有品类名词
            # 如果连续专有名词组合本身看起来像 POI（如"楚河汉街"被 LTP 整体标为 ns）
            if len(proper_parts) >= 1:
                for k in range(proper_start, proper_end):
                    word = tokens[k]
                    if word not in seen and len(word) >= 2 and pos_tags[k] == 'ns':
                        # 独立地名
                        ctx_start = max(0, sum(len(t) for t in tokens[:k]) - 10)
                        ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:k+1]) + 10)
                        snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                        venues.append({
                            "name": word,
                            "label": "GPE",
                            "tags": [],
                            "snippet": snippet,
                            "source": "pos_rule",
                        })
                        seen.add(word)
                    elif word not in seen and len(word) >= 2 and pos_tags[k] in ('nz', 'ni'):
                        # 独立专有名词（品牌名）
                        ctx_start = max(0, sum(len(t) for t in tokens[:k]) - 10)
                        ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:k+1]) + 10)
                        snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                        venues.append({
                            "name": word,
                            "label": "ORG" if pos_tags[k] == 'ni' else "FAC",
                            "tags": [],
                            "snippet": snippet,
                            "source": "pos_rule",
                        })
                        seen.add(word)
            i = proper_end
            continue

        # ── 规则5：普通名词(非修饰词) + 品类名词 → 品牌+品类 ──
        # 如"参差(n)+咖啡屋(n)"、"云端(n)+咖啡(n)"
        # 必须满足：名词≥2字、不是修饰词、不是数字/量词、不是 SEO 碎片
        if pos_tags[i] == 'n' and tokens[i] not in NON_BRAND_NOUNS and len(tokens[i]) >= 2:
            # 排除数字/量词（如"10家店"中的"10家"）
            if re.match(r'^\d+|^[一二三四五六七八九十]+$', tokens[i]):
                i += 1
                continue
            # 排除量词（如"一家"、"很多"）
            if tokens[i] in ('一家', '两家', '很多', '各种', '各类', '这些', '那些'):
                i += 1
                continue
            # 排除 SEO 碎片关键词（如"本土"、"十大"、"名店"）
            SEO_FRAGMENT_KEYWORDS = ('本土', '十大', '名店', '高分', '热门', '必吃', '网红', '人气', '宝藏', '经典', '正宗', '精品', '特色', '主题', '创意', '老字号', '老牌', '新开', '新派')
            if tokens[i] in SEO_FRAGMENT_KEYWORDS:
                i += 1
                continue
            # 收集连续的普通名词（非修饰词）
            noun_start = i
            noun_parts = [tokens[i]]
            j = i + 1
            while j < n and pos_tags[j] == 'n' and tokens[j] not in NON_BRAND_NOUNS and len(tokens[j]) >= 2:
                noun_parts.append(tokens[j])
                j += 1
            noun_end = j

            # 检查 noun_parts 中是否含 SEO 关键词
            if any(np in SEO_FRAGMENT_KEYWORDS for np in noun_parts):
                i = noun_end
                continue

            # 检查最后一个名词是否是品类名词
            if noun_parts and _is_venue_type_noun(noun_parts[-1], 'n'):
                # 前面的名词是否是品牌核心（非品类词、非修饰词）
                brand_parts = noun_parts[:-1]
                if brand_parts:
                    brand_core = ''.join(brand_parts)
                    full_name = ''.join(noun_parts)
                    if full_name not in seen and len(brand_core) >= 2 and len(full_name) >= 3:
                        ctx_start = max(0, sum(len(t) for t in tokens[:noun_start]) - 10)
                        ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:noun_end]) + 10)
                        snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                        venues.append({
                            "name": full_name,
                            "label": "FAC",
                            "tags": [brand_core],
                            "snippet": snippet,
                            "source": "pos_rule",
                        })
                        seen.add(full_name)
                i = noun_end
                continue

            # ── 规则5.5：融合品牌词（单 token 含品牌核心+品类后缀，如"漫咖啡"） ──
            # LTP 常把"漫咖啡"、"瑞咖啡"等标为单个 n token
            # 品牌核心仅1字但确实是品牌名，且后面常跟 nz/ni + 店/厅等
            if pos_tags[i] == 'n' and len(tokens[i]) >= 3:
                word = tokens[i]
                # 检查是否含品类后缀（咖啡/餐厅/火锅/烧烤/酒店/茶馆/奶茶等）
                FUSION_SUFFIXES = ('咖啡', '餐厅', '火锅', '烧烤', '酒店', '宾馆', '茶馆', '奶茶',
                                  '面馆', '酒楼', '食府', '菜馆')
                fusion_core = None
                fusion_suf = None
                for suf in sorted(FUSION_SUFFIXES, key=len, reverse=True):
                    if word.endswith(suf) and len(word) > len(suf):
                        core = word[:-len(suf)]
                        # 品牌核心≥1字、不是修饰词、不是数字/量词
                        if (len(core) >= 1 and core not in NON_BRAND_NOUNS
                                and not re.match(r'^\d+|^[一二三四五六七八九十]+$', core)
                                and core not in SEO_FRAGMENT_KEYWORDS):
                            fusion_core = core
                            fusion_suf = suf
                            break
                if fusion_core:
                    # 后面紧跟专有名词(nz/ni) + 品类名词 → 组合提取（如"漫咖啡+泛悦城+店"）
                    j = i + 1
                    combo_parts = [word]
                    if j < n and pos_tags[j] in PROPER_POS:
                        combo_parts.append(tokens[j])
                        j += 1
                        while j < n and pos_tags[j] in PROPER_POS:
                            combo_parts.append(tokens[j])
                            j += 1
                    # 收集后续品类名词（如"店"、"分店"）
                    while j < n and pos_tags[j] == 'n' and _is_venue_type_noun(tokens[j], pos_tags[j]):
                        combo_parts.append(tokens[j])
                        j += 1
                    full_name = ''.join(combo_parts)
                    if full_name not in seen and len(full_name) >= 3 and len(full_name) <= 12:
                        ctx_start = max(0, sum(len(t) for t in tokens[:i]) - 10)
                        ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:j]) + 10)
                        snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                        venues.append({
                            "name": full_name,
                            "label": "FAC",
                            "tags": [fusion_core],
                            "snippet": snippet,
                            "source": "pos_rule",
                        })
                        seen.add(full_name)
                    i = j
                    continue

            # 单独一个品类名词 → 不提取（纯品类描述）
            # 但如果后面还有品类名词 → 复合品类
            if _is_venue_type_noun(tokens[i], pos_tags[i]):
                j = i + 1
                if j < n and _is_venue_type_noun(tokens[j], pos_tags[j]):
                    full_name = tokens[i] + tokens[j]
                    if full_name not in seen and len(full_name) >= 3:
                        ctx_start = max(0, sum(len(t) for t in tokens[:i]) - 10)
                        ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:j+1]) + 10)
                        snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                        venues.append({
                            "name": full_name,
                            "label": "FAC",
                            "tags": [tokens[i]],
                            "snippet": snippet,
                            "source": "pos_rule",
                        })
                        seen.add(full_name)
            i += 1
            continue

        # ── 规则3：品类名词 + 品类名词组合（如"火锅+餐厅"） ──
        if _is_venue_type_noun(tokens[i], pos_tags[i]):
            j = i + 1
            if j < n and _is_venue_type_noun(tokens[j], pos_tags[j]):
                full_name = tokens[i] + tokens[j]
                if full_name not in seen and len(full_name) >= 3:
                    ctx_start = max(0, sum(len(t) for t in tokens[:i]) - 10)
                    ctx_end = min(len(raw_text), sum(len(t) for t in tokens[:j+1]) + 10)
                    snippet = raw_text[ctx_start:ctx_end].replace('\n', ' ').strip()
                    venues.append({
                        "name": full_name,
                        "label": "FAC",
                        "tags": [tokens[i]],
                        "snippet": snippet,
                        "source": "pos_rule",
                    })
                    seen.add(full_name)
            i += 1
            continue

        i += 1

    return venues


def extract_venues(contents, query=""):
    """从多个网页正文中提取候选地点"""
    all_venues = []

    # 批处理：LTP pipeline
    texts = [_preprocess_text(c.get("content", ""))[:3000] for c in contents]
    # LTP 批量处理
    results = ltp_model.pipeline(texts, tasks=["cws", "pos"])

    for idx in range(len(texts)):
        tokens = results.cws[idx]
        pos_tags = results.pos[idx]
        raw_text = texts[idx]

        # 1. LTP POS 通用规则提取
        ltp_venues = _extract_poi_from_ltp(tokens, pos_tags, raw_text)
        all_venues.extend(ltp_venues)

    # ── pos_rule 结果先写入 seen（优先级高于 regex） ──
    seen = {}
    for v in all_venues:
        name = v["name"]
        if name in seen:
            existing = seen[name]
            existing["tags"] = list(set(existing.get("tags", []) + v.get("tags", [])))
            if v.get("location") and len(v["location"]) > len(existing.get("location", "")):
                existing["location"] = v["location"]
        else:
            seen[name] = v

    # ── GPE/LOC 位置映射 ──
    gpe_map = {}
    for v in seen.values():
        if v["label"] in ("GPE", "LOC"):
            gpe_map[v["name"]] = v["name"]
    for v in seen.values():
        if v["label"] in ("FAC", "ORG", "SHOP", "ADJ+NOUN") and not v.get("location"):
            snippet = v.get("snippet", "")
            best_loc = ""
            for gpe_name in gpe_map:
                if gpe_name in snippet:
                    if len(gpe_name) > len(best_loc):
                        best_loc = gpe_name
            v["location"] = best_loc if best_loc else ""

    # ── 正则补充提取（仅补充 pos_rule 未提取的） ──

    # 正则提取：品牌名+店后缀（排除含动词/助词的误匹配）
    all_text = " ".join([c.get("content", "")[:3000] for c in contents])
    # 排除的动词/虚词
    BAD_PREFIX = {'有', '很', '是', '的', '了', '在', '到', '去', '来', '会', '能', '让', '被', '把', '给', '和', '与', '或', '但', '而', '又', '就', '也', '都', '还', '已', '将', '要', '想', '做', '看', '说', '走', '跑', '吃', '喝', '买', '卖', '开', '关', '上', '下', '中', '里', '外', '前', '后', '多', '少', '大', '小', '老', '新', '好', '这', '那', '一', '不'}
    shop_suffixes = r'(?:店|分店|旗舰店|体验店|概念店|主题店)'
    shop_regex = re.compile(r'([\d\u4e00-\u9fff]{2,8}' + shop_suffixes + r')')
    for match in shop_regex.finditer(all_text):
        name = match.group(1)
        # 含"的/了/着" → 不是品牌名（如"步行街的老牌咖啡店"）
        if '的' in name or '了' in name or '着' in name:
            continue
        # 去掉店后缀，检查前缀是否以动词开头
        prefix = re.sub(r'(?:店|分店|旗舰店|体验店|概念店|主题店)$', '', name)
        if prefix and prefix[0] in BAD_PREFIX:
            continue
        if len(prefix) < 2:
            continue
        if name not in seen and name not in GENERIC_WORDS:
            # 前缀含虚词组合 → 不是品牌名（如"谷有很多高分咖啡店"）
            BAD_INNER = {'很多', '有的', '是在', '就在', '也有', '都有', '还有', '开在', '在武汉', '在光谷', '在武昌'}
            if any(bi in name for bi in BAD_INNER):
                continue
            # 含 SEO 碎片关键词 → 不是品牌名
            SEO_INNER = ('本土', '十大', '名店', '高分', '热门', '必吃', '网红', '人气', '宝藏', '经典', '正宗', '精品', '特色', '主题', '创意', '老字号', '老牌', '新开', '新派', '推荐', '榜单', '必去', '必玩', '中华', '鄂菜', '老店', '烟火', '爆火', '首家', '融合', '创新', '概念', '首家融合', '融合创新', '创新概念')
            if any(si in name for si in SEO_INNER):
                continue
            # 纯品类词（无品牌核心）
            PURE_CATEGORY_REGEX = r'^(?:百货商场|购物中心|咖啡|餐厅|酒店|宾馆|火锅|烧烤|奶茶|茶馆|商场|公园|博物馆|景区)$'
            if re.match(PURE_CATEGORY_REGEX, name):
                continue
            # 前缀含数字 → 不是品牌名（如"10家店"）
            if re.search(r'\d', prefix):
                continue
            # 检查是否是已提取名的子串（如"克武汉光谷世界城店"是"星巴克武汉光谷世界城店"的子串）
            is_substring = any(name in existing_name and name != existing_name for existing_name in seen)
            if is_substring:
                continue
            seen[name] = {
                "name": name,
                "label": "SHOP",
                "tags": [],
                "snippet": name,
                "source": "regex",
            }

    # 正则提取：品牌+咖啡/餐厅/商场等完整名称
    po_type_regex = re.compile(r'([\u4e00-\u9fff]{2,8}(?:咖啡屋|咖啡馆|咖啡厅|咖啡店|茶餐厅|火锅店|烧烤店|概念店|购物中心|百货商场))')
    for match in po_type_regex.finditer(all_text):
        name = match.group(1)
        # 含"的/了/着" → 不是品牌名
        if '的' in name or '了' in name or '着' in name:
            continue
        BAD_INNER_PO = {'很多', '有的', '是在', '就在', '也有', '都有', '还有', '开在',
                        '是高端', '是集', '是武汉', '在武汉', '是光谷', '是武昌', '是江汉'}
        if any(bi in name for bi in BAD_INNER_PO):
            continue
        # 去掉品类后缀，检查前缀是否以动词/介词开头
        po_prefix = re.sub(r'(?:咖啡屋|咖啡馆|咖啡厅|咖啡店|茶餐厅|火锅店|烧烤店|概念店|购物中心|百货商场)$', '', name)
        if po_prefix and po_prefix[0] in BAD_PREFIX:
            continue
        if len(po_prefix) < 2:
            continue
        if name not in seen and name not in GENERIC_WORDS:
            # 含 SEO 碎片关键词 → 不是品牌名
            if any(si in name for si in SEO_INNER):
                continue
            seen[name] = {
                "name": name,
                "label": "FAC",
                "tags": [],
                "snippet": name,
                "source": "regex",
            }

    # ── 过滤阶段1：修饰词剥离 + 泛化词 + SEO碎片 + 噪声 ──
    NOISE_PATTERN = re.compile(r'[)）】\]]|人均|评分|评论|营业|电话|地址|路线|交通|门票|攻略|推荐|打卡|分享|下载|关注|浏览|收藏|点赞|评论数|阅读数|查询|搜索|查找|附近|周边|位置')
    # SEO 前缀动词
    SEO_PREFIXES = ('查询', '搜索', '查找', '附近', '周边', '推荐', '攻略', '位置', '地址', '索引')
    # 品类后缀（用于判断是否为纯品类描述）
    CATEGORY_SUFFIXES = ('咖啡店', '咖啡厅', '咖啡馆', '咖啡屋', '餐厅', '饭店', '火锅店', '烧烤店',
                        '商场', '购物中心', '百货', '酒店', '宾馆', '茶馆', '奶茶店', '面馆',
                        '小吃店', '快餐店', '步行街', '公园', '博物馆', '景区')
    # 品牌名最小核心长度（去掉品类后缀后至少2个中文字符才是品牌名）
    MIN_BRAND_CORE_LEN = 2
    # 品类核心词（不是品牌名，是品类描述）
    CATEGORY_CORE_WORDS = {'手冲', '拿铁', '美式', '卡布', '摩卡', '浓缩', '冷萃', '冰滴',
                           '清咖', '黑咖', '白咖', '速溶', '现磨', '鲜榨', '特调',
                           '自助', '快餐', '正餐', '简餐', '大排档', '夜宵', '早茶'}

    result = []
    for v in seen.values():
        name = v["name"]
        # 基本条件
        if not re.search(r"[\u4e00-\u9fff]", name):
            continue
        if name in GENERIC_WORDS:
            continue
        if NOISE_PATTERN.search(name):
            continue
        # 含特殊字符（* ? # 等）→ 列表碎片/格式碎片
        if re.search(r'[\*\?#\$\^~`\\|<>{}]', name):
            continue
        # 以"* "开头 → 列表碎片（如"* 咖啡"、"* 酒店"）
        if name.startswith('* '):
            continue
        # 以 SEO 前缀动词开头 → 去掉
        if any(name.startswith(p) for p in SEO_PREFIXES):
            continue
        # 数字前缀（如"4. 湖锦酒楼"）→ 去掉数字前缀后重新检查
        stripped = re.sub(r'^[\d]+[.、)）\s]+', '', name)
        if stripped != name:
            if stripped in GENERIC_WORDS or len(stripped) < 2:
                continue
            v["name"] = stripped
            name = stripped

        # ── 修饰词剥离：去掉前缀修饰词后检查是否为泛化词 ──
        stripped_name = MODIFIER_PREFIXES.sub('', name)
        if stripped_name != name:
            # 剥离后变成泛化词 → 过滤
            if stripped_name in GENERIC_WORDS or len(stripped_name) < 2:
                continue
            # 剥离后变成纯品类后缀 → 过滤（如"热门咖啡店" → "咖啡店"）
            if any(stripped_name.endswith(suf) for suf in CATEGORY_SUFFIXES):
                core = stripped_name
                for suf in sorted(CATEGORY_SUFFIXES, key=len, reverse=True):
                    if core.endswith(suf):
                        core = core[:-len(suf)]
                        break
                if len(core) < MIN_BRAND_CORE_LEN:
                    continue
            # 剥离后更新名称
            v["name"] = stripped_name
            name = stripped_name

        # ── SEO 碎片检测：含动词/代词/量词 → 不是品牌名 ──
        # 检查名称中是否包含 SEO 碎片关键词（作为独立词出现，不是品牌名的一部分）
        if _is_seo_fragment(name):
            continue

        # ── 纯品类描述检测：名字=修饰词+品类后缀且无品牌核心 ──
        if any(name.endswith(suf) for suf in CATEGORY_SUFFIXES):
            core = name
            for suf in sorted(CATEGORY_SUFFIXES, key=len, reverse=True):
                if core.endswith(suf):
                    core = core[:-len(suf)]
                    break
            # 核心品牌名太短（<2字）→ 不是品牌名，是品类描述
            if len(core) < MIN_BRAND_CORE_LEN:
                continue
            # 核心是品类词（如"手冲"咖啡）→ 不是品牌名
            if core in CATEGORY_CORE_WORDS:
                continue

        # 纯地名（GPE/LOC）过滤：太短的跳过
        if v["label"] in ("GPE", "LOC") and len(name) < 3:
            continue
        # 非场所名词过滤：FAC/ORG/SHOP 中名称不含任何场所品类后缀且≤4字
        # 很可能是菜名/人名/形容词等误提取（如"缤纷"、"可朗芙"、"解放"）
        if v["label"] in ("FAC", "ORG", "SHOP") and len(name) <= 4:
            VENUE_INDICATORS = ('店', '厅', '馆', '楼', '城', '场', '院', '所', '站', '台',
                               '街', '区', '园', '吧', '铺', '庄', '寺', '庙', '观', '塔',
                               '广场', '大厦', '中心', '酒店', '餐厅', '咖啡', '火锅', '烧烤',
                               '商场', '公园', '博物馆', '景区', '宾馆', '旅馆', '民宿',
                               '百货', '超市', '市场', '步行街', '商业街', '大学', '学院',
                               '医院', '影院', '剧院', '游泳馆', '健身', '图书馆')
            if not any(ind in name for ind in VENUE_INDICATORS):
                continue
        # 非地点类型（FAC/ORG/SHOP/ADJ+NOUN）保留
        if v["label"] not in ("GPE", "LOC", "FAC", "ORG", "SHOP", "ADJ+NOUN", "regex"):
            continue
        if len(name) < 2:
            continue
        result.append(v)
    # 再次过滤：标点/碎片清理
    cleaned = []
    for v in result:
        name = v["name"]
        # 以标点结尾 → 去掉
        if name[-1] in '，。、！？；：）)】]':
            continue
        # 含括号碎片 → 去掉
        if '(' in name or '（' in name:
            continue
        # 纯品类词（无品牌核心）→ 过滤
        PURE_CATEGORY_WORDS = {'地铁站', '古迹游', '美食街', '步行街', '小吃街', '商业街',
                              '购物中心', '百货大楼', '商业广场', '美食广场',
                              '咖啡', '餐厅', '酒店', '宾馆', '火锅', '烧烤',
                              '奶茶', '茶馆', '商场', '公园', '博物馆', '景区',
                              '火锅餐厅', '烧烤餐厅', '自助餐厅', '休闲餐厅',
                              '特色餐厅', '主题餐厅', '料理餐厅', '调味餐厅',
                              '名人餐厅', '老店', '新店', '分店', '总店'}
        if name in PURE_CATEGORY_WORDS:
            continue
        # 交通设施/地址碎片 → 过滤（如"武汉地铁2号线"、"中山大道交叉口"、"以江汉路公车"）
        if re.search(r'地铁\d*号线|轻轨\d*号线|交叉口|十字路口|公交站|地铁站', name):
            continue
        # 纯道路名+交通词（如"以江汉路公车"、"临江大道公车"）→ 过滤
        if re.search(r'[路街道]\s*(公车|公交|地铁|轻轨|出租)', name):
            continue
        # 地址号碎片（如"华师园北路6号"、"建设大道88号"）→ 过滤
        if re.search(r'\d+号$', name):
            continue
        # 新闻碎片：含"闭店/宣布/探访/决定"等新闻动词 → 不是POI名
        NEWS_WORDS = ('闭店', '宣布', '探访', '决定', '实施', '改为', '对于', '我们要', '还是',
                      '曾经', '即将', '已经', '曾经', '曾经')
        if any(nw in name for nw in NEWS_WORDS):
            continue
        # 比较短语/评价片段（如"比一般的牛杂店"、"分以上口碑店"、"10大必吃"）
        if re.search(r'比一般|分以上|口碑店|性价比|人均|评分|好评率|上榜|必吃榜|必去榜|必买|必玩|排行榜|排名|TOP\d|第[一二三四五六七八九十]名', name):
            continue
        # 纯修饰词+品类后缀且无品牌核心（如"美食餐厅"、"地标餐厅"、"新派餐厅"、"高分餐厅"）
        # 去掉品类后缀后，如果剩余部分全是修饰词 → 过滤
        MODIFIER_ONLY = {'美食', '地标', '新派', '高分', '高分餐厅', '网红', '热门', '人气',
                        '宝藏', '必吃', '必去', '经典', '正宗', '老字号', '老牌', '新开',
                        '特色', '主题', '创意', '精品', '高端', '平价', '亲民', '实惠',
                        '小众', '文艺', '复古', '连锁', '旗舰', '体验', '休闲', '精致'}
        name_core = name
        for suf in sorted(CATEGORY_SUFFIXES, key=len, reverse=True):
            if name_core.endswith(suf):
                name_core = name_core[:-len(suf)]
                break
        if name_core in MODIFIER_ONLY or (len(name_core) <= 1 and name not in PURE_CATEGORY_WORDS):
            continue
        # 食品/菜名碎片（LTP 常把菜名标为 nz，如"缤纷水果"、"可朗芙"、"浓情披萨"）
        FOOD_WORDS = {'可朗芙', '缤纷水果', '浓情披萨', '蟹黄', '龙虾', '小龙虾',
                      '凤爪', '虾饺', '烧卖', '奶皇包', '红米肠', '榴莲酥',
                      '钵钵鸡', '热干面', '豆皮', '面窝', '武昌鱼', '排骨汤'}
        if name in FOOD_WORDS:
            continue
        # 缺品牌名的"店/馆/厅"后缀碎片（如"黄鹤楼店"缺品牌、"年老店"碎片）
        if name.endswith(('店', '馆', '厅')) and len(name) <= 3:
            continue
        # "获"字开头 + 名词 → SEO标题（如"获中华餐饮名店"、"获脂菜十大名店"）
        if name.startswith('获'):
            continue
        # 更多泛品类词（购物/商场类）
        MORE_GENERIC = {'零售商场', '实体商场', '零卖商场', '旗百货', '部分商家',
                       '地级商场', '百汇商场', '大型商场', '综合商场',
                       '东北饺子馆', '韩国料理店', '重庆卤菜店', '蒸菜快餐店',
                       '轻酒吧和咖啡店', '自助餐厅', '主题餐厅',
                       '购物公园', '百汇百货', '实体店', '零卖店'}
        if name in MORE_GENERIC:
            continue
        # 含"的" → 仅在"的"后紧跟品类后缀时过滤（如"好吃的餐厅"、"武汉的酒店"）
        # 如果"的"在末尾或后面不是品类词，保留（如"胖哥的"可能是品牌名）
        if '的' in name:
            de_idx = name.index('的')
            rest_after_de = name[de_idx+1:]
            # "的"后面紧跟品类后缀 → SEO碎片
            if rest_after_de and any(rest_after_de.startswith(s) for s in ['咖啡', '餐厅', '店', '厅', '馆', '商场', '购物', '酒店', '宾馆', '火锅', '烧烤']):
                continue
            # "的"在开头 → 一定不是POI名（如"的好吃"）
            if de_idx == 0:
                continue
        # 含重复汉字3次以上 → 格式错误（如"和和平大道"）
        if re.search(r'(.)\1{2,}', name):
            continue
        # 重复词模式（如"餐厅餐厅"）→ 过滤
        if re.search(r'(.{2,})\1', name):
            continue
        # 单字母/数字+品类（如"K 餐厅"、"K 宾馆"）→ 过滤
        if re.match(r'^[A-Za-z]\s*(餐厅|酒店|宾馆|咖啡|商场|店|厅|馆)', name):
            continue
        # 纯品类组合（无品牌核心，如"火锅 餐厅"、"探鱼 烧烤"）→ 检查
        # 去掉空格后检查是否为纯品类词
        name_no_space = name.replace(' ', '')
        if name_no_space in PURE_CATEGORY_WORDS:
            continue
        # 含间隔号但不是"品牌·店名"格式 → 去掉
        if '·' in name and not (name.count('·') == 1 and len(name) > 4):
            continue
        # 以"城"开头的碎片 → 去掉
        if name.startswith('城'):
            continue
        cleaned.append(v)
    result = cleaned
    # 子串去重：如果一个名称是另一个名称的子串
    # 规则：pos_rule 优先于 regex；保留更精确的名称
    names_to_remove = set()
    for i, v1 in enumerate(result):
        for j, v2 in enumerate(result):
            if i == j:
                continue
            n1, n2 = v1["name"], v2["name"]
            # n1 是 n2 的子串
            if n1 != n2 and n1 in n2:
                # pos_rule 的短名 vs regex 的长名 → 删除 regex 的长名
                if v1["source"] == "pos_rule" and v2["source"] == "regex":
                    names_to_remove.add(j)
                # 同来源或 regex 的短名 → 删除短的
                else:
                    names_to_remove.add(i)
                break
    result = [v for i, v in enumerate(result) if i not in names_to_remove]
    # 优先保留 FAC/ORG/SHOP 类型，GPE/LOC 降权
    type_priority = {"FAC": 0, "SHOP": 0, "regex": 0, "pos_rule": 0, "ADJ+NOUN": 1, "ORG": 1, "GPE": 2, "LOC": 2}
    result.sort(key=lambda v: (type_priority.get(v["label"], 3), -len(v["name"])))
    # 候选上限
    result = result[:50]

    # 按查询相关性排序
    if query:
        query_chars = set(query)
        result.sort(
            key=lambda v: len(set(v["name"]) & query_chars),
            reverse=True,
        )

    return result


# ── HTTP 服务 ──
class NERHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/extract":
            self.send_error(404)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        contents = data.get("contents", [])
        query = data.get("query", "")

        start = time.time()
        venues = extract_venues(contents, query)
        elapsed_ms = int((time.time() - start) * 1000)

        response = json.dumps({
            "venues": venues,
            "count": len(venues),
            "elapsed_ms": elapsed_ms,
        }, ensure_ascii=False)

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(response.encode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","model":"LTP/base"}')
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        # 简化日志
        print(f"[NER] {args[0]}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="LTP POS + 通用规则 POI 提取 HTTP 服务")
    parser.add_argument("--port", type=int, default=5100, help="服务端口")
    parser.add_argument("--test", action="store_true", help="运行内置测试")
    args = parser.parse_args()

    # 预加载模型
    load_model()

    if args.test:
        # 内置测试
        test_contents = [
            {
                "title": "光谷咖啡店推荐",
                "content": "光谷有很多高分咖啡店，参差咖啡屋是光谷步行街的老牌咖啡店，"
                           "星巴克武汉光谷世界城店也很受欢迎。云端咖啡位于关山大道光谷创业街，"
                           "环境安静适合办公。新店咖啡在洪山区光谷步行街D区2楼，手冲咖啡很棒。"
                           "光谷创业咖啡由雷军投资，位于光谷资本大厦。",
            },
            {
                "title": "武昌区餐厅",
                "content": "武昌万象城有很多高分餐厅，楚采新楚菜人均91元评分4.8星，"
                           "巴奴毛肚火锅是必吃榜餐厅，慢刀鲜牛肉火锅也很受欢迎。"
                           "楚河汉街是美食天堂，O'eat Bistro提供西式餐饮。",
            },
        ]

        start = time.time()
        venues = extract_venues(test_contents, "光谷高分咖啡店推荐")
        elapsed = time.time() - start

        print(f"\n提取结果 ({len(venues)} 个地点, 耗时 {elapsed:.2f}s):")
        for v in venues:
            adj_str = f" [{', '.join(v['tags'])}]" if v.get("tags") else ""
            print(f"  - {v['name']} ({v['label']}{adj_str}) ← {v['source']}")
        return

    # 启动 HTTP 服务
    server = HTTPServer(("0.0.0.0", args.port), NERHandler)
    print(f"[NER] HTTP 服务启动: http://0.0.0.0:{args.port}", file=sys.stderr)
    print(f"[NER] 接口: POST /extract  GET /health", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[NER] 服务停止", file=sys.stderr)
        server.server_close()


if __name__ == "__main__":
    main()
