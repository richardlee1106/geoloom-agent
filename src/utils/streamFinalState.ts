export function resolveStreamFinalState({
  requestSucceeded = false,
}: {
  requestSucceeded?: boolean
} = {}) {
  if (requestSucceeded) {
    return {
      isStreaming: false,
      isThinking: false,
      thinkingMessage: '分析已经完成',
      pipelineCompleted: true,
      finalizeAtAnswerStage: true,
    }
  }

  return {
    isStreaming: false,
    isThinking: false,
    thinkingMessage: '请求已中断',
    pipelineCompleted: false,
    finalizeAtAnswerStage: false,
  }
}
