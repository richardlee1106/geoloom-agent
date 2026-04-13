/**
 * 搜索路由器
 * 优先级：Multi Search（DDG主力，免费56%相关性）→ Tavily（后备，精准+答案摘要）
 * 实测数据：
 *   DDG(简单UA+间隔): 平均10条/题，56%相关性，100%成功率，免费
 *   Tavily: 平均5条精准结果+答案摘要，100%答案率，API付费
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
   * 优先级：Multi Search(DDG主力) → Tavily(后备)
   */
  route(query: string): SearchRoute[] {
    const routes: SearchRoute[] = []

    // 优先级 1：Multi Search（DDG主力，免费56%相关性，10条/题）
    if (this.options.enableMultiSearch) {
      routes.push({
        source: 'multi_search',
        priority: 1,
        reason: 'Multi Search 主力（DDG免费，56%相关性，10条/题）',
      })
    }

    // 优先级 2：Tavily 后备（精准+答案摘要，API付费）
    if (this.options.enableTavily && this.options.tavilyApiKey) {
      routes.push({
        source: 'tavily',
        priority: 2,
        reason: 'Tavily 后备搜索，精准结果+AI答案摘要',
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
