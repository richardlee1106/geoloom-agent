/**
 * 检测回答是否包含用户未请求的分析内容。
 * 阶段 0：可观测性埋点，不改变业务行为。
 */
export function detectUnnecessaryAnalysis(input: {
  rawQuery: string
  answer: string
  intent: { queryType: string }
}): boolean {
  // 如果用户主动提及这些关键词，则不视为"不必要"
  const unnecessaryPatterns = ['机会点', '异常点', '投资', '开店建议', '发展潜力', '值得关注']
  const queryMentions = unnecessaryPatterns.some(p => input.rawQuery.includes(p))
  if (queryMentions) return false
  return unnecessaryPatterns.some(p => input.answer.includes(p))
}
