/**
 * 本地实验脚本：
 * Tavily + Crawl4AI + LTP NER + 场景画像过滤 + DB 验证
 *
 * 约束：
 * 1. 默认每轮只跑两个问题，避免过度消耗 Tavily 配额。
 * 2. 仅用于本地脚本实验，不接入主系统联网搜索链路。
 *
 * 用法：
 *   node backend/scripts/test_full_pipeline.mjs
 *   node backend/scripts/test_full_pipeline.mjs --ids=2,3
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSearchQueries,
  inferQuerySceneProfile,
  isAcceptableDbRow,
  isNoiseEntity as isProfileNoiseEntity,
  scoreSearchResult,
  scoreVenueCandidate,
} from './lib/query_scene_profile.mjs';

dotenv.config({ path: resolve(process.cwd(), 'backend', '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const { Pool } = pg;
const MAX_QUESTIONS_PER_RUN = 2;
const QUALITY_SITE_CONFIG_PATH = resolve(process.cwd(), 'backend', 'websearch_config', 'whan_quality_sites.json');

const TEST_QUESTIONS = [
  { id: 1, query: '武昌这块有哪些推荐的景点？', districts: ['武昌区'] },
  { id: 2, query: '汉口美食推荐', districts: ['江汉区', '江岸区', '硚口区'] },
  { id: 3, query: '武昌和汉口有哪些适合散步的公园？', districts: ['武昌区', '江汉区', '江岸区'] },
];

const ADMIN_REGION_NAMES = new Set([
  '武汉市', '武昌区', '江汉区', '江岸区', '硚口区', '洪山区', '汉阳区',
  '青山区', '东西湖区', '蔡甸区', '江夏区', '黄陂区', '新洲区', '经开区',
  '武汉', '湖北', '湖北省', '汉口', '武昌', '汉阳', '光谷',
  '上海', '北京', '深圳', '广州', '张家口', '成都', '重庆', '南京',
]);

const DISTRICT_ALIAS_MAP = {
  武昌区: ['武昌'],
  江汉区: ['江汉', '汉口'],
  江岸区: ['江岸', '汉口'],
  硚口区: ['硚口', '汉口'],
  汉阳区: ['汉阳'],
  洪山区: ['洪山', '光谷'],
  青山区: ['青山'],
  东西湖区: ['东西湖', '金银湖'],
  蔡甸区: ['蔡甸'],
  江夏区: ['江夏'],
  黄陂区: ['黄陂'],
  新洲区: ['新洲'],
};

const EXTRA_NOISE_PATTERNS = [
  /队太长/u,
  /价格太高/u,
  /品牌店$/u,
  /快时尚/u,
  /有限公司$/u,
  /社区服务$/u,
  /经营部$/u,
  /投递部$/u,
  /代理$/u,
  /充电$/u,
  /停车场$/u,
  /洗手间$/u,
  /卫生间$/u,
  /母婴室$/u,
  /快递$/u,
  /物流$/u,
  /仓储$/u,
];

const CANDIDATE_CHAR_NORMALIZATION = new Map([
  ['徳', '德'],
  ['鬥', '斗'],
  ['級', '级'],
  ['營', '营'],
  ['書', '书'],
  ['會', '会'],
  ['員', '员'],
  ['區', '区'],
  ['門', '门'],
  ['漢', '汉'],
  ['馬', '马'],
  ['樓', '楼'],
  ['廣', '广'],
  ['風', '风'],
  ['東', '东'],
  ['國', '国'],
]);

const GENERIC_VENUE_DESCRIPTOR_PATTERN = /^(老字号|特色|热门|高分|人气|本地|传统|推荐|精选|宝藏|经典|必吃|适合散步的|适合游玩的|国家级的|休闲的|值得一去的|适合赏樱的)(?:景点|景区|公园|绿道|江滩|湿地公园|植物园|森林公园|步道|广场|餐厅|饭店|面馆|酒楼|食府|火锅店|牛排馆|小吃店|鸭脖店|酒店|宾馆|民宿|客栈|旅馆|公寓)$/u;
const CANDIDATE_CONTEXT_PREFIX_PATTERNS = [
  /^(在|于|位于|坐落于|除了|还有|以及|其中|例如|比如|像|包括|包含)/u,
  /^(适合(?:独自)?(?:散步|徒步|骑行|游玩|赏樱)的|非常适合(?:散步|游玩)的)/u,
  /^(人气超旺的|国家级的|值得一去的|值得打卡的|休闲的|串联景区公园的|设计为|用于)/u,
  /^(这堪称[^的]{0,8}的|中午或晚上在一些特殊的)/u,
];
const CANDIDATE_CONNECTOR_SPLIT_PATTERN = /(?:、|，|,|；|;|\/|以及|还有|或者|位于|坐落于|例如|比如|包括|包含|其中|并且|同时|加上|搭配)/u;
const NOISY_CONNECTIVE_PATTERN = /(以及|还有|或者|位于|坐落于|例如|比如|包括|包含|其中|并且|同时)/u;

const DEFAULT_QUALITY_SITE_CONFIG = {
  global_domains: [
    'wuhan.gov.cn',
    'visitwuhan.com',
    'ctrip.com',
    'you.ctrip.com',
    'mafengwo.cn',
    'qyer.com',
    'dianping.com',
    'meituan.com',
    'qunar.com',
    'tuniu.com',
    'xiaohongshu.com',
    'douyin.com',
    'zhihu.com',
    'sohu.com',
    'qq.com',
  ],
  scene_domains: {
    food: ['dianping.com', 'meituan.com', 'xiaohongshu.com', 'douyin.com', 'zhihu.com', 'sohu.com'],
    hotel: ['ctrip.com', 'you.ctrip.com', 'qunar.com', 'meituan.com', 'tuniu.com', 'zhihu.com'],
    scenic: ['visitwuhan.com', 'wuhan.gov.cn', 'you.ctrip.com', 'ctrip.com', 'mafengwo.cn', 'qyer.com', 'zhihu.com', 'sohu.com'],
    park: ['wuhan.gov.cn', 'visitwuhan.com', 'you.ctrip.com', 'ctrip.com', 'qq.com', 'zhihu.com', 'sohu.com'],
    metro_station: ['wuhan.gov.cn', 'qq.com', 'zhihu.com'],
  },
};

function resolveTavilyApiKey() {
  const candidates = [
    process.env.TAVILY_API_KEY1,
    process.env.TAVILY_KEY1,
    process.env.TAVILY_API_KEY_1,
    process.env.TAVILY_API_KEY,
    process.env.TAVILY_KEY,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  return candidates[0] || '';
}

const CONFIG = {
  tavilyApiKey: resolveTavilyApiKey(),
  tavilyTimeoutMs: Math.max(5000, Number(process.env.TAVILY_TIMEOUT_MS || '12000')),
  crawl4aiUrl: 'http://localhost:11235/crawl',
  nerUrl: 'http://localhost:5100/extract',
};

const LLM_CONFIG = {
  baseUrl: String(process.env.LLM_BASE_URL || '').trim(),
  apiKey: String(process.env.LLM_API_KEY || '').trim(),
  model: String(process.env.LLM_MODEL || '').trim(),
  timeoutMs: Math.max(5000, Number(process.env.LLM_TIMEOUT_MS || '12000')),
  judgeTimeoutMs: Math.max(
    10000,
    Number(
      process.env.LLM_ANALYSIS_TIMEOUT_MS
      || process.env.LLM_SYNTHESIS_TIMEOUT_MS
      || process.env.LLM_TIMEOUT_MS
      || '30000',
    ),
  ),
};

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  )];
}

function loadQualitySiteConfig() {
  if (!existsSync(QUALITY_SITE_CONFIG_PATH)) {
    return DEFAULT_QUALITY_SITE_CONFIG;
  }

  try {
    const parsed = JSON.parse(readFileSync(QUALITY_SITE_CONFIG_PATH, 'utf-8'));
    return {
      global_domains: uniqueStrings(parsed?.global_domains || DEFAULT_QUALITY_SITE_CONFIG.global_domains),
      scene_domains: {
        ...DEFAULT_QUALITY_SITE_CONFIG.scene_domains,
        ...Object.fromEntries(
          Object.entries(parsed?.scene_domains || {}).map(([key, value]) => [key, uniqueStrings(value)]),
        ),
      },
    };
  } catch (error) {
    console.warn(`[配置] 白名单文件解析失败，回退默认域名列表: ${error.message}`);
    return DEFAULT_QUALITY_SITE_CONFIG;
  }
}

const QUALITY_SITE_CONFIG = loadQualitySiteConfig();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || '127.0.0.1',
  port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '123456',
  database: process.env.POSTGRES_DATABASE || 'geoloom',
});

function parseRequestedQuestionIds() {
  const rawArg = process.argv.find((arg) => arg.startsWith('--ids=')) || '';
  const rawIds = (rawArg.split('=')[1] || process.env.TEST_QUESTION_IDS || '1,2').trim();
  const ids = [...new Set(
    rawIds
      .split(',')
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((item) => Number.isInteger(item)),
  )];

  if (ids.length === 0) {
    return [1, 2];
  }

  if (ids.length > MAX_QUESTIONS_PER_RUN) {
    throw new Error(`单次最多测试 ${MAX_QUESTIONS_PER_RUN} 个问题，请缩减 --ids 参数。`);
  }

  return ids;
}

function isNoiseEntity(name) {
  const normalizedName = normalizeCandidateName(name);
  if (!normalizedName || normalizedName.length < 2) return true;
  if (ADMIN_REGION_NAMES.has(normalizedName)) return true;
  if (EXTRA_NOISE_PATTERNS.some((pattern) => pattern.test(normalizedName))) return true;
  if (/\d{3,}/.test(normalizedName)) return true;
  if (GENERIC_VENUE_DESCRIPTOR_PATTERN.test(normalizedName)) return true;
  if (NOISY_CONNECTIVE_PATTERN.test(normalizedName) && normalizedName.length > 10) return true;
  return isProfileNoiseEntity(normalizedName);
}

function normalizeCandidateName(name) {
  let normalized = String(name || '').trim();
  for (const [source, target] of CANDIDATE_CHAR_NORMALIZATION.entries()) {
    normalized = normalized.split(source).join(target);
  }
  return normalized.replace(/\s+/g, '');
}

function rankVenueCandidates(rawVenues, profile, minimumScore = 1) {
  const venueMap = new Map();

  for (const venue of rawVenues) {
    const name = normalizeCandidateName(venue?.name || '');
    const label = String(venue?.label || '').trim();

    if (!name || isNoiseEntity(name)) continue;
    if (isGenericVenuePhrase(name, profile)) continue;
    if (profile.key === 'food' && /(科技馆|博物馆|纪念馆|公园|江滩|绿道|步行街)/u.test(name)) continue;
    if (profile.key === 'food' && label === 'SHOP' && /(店|总店)$/u.test(name) && !/[锅馆面饭粉包烧麦酒楼餐厅食府火锅小吃鸭脖鱼虾鸡]/u.test(name)) continue;

    const score = scoreVenueCandidate(name, label, profile);
    if (score < minimumScore) continue;

    const existing = venueMap.get(name);
    if (!existing) {
      venueMap.set(name, {
        name,
        label,
        count: 1,
        score,
        snippet: String(venue?.snippet || '').trim(),
      });
      continue;
    }

    existing.count += 1;
    existing.score = Math.max(existing.score, score) + 1;
  }

  return [...venueMap.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.count !== left.count) return right.count - left.count;
    return String(right.name || '').length - String(left.name || '').length;
  });
}

function buildRegexPatterns(profile) {
  if (profile.key === 'food') {
    return [
      /([\u4e00-\u9fffA-Za-z]{2,18}(?:餐厅|饭店|面馆|酒楼|食府|火锅店|烧麦馆|牛排馆|小吃店|甜品店|奶茶店|鸭脖店))/gu,
    ];
  }

  if (profile.key === 'scenic') {
    return [
      /([\u4e00-\u9fffA-Za-z]{2,18}(?:景区|景点|公园|博物馆|纪念馆|故居|古迹|寺|庙|塔|楼|步行街|江滩))/gu,
    ];
  }

  if (profile.key === 'park') {
    return [
      /([\u4e00-\u9fffA-Za-z]{2,20}(?:公园|绿道|江滩|湿地公园|植物园|森林公园|步道|广场))/gu,
    ];
  }

  if (profile.key === 'hotel') {
    return [
      /([\u4e00-\u9fffA-Za-z]{2,18}(?:酒店|宾馆|民宿|客栈|旅馆|公寓))/gu,
    ];
  }

  return [];
}

function stripCandidateContext(text) {
  let normalized = String(text || '').trim();
  let previous = '';

  while (normalized && normalized !== previous) {
    previous = normalized;
    for (const pattern of CANDIDATE_CONTEXT_PREFIX_PATTERNS) {
      normalized = normalized.replace(pattern, '').trim();
    }

    normalized = normalized
      .replace(/^[、，,；;和与及或或者]+/u, '')
      .replace(/(?:之一|一带|附近|周边|路线|线路)$/u, '')
      .trim();
  }

  return normalized;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getAtomicVenueSuffixes(profile) {
  if (profile.key === 'food') {
    return ['牛排馆', '火锅店', '小吃店', '甜品店', '奶茶店', '鸭脖店', '餐厅', '饭店', '面馆', '酒楼', '食府'];
  }

  if (profile.key === 'scenic') {
    return ['湿地公园', '森林公园', '植物园', '博物馆', '纪念馆', '步行街', '景区', '景点', '故居', '古迹', '江滩', '公园', '寺', '庙', '塔', '楼'];
  }

  if (profile.key === 'park') {
    return ['湿地公园', '森林公园', '植物园', '公园', '绿道', '江滩', '步道', '广场'];
  }

  if (profile.key === 'hotel') {
    return ['度假村', '酒店', '宾馆', '民宿', '客栈', '旅馆', '公寓'];
  }

  if (profile.key === 'metro_station') {
    return ['换乘站', '地铁站', '站口', '车站'];
  }

  return [];
}

function buildAtomicVenuePattern(profile) {
  const suffixes = getAtomicVenueSuffixes(profile)
    .sort((left, right) => right.length - left.length)
    .map((item) => escapeRegex(item));

  if (suffixes.length === 0) return null;
  return new RegExp(`([\\u4e00-\\u9fffA-Za-z0-9·-]{2,24}(?:${suffixes.join('|')}))`, 'gu');
}

function isGenericVenuePhrase(name, profile = null) {
  const normalized = normalizeCandidateName(name);
  if (!normalized) return true;
  if (GENERIC_VENUE_DESCRIPTOR_PATTERN.test(normalized)) return true;
  if (/(?:的|是|对|以及|还有|或者|位于|坐落于|包括|包含|例如|比如|其中|行业|评选|颁奖|授牌)/u.test(normalized)) return true;
  if (/^(?:景点|景区|公园|绿道|江滩|湿地公园|植物园|森林公园|步道|广场|餐厅|饭店|面馆|酒楼|食府|火锅店|牛排馆|小吃店|鸭脖店|酒店|宾馆|民宿|客栈|旅馆|公寓)$/u.test(normalized)) {
    return true;
  }

  if (profile) {
    const suffix = getAtomicVenueSuffixes(profile).find((item) => normalized.endsWith(item));
    if (suffix) {
      const core = normalized.slice(0, -suffix.length);
      if (!core || core.length < 2) return true;
      if (/^(?:家|户|个)[\u4e00-\u9fff]{0,3}$/u.test(core)) return true;
      if (/^(?:武汉|汉口|武昌|江城|老街区)(?:高端|热门|人气|名点|优秀|推荐|旅行|美食|小吃|地道)$/u.test(core)) return true;
      if (/(?:高端|热门|人气|优秀|名点|旅行|老街区)$/u.test(core) && /^(?:武汉|汉口|武昌|江城)/u.test(core)) return true;
    }
  }

  return false;
}

function splitRegexCandidate(name, profile) {
  const normalized = stripCandidateContext(normalizeCandidateName(name));
  const pieces = new Set();
  const atomicPattern = buildAtomicVenuePattern(profile);

  const pushPiece = (value) => {
    const cleaned = stripCandidateContext(normalizeCandidateName(value));
    if (!cleaned) return;
    if (!isGenericVenuePhrase(cleaned, profile)) {
      pieces.add(cleaned);
    }

    if (atomicPattern) {
      for (const match of cleaned.matchAll(atomicPattern)) {
        const atomic = stripCandidateContext(normalizeCandidateName(match[1] || ''));
        if (!atomic || isGenericVenuePhrase(atomic, profile)) continue;
        pieces.add(atomic);
      }
    }
  };

  pushPiece(normalized);

  for (const segment of normalized.split(CANDIDATE_CONNECTOR_SPLIT_PATTERN)) {
    pushPiece(segment);
  }

  return [...pieces].filter(Boolean);
}

function extractRegexCandidates(contents, profile) {
  const patterns = buildRegexPatterns(profile);
  if (patterns.length === 0) return [];

  const candidates = [];
  for (const contentItem of contents) {
    const text = String(contentItem?.content || '');
    if (!text) continue;

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          const splitCandidates = splitRegexCandidate(match[1] || '', profile);
          for (const name of splitCandidates) {
            if (!name || isNoiseEntity(name)) continue;
            candidates.push({
            name,
            label: 'regex',
            snippet: name,
          });
        }
      }
    }
  }

  return candidates;
}

function enrichContentsWithSearchMetadata(searchResults, contents) {
  const resultByUrl = new Map(
    searchResults
      .filter((item) => item.url)
      .map((item) => [item.url, item]),
  );

  return contents.map((item) => {
    const searchMeta = resultByUrl.get(item.url) || searchResults.find((candidate) => candidate.title === item.title);
    if (!searchMeta) return item;

    const enrichedContent = [
      searchMeta.title,
      searchMeta.snippet,
      item.content,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      ...item,
      title: searchMeta.title || item.title,
      content: enrichedContent,
    };
    });
}

function resolveAllowedDomains(profile) {
  const sceneDomains = QUALITY_SITE_CONFIG.scene_domains?.[profile.key] || [];
  return uniqueStrings([
    ...sceneDomains,
    ...(QUALITY_SITE_CONFIG.global_domains || []),
    ...(profile.preferredDomains || []),
  ]).slice(0, 40);
}

function buildAllowedAreaAliases(districts = []) {
  const aliases = new Set();
  for (const district of districts) {
    const normalizedDistrict = normalizeCandidateName(district);
    if (!normalizedDistrict) continue;
    aliases.add(normalizedDistrict);
    aliases.add(normalizedDistrict.replace(/区$/u, ''));
    for (const alias of DISTRICT_ALIAS_MAP[district] || []) {
      aliases.add(normalizeCandidateName(alias));
    }
  }
  return aliases;
}

function mentionsOutOfScopeArea(name, districts = []) {
  if (!districts.length) return false;

  const normalized = normalizeCandidateName(name);
  if (!normalized) return false;

  const allowedAliases = buildAllowedAreaAliases(districts);
  const allAliases = Object.entries(DISTRICT_ALIAS_MAP)
    .flatMap(([district, aliases]) => [district, ...aliases])
    .map((item) => normalizeCandidateName(item));

  const mentionedAliases = [...new Set(allAliases.filter((alias) => alias && normalized.includes(alias)))];
  if (mentionedAliases.length === 0) return false;

  return mentionedAliases.some((alias) => !allowedAliases.has(alias));
}

async function runTavilyQuery(query, includeDomains = []) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.tavilyTimeoutMs);

  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: CONFIG.tavilyApiKey,
          query,
          search_depth: 'basic',
          max_results: 8,
          include_answer: false,
          include_raw_content: false,
          include_domains: includeDomains,
        }),
        signal: controller.signal,
      });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return (data.results || []).map((item) => ({
      title: String(item.title || '').trim(),
      snippet: String(item.content || '').trim(),
      url: String(item.url || '').trim(),
    }));
  } finally {
    clearTimeout(timeout);
  }
}

async function searchTavily(query, profile) {
  if (!CONFIG.tavilyApiKey) {
    throw new Error('未找到 Tavily API key，请检查 .env。');
  }

  const allowedDomains = resolveAllowedDomains(profile);
  const uniqueByUrl = new Map();
  const variants = [...buildSearchQueries(query, profile)].sort((left, right) => left.length - right.length);

  for (const variant of variants) {
    const results = await runTavilyQuery(variant, allowedDomains);
    for (const result of results) {
      if (!result.url || uniqueByUrl.has(result.url)) continue;
      uniqueByUrl.set(result.url, { ...result, variant });
    }

    if (uniqueByUrl.size >= 8 || results.length >= 6) {
      break;
    }
  }

  return [...uniqueByUrl.values()]
    .map((result) => ({
      ...result,
      score: scoreSearchResult(result, profile),
      allowedDomains,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
}

async function fetchContents(searchResults, timeoutMs = 15000) {
  const urls = searchResults.map((item) => item.url).filter(Boolean);
  if (urls.length === 0) return [];

  try {
    const submitResp = await fetch(CONFIG.crawl4aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, priority: 10, bypass_cache: false }),
    });

    if (!submitResp.ok) {
      console.error(`  Crawl4AI 提交失败: ${submitResp.status}`);
      return [];
    }

    const submitData = await submitResp.json();

    if (Array.isArray(submitData.results) && submitData.results.length > 0) {
      return submitData.results
        .map((result, index) => {
          const content = String(result?.markdown?.raw_markdown || result?.cleaned_html || result?.html || '');
          return {
            title: searchResults[index]?.title || 'Page',
            url: searchResults[index]?.url || '',
            content: content.slice(0, 6000),
          };
        })
        .filter((item) => item.content.length > 80);
    }

    const taskId = submitData.task_id;
    if (!taskId) return [];

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
      const taskResp = await fetch(`http://localhost:11235/task/${taskId}`);
      if (!taskResp.ok) continue;

      const taskData = await taskResp.json();
      if (taskData.status === 'failed') return [];
      if (taskData.status !== 'completed') continue;

      return (taskData.results || [])
        .map((result, index) => {
          const content = String(result?.markdown?.raw_markdown || result?.cleaned_html || result?.html || '');
          return {
            title: searchResults[index]?.title || 'Page',
            url: searchResults[index]?.url || '',
            content: content.slice(0, 6000),
          };
        })
        .filter((item) => item.content.length > 80);
    }

    return [];
  } catch (error) {
    console.error(`  Crawl4AI 抓取失败: ${error.message}`);
    return [];
  }
}

async function extractVenuesWithNER(contents, query) {
  try {
    const resp = await fetch(CONFIG.nerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents.map((item) => ({ title: item.title || '', content: item.content || '' })),
        query,
      }),
    });

    if (!resp.ok) {
      console.error(`  [NER] HTTP 错误: ${resp.status}`);
      return { venues: [], elapsedMs: 0 };
    }

    const result = await resp.json();
    return {
      venues: result.venues || [],
      elapsedMs: result.elapsed_ms || 0,
    };
  } catch (error) {
    console.error(`  [NER] 调用失败: ${error.message}`);
    return { venues: [], elapsedMs: 0 };
  }
}

async function queryDbByCandidate(candidateName, profile, districts, useCategoryFilter) {
  const params = [
    candidateName,
    `${candidateName}%`,
    `%${candidateName}%`,
  ];

  let sql = `
    SELECT name, category_main, category_sub, city, longitude, latitude
    FROM pois
    WHERE (name = $1 OR name ILIKE $2 OR name ILIKE $3)
  `;

  if (useCategoryFilter && profile.dbCategoryMains.length > 0) {
    params.push(profile.dbCategoryMains);
    sql += ` AND category_main = ANY($4::text[])`;
  }

  sql += `
    ORDER BY
      CASE WHEN name = $1 THEN 0 WHEN name ILIKE $2 THEN 1 ELSE 2 END,
      name
    LIMIT 10
  `;

  const result = await pool.query(sql, params);
  const rows = result.rows
    .filter((row) => isAcceptableDbRow(candidateName, row.name, profile))
    .sort((left, right) => {
      const leftMatch = left.name === candidateName ? 0 : left.name.startsWith(candidateName) ? 1 : 2;
      const rightMatch = right.name === candidateName ? 0 : right.name.startsWith(candidateName) ? 1 : 2;
      if (leftMatch !== rightMatch) return leftMatch - rightMatch;

      const leftDistrict = districts.some((district) => String(left.city || '').includes(district)) ? 0 : 1;
      const rightDistrict = districts.some((district) => String(right.city || '').includes(district)) ? 0 : 1;
      if (leftDistrict !== rightDistrict) return leftDistrict - rightDistrict;

      return String(left.name || '').length - String(right.name || '').length;
    });

  return rows;
}

async function matchPOIInDB(candidateName, profile, districts) {
  try {
    const filteredRows = await queryDbByCandidate(candidateName, profile, districts, true);
    if (filteredRows.length > 0) return filteredRows;
    return await queryDbByCandidate(candidateName, profile, districts, false);
  } catch {
    return [];
  }
}

function llmJudgeReady() {
  return Boolean(LLM_CONFIG.baseUrl && LLM_CONFIG.apiKey && LLM_CONFIG.model);
}

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const candidates = [
    raw,
    raw.replace(/^```json/u, '').replace(/^```/u, '').replace(/```$/u, '').trim(),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  const objectMatch = raw.match(/\{[\s\S]*\}/u);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeChatContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return String(item.text || item.content || '').trim();
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return String(content || '').trim();
}

function parseJudgeResponseText(rawText) {
  const raw = String(rawText || '').trim();
  const directPayload = tryParseJson(raw);
  let completionPayload = directPayload;

  if (!completionPayload) {
    const ssePayloads = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s*/u, ''))
      .filter((line) => line && line !== '[DONE]')
      .map((line) => tryParseJson(line))
      .filter(Boolean);

    completionPayload = ssePayloads[ssePayloads.length - 1] || null;
  }

  const completionContent = normalizeChatContent(
    completionPayload?.choices?.[0]?.message?.content
    || completionPayload?.choices?.[0]?.delta?.content
    || completionPayload?.message?.content
    || completionPayload?.output_text
    || '',
  );

  return {
    completionPayload,
    completionContent,
    parsedJudge: tryParseJson(completionContent)
      || (completionPayload && !completionPayload.choices ? completionPayload : null),
  };
}

