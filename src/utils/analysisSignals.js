function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function toLabelSuffix(version) {
  const text = String(version || '').trim();
  return text ? ` (${text})` : '';
}

export function resolveAnalysisSignals(rawStats) {
  const stats = pickObject(rawStats);
  if (!stats) {
    return {
      cacheHit: false,
      cacheLabel: '',
      riskWarnings: []
    };
  }

  const cacheHit = stats.cache_hit === true;
  const cacheKeyVersion = String(stats.cache_key_version || '').trim();
  const geometryMatch = stats.geometry_match === true;

  let cacheLabel = '';
  if (cacheHit) {
    cacheLabel = geometryMatch
      ? `来自同视图缓存${toLabelSuffix(cacheKeyVersion)}`
      : `缓存命中（几何待核验）${toLabelSuffix(cacheKeyVersion)}`;
  } else if (stats.cache_hit === false) {
    cacheLabel = '已基于当前视图重算';
  }

  const riskWarnings = [];
  if (stats.undersegmentation_risk === true) {
    riskWarnings.push({
      code: 'undersegmentation_risk',
      message: '当前结果可能存在分区不足风险，建议强制重算或放宽参数。'
    });
  }
  if (stats.writer_hallucination === true) {
    riskWarnings.push({
      code: 'writer_hallucination',
      message: '文本可能含未证实结论，请优先参考结构化证据。'
    });
  }

  return {
    cacheHit,
    cacheLabel,
    riskWarnings
  };
}

