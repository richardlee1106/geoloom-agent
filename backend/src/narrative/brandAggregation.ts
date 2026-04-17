import type { EvidenceItem } from '../chat/types.js'

// 品牌类型：高校 / 景区 / 小吃街 / 商业体
export type BrandType = 'campus' | 'scenic' | 'food_street' | 'commercial'

export interface BrandCluster {
  brand: string
  type: BrandType
  count: number
  members: EvidenceItem[]
  center: { lon: number, lat: number }
}

// 高校排除规则：把中小学、幼儿园、附属学校从 campus 中剔除
const CAMPUS_EXCLUDE = /(小学|中学|幼儿园|附小|附中|实验学校|国际学校|九年一贯制|职业学院|职业技术学院|职业大学|职业学校|职业技术学校|高等专科学校|专科学校|高职|中专|中等专业学校|技师学院|技工学校)/u
const LEADING_NOISE_OPERATOR = /^(怪兽充电|街电|来电|小电|美团充电|搜电|星星充电|汽车充电站|充电站|充电桩|峰泊|云快充|特来电)/u
const SUPPORT_TAIL_NOISE = /^(停车场|停车楼|洗车场|充电站|充电桩|服务中心|游客中心|管理处|售票处|出入口|入口|出口|门岗|门卫|东门|西门|南门|北门|[东西南北]?[0-9一二三四五六七八九十]+号门|座椅|岗亭)/u
const CAMPUS_TAIL_NOISE = /^(医院|医疗|门诊|校友会|通讯|专营店|零食仓|青年旅舍|不动产|酒店|宾馆|超市|餐厅|便利店|书店|奶茶|咖啡|烤肉|充电|停车场|洗车|驿站|快递|代理|营业部|商行|琴行|舞蹈|练字|培训|驾校|美容|药店|银行|打印|眼镜|档案室|办公室|管理处|服务中心|招生办|教务处|保卫处|后勤处)/u
// 非锚定医疗噪声：remainder 中任意位置出现医学院/附属医院等 → 不是校园实体
const CAMPUS_MEDICAL_CONTAINS = /医学院|附属医院|附属.*医院|临床学院/u

function stripTrailingBracketSuffix(text: string) {
  return text
    .replace(/[（(][^（）()]{0,24}[）)]$/u, '')
    .replace(/[（(][^（）()]{0,24}[）)]$/u, '')
    .trim()
}

function normalizeRemainder(text: string) {
  return text.replace(/^[\s\-—_·•]+/u, '').trim()
}