function countDbHits(result) {
  return (result?.topVenues || []).filter((item) => item.poiName).length;
}

function compareAttemptQuality(leftResult, leftJudge, rightResult, rightJudge) {
  const leftMetrics = [
    Number(leftJudge?.passRate || 0),
    Array.isArray(leftJudge?.qualifiedNames) ? leftJudge.qualifiedNames.length : 0,
    countDbHits(leftResult),
    (leftResult?.topVenues || []).length,
  ];
  const rightMetrics = [
    Number(rightJudge?.passRate || 0),
    Array.isArray(rightJudge?.qualifiedNames) ? rightJudge.qualifiedNames.length : 0,
    countDbHits(rightResult),
    (rightResult?.topVenues || []).length,
  ];

  for (let index = 0; index < leftMetrics.length; index += 1) {
    if (leftMetrics[index] !== rightMetrics[index]) {
      return leftMetrics[index] - rightMetrics[index];
    }
  }

  return 0;
}

async function judgeGoalFit(query, profile, topVenues) {
  if (topVenues.length === 0) {
    return {
      ready: llmJudgeReady(),
      passRate: 0,
      verdict: 'retry',
      retryQuery: `${query} ${profile.searchTokens.slice(0, 2).join(' ')}`.trim(),
      qualifiedNames: [],
      reasons: ['empty_candidates'],
    };
  }

  if (!llmJudgeReady()) {
    return {
      ready: false,
      passRate: 0,
      verdict: 'retry',
      retryQuery: `${query} ${profile.searchTokens.slice(0, 2).join(' ')}`.trim(),
      qualifiedNames: [],
      reasons: ['llm_not_ready'],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_CONFIG.judgeTimeoutMs);

  const compactCandidates = topVenues.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    ner_name: item.nerName,
    poi_name: item.poiName,
    poi_category: item.poiCategory,
    poi_city: item.poiCity,
    match_type: item.matchType,
    candidate_score: item.candidateScore,
  }));

  const systemPrompt = [
    '你是一个严格但实用的地理推荐结果质检器。',
    '任务：判断候选 JSON 是否满足用户目标。',
    '允许混入 1-2 个噪音，但总体达标率必须 >= 0.90 才算通过。',
    '只返回 JSON，不要输出任何解释性前后缀。',
  ].join('\n');

  const userPrompt = [
    `用户问题: ${query}`,
    `目标类型: ${profile.label}`,
    `场景标签: ${profile.matchedScenes.join(', ') || '无'}`,
    '候选列表(JSON):',
    JSON.stringify(compactCandidates, null, 2),
    '请返回 JSON，结构如下：',
    '{"qualified_names":["..."],"pass_rate":0.0,"verdict":"pass|retry","retry_query":"...","reasons":["..."]}',
    '判定标准：',
    '1. qualified_names 里只保留真正符合用户目标的地点。',
    '2. pass_rate = 合格候选数 / 候选总数。',
    '3. verdict 仅当 pass_rate >= 0.90 时为 pass，否则为 retry。',
    '4. retry_query 必须给出一个更利于下一轮搜索的中文短查询。',
  ].join('\n');

  try {
    const response = await fetch(`${LLM_CONFIG.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: LLM_CONFIG.model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`judge_http_${response.status}`);
    }

    const responseText = await response.text();
    const { completionContent, parsedJudge } = parseJudgeResponseText(responseText);
    const parsed = parsedJudge || {};

    const qualifiedNames = Array.isArray(parsed.qualified_names)
      ? parsed.qualified_names.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const passRate = Math.max(
      0,
      Math.min(
        1,
        Number(parsed.pass_rate)
        || (qualifiedNames.length > 0 ? qualifiedNames.length / compactCandidates.length : 0),
      ),
    );
    const verdict = String(parsed.verdict || (passRate >= 0.9 ? 'pass' : 'retry')).trim().toLowerCase() === 'pass'
      ? 'pass'
      : 'retry';
    const retryQuery = String(parsed.retry_query || `${query} ${profile.searchTokens.slice(0, 2).join(' ')}`).trim();
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const rawExcerpt = completionContent
      ? completionContent.replace(/\s+/g, ' ').slice(0, 220)
      : String(responseText || '').replace(/\s+/g, ' ').slice(0, 220);

    return {
      ready: true,
      passRate,
      verdict,
      retryQuery,
      qualifiedNames,
      reasons,
      rawExcerpt,
    };
  } catch (error) {
    return {
      ready: true,
      passRate: 0,
      verdict: 'retry',
      retryQuery: `${query} ${profile.searchTokens.slice(0, 2).join(' ')}`.trim(),
      qualifiedNames: [],
      reasons: [String(error?.message || error || 'judge_failed')],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeQuestionPipeline(question, queryOverride = null, attempt = 1) {
  const effectiveQuery = String(queryOverride || question.query).trim();
  const profile = inferQuerySceneProfile(effectiveQuery);
  const timings = {};
  const totalStart = Date.now();

  console.log(`\n📌 Q${question.id}${attempt > 1 ? ` (retry ${attempt})` : ''}: "${effectiveQuery}"`);
  console.log(`  场景画像: ${profile.label} | 场景标签: ${profile.matchedScenes.join(', ') || '无'} | DB主类: ${profile.dbCategoryMains.join(', ')}`);
  console.log('────────────────────────────────────────────────────────────────────────────────');

  const searchStart = Date.now();
  const searchResults = await searchTavily(effectiveQuery, profile);
  timings.search = Date.now() - searchStart;
  const allowedDomains = searchResults[0]?.allowedDomains || resolveAllowedDomains(profile);

  console.log(`  [1.搜索] Tavily ${searchResults.length} 条，耗时 ${timings.search}ms，白名单域名 ${allowedDomains.length} 个`);
  console.log(`    白名单: ${allowedDomains.slice(0, 12).join(', ')}${allowedDomains.length > 12 ? ' ...' : ''}`);
  for (const result of searchResults.slice(0, 5)) {
    console.log(`    • [${result.score}] ${result.title.slice(0, 56)}  →  ${result.url.slice(0, 88)}`);
  }

  if (searchResults.length === 0) {
    timings.fetch = 0;
    timings.ner = 0;
    timings.filter = 0;
    timings.dbMatch = 0;
    timings.total = Date.now() - totalStart;
    console.log('  ❌ 无搜索结果，跳过');
    return { id: question.id, query: question.query, effectiveQuery, profile, timings, topVenues: [] };
  }

  const fetchStart = Date.now();
  let contents = await fetchContents(searchResults);
  timings.fetch = Date.now() - fetchStart;
  console.log(`  [2.抓取] Crawl4AI 成功 ${contents.length}/${searchResults.length} 篇，耗时 ${timings.fetch}ms`);
  contents = enrichContentsWithSearchMetadata(searchResults, contents);

  const snippetDocs = searchResults
    .filter((item) => item.title || item.snippet)
    .map((item) => ({
      title: item.title || 'SearchSnippet',
      url: item.url || '',
      content: [item.title, item.snippet].filter(Boolean).join('\n'),
    }))
    .filter((item) => item.content.length > 20);

  const mergedContents = [...contents];
  let appendedSnippetCount = 0;
  for (const snippetDoc of snippetDocs) {
    const exists = mergedContents.some((item) =>
      item.title === snippetDoc.title
      || (item.url && snippetDoc.url && item.url === snippetDoc.url),
    );
    if (!exists) {
      mergedContents.push(snippetDoc);
      appendedSnippetCount += 1;
    }
  }
  contents = mergedContents;
  console.log(`  [2.补充] 追加 ${appendedSnippetCount} 条标题/摘要证据，NER输入共 ${contents.length} 篇`);

  if (contents.length === 0) {
    contents = searchResults
      .filter((item) => item.snippet && item.snippet.length > 20)
      .map((item) => ({
        title: item.title,
        url: item.url,
        content: item.snippet,
      }));
    console.log(`  [2.备用] 使用 ${contents.length} 条搜索摘要作为 NER 输入`);
  }

  if (contents.length === 0) {
    timings.ner = 0;
    timings.filter = 0;
    timings.dbMatch = 0;
    timings.total = Date.now() - totalStart;
    console.log('  ❌ 无可用正文/摘要，跳过');
    return { id: question.id, query: question.query, effectiveQuery, profile, timings, topVenues: [] };
  }

  const nerStart = Date.now();
  const { venues: nerVenues, elapsedMs: nerInternalMs } = await extractVenuesWithNER(contents, effectiveQuery);
  const regexVenues = extractRegexCandidates(contents, profile);
  const rawVenues = [...nerVenues, ...regexVenues];
  timings.ner = Date.now() - nerStart;
  console.log(`  [3.NER] 原始候选 ${rawVenues.length} 个，其中正则补充 ${regexVenues.length} 个；LTP内部 ${nerInternalMs}ms，总耗时 ${timings.ner}ms`);

  const candidateStart = Date.now();
  let rankedCandidates = rankVenueCandidates(rawVenues, profile, 1);
  if (rankedCandidates.length === 0 && ['scenic', 'park'].includes(profile.key)) {
    rankedCandidates = rankVenueCandidates(rawVenues, profile, -2);
    if (rankedCandidates.length > 0) {
      console.log('  [3.回退] 景点/公园场景启用宽松阈值回退');
    }
  }
  timings.filter = Date.now() - candidateStart;

  console.log(`  [3.过滤] 有效候选 ${rankedCandidates.length} 个，耗时 ${timings.filter}ms`);
  for (const candidate of rankedCandidates.slice(0, 12)) {
    console.log(`    • [score=${candidate.score}] "${candidate.name}" [${candidate.label}] ×${candidate.count}`);
  }

  const inScopeCandidates = rankedCandidates.filter((candidate) => !mentionsOutOfScopeArea(candidate.name, question.districts));
  if (inScopeCandidates.length !== rankedCandidates.length) {
    console.log(`  [3.区域过滤] 剔除 ${rankedCandidates.length - inScopeCandidates.length} 个明确越界候选`);
  }
  rankedCandidates = inScopeCandidates;

  if (rankedCandidates.length === 0) {
    timings.dbMatch = 0;
    timings.total = Date.now() - totalStart;
    console.log('  ❌ 过滤后没有留下候选');
    console.log(`  [3.诊断] 原始候选: ${(rawVenues || []).map((item) => String(item?.name || '').trim()).filter(Boolean).join('、') || '无'}`);
    return { id: question.id, query: question.query, effectiveQuery, profile, timings, topVenues: [] };
  }

  const dbStart = Date.now();
  const matched = [];
  for (const candidate of rankedCandidates.slice(0, 12)) {
    const rows = await matchPOIInDB(candidate.name, profile, question.districts);
    if (rows.length > 0) {
      const best = rows[0];
      matched.push({
        nerName: candidate.name,
        nerLabel: candidate.label,
        nerCount: candidate.count,
        candidateScore: candidate.score,
        poiName: best.name,
        poiCategory: `${best.category_main || ''}/${best.category_sub || ''}`,
        poiCity: best.city || '',
        matchType: best.name === candidate.name ? '精确' : best.name.startsWith(candidate.name) ? '前缀' : '包含',
      });
    } else {
      matched.push({
        nerName: candidate.name,
        nerLabel: candidate.label,
        nerCount: candidate.count,
        candidateScore: candidate.score,
        poiName: null,
        poiCategory: null,
        poiCity: null,
        matchType: '仅网络证据',
      });
    }
  }
  timings.dbMatch = Date.now() - dbStart;
  timings.total = Date.now() - totalStart;

  matched.sort((left, right) => {
    const leftHit = left.poiName ? 1 : 0;
    const rightHit = right.poiName ? 1 : 0;
    if (leftHit !== rightHit) return rightHit - leftHit;

    const matchOrder = { 精确: 0, 前缀: 1, 包含: 2, 仅网络证据: 3 };
    if (matchOrder[left.matchType] !== matchOrder[right.matchType]) {
      return matchOrder[left.matchType] - matchOrder[right.matchType];
    }

    if (right.candidateScore !== left.candidateScore) {
      return right.candidateScore - left.candidateScore;
    }

    return right.nerCount - left.nerCount;
  });

  const dedupedMatched = [];
  const seenMatchedKeys = new Set();
  for (const item of matched) {
    const key = normalizeCandidateName(item.poiName || item.nerName);
    if (!key || seenMatchedKeys.has(key)) continue;
    seenMatchedKeys.add(key);
    dedupedMatched.push(item);
  }

  const topVenues = dedupedMatched.slice(0, 10);

  console.log(`  [4.DB匹配] 查验 ${Math.min(rankedCandidates.length, 12)} 个候选，耗时 ${timings.dbMatch}ms`);
  console.log(`\n  ⏱️  各阶段耗时:`);
  console.log(`    搜索:    ${timings.search}ms`);
  console.log(`    抓取:    ${timings.fetch}ms`);
  console.log(`    NER:     ${timings.ner}ms (LTP内部${nerInternalMs}ms)`);
  console.log(`    过滤:    ${timings.filter}ms`);
  console.log(`    DB匹配:  ${timings.dbMatch}ms`);
  console.log(`    总计:    ${timings.total}ms`);

  console.log(`\n  🏆 最终 Top 地名:`);
  for (let index = 0; index < topVenues.length; index += 1) {
    const item = topVenues[index];
    if (item.poiName) {
      console.log(`    ${index + 1}. "${item.nerName}" → [${item.matchType}] ${item.poiName} (${item.poiCategory}, ${item.poiCity || '—'})`);
    } else {
      console.log(`    ${index + 1}. "${item.nerName}" → [仅网络证据] score=${item.candidateScore}`);
    }
  }

  return { id: question.id, query: question.query, effectiveQuery, profile, timings, topVenues };
}

async function runTest() {
  const requestedIds = parseRequestedQuestionIds();
  const questions = TEST_QUESTIONS.filter((item) => requestedIds.includes(item.id));

  console.log('🔍 本地实验：Tavily + Crawl4AI + LTP NER + 场景画像过滤 + DB 验证 + Goal-Fit Judge');
  console.log(`本轮问题: ${questions.map((item) => `Q${item.id}`).join(', ')}`);
  console.log('================================================================================');

  const allResults = [];

  for (const question of questions) {
    let result = await executeQuestionPipeline(question, question.query, 1);
    let judge = await judgeGoalFit(result.effectiveQuery, result.profile, result.topVenues);
    let bestAttempt = 1;

    console.log(`  [5.Judge] pass_rate=${(judge.passRate * 100).toFixed(0)}% verdict=${judge.verdict}${judge.retryQuery ? ` retry_query="${judge.retryQuery}"` : ''}`);
    if (judge.rawExcerpt && (judge.passRate <= 0 || judge.verdict === 'retry')) {
      console.log(`  [5.Judge.debug] ${judge.rawExcerpt}`);
    }

    if (judge.ready && judge.verdict === 'retry' && judge.passRate < 0.9 && judge.retryQuery && judge.retryQuery !== result.effectiveQuery) {
      console.log('  [5.Judge] 达标率低于 90%，触发一次自动重试');
      const retryResult = await executeQuestionPipeline(question, judge.retryQuery, 2);
      const retryJudge = await judgeGoalFit(retryResult.effectiveQuery, retryResult.profile, retryResult.topVenues);
      console.log(`  [5.Judge][retry] pass_rate=${(retryJudge.passRate * 100).toFixed(0)}% verdict=${retryJudge.verdict}${retryJudge.retryQuery ? ` retry_query="${retryJudge.retryQuery}"` : ''}`);
      if (retryJudge.rawExcerpt && (retryJudge.passRate <= 0 || retryJudge.verdict === 'retry')) {
        console.log(`  [5.Judge.debug][retry] ${retryJudge.rawExcerpt}`);
      }

      if (compareAttemptQuality(retryResult, retryJudge, result, judge) >= 0) {
        result = retryResult;
        judge = retryJudge;
        bestAttempt = 2;
        console.log('  [5.Judge] 采用 retry 结果作为最终结果');
      } else {
        console.log('  [5.Judge] retry 未优于首次结果，保留首次结果');
      }
    }

    result.judge = judge;
    result.bestAttempt = bestAttempt;
    allResults.push(result);
  }

  console.log('\n================================================================================');
  console.log('📊 本轮汇总');
  console.log('================================================================================');

  for (const result of allResults) {
    const dbHitCount = result.topVenues.filter((item) => item.poiName).length;
    console.log(`\n  Q${result.id}: "${result.query}"`);
    console.log(`    采用轮次: attempt ${result.bestAttempt || 1}`);
    console.log(`    DB命中: ${dbHitCount}/${result.topVenues.length}`);
    console.log(`    Goal-Fit: ${(Number(result.judge?.passRate || 0) * 100).toFixed(0)}% (${result.judge?.verdict || 'n/a'})`);
    console.log(`    耗时: 搜索${result.timings.search}ms + 抓取${result.timings.fetch}ms + NER${result.timings.ner}ms + 过滤${result.timings.filter}ms + DB${result.timings.dbMatch}ms = 总${result.timings.total}ms`);
    console.log(`    Top5: ${result.topVenues.slice(0, 5).map((item) => item.nerName).join('、') || '无'}`);
  }

  const avgTotal = allResults.length > 0
    ? allResults.reduce((sum, item) => sum + (item.timings.total || 0), 0) / allResults.length
    : 0;
  console.log(`\n  平均总耗时: ${avgTotal.toFixed(0)}ms`);
}

runTest()
  .catch((error) => {
    console.error('测试运行失败:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
