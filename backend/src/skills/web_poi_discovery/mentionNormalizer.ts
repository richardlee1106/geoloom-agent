/**
 * MentionNormalizer — mention 聚合与归一化
 *
 * 职责：
 * 1. 同名异写归并（老通城豆皮/老通城酒楼 -> 老通城）
 * 2. 过滤泛词/场景词/区域词/文章小标题
 * 3. 输出去重后的 mention 列表
 */

import type { WebMention, SceneProfile } from './types.js'

/** 区域词：不应作为独立 mention */
const AREA_WORDS = new Set([
  '武汉市', '武昌区', '江汉区', '江岸区', '硚口区', '汉阳区',
  '洪山区', '青山区', '东西湖区', '蔡甸区', '江夏区', '黄陂区', '新洲区',
  '武汉', '湖北', '湖北省', '汉口', '武昌', '汉阳', '光谷',
  '上海', '北京', '深圳', '广州', '成都', '重庆', '南京',
  // 常见大学名（属于区域词，不是 POI）
  '武汉大学', '华中科技大学', '华中师范大学', '武汉理工大学',
  '中国地质大学', '中南财经政法大学', '华中农业大学', '中南民族大学',
  '江汉大学', '湖北大学', '武汉科技大学', '湖北工业大学',
])

/** 泛化噪声模式 */
const NOISE_PATTERNS = [
  /^个人中心$/u, /^创作者中心$/u, /^游戏中心$/u, /^首页$/u,
  /^登录$/u, /^注册$/u, /^会员中心$/u,
  /探店/u, /微博探店/u, /攻略$/u, /榜单$/u, /排行榜$/u,
  /教程$/u, /官网$/u, /网站$/u, /客户端$/u, /小程序$/u,
  /下载App/u, /创作者/u, /队太长/u, /价格太高/u,
  /品牌店$/u, /快时尚/u, /有限公司$/u, /社区服务$/u,
  /经营部$/u, /投递部$/u, /代理$/u, /充电$/u, /停车场$/u,
  /洗手间$/u, /卫生间$/u, /母婴室$/u, /快递$/u, /物流$/u, /仓储$/u,
  /(个人|创作者|游戏|服务|登录|注册|下载|关注|攻略|推荐|榜单|排行|官网|网站)/u,
]

/** 轻量版噪声检测（独立于旧链路 candidateExtractor） */
function isNoiseMention(name: string): boolean {
  const n = name.trim()
  if (!n || n.length < 2 || n.length > 30) return true
  if (AREA_WORDS.has(n)) return true
  if (/\d{3,}/.test(n)) return true
  if (NOISE_PATTERNS.some((p) => p.test(n))) return true
  return false
}

/** 归一化后的 mention 组 */
export interface NormalizedMentionGroup {
  /** 归一化后的主名称 */
  canonicalName: string
  /** 所有原始 mention */
  rawMentions: WebMention[]
  /** 出现次数 */
  count: number
  /** 最高置信度 */
  maxConfidence: number
  /** 所有证据片段 */
  evidenceSpans: string[]
  /** 来源 URL 集合 */
  urls: Set<string>
}

// 常见品类后缀：用于剥离品牌名后的品类词
const CATEGORY_SUFFIXES = [
  '豆皮', '热干面', '面馆', '餐厅', '饭店', '酒楼', '食府',
  '火锅店', '烧烤店', '小吃店', '甜品店', '奶茶店', '茶饮店',
  '饮品店', '咖啡馆', '咖啡店', '牛排馆', '鸭脖店',
  '酒店', '宾馆', '民宿', '客栈', '旅馆', '公寓', '度假村',
  '博物馆', '纪念馆', '步行街', '景区', '景点', '公园',
  '湿地公园', '森林公园', '植物园', '绿道', '江滩', '步道',
  '旗舰店', '总店', '分店', '老店',
]

/**
 * 尝试剥离品类后缀，得到核心名称
 * 例：老通城豆皮 -> 老通城，四季美汤包 -> 四季美
 */
function stripCategorySuffix(name: string): string {
  for (const suffix of CATEGORY_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length + 1) {
      const core = name.slice(0, -suffix.length)
      if (core.length >= 2) return core
    }
  }
  return name
}

