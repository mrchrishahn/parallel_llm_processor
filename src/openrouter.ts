import type { OpenRouterModel, OpenRouterModelsResponse } from './types.ts';

export class OpenRouterAPI {
  private apiKey: string;
  private baseURL = 'https://openrouter.ai/api/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchAvailableModels(): Promise<OpenRouterModel[]> {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/mrchrishahn/parallel-llm-processor',
          'X-Title': 'Parallel LLM Processor',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key');
        }
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const data: OpenRouterModelsResponse = await response.json();
      
      // Filter out models that don't support chat completions or are deprecated
      const validModels = (data.data || []).filter(model => {
        return model.id && 
               !model.id.includes('deprecated') &&
               !model.id.includes('unavailable');
      });

      // Sort by popularity/name for better UX
      validModels.sort((a, b) => {
        const aIsPopular = this.isPopularModel(a.id);
        const bIsPopular = this.isPopularModel(b.id);
        
        if (aIsPopular && !bIsPopular) return -1;
        if (!aIsPopular && bIsPopular) return 1;
        
        return a.id.localeCompare(b.id);
      });

      return validModels;
    } catch (error) {
      throw new Error(`Error fetching models from OpenRouter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async testApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/mrchrishahn/parallel-llm-processor',
          'X-Title': 'Parallel LLM Processor',
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  formatModelForDisplay(model: OpenRouterModel): string {
    const contextLength = model.context_length ? 
      ` (${model.context_length.toLocaleString()} ctx)` : '';
    
    const pricing = model.pricing && model.pricing.prompt && model.pricing.completion ? 
      ` - $${model.pricing.prompt}/$${model.pricing.completion}` : '';
    
    return `${model.id}${contextLength}${pricing}`;
  }

  private isPopularModel(modelId: string): boolean {
    return OpenRouterAPI.getPopularModels().includes(modelId);
  }

  static getPopularModels(): string[] {
    return [
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-4-sonnet',
      'anthropic/claude-4-opus',
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'openai/gpt-4.1',
      'openai/gpt-4.1-mini',
      'openai/gpt-4.1-nano',
      'openai/gpt-4.5',
      'openai/o1-preview',
      'openai/o1-mini',
      'openai/o3-pro',
      'openai/o3',
      'openai/o3-mini-high',
      'openai/o4-mini-high',
      'openai/o4-mini',
      'google/gemini-flash-2.0',
      'google/gemini-2.5-flash-lite-preview-06-17',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'google/gemini-2.5-pro-preview',
      'perplexity/llama-3.1-sonar-huge-128k-online',
      'deepseek/deepseek-r1-0528:free',
      'deepseek/deepseek-r1:free',
      'mistralai/mistral-nemo',
      'x-ai/grok-3-beta',
      'meta-llama/llama-4-maverick',
      'meta-llama/llama-3.1-70b-instruct',
      'deepseek/deepseek-chat',
    ];
  }

  static getModelCategories(): { [key: string]: string[] } {
    return {
      'Reasoning': ['openai/o1-preview', 'openai/o1-mini'],
      'Code': ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'meta-llama/llama-3.2-90b-instruct'],
      'Creative': ['anthropic/claude-3-opus', 'anthropic/claude-3.5-sonnet'],
      'Fast': ['openai/gpt-4o-mini', 'anthropic/claude-3-haiku', 'google/gemini-flash-1.5'],
      'Multimodal': ['openai/gpt-4o', 'google/gemini-pro-1.5', 'anthropic/claude-3.5-sonnet'],
    };
  }
} 