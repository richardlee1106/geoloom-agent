import { describe, expect, it } from 'vitest';
import { resolveAnalysisSignals } from '../analysisSignals';

describe('resolveAnalysisSignals', () => {
  it('extracts cache transparency and quality risk flags from stats', () => {
    const signals = resolveAnalysisSignals({
      cache_hit: true,
      cache_key_version: 'v2',
      geometry_match: true,
      undersegmentation_risk: true,
      writer_hallucination: true
    });

    expect(signals.cacheHit).toBe(true);
    expect(signals.cacheLabel).toContain('v2');
    expect(signals.riskWarnings).toContainEqual(expect.objectContaining({ code: 'undersegmentation_risk' }));
    expect(signals.riskWarnings).toContainEqual(expect.objectContaining({ code: 'writer_hallucination' }));
  });

  it('returns empty signals when stats are missing', () => {
    const signals = resolveAnalysisSignals(null);

    expect(signals.cacheHit).toBe(false);
    expect(signals.cacheLabel).toBe('');
    expect(signals.riskWarnings).toHaveLength(0);
  });
});
