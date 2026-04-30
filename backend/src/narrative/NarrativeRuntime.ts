// @ts-nocheck
import { randomUUID } from 'node:crypto';
import { buildAreaOverviewView } from '../evidence/views/AreaOverviewView.js';
import { buildRegionSnapshotFromEvidence, deriveRegionFeatureTags, summarizeRegionFeatures, } from '../evidence/areaInsight/regionSnapshot.js';
import { buildPoiProfileInputFromEvidence } from '../evidence/areaInsight/poiProfile.js';
import { createSkillExecutionContext } from '../skills/SkillContext.js';
import { createDefaultLLMProvider } from '../llm/createDefaultLLMProvider.js';
import { SSEWriter } from '../chat/SSEWriter.js';
import { createLogger } from '../utils/logger.js';
import { buildMacroRegionProfile, buildNarrativeRegionAnswer, buildNarrativeRegionClusters, buildNarrativeRegionSteps, buildNarrativeRegionStepsSkeleton, buildNarrativeRegionTransitions, buildNarrativeViewportSummary, generateMacroRegionName, normalizeName, projectNarrativeRegionsToNodes, rankNarrativeNodes, rankNarrativeRegions, resolveNarrativeRenderMode, resolveNarrativeTourStyle, resolveScaleLevelRegionLimit, resolveScaleLevelNodeLimit, resolveNodeRoleFromAoi, resolveNodeRoleFromPoi, resolveRoleLabel, resolveRoleWeight, } from './planner.js';
import { clusterPoisByBrand, extractBrandFromName, isBrandClusterEligible, resolveBrandCategoryLabel, resolveBrandRole, } from './brandAggregation.js';
import { buildNarrativeAreaTemplateSql, buildViewportBoundary, buildViewportCenter, buildViewportDiagonalM, } from './postgisTemplateBuilder.js';
import { transformGeoJsonCoordinatesWgs84ToGcj02, wgs84ToGcj02, } from './gcj02.js';
import { normalizeCommercialEntityAlias, stripNarrativeBracketSuffix, } from './nameAlias.js';
import { clipBoundaryToViewport } from './viewportClipping.js';
import { resolveTavilyApiKeys } from '../integration/tavilyApiKeys.js';
import { TavilyExtractClient } from '../skills/web_poi_discovery/tavilyExtractClient.js';
/**
 * 广告/营销/推广文案特征词库（narrative 联网事实补强专用）。
 *
 * 触发后整条 snippet 将被跳过，不再进入 voice_text / webFactHint / labels。
 * 覆盖：楼盘营销、直播带货、抽奖福利、招聘加盟、公众号/小程序引流、票务预约等。
 * 典型反例：
 *   ✗ "保利·公园上城营销中心盛大开放，泥乐脱口秀连嗨三天，引爆全城"
 *   ✗ "XX 大厦盛大开盘，首付 20 万抢购，限时特惠"
 *   ✗ "扫码关注公众号，领取 100 元优惠券"
 */
const NARRATIVE_AD_PATTERN = /(营销中心|售楼处|售楼部|置业顾问|开盘|开盘大吉|开售|盛大开放|盛大开业|盛大开幕|隆重开业|震撼开盘|钜献|钜惠|限时抢|限时特|特价优惠|返利|返现|红包|抽奖|引爆全|引爆|加盟|招商|脱口秀连嗨|脱口秀|演唱会|票务|预约咨询|销售热线|免费领|新品上市|首付|月供|总价|户型|样板间|样板房|VIP|尊享|抢购|限购|限时优惠|团购|代理|扫码关注|关注公众号|二维码|小程序|APP下载|app下载|微信公众号|广告|招聘|优惠券|折扣券|入驻|引流|刷单)/u;
const NARRATIVE_FILE_ARTIFACT_PATTERN = /(?:\[(?:DOC|PDF|PPT|XLS|XLSX)\])|(?:^|[\\/\s])[^\\/\n]{1,160}\.(?:docx?|pdf|pptx?|xlsx?|xls|wps)\b/iu;
const RESIDENTIAL_COMPOUND_NAME_PATTERN = /(小区|家属区|家属院|社区|住宅区|居民区|生活区|新村|宿舍区|公寓(?:楼|区)?|(?:佳苑|家园|雅苑|华府|名苑|嘉园|豪庭|花园)(?:东区|西区|南区|北区|一区|二区|三区|四区|一期|二期|三期|四期)?$)/u;
const RESIDENTIAL_SEMANTIC_PATTERN = /(商务住宅|住宅区|居民住宅|居住小区|居住社区|公寓住宅|住宅|residential|apartment|compound)/iu;
const STRONG_COMMERCIAL_COMPLEX_PATTERN = /(购物中心|购物广场|商业综合体|商场|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|mall|plaza|欧亚达|摩尔城)/iu;
const SYNTHETIC_DISTRICT_CONCEPT_PATTERN = /(商圈|片区|区域|地带)$/u;
const DEFAULT_NARRATIVE_ENCODER_PROFILE_LIMIT = 0;
const DEFAULT_NARRATIVE_WEB_FACT_NODE_LIMIT = 10;
const DEFAULT_NARRATIVE_WEB_FACT_REGION_LIMIT = 6;
const DEFAULT_NARRATIVE_WEB_FACT_RESULT_LIMIT = 4;
const DEFAULT_NARRATIVE_WEB_FACT_EXTRACT_URL_LIMIT = 2;
const DEFAULT_NARRATIVE_WEB_FACT_EXTRACT_TIMEOUT_MS = 10000;
const DEFAULT_NARRATIVE_LLM_NARRATION_TIMEOUT_MS = 18000;
function resolveNonNegativeInteger(value, fallback) {
    const normalized = String(value ?? '').trim().replace(/_/gu, '');
    if (!normalized)
        return fallback;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0)
        return fallback;
    return Math.floor(parsed);
}
function resolveBooleanFlag(value, fallback = false) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized)
        return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized))
        return true;
    if (['0', 'false', 'no', 'off'].includes(normalized))
        return false;
    return fallback;
}
function normalizeNarrationNodeLookupKey(value) {
    return String(value || '').trim().replace(/\s+/gu, '').toLowerCase();
}
function resolveNarrativeLlmNarrationTimeoutMs(env = process.env) {
    const requestTimeoutMs = resolveNonNegativeInteger(env.LLM_TIMEOUT_MS, 12000);
    const synthesisTimeoutMs = resolveNonNegativeInteger(env.LLM_SYNTHESIS_TIMEOUT_MS, Math.max(requestTimeoutMs, DEFAULT_NARRATIVE_LLM_NARRATION_TIMEOUT_MS));
    return Math.max(1000, resolveNonNegativeInteger(env.NARRATIVE_LLM_NARRATION_TIMEOUT_MS, synthesisTimeoutMs));
}
function resolveNarrativeSamplingNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(min, Math.min(max, parsed));
}
function resolveNarrativeLlmTemperature(env = process.env) {
    return resolveNarrativeSamplingNumber(env.NARRATIVE_LLM_TEMPERATURE, 0.86, 0, 1.3);
}
function resolveNarrativeLlmTopP(env = process.env) {
    return resolveNarrativeSamplingNumber(env.NARRATIVE_LLM_TOP_P, 0.92, 0.1, 1);
}
function pickNarrativeVariant(seed, choices) {
    if (choices.length === 0)
        return '';
    let hash = 2166136261;
    for (const char of seed) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return choices[Math.abs(hash) % choices.length];
}
const NARRATIVE_ANGLE_CHOICES = [
    '像本地朋友先帮人抓方向：先说这块在视口里的位置，再讲为什么这一带会形成这样的生活/人流/功能关系。',
    '像从空中俯瞰夜光：先讲最亮的主体，再讲周边微光如何补成一个片区，而不是逐点报菜名。',
    '像临时起意的城市散步：根据上一段和下一段自然转场，讲这一段为什么顺路、为什么值得停一下。',
    '像给外地朋友解释本地叫法：少用官方标签，多解释这片区域在本地人的日常里承担什么角色。',
];
const NARRATIVE_WORDING_CHOICES = [
    '这一轮避免使用“核心、地标、片区骨架”作为主要句式。',
    '这一轮多用“从这里往周边看”“顺着人流走”“这一带”这类口语连接。',
    '这一轮每段都要显式提到至少一个支撑节点或相邻片区，避免空泛形容。',
    '这一轮允许轻微比喻，但不能编造历史、排名、荣誉或不存在的故事。',
];
function formatNarrativeViewportContext(regions) {
    if (regions.length === 0)
        return '无片区顺序信息。';
    const centerLon = regions.reduce((sum, region) => sum + Number(region.center.lon || 0), 0) / regions.length;
    const centerLat = regions.reduce((sum, region) => sum + Number(region.center.lat || 0), 0) / regions.length;
    return regions.map((region, index) => {
        const eastWest = region.center.lon >= centerLon ? '偏东' : '偏西';
        const northSouth = region.center.lat >= centerLat ? '偏北' : '偏南';
        const previous = index > 0 ? regions[index - 1] : null;
        const next = index < regions.length - 1 ? regions[index + 1] : null;
        const relation = [
            previous ? `上一段来自${previous.name}` : '这是当前视口的开场段',
            next ? `下一段会接到${next.name}` : '这是当前视口的收束段',
        ].join('；');
        return `${region.name}: 位于视口${eastWest}${northSouth}，${relation}`;
    }).join('\n');
}
function buildNarrativeViewportContextLines(regions) {
    return formatNarrativeViewportContext(regions).split('\n').filter(Boolean);
}
function buildNarrativeEngineProfile(input) {
    const quality = evaluateNarrativeQuality(input.regions, input.steps || []);
    return {
        engineVersion: 'narrative-engine.v1',
        generationId: input.generationId,
        phase: input.phase,
        scaleLevel: input.scaleLevel,
        renderMode: input.renderMode,
        algorithm: {
            field: 'semantic_distance_gaussian',
            ranking: 'region_first_contextual',
            narration: input.narration,
        },
        sampling: {
            temperature: input.temperature,
            topP: input.topP,
            variantSeed: input.variantSeed || null,
            narrativeAngle: input.narrativeAngle || null,
            wordingConstraint: input.wordingConstraint || null,
        },
        context: {
            regionCount: input.regions.length,
            supportNodeCount: input.supportNodeCount,
            sourceCount: input.regions.reduce((sum, region) => sum + (region.webFacts?.sourceItems?.length || 0), 0),
            viewportRelationSummary: buildNarrativeViewportContextLines(input.regions).slice(0, 6),
        },
        quality,
    };
}
function tokenizeNarrativeText(text) {
    return String(text || '')
        .replace(/[，。！？；：、“”‘’（）()【】\s]/gu, '')
        .match(/[\p{Script=Han}]{2,4}|[a-zA-Z0-9]{3,}/gu) || [];
}
function evaluateNarrativeQuality(regions, steps) {
    const contentSteps = steps.filter((step) => step.focus !== 'overview');
    const flags = [];
    const sourceRegions = regions.filter((region) => (region.webFacts?.sourceItems?.length || 0) > 0).length;
    const sourceCoverage = regions.length > 0 ? sourceRegions / regions.length : 0;
    const supportCoveredSteps = contentSteps.filter((step) => {
        const text = String(step.voice_text || '');
        const supportNames = Array.isArray(step.regionSupportNames) ? step.regionSupportNames : [];
        return supportNames.length === 0 || supportNames.some((name) => text.includes(name));
    }).length;
    const supportCoverage = contentSteps.length > 0 ? supportCoveredSteps / contentSteps.length : 0;
    const texts = contentSteps.map((step) => String(step.voice_text || '').trim()).filter(Boolean);
    const uniqueLeads = new Set(texts.map((text) => text.slice(0, 12))).size;
    const contextVariance = texts.length > 0 ? uniqueLeads / texts.length : 0;
    const tokenCounts = new Map();
    for (const text of texts) {
        for (const token of tokenizeNarrativeText(text)) {
            tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
        }
    }
    const repeatedTokens = [...tokenCounts.values()].filter((count) => count >= Math.max(3, Math.ceil(texts.length * 0.7))).length;
    const repetitionRisk = texts.length > 0 ? Math.min(1, repeatedTokens / 8) : 0;
    if (sourceCoverage < 0.34)
        flags.push('source_light');
    if (supportCoverage < 0.75)
        flags.push('support_underused');
    if (contextVariance < 0.72 && texts.length >= 3)
        flags.push('phrasing_repetitive');
    if (repetitionRisk > 0.35)
        flags.push('high_repetition');
    const overall = Math.max(0, Math.min(1, sourceCoverage * 0.24
        + supportCoverage * 0.28
        + contextVariance * 0.30
        + (1 - repetitionRisk) * 0.18));
    return {
        overall: Number(overall.toFixed(3)),
        sourceCoverage: Number(sourceCoverage.toFixed(3)),
        supportCoverage: Number(supportCoverage.toFixed(3)),
        contextVariance: Number(contextVariance.toFixed(3)),
        repetitionRisk: Number(repetitionRisk.toFixed(3)),
        flags,
    };
}
function mapNarrationNodeTextsToIds(nodes, rawNodes) {
    const aliasToNodeId = new Map();
    nodes.forEach((node, index) => {
        const aliases = [
            node.id,
            node.name,
            normalizeName(node.name),
            `节点${index + 1}`,
            `node${index + 1}`,
            `node_${index + 1}`,
            `step${index + 1}`,
            `step_${index + 1}`,
            String(index + 1),
        ];
        for (const alias of aliases) {
            const normalizedAlias = normalizeNarrationNodeLookupKey(alias);
            if (!normalizedAlias || aliasToNodeId.has(normalizedAlias))
                continue;
            aliasToNodeId.set(normalizedAlias, node.id);
        }
    });
    const mappedNodes = {};
    for (const [rawKey, rawValue] of Object.entries(rawNodes || {})) {
        const text = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!text)
            continue;
        const normalizedKey = normalizeNarrationNodeLookupKey(rawKey);
        if (!normalizedKey)
            continue;
        const nodeId = aliasToNodeId.get(normalizedKey);
        if (!nodeId || mappedNodes[nodeId])
            continue;
        mappedNodes[nodeId] = text;
    }
    return mappedNodes;
}
function mapNarrationRegionTextsToIds(regions, rawNodes) {
    const aliasToRegionId = new Map();
    regions.forEach((region, index) => {
        const aliases = [
            region.id,
            region.name,
            normalizeName(region.name),
            `节点${index + 1}`,
            `节点 ${index + 1}`,
            `片区${index + 1}`,
            `片区 ${index + 1}`,
            `区域${index + 1}`,
            `区域 ${index + 1}`,
            `region${index + 1}`,
            `region_${index + 1}`,
            `step${index + 1}`,
            `step_${index + 1}`,
            String(index + 1),
        ];
        for (const alias of aliases) {
            const normalizedAlias = normalizeNarrationNodeLookupKey(alias);
            if (!normalizedAlias || aliasToRegionId.has(normalizedAlias))
                continue;
            aliasToRegionId.set(normalizedAlias, region.id);
        }
    });
    const mappedRegions = {};
    for (const [rawKey, rawValue] of Object.entries(rawNodes || {})) {
        const text = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!text)
            continue;
        const normalizedKey = normalizeNarrationNodeLookupKey(rawKey);
        if (!normalizedKey)
            continue;
        const regionId = aliasToRegionId.get(normalizedKey);
        if (!regionId || mappedRegions[regionId])
            continue;
        mappedRegions[regionId] = text;
    }
    return mappedRegions;
}
function looksLikeFileArtifact(text) {
    const normalized = String(text || '').trim();
    if (!normalized)
        return false;
    if (!NARRATIVE_FILE_ARTIFACT_PATTERN.test(normalized))
        return false;
    return normalized.length <= 180 || !/[。！？；]/u.test(normalized);
}
function sanitizeNarrativeWebSnippet(snippet, nodeName, title) {
    const normalized = String(snippet || '').trim();
    if (!normalized)
        return null;
    if (looksLikeFileArtifact(normalized))
        return null;
    if (!normalized.includes(nodeName) && !String(title || '').includes(nodeName))
        return null;
    return normalized.slice(0, 120);
}
function splitNarrativeEvidenceText(text) {
    const normalized = String(text || '')
        .replace(/\s+/gu, ' ')
        .replace(/[•·]/gu, ' ')
        .trim();
    if (!normalized)
        return [];
    return (normalized.match(/[^。！？；\n]{12,180}[。！？；]?/gu) || [])
        .map((chunk) => chunk.trim())
        .filter(Boolean);
}
function collectNarrativeEvidencePassages(text, nodeName, title) {
    const passages = [];
    for (const chunk of splitNarrativeEvidenceText(text)) {
        if (looksLikeFileArtifact(chunk))
            continue;
        if (NARRATIVE_AD_PATTERN.test(chunk))
            continue;
        if (!chunk.includes(nodeName) && !String(title || '').includes(nodeName))
            continue;
        passages.push(chunk.slice(0, 140));
    }
    return [...new Set(passages)].slice(0, 2);
}
function normalizeNarrativeSearchItems(result) {
    const rows = Array.isArray(result.results)
        ? result.results
        : Array.isArray(result.merged)
            ? result.merged
            : [];
    return rows
        .map((item) => ({
        title: String(item.title || '').trim(),
        snippet: String(item.snippet || item.content || '').trim(),
        url: String(item.url || '').trim(),
    }))
        .filter((item) => item.title || item.snippet || item.url);
}
function buildNarrativeRegionAlignmentWebResults(region) {
    const fact = region.webFacts;
    const titles = Array.isArray(fact?.titles) ? fact.titles : [];
    const snippets = Array.isArray(fact?.snippets) ? fact.snippets : [];
    const urls = Array.isArray(fact?.urls) ? fact.urls : [];
    const sourceItems = Array.isArray(fact?.sourceItems) ? fact.sourceItems : [];
    const items = sourceItems.length > 0
        ? sourceItems.map((item) => ({
            title: String(item.title || '').trim(),
            snippet: String(item.snippet || '').trim(),
            url: String(item.url || '').trim(),
        }))
        : titles.map((title, index) => ({
            title: String(title || '').trim(),
            snippet: String(snippets[index] || '').trim(),
            url: String(urls[index] || '').trim(),
        }));
    if (fact?.searchAnswer) {
        items.unshift({
            title: region.name,
            snippet: String(fact.searchAnswer || '').trim(),
            url: String(urls[0] || '').trim(),
        });
    }
    return items.filter((item) => item.title || item.snippet || item.url).slice(0, 8);
}
function buildNarrativeWebQueries(node, summary) {
    const category = String(node.categorySub || node.categoryMain || node.roleLabel || '').trim();
    const sceneTag = String(summary.sceneMix[0] || summary.dominantScene || '').trim();
    const cityHint = /(武汉|武昌|汉口|汉阳|湖北)/u.test(node.name) ? '' : '武汉';
    return [...new Set([
            [node.name, cityHint, category].filter(Boolean).join(' ').trim(),
            [node.name, cityHint, '周边', sceneTag || category].filter(Boolean).join(' ').trim(),
        ])].filter(Boolean);
}
function stripNarrativeRegionSearchSuffix(value) {
    return normalizeName(value)
        .replace(/(科教文化区|景观休闲区|商业活力区|人文片区|交通连接区|大学城(?:科教文化区)?|校园片区|片区|区域|地带|组团|界面|走廊)$/u, '')
        .trim();
}
function resolveNarrativeRegionPrimaryAnchor(region) {
    return [
        ...region.supportNames,
        normalizeName(region.spokenName || ''),
        normalizeName(region.name),
    ]
        .map((value) => stripNarrativeRegionSearchSuffix(value))
        .find(Boolean) || normalizeName(region.name);
}
function resolveNarrativeRegionSemanticSearchText(region, summary) {
    const bucket = String(region.dominantBucket || '').trim();
    const sceneTag = String(summary.sceneMix[0] || summary.dominantScene || '').trim();
    if (bucket === '校园')
        return '大学城 科教 校园 生活';
    if (bucket === '景观')
        return '景区 公园 休闲 游玩';
    if (bucket === '商业')
        return '商圈 商业 美食 逛街';
    if (bucket === '文化' || bucket === '宗教')
        return '人文 历史 文化 漫游';
    if (bucket === '交通')
        return '地铁 枢纽 周边 人流';
    if (bucket === '生活')
        return '社区 生活 日常 街区';
    return [bucket, sceneTag, '片区'].filter(Boolean).join(' ');
}
function resolveNarrativeRegionIntentSearchText(region) {
    const bucket = String(region.dominantBucket || '').trim();
    if (bucket === '校园')
        return '介绍 周边 打卡';
    if (bucket === '景观')
        return '介绍 景点 值得去';
    if (bucket === '商业')
        return '介绍 推荐 热门';
    if (bucket === '文化' || bucket === '宗教')
        return '介绍 历史 人文';
    if (bucket === '交通')
        return '周边 入口 换乘';
    if (bucket === '生活')
        return '周边 日常 生活';
    return '介绍 周边';
}
function buildNarrativeRegionAliases(region) {
    return [...new Set([
            normalizeName(region.name),
            stripNarrativeRegionSearchSuffix(region.name),
            normalizeName(region.spokenName || ''),
            stripNarrativeRegionSearchSuffix(region.spokenName || ''),
            ...region.supportNames.map((name) => normalizeName(name)),
            ...region.supportNames.map((name) => stripNarrativeRegionSearchSuffix(name)),
        ].filter(Boolean))].slice(0, 8);
}
function sanitizeNarrativeRegionWebSnippet(snippet, region, title) {
    const normalized = String(snippet || '').trim();
    if (!normalized)
        return null;
    if (looksLikeFileArtifact(normalized))
        return null;
    const aliases = buildNarrativeRegionAliases(region);
    const haystack = `${String(title || '').trim()} ${normalized}`;
    const compactHaystack = haystack.replace(/\s+/gu, '');
    if (aliases.length > 0 && !aliases.some((alias) => {
        if (!alias)
            return false;
        const compactAlias = alias.replace(/\s+/gu, '');
        return haystack.includes(alias) || (compactAlias.length >= 2 && compactHaystack.includes(compactAlias));
    }))
        return null;
    return normalized.slice(0, 140);
}
function collectNarrativeRegionEvidencePassages(text, region, title) {
    const aliases = buildNarrativeRegionAliases(region);
    const compactTitle = String(title || '').replace(/\s+/gu, '');
    const passages = [];
    for (const chunk of splitNarrativeEvidenceText(text)) {
        if (looksLikeFileArtifact(chunk))
            continue;
        if (NARRATIVE_AD_PATTERN.test(chunk))
            continue;
        const compactChunk = chunk.replace(/\s+/gu, '');
        if (aliases.length > 0 && !aliases.some((alias) => {
            if (!alias)
                return false;
            const compactAlias = alias.replace(/\s+/gu, '');
            return chunk.includes(alias)
                || String(title || '').includes(alias)
                || (compactAlias.length >= 2 && (compactChunk.includes(compactAlias) || compactTitle.includes(compactAlias)));
        }))
            continue;
        passages.push(chunk.slice(0, 160));
    }
    return [...new Set(passages)].slice(0, 2);
}
function buildNarrativeRegionPromptFacts(region) {
    const fact = region.webFacts;
    if (!fact)
        return [];
    const sourceTitles = Array.isArray(fact.sourceItems)
        ? fact.sourceItems.map((item) => String(item.title || '').trim()).filter(Boolean).slice(0, 5)
        : [];
    return [
        fact.query ? `网页检索：${fact.query}` : null,
        fact.labels?.length ? `网页标签：${fact.labels.join('、')}` : null,
        fact.searchAnswer ? `网页概述：${String(fact.searchAnswer).trim().slice(0, 180)}` : null,
        fact.snippets?.length ? `网页摘要：${fact.snippets.slice(0, 4).join('；')}` : null,
        sourceTitles.length > 0 ? `网页来源：${sourceTitles.join('、')}` : null,
    ].filter(Boolean);
}
function extractNarrativeRegionFactLabels(text, region) {
    const labels = [];
    if (/(5A|AAAAA|五A级)/u.test(text))
        labels.push('5A景区');
    if (/(4A|AAAA|四A级)/u.test(text))
        labels.push('4A景区');
    if (/(3A|AAA|三A级)/u.test(text))
        labels.push('3A景区');
    if (/(世界遗产|世界文化遗产|世界自然遗产)/u.test(text))
        labels.push('世界遗产');
    if (/(历史街区|老街|古镇)/u.test(text))
        labels.push('历史街区');
    if (/(网红|打卡|人气|热门|必去|必逛)/u.test(text))
        labels.push('人气打卡');
    if (region.dominantBucket === '校园' && /(大学城|高校|科教|学术|校园)/u.test(text))
        labels.push('科教氛围');
    if (region.dominantBucket === '商业' && /(商圈|商业街|综合体|夜经济|消费)/u.test(text))
        labels.push('商业活力');
    if (region.dominantBucket === '景观' && /(公园|景区|绿道|湖景|江滩)/u.test(text))
        labels.push('景观休闲');
    return [...new Set(labels)].slice(0, 3);
}
function buildNarrativeRegionWebQueries(region, summary) {
    const primaryAnchor = resolveNarrativeRegionPrimaryAnchor(region);
    const regionLabel = stripNarrativeRegionSearchSuffix(region.name) || normalizeName(region.name) || primaryAnchor;
    const supportText = region.supportNames
        .map((name) => stripNarrativeRegionSearchSuffix(name))
        .filter((name) => name && name !== primaryAnchor)
        .slice(0, 2)
        .join(' ');
    const sceneTag = String(summary.sceneMix[0] || summary.dominantScene || '').trim();
    const semanticText = resolveNarrativeRegionSemanticSearchText(region, summary);
    const intentText = resolveNarrativeRegionIntentSearchText(region);
    const cityHint = /(武汉|武昌|汉口|汉阳|湖北)/u.test(`${region.name} ${primaryAnchor} ${supportText}`) ? '' : '武汉';
    return [...new Set([
            [cityHint, primaryAnchor, semanticText, intentText].filter(Boolean).join(' ').trim(),
            [cityHint, regionLabel, supportText, semanticText].filter(Boolean).join(' ').trim(),
            [cityHint, primaryAnchor, '周边', supportText, '片区'].filter(Boolean).join(' ').trim(),
            [cityHint, primaryAnchor, sceneTag, '介绍'].filter(Boolean).join(' ').trim(),
        ])].filter(Boolean);
}
function looksResidentialSemantic(text) {
    const normalized = String(text || '').trim();
    if (!normalized)
        return false;
    return RESIDENTIAL_COMPOUND_NAME_PATTERN.test(normalized) || RESIDENTIAL_SEMANTIC_PATTERN.test(normalized);
}
function hasStrongCommercialComplexText(text) {
    return STRONG_COMMERCIAL_COMPLEX_PATTERN.test(String(text || '').trim());
}
function isSyntheticDistrictConceptName(name) {
    const normalized = String(name || '').replace(/\s+/gu, '').trim();
    if (!normalized)
        return false;
    return SYNTHETIC_DISTRICT_CONCEPT_PATTERN.test(normalized);
}
function extractLastUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const item = messages[index];
        if (String(item?.role || '').trim().toLowerCase() !== 'user')
            continue;
        const text = String(item?.content || '').trim();
        if (text)
            return text;
    }
    return '';
}
function normalizeSurface(value) {
    return String(value || '').trim().toLowerCase() === 'narrative' ? 'narrative' : 'default';
}
function readViewport(request) {
    const spatialContext = request.options?.spatialContext;
    const viewport = Array.isArray(spatialContext?.viewport) ? spatialContext.viewport : [];
    if (viewport.length < 4)
        return null;
    const swLon = Number(viewport[0]);
    const swLat = Number(viewport[1]);
    const neLon = Number(viewport[2]);
    const neLat = Number(viewport[3]);
    if (![swLon, swLat, neLon, neLat].every(Number.isFinite)) {
        return null;
    }
    return {
        swLon: Math.min(swLon, neLon),
        swLat: Math.min(swLat, neLat),
        neLon: Math.max(swLon, neLon),
        neLat: Math.max(swLat, neLat),
    };
}
function readNarrativeTourStyle(request) {
    const spatialContext = request.options?.spatialContext;
    return resolveNarrativeTourStyle(spatialContext?.narrativeStyle
        ?? spatialContext?.tourStyle
        ?? request.options?.narrativeStyle
        ?? request.options?.tourStyle);
}
function buildViewportScale(diagonalM) {
    if (diagonalM >= 12000)
        return 'large';
    if (diagonalM >= 3500)
        return 'medium';
    return 'small';
}
/**
 * 视口尺度判定：基于对角线米数划分 micro / meso / macro 三档。
 *
 * 后续多尺度叙事阶段会据此切换讲解粒度：
 *   - micro (<3km)：具体 POI / 单点 AOI
 *   - meso (3-10km)：品牌/功能聚集区（当前主链路默认粒度）
 *   - macro (>=10km)：高阶语义聚合区（武汉大学城科教文化区 等）
 *
 * 当前第一阶段仅把该标识写进 narrative_tour 输出，供前端和日志观察，
 * 实际叙事分支在第三阶段打开。
 */
