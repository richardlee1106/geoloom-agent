/**
 * 搜索路由器
 * 优先级：Tavily 主搜索 → Multi Search 兼容兜底
 * 约束：
 *   1. 主链路默认使用 Tavily，保证联网搜索来源一致。
 *   2. Multi Search 仅作为显式兼容或 Tavily 不可用时的回退。
 */

export type SearchSource = 'tavily' | 'multi_search'

export interface SearchRoute {
  source: SearchSource
  priority: number
  reason: string
}

export interface SearchRouterOptions {
  enableTavily?: boolean
  enableMultiSearch?: boolean
  tavilyApiKey?: string
}

export class SearchRouter {
  private options: SearchRouterOptions

  constructor(options: SearchRouterOptions = {}) {
    this.options = {
      enableTavily: options.enableTavily ?? true,
      enableMultiSearch: options.enableMultiSearch ?? true,
      tavilyApiKey: options.tavilyApiKey,
    }
  }

  /**
   * 根据查询内容智能选择搜索源
   * 优先级：Tavily 主搜索 → Multi Search 兜底
   */
  route(query: string): SearchRoute[] {
    const routes: SearchRoute[] = []

    // 优先级 1：Tavily 主搜索（结果更稳定，便于后续 crawl/NER/alignment 串联）
    if (this.options.enableTavily && this.options.tavilyApiKey) {
      routes.push({
        source: 'tavily',
        priority: 1,
        reason: 'Tavily 主搜索，供正文抽取与实体对齐主链路使用',
      })
    }

    // 优先级 2：Multi Search 兼容兜底
    if (this.options.enableMultiSearch) {
      routes.push({
        source: 'multi_search',
        priority: 2,
        reason: 'Multi Search 兼容兜底，用于 Tavily 不可用时回退',
      })
    }

    // 按优先级排序
    routes.sort((a, b) => a.priority - b.priority)

    return routes
  }

  /**
   * 获取主要搜索源（优先级最高的）
   */
  getPrimarySource(query: string): SearchSource | null {
    const routes = this.route(query)
    return routes.length > 0 ? routes[0].source : null
  }

  /**
   * 检查是否应该使用 Tavily
   */
  shouldUseTavily(query: string): boolean {
    const routes = this.route(query)
    return routes.some(r => r.source === 'tavily')
  }

  /**
   * 检查是否应该使用 Multi Search Engine
   */
  shouldUseMultiSearch(query: string): boolean {
    const routes = this.route(query)
    return routes.some(r => r.source === 'multi_search')
  }

  /**
   * 获取后备搜索源列表（用于 fallback）
   */
  getFallbackSources(query: string, currentSource: SearchSource): SearchSource[] {
    const routes = this.route(query)
    const currentIndex = routes.findIndex(r => r.source === currentSource)
    
    if (currentIndex === -1) {
      return routes.map(r => r.source)
    }

    return routes.slice(currentIndex + 1).map(r => r.source)
  }
}