/**
 * 计算两个名称的编辑距离相似度
 */
function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  // 一个包含另一个
  if (a.includes(b) || b.includes(a)) return 0.85

  // 前缀匹配
  const minLen = Math.min(a.length, b.length)
  let prefixMatch = 0
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) prefixMatch++
    else break
  }
  if (prefixMatch >= 2 && prefixMatch / Math.max(a.length, b.length) > 0.5) {
    return 0.75
  }

  return 0
}

/**
 * 归一化 mention 名称
 */
function normalizeMentionName(name: string): string {
  let n = name.trim()
  // 繁简转换
  const tradMap: Record<string, string> = {
    '徳': '德', '鬥': '斗', '級': '级', '營': '营',
    '書': '书', '會': '会', '員': '员', '區': '区',
    '門': '门', '漢': '汉', '馬': '马', '樓': '楼',
    '廣': '广', '風': '风', '東': '东', '國': '国',
  }
  for (const [trad, simp] of Object.entries(tradMap)) {
    n = n.split(trad).join(simp)
  }
  return n.replace(/\s+/g, '')
}

export class MentionNormalizer {
  /**
   * 归一化并聚合 mentions
   *
   * @param mentions 原始 LLM 提取结果
   * @param profile 场景画像（用于品类感知过滤）
   */
  normalize(
    mentions: WebMention[],
    profile: SceneProfile,
  ): NormalizedMentionGroup[] {
    // Step 1: 过滤无效 mention
    const validMentions = mentions.filter((m) => {
      if (m.isGeneric) return false
      const name = normalizeMentionName(m.mention)
      if (!name || name.length < 2 || name.length > 30) return false
      if (AREA_WORDS.has(name)) return false
      if (isNoiseMention(name)) return false
      return true
    })

    if (validMentions.length === 0) return []

    // Step 2: 按核心名称归并
    const groups: NormalizedMentionGroup[] = []
    const groupIndex = new Map<string, number>() // canonicalName -> index in groups

    for (const mention of validMentions) {
      const rawName = normalizeMentionName(mention.mention)
      const coreName = stripCategorySuffix(rawName)

      // 查找已有组
      let matchedGroupIdx = -1

      // 先尝试精确匹配 coreName
      if (groupIndex.has(coreName)) {
        matchedGroupIdx = groupIndex.get(coreName)!
      } else if (groupIndex.has(rawName)) {
        matchedGroupIdx = groupIndex.get(rawName)!
      } else {
        // 尝试模糊匹配已有组
        for (const [existingName, existingIdx] of groupIndex) {
          if (nameSimilarity(coreName, existingName) >= 0.75) {
            matchedGroupIdx = existingIdx
            break
          }
        }
      }

      if (matchedGroupIdx >= 0) {
        const group = groups[matchedGroupIdx]
        group.rawMentions.push(mention)
        group.count += 1
        group.maxConfidence = Math.max(group.maxConfidence, mention.confidence)
        if (mention.evidenceSpan) {
          group.evidenceSpans.push(mention.evidenceSpan)
        }
        group.urls.add(mention.url)
      } else {
        // 使用较短的名称作为 canonical（核心名更可能正确）
        const canonicalName = coreName.length >= 2 ? coreName : rawName
        const newGroup: NormalizedMentionGroup = {
          canonicalName,
          rawMentions: [mention],
          count: 1,
          maxConfidence: mention.confidence,
          evidenceSpans: mention.evidenceSpan ? [mention.evidenceSpan] : [],
          urls: new Set([mention.url]),
        }
        groupIndex.set(canonicalName, groups.length)
        // 同时注册 rawName 以加速后续匹配
        if (rawName !== canonicalName) {
          groupIndex.set(rawName, groups.length)
        }
        groups.push(newGroup)
      }
    }

    // Step 3: 按出现次数和置信度排序
    return groups.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      if (b.maxConfidence !== a.maxConfidence) return b.maxConfidence - a.maxConfidence
      return b.urls.size - a.urls.size
    })
  }
}