function resolveNarrativeScaleLevel(diagonalM) {
    if (diagonalM >= 10000)
        return 'macro';
    if (diagonalM >= 3000)
        return 'meso';
    return 'micro';
}
export function resolveNarrativeScaleLevelFromContext(input) {
    const base = resolveNarrativeScaleLevel(input.diagonalM);
    const semanticBuckets = new Set(input.supportNodes
        .map((node) => String(node.sceneBucket || node.categoryMain || node.role || '').trim())
        .filter(Boolean));
    const anchorCount = input.supportNodes.filter((node) => (node.source === 'aoi_context'
        || node.source === 'brand_cluster'
        || node.role === 'district_anchor'
        || node.role === 'campus_anchor')).length;
    const semanticDensity = anchorCount + semanticBuckets.size + Math.min(input.aoiContextCount, 8) * 0.25;
    if (base === 'micro' && input.diagonalM >= 2400 && semanticDensity >= 6)
        return 'meso';
    if (base === 'meso' && input.diagonalM >= 7600 && semanticDensity >= 10 && input.hotspotCount >= 2)
        return 'macro';
    if (base === 'macro' && semanticDensity <= 4 && input.hotspotCount <= 1)
        return 'meso';
    return base;
}
function buildNarrativeIntent(rawQuery, viewport) {
    const diagonalM = buildViewportDiagonalM(viewport);
    return {
        queryType: 'area_overview',
        intentMode: 'deterministic_visible_loop',
        rawQuery,
        placeName: '当前视口',
        anchorSource: 'map_view',
        secondaryPlaceName: null,
        targetCategory: null,
        radiusM: Math.max(Math.round(diagonalM / 2), 800),
        needsClarification: false,
        clarificationHint: null,
        needsWebSearch: false,
        toolIntent: 'area_insight',
        searchIntentHint: null,
        categoryKey: null,
        categoryMain: null,
        categorySub: null,
        viewportContext: {
            diagonalM,
            scale: buildViewportScale(diagonalM),
            bounds: {
                swLon: viewport.swLon,
                swLat: viewport.swLat,
                neLon: viewport.neLon,
                neLat: viewport.neLat,
            },
        },
    };
}
function extractNarrativeFactLabels(text, node) {
    const labels = [];
    if (/(5A|AAAAA|五A级)/u.test(text))
        labels.push('5A景区');
    if (/(4A|AAAA|四A级)/u.test(text))
        labels.push('4A景区');
    if (/(3A|AAA|三A级)/u.test(text))
        labels.push('3A景区');
    if (/(世界遗产|世界文化遗产|世界自然遗产)/u.test(text))
        labels.push('世界遗产');
    if (/(全国重点文物保护单位|国家重点文物保护单位)/u.test(text))
        labels.push('国保单位');
    if (/(省级文物保护单位)/u.test(text))
        labels.push('省保单位');
    if (/(老字号|百年老店)/u.test(text))
        labels.push('老字号');
    if (/(历史街区|老街|古镇)/u.test(text))
        labels.push('历史街区');
    if (/(网红|打卡|人气|热门|必去|必逛)/u.test(text))
        labels.push('人气打卡');
    if (/(旗舰|旗舰级|头部|标杆|示范)/u.test(text)) {
        labels.push(node.role === 'commercial_anchor' ? '商业标杆' : '重点标杆');
    }
    return [...new Set(labels)].slice(0, 3);
}
function buildSyntheticAnchor(viewport) {
    const center = buildViewportCenter(viewport);
    return {
        place_name: '当前视口',
        display_name: '当前视口',
        resolved_place_name: '当前视口',
        role: 'primary',
        source: 'map_view',
        poi_id: null,
        lon: center.lon,
        lat: center.lat,
        coord_sys: 'wgs84',
    };
}
function normalizePoiPreview(nodes) {
    return nodes.map((item) => ({
        id: item.id ?? item.name,
        name: item.name,
        longitude: item.longitude,
        latitude: item.latitude,
        category_main: item.categoryMain || null,
        category_sub: item.categorySub || item.category || null,
        distance_m: item.distance_m ?? null,
    }));
}
function toFeature(node) {
    return {
        type: 'Feature',
        properties: {
            id: node.id,
            name: node.name,
            名称: node.name,
        },
        geometry: {
            type: 'Point',
            coordinates: [node.center.lon, node.center.lat],
        },
    };
}
function buildEmptyIntentPayload(rawQuery) {
    return {
        queryType: 'viewport_tour',
        intentMode: 'narrative_surface',
        rawQuery,
        surface: 'narrative',
        parserModel: 'narrative_runtime_v1',
        parserProvider: 'rule',
    };
}
function formatSqlNumber(value, digits = 8) {
    if (!Number.isFinite(value))
        return '0';
    const text = value.toFixed(digits);
    return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function toFiniteNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}
/**
 * 来自 OSM 的 WGS84 源：解析时需要做 WGS84 → GCJ02 转换，和 POI 对齐。
 * 其它源（aggregate_morphology / point_halo）本就基于 GCJ02 POI 成员点生成，
 * 不需要再转。
 */
const WGS84_BOUNDARY_SOURCES = new Set([
    'aoi_native',
    'landuse_parcel',
    'road_block',
    'concave_hull',
    'buffer',
]);
/**
 * 解析 PostGIS ST_AsGeoJSON 返回的字符串，构造节点模糊边界。
 * 兼容 Polygon / MultiPolygon，无效或空几何返回 null。
 * 对 WGS84 来源自动做 GCJ02 转换，保证后端 narrative 输出都是 GCJ02，
 * 前端直接 fromLonLat 即可贴合高德 GCJ02 底图。
 */
function parseBoundaryGeoJson(value, source = 'aoi_native') {
    if (!value)
        return null;
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || raw === 'null')
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        const type = String(parsed.type || '');
        if (type !== 'Polygon' && type !== 'MultiPolygon')
            return null;
        if (!Array.isArray(parsed.coordinates) || parsed.coordinates.length === 0)
            return null;
        const normalizedCoordinates = WGS84_BOUNDARY_SOURCES.has(source)
            ? transformGeoJsonCoordinatesWgs84ToGcj02(parsed.coordinates)
            : parsed.coordinates;
        return {
            type: type,
            coordinates: normalizedCoordinates,
            source,
        };
    }
    catch {
        return null;
    }
}
/**
 * 计算模糊边界顶点算术平均作为视觉中心。
 * 用于 enrichAggregateBoundaries / enrichMissingBoundaries 同步 node.center，
 * 让镜头对准的区域和实际画出的 boundary 视觉中心一致。
 */
