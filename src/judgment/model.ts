/**
 * The model boundary of the judgment pass.
 *
 * Everything that talks to the Anthropic API lives behind {@link JudgmentModelClient},
 * so the runner, the eval harness, and the unit tests all drive the same code path —
 * tests substitute a scripted client and never touch the network.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface JudgmentRequest {
  system: string;
  user: string;
  /** JSON schema the response must conform to, enforced via structured outputs. */
  schema: Record<string, unknown>;
}

export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export type JudgmentResponse =
  | { ok: true; json: unknown; usage: UsageDelta }
  | {
      /**
       * `refusal` — the API's safety classifiers declined the request (an HTTP 200, not
       * an error; possible on Claude Opus 5 / Fable 5 even for benign content).
       * `error` — anything else. Either way the check is skipped, never guessed.
       */
      ok: false;
      reason: 'refusal' | 'error';
      message: string;
      usage: UsageDelta;
    };

export interface JudgmentModelClient {
  readonly model: string;
  complete(request: JudgmentRequest): Promise<JudgmentResponse>;
}

export const ZERO_USAGE: UsageDelta = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

/**
 * USD per million tokens, used for the `--budget` ceiling and the cost figure in
 * reports. Longest prefix wins, so dated model IDs resolve to their family.
 * An unknown model falls back to Opus-tier pricing — overestimating spend is the
 * safe direction for a budget ceiling.
 */
const PRICING_BY_PREFIX: [prefix: string, inputPerMTok: number, outputPerMTok: number][] = [
  ['claude-fable-5', 10, 50],
  ['claude-mythos-5', 10, 50],
  ['claude-opus', 5, 25],
  ['claude-sonnet', 3, 15],
  ['claude-haiku', 1, 5],
];

const FALLBACK_PRICING: [number, number] = [5, 25];

export function estimateCostUsd(model: string, usage: UsageDelta): number {
  const [inputRate, outputRate] =
    PRICING_BY_PREFIX.find(([prefix]) => model.startsWith(prefix))?.slice(1) ?? FALLBACK_PRICING;

  // Cache reads bill at ~0.1x the input rate, cache writes at ~1.25x.
  const inputCost =
    (usage.inputTokens + usage.cacheReadTokens * 0.1 + usage.cacheCreationTokens * 1.25) *
    (Number(inputRate) / 1_000_000);
  const outputCost = usage.outputTokens * (Number(outputRate) / 1_000_000);
  return inputCost + outputCost;
}

/** Models where the server-side refusal fallback is available and worth opting into. */
function supportsServerFallback(model: string): boolean {
  return model.startsWith('claude-opus-5') || model.startsWith('claude-fable-5');
}

const MAX_TOKENS = 16_000;

export class AnthropicModelClient implements JudgmentModelClient {
  private readonly client: Anthropic;
  readonly model: string;

  constructor(model: string) {
    this.model = model;
    // Resolves ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
    this.client = new Anthropic();
  }

  async complete(request: JudgmentRequest): Promise<JudgmentResponse> {
    let response: Anthropic.Message;
    try {
      response = await this.request(request);
    } catch (error) {
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
        usage: ZERO_USAGE,
      };
    }

    const usage: UsageDelta = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    };

    // A refusal is a successful HTTP response — content may be empty or partial, so it
    // must be checked before reading any block.
    if (response.stop_reason === 'refusal') {
      return {
        ok: false,
        reason: 'refusal',
        message: 'The model declined this request (safety classifiers).',
        usage,
      };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    try {
      return { ok: true, json: JSON.parse(text) as unknown, usage };
    } catch {
      return {
        ok: false,
        reason: 'error',
        message: `The model returned unparseable JSON (stop_reason: ${String(response.stop_reason)}).`,
        usage,
      };
    }
  }

  private async request(request: JudgmentRequest): Promise<Anthropic.Message> {
    const params = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: [{ role: 'user' as const, content: request.user }],
      output_config: {
        format: { type: 'json_schema' as const, schema: request.schema },
      },
    };

    // On Opus 5 / Fable 5, opt into the server-side refusal fallback: a benign request
    // that trips the safety classifiers is re-run on Anthropic's recommended substitute
    // model instead of surfacing as a skipped check.
    if (supportsServerFallback(this.model)) {
      return this.client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }) as Promise<Anthropic.Message>;
    }

    return this.client.messages.create(params);
  }
}
