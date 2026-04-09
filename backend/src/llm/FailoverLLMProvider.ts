import type { LLMCompletionRequest, LLMProvider, LLMResponse } from './types.js'

export interface FailoverLLMProviderOptions {
  primary: LLMProvider
  fallback: LLMProvider
}

export class FailoverLLMProvider implements LLMProvider {
  constructor(private readonly options: FailoverLLMProviderOptions) {}

  getStatus() {
    if (this.options.primary.isReady()) {
      return this.options.primary.getStatus()
    }

    return this.options.fallback.getStatus()
  }

  isReady() {
    return this.options.primary.isReady() || this.options.fallback.isReady()
  }

  async complete(request: LLMCompletionRequest): Promise<LLMResponse> {
    if (this.options.primary.isReady()) {
      try {
        return await this.options.primary.complete(request)
      } catch (error) {
        if (!this.options.fallback.isReady()) {
          throw error
        }
        return this.options.fallback.complete(request)
      }
    }

    if (this.options.fallback.isReady()) {
      return this.options.fallback.complete(request)
    }

    return this.options.primary.complete(request)
  }
}