function computeBoundaryCentroid(boundary) {
    const rings = [];
    if (boundary.type === 'Polygon') {
        rings.push(...boundary.coordinates);
    }
    else if (boundary.type === 'MultiPolygon') {
        for (const polygon of boundary.coordinates) {
            if (Array.isArray(polygon))
                rings.push(...polygon);
        }
    }
    let sumLon = 0;
    let sumLat = 0;
    let count = 0;
    for (const ring of rings) {
        if (!Array.isArray(ring))
            continue;
        for (const point of ring) {
            if (!Array.isArray(point) || point.length < 2)
                continue;
            const lon = Number(point[0]);
            const lat = Number(point[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat))
                continue;
            sumLon += lon;
            sumLat += lat;
            count += 1;
        }
    }
    if (count === 0)
        return null;
    return { lon: sumLon / count, lat: sumLat / count };
}
function resolvePopulationHotness(populationSum, populationPeak) {
    if (populationPeak >= 200 || populationSum >= 1000)
        return 'very_high';
    if (populationPeak >= 120 || populationSum >= 600)
        return 'high';
    if (populationPeak >= 50 || populationSum >= 200)
        return 'medium';
    return 'low';
}
function resolvePopulationHotnessLabel(level) {
    if (level === 'very_high')
        return '极高人流热度';
    if (level === 'high')
        return '高人流热度';
    if (level === 'medium')
        return '中等人流热度';
    return '低人流热度';
}
function buildPopulationHotspotLabel(index, hotspot) {
    const rounded = Math.round(hotspot.popSum);
    return hotspot.label || `人口热点${index + 1}（${rounded}）`;
}
function normalizePopulationHotspots(rows = []) {
    return rows
        .map((row, index) => {
        const lon = toFiniteNumber(row.center_lon || row.centerLon);
        const lat = toFiniteNumber(row.center_lat || row.centerLat);
        const popSum = toFiniteNumber(row.pop_sum || row.popSum);
        const popPeak = toFiniteNumber(row.pop_peak || row.popPeak);
        const cellCount = toFiniteNumber(row.cell_count || row.cellCount);
        if (lon === null || lat === null || popSum === null || popPeak === null || cellCount === null)
            return null;
        const hotspot = {
            label: String(row.label || '').trim() || `人口热点${index + 1}`,
            gridWkt: String(row.grid_wkt || row.gridWkt || '').trim() || null,
            center: { lon, lat },
            popSum,
            popPeak,
            cellCount,
        };
        hotspot.label = buildPopulationHotspotLabel(index, hotspot);
        return hotspot;
    })
        .filter((item) => Boolean(item));
}
function buildNodePopulationGroundingSql(node, radiusM) {
    const point = `ST_SetSRID(ST_MakePoint(${formatSqlNumber(node.center.lon)}, ${formatSqlNumber(node.center.lat)}), 4326)`;
    return `
SELECT
  COUNT(*) AS cell_count,
  COALESCE(SUM(pop_value), 0) AS pop_sum,
  COALESCE(MAX(pop_value), 0) AS pop_peak,
  COALESCE(AVG(pop_value), 0) AS pop_avg
FROM population_grid_100m
WHERE pop_value > 0
  AND ST_DWithin(center_geom::geography, ${point}::geography, ${Math.max(50, Math.round(radiusM))})
LIMIT 1;
`.trim();
}
function buildNodeGrounding(node, row, radiusM) {
    const populationSum = toFiniteNumber(row?.pop_sum || row?.popSum) || 0;
    const populationPeak = toFiniteNumber(row?.pop_peak || row?.popPeak) || 0;
    const populationAvg = toFiniteNumber(row?.pop_avg || row?.popAvg) || 0;
    const cellCount = toFiniteNumber(row?.cell_count || row?.cellCount) || 0;
    const populationHotness = resolvePopulationHotness(populationSum, populationPeak);
    const hotnessLabel = resolvePopulationHotnessLabel(populationHotness);
    return {
        nodeId: node.id,
        radiusM,
        populationHotness,
        populationSum,
        populationPeak,
        populationAvg,
        cellCount,
        summary: `${hotnessLabel}，${radiusM}米范围内累计人口值约 ${Math.round(populationSum)}，峰值约 ${Math.round(populationPeak)}。`,
    };
}
export class NarrativeRuntime {
    options;
    provider;
    coverageBoundsCache = null;
    constructor(options) {
        this.options = options;
        this.provider = options.provider || createDefaultLLMProvider();
    }
    createWriter(stream, traceId = randomUUID()) {
        return new SSEWriter({
            stream: stream,
            traceId,
            schemaVersion: 'v4.narrative.v1',
        });
    }
    async getHealth() {
        return {
            ready: Boolean(this.options.registry.get('postgis')),
            surface: 'narrative',
        };
    }
    async getCoverageBounds(forceRefresh = false) {
        if (!forceRefresh && this.coverageBoundsCache) {
            return { ...this.coverageBoundsCache };
        }
        const logger = createLogger({ scope: 'NarrativeCoverage' });
        const context = createSkillExecutionContext({
            traceId: randomUUID(),
            requestId: randomUUID(),
            logger,
        });
        const postgis = this.requireSkill('postgis');
        const result = await this.executeSkill(postgis, 'execute_spatial_sql', {
            sql: `
          SELECT
            ST_XMin(extent_geom) AS min_lon,
            ST_YMin(extent_geom) AS min_lat,
            ST_XMax(extent_geom) AS max_lon,
            ST_YMax(extent_geom) AS max_lat,
            district_count
          FROM (
            SELECT
              ST_SetSRID(ST_Extent(geom)::geometry, 4326) AS extent_geom,
              COUNT(*) AS district_count
            FROM districts
            WHERE geom IS NOT NULL
          ) q
        `,
        }, context);
        const row = Array.isArray(result.rows) ? result.rows[0] : null;
        const minLon = Number(row?.min_lon);
        const minLat = Number(row?.min_lat);
        const maxLon = Number(row?.max_lon);
        const maxLat = Number(row?.max_lat);
        const districtCount = Number(row?.district_count);
        if (![minLon, minLat, maxLon, maxLat, districtCount].every(Number.isFinite)) {
            throw new Error('narrative coverage bounds unavailable');
        }
        this.coverageBoundsCache = {
            minLon,
            minLat,
            maxLon,
            maxLat,
            districtCount,
        };
        return { ...this.coverageBoundsCache };
    }
    /**
     * 诊断端点：给定 viewport，返回视口内原始召回 + 品牌聚合 + 候选节点 + 排名结果。
     * 不生成解说词、不做 encode_poi_profile（该步骤慢且可能污染品类标签）。
     * 用于暴露「数据里到底有什么 / 哪些被品牌吸走 / 哪些被淘汰」的全貌。
     */
    async probe(input) {
        const viewport = input.viewport;
        const center = buildViewportCenter(viewport);
        const diagonalM = buildViewportDiagonalM(viewport);
        const rawQuery = input.rawQuery || '诊断当前视口召回数据';
        const topRaw = Math.max(5, Math.min(input.topRaw ?? 20, 120));
        const probeId = `probe:${randomUUID()}`;
        const logger = createLogger().child({
            traceId: probeId,
            requestId: probeId,
            surface: 'narrative_probe',
        });
        const context = createSkillExecutionContext({
            traceId: probeId,
            requestId: probeId,
            logger,
        });
        const notes = [];
        // 1. 原始数据召回
        const areaEvidence = await this.collectAreaEvidence(viewport, center, context);
        // 2. 生成 EvidenceItem 形式的 representativeSamples（用于品牌聚合与候选构建）
        const intent = buildNarrativeIntent(rawQuery, viewport);
        const anchor = buildSyntheticAnchor(viewport);
        const areaView = buildAreaOverviewView({
            anchor,
            rows: areaEvidence.representativeSamples,
            intent,
            areaInsight: {
                categoryHistogram: areaEvidence.categoryHistogram,
                representativeSamples: areaEvidence.representativeSamples,
                hotspotCells: areaEvidence.hotspots,
                aoiContext: areaEvidence.aoiContext,
                landuseContext: areaEvidence.landuseContext,
            },
        });
        const poiSamples = areaView.representativeSamples || [];
        const snapshot = buildRegionSnapshotFromEvidence({
            view: areaView,
            rawQuery,
        });
        const derivedFeatureTags = deriveRegionFeatureTags(snapshot);
        const derivedFeatureSummary = summarizeRegionFeatures(snapshot, derivedFeatureTags);
        // 3. 品牌聚合
        const mergedPois = this.mergePoisWithBrandPool(poiSamples, areaEvidence.brandPool);
        const allClusters = clusterPoisByBrand(mergedPois);
        const eligibleClusters = allClusters.filter(isBrandClusterEligible);
        const ineligibleClusters = allClusters.filter((c) => !isBrandClusterEligible(c));
        const coveredPoiIds = new Set();
        for (const cluster of eligibleClusters) {
            for (const member of cluster.members) {
                const id = String(member.id ?? member.name ?? '');
                if (id)
                    coveredPoiIds.add(id);
            }
        }
        // 4. 可选：encoder 信号（用户显式 includeEncoder 才调）
        let encoderResult = null;
        let scopeDataForCells = null;
        if (input.includeEncoder) {
            try {
                const signals = await this.collectEncoderSignals({
                    context,
                    rawQuery,
                    center,
                    diagonalM,
                    snapshot,
                });
                scopeDataForCells = signals.scopeData ?? null;
                encoderResult = {
                    available: true,
                    regionSummary: signals.regionSummary,
                    regionTags: signals.regionTags,
                    sceneTags: signals.sceneTags,
                    dominantBuckets: signals.dominantBuckets,
                    cells: Array.isArray(scopeDataForCells?.cells) ? scopeDataForCells.cells : [],
                };
            }
            catch (error) {
                notes.push(`encoder 调用失败：${error instanceof Error ? error.message : String(error)}`);
                encoderResult = {
                    available: false,
                    regionSummary: null,
                    regionTags: [],
                    sceneTags: [],
                    dominantBuckets: [],
                    cells: [],
                };
            }
        }
        // 5. 构建候选节点（跑 brand cluster + cell + aoi 三阶段）
        const cellEntities = this.filterCellEntitiesByViewport(this.extractCellEntities(scopeDataForCells), viewport);
        const candidates = this.buildCellBasedCandidates(cellEntities, poiSamples, areaEvidence.aoiContext, areaEvidence.brandPool);
        // 对 aoiContext 未覆盖到的 brand cluster 节点定向回查 aois 表补齐 boundary
        await this.enrichMissingBoundaries(candidates, context);
        // 对仍缺 boundary 的节点做聚合边界生成（DBSCAN→ConcaveHull→Buffer→Landuse吸附 / 单点圆兜底）
        await this.enrichAggregateBoundaries(candidates, viewport, context);
        // 视口契约门禁：boundary 必须与视口真实相交，否则淘汰节点。
        // 这是 narrative 对用户的基本承诺——输出里的节点必定在视口内有可见几何。
        const candidatesInViewport = this.enforceViewportBoundaryContract(candidates, viewport, context);
        const rankedCandidates = input.includeEncoder && candidatesInViewport.length > 0
            ? await this.enrichCandidatesWithEncoder({
                candidates: candidatesInViewport,
                center,
                rawQuery,
                areaView,
                context,
            })
            : candidatesInViewport;
        // 6. 排序：includeEncoder 时尽量复用正式 narrative 的 summary 与候选 enrich 链路
        const viewportSummary = buildNarrativeViewportSummary({
            featureTags: derivedFeatureTags,
            featureSummary: derivedFeatureSummary,
            encoderSummary: encoderResult?.regionSummary ?? null,
            encoderTags: encoderResult?.regionTags ?? [],
            encoderSceneTags: encoderResult?.sceneTags ?? [],
            encoderDominantBuckets: encoderResult?.dominantBuckets ?? [],
            candidates: rankedCandidates,
            requestedStyle: 'classic_must_see',
        });
        const rankResult = rankNarrativeNodes(rankedCandidates, viewportSummary, 18);
        const selectedIds = new Set(rankResult.selectedNodes.map((node) => node.id));
        const droppedIds = rankedCandidates
            .filter((node) => !selectedIds.has(node.id))
            .map((node) => node.id);
        // 7. 汇总 byRole / bySource 计数
        const bySource = {};
        const byRole = {};
        for (const node of rankedCandidates) {
            bySource[node.source] = (bySource[node.source] || 0) + 1;
            byRole[node.role] = (byRole[node.role] || 0) + 1;
        }
        // 8. 诊断注释
        if (areaEvidence.representativeSamples.length === 0) {
            notes.push('representativeSamples 为空：视口内可能无 POI 数据，或 SQL 模板未命中。');
        }
        if (areaEvidence.brandPool.length === 0) {
            notes.push('brandPool 为空：视口内没有被词典匹配到的 campus / scenic / food_street / commercial POI。');
        }
        if (eligibleClusters.length === 0) {
            notes.push('eligibleClusters 为空：品牌抽取未识别出任何区域性实体。');
        }
        if (candidates.length < 3) {
            notes.push(`candidates 仅 ${candidates.length} 个，视口可能过小或数据稀疏。`);
        }
        if (!input.includeEncoder) {
            notes.push('当前 probe 未开启 encoder enrich，正式 narrative 的入选结果可能与这里不完全一致。');
        }
        return {
            version: this.options.version,
            viewport,
            center,
            diagonalM,
            raw: {
                categoryHistogram: areaEvidence.categoryHistogram,
                representativeSamples: this.normalizeProbePoiRows(areaEvidence.representativeSamples, topRaw),
                brandPool: this.normalizeProbePoiRows(areaEvidence.brandPool, topRaw),
                aoiContext: this.normalizeProbeAoiRows(areaEvidence.aoiContext, topRaw),
                landuseContext: areaEvidence.landuseContext.slice(0, topRaw),
                hotspots: areaEvidence.hotspots.slice(0, topRaw),
            },
            brandAggregation: {
                allClusters: allClusters.map((c) => this.toBrandClusterView(c, coveredPoiIds)),
                eligibleClusters: eligibleClusters.map((c) => this.toBrandClusterView(c, coveredPoiIds)),
                ineligibleClusters: ineligibleClusters.map((c) => this.toBrandClusterView(c, coveredPoiIds)),
                coveredPoiIds: [...coveredPoiIds],
            },
            candidates: {
                total: rankedCandidates.length,
                bySource,
                byRole,
                items: rankedCandidates,
            },
            ranked: {
                limit: 15,
                mode: rankResult.narrativeMode,
                selected: rankResult.selectedNodes,
                droppedIds,
            },
            encoder: encoderResult,
            diagnostics: { notes },
        };
    }
    normalizeProbePoiRows(rows, limit) {
        return rows.slice(0, limit).map((row) => ({
            id: row.id ?? null,
            name: String(row.name ?? ''),
            category_main: typeof row.category_main === 'string' ? row.category_main : null,
            category_sub: typeof row.category_sub === 'string' ? row.category_sub : null,
            longitude: Number(row.longitude),
            latitude: Number(row.latitude),
            distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
            anchor_priority: Number.isFinite(Number(row.anchor_priority)) ? Number(row.anchor_priority) : null,
            tile_x: Number.isFinite(Number(row.tile_x)) ? Number(row.tile_x) : null,
            tile_y: Number.isFinite(Number(row.tile_y)) ? Number(row.tile_y) : null,
            brand_bucket: typeof row.brand_bucket === 'string' ? row.brand_bucket : null,
        }));
    }
    normalizeProbeAoiRows(rows, limit) {
        return rows.slice(0, limit).map((row) => ({
            id: row.id ?? null,
            name: String(row.name ?? ''),
            fclass: typeof row.fclass === 'string' ? row.fclass : null,
            code: typeof row.code === 'string' ? row.code : null,
            population: Number.isFinite(Number(row.population)) ? Number(row.population) : null,
            area_sqm: Number.isFinite(Number(row.area_sqm)) ? Number(row.area_sqm) : null,
            longitude: Number(row.longitude),
            latitude: Number(row.latitude),
            anchor_priority: Number.isFinite(Number(row.anchor_priority)) ? Number(row.anchor_priority) : null,
            boundary_geojson: typeof row.boundary_geojson === 'string' ? row.boundary_geojson : null,
        }));
    }
    toBrandClusterView(cluster, _covered) {
        return {
            brand: cluster.brand,
            type: cluster.type,
            count: cluster.count,
            eligible: isBrandClusterEligible(cluster),
            center: cluster.center,
            members: cluster.members.map((m) => ({
                id: m.id ?? null,
                name: String(m.name || ''),
                longitude: Number(m.longitude),
                latitude: Number(m.latitude),
            })),
        };
    }
    async handle(request, writer) {
        const startedAt = Date.now();
        const requestId = String(request.options?.requestId || writer.traceId);
        const rawQuery = extractLastUserText(request.messages) || '请按导览顺序介绍当前区域';
        const viewport = readViewport(request);
        await writer.trace({
            request_id: requestId,
            version: this.options.version,
            surface: normalizeSurface(request.options?.surface),
        });
        await writer.job({
            mode: 'narrative_tour',
            version: this.options.version,
            surface: 'narrative',
        });
        await writer.intentPreview({
            queryType: 'viewport_tour',
            displayAnchor: '当前视口',
            needsClarification: !viewport,
            clarificationHint: viewport ? null : '请先把地图移动到要解说的区域。',
            parserModel: 'narrative_runtime_v1',
            parserProvider: 'rule',
            surface: 'narrative',
        });
        if (!viewport) {
            const answer = '请先在 /narrative 页面把地图移动到你想解说的区域，然后再生成导览骨架。';
            await writer.stage('answer');
            await writer.thinking({
                status: 'end',
                message: '当前还没有稳定的视口范围，暂时无法生成区域导览。',
            });
            await writer.stats({
                surface: 'narrative',
                result_count: 0,
                duration_ms: Date.now() - startedAt,
            });
            await writer.refinedResult({
                answer,
                answer_source: 'clarification',
                results: {
                    pois: [],
                    stats: {
                        surface: 'narrative',
                        result_count: 0,
                    },
                },
                intent: buildEmptyIntentPayload(rawQuery),
            });
            await writer.done({ duration_ms: Date.now() - startedAt });
            return;
        }
        const center = buildViewportCenter(viewport);
        const boundary = buildViewportBoundary(viewport);
        const requestedStyle = readNarrativeTourStyle(request);
        const intent = buildNarrativeIntent(rawQuery, viewport);
        const anchor = buildSyntheticAnchor(viewport);
        const logger = createLogger().child({
            traceId: writer.traceId,
            requestId,
            surface: 'narrative',
        });
        const context = createSkillExecutionContext({
            traceId: writer.traceId,
            requestId,
            logger,
        });
        const timing = {
            areaEvidenceMs: 0,
            candidateBuildMs: 0,
            candidatePrepareMs: 0,
            webEnrichmentMs: 0,
            llmNarrationMs: 0,
        };
        await writer.boundary(boundary);
        await writer.stage('viewport_summary');
        await writer.thinking({
            status: 'start',
            message: '正在读取当前视口的区域结构...',
        });
        let phaseStartedAt = Date.now();
        const areaEvidence = await this.collectAreaEvidence(viewport, center, context);
        timing.areaEvidenceMs = Date.now() - phaseStartedAt;
        const areaView = buildAreaOverviewView({
            anchor,
            rows: areaEvidence.representativeSamples,
            intent,
            areaInsight: {
                categoryHistogram: areaEvidence.categoryHistogram,
                representativeSamples: areaEvidence.representativeSamples,
                hotspotCells: areaEvidence.hotspots,
                aoiContext: areaEvidence.aoiContext,
                landuseContext: areaEvidence.landuseContext,
            },
        });
        const snapshot = buildRegionSnapshotFromEvidence({
            view: areaView,
            rawQuery,
        });
        const derivedFeatureTags = deriveRegionFeatureTags(snapshot);
        const derivedFeatureSummary = summarizeRegionFeatures(snapshot, derivedFeatureTags);
        const useEncoder = resolveBooleanFlag(process.env.NARRATIVE_USE_ENCODER, false);
        const encoderPayload = useEncoder
            ? await this.collectEncoderSignals({
                context,
                rawQuery,
                center,
                diagonalM: buildViewportDiagonalM(viewport),
                snapshot,
            })
            : {
                regionSummary: null,
                regionTags: [],
                sceneTags: [],
                dominantBuckets: [],
                scopeData: null,
            };
        // 用 cell 模型构建区域实体级候选节点，而非 POI 点级
        phaseStartedAt = Date.now();
        const cellEntities = this.filterCellEntitiesByViewport(this.extractCellEntities(encoderPayload.scopeData ?? null), viewport);
        const poiSamples = areaView.representativeSamples || [];
        const baseSupportNodePool = this.buildCellBasedCandidates(cellEntities, poiSamples, areaEvidence.aoiContext, areaEvidence.brandPool);
        timing.candidateBuildMs = Date.now() - phaseStartedAt;
        const viewportDiagonalM = buildViewportDiagonalM(viewport);
        const scaleLevel = resolveNarrativeScaleLevelFromContext({
            diagonalM: viewportDiagonalM,
            supportNodes: baseSupportNodePool,
            aoiContextCount: areaEvidence.aoiContext.length,
            hotspotCount: areaEvidence.hotspots.length,
        });
        const renderMode = resolveNarrativeRenderMode(scaleLevel);
        const nodeLimit = resolveScaleLevelNodeLimit(scaleLevel);
        // ============================================================
        // 区域优先筛选（不依赖 boundary）
        //
        // 旧流程：prepareNarrativeCandidates 先做边界 SQL 再排序，
        //   candidatePrepareMs 占总时长 95%+，骨架发出时已经 20-30s。
        // 新流程：supportNodePool → region candidates → 排序 → 发骨架 → 延后补边界，
        //   骨架发出时间 ≈ candidateBuildMs + areaEvidenceMs（通常 < 5s）。
        // ============================================================
        const viewportSummary = buildNarrativeViewportSummary({
            featureTags: derivedFeatureTags,
            featureSummary: derivedFeatureSummary,
            encoderSummary: encoderPayload.regionSummary,
            encoderTags: encoderPayload.regionTags,
            encoderSceneTags: encoderPayload.sceneTags,
            encoderDominantBuckets: encoderPayload.dominantBuckets,
            candidates: baseSupportNodePool,
            scaleLevel,
            requestedStyle,
        });
        await writer.reasoning({
            content: viewportSummary.summarySentence,
        });
        await writer.thinking({
            status: 'end',
            message: '区域结构已识别，正在筛选解说片区...',
        });
        await writer.stage('region_selection');
        await writer.thinking({
            status: 'start',
            message: '正在筛选候选解说片区...',
        });
        const regionFirstSelection = await this.buildRegionFirstSelection({
            supportNodePool: baseSupportNodePool,
            poiSamples,
            brandPoolRows: areaEvidence.brandPool,
            aoiContext: areaEvidence.aoiContext,
            hotspots: areaEvidence.hotspots,
            viewport,
            scaleLevel,
            summary: viewportSummary,
            nodeLimit,
            context,
        });
        const evidenceRegionSeeds = regionFirstSelection.evidenceRegionSeeds;
        const preClusterField = regionFirstSelection.relevanceField;
        const regionCandidates = regionFirstSelection.regionCandidates;
        const selectedRegionSeeds = regionFirstSelection.selectedRegionSeeds;
        const rankResult = regionFirstSelection.rankResult;
        const supportNodePool = regionFirstSelection.supportNodePool;
        const selectedNodes = regionFirstSelection.selectedNodes;
        const macroRegionProfile = buildMacroRegionProfile(selectedNodes, viewportSummary);
        // skeleton 阶段先用 deterministic 命名（快，不依赖 LLM），
        // final 阶段会尝试 LLM 命名覆盖，失败则保留 deterministic。
        const macroRegionNameDeterministic = generateMacroRegionName(macroRegionProfile);
        const narrativeSummary = (macroRegionProfile || macroRegionNameDeterministic)
            ? {
                ...viewportSummary,
                macroRegionProfile,
                macroRegionName: macroRegionNameDeterministic,
            }
            : viewportSummary;
        // ============================================================
        // First paint：骨架版 refinedResult
        //
        // 在 web_enrichment 和 LLM narration 这两个"慢段"启动之前，立即把
        // 已就绪的骨架（boundary / selected_nodes / 模板 overview + 占位节点文案）
        // 下发给前端。前端可以同时：
        //   1) 绘制 boundary、挂 POI feature，完成镜头骨架
        //   2) 播放 overview 模板文案（可播报，无需等 LLM）
        //   3) 按 node_id 建立 step 索引，等待 final patch 覆盖节点 voice_text
        // ============================================================
        const relevanceFieldSkeleton = preClusterField || this.buildNarrativeRelevanceField({
            nodes: selectedNodes,
            viewport,
            scaleLevel,
        });
        const selectedRegionsSkeletonRaw = selectedRegionSeeds.length > 0
            ? projectNarrativeRegionsToNodes({
                regions: selectedRegionSeeds,
                nodes: selectedNodes,
            })
            : buildNarrativeRegionClusters({
                nodes: selectedNodes,
                relevanceField: relevanceFieldSkeleton,
                summary: narrativeSummary,
            });
        const selectedRegionsSkeletonAligned = await this.expandNarrativeRegionMembersByWebFacts({
            regions: selectedRegionsSkeletonRaw,
            supportNodePool: selectedNodes,
            scaleLevel,
            context,
        });
        const selectedRegionsSkeleton = selectedRegionsSkeletonAligned.map((region) => this.materializeNarrativeRegionGlow(region));
        const transitionsSkeleton = buildNarrativeRegionTransitions(selectedRegionsSkeleton);
        const narrativeStepsSkeleton = buildNarrativeRegionStepsSkeleton({
            summary: narrativeSummary,
            regions: selectedRegionsSkeleton,
            transitions: transitionsSkeleton,
        });
        const generationId = `narrative:${writer.traceId}:${Date.now()}`;
        const skeletonEngineProfile = buildNarrativeEngineProfile({
            generationId,
            phase: 'skeleton',
            scaleLevel,
            renderMode,
            regions: selectedRegionsSkeleton,
            supportNodeCount: supportNodePool.length,
            temperature: 0,
            topP: 1,
            narration: 'deterministic_skeleton',
            steps: narrativeStepsSkeleton,
        });
        const skeletonStats = {
            surface: 'narrative',
            result_count: selectedRegionsSkeleton.length,
            candidate_count: supportNodePool.length,
            support_node_count: supportNodePool.length,
            region_candidate_count: regionCandidates.length,
            narrative_mode: rankResult.narrativeMode,
            tour_style: requestedStyle,
            tour_style_label: viewportSummary.requestedStyleLabel,
            scene_mix: viewportSummary.sceneMix,
            viewport_diagonal_m: viewportDiagonalM,
            scale_level: scaleLevel,
            render_mode: renderMode,
            phase: 'skeleton',
            duration_ms: Date.now() - startedAt,
        };
        const skeletonAnswer = buildNarrativeRegionAnswer({
            summary: narrativeSummary,
            regions: selectedRegionsSkeleton,
            steps: narrativeStepsSkeleton,
            transitions: transitionsSkeleton,
        });
        await writer.pois(normalizePoiPreview(selectedNodes.map((node) => ({
            id: node.id,
            name: node.name,
            categoryMain: node.categoryMain || null,
            categorySub: node.categorySub || null,
            longitude: node.center.lon,
            latitude: node.center.lat,
            distance_m: node.distanceM ?? null,
        }))));
        await writer.spatialClusters({
            hotspots: areaView.hotspots || [],
        });
        await writer.stats(skeletonStats);
        await writer.refinedResult({
            answer: skeletonAnswer,
            answer_source: 'narrative_skeleton_partial',
            results: {
                boundary,
                pois: selectedNodes.map((node) => toFeature(node)),
                spatial_clusters: {
                    hotspots: areaView.hotspots || [],
                },
                stats: skeletonStats,
                evidence_view: {
                    ...areaView,
                    meta: {
                        ...areaView.meta,
                        surface: 'narrative',
                        narrativeMode: rankResult.narrativeMode,
                        tourStyle: requestedStyle,
                        tourStyleLabel: narrativeSummary.requestedStyleLabel,
                        phase: 'skeleton',
                    },
                },
                narrative_tour: {
                    boundary,
                    viewport_summary: narrativeSummary,
                    macro_region_profile: narrativeSummary.macroRegionProfile || null,
                    macro_region_name: narrativeSummary.macroRegionName || null,
                    relevance_field: relevanceFieldSkeleton,
                    candidates: supportNodePool,
                    support_nodes: supportNodePool,
                    region_candidates: regionCandidates,
                    selected_nodes: selectedNodes,
                    selected_regions: selectedRegionsSkeleton,
                    narrative_engine: skeletonEngineProfile,
                    transitions: transitionsSkeleton,
                    narrative_mode: rankResult.narrativeMode,
                    tour_style: requestedStyle,
                    tour_style_label: narrativeSummary.requestedStyleLabel,
                    narrative_steps: narrativeStepsSkeleton,
                    render_mode: renderMode,
                    scale_level: scaleLevel,
                    phase: 'skeleton',
                },
            },
            intent: {
                ...buildEmptyIntentPayload(rawQuery),
                needsClarification: false,
                sceneMix: narrativeSummary.sceneMix,
            },
        });
        context.logger.info('narrative skeleton paint emitted', {
            selectedNodeCount: selectedNodes.length,
            selectedRegionCount: selectedRegionsSkeleton.length,
            evidenceRegionSeedCount: evidenceRegionSeeds.length,
            regionCandidateCount: regionCandidates.length,
            supportNodePoolCount: supportNodePool.length,
            skeletonDurationMs: Date.now() - startedAt,
            scaleLevel,
            renderMode,
            macroRegionName: narrativeSummary.macroRegionName?.primaryName || null,
        });
        // ============================================================
        // Final paint：边界补齐 + encoder + webFacts + LLM 解说
        //
        // 骨架发出后，对 selected nodes 依次完成：
        //   1) 边界补齐（enrichMissingBoundaries + enrichAggregateBoundaries）
        //   2) viewport boundary contract 过滤
        //   3) encoder enrichment（可选）
        //   4) web enrichment（联网事实补强）
        //   5) LLM narration（解说文案）
        // 完成后发 final patch，前端按 node_id 原位合并。
        // ============================================================
        // 阶段 1：边界补齐（仅对 selected nodes，而非全部候选）
        // macro 尺度用荧光场渲染，不需要硬边界，跳过整个 boundary 管线以节省 10-20s
        const skipBoundaryPipeline = scaleLevel === 'macro';
        if (skipBoundaryPipeline) {
            context.logger.info('narrative: macro scale — skipping boundary pipeline (enrichMissing / enrichAggregate / enforceViewport)');
        }
        await writer.stage('candidate_boundaries');
        await writer.thinking({
            status: 'start',
            message: skipBoundaryPipeline
                ? '宏观尺度，跳过边界生成…'
                : '正在为选中片区补齐可视边界...',
        });
        phaseStartedAt = Date.now();
        let boundarySurvivors = [];
        if (skipBoundaryPipeline) {
            // macro：保留所有节点，boundary 保持 null，center 即为视觉锚点
            boundarySurvivors = selectedNodes;
        }
        else {
            await this.enrichMissingBoundaries(selectedNodes, context);
            await this.enrichAggregateBoundaries(selectedNodes, viewport, context);
            boundarySurvivors = this.enforceViewportBoundaryContract(selectedNodes, viewport, context);
        }
        // 边界不合格的节点仍保留（center 可用），只是 boundary=null
        const nodesWithBoundary = selectedNodes.map((node) => {
            const survivor = boundarySurvivors.find((s) => s.id === node.id);
            return survivor || node;
        });
        timing.candidatePrepareMs = Date.now() - phaseStartedAt;
        await writer.thinking({ status: 'end', message: skipBoundaryPipeline ? '宏观尺度，边界已跳过' : '边界补齐完成' });
        // 阶段 2：encoder enrichment（可选）
        let encoderEnrichedNodes = nodesWithBoundary;
        if (useEncoder) {
            try {
                const encoderResult = await this.enrichCandidatesWithEncoder({
                    candidates: nodesWithBoundary,
                    center,
                    rawQuery,
                    areaView,
                    context,
                });
                if (encoderResult.length > 0) {
                    encoderEnrichedNodes = encoderResult;
                }
            }
            catch (error) {
                context.logger.warn('encoder enrichment failed for selected nodes', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        // 阶段 3：后置事实补强
        await writer.stage('web_enrichment');
        await writer.thinking({
            status: 'start',
            message: '正在为选中片区补充外部事实...',
        });
        phaseStartedAt = Date.now();
        const enrichedNodes = await this.enrichSelectedNodesWithWebFacts(encoderEnrichedNodes, narrativeSummary, context);
        timing.webEnrichmentMs = Date.now() - phaseStartedAt;
        await writer.thinking({ status: 'end', message: '事实补强完成' });
        // relevance_field：复用 skeleton 阶段算好的结果。
        // 从 skeleton 到 final 之间 anchor 的 center/role/score/source 都不变，
        // 只是 boundary/webFacts 被补强，因此 Gaussian field 不会变化，重算是浪费。
        const relevanceFieldFinal = relevanceFieldSkeleton;
        const selectedRegionsFinalRaw = selectedRegionSeeds.length > 0
            ? projectNarrativeRegionsToNodes({
                regions: selectedRegionSeeds,
                nodes: enrichedNodes,
            })
            : buildNarrativeRegionClusters({
                nodes: enrichedNodes,
                relevanceField: relevanceFieldFinal,
                summary: narrativeSummary,
            });
        const selectedRegionsFinal = await this.enrichSelectedRegionsWithWebFacts(selectedRegionsFinalRaw, narrativeSummary, context);
        const selectedRegionsFinalAlignedRaw = await this.expandNarrativeRegionMembersByWebFacts({
            regions: selectedRegionsFinal,
            supportNodePool: enrichedNodes,
            scaleLevel,
            context,
        });
        const selectedRegionsFinalAligned = selectedRegionsFinalAlignedRaw.map((region) => this.materializeNarrativeRegionGlow(region));
        const transitions = buildNarrativeRegionTransitions(selectedRegionsFinalAligned);
        let narrativeSteps = buildNarrativeRegionSteps({
            summary: narrativeSummary,
            regions: selectedRegionsFinalAligned,
            transitions,
        });
        // LLM macro 命名 + LLM 解说：两者互不依赖，并行执行节省一次 round-trip。
        // generateNarration 的 prompt 只读 summarySentence/sceneMix/requestedStyle，
        // 不依赖 macroRegionName，所以可以和命名同时发起。
        await writer.stage('llm_narration');
        await writer.thinking({
            status: 'start',
            message: '正在生成解说文案...',
        });
        phaseStartedAt = Date.now();
        const llmNarrationSeed = `${context.traceId}:${context.requestId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const [llmName, llmNarration] = await Promise.all([
            macroRegionProfile
                ? this.generateMacroRegionNameWithLlm(macroRegionProfile, context)
                : Promise.resolve(null),
            this.generateNarration({
                viewportSummary: narrativeSummary,
                regions: selectedRegionsFinalAligned,
                steps: narrativeSteps,
                transitions,
                context,
                generationId,
                variantSeed: llmNarrationSeed,
            }),
        ]);
        timing.llmNarrationMs = Date.now() - phaseStartedAt;
        let finalNarrativeSummary = narrativeSummary;
        if (llmName) {
            finalNarrativeSummary = {
                ...narrativeSummary,
                macroRegionName: llmName,
            };
            context.logger.info('macro region naming upgraded to LLM', {
                deterministicName: macroRegionNameDeterministic?.primaryName || null,
                llmName: llmName.primaryName,
            });
        }
        if (llmNarration) {
            narrativeSteps = narrativeSteps.map((step, index) => {
                if (index === 0 && llmNarration.overview) {
                    return { ...step, voice_text: llmNarration.overview, voiceTextSource: 'llm' };
                }
                const regionNarration = llmNarration.nodes?.[step.region_id || ''];
                if (regionNarration) {
                    return { ...step, voice_text: regionNarration, voiceTextSource: 'llm' };
                }
                return step;
            });
        }
        const finalEngineProfile = buildNarrativeEngineProfile({
            generationId,
            phase: 'final',
            scaleLevel,
            renderMode,
            regions: selectedRegionsFinalAligned,
            supportNodeCount: supportNodePool.length,
            temperature: resolveNarrativeLlmTemperature(),
            topP: resolveNarrativeLlmTopP(),
            variantSeed: llmNarration?.variantSeed || llmNarrationSeed,
            narrativeAngle: llmNarration?.narrativeAngle || null,
            wordingConstraint: llmNarration?.wordingConstraint || null,
            narration: llmNarration ? 'llm_contextual_variant' : 'deterministic_skeleton',
            steps: narrativeSteps,
        });
        await writer.thinking({ status: 'end', message: '解说文案已生成' });
        const answer = buildNarrativeRegionAnswer({
            summary: finalNarrativeSummary,
            regions: selectedRegionsFinalAligned,
            steps: narrativeSteps,
            transitions,
        });
        await writer.stage('tour_plan');
        await writer.thinking({
            status: 'end',
            message: '第一期导览骨架已经生成，正在整理镜头顺序...',
        });
        const stats = {
            surface: 'narrative',
            result_count: selectedRegionsFinalAligned.length,
            candidate_count: supportNodePool.length,
            support_node_count: supportNodePool.length,
            region_candidate_count: regionCandidates.length,
            narrative_mode: rankResult.narrativeMode,
            tour_style: requestedStyle,
            tour_style_label: finalNarrativeSummary.requestedStyleLabel,
            scene_mix: finalNarrativeSummary.sceneMix,
            viewport_diagonal_m: viewportDiagonalM,
            scale_level: scaleLevel,
            render_mode: renderMode,
            phase: 'final',
            duration_ms: Date.now() - startedAt,
        };
        context.logger.info('narrative timing summary', {
            ...timing,
            durationMs: Date.now() - startedAt,
            supportNodePoolCount: supportNodePool.length,
            regionCandidateCount: regionCandidates.length,
            boundarySurvivorCount: boundarySurvivors.length,
            selectedNodeCount: enrichedNodes.length,
            selectedRegionCount: selectedRegionsFinalAligned.length,
            scaleLevel,
            renderMode,
            macroRegionName: finalNarrativeSummary.macroRegionName?.primaryName || null,
            macroRegionNameSource: finalNarrativeSummary.macroRegionName?.source || null,
        });
        await writer.stage('answer');
        await writer.stats(stats);
        await writer.refinedResult({
            answer,
            answer_source: 'narrative_skeleton',
            results: {
                boundary,
                pois: enrichedNodes.map((node) => toFeature(node)),
                spatial_clusters: {
                    hotspots: areaView.hotspots || [],
                },
                stats,
                evidence_view: {
                    ...areaView,
                    meta: {
                        ...areaView.meta,
                        surface: 'narrative',
                        narrativeMode: rankResult.narrativeMode,
                        tourStyle: requestedStyle,
                        tourStyleLabel: finalNarrativeSummary.requestedStyleLabel,
                        phase: 'final',
                    },
                },
                narrative_tour: {
                    boundary,
                    viewport_summary: finalNarrativeSummary,
                    macro_region_profile: finalNarrativeSummary.macroRegionProfile || null,
                    macro_region_name: finalNarrativeSummary.macroRegionName || null,
                    relevance_field: relevanceFieldFinal,
                    candidates: supportNodePool,
                    support_nodes: supportNodePool,
                    region_candidates: regionCandidates,
                    selected_nodes: enrichedNodes,
                    selected_regions: selectedRegionsFinalAligned,
                    narrative_engine: finalEngineProfile,
                    transitions,
                    narrative_mode: rankResult.narrativeMode,
                    tour_style: requestedStyle,
                    tour_style_label: finalNarrativeSummary.requestedStyleLabel,
                    narrative_steps: narrativeSteps,
                    render_mode: renderMode,
                    scale_level: scaleLevel,
                    phase: 'final',
                },
            },
            intent: {
                ...buildEmptyIntentPayload(rawQuery),
                needsClarification: false,
                sceneMix: finalNarrativeSummary.sceneMix,
            },
        });
        await writer.done({
            duration_ms: Date.now() - startedAt,
        });
    }
    requireSkill(name) {
        const skill = this.options.registry.get(name);
        if (!skill) {
            throw new Error(`Missing required skill: ${name}`);
        }
        return skill;
    }
    async executeSkill(skill, action, payload, context) {
        const result = await skill.execute(action, payload, context);
        if (!result.ok || !result.data) {
            throw new Error(result.error?.message || `${skill.name}.${action} failed`);
        }
        return result.data;
    }
    resolveNarrativeRegionBucketSuffix(bucket) {
        if (bucket === '校园')
            return '科教文化区';
        if (bucket === '景观')
            return '景观休闲区';
        if (bucket === '商业')
            return '商业活力区';
        if (bucket === '文化' || bucket === '宗教')
            return '人文片区';
        if (bucket === '交通')
            return '交通连接区';
        return '片区';
    }
    isGenericNarrativeRegionName(name) {
        const normalized = normalizeName(name);
        if (!normalized)
            return true;
        return /^(?:右上|右下|左上|左下|中部|中心|北部|南部|东部|西部).*(?:片区|区域)(?:\s*\d+)?$/u.test(normalized)
            || /^热点\d+$/u.test(normalized);
    }
    extractNarrativeRegionLabelFromFacts(region) {
        const fact = region.webFacts;
        const supportNames = [...new Set(region.supportNames.map((name) => normalizeName(name)).filter(Boolean))];
        const titles = Array.isArray(fact?.titles) ? fact.titles : [];
        for (const rawTitle of titles) {
            const title = normalizeName(rawTitle)
                .replace(/[：:｜|—-].*$/u, '')
                .trim();
            if (!title)
                continue;
            const supportMatch = supportNames
                .slice()
                .sort((left, right) => right.length - left.length)
                .find((name) => title.includes(name) || name.includes(title));
            if (supportMatch && supportMatch.length <= 16)
                return supportMatch;
            if (title.length >= 2
                && title.length <= 16
                && !/(推荐|攻略|周边|附近|美食|打卡|值得去|怎么玩|游玩|合集|盘点|路线|导航|门票|开放时间)/u.test(title)
                && !isSyntheticDistrictConceptName(title)) {
                return title;
            }
        }
        return supportNames.find((name) => name.length <= 16) || supportNames[0] || null;
    }
    rewriteNarrativeRegionNameFromFacts(region) {
        const label = this.extractNarrativeRegionLabelFromFacts(region);
        if (!label) {
            return {
                ...region,
                spokenName: region.spokenName || region.name,
            };
        }
        const suffix = this.resolveNarrativeRegionBucketSuffix(region.dominantBucket);
        const nextName = /(片区|区域|地带|区)$/u.test(label) ? label : `${label}${suffix}`;
        if (!this.isGenericNarrativeRegionName(region.name) && normalizeName(region.name).includes(label)) {
            return {
                ...region,
                spokenName: region.spokenName || region.name,
            };
        }
        return {
            ...region,
            name: nextName,
            spokenName: nextName,
            summary: region.summary || `${label}共同支撑了这片区域。`,
        };
    }
    async buildRegionFirstSelection(input) {
        const evidenceRegionSeeds = this.buildEvidenceRegionSeeds({
            nodes: input.supportNodePool,
            poiSamples: input.poiSamples,
            brandPoolRows: input.brandPoolRows,
            aoiContext: input.aoiContext,
            hotspots: input.hotspots,
            scaleLevel: input.scaleLevel,
        });
        const relevanceField = this.buildNarrativeRelevanceField({
            nodes: input.supportNodePool,
            viewport: input.viewport,
            scaleLevel: input.scaleLevel,
        });
        const fieldRegions = buildNarrativeRegionClusters({
            nodes: input.supportNodePool,
            relevanceField,
            summary: input.summary,
        }).map((region, index) => ({
            ...region,
            regionClass: index < 2 ? 'primary' : 'support',
        }));
        const regionLimit = resolveScaleLevelRegionLimit(input.scaleLevel);
        const regionCandidatesMerged = this.mergeNarrativeRegionCandidates(evidenceRegionSeeds, fieldRegions);
        const preRankCandidateLimit = Math.min(regionCandidatesMerged.length, Math.max(regionLimit * 2, input.scaleLevel === 'macro' ? 6 : 5));
        const regionCandidates = await this.enrichSelectedRegionsWithWebFacts(regionCandidatesMerged, input.summary, input.context, {
            limitOverride: preRankCandidateLimit,
            resultLimitOverride: 2,
            extractEnabled: false,
            skipExistingFacts: true,
        });
        const expandedRegionSelection = await this.expandNarrativeRegionsWithWebAlignment({
            regions: regionCandidates,
            supportNodePool: input.supportNodePool,
            scaleLevel: input.scaleLevel,
            context: input.context,
            allowCreateNewNodes: true,
        });
        const supportNodePoolExpanded = this.mergeNarrativeSupportNodes(input.supportNodePool, expandedRegionSelection.recalledNodes);
        const rebuiltEvidenceRegionSeeds = expandedRegionSelection.recalledNodes.length > 0
            ? this.buildEvidenceRegionSeeds({
                nodes: supportNodePoolExpanded,
                poiSamples: input.poiSamples,
                brandPoolRows: input.brandPoolRows,
                aoiContext: input.aoiContext,
                hotspots: input.hotspots,
                scaleLevel: input.scaleLevel,
            })
            : evidenceRegionSeeds;
        const rebuiltRelevanceField = expandedRegionSelection.recalledNodes.length > 0
            ? this.buildNarrativeRelevanceField({
                nodes: supportNodePoolExpanded,
                viewport: input.viewport,
                scaleLevel: input.scaleLevel,
            })
            : relevanceField;
        const rebuiltFieldRegions = expandedRegionSelection.recalledNodes.length > 0
            ? buildNarrativeRegionClusters({
                nodes: supportNodePoolExpanded,
                relevanceField: rebuiltRelevanceField,
                summary: input.summary,
            }).map((region, index) => ({
                ...region,
                regionClass: index < 2 ? 'primary' : 'support',
            }))
            : fieldRegions;
        const rebuiltRegionCandidates = this.mergeNarrativeRegionCandidates(rebuiltEvidenceRegionSeeds, rebuiltFieldRegions);
        const regionCandidatesFinal = this.mergeNarrativeRegionCandidates(expandedRegionSelection.regions, rebuiltRegionCandidates);
        const selectedRegionSeeds = rankNarrativeRegions(regionCandidatesFinal, input.summary, regionLimit);
        const selectedRegionNodeIds = new Set(selectedRegionSeeds.flatMap((region) => region.nodeIds));
        const regionSupportPool = supportNodePoolExpanded.filter((node) => selectedRegionNodeIds.has(node.id));
        const rankResult = rankNarrativeNodes(regionSupportPool.length > 0 ? regionSupportPool : supportNodePoolExpanded, input.summary, input.nodeLimit);
        return {
            evidenceRegionSeeds: rebuiltEvidenceRegionSeeds,
            relevanceField: rebuiltRelevanceField,
            regionCandidates: regionCandidatesFinal,
            selectedRegionSeeds,
            rankResult,
            supportNodePool: supportNodePoolExpanded,
            selectedNodes: rankResult.selectedNodes,
        };
    }
    buildNarrativeRegionFactHaystack(region) {
        const fact = region.webFacts;
        const sourceItems = Array.isArray(fact?.sourceItems) ? fact.sourceItems : [];
        return [
            region.name,
            region.spokenName || '',
            region.summary || '',
            ...region.supportNames,
            ...(Array.isArray(fact?.labels) ? fact.labels : []),
            ...(Array.isArray(fact?.titles) ? fact.titles : []),
            ...(Array.isArray(fact?.snippets) ? fact.snippets : []),
            ...sourceItems.flatMap((item) => [item.title, item.snippet || '']),
            String(fact?.searchAnswer || ''),
        ]
            .map((item) => normalizeName(item)
            .replace(/[（(][^（）()]{0,24}[）)]/gu, '')
            .replace(/\s+/gu, '')
            .trim()
            .toLowerCase())
            .filter(Boolean)
            .join(' ');
    }
    projectNarrativeNodesToAlignmentLocalPois(nodes, region) {
        const maxDistanceM = region.dominantBucket === '校园' ? 3200 : region.dominantBucket === '景观' ? 3000 : 2400;
        return nodes
            .map((node) => {
            const distanceM = this.measurePoiDistanceM({ longitude: region.center.lon, latitude: region.center.lat }, { longitude: node.center.lon, latitude: node.center.lat });
            return {
                node,
                distanceM,
            };
        })
            .filter((item) => item.distanceM <= maxDistanceM)
            .sort((left, right) => left.distanceM - right.distanceM || right.node.score - left.node.score)
            .slice(0, 24)
            .map((item) => ({
            id: item.node.id,
            name: item.node.name,
            category: item.node.categorySub || item.node.categoryMain || item.node.roleLabel || null,
            categoryMain: item.node.categoryMain || item.node.roleLabel || null,
            categorySub: item.node.categorySub || null,
            longitude: item.node.center.lon,
            latitude: item.node.center.lat,
            distance_m: item.distanceM,
            score: item.node.score,
        }));
    }
    pickBestNarrativeAlignedNode(candidates, region) {
        if (candidates.length === 0)
            return null;
        return candidates
            .slice()
            .sort((left, right) => {
            const leftDistance = this.measurePoiDistanceM({ longitude: region.center.lon, latitude: region.center.lat }, { longitude: left.center.lon, latitude: left.center.lat });
            const rightDistance = this.measurePoiDistanceM({ longitude: region.center.lon, latitude: region.center.lat }, { longitude: right.center.lon, latitude: right.center.lat });
            return leftDistance - rightDistance || right.score - left.score;
        })[0] || null;
    }
    resolveNarrativeNodeFromAlignedLocalPoi(input) {
        if (!input.localPoi)
            return null;
        const rawId = input.localPoi.id;
        const localId = rawId == null ? '' : String(rawId).trim();
        if (localId) {
            const directNode = input.nodeById.get(localId);
            if (directNode)
                return directNode;
            const poiBoundNodes = input.nodeByPoiId.get(`poi:${localId}`) || [];
            const pickedPoiNode = this.pickBestNarrativeAlignedNode(poiBoundNodes, input.region);
            if (pickedPoiNode)
                return pickedPoiNode;
        }
        const entityKey = this.buildNarrativeEntityKey(String(input.localPoi.name || ''));
        if (!entityKey)
            return null;
        const entityNodes = input.nodeByEntityKey.get(entityKey) || [];
        return this.pickBestNarrativeAlignedNode(entityNodes, input.region);
    }
    buildNarrativeNodeFromAlignedLocalPoi(input) {
        const name = normalizeName(String(input.localPoi.name || ''));
        if (!name)
            return null;
        if (isSyntheticDistrictConceptName(name))
            return null;
        const categoryMainRaw = typeof input.localPoi.categoryMain === 'string'
            ? input.localPoi.categoryMain
            : typeof input.localPoi.category_main === 'string'
                ? input.localPoi.category_main
                : null;
        const categorySubRaw = typeof input.localPoi.categorySub === 'string'
            ? input.localPoi.categorySub
            : typeof input.localPoi.category_sub === 'string'
                ? input.localPoi.category_sub
                : typeof input.localPoi.category === 'string'
                    ? input.localPoi.category
                    : null;
        const categoryMain = String(categoryMainRaw || '').trim() || null;
        const categorySub = String(categorySubRaw || '').trim() || null;
        const lon = Number(input.localPoi.longitude);
        const lat = Number(input.localPoi.latitude);
        if (!Number.isFinite(lon) || !Number.isFinite(lat))
            return null;
        const semanticText = [name, categoryMain, categorySub].filter(Boolean).join(' ');
        if (looksResidentialSemantic(semanticText))
            return null;
        if (/^(公共类|餐饮类|购物类|住宿类|交通类|教育类|景观类|公共服务|生活服务|购物服务|餐饮服务|住宿服务|交通设施服务|公共设施|公司企业|商务住宅|住宅区|教育培训|教育服务|科教文化服务|风景名胜|地名地址信息)$/u.test(name)) {
            return null;
        }
        const distanceM = this.measurePoiDistanceM({ longitude: input.region.center.lon, latitude: input.region.center.lat }, { longitude: lon, latitude: lat });
        const maxDistanceM = input.region.dominantBucket === '校园' ? 3200 : input.region.dominantBucket === '景观' ? 3000 : 2400;
        if (distanceM > maxDistanceM)
            return null;
        const evidenceItem = {
            id: typeof input.localPoi.id === 'string' || typeof input.localPoi.id === 'number' ? input.localPoi.id : null,
            name,
            category: categorySub || categoryMain,
            categoryMain,
            categorySub,
            longitude: lon,
            latitude: lat,
            distance_m: distanceM,
            score: Number.isFinite(Number(input.localPoi.score)) ? Number(input.localPoi.score) : null,
        };
        const role = resolveNodeRoleFromPoi(evidenceItem);
        const proximityBoost = Math.max(0, 1 - distanceM / maxDistanceM) * 0.14;
        const confidenceBoost = Math.min(Math.max(Number(input.fusionScore || 0), 0), 1) * 0.18;
        const verificationBoost = input.verification === 'dual_verified' ? 0.14 : 0.04;
        const rawId = input.localPoi.id;
        const localId = rawId == null ? '' : String(rawId).trim();
        const entityKey = this.buildNarrativeEntityKey(name);
        return {
            id: `recall:poi:${localId || entityKey || name}`,
            name,
            role,
            roleLabel: resolveRoleLabel(role),
            source: 'representative_sample',
            center: { lon, lat },
            score: Number((resolveRoleWeight(role) + verificationBoost + confidenceBoost + proximityBoost).toFixed(3)),
            categoryMain,
            categorySub,
            distanceM,
            tags: [role, categoryMain || '', categorySub || '', 'web_recalled_poi', `alignment:${input.verification}`].filter(Boolean),
            reasons: [resolveRoleLabel(role), input.verification === 'dual_verified' ? '网页事实对齐召回' : '数据库回查召回'].filter(Boolean),
            hotness: input.verification === 'dual_verified' ? 'medium' : 'low',
            childPoiIds: [`poi:${localId || name}`],
            memberPoints: [{ lon, lat }],
        };
    }
    mergeNarrativeSupportNodes(primary, extra) {
        const merged = [...primary];
        for (const candidate of extra) {
            if (!candidate)
                continue;
            const candidateKey = this.buildNarrativeEntityKey(candidate.name);
            const existingIndex = merged.findIndex((existing) => {
                if (existing.id === candidate.id)
                    return true;
                const existingKey = this.buildNarrativeEntityKey(existing.name);
                if (!candidateKey || !existingKey || candidateKey !== existingKey)
                    return false;
                const distanceM = this.measurePoiDistanceM({ longitude: existing.center.lon, latitude: existing.center.lat }, { longitude: candidate.center.lon, latitude: candidate.center.lat });
                return distanceM <= 260;
            });
            if (existingIndex === -1) {
                merged.push(candidate);
                continue;
            }
            const existing = merged[existingIndex];
            const existingStrength = ((existing.source === 'aoi_context' ? 4 : existing.source === 'brand_cluster' ? 3 : existing.source === 'cell_entity' ? 2 : 1)
                + Number(existing.score || 0));
            const candidateStrength = ((candidate.source === 'aoi_context' ? 4 : candidate.source === 'brand_cluster' ? 3 : candidate.source === 'cell_entity' ? 2 : 1)
                + Number(candidate.score || 0));
            if (candidateStrength <= existingStrength)
                continue;
            merged[existingIndex] = {
                ...candidate,
                tags: [...new Set([...(existing.tags || []), ...(candidate.tags || [])])],
                reasons: [...new Set([...(existing.reasons || []), ...(candidate.reasons || [])])],
                childPoiIds: [...new Set([...(existing.childPoiIds || []), ...(candidate.childPoiIds || [])])],
                memberPoints: [...(existing.memberPoints || []), ...(candidate.memberPoints || [])],
                boundary: existing.boundary || candidate.boundary || null,
            };
        }
        return merged;
    }
    async alignNarrativeRegionMembersWithEntityAlignment(input) {
        const alignmentSkill = this.options.registry.get('entity_alignment');
        if (!alignmentSkill || !input.region.webFacts) {
            return {
                matchedNodes: [],
                recalledNodes: [],
            };
        }
        const webResults = buildNarrativeRegionAlignmentWebResults(input.region);
        if (webResults.length === 0) {
            return {
                matchedNodes: [],
                recalledNodes: [],
            };
        }
        const localPois = this.projectNarrativeNodesToAlignmentLocalPois(input.supportNodePool, input.region);
        const nodeById = new Map(input.supportNodePool.map((node) => [String(node.id), node]));
        const nodeByPoiId = new Map();
        const nodeByEntityKey = new Map();
        const haystack = this.buildNarrativeRegionFactHaystack(input.region);
        for (const node of input.supportNodePool) {
            for (const childPoiId of Array.isArray(node.childPoiIds) ? node.childPoiIds : []) {
                const bucket = nodeByPoiId.get(String(childPoiId)) || [];
                bucket.push(node);
                nodeByPoiId.set(String(childPoiId), bucket);
            }
            const entityKey = this.buildNarrativeEntityKey(node.name);
            if (!entityKey)
                continue;
            const bucket = nodeByEntityKey.get(entityKey) || [];
            bucket.push(node);
            nodeByEntityKey.set(entityKey, bucket);
        }
        try {
            const result = await this.executeSkill(alignmentSkill, 'align_and_rank', {
                web_results: webResults,
                local_pois: localPois,
                max_results: 8,
                search_driven_local_recall: true,
                disable_distance_bias: false,
            }, input.context);
            const ranked = Array.isArray(result?.ranked_results) ? result.ranked_results : [];
            const matchedNodes = [];
            const recalledNodes = [];
            for (const item of ranked) {
                const verification = String(item?.verification || '').trim();
                if (verification !== 'dual_verified' && verification !== 'local_only')
                    continue;
                const fusionScore = Number(item?.fusionScore || 0);
                if (fusionScore < 0.42)
                    continue;
                const localPoi = item?.localPoi && typeof item.localPoi === 'object'
                    ? item.localPoi
                    : null;
                if (!localPoi)
                    continue;
                if (verification === 'local_only') {
                    const localName = normalizeName(String(localPoi.name || ''))
                        .replace(/[（(][^（）()]{0,24}[）)]/gu, '')
                        .replace(/\s+/gu, '')
                        .trim()
                        .toLowerCase();
                    const localKey = this.buildNarrativeEntityKey(String(localPoi.name || ''));
                    const hasFactSupport = Boolean((localKey && localKey.length >= 4 && haystack.includes(localKey))
                        || (localName && localName.length >= 4 && haystack.includes(localName)));
                    if (!hasFactSupport)
                        continue;
                }
                const resolvedNode = this.resolveNarrativeNodeFromAlignedLocalPoi({
                    region: input.region,
                    localPoi,
                    nodeById,
                    nodeByPoiId,
                    nodeByEntityKey,
                });
                if (resolvedNode) {
                    matchedNodes.push(resolvedNode);
                    continue;
                }
                if (!input.allowCreateNewNodes)
                    continue;
                const recalledNode = this.buildNarrativeNodeFromAlignedLocalPoi({
                    region: input.region,
                    localPoi,
                    verification,
                    fusionScore,
                });
                if (recalledNode)
                    recalledNodes.push(recalledNode);
            }
            return {
                matchedNodes: [...new Map(matchedNodes.map((node) => [node.id, node])).values()].slice(0, 3),
                recalledNodes: this.mergeNarrativeSupportNodes([], recalledNodes).slice(0, 4),
            };
        }
        catch {
            return {
                matchedNodes: [],
                recalledNodes: [],
            };
        }
    }
    async expandNarrativeRegionsWithWebAlignment(input) {
        const maxDistanceM = input.scaleLevel === 'macro' ? 2600 : input.scaleLevel === 'meso' ? 1700 : 1100;
        const maxExtraNodes = input.scaleLevel === 'macro' ? 3 : input.scaleLevel === 'meso' ? 2 : 1;
        const settled = await Promise.all(input.regions.map(async (region) => {
            if (!region.webFacts)
                return { region, recalledNodes: [] };
            const haystack = this.buildNarrativeRegionFactHaystack(region);
            const alignmentResult = await this.alignNarrativeRegionMembersWithEntityAlignment({
                region,
                supportNodePool: input.supportNodePool,
                context: input.context,
                allowCreateNewNodes: input.allowCreateNewNodes,
            });
            if (!haystack && alignmentResult.matchedNodes.length === 0 && alignmentResult.recalledNodes.length === 0) {
                return { region, recalledNodes: alignmentResult.recalledNodes };
            }
            const existingNodeIds = new Set(region.nodeIds);
            const supportKeys = new Set(region.supportNames.map((name) => this.buildNarrativeEntityKey(name)).filter(Boolean));
            const candidateSupportPool = input.allowCreateNewNodes
                ? this.mergeNarrativeSupportNodes(input.supportNodePool, alignmentResult.recalledNodes)
                : input.supportNodePool;
            const heuristicNodes = haystack
                ? candidateSupportPool
                    .map((node) => {
                    if (existingNodeIds.has(node.id))
                        return null;
                    const entityKey = this.buildNarrativeEntityKey(node.name);
                    if (!entityKey || entityKey.length < 3 || supportKeys.has(entityKey))
                        return null;
                    const rawName = normalizeName(node.name)
                        .replace(/[（(][^（）()]{0,24}[）)]/gu, '')
                        .replace(/\s+/gu, '')
                        .trim()
                        .toLowerCase();
                    const rawMatch = rawName.length >= 4 && haystack.includes(rawName);
                    const keyMatch = entityKey.length >= 4 && haystack.includes(entityKey);
                    if (!rawMatch && !keyMatch)
                        return null;
                    const distanceM = this.measurePoiDistanceM({ longitude: region.center.lon, latitude: region.center.lat }, { longitude: node.center.lon, latitude: node.center.lat });
                    if (distanceM > maxDistanceM)
                        return null;
                    const bucket = this.resolveNarrativeNodeBucket(node);
                    const sameBucket = !region.dominantBucket || region.dominantBucket === '复合' || bucket === region.dominantBucket;
                    if (!sameBucket && distanceM > maxDistanceM * 0.7)
                        return null;
                    const score = Number((((keyMatch ? 1.2 : 0.72)
                        + (sameBucket ? 0.55 : 0)
                        + Math.max(0, 1 - distanceM / maxDistanceM) * 0.5
                        + Math.min(Number(node.score || 0), 2.4))).toFixed(3));
                    return { node, score };
                })
                    .filter((item) => Boolean(item))
                    .sort((left, right) => right.score - left.score)
                    .slice(0, maxExtraNodes)
                    .map((item) => item.node)
                : [];
            const matchedNodes = [...new Map([
                    ...alignmentResult.matchedNodes.filter((node) => !existingNodeIds.has(node.id)).map((node) => [node.id, node]),
                    ...alignmentResult.recalledNodes.filter((node) => !existingNodeIds.has(node.id)).map((node) => [node.id, node]),
                    ...heuristicNodes.filter((node) => !existingNodeIds.has(node.id)).map((node) => [node.id, node]),
                ]).values()].slice(0, maxExtraNodes + (alignmentResult.recalledNodes.length > 0 ? 1 : 0));
            if (matchedNodes.length === 0)
                return { region, recalledNodes: alignmentResult.recalledNodes };
            const nodes = [...region.nodes, ...matchedNodes];
            const nodeIds = [...new Set(nodes.map((node) => node.id))];
            const supportNames = [...new Set([
                    ...region.supportNames,
                    ...matchedNodes.map((node) => normalizeName(node.name)).filter(Boolean),
                ])].slice(0, 6);
            const dominantBuckets = [...new Set(nodes.map((node) => this.resolveNarrativeNodeBucket(node)).filter(Boolean))];
            const dominantBucket = dominantBuckets[0] || region.dominantBucket || '复合';
            const nextRegion = {
                ...region,
                nodes,
                nodeIds,
                nodeCount: Math.max(region.nodeCount, nodeIds.length),
                supportNames,
                dominantBuckets,
                dominantBucket,
            };
            return {
                region: this.materializeNarrativeRegionGlow({
                    ...nextRegion,
                }),
                recalledNodes: alignmentResult.recalledNodes,
            };
        }));
        return {
            regions: settled.map((item) => item.region),
            recalledNodes: this.mergeNarrativeSupportNodes([], settled.flatMap((item) => item.recalledNodes)),
        };
    }
    expandNarrativeRegionMembersByWebFacts(input) {
        return this.expandNarrativeRegionsWithWebAlignment({
            ...input,
            allowCreateNewNodes: false,
        }).then((result) => result.regions);
    }
    resolveNarrativeNodeBucket(node) {
        return this.inferSceneBucketFromText([
            node.name,
            node.role,
            node.roleLabel,
            node.categoryMain,
            node.categorySub,
            ...(Array.isArray(node.tags) ? node.tags : []),
        ].filter(Boolean).join(' '));
    }
    collectNarrativeSeedNearbyNodes(input) {
        return input.nodes
            .map((node) => {
            const distanceM = this.measurePoiDistanceM({ longitude: input.center.lon, latitude: input.center.lat }, { longitude: node.center.lon, latitude: node.center.lat });
            const bucket = this.resolveNarrativeNodeBucket(node);
            const sameBucket = !input.bucketHint || bucket === input.bucketHint;
            return { node, distanceM, sameBucket };
        })
            .filter((item) => item.distanceM <= input.maxDistanceM && (item.sameBucket || item.distanceM <= input.maxDistanceM * 0.58))
            .sort((left, right) => left.distanceM - right.distanceM || right.node.score - left.node.score)
            .slice(0, Math.max(1, input.limit))
            .map((item) => item.node);
    }
    buildEvidenceRegionSeed(input) {
        const nodeById = new Map();
        input.nodes
            .slice()
            .sort((left, right) => right.score - left.score)
            .forEach((node) => {
            if (!nodeById.has(node.id))
                nodeById.set(node.id, node);
        });
        const regionNodes = [...nodeById.values()];
        if (regionNodes.length === 0)
            return null;
        const dominantBuckets = [...new Set(regionNodes.map((node) => this.resolveNarrativeNodeBucket(node)).filter(Boolean))];
        const dominantBucket = dominantBuckets[0] || input.bucketHint || '复合';
        const supportNames = [...new Set(regionNodes.map((node) => normalizeName(node.name)).filter(Boolean))].slice(0, 5);
        const rawLabel = normalizeName(input.label) || supportNames[0] || '当前区域';
        let name = rawLabel;
        if (!/(片区|区域|地带|区)$/u.test(name)) {
            if (dominantBucket === '校园')
                name = `${rawLabel}科教文化区`;
            else if (dominantBucket === '景观')
                name = `${rawLabel}景观休闲区`;
            else if (dominantBucket === '商业')
                name = `${rawLabel}商业活力区`;
            else if (dominantBucket === '文化' || dominantBucket === '宗教')
                name = `${rawLabel}人文片区`;
            else if (dominantBucket === '交通')
                name = `${rawLabel}交通连接区`;
            else
                name = `${rawLabel}片区`;
        }
        return {
            id: input.id,
            name,
            spokenName: name,
            regionClass: input.hotspots?.length || regionNodes.length >= 4 ? 'primary' : 'support',
            center: input.center,
            quadrant: 'evidence',
            nodes: regionNodes,
            nodeIds: regionNodes.map((node) => node.id),
            nodeCount: regionNodes.length,
            dominantBucket,
            dominantBuckets,
            supportNames,
            anchors: [],
            hotspots: input.hotspots || [],
            summary: `${supportNames.slice(0, 3).join('、') || name}共同支撑了这片区域。`,
            boundary: regionNodes.find((node) => node.boundary)?.boundary || input.boundary || null,
        };
    }
    resolveEvidenceHotspot(row) {
        const lon = Number(row.center_lon || row.centerLon || row.longitude || row.lon);
        const lat = Number(row.center_lat || row.centerLat || row.latitude || row.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat))
            return null;
        const intensity = Number(row.intensity || row.score || row.weight || 0.72);
        const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat);
        return {
            center: { lon: gcjLon, lat: gcjLat },
            intensity: Number.isFinite(intensity) ? intensity : 0.72,
        };
    }
    buildEvidenceRegionSeeds(input) {
        if (input.nodes.length === 0)
            return [];
        const nodeByEntityKey = new Map();
        for (const node of input.nodes) {
            const entityKey = this.buildNarrativeEntityKey(node.name);
            if (!entityKey)
                continue;
            const bucket = nodeByEntityKey.get(entityKey) || [];
            bucket.push(node);
            nodeByEntityKey.set(entityKey, bucket);
        }
        const regionSeeds = [];
        const mergedPois = this.mergePoisWithBrandPool(input.poiSamples, input.brandPoolRows);
        const brandClusters = clusterPoisByBrand(mergedPois)
            .filter(isBrandClusterEligible)
            .filter((cluster) => this.shouldKeepNarrativeBrandCluster(cluster, input.aoiContext));
        for (const cluster of brandClusters) {
            const entityKey = this.buildNarrativeEntityKey(cluster.brand);
            const matchedNodes = entityKey ? (nodeByEntityKey.get(entityKey) || []) : [];
            const bucketHint = this.inferSceneBucketFromText(`${cluster.brand} ${resolveBrandCategoryLabel(cluster.type)}`);
            const supportNodes = this.collectNarrativeSeedNearbyNodes({
                nodes: input.nodes,
                center: cluster.center,
                bucketHint,
                maxDistanceM: input.scaleLevel === 'macro' ? 1800 : 1200,
                limit: input.scaleLevel === 'macro' ? 5 : 4,
            });
            const seed = this.buildEvidenceRegionSeed({
                id: `seed:brand:${cluster.type}:${entityKey || normalizeName(cluster.brand)}`,
                label: cluster.brand,
                center: matchedNodes[0]?.center || cluster.center,
                nodes: [...matchedNodes, ...supportNodes],
                bucketHint,
            });
            if (seed)
                regionSeeds.push(seed);
        }
        const groupedAoiContext = new Map();
        for (const item of input.aoiContext) {
            const entityKey = this.buildNarrativeEntityKey(String(item.name || ''));
            if (!entityKey)
                continue;
            const bucket = groupedAoiContext.get(entityKey) || [];
            bucket.push(item);
            groupedAoiContext.set(entityKey, bucket);
        }
        for (const [entityKey, items] of groupedAoiContext.entries()) {
            const matchedNodes = nodeByEntityKey.get(entityKey) || [];
            const bestItem = this.pickBestNarrativeAoiCandidate(items, matchedNodes[0] || null);
            if (!bestItem)
                continue;
            const lon = Number(bestItem.longitude);
            const lat = Number(bestItem.latitude);
            if (!Number.isFinite(lon) || !Number.isFinite(lat))
                continue;
            const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat);
            const label = normalizeName(bestItem.name);
            const bucketHint = this.inferSceneBucketFromText(`${label} ${String(bestItem.fclass || '')}`);
            const supportNodes = this.collectNarrativeSeedNearbyNodes({
                nodes: input.nodes,
                center: { lon: gcjLon, lat: gcjLat },
                bucketHint,
                maxDistanceM: input.scaleLevel === 'macro' ? 2000 : 1300,
                limit: input.scaleLevel === 'macro' ? 5 : 4,
            });
            const seed = this.buildEvidenceRegionSeed({
                id: `seed:aoi:${entityKey}`,
                label,
                center: matchedNodes[0]?.center || { lon: gcjLon, lat: gcjLat },
                nodes: [...matchedNodes, ...supportNodes],
                bucketHint,
            });
            if (seed)
                regionSeeds.push(seed);
        }
        input.hotspots.forEach((row, index) => {
            const hotspot = this.resolveEvidenceHotspot(row);
            if (!hotspot)
                return;
            const supportNodes = this.collectNarrativeSeedNearbyNodes({
                nodes: input.nodes,
                center: hotspot.center,
                bucketHint: null,
                maxDistanceM: input.scaleLevel === 'macro' ? 2400 : 1400,
                limit: input.scaleLevel === 'macro' ? 5 : 4,
            });
            if (supportNodes.length < 2)
                return;
            const seed = this.buildEvidenceRegionSeed({
                id: `seed:hotspot:${index + 1}`,
                label: supportNodes[0]?.name || `热点${index + 1}`,
                center: hotspot.center,
                nodes: supportNodes,
                hotspots: [hotspot],
            });
            if (seed)
                regionSeeds.push(seed);
        });
        return this.mergeNarrativeRegionCandidates(regionSeeds, []);
    }
    mergeNarrativeRegionCandidates(primary, fallback) {
        const merged = [];
        for (const candidate of [...primary, ...fallback]) {
            if (!candidate || candidate.nodeIds.length === 0)
                continue;
            const existingIndex = merged.findIndex((existing) => {
                const overlapCount = existing.nodeIds.filter((nodeId) => candidate.nodeIds.includes(nodeId)).length;
                const minCount = Math.min(existing.nodeIds.length, candidate.nodeIds.length);
                if (minCount > 0 && overlapCount / minCount >= 0.6)
                    return true;
                const sameSupport = existing.supportNames.some((leftName) => {
                    const leftKey = this.buildNarrativeEntityKey(leftName);
                    if (!leftKey)
                        return false;
                    return candidate.supportNames.some((rightName) => this.buildNarrativeEntityKey(rightName) === leftKey);
                });
                if (sameSupport)
                    return true;
                const distanceM = this.measurePoiDistanceM({ longitude: existing.center.lon, latitude: existing.center.lat }, { longitude: candidate.center.lon, latitude: candidate.center.lat });
                return distanceM <= 800 && existing.dominantBucket === candidate.dominantBucket;
            });
            if (existingIndex === -1) {
                merged.push(candidate);
                continue;
            }
            const existing = merged[existingIndex];
            const currentRank = candidate.regionClass === 'primary' ? 3 : candidate.regionClass === 'support' ? 2 : 1;
            const existingRank = existing.regionClass === 'primary' ? 3 : existing.regionClass === 'support' ? 2 : 1;
            if (currentRank > existingRank || (currentRank === existingRank && candidate.nodeCount > existing.nodeCount)) {
                merged[existingIndex] = {
                    ...existing,
                    ...candidate,
                    nodes: candidate.nodes.length >= existing.nodes.length ? candidate.nodes : existing.nodes,
                    nodeIds: candidate.nodeIds.length >= existing.nodeIds.length ? candidate.nodeIds : existing.nodeIds,
                    nodeCount: Math.max(existing.nodeCount, candidate.nodeCount),
                    supportNames: candidate.supportNames.length >= existing.supportNames.length ? candidate.supportNames : existing.supportNames,
                    hotspots: candidate.hotspots.length >= existing.hotspots.length ? candidate.hotspots : existing.hotspots,
                    anchors: candidate.anchors.length >= existing.anchors.length ? candidate.anchors : existing.anchors,
                    boundary: candidate.boundary || existing.boundary || null,
                    glowBoundary: candidate.glowBoundary || existing.glowBoundary || candidate.boundary || existing.boundary || null,
                    webFacts: candidate.webFacts || existing.webFacts || null,
                };
            }
        }
        return merged;
    }
    buildNarrativeRegionGlowBoundary(region, options) {
        const pointPool = region.nodes
            .flatMap((node) => {
            const memberPoints = Array.isArray(node.memberPoints) ? node.memberPoints : [];
            if (memberPoints.length > 0)
                return memberPoints;
            return [node.center];
        })
            .filter((point) => Number.isFinite(point?.lon) && Number.isFinite(point?.lat));
        if (pointPool.length === 0)
            return null;
        const semanticCenter = region.center || pointPool[0];
        const lonFactor = 111_320 * Math.max(Math.cos(semanticCenter.lat * Math.PI / 180), 0.2);
        const latFactor = 110_540;
        const percentile = Number.isFinite(Number(options?.percentile))
            ? Math.max(0.18, Math.min(0.96, Number(options?.percentile)))
            : 0.78;
        const paddingM = Number.isFinite(Number(options?.paddingM))
            ? Number(options?.paddingM)
            : (region.dominantBucket === '交通' ? 220 : 420);
        const radiusScale = Number.isFinite(Number(options?.radiusScale))
            ? Number(options?.radiusScale)
            : 1;
        const noiseScale = Number.isFinite(Number(options?.noiseScale))
            ? Number(options?.noiseScale)
            : 0.055;
        const supportScale = Number.isFinite(Number(options?.supportScale))
            ? Number(options?.supportScale)
            : 0.08;
        const minRadiusM = Number.isFinite(Number(options?.minRadiusM))
            ? Number(options?.minRadiusM)
            : (region.dominantBucket === '校园' ? 420 : 320);
        const maxRadiusM = Number.isFinite(Number(options?.maxRadiusM))
            ? Number(options?.maxRadiusM)
            : 2600;
        const pointsWithDistance = pointPool.map((point) => {
            const dx = (point.lon - semanticCenter.lon) * lonFactor;
            const dy = (point.lat - semanticCenter.lat) * latFactor;
            return { point, distanceM: Math.sqrt(dx * dx + dy * dy) };
        });
        const sortedDistances = pointsWithDistance.map((item) => item.distanceM).sort((a, b) => a - b);
        const percentileIndex = Math.min(sortedDistances.length - 1, Math.max(0, Math.floor(sortedDistances.length * percentile)));
        const semanticRadiusM = Math.max(minRadiusM, Math.min(maxRadiusM, ((sortedDistances[percentileIndex] || 0) + paddingM) * radiusScale));
        const segments = 48;
        const dominantBucket = String(region.dominantBucket || '');
        const bucketStretch = dominantBucket === '校园' || dominantBucket === '景观' ? 1.18 : dominantBucket === '交通' ? 1.34 : 1.08;
        const bucketSquash = dominantBucket === '交通' ? 0.74 : 0.92;
        const ring = [];
        for (let index = 0; index <= segments; index += 1) {
            const angle = (2 * Math.PI * index) / segments;
            const directionalSupport = pointsWithDistance.reduce((sum, item) => {
                const dx = (item.point.lon - semanticCenter.lon) * lonFactor;
                const dy = (item.point.lat - semanticCenter.lat) * latFactor;
                const length = Math.sqrt(dx * dx + dy * dy);
                if (!(length > 0))
                    return sum;
                const alignment = Math.max(0, (Math.cos(angle) * dx + Math.sin(angle) * dy) / length);
                return sum + alignment * Math.max(0, 1 - item.distanceM / Math.max(semanticRadiusM * 1.35, 1));
            }, 0);
            const supportBoost = Math.min(0.32 * Math.max(0.6, radiusScale), directionalSupport * supportScale);
            const organicNoise = noiseScale * Math.sin(angle * 3 + region.id.length) + Math.max(noiseScale * 0.64, 0.012) * Math.cos(angle * 5 + region.nodeCount);
            const radiusM = semanticRadiusM * (1 + supportBoost + organicNoise);
            ring.push([
                semanticCenter.lon + (radiusM * bucketStretch * Math.cos(angle)) / lonFactor,
                semanticCenter.lat + (radiusM * bucketSquash * Math.sin(angle)) / latFactor,
            ]);
        }
        return {
            type: 'Polygon',
            coordinates: [ring],
            source: 'soft_relevance_hull',
        };
    }
    buildNarrativeRegionGlowLayers(region) {
        const layers = [];
        const seen = new Set();
        const pushLayer = (tier, intensity, boundary) => {
            if (!boundary)
                return;
            const key = `${tier}:${boundary.source}:${JSON.stringify(boundary.coordinates)}`;
            if (seen.has(key))
                return;
            seen.add(key);
            layers.push({
                id: `${region.id}:${tier}`,
                tier,
                intensity,
                boundary,
                source: boundary.source,
            });
        };
        const coreBoundary = region.boundary || this.buildNarrativeRegionGlowBoundary(region, {
            percentile: 0.46,
            paddingM: region.dominantBucket === '交通' ? 90 : 140,
            radiusScale: 0.72,
            noiseScale: 0.018,
            supportScale: 0.035,
            minRadiusM: region.dominantBucket === '校园' ? 180 : 140,
            maxRadiusM: region.dominantBucket === '交通' ? 820 : 980,
        });
        const innerBoundary = this.buildNarrativeRegionGlowBoundary(region, {
            percentile: 0.66,
            paddingM: region.dominantBucket === '交通' ? 140 : 220,
            radiusScale: 0.88,
            noiseScale: 0.028,
            supportScale: 0.052,
            minRadiusM: region.dominantBucket === '校园' ? 300 : 220,
            maxRadiusM: 1680,
        });
        const outerBoundary = this.buildNarrativeRegionGlowBoundary(region, {
            percentile: 0.86,
            paddingM: region.dominantBucket === '交通' ? 260 : 520,
            radiusScale: 1.08,
            noiseScale: 0.046,
            supportScale: 0.072,
            minRadiusM: region.dominantBucket === '校园' ? 420 : 320,
            maxRadiusM: 2800,
        });
        pushLayer('outer', 0.34, outerBoundary);
        pushLayer('inner', 0.62, innerBoundary);
        pushLayer('core', 1, coreBoundary);
        return layers;
    }
    materializeNarrativeRegionGlow(region) {
        const glowLayers = Array.isArray(region.glowLayers) && region.glowLayers.length > 0
            ? region.glowLayers
            : this.buildNarrativeRegionGlowLayers(region);
        const glowBoundary = glowLayers.find((layer) => layer.tier === 'outer')?.boundary
            || glowLayers[0]?.boundary
            || region.glowBoundary
            || region.boundary
            || this.buildNarrativeRegionGlowBoundary(region);
        return {
            ...region,
            glowBoundary,
            glowLayers,
        };
    }
    async enrichSelectedRegionsWithWebFacts(regions, summary, context, options) {
        const searchSkill = this.options.registry.get('tavily_search') || this.options.registry.get('multi_search_engine');
        if (!searchSkill || regions.length === 0) {
            return regions.map((region) => this.materializeNarrativeRegionGlow(this.rewriteNarrativeRegionNameFromFacts({
                ...region,
            })));
        }
        const action = searchSkill.name === 'tavily_search' ? 'search_web' : 'search_multi';
        const requestedRegionLimit = Number(options?.limitOverride);
        const regionLimit = Math.min(Number.isFinite(requestedRegionLimit) && requestedRegionLimit >= 0
            ? Math.floor(requestedRegionLimit)
            : resolveNonNegativeInteger(process.env.NARRATIVE_WEB_FACT_REGION_LIMIT, DEFAULT_NARRATIVE_WEB_FACT_REGION_LIMIT), regions.length);
        if (regionLimit === 0) {
            return regions.map((region) => this.materializeNarrativeRegionGlow(this.rewriteNarrativeRegionNameFromFacts({
                ...region,
            })));
        }
        const targetPool = options?.skipExistingFacts ? regions.filter((region) => !region.webFacts) : regions;
        const targetRegions = targetPool.slice(0, regionLimit);
        const tavilyApiKeys = resolveTavilyApiKeys();
        const extractEnabled = options?.extractEnabled !== false;
        const extractClient = extractEnabled && searchSkill.name === 'tavily_search' && tavilyApiKeys.length > 0
            ? new TavilyExtractClient({
                apiKeys: tavilyApiKeys,
                timeoutMs: DEFAULT_NARRATIVE_WEB_FACT_EXTRACT_TIMEOUT_MS,
            })
            : null;
        const requestedResultLimit = Number(options?.resultLimitOverride);
        const resultLimit = Math.max(1, Number.isFinite(requestedResultLimit) && requestedResultLimit > 0
            ? Math.floor(requestedResultLimit)
            : resolveNonNegativeInteger(process.env.NARRATIVE_WEB_FACT_RESULT_LIMIT, DEFAULT_NARRATIVE_WEB_FACT_RESULT_LIMIT));
        const resultsPerRegion = new Map();
        const settled = await Promise.allSettled(targetRegions.map(async (region) => {
            const queries = buildNarrativeRegionWebQueries(region, summary);
            const query = queries[0] || region.name;
            try {
                const result = await this.executeSkill(searchSkill, action, {
                    query,
                    queries,
                    max_results: resultLimit,
                    search_depth: 'basic',
                }, context);
                const items = normalizeNarrativeSearchItems(result);
                const snippets = [];
                const labels = [];
                const titles = [];
                const urls = [];
                const sourceItems = [];
                const answer = String(result.answer || '').trim();
                for (const item of items) {
                    const title = item.title;
                    const rawSnippet = item.snippet;
                    const text = [title, rawSnippet].filter(Boolean).join(' ');
                    if (NARRATIVE_AD_PATTERN.test(text))
                        continue;
                    if (looksLikeFileArtifact(title) || looksLikeFileArtifact(rawSnippet))
                        continue;
                    const snippet = sanitizeNarrativeRegionWebSnippet(rawSnippet, region, title);
                    if (snippet)
                        snippets.push(snippet);
                    if (title)
                        titles.push(title);
                    if (item.url)
                        urls.push(item.url);
                    if (item.url) {
                        sourceItems.push({
                            title: title || region.name,
                            snippet: snippet || undefined,
                            url: item.url,
                            source: searchSkill.name === 'tavily_search' ? 'tavily' : 'multi_search',
                        });
                    }
                    labels.push(...extractNarrativeRegionFactLabels(text, region));
                }
                if (extractClient && urls.length > 0) {
                    try {
                        const extractResult = await extractClient.extract([...new Set(urls)].slice(0, DEFAULT_NARRATIVE_WEB_FACT_EXTRACT_URL_LIMIT).map((url, index) => ({
                            url,
                            title: titles[index] || '',
                        })), query, 1);
                        for (const chunk of extractResult.chunks) {
                            snippets.push(...collectNarrativeRegionEvidencePassages(chunk.text, region, chunk.title));
                            labels.push(...extractNarrativeRegionFactLabels(`${chunk.title} ${chunk.text}`, region));
                        }
                    }
                    catch {
                    }
                }
                return {
                    regionId: region.id,
                    enrichment: {
                        regionId: region.id,
                        query,
                        snippets: [...new Set(snippets)].slice(0, 5),
                        labels: [...new Set(labels)].slice(0, 5),
                        titles: [...new Set(titles)].slice(0, 5),
                        urls: [...new Set(urls)].slice(0, 5),
                        searchAnswer: answer || null,
                        source: searchSkill.name === 'tavily_search' ? 'tavily' : 'multi_search',
                        sourceItems: sourceItems
                            .filter((item) => item.url)
                            .slice(0, 5),
                    },
                };
            }
            catch {
                return { regionId: region.id, enrichment: null };
            }
        }));
        for (const item of settled) {
            if (item.status !== 'fulfilled' || !item.value.enrichment)
                continue;
            resultsPerRegion.set(item.value.regionId, item.value.enrichment);
        }
        return regions.map((region) => this.materializeNarrativeRegionGlow(this.rewriteNarrativeRegionNameFromFacts({
            ...region,
            webFacts: resultsPerRegion.get(region.id) || region.webFacts || null,
        })));
    }
    buildNarrativeRelevanceField(input) {
        if (input.scaleLevel === 'micro' || input.nodes.length === 0) {
            return null;
        }
        // 分辨率提升：macro 28×18 / meso 20×14（原 18×12 / 14×10）
        const cols = input.scaleLevel === 'macro' ? 28 : 20;
        const rows = input.scaleLevel === 'macro' ? 18 : 14;
        const bounds = input.viewport;
        const midLat = (bounds.swLat + bounds.neLat) / 2;
        const metersPerLon = 111320 * Math.max(Math.cos(midLat * Math.PI / 180), 0.2);
        const metersPerLat = 110540;
        const anchorLimit = input.scaleLevel === 'macro' ? 8 : 10;
        const anchors = input.nodes.slice(0, anchorLimit).map((node) => {
            let radiusM = input.scaleLevel === 'macro' ? 1200 : 700;
            if (node.source === 'aoi_context')
                radiusM += input.scaleLevel === 'macro' ? 600 : 280;
            if (node.source === 'brand_cluster')
                radiusM += 180;
            if (node.role === 'district_anchor' || node.role === 'campus_anchor')
                radiusM += 320;
            if (node.role === 'transit_connector')
                radiusM -= 180;
            if (node.role === 'commercial_anchor')
                radiusM += 120;
            radiusM = Math.max(radiusM, input.scaleLevel === 'macro' ? 600 : 360);
            let weight = Math.max(node.score, 0.2);
            if (node.source === 'aoi_context')
                weight += 0.35;
            if (node.source === 'brand_cluster')
                weight += 0.18;
            if (node.role === 'district_anchor' || node.role === 'campus_anchor')
                weight += 0.12;
            if (node.role === 'transit_connector')
                weight -= 0.08;
            // POI 级语义贡献：利用节点自身的 role/category 和 memberPoints 数量做轻量加权
            // role 语义越强（district_anchor / campus_anchor），荧光场越亮
            // memberPoints 数量反映空间密度，对数衰减避免大型 brand cluster 过度膨胀
            const memberPoints = node.memberPoints || [];
            if (memberPoints.length > 0) {
                // 空间密度加成（对数衰减）
                weight += Math.min(0.12, Math.log2(memberPoints.length + 1) * 0.03);
            }
            // 语义类别集中度：有 categoryMain 的节点语义更明确
            if (node.categoryMain)
                weight += 0.06;
            if (node.categorySub)
                weight += 0.03;
            const semanticWeight = Number(Math.max(0.1, weight).toFixed(3));
            const densityWeight = Number(Math.min(0.5, Math.max(0, Math.log2(memberPoints.length + 1) * 0.04)).toFixed(3));
            return {
                nodeId: node.id,
                name: node.name,
                center: node.center,
                role: node.role,
                weight: Number(weight.toFixed(3)),
                semanticWeight,
                densityWeight,
                radiusM,
            };
        });
        if (anchors.length === 0) {
            return null;
        }
        const rawCells = [];
        let maxIntensity = 0;
        for (let row = 0; row < rows; row += 1) {
            const lat = bounds.neLat - ((row + 0.5) / rows) * (bounds.neLat - bounds.swLat);
            for (let col = 0; col < cols; col += 1) {
                const lon = bounds.swLon + ((col + 0.5) / cols) * (bounds.neLon - bounds.swLon);
                let intensity = 0;
                let semanticIntensity = 0;
                let distanceIntensity = 0;
                let dominantAnchorId = null;
                let dominantContribution = 0;
                for (const anchor of anchors) {
                    const sigma = Math.max(anchor.radiusM * 0.7, 120);
                    const dx = (lon - anchor.center.lon) * metersPerLon;
                    const dy = (lat - anchor.center.lat) * metersPerLat;
                    const dist2 = dx * dx + dy * dy;
                    const distanceFactor = Math.exp(-(dist2 / (2 * sigma * sigma)));
                    const contribution = anchor.weight * distanceFactor;
                    intensity += contribution;
                    semanticIntensity += (anchor.semanticWeight ?? anchor.weight) * distanceFactor;
                    distanceIntensity += distanceFactor;
                    if (contribution > dominantContribution) {
                        dominantContribution = contribution;
                        dominantAnchorId = anchor.nodeId;
                    }
                }
                maxIntensity = Math.max(maxIntensity, intensity);
                rawCells.push({
                    row,
                    col,
                    center: { lon, lat },
                    intensity,
                    semanticIntensity,
                    distanceIntensity,
                    dominantAnchorId,
                });
            }
        }
        if (!(maxIntensity > 0)) {
            return null;
        }
        const cells = rawCells.map((cell) => ({
            ...cell,
            intensity: Number((cell.intensity / maxIntensity).toFixed(4)),
            semanticIntensity: Number((cell.semanticIntensity / maxIntensity).toFixed(4)),
            distanceIntensity: Number((cell.distanceIntensity / anchors.length).toFixed(4)),
        }));
        const hotspots = cells
            .filter((cell) => cell.intensity >= 0.62)
            .sort((left, right) => right.intensity - left.intensity)
            .slice(0, 6)
            .map((cell) => ({
            center: cell.center,
            intensity: cell.intensity,
        }));
        // macro 多中心聚簇：按空间象限分簇（上限 5 簇）
        // 象限定义：right_bottom / right_top / center / left_top / left_bottom
        const clusters = [];
        if (input.scaleLevel === 'macro' && anchors.length >= 2) {
            const midLon = (bounds.swLon + bounds.neLon) / 2;
            const midLat = (bounds.swLat + bounds.neLat) / 2;
            // 中心带阈值：视口中心 ±15% 范围内视为 center
            const lonRange = bounds.neLon - bounds.swLon;
            const latRange = bounds.neLat - bounds.swLat;
            const centerBandLon = lonRange * 0.15;
            const centerBandLat = latRange * 0.15;
            const bucketMap = new Map();
            for (const anchor of anchors) {
                let q;
                const dLon = anchor.center.lon - midLon;
                const dLat = anchor.center.lat - midLat;
                if (Math.abs(dLon) <= centerBandLon && Math.abs(dLat) <= centerBandLat) {
                    q = 'center';
                }
                else if (dLon > 0 && dLat < 0) {
                    q = 'right_bottom';
                }
                else if (dLon > 0 && dLat >= 0) {
                    q = 'right_top';
                }
                else if (dLon <= 0 && dLat >= 0) {
                    q = 'left_top';
                }
                else {
                    q = 'left_bottom';
                }
                if (!bucketMap.has(q))
                    bucketMap.set(q, []);
                bucketMap.get(q).push(anchor);
            }
            // 按节点数降序排列象限，上限 5 簇
            const sortedBuckets = [...bucketMap.entries()]
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 5);
            for (const [quadrant, clusterAnchors] of sortedBuckets) {
                // 簇质心
                const sumLon = clusterAnchors.reduce((s, a) => s + a.center.lon, 0);
                const sumLat = clusterAnchors.reduce((s, a) => s + a.center.lat, 0);
                const n = clusterAnchors.length;
                const centroid = { lon: sumLon / n, lat: sumLat / n };
                // 簇内热点：从全局 hotspots 中筛选距簇质心最近的
                const clusterHotspots = hotspots
                    .map((h) => ({
                    hotspot: h,
                    dist2: ((h.center.lon - centroid.lon) * metersPerLon) ** 2
                        + ((h.center.lat - centroid.lat) * metersPerLat) ** 2,
                }))
                    .sort((a, b) => a.dist2 - b.dist2)
                    .slice(0, 3)
                    .map((item) => item.hotspot);
                clusters.push({
                    quadrant,
                    anchors: clusterAnchors,
                    hotspots: clusterHotspots,
                    centroid,
                    nodeCount: clusterAnchors.length,
                });
            }
        }
        return {
            mode: 'gaussian_kernel',
            falloff: 'gaussian',
            scaleLevel: input.scaleLevel,
            bounds,
            grid: { cols, rows },
            anchors,
            cells,
            hotspots,
            maxIntensity: Number(maxIntensity.toFixed(4)),
            minRenderableIntensity: 0.12,
            clusters,
        };
    }
    async prepareNarrativeCandidates(input) {
        const startedAt = Date.now();
        const finalNodeLimit = Math.max(10, input.finalNodeLimit ?? 18);
        const previewSummary = buildNarrativeViewportSummary({
            featureTags: input.featureTags,
            featureSummary: input.featureSummary || '',
            encoderSummary: input.encoderSummary,
            encoderTags: input.encoderTags,
            encoderSceneTags: input.encoderSceneTags,
            encoderDominantBuckets: input.encoderDominantBuckets,
            candidates: input.candidates,
            requestedStyle: input.requestedStyle,
        });
        if (input.candidates.length === 0) {
            return {
                previewSummary,
                boundaryCandidates: [],
                encoderCandidates: [],
            };
        }
        const prioritized = rankNarrativeNodes(input.candidates, previewSummary, input.candidates.length).selectedNodes;
        const preferredBoundaryBudget = prioritized.filter((node) => this.shouldPrioritizeBoundaryBudget(node));
        const deferredBoundaryBudget = prioritized.filter((node) => !this.shouldPrioritizeBoundaryBudget(node));
        const prioritizedForBoundaries = [...preferredBoundaryBudget, ...deferredBoundaryBudget];
        const boundaryTarget = Math.min(prioritizedForBoundaries.length, Math.max(10, Math.min(finalNodeLimit, 16)));
        const batchSize = 10;
        const boundaryCandidates = [];
        let processedWaveCount = 0;
        for (let start = 0; start < prioritizedForBoundaries.length; start += batchSize) {
            const wave = prioritizedForBoundaries.slice(start, start + batchSize);
            if (wave.length === 0)
                break;
            processedWaveCount += 1;
            await this.enrichMissingBoundaries(wave, input.context);
            await this.enrichAggregateBoundaries(wave, input.viewport, input.context);
            const survivors = this.enforceViewportBoundaryContract(wave, input.viewport, input.context);
            boundaryCandidates.push(...survivors);
            if (boundaryCandidates.length >= boundaryTarget)
                break;
        }
        const encoderCandidates = boundaryCandidates.length > 0
            ? (input.useEncoder
                ? await this.enrichCandidatesWithEncoder({
                    candidates: boundaryCandidates,
                    center: input.center,
                    rawQuery: input.rawQuery,
                    areaView: input.areaView,
                    context: input.context,
                })
                : boundaryCandidates)
            : [];
        input.context.logger.info('prepareNarrativeCandidates summary', {
            rawCandidateCount: input.candidates.length,
            rankedCandidateCount: prioritized.length,
            prioritizedBoundaryCount: preferredBoundaryBudget.length,
            deferredBoundaryCount: deferredBoundaryBudget.length,
            boundaryTarget,
            batchSize,
            processedWaveCount,
            boundaryCandidateCount: boundaryCandidates.length,
            encoderEnabled: Boolean(input.useEncoder),
            durationMs: Date.now() - startedAt,
        });
        return {
            previewSummary,
            boundaryCandidates,
            encoderCandidates,
        };
    }
    async collectAreaEvidence(viewport, center, context) {
        if (viewport) {
            // 大视口（对角线 > 20km）时串行执行，避免 6 条 SQL 并行争抢 PostgreSQL shared memory 导致 OOM
            const diagonalM = buildViewportDiagonalM(viewport);
            const largeViewport = diagonalM > 20000;
            const execQuery = async (templateName, limit) => {
                try {
                    const result = await this.executeSkill(this.requireSkill('postgis'), 'execute_spatial_sql', {
                        sql: buildNarrativeAreaTemplateSql({ templateName, viewport, center, limit }),
                    }, context);
                    return result;
                }
                catch (error) {
                    context.logger.warn(`${templateName} query failed`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return { rows: [] };
                }
            };
            let categoryHistogram;
            let representativeSamples;
            let hotspots;
            let aoiContext;
            let landuseContext;
            let brandPool;
            if (largeViewport) {
                // 串行执行，降低 shared memory 峰值
                categoryHistogram = await execQuery('area_category_histogram', 8);
                representativeSamples = await execQuery('area_representative_sample', 48);
                hotspots = await execQuery('area_h3_hotspots', 5);
                // aoiContext 从 6 提到 20：沙湖/公园这类自然地物 priority 虽提升到 1，
                // 但视口内 priority=0 的大学 AOI 仍可能把 tile_rank 槽位挤满，
                // 容量过小会导致 water/park 大 polygon 在最终结果里缺席。
                aoiContext = await execQuery('area_aoi_context', 32);
                landuseContext = await execQuery('area_landuse_context', 6);
                brandPool = await execQuery('area_regional_brand_pool', 60);
            }
            else {
                // 小视口并行执行，速度快
                ;
                [categoryHistogram, representativeSamples, hotspots, aoiContext, landuseContext, brandPool] = await Promise.all([
                    execQuery('area_category_histogram', 8),
                    execQuery('area_representative_sample', 48),
                    execQuery('area_h3_hotspots', 5),
                    execQuery('area_aoi_context', 32),
                    execQuery('area_landuse_context', 6),
                    execQuery('area_regional_brand_pool', 60),
                ]);
            }
            return {
                categoryHistogram: Array.isArray(categoryHistogram.rows) ? categoryHistogram.rows : [],
                representativeSamples: Array.isArray(representativeSamples.rows) ? representativeSamples.rows : [],
                hotspots: Array.isArray(hotspots.rows) ? hotspots.rows : [],
                aoiContext: Array.isArray(aoiContext.rows) ? aoiContext.rows : [],
                landuseContext: Array.isArray(landuseContext.rows) ? landuseContext.rows : [],
                brandPool: Array.isArray(brandPool.rows) ? brandPool.rows : [],
            };
        }
        else {
            return {
                categoryHistogram: [],
                representativeSamples: [],
                hotspots: [],
                aoiContext: [],
                landuseContext: [],
                brandPool: [],
            };
        }
    }
    async collectPopulationEvidence(viewport, center, nodes, context) {
        if (nodes.length === 0) {
            return {
                populationHotspots: [],
                nodeGrounding: [],
            };
        }
        const postgis = this.requireSkill('postgis');
        try {
            const hotspotResult = await this.executeSkill(postgis, 'execute_spatial_sql', {
                sql: buildNarrativeAreaTemplateSql({ templateName: 'area_population_hotspots', viewport, center, limit: 4 }),
            }, context);
            const populationHotspots = normalizePopulationHotspots(Array.isArray(hotspotResult.rows) ? hotspotResult.rows : []);
            const nodeGroundingSettled = await Promise.allSettled(nodes.map(async (node) => {
                const radiusM = node.role === 'district_anchor' ? 260 : 220;
                const result = await this.executeSkill(postgis, 'execute_spatial_sql', {
                    sql: buildNodePopulationGroundingSql(node, radiusM),
                }, context);
                const row = Array.isArray(result.rows) ? result.rows[0] : null;
                return buildNodeGrounding(node, row, radiusM);
            }));
            return {
                populationHotspots,
                nodeGrounding: nodeGroundingSettled
                    .filter((item) => item.status === 'fulfilled')
                    .map((item) => item.value),
            };
        }
        catch (error) {
            context.logger.warn('population evidence unavailable for narrative', {
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                populationHotspots: [],
                nodeGrounding: [],
            };
        }
    }
    async generateNarration(input) {
        if (!this.provider.isReady()) {
            return null;
        }
        const regions = input.regions || input.nodes?.map((node) => ({
            id: node.id,
            name: node.name,
            spokenName: node.name,
            center: node.center,
            quadrant: 'legacy',
            nodes: [node],
            nodeIds: [node.id],
            nodeCount: 1,
            dominantBucket: node.sceneBucket || node.categoryMain || node.roleLabel || node.role,
            dominantBuckets: [node.sceneBucket || node.categoryMain || node.roleLabel || node.role].filter(Boolean),
            supportNames: [node.name],
            anchors: [],
            hotspots: [],
            summary: node.selectionReason || node.roleLabel || '',
            boundary: node.boundary || null,
            webFacts: null,
        })) || [];
        const narrationSeed = input.variantSeed || `${input.context.traceId}:${input.context.requestId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const narrativeAngle = pickNarrativeVariant(narrationSeed, NARRATIVE_ANGLE_CHOICES);
        const wordingConstraint = pickNarrativeVariant(`${narrationSeed}:wording`, NARRATIVE_WORDING_CHOICES);
        const viewportContext = formatNarrativeViewportContext(regions);
        const nodeDescriptions = regions.map((region, index) => {
            const transition = index > 0 ? input.transitions[index - 1] : null;
            const step = input.steps.find((item) => item.region_id === region.id) || null;
            const promptFacts = buildNarrativeRegionPromptFacts(region);
            const parts = [
                `片区${index + 1}：${region.name}（id=${region.id}）`,
                `主导语义：${region.dominantBucket}`,
                `支撑节点：${region.supportNames.join('、') || '无'}`,
                `节点数量：${region.nodeCount}`,
            ];
            if (region.summary) {
                parts.push(`区域摘要：${region.summary}`);
            }
            if (region.hotspots.length > 0) {
                parts.push(`热点数量：${region.hotspots.length}`);
            }
            if (step?.tagline) {
                parts.push(`导览标签：${step.tagline}`);
            }
            if (promptFacts.length > 0) {
                parts.push(...promptFacts);
            }
            if (transition) {
                parts.push(`转场：${transition.rationale}`);
            }
            return parts.join('；');
        }).join('\n');
        const styleGuide = input.viewportSummary.requestedStyle === 'local_vibe'
            ? '风格像熟门熟路的本地朋友，少一点官方讲解腔，多一点“为什么值得顺路带你看这里”。'
            : input.viewportSummary.requestedStyle === 'business_leisure'
                ? '风格要把人流、停留、逛街和休闲的节奏讲出来，像在带人挑一条会逛得舒服的线。'
                : input.viewportSummary.requestedStyle === 'humanities_walk'
                    ? '风格要更慢、更有留白和画面感，像在带人散步，不要写成旅游口号。'
                    : '风格要像成熟讲解员，先抓骨架，再顺势把区域气质讲开。';
        const systemPrompt = `你是一位懂城市片区与城市漫游路线的中文导览撰稿人。根据提供的确定性空间证据、网页事实与周边关系，为每个导览片区生成自然、具体、可播报的解说词。
要求：
1. 概览 70-120 字；每个片区 65-130 字，适合语音播报。
2. 只允许使用给定证据，不要脑补历史、排名、荣誉、故事。
3. 语言要口语化、具体、顺，不要堆抽象词。像“空间关系”“开敞感”“边界感”“气质”这类词，只有在能说清楚周边内容时才能用。
4. 优先讲清楚它是什么、周边连着什么、为什么值得停一下，再自然接到下一站。
5. 如果证据里有网页事实、搜索摘要、周边节点，就尽量写进正文，不要把介绍写成空泛模板。
6. 不要反复出现“代表点 / 主线 / 结构 / 最能把这片区域 / 一下子拎出来 / 落到了实处 / 讲清楚”这类套话。
7. 相邻片区必须换句式，商业片区也要讲出差别，不要只是重复“适合逛”“人会停下来”。
8. ${styleGuide}
9. nodes 对象的 key 必须使用上面给出的真实 id，不能用“片区1”或片区名称代替。
10. 必须结合“本轮讲解视角”和“视口空间上下文”；同一个地点在不同视口里，侧重点可以不同。
11. 不要把模板句照搬到最终文案；如果证据相同，也要根据本轮视角、前后顺序、相邻片区换一种讲法。
12. 只输出 JSON：{"overview":"区域概览解说","nodes":{"真实片区id":"该片区解说词"}}`;
        const userPrompt = `导览风格：${input.viewportSummary.requestedStyleLabel}
本轮讲解视角：${narrativeAngle}
本轮措辞约束：${wordingConstraint}
区域画像：${input.viewportSummary.summarySentence}
场景标签：${input.viewportSummary.sceneMix.join('、')}
视口空间上下文：
${viewportContext}
${nodeDescriptions}`;
        try {
            const timeoutMs = resolveNarrativeLlmNarrationTimeoutMs();
            const response = await this.provider.complete({
                messages: [
                    { role: 'system', content: systemPrompt, toolCalls: [] },
                    { role: 'user', content: userPrompt, toolCalls: [] },
                ],
                tools: [],
                timeoutMs,
                temperature: resolveNarrativeLlmTemperature(),
                topP: resolveNarrativeLlmTopP(),
                presencePenalty: 0.25,
                frequencyPenalty: 0.25,
            });
            const content = response.assistantMessage.content;
            if (!content)
                return null;
            // 从 LLM 响应中提取 JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                return null;
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                overview: typeof parsed.overview === 'string' ? parsed.overview : '',
                nodes: typeof parsed.nodes === 'object' && parsed.nodes
                    ? mapNarrationRegionTextsToIds(regions, parsed.nodes)
                    : {},
                variantSeed: narrationSeed,
                narrativeAngle,
                wordingConstraint,
            };
        }
        catch (error) {
            input.context.logger.warn('LLM narration generation failed, using deterministic fallback', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
    async generateMacroRegionNameWithLlm(profile, context) {
        if (!this.provider.isReady())
            return null;
        const ALLOWED_LABEL_TYPES = ['district', 'belt', 'interface', 'corridor', 'cluster'];
        const ALLOWED_SUFFIXES = ['区', '带', '界面', '走廊', '组团'];
        const FORBIDDEN_PATTERNS = [
            /都会心脏|活力引擎|黄金三角|城市会客厅|核心引擎|创新高地|标杆|示范区|先行区|旗舰/u,
            /CBD|cbd|新城|中央商务/u,
        ];
        const systemPrompt = `你是一位中文城市片区命名专家。根据提供的区域画像，生成一个自然、具体、像本地人或规划语境会说出的区域名称。

严格规则：
1. 只能使用给定锚点和语义桶来命名，不得引入未提供的地名、行政区或虚构概念。
2. primaryName 长度 6-14 字，shortName 4-8 字，spokenName 4-10 字。
3. primaryName 和 shortName 的最后一个字必须是：${ALLOWED_SUFFIXES.join(' / ')}。
4. labelType 必须是：${ALLOWED_LABEL_TYPES.join(' / ')}。
5. 不得使用营销化、口号化、AI 味的词（如"都会心脏""活力引擎""黄金三角""城市会客厅"等）。
6. 滨水区域优先用"滨水"或"沿江/沿湖"修饰；校园集群优先用"大学城"或"科教"修饰。
7. spokenName 要像口语，例如"武汉大学城这一带""沙湖这边"。
8. 只输出 JSON，不要输出其他内容。

输出格式：
{"primaryName":"正式名称","shortName":"短标签","spokenName":"口语名","labelType":"district|belt|interface|corridor|cluster","reason":"一句话解释为什么这么叫"}`;
        // 可选字段缺失时不留空行，保证 LLM 输入结构化、稳定
        const userPrompt = [
            '区域画像：',
            `- 主锚点：${profile.primaryAnchor || '未知'}`,
            `- 锚点列表：${profile.anchorNames.join('、')}`,
            `- 主语义：${profile.dominantBuckets.join('、')}`,
            `- 辅语义：${profile.supportingBuckets.join('、') || '无'}`,
            `- 空间形态：${profile.spatialForm}`,
            `- 滨水提示：${profile.waterfrontHint ? '是' : '否'}`,
            profile.axisHint ? `- 轴线提示：${profile.axisHint}` : null,
            profile.adminHint ? `- 行政提示：${profile.adminHint}` : null,
        ].filter(Boolean).join('\n');
        try {
            const timeoutMs = Math.max(1500, resolveNonNegativeInteger(process.env.NARRATIVE_LLM_NAMING_TIMEOUT_MS, 3000));
            const response = await this.provider.complete({
                messages: [
                    { role: 'system', content: systemPrompt, toolCalls: [] },
                    { role: 'user', content: userPrompt, toolCalls: [] },
                ],
                tools: [],
                timeoutMs,
            });
            const content = response.assistantMessage.content;
            if (!content)
                return null;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                return null;
            const parsed = JSON.parse(jsonMatch[0]);
            // 严格校验
            const primaryName = typeof parsed.primaryName === 'string' ? parsed.primaryName.trim() : '';
            const shortName = typeof parsed.shortName === 'string' ? parsed.shortName.trim() : '';
            const spokenName = typeof parsed.spokenName === 'string' ? parsed.spokenName.trim() : '';
            const labelType = typeof parsed.labelType === 'string' ? parsed.labelType.trim() : '';
            const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
            if (!primaryName || !shortName || !spokenName)
                return null;
            if (primaryName.length < 4 || primaryName.length > 18)
                return null;
            if (shortName.length < 2 || shortName.length > 10)
                return null;
            if (spokenName.length < 2 || spokenName.length > 14)
                return null;
            if (!ALLOWED_LABEL_TYPES.includes(labelType))
                return null;
            if (!ALLOWED_SUFFIXES.some((suffix) => primaryName.endsWith(suffix)))
                return null;
            if (!ALLOWED_SUFFIXES.some((suffix) => shortName.endsWith(suffix)))
                return null;
            if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(primaryName) || pattern.test(shortName)))
                return null;
            // 校验 LLM 没有引入未提供锚点以外的地名：
            // 只要 primaryName 包含至少一个锚点片段或 adminHint 即可通过。
            // 这里把锚点名的常见尾词剥掉（商场/公园/景区等），保留核心地名。
            const ANCHOR_TAIL_RE = /(购物中心|购物广场|商业广场|商场|天地|汉街|奥特莱斯|奥莱|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|mall|plaza|欧亚达|摩尔城|湿地公园|森林公园|主题公园|国家公园|文化园|旅游区|风景区|景区|景点|公园)$/iu;
            const anchorTokens = profile.anchorNames.filter(Boolean);
            if (anchorTokens.length > 0) {
                const hasAnchorToken = anchorTokens.some((token) => {
                    const core = token.replace(ANCHOR_TAIL_RE, '');
                    const check = core.length >= 2 ? core : token;
                    return primaryName.includes(check);
                });
                if (!hasAnchorToken && !(profile.adminHint && primaryName.includes(profile.adminHint)))
                    return null;
            }
            return {
                primaryName,
                shortName,
                spokenName,
                labelType: labelType,
                source: 'llm',
                confidence: 0.88,
                reason: reason || `LLM 基于${profile.dominantBuckets.join('、')}语义和${profile.spatialForm}形态命名。`,
            };
        }
        catch (error) {
            context.logger.warn('LLM macro region naming failed, using deterministic fallback', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
    inferSceneBucketFromText(text) {
        if (/(景观|景区|滨水|湖|公园|风景|scenic|park|water)/iu.test(text))
            return '景观';
        if (/(老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院)/u.test(text))
            return '文化';
        if (/(神学院|佛学院|道学院|修道院|修院|神哲学院)/u.test(text))
            return '宗教';
        if (/(校园|高校|大学|学院|education|campus)/iu.test(text))
            return '校园';
        if (/(商业|零售|购物|retail|mall|commercial|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|plaza|欧亚达|摩尔城)/iu.test(text))
            return '商业';
        if (/(生活|社区|居住|餐饮|配套|residential|daily|food)/iu.test(text))
            return '生活';
        if (/(交通|地铁|公交|枢纽|station|transit)/iu.test(text))
            return '交通';
        return '片区';
    }
    extractCellEntities(scopeData) {
        if (!scopeData)
            return [];
        const rawCells = Array.isArray(scopeData.cells) ? scopeData.cells : [];
        if (rawCells.length === 0)
            return [];
        return rawCells.map((cell) => {
            const lon = Number(cell.lon || cell.longitude || 0);
            const lat = Number(cell.lat || cell.latitude || 0);
            return {
                cellId: String(cell.cell_id || cell.id || `${lon}_${lat}`),
                cellName: String(cell.region_name || cell.dominant_category || cell.name || '未命名区域'),
                center: { lon, lat },
                dominantCategory: String(cell.dominant_category || cell.category || ''),
                aoiType: String(cell.aoi_type || cell.aoi_fclass || ''),
                sceneTags: Array.isArray(cell.scene_tags) ? cell.scene_tags.map((item) => String(item)) : [],
                searchScore: Number(cell.search_score || cell.similarity || cell.score || 0),
                childPoiIds: [],
            };
        });
    }
    filterCellEntitiesByViewport(cells, viewport) {
        if (cells.length === 0)
            return cells;
        const padLon = Math.max((viewport.neLon - viewport.swLon) * 0.05, 0.0015);
        const padLat = Math.max((viewport.neLat - viewport.swLat) * 0.05, 0.0012);
        return cells.filter((cell) => {
            const lon = Number(cell.center.lon);
            const lat = Number(cell.center.lat);
            return Number.isFinite(lon)
                && Number.isFinite(lat)
                && lon >= viewport.swLon - padLon
                && lon <= viewport.neLon + padLon
                && lat >= viewport.swLat - padLat
                && lat <= viewport.neLat + padLat;
        });
    }
    buildCellBasedCandidates(cells, poiSamples, aoiContext, brandPoolRows = []) {
        const nodes = [];
        // ============================================================
        // 阶段 1：区域品牌聚合（Brand Cluster）
        // 把 representativeSamples + brandPool 合并后做品牌词抽取与同前缀 POI 聚合。
        // 例：cell 内有「湖北大学三期公寓 / 湖北大学体育馆 / 湖北大学二号教学楼」
        //    → 聚合为 { brand: "湖北大学", type: "campus", count: 3 } 的独立区域实体
        // 这一步让节点名称从具体 POI 升级为「区域性品牌抽象」。
        // ============================================================
        const allPoisForBrand = this.mergePoisWithBrandPool(poiSamples, brandPoolRows);
        const brandClusters = clusterPoisByBrand(allPoisForBrand)
            .filter(isBrandClusterEligible)
            .filter((cluster) => this.shouldKeepNarrativeBrandCluster(cluster, aoiContext));
        const brandNodeByEntityKey = new Map();
        const nodeByEntityKey = new Map();
        const existingEntityKeys = new Set();
        // 记录被品牌 cluster 覆盖的 POI id，cell-based 阶段遇到时跳过，避免重复
        const brandCoveredPoiIds = new Set();
        for (const cluster of brandClusters) {
            for (const member of cluster.members) {
                const id = String(member.id ?? member.name ?? '');
                if (id)
                    brandCoveredPoiIds.add(id);
            }
        }
        for (const cluster of brandClusters) {
            const node = this.buildBrandClusterNode(cluster);
            nodes.push(node);
            const entityKey = this.buildNarrativeEntityKey(node.name);
            if (entityKey && !brandNodeByEntityKey.has(entityKey)) {
                brandNodeByEntityKey.set(entityKey, node);
            }
            if (entityKey && !nodeByEntityKey.has(entityKey)) {
                nodeByEntityKey.set(entityKey, node);
            }
            if (entityKey) {
                existingEntityKeys.add(entityKey);
            }
        }
        // ============================================================
        // 阶段 2：Cell-based 候选（保留原逻辑，跳过已被品牌覆盖的 cell）
        // 不再把多个商业综合体再合成“商圈”概念节点，只保留单体商业综合体。
        // ============================================================
        if (cells.length > 0) {
            // 把每个 POI 挂到最近的 cell 下
            const cellMap = new Map();
            for (const cell of cells) {
                cellMap.set(cell.cellId, { ...cell, childPoiIds: [] });
            }
            const poiCellAssignment = new Map(); // poiId → cellId
            for (const poi of poiSamples) {
                const poiLon = Number(poi.longitude);
                const poiLat = Number(poi.latitude);
                if (!Number.isFinite(poiLon) || !Number.isFinite(poiLat))
                    continue;
                let nearestCellId = '';
                let nearestDist = Infinity;
                for (const cell of cells) {
                    const dLon = (poiLon - cell.center.lon) * Math.cos(cell.center.lat * Math.PI / 180);
                    const dLat = poiLat - cell.center.lat;
                    const dist = dLon * dLon + dLat * dLat;
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestCellId = cell.cellId;
                    }
                }
                if (nearestCellId) {
                    const cell = cellMap.get(nearestCellId);
                    if (cell) {
                        const poiId = `poi:${String(poi.id ?? poi.name)}`;
                        cell.childPoiIds.push(poiId);
                        poiCellAssignment.set(poiId, nearestCellId);
                    }
                }
            }
            // 每个 cell 生成一个候选节点
            for (const cell of cellMap.values()) {
                const childPois = poiSamples.filter((poi) => {
                    const poiId = `poi:${String(poi.id ?? poi.name)}`;
                    return poiCellAssignment.get(poiId) === cell.cellId;
                });
                const representativePoi = this.pickRepresentativePoi(childPois, cell);
                // 若代表 POI 已被 brand cluster 覆盖，跳过（品牌节点已承担区域代表）
                if (representativePoi) {
                    const repId = String(representativePoi.id ?? representativePoi.name ?? '');
                    if (repId && brandCoveredPoiIds.has(repId)) {
                        continue;
                    }
                    // 进一步：代表 POI 名字可抽出品牌词但品牌未成 cluster（单个 POI）
                    // 这种情况下用 POI 原名即可，品牌聚合阶段不会产生重复
                    const { brand } = extractBrandFromName(String(representativePoi.name || ''));
                    if (brand && brandClusters.some((c) => c.brand === brand)) {
                        continue;
                    }
                }
                const displayName = representativePoi
                    ? normalizeName(representativePoi.name)
                    : this.normalizeCellEntityName(cell.cellName);
                if (!displayName)
                    continue;
                if (isSyntheticDistrictConceptName(displayName))
                    continue;
                const categoryMain = representativePoi?.categoryMain || (cell.dominantCategory || null);
                const categorySub = representativePoi?.categorySub || representativePoi?.category || null;
                const semanticText = [displayName, categoryMain, categorySub].filter(Boolean).join(' ');
                if (looksResidentialSemantic(semanticText))
                    continue;
                const role = representativePoi
                    ? resolveNodeRoleFromPoi(representativePoi)
                    : this.inferRoleFromCell(cell);
                if (!representativePoi && role === 'commercial_anchor')
                    continue;
                // cell.center 来自 spatial_encoder（WGS84），统一转 GCJ02 供镜头与 POI 对齐
                const [cellCenterLon, cellCenterLat] = wgs84ToGcj02(cell.center.lon, cell.center.lat);
                const center = representativePoi
                    ? { lon: Number(representativePoi.longitude), lat: Number(representativePoi.latitude) }
                    : { lon: cellCenterLon, lat: cellCenterLat };
                const childCount = cell.childPoiIds.length;
                const memberPoints = childPois
                    .map((poi) => ({ lon: Number(poi.longitude), lat: Number(poi.latitude) }))
                    .filter((pt) => Number.isFinite(pt.lon) && Number.isFinite(pt.lat));
                const densityBonus = Math.min(Math.log2(Math.max(childCount, 1) + 1) * 0.04, 0.16);
                const score = Number((resolveRoleWeight(role) + cell.searchScore * 0.15 + densityBonus).toFixed(3));
                if (role === 'local_life_anchor' && childCount < 3)
                    continue;
                if (role === 'district_anchor' && childCount < 3 && !cell.aoiType)
                    continue;
                const node = {
                    id: `cell:${cell.cellId}`,
                    name: displayName,
                    role,
                    roleLabel: resolveRoleLabel(role),
                    source: 'cell_entity',
                    center,
                    score,
                    categoryMain,
                    categorySub,
                    distanceM: null,
                    tags: [role, cell.dominantCategory, ...cell.sceneTags].filter(Boolean),
                    reasons: [resolveRoleLabel(role), cell.dominantCategory || '区域代表实体'].filter(Boolean),
                    hotness: 'low',
                    cellId: cell.cellId,
                    childPoiIds: cell.childPoiIds,
                    memberPoints,
                };
                nodes.push(node);
                const entityKey = this.buildNarrativeEntityKey(node.name);
                if (entityKey && !nodeByEntityKey.has(entityKey)) {
                    nodeByEntityKey.set(entityKey, node);
                }
                if (entityKey) {
                    existingEntityKeys.add(entityKey);
                }
            }
        }
        // ============================================================
        // 阶段 3：AOI 锚点（AOI 本身即区域实体），跳过与品牌/cell 重复的
        // ============================================================
        const groupedAoiContext = new Map();
        for (const item of aoiContext) {
            const rawName = String(item.name || '').trim();
            const name = normalizeName(rawName);
            if (!name || /^(none|null|unknown|未命名|无名)$/iu.test(name))
                continue;
            if (isSyntheticDistrictConceptName(name))
                continue;
            const entityKey = this.buildNarrativeEntityKey(name);
            if (!entityKey)
                continue;
            const bucket = groupedAoiContext.get(entityKey) || [];
            bucket.push(item);
            groupedAoiContext.set(entityKey, bucket);
        }
        for (const [entityKey, items] of groupedAoiContext.entries()) {
            const supportingNode = brandNodeByEntityKey.get(entityKey) || nodeByEntityKey.get(entityKey);
            const item = this.pickBestNarrativeAoiCandidate(items, supportingNode || null);
            if (!item)
                continue;
            const name = normalizeName(item.name);
            if (!name)
                continue;
            if (isSyntheticDistrictConceptName(name))
                continue;
            if (supportingNode) {
                this.mergeNarrativeNodeAoiSupport(supportingNode, item);
                existingEntityKeys.add(entityKey);
                continue;
            }
            if (existingEntityKeys.has(entityKey))
                continue;
            const lon = Number(item.longitude);
            const lat = Number(item.latitude);
            if (!Number.isFinite(lon) || !Number.isFinite(lat))
                continue;
            const role = resolveNodeRoleFromAoi(item);
            // 判定「自然地物」：水体、公园、湿地、林地、保护区等大面积 polygon
            // 这类 AOI 的 centroid 往往和路边 POI/cell 中心在 300m 内，但其 polygon
            // 覆盖几百米到几公里的面，不应被当作 "重复节点" 丢弃（如沙湖）。
            const fclass = String(item.fclass || '').trim().toLowerCase();
            const isScenicPolygon = (fclass === 'water' || fclass === 'wetland' || fclass === 'forest'
                || fclass === 'nature_reserve' || fclass === 'reservoir' || fclass === 'lake'
                || fclass === 'river' || fclass === 'park' || fclass === 'scenic'
                || fclass === 'tourism'
                || /^(湖|江|河|湿地|公园|景区|景点|风景区|旅游区)/u.test(name)
                || /(湖|江|河|湿地|公园|景区|景点|风景区|旅游区)$/u.test(name));
            const isCommercialAoi = role === 'commercial_anchor'
                || hasStrongCommercialComplexText(`${name} ${String(item.fclass || '')}`);
            // 如果 AOI 中心离某个 cell 中心 <300m，跳过（避免重复），
            // 但自然地物和强商业综合体保留独立节点（polygon 面积大，语义上是独立实体）
            const tooClose = !isScenicPolygon && !isCommercialAoi && cells.some((cell) => {
                const dLon = (lon - cell.center.lon) * Math.cos(cell.center.lat * Math.PI / 180);
                const dLat = lat - cell.center.lat;
                return Math.sqrt(dLon * dLon + dLat * dLat) < 0.003;
            });
            if (tooClose)
                continue;
            const weight = this.resolveAoiWeight(item);
            const scaleBonus = Math.min(Math.log10(Math.max(weight, 1) + 1) / 10, 0.18);
            const boundary = parseBoundaryGeoJson(item.boundary_geojson, 'aoi_native');
            // AOI centroid 来自 aois 表（WGS84），转 GCJ02 和 POI/前端底图对齐
            const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat);
            const node = {
                id: `aoi:${String(item.id ?? name)}`,
                name,
                role,
                roleLabel: resolveRoleLabel(role),
                source: 'aoi_context',
                center: { lon: gcjLon, lat: gcjLat },
                score: Number((resolveRoleWeight(role) + 0.24 + scaleBonus).toFixed(3)),
                categoryMain: null,
                categorySub: String(item.fclass || '').trim() || null,
                distanceM: null,
                tags: [role, String(item.fclass || '')].filter(Boolean),
                reasons: [resolveRoleLabel(role), 'AOI 代表锚点'].filter(Boolean),
                hotness: 'low',
                boundary,
            };
            nodes.push(node);
            existingEntityKeys.add(entityKey);
            nodeByEntityKey.set(entityKey, node);
        }
        return nodes;
    }
    /**
     * 对缺少 boundary 的节点做定向 AOI 边界回查。
     *
     * 根因：areaAoiContextViewport.sql 的 LIMIT + tile_rank 过滤导致部分 AOI
     * （沙湖、湖北大学等）不在 aoiContext 结果中，其对应的 brand cluster / cell
     * 节点因此无 boundary。此方法批量查 aois 表补齐。
     *
     * 匹配策略：
     * 1. name 精确 / 前缀 / 包含匹配
     * 2. 空间邻近过滤：AOI 与所有缺 boundary 节点中心点的 MultiPoint 距离 <2km
     *    （原实现错用了 aois 表不存在的 longitude/latitude 列，SQL 一直在 PG
     *    报列不存在、被外层 catch 静默吞掉，等于该方法从未生效）
     * 3. 面积过滤：排除 <100m²（残片）与 >50km²（辐射过广）的异常 AOI
     */
    async enrichMissingBoundaries(nodes, context) {
        const missing = nodes.filter((n) => !n.boundary);
        if (missing.length === 0)
            return;
        // 收集需要回查的节点名，用 entityKey 去重
        const namesByKey = new Map();
        for (const node of missing) {
            const key = this.buildNarrativeEntityKey(node.name);
            if (key && !namesByKey.has(key)) {
                namesByKey.set(key, { node, name: node.name });
            }
        }
        if (namesByKey.size === 0)
            return;
        // name 匹配条件：精确 / 前缀 / 包含
        const nameConditions = [];
        for (const { name } of namesByKey.values()) {
            const escaped = String(name).replace(/'/gu, "''");
            nameConditions.push(`name = '${escaped}'`);
            nameConditions.push(`name LIKE '${escaped}%'`);
            nameConditions.push(`name LIKE '%${escaped}%'`);
        }
        // 空间过滤：用 missing node 的中心点集合构造 MultiPoint，
        // AOI geom 与 MultiPoint 距离 <2km 即视为候选（避免远距离同名实体误匹配）
        const centerPoints = [...namesByKey.values()]
            .filter(({ node }) => Number.isFinite(node.center.lon) && Number.isFinite(node.center.lat))
            .map(({ node }) => `ST_SetSRID(ST_MakePoint(${Number(node.center.lon)}, ${Number(node.center.lat)}), 4326)`);
        if (centerPoints.length === 0)
            return;
        const multiPointExpr = centerPoints.length === 1
            ? centerPoints[0]
            : `ST_Collect(ARRAY[${centerPoints.join(', ')}])`;
        const sql = `
      SELECT
        name,
        ST_X(ST_Centroid(geom)) AS longitude,
        ST_Y(ST_Centroid(geom)) AS latitude,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001)) AS boundary_geojson,
        ST_Area(geom::geography) AS area_m2
      FROM aois
      WHERE (${nameConditions.join(' OR ')})
        AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
        AND ST_DWithin(geom::geography, (${multiPointExpr})::geography, 2000)
      ORDER BY area_m2 DESC
      LIMIT 200
    `;
        let rows = [];
        try {
            const postgis = this.requireSkill('postgis');
            const result = await this.executeSkill(postgis, 'execute_spatial_sql', { sql }, context);
            rows = Array.isArray(result?.rows) ? result.rows : [];
        }
        catch (error) {
            context.logger.warn('enrichMissingBoundaries aois query failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }
        if (rows.length === 0)
            return;
        // 按 entityKey 索引查询结果，取面积最大且空间最近的
        const bestByEntityKey = new Map();
        for (const row of rows) {
            const rowName = String(row.name || '').trim();
            const key = this.buildNarrativeEntityKey(rowName);
            if (!key)
                continue;
            const area = Number(row.area_m2) || 0;
            // 过滤面积过大（>50km²）或过小（<100m²）的异常 AOI
            if (area > 50_000_000 || area < 100)
                continue;
            const aoiLon = Number(row.longitude);
            const aoiLat = Number(row.latitude);
            if (!Number.isFinite(aoiLon) || !Number.isFinite(aoiLat))
                continue;
            // 找到与该 AOI 最近的缺 boundary 节点
            let minDist = Infinity;
            for (const node of missing) {
                if (!Number.isFinite(node.center.lon) || !Number.isFinite(node.center.lat))
                    continue;
                const dLon = (aoiLon - node.center.lon) * Math.cos(aoiLat * Math.PI / 180);
                const dLat = aoiLat - node.center.lat;
                const distM = Math.sqrt(dLon * dLon + dLat * dLat) * 111_320;
                if (distM < minDist)
                    minDist = distM;
            }
            // 空间邻近过滤：AOI 中心距最近节点 >2km 则跳过
            if (minDist > 2000)
                continue;
            const existing = bestByEntityKey.get(key);
            if (!existing || area > existing.area) {
                const boundary = parseBoundaryGeoJson(row.boundary_geojson, 'aoi_native');
                if (boundary) {
                    // boundary 坐标已在 parseBoundaryGeoJson 中转成 GCJ02，centroid 同坐标系
                    const centroid = computeBoundaryCentroid(boundary);
                    bestByEntityKey.set(key, { boundary, area, dist: minDist, center: centroid });
                }
            }
        }
        for (const node of missing) {
            const key = this.buildNarrativeEntityKey(node.name);
            if (!key)
                continue;
            const match = bestByEntityKey.get(key);
            if (match) {
                node.boundary = match.boundary;
                // 同步镜头中心到 AOI 视觉中心，避免"沙湖公园"定位到成员 POI 质心污染的商业区
                if (match.center)
                    node.center = match.center;
            }
        }
    }
    /**
     * 从节点推断关键字驱动 parcel union 的索引词。
     *
     * 优先级：
     *   1) 用 `extractBrandFromName(node.name)` 抽出的品牌词（如"武汉生物工程学院"）
     *   2) 退化为 node.name 本身（aoi_context / civic / culture 等节点常常名字就是关键词）
     *
     * 过短（<2 字）或去掉品牌核心尾词后长度不足的关键字直接返回 null，避免 ILIKE 过宽。
     */
    resolveParcelKeyword(node) {
        const rawName = String(node.name || '').trim();
        if (!rawName)
            return null;
        // 1. 品牌抽取（适合"武汉生物工程学院实训基地" → "武汉生物工程学院"）
        const { brand } = extractBrandFromName(rawName);
        const normalizedBrand = this.normalizeNarrativeKeyword(brand);
        if (normalizedBrand && normalizedBrand.length >= 2)
            return normalizedBrand;
        // 2. 用完整 name 本身作为关键字。截到 20 字防 ILIKE 误匹配过窄。
        //    像"黄鹤楼公园"、"中共湖北省委员会"这种 name 本身就是好的关键字。
        const cleaned = this.normalizeNarrativeKeyword(rawName);
        if (cleaned.length >= 2)
            return cleaned;
        return null;
    }
    normalizeNarrativeKeyword(value) {
        return stripNarrativeBracketSuffix(String(value || ''))
            .replace(/[（(][^（）()]{1,24}[)）]$/u, '')
            .replace(/[\s\-—_·•]+/gu, '')
            .trim()
            .slice(0, 20);
    }
    /**
     * 给尚未挂上 boundary 的节点生成模糊边界。三级降级链：
     *
     *   阶段 1：**关键字驱动 parcel union**（`narrative_keyword_parcel_union.sql`）
     *     以 node.name 推断的关键字为索引，在视口 + BFS 邻接扩散半径内把含该关键字的
     *     aoi / landuse 地块 ST_Union。这是最贴近真实地理的边界——跨视口的校园/园区
     *     主体也能抓到。
     *
     *   阶段 2：**聚合边界**（`narrative_aggregate_boundary.sql`）
     *     memberPoints >= 3 时，DBSCAN 聚类 → ConcaveHull → Buffer 软化 → Landuse 吸附。
     *     适合 brand cluster 成员分布构成的有机区块（如小吃街）。
     *
     *   阶段 3：**单点圆兼底**（`generatePointHalo`）
     *     前两阶段都失败时退到 150m 固定半径圆。按产品要求尽量避免此路径。
     */
    async enrichAggregateBoundaries(nodes, viewport, context) {
        const missing = nodes.filter((n) => !n.boundary);
        if (missing.length === 0)
            return;
        const postgis = this.requireSkill('postgis');
        // 按节点逐个生成聚合边界
        //
        // 优先级链（从精到粗，越上越"真实地块"）：
        //   1) 关键字驱动 parcel union —— 用 node 名字做关键字，在视口 + BFS 邻接扩散内
        //      把含该关键字 POI 的 aoi / landuse 地块 ST_Union 起来。适合有具体行政/校园/
        //      园区边界但没被 AOI 直接命中的节点（武汉生物工程学院、XX园区等）。
        //   2) 聚合边界 (aggregate_morphology) —— memberPoints >=3 时 DBSCAN + ConcaveHull。
        //   3) 单点圆 (point_halo) —— 最后兼底。point halo 会在 viewport gate 被丢弃，
        //      这里只是明确表示“没有具体边界”，而不是伪造一个矩形片区。
        const settled = await Promise.allSettled(missing.map(async (node) => {
            const pts = node.memberPoints?.filter((pt) => Number.isFinite(pt.lon) && Number.isFinite(pt.lat)) ?? [];
            const preferAggregateFirst = this.shouldPreferAggregateBoundaryFirst(node, pts.length);
            const allowRoadBlockFallback = this.shouldAttemptRoadBlockBoundary(node, pts.length);
            const skipExpensiveKeywordLookup = this.shouldSkipExpensiveBrandClusterBoundaryLookup(node);
            const tryAggregateBoundary = async () => {
                if (pts.length < 3)
                    return null;
                try {
                    const sql = buildNarrativeAreaTemplateSql({
                        templateName: 'narrative_aggregate_boundary',
                        viewport,
                        center: node.center,
                        limit: 1,
                        memberPoints: pts,
                    });
                    const result = await this.executeSkill(postgis, 'execute_spatial_sql', { sql }, context);
                    const rows = Array.isArray(result?.rows) ? result.rows : [];
                    if (rows.length > 0 && rows[0].boundary_geojson) {
                        return parseBoundaryGeoJson(rows[0].boundary_geojson, 'aggregate_morphology');
                    }
                }
                catch (error) {
                    context.logger.warn('enrichAggregateBoundaries SQL failed for node', {
                        nodeId: node.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return null;
            };
            if (preferAggregateFirst) {
                const aggregateBoundary = await tryAggregateBoundary();
                if (aggregateBoundary) {
                    return { nodeId: node.id, boundary: aggregateBoundary };
                }
            }
            // --- 阶段 1：关键字驱动 parcel union ---
            const keyword = skipExpensiveKeywordLookup ? null : this.resolveParcelKeyword(node);
            if (skipExpensiveKeywordLookup) {
                context.logger.info('skip expensive keyword boundary lookup for thin brand cluster', {
                    nodeId: node.id,
                    name: node.name,
                    role: node.role,
                    supportCount: Math.max(node.childPoiIds?.length || 0, node.memberPoints?.length || 0),
                });
            }
            if (keyword) {
                try {
                    const sql = buildNarrativeAreaTemplateSql({
                        templateName: 'narrative_keyword_parcel_union',
                        viewport,
                        center: node.center,
                        limit: 1,
                        keyword,
                        searchRadiusM: 500,
                    });
                    const result = await this.executeSkill(postgis, 'execute_spatial_sql', { sql }, context);
                    const rows = Array.isArray(result?.rows) ? result.rows : [];
                    const row = rows[0];
                    if (row?.boundary_geojson) {
                        const parcelCount = Number(row.parcel_count || 0);
                        const areaM2 = Number(row.area_m2 || 0);
                        if (parcelCount >= 1 && areaM2 >= 800) {
                            const boundary = parseBoundaryGeoJson(row.boundary_geojson, 'landuse_parcel');
                            if (boundary) {
                                context.logger.info('keywordParcelUnion hit', {
                                    nodeId: node.id,
                                    keyword,
                                    parcelCount,
                                    areaM2,
                                });
                                return { nodeId: node.id, boundary };
                            }
                        }
                    }
                }
                catch (error) {
                    context.logger.warn('keywordParcelUnion failed, fallback to aggregate_morphology', {
                        nodeId: node.id,
                        keyword,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                if (allowRoadBlockFallback) {
                    try {
                        const sql = buildNarrativeAreaTemplateSql({
                            templateName: 'narrative_keyword_road_block_union',
                            viewport,
                            center: node.center,
                            limit: 1,
                            keyword,
                            searchRadiusM: 500,
                        });
                        const result = await this.executeSkill(postgis, 'execute_spatial_sql', { sql }, context);
                        const rows = Array.isArray(result?.rows) ? result.rows : [];
                        const row = rows[0];
                        if (row?.boundary_geojson) {
                            const blockCount = Number(row.block_count || 0);
                            const areaM2 = Number(row.area_m2 || 0);
                            if (blockCount >= 1 && areaM2 >= 800) {
                                const boundary = parseBoundaryGeoJson(row.boundary_geojson, 'road_block');
                                if (boundary) {
                                    context.logger.info('keywordRoadBlockUnion hit', {
                                        nodeId: node.id,
                                        keyword,
                                        blockCount,
                                        areaM2,
                                    });
                                    return { nodeId: node.id, boundary };
                                }
                            }
                        }
                    }
                    catch (error) {
                        context.logger.warn('keywordRoadBlockUnion failed, fallback to aggregate_morphology', {
                            nodeId: node.id,
                            keyword,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            }
            // --- 阶段 2：聚合边界（DBSCAN + ConcaveHull + Landuse 吸附）---
            if (!preferAggregateFirst) {
                const aggregateBoundary = await tryAggregateBoundary();
                if (aggregateBoundary) {
                    return { nodeId: node.id, boundary: aggregateBoundary };
                }
            }
            const supportedClusterBuffer = this.generateSupportedClusterBuffer(node, pts);
            if (supportedClusterBuffer) {
                return { nodeId: node.id, boundary: supportedClusterBuffer };
            }
            // --- 阶段 3：兜底单点圆 ---
            // 用户希望尽量不用距离缓冲兜底，但当 parcel union 和聚合边界都失败时，
            // 至少画个视觉提示圆避免节点完全没有边界，前端仍能飞镜头并定位到中心。
            return { nodeId: node.id, boundary: this.generatePointHalo(node) };
        }));
        for (const item of settled) {
            if (item.status !== 'fulfilled' || !item.value.boundary)
                continue;
            const node = missing.find((n) => n.id === item.value.nodeId);
            if (node && !node.boundary) {
                node.boundary = item.value.boundary;
                // 聚合边界已是 GCJ02（源自 POI 成员点），用其视觉中心同步 node.center
                const centroid = computeBoundaryCentroid(item.value.boundary);
                if (centroid)
                    node.center = centroid;
            }
        }
    }
    /**
     * 视口契约门禁：把所有 candidate 的 boundary 裁剪到视口矩形内，并淘汰裁剪后
     * 无可见主体的节点。
     *
     * narrative 系统对用户的承诺是：**任何出现在输出中的节点，必须在当前视口内
     * 呈现出具体几何主体**。因此：
     *   1) 每个 candidate 的 boundary 必须与视口相交，否则清除 boundary
     *   2) 裁剪后面积必须 ≥ minClippedAreaM2（默认 500 m²）——不然只是擦边角料
     *   3) node.center 同步到裁剪后的视觉中心，确保 fly-to 目标真的在视口内
     *   4) 经过本步后仍无 boundary 或 center 不在视口内的 candidate → 被外层 filter 淘汰
     *
     * 这是 enrichMissingBoundaries / enrichAggregateBoundaries 跑完后必经的门禁，
     * 放在 rankNarrativeNodes 之前调用。
     */
    enforceViewportBoundaryContract(nodes, viewport, context, minClippedAreaM2 = 500) {
        const survivors = [];
        for (const node of nodes) {
            if (!node.boundary) {
                context.logger.info('narrative: drop node without concrete boundary', {
                    nodeId: node.id,
                    name: node.name,
                    source: node.source,
                    role: node.role,
                });
                continue;
            }
            if (node.boundary.source === 'point_halo') {
                context.logger.info('narrative: drop node with point halo boundary', {
                    nodeId: node.id,
                    name: node.name,
                    source: node.source,
                    role: node.role,
                    boundarySource: node.boundary.source,
                });
                continue;
            }
            const { boundary: clipped, clippedAreaM2 } = clipBoundaryToViewport(node.boundary, viewport);
            if (!clipped || clippedAreaM2 < minClippedAreaM2) {
                // 主体完全在视口外，或只剩擦边的小角料 → 清除 boundary 并淘汰节点
                context.logger.info('narrative: drop node whose boundary does not meaningfully intersect viewport', {
                    nodeId: node.id,
                    name: node.name,
                    source: node.source,
                    role: node.role,
                    originalSource: node.boundary.source,
                    clippedAreaM2,
                });
                continue;
            }
            const centroid = computeBoundaryCentroid(clipped);
            survivors.push(centroid ? { ...node, center: centroid } : node);
        }
        if (survivors.length < nodes.length) {
            context.logger.info('narrative: viewport contract gate dropped candidates', {
                before: nodes.length,
                after: survivors.length,
                dropped: nodes.length - survivors.length,
            });
        }
        return survivors;
    }
    generatePointHalo(node, radiusM = 150) {
        const segments = 32;
        const lon = node.center.lon;
        const lat = node.center.lat;
        // 角度→米的换算系数
        const lonFactor = 111_320 * Math.cos(lat * Math.PI / 180);
        const latFactor = 110_540;
        const dLon = radiusM / lonFactor;
        const dLat = radiusM / latFactor;
        const ring = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (2 * Math.PI * i) / segments;
            ring.push([
                lon + dLon * Math.cos(angle),
                lat + dLat * Math.sin(angle),
            ]);
        }
        return {
            type: 'Polygon',
            coordinates: [ring],
            source: 'point_halo',
        };
    }
    buildNarrativeEntityKey(name) {
        const rawCleaned = normalizeName(name)
            .replace(/[（(][^（）()]{0,24}[）)]/gu, '')
            .replace(/\s+/gu, '')
            .trim();
        const cleaned = normalizeCommercialEntityAlias(rawCleaned);
        if (!cleaned)
            return '';
        if (isSyntheticDistrictConceptName(cleaned))
            return '';
        const preserveExact = /(医学院|医学部|临床学院|护理学院|药学院|公共卫生学院|口腔医学院|口腔医院|附属医院|附属.*医院)/u.test(cleaned)
            || RESIDENTIAL_COMPOUND_NAME_PATTERN.test(cleaned);
        const { brand } = preserveExact ? { brand: null } : extractBrandFromName(cleaned);
        const scenicNormalized = cleaned.replace(/(湿地公园|森林公园|主题公园|国家公园|文化园|旅游区|风景区|景区|景点|公园)$/u, '');
        const scenicBase = scenicNormalized && scenicNormalized.length >= 2 && /(湖|江|河|湿地|公园|景区|景点|风景区|旅游区)/u.test(cleaned)
            ? scenicNormalized
            : null;
        const base = preserveExact
            ? cleaned
            : (brand || scenicBase || cleaned.replace(/(东区|西区|南区|北区|主校区|新校区|老校区|校区|分校|教学点)$/u, ''));
        return base.replace(/[\-—_·•]/gu, '').trim().toLowerCase();
    }
    resolveNarrativeNameQuality(name) {
        const cleaned = stripNarrativeBracketSuffix(name)
            .replace(/\s+/gu, '')
            .trim();
        if (!cleaned)
            return Number.NEGATIVE_INFINITY;
        const aliasNormalized = normalizeCommercialEntityAlias(cleaned);
        let score = 0;
        if (cleaned === aliasNormalized)
            score += 0.8;
        score -= Math.min(cleaned.length, 24) * 0.02;
        return Number(score.toFixed(3));
    }
    scoreNarrativeAoiCandidate(item, supportingNode) {
        const name = normalizeName(item.name);
        let score = this.resolveNarrativeNameQuality(name) + Math.min(Math.log10(this.resolveAoiWeight(item) + 1), 4) * 0.18;
        if (supportingNode) {
            const supportingName = normalizeName(supportingNode.name);
            if (name === supportingName) {
                score += 2.4;
            }
            else if (normalizeCommercialEntityAlias(name) === normalizeCommercialEntityAlias(supportingName)) {
                score += 1.4;
            }
            const lon = Number(item.longitude);
            const lat = Number(item.latitude);
            if (Number.isFinite(lon) && Number.isFinite(lat)) {
                const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat);
                const distancePenalty = Math.min(this.measurePoiDistanceM({ longitude: supportingNode.center.lon, latitude: supportingNode.center.lat }, { longitude: gcjLon, latitude: gcjLat }) / 700, 1.8);
                score -= distancePenalty;
            }
        }
        return Number(score.toFixed(3));
    }
    pickBestNarrativeAoiCandidate(items, supportingNode) {
        if (items.length === 0)
            return null;
        return items
            .slice()
            .sort((left, right) => this.scoreNarrativeAoiCandidate(right, supportingNode) - this.scoreNarrativeAoiCandidate(left, supportingNode))[0] || null;
    }
    resolveAoiWeight(item) {
        const weight = Number(item.population || item.area_sqm || item.areaSqm || 1);
        return Number.isFinite(weight) ? weight : 1;
    }
    mergeNarrativeNodeAoiSupport(node, item) {
        const fclass = String(item.fclass || '').trim();
        node.tags = [...new Set([...node.tags, 'aoi_support', fclass].filter(Boolean))];
        node.reasons = [...new Set([...node.reasons, 'AOI 代表锚点'])];
        // 品牌/cell 节点本无 polygon，若 AOI 有原生边界则提拔为节点 boundary
        if (!node.boundary) {
            const aoiBoundary = parseBoundaryGeoJson(item.boundary_geojson, 'aoi_native');
            if (aoiBoundary) {
                node.boundary = aoiBoundary;
                // POI 成员质心常被分店/宿舍/门岗污染偏离主体，AOI 被挂上后，
                // 用 AOI centroid 覆盖 node.center，确保镜头飞到 boundary 视觉中心
                const centroid = computeBoundaryCentroid(aoiBoundary);
                if (centroid)
                    node.center = centroid;
            }
        }
    }
    /**
     * 把 brandPool（SQL row 格式）转成 EvidenceItem，并与 representativeSamples 合并去重。
     * 保证即使景点 / 小吃街在 anchor_priority 排序中被压住，也能进入品牌聚合层。
     */
    mergePoisWithBrandPool(samples, brandPoolRows) {
        const map = new Map();
        for (const poi of samples) {
            const key = String(poi.id ?? poi.name ?? '');
            if (key)
                map.set(key, poi);
        }
        for (const row of brandPoolRows) {
            const key = String(row.id ?? row.name ?? '');
            if (!key || map.has(key))
                continue;
            const lon = Number(row.longitude);
            const lat = Number(row.latitude);
            if (!Number.isFinite(lon) || !Number.isFinite(lat))
                continue;
            map.set(key, {
                id: row.id ?? null,
                name: String(row.name ?? ''),
                categoryMain: typeof row.category_main === 'string' ? row.category_main : null,
                categorySub: typeof row.category_sub === 'string' ? row.category_sub : null,
                longitude: lon,
                latitude: lat,
                distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
            });
        }
        return [...map.values()];
    }
    /**
     * 把 brand cluster 转成独立的 NarrativeNode。
     * 节点名 = 品牌（如「湖北大学」「户部巷小吃街」「武昌万象城」），center = 成员质心。
     */
    buildBrandClusterNode(cluster) {
        const role = resolveBrandRole(cluster.type);
        const categoryLabel = resolveBrandCategoryLabel(cluster.type);
        const densityBonus = Math.min(Math.log2(cluster.count + 1) * 0.05, 0.15);
        const reason = cluster.count >= 2
            ? `由 ${cluster.count} 个同品牌 POI 共同指向的稳定实体`
            : `${categoryLabel}代表节点`;
        const memberPoints = cluster.members
            .map((m) => ({ lon: Number(m.longitude), lat: Number(m.latitude) }))
            .filter((pt) => Number.isFinite(pt.lon) && Number.isFinite(pt.lat));
        return {
            id: `brand:${cluster.type}:${cluster.brand}`,
            name: cluster.brand,
            role,
            roleLabel: resolveRoleLabel(role),
            source: 'brand_cluster',
            center: cluster.center,
            score: Number((resolveRoleWeight(role) + 0.28 + densityBonus).toFixed(3)),
            categoryMain: null,
            categorySub: categoryLabel,
            distanceM: null,
            tags: [role, `brand:${cluster.type}`, `cluster_count:${cluster.count}`],
            reasons: [resolveRoleLabel(role), reason],
            hotness: 'low',
            cellId: `brand:${cluster.type}:${cluster.brand}`,
            childPoiIds: cluster.members.map((m) => `poi:${String(m.id ?? m.name)}`),
            memberPoints,
        };
    }
    isStrongCommercialPoi(poi) {
        const name = normalizeName(poi.name);
        const text = `${name} ${poi.categoryMain || ''} ${poi.categorySub || ''}`;
        const categorySub = String(poi.categorySub || '').trim();
        const poiId = String(poi.id ?? '');
        if (!name || isSyntheticDistrictConceptName(name))
            return false;
        if (looksResidentialSemantic(text))
            return false;
        const { type } = extractBrandFromName(name);
        if (type === 'commercial')
            return true;
        const hasNameCommercialCue = hasStrongCommercialComplexText(name)
            || /(商场|购物中心|商业街|步行街|购物广场|商业广场|天地|汉街|销品茂|万象城|万象汇|天街|印象城|吾悦广场|万达广场|K11|SKP|Mall|Plaza|MALL|欧亚达|摩尔城)/iu.test(name);
        if (hasNameCommercialCue) {
            return true;
        }
        return /^aoi:/u.test(poiId) && /^(commercial|retail|mall)$/iu.test(categorySub);
    }
    hasSupportingAoiForBrandCluster(cluster, aoiContext) {
        const entityKey = this.buildNarrativeEntityKey(cluster.brand);
        if (!entityKey)
            return false;
        return aoiContext.some((item) => {
            const name = normalizeName(item.name);
            if (!name)
                return false;
            if (this.buildNarrativeEntityKey(name) !== entityKey)
                return false;
            const lon = Number(item.longitude);
            const lat = Number(item.latitude);
            if (!Number.isFinite(lon) || !Number.isFinite(lat))
                return true;
            const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat);
            return this.measurePoiDistanceM({ longitude: cluster.center.lon, latitude: cluster.center.lat }, { longitude: gcjLon, latitude: gcjLat }) <= 1500;
        });
    }
    shouldKeepNarrativeBrandCluster(cluster, aoiContext) {
        if (cluster.count >= 2)
            return true;
        if (cluster.type === 'commercial') {
            return this.isStrongCommercialPoi(cluster.members[0] || { name: cluster.brand });
        }
        return this.hasSupportingAoiForBrandCluster(cluster, aoiContext);
    }
    shouldPrioritizeBoundaryBudget(node) {
        if (node.boundary)
            return true;
        if (node.source === 'aoi_context' || (node.tags || []).includes('aoi_support'))
            return true;
        const supportCount = Math.max(node.childPoiIds?.length || 0, node.memberPoints?.length || 0);
        const semanticText = `${node.name} ${node.categoryMain || ''} ${node.categorySub || ''}`;
        if (node.role === 'commercial_anchor') {
            return hasStrongCommercialComplexText(semanticText);
        }
        if (node.role === 'food_street_anchor') {
            return supportCount >= 2 || /(小吃街|美食街|夜市|美食广场|美食城)/u.test(node.name);
        }
        if (node.role === 'scenic_landmark' || node.role === 'campus_anchor' || node.role === 'medical_anchor' || node.role === 'culture_anchor' || node.role === 'civic_anchor' || node.role === 'religious_anchor') {
            return supportCount >= 2;
        }
        return supportCount >= 2;
    }
    shouldPreferAggregateBoundaryFirst(node, pointCount) {
        if (pointCount < 3)
            return false;
        if (node.role === 'food_street_anchor')
            return true;
        if (node.role !== 'commercial_anchor')
            return false;
        const text = `${node.name} ${node.categoryMain || ''} ${node.categorySub || ''}`;
        return !hasStrongCommercialComplexText(text);
    }
    shouldAttemptRoadBlockBoundary(node, pointCount) {
        if (pointCount < 2)
            return false;
        if (node.role !== 'commercial_anchor' && node.role !== 'food_street_anchor')
            return false;
        const text = `${node.name} ${node.categoryMain || ''} ${node.categorySub || ''}`;
        return /(步行街|商业街|天地|汉街|mall|plaza|MALL)/iu.test(text);
    }
    shouldSkipExpensiveBrandClusterBoundaryLookup(node) {
        if (node.source !== 'brand_cluster')
            return false;
        const tags = node.tags || [];
        if (tags.includes('district_cluster') || tags.includes('commercial_cluster'))
            return false;
        if (tags.includes('aoi_support'))
            return false;
        const supportCount = Math.max(node.childPoiIds?.length || 0, node.memberPoints?.length || 0);
        const semanticText = `${node.name} ${node.categoryMain || ''} ${node.categorySub || ''}`;
        if (node.role === 'commercial_anchor') {
            return supportCount <= 1 && !hasStrongCommercialComplexText(semanticText);
        }
        if (node.role === 'scenic_landmark' || node.role === 'campus_anchor' || node.role === 'food_street_anchor') {
            return supportCount <= 2;
        }
        return supportCount <= 2;
    }
    generateSupportedClusterBuffer(node, points) {
        const tags = node.tags || [];
        if (!tags.includes('district_cluster') && !tags.includes('commercial_cluster'))
            return null;
        if (points.length < 2)
            return null;
        const lonValues = points.map((point) => point.lon);
        const latValues = points.map((point) => point.lat);
        const minLon = Math.min(...lonValues);
        const maxLon = Math.max(...lonValues);
        const minLat = Math.min(...latValues);
        const maxLat = Math.max(...latValues);
        const meanLat = latValues.reduce((sum, value) => sum + value, 0) / latValues.length;
        const padM = Math.max(100, Math.min(220, 60 + points.length * 20));
        const lonPad = padM / (111_320 * Math.max(Math.cos(meanLat * Math.PI / 180), 0.3));
        const latPad = padM / 110_540;
        return {
            type: 'Polygon',
            coordinates: [[
                    [minLon - lonPad, minLat - latPad],
                    [maxLon + lonPad, minLat - latPad],
                    [maxLon + lonPad, maxLat + latPad],
                    [minLon - lonPad, maxLat + latPad],
                    [minLon - lonPad, minLat - latPad],
                ]],
            source: 'buffer',
        };
    }
    measurePoiDistanceM(left, right) {
        const dLon = (Number(left.longitude) - Number(right.longitude)) * Math.cos(((Number(left.latitude) + Number(right.latitude)) / 2) * Math.PI / 180);
        const dLat = Number(left.latitude) - Number(right.latitude);
        return Math.sqrt(dLon * dLon + dLat * dLat) * 111_320;
    }
    pickRepresentativePoi(pois, cell) {
        if (pois.length === 0)
            return null;
        // 优先级排序：校园/景区/商业 > 行政/交通 > 餐饮/生活 > 其他
        const priority = (poi) => {
            const text = `${poi.name || ''} ${poi.categoryMain || ''} ${poi.categorySub || ''}`;
            if (/(医学院|医学部|临床学院|护理学院|药学院|公共卫生学院|口腔医学院|口腔医院|附属医院|附属.*医院)/u.test(text))
                return 0;
            if (looksResidentialSemantic(text))
                return 99;
            if (/(线网管理服务中心|管理服务中心|管理中心|运营中心|客服中心|接待中心|调度中心|指挥中心)/u.test(text))
                return 99;
            if (/(老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院)/u.test(text))
                return 8;
            if (/(大学|学院)/u.test(text) && !/(小学|中学|幼儿园|附小|附中|实验学校|国际学校|老年大学|开放大学|社区学院|继续教育学院)/u.test(text))
                return 1;
            if (/(景区|景点|公园|风景区|旅游区|博物馆|纪念馆)/u.test(text))
                return 2;
            if (hasStrongCommercialComplexText(text))
                return 3;
            if (/(步行街|购物中心|商业街|商场|天地|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|Mall|Plaza|欧亚达|摩尔城)/iu.test(text))
                return 3;
            if (/(地铁站|换乘站|公交站|交通枢纽|轨道交通)/u.test(text))
                return 4;
            if (/(医院|图书馆|体育|文化|街道|政务)/u.test(text))
                return 5;
            if (/^(公共类|餐饮类|购物类|住宿类|交通类|教育类|景观类|公共服务|生活服务|购物服务|餐饮服务|住宿服务)$/u.test(String(poi.name || '').trim()))
                return 98;
            if (/(小学|中学|幼儿园|附小|附中|实验学校|国际学校)/u.test(text))
                return 97;
            // 排除噪音
            if (/(宿舍|便利店|快递|停车场|厕所|卫生间|门岗|出入口)/u.test(text))
                return 99;
            return 10;
        };
        const sorted = [...pois].sort((a, b) => priority(a) - priority(b));
        const best = sorted[0] || null;
        return best && priority(best) < 90 ? best : null;
    }
    normalizeCellEntityName(name) {
        const text = normalizeName(name);
        if (!text)
            return '';
        if (isSyntheticDistrictConceptName(text))
            return '';
        if (/^(公共类|餐饮类|购物类|住宿类|交通类|教育类|景观类|公共服务|生活服务|购物服务|餐饮服务|住宿服务|交通设施服务|公共设施|公司企业|商务住宅|住宅区|教育培训|教育服务|科教文化服务|风景名胜|地名地址信息)$/u.test(text)) {
            return '';
        }
        if (looksResidentialSemantic(text)) {
            return '';
        }
        if (/(宿舍|学生公寓|楼栋|教学楼|实验楼|食堂|便利店|驿站|快递站|停车场|门岗|出入口|入口|出口|东门|西门|南门|北门|厕所|卫生间)/u.test(text)) {
            return '';
        }
        if (/(小学|中学|幼儿园|附小|附中|实验学校|国际学校)/u.test(text)) {
            return '';
        }
        return text;
    }
    inferRoleFromCell(cell) {
        const text = `${cell.cellName} ${cell.dominantCategory} ${cell.aoiType} ${cell.sceneTags.join(' ')}`;
        if (/(老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院)/u.test(text))
            return 'culture_anchor';
        if (/(神学院|佛学院|道学院|修道院|修院|神哲学院)/u.test(text))
            return 'religious_anchor';
        if (/(校园|高校|大学|学院|education|campus)/iu.test(text))
            return 'campus_anchor';
        if (/(景观|景区|滨水|湖|公园|风景|scenic|park|water)/iu.test(text))
            return 'scenic_landmark';
        if (/(商业|零售|购物|retail|mall|commercial|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|plaza|欧亚达|摩尔城)/iu.test(text))
            return 'commercial_anchor';
        if (/(交通|地铁|公交|枢纽|station|transit)/iu.test(text))
            return 'transit_connector';
        if (/(生活|社区|居住|餐饮|配套|residential|daily|food)/iu.test(text))
            return 'local_life_anchor';
        return 'district_anchor';
    }
    async enrichCandidatesWithEncoder(input) {
        const encoder = this.options.registry.get('spatial_encoder');
        if (!encoder || input.candidates.length === 0) {
            return input.candidates;
        }
        const annotationMap = new Map();
        try {
            const annotation = await this.executeSkill(encoder, 'annotate_poi_cells', {
                anchor_lon: input.center.lon,
                anchor_lat: input.center.lat,
                user_query: input.rawQuery,
                task_type: 'viewport_tour',
                pois: input.candidates.map((node) => ({
                    id: node.id,
                    name: node.name,
                    longitude: node.center.lon,
                    latitude: node.center.lat,
                    category_main: node.categoryMain || null,
                    category_sub: node.categorySub || null,
                    role: node.role,
                })),
            }, input.context);
            for (const row of Array.isArray(annotation.results) ? annotation.results : []) {
                const key = String(row.id || row.poi_id || row.name || '').trim();
                if (key)
                    annotationMap.set(key, row);
            }
        }
        catch (error) {
            input.context.logger.warn('narrative annotate_poi_cells unavailable', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        const profileLimit = Math.min(resolveNonNegativeInteger(process.env.NARRATIVE_ENCODER_PROFILE_LIMIT, DEFAULT_NARRATIVE_ENCODER_PROFILE_LIMIT), input.candidates.length);
        const profileMap = new Map();
        if (profileLimit > 0) {
            const shortlist = input.candidates.slice(0, profileLimit);
            const profileSettled = await Promise.allSettled(shortlist.map(async (node) => {
                const result = await this.executeSkill(encoder, 'encode_poi_profile', {
                    profile: buildPoiProfileInputFromEvidence({
                        item: {
                            id: node.id,
                            name: node.name,
                            categoryMain: node.categoryMain || null,
                            categorySub: node.categorySub || null,
                            longitude: node.center.lon,
                            latitude: node.center.lat,
                            distance_m: node.distanceM ?? null,
                        },
                        view: input.areaView,
                    }),
                }, input.context);
                return {
                    nodeId: node.id,
                    summary: typeof result.feature_summary === 'string' ? result.feature_summary : null,
                    tags: Array.isArray(result.feature_tags) ? result.feature_tags : [],
                };
            }));
            for (const item of profileSettled) {
                if (item.status !== 'fulfilled')
                    continue;
                profileMap.set(item.value.nodeId, {
                    summary: item.value.summary,
                    tags: item.value.tags,
                });
            }
        }
        return input.candidates.map((node) => {
            const annotation = annotationMap.get(node.id) || annotationMap.get(node.name) || null;
            const cellContext = annotation && typeof annotation.cell_context === 'object' ? annotation.cell_context : null;
            const profile = profileMap.get(node.id) || null;
            const sceneText = [
                String(cellContext?.dominant_category || ''),
                String(annotation?.dominant_category || ''),
                String(profile?.summary || ''),
                ...(profile?.tags || []).map((tag) => tag.label),
                node.categoryMain || '',
                node.categorySub || '',
            ].join(' ');
            const sceneBucket = this.inferSceneBucketFromText(sceneText);
            return {
                ...node,
                sceneBucket,
                encoderSummary: profile?.summary || null,
                encoderTags: profile?.tags || [],
                // selectionReason 由 rankNarrativeNodes 中的 buildSelectionReason 统一生成，
                // 不再用 encoder summary 覆写，避免"日常配套支点"等泛化描述覆盖角色感知
            };
        });
    }
    async enrichSelectedNodesWithWebFacts(nodes, summary, context) {
        const searchSkill = this.options.registry.get('tavily_search') || this.options.registry.get('multi_search_engine');
        if (!searchSkill || nodes.length === 0)
            return nodes;
        const action = searchSkill.name === 'tavily_search' ? 'search_web' : 'search_multi';
        const resultsPerNode = new Map();
        const nodeLimit = Math.min(resolveNonNegativeInteger(process.env.NARRATIVE_WEB_FACT_NODE_LIMIT, DEFAULT_NARRATIVE_WEB_FACT_NODE_LIMIT), nodes.length);
        const resultLimit = Math.max(1, resolveNonNegativeInteger(process.env.NARRATIVE_WEB_FACT_RESULT_LIMIT, DEFAULT_NARRATIVE_WEB_FACT_RESULT_LIMIT));
        if (nodeLimit === 0)
            return nodes;
        const targetNodes = nodes.slice(0, nodeLimit);
        const tavilyApiKeys = resolveTavilyApiKeys();
        const extractClient = searchSkill.name === 'tavily_search' && tavilyApiKeys.length > 0
            ? new TavilyExtractClient({
                apiKeys: tavilyApiKeys,
                timeoutMs: DEFAULT_NARRATIVE_WEB_FACT_EXTRACT_TIMEOUT_MS,
            })
            : null;
        // 对每个选中节点做逐点搜索，先拿搜索摘要，再尽量抽正文片段。
        const settled = await Promise.allSettled(targetNodes.map(async (node) => {
            const queries = buildNarrativeWebQueries(node, summary);
            const query = queries[0] || node.name;
            try {
                const result = await this.executeSkill(searchSkill, action, {
                    query,
                    queries,
                    max_results: resultLimit,
                    search_depth: 'basic',
                }, context);
                const items = normalizeNarrativeSearchItems(result);
                const snippets = [];
                const labels = [];
                const titles = [];
                const urls = [];
                const answer = String(result.answer || '').trim();
                for (const item of items) {
                    const title = item.title;
                    const rawSnippet = item.snippet;
                    const text = [title, rawSnippet].filter(Boolean).join(' ');
                    // 广告/营销/推广类文案过滤：这类 snippet 与区域导览事实无关，
                    // 若混入 voice_text / webFactHint，会出现"保利·公园上城营销中心盛大开放"
                    // 这类明显错误的解说词。命中广告特征就整条跳过，不再参与 snippet / label。
                    if (NARRATIVE_AD_PATTERN.test(text))
                        continue;
                    if (looksLikeFileArtifact(title) || looksLikeFileArtifact(rawSnippet))
                        continue;
                    const snippet = sanitizeNarrativeWebSnippet(rawSnippet, node.name, title);
                    if (snippet) {
                        snippets.push(snippet);
                    }
                    if (title)
                        titles.push(title);
                    if (item.url)
                        urls.push(item.url);
                    labels.push(...extractNarrativeFactLabels(text, node));
                }
                if (extractClient && urls.length > 0) {
                    try {
                        const extractResult = await extractClient.extract([...new Set(urls)].slice(0, DEFAULT_NARRATIVE_WEB_FACT_EXTRACT_URL_LIMIT).map((url, index) => ({
                            url,
                            title: titles[index] || '',
                        })), query, 1);
                        for (const chunk of extractResult.chunks) {
                            snippets.push(...collectNarrativeEvidencePassages(chunk.text, node.name, chunk.title));
                            labels.push(...extractNarrativeFactLabels(`${chunk.title} ${chunk.text}`, node));
                        }
                    }
                    catch {
                        // 提取失败时保留搜索摘要，不中断 narrative 主链路。
                    }
                }
                return {
                    nodeId: node.id,
                    enrichment: {
                        nodeId: node.id,
                        snippets: [...new Set(snippets)].slice(0, 3),
                        labels: [...new Set(labels)].slice(0, 3),
                        titles: [...new Set(titles)].slice(0, 3),
                        urls: [...new Set(urls)].slice(0, 3),
                        searchAnswer: answer || null,
                        source: searchSkill.name === 'tavily_search' ? 'tavily' : 'multi_search',
                    },
                };
            }
            catch {
                return { nodeId: node.id, enrichment: null };
            }
        }));
        for (const item of settled) {
            if (item.status !== 'fulfilled' || !item.value.enrichment)
                continue;
            resultsPerNode.set(item.value.nodeId, item.value.enrichment);
        }
        return nodes.map((node) => {
            const facts = resultsPerNode.get(node.id) || null;
            return { ...node, webFacts: facts };
        });
    }
    buildEncoderAnchorScoreMap(encoderPayload) {
        const map = new Map();
        if (!encoderPayload?.scopeData)
            return map;
        const cells = Array.isArray(encoderPayload.scopeData.cells) ? encoderPayload.scopeData.cells : [];
        for (const cell of cells) {
            const poiId = String(cell.poi_id || cell.nodeId || '');
            const score = Number(cell.score || cell.relevance || 0);
            if (poiId && Number.isFinite(score) && score > 0) {
                map.set(poiId, score);
            }
        }
        return map;
    }
    async collectEncoderSignals(input) {
        const encoder = this.options.registry.get('spatial_encoder');
        if (!encoder) {
            return {
                regionSummary: null,
                regionTags: [],
                sceneTags: [],
                dominantBuckets: [],
            };
        }
        const [scopeCells, regionEncoding] = await Promise.allSettled([
            encoder.execute('search_anchor_cells', {
                anchor_lon: input.center.lon,
                anchor_lat: input.center.lat,
                user_query: input.rawQuery,
                task_type: 'viewport_tour',
                top_k: 6,
                max_distance_m: Math.max(Math.round(input.diagonalM / 1.6), 1600),
            }, input.context),
            encoder.execute('encode_region_snapshot', {
                snapshot: input.snapshot,
            }, input.context),
        ]);
        const scopeData = scopeCells.status === 'fulfilled' && scopeCells.value.ok ? scopeCells.value.data : null;
        const regionData = regionEncoding.status === 'fulfilled' && regionEncoding.value.ok ? regionEncoding.value.data : null;
        return {
            regionSummary: typeof regionData?.feature_summary === 'string' ? regionData.feature_summary : null,
            regionTags: Array.isArray(regionData?.feature_tags) ? regionData.feature_tags : [],
            sceneTags: Array.isArray(scopeData?.scene_tags) ? scopeData.scene_tags.map((item) => String(item)) : [],
            dominantBuckets: Array.isArray(scopeData?.dominant_buckets) ? scopeData.dominant_buckets.map((item) => String(item)) : [],
            scopeData,
        };
    }
}