function sanitizeBrand(brand: string) {
  const text = brand.replace(/[\s\-—_·•]+$/u, '').trim()
  if (!text || /[（(]/u.test(text)) return ''
  return text
}

/**
 * 从 POI 名字里抽取区域性品牌前缀。
 * 例：
 *   "湖北大学三期公寓"     → { brand: "湖北大学", type: "campus" }
 *   "东湖风景区磨山景区"   → { brand: "东湖风景区", type: "scenic" }
 *   "户部巷小吃街麦当劳"   → { brand: "户部巷小吃街", type: "food_street" }
 *   "楚河汉街 Cinestar"    → null （未匹配尾缀词典，交由上层用最长公共前缀兜底）
 */
export function extractBrandFromName(name: string): { brand: string | null, type: BrandType | null } {
  const rawText = String(name || '').trim()
  const text = stripTrailingBracketSuffix(rawText)
  if (!text) return { brand: null, type: null }
  if (LEADING_NOISE_OPERATOR.test(text)) return { brand: null, type: null }

  // 校园（优先级最高）：从开头贪婪截取到 "大学" 或 "学院"
  if (!CAMPUS_EXCLUDE.test(text)) {
    const match = text.match(/^(.{2,12}?(?:大学|学院))/u)
    if (match && !CAMPUS_EXCLUDE.test(match[1])) {
      const brand = sanitizeBrand(match[1])
      const remainder = normalizeRemainder(text.slice(match[1].length))
      if (brand && !CAMPUS_TAIL_NOISE.test(remainder) && !CAMPUS_MEDICAL_CONTAINS.test(remainder)) {
        return { brand, type: 'campus' }
      }
    }
  }

  // 小吃街 / 美食街（放在 scenic 前，因为小吃街可能也带"街"）
  const food = text.match(/^(.{2,12}?(?:小吃街|美食街|夜市|美食广场|美食城))/u)
  if (food) {
    const brand = sanitizeBrand(food[1])
    const remainder = normalizeRemainder(text.slice(food[1].length))
    if (brand && !SUPPORT_TAIL_NOISE.test(remainder)) {
      return { brand, type: 'food_street' }
    }
  }

  // 景区 / 公园 / 博物馆
  const scenic = text.match(/^(.{2,14}?(?:风景区|景区|景点|旅游区|文化园|国家公园|湿地公园|森林公园|植物园|动物园|主题公园|公园|博物馆|纪念馆|名胜区|古迹))/u)
  if (scenic) {
    const brand = sanitizeBrand(scenic[1])
    const remainder = normalizeRemainder(text.slice(scenic[1].length))
    if (brand && !SUPPORT_TAIL_NOISE.test(remainder)) {
      return { brand, type: 'scenic' }
    }
  }

  // 商业街 / 购物中心
  const commercial = text.match(/^(.{2,12}?(?:步行街|商业街|商圈|购物中心|购物广场|商业广场|奥特莱斯|奥莱|天地))/u)
  if (commercial) {
    const brand = sanitizeBrand(commercial[1])
    const remainder = normalizeRemainder(text.slice(commercial[1].length))
    if (brand && !SUPPORT_TAIL_NOISE.test(remainder)) {
      return { brand, type: 'commercial' }
    }
  }

  return { brand: null, type: null }
}

/**
 * 把一批 POI 按品牌聚合：同前缀品牌的 POI 合成一个区域实体。
 * 调用方可根据 type + count 决定是否采纳（如 campus 要求 count >= 2 才能成 cluster）。
 */
export function clusterPoisByBrand(pois: EvidenceItem[]): BrandCluster[] {
  const buckets = new Map<string, BrandCluster>()

  for (const poi of pois) {
    const { brand, type } = extractBrandFromName(String(poi.name || ''))
    if (!brand || !type) continue
    const lon = Number(poi.longitude)
    const lat = Number(poi.latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

    const key = `${type}:${brand}`
    const existing = buckets.get(key)
    if (existing) {
      existing.members.push(poi)
      existing.count = existing.members.length
    } else {
      buckets.set(key, {
        brand,
        type,
        count: 1,
        members: [poi],
        center: { lon, lat },
      })
    }
  }

  // 重新计算 center 为成员质心，而非第一个成员
  for (const cluster of buckets.values()) {
    const valid = cluster.members.filter(
      (m) => Number.isFinite(Number(m.longitude)) && Number.isFinite(Number(m.latitude)),
    )
    if (valid.length === 0) continue
    cluster.center = {
      lon: valid.reduce((sum, m) => sum + Number(m.longitude), 0) / valid.length,
      lat: valid.reduce((sum, m) => sum + Number(m.latitude), 0) / valid.length,
    }
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count)
}

/**
 * 判断一个 brand cluster 是否足以成为独立导览节点：
 *   - campus：至少 2 个子 POI 才聚合（避免单个 "XX大学宿舍" 误判）
 *   - scenic / food_street / commercial：单个 POI 本身就是地标，1 个也够
 */
export function isBrandClusterEligible(cluster: BrandCluster) {
  if (cluster.type === 'campus') return cluster.count >= 2
  return cluster.count >= 1
}

export function resolveBrandRole(type: BrandType): string {
  if (type === 'campus') return 'campus_anchor'
  if (type === 'scenic') return 'scenic_landmark'
  if (type === 'food_street') return 'food_street_anchor'
  if (type === 'commercial') return 'commercial_anchor'
  return 'district_anchor'
}

export function resolveBrandCategoryLabel(type: BrandType): string {
  if (type === 'campus') return '高校'
  if (type === 'scenic') return '景区/公园'
  if (type === 'food_street') return '小吃/美食街'
  if (type === 'commercial') return '商业街区'
  return '区域实体'
}
