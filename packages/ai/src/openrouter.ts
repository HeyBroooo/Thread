import { getConfig, createLogger, redact } from '@cbi/shared';
import { FatalAIError, RetryableAIError, type AIProvider, type AIRequest, type AIResult } from './provider.js';

const log = createLogger({ component: 'ai.openrouter' });

interface OpenRouterChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; code?: number | string };
}

export interface OpenRouterOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  appUrl?: string;
  appTitle?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';
  readonly defaultModel: string;
  private apiKey: string;
  private baseUrl: string;
  private appUrl: string;
  private appTitle: string;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(options: OpenRouterOptions = {}) {
    const config = getConfig();
    this.apiKey = options.apiKey ?? config.ai.apiKey ?? '';
    this.defaultModel = options.model ?? config.ai.model;
    this.baseUrl = (options.baseUrl ?? config.ai.baseUrl).replace(/\/$/, '');
    this.appUrl = options.appUrl ?? config.ai.appUrl;
    this.appTitle = options.appTitle ?? config.ai.appTitle;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    if (!this.apiKey) {
      throw new FatalAIError('OPENROUTER_API_KEY is not configured.');
    }
  }

  async complete(request: AIRequest): Promise<AIResult> {
    const model = request.model ?? this.defaultModel;
    const body = {
      model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: `${request.context}\n\n---\n\nUSER REQUEST:\n${request.user}`.trim() },
      ],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 4096,
      ...(request.json && request.schema
        ? { response_format: { type: 'json_object' } }
        : {}),
      ...(request.json && !request.schema ? { response_format: { type: 'json_object' } } : {}),
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        await sleep(delay);
        log.warn('openrouter.retry', { attempt, model });
      }
      try {
        return await this.send(body, model);
      } catch (e) {
        lastError = e;
        if (e instanceof FatalAIError) throw e;
        if (!(e instanceof RetryableAIError)) throw e;
        log.warn('openrouter.retryable_failure', { attempt, status: e.status, message: e.message });
      }
    }
    throw new FatalAIError(
      `OpenRouter request failed after ${this.maxRetries + 1} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  private async send(body: unknown, model: string): Promise<AIResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': this.appUrl,
          'X-Title': this.appTitle,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // Network failure or abort -> retryable
      throw new RetryableAIError(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new FatalAIError('OpenRouter authentication failed. Check OPENROUTER_API_KEY.', res.status);
    }
    if (res.status === 400 || res.status === 422) {
      const detail = redact(await safeText(res));
      throw new FatalAIError(`OpenRouter rejected the request: ${detail}`, res.status);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableAIError(`OpenRouter responded ${res.status}`, res.status);
    }
    if (!res.ok) {
      throw new FatalAIError(`OpenRouter responded ${res.status}`, res.status);
    }

    const json = (await res.json()) as OpenRouterResponse;
    if (json.error) {
      throw new FatalAIError(`OpenRouter error: ${json.error.message ?? 'unknown'}`);
    }
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new RetryableAIError('OpenRouter returned an empty completion.');
    }
    return {
      text,
      model: json.model ?? model,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
      },
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
