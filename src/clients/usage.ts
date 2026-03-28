/** Token usage tracking helpers. */

import { AsyncLocalStorage } from "node:async_hooks";
/** Usage counters accumulated across model calls. */

export class UsageMetadata {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;

  constructor(total_input_tokens = 0, total_output_tokens = 0, total_cost = 0) {
    this.total_input_tokens = total_input_tokens;
    this.total_output_tokens = total_output_tokens;
    this.total_cost = total_cost;
  }

  add(other: UsageMetadata): UsageMetadata {
    return new UsageMetadata(
      this.total_input_tokens + other.total_input_tokens,
      this.total_output_tokens + other.total_output_tokens,
      this.total_cost + other.total_cost,
    );
  }

  toDict(): Record<string, number> {
    return {
      total_input_tokens: this.total_input_tokens,
      total_output_tokens: this.total_output_tokens,
      total_cost: this.total_cost,
    };
  }

  static fromDict(data: Record<string, unknown>): UsageMetadata {
    return new UsageMetadata(
      Number(data.total_input_tokens ?? 0),
      Number(data.total_output_tokens ?? 0),
      Number(data.total_cost ?? 0),
    );
  }

  format(): string {
    let summary = `Input: ${this.total_input_tokens.toLocaleString()}, Output: ${this.total_output_tokens.toLocaleString()}`;
    if (this.total_cost > 0) {
      summary = `${summary}, Cost: $${this.total_cost.toFixed(4)}`;
    }
    return summary;
  }
}

export const EMPTY_USAGE = new UsageMetadata();

const usageStorage = new AsyncLocalStorage<UsageMetadata>();
/** Return the usage storage backend. */

function getStorage(): UsageMetadata {
  const store = usageStorage.getStore();
  if (store) {
    return store;
  }

  const usage = new UsageMetadata();
  usageStorage.enterWith(usage);
  return usage;
}
/** Reset the accumulated usage counters. */

export function resetUsage(): void {
  usageStorage.enterWith(new UsageMetadata());
}
/** Track usage values for the current response. */

export function trackUsage(
  inputTokens: number,
  outputTokens: number,
  cost: number,
): void {
  const storage = getStorage();
  storage.total_input_tokens += Number(inputTokens || 0);
  storage.total_output_tokens += Number(outputTokens || 0);
  storage.total_cost += Number(cost || 0);
}
/** Return the accumulated usage for the current response. */

export function getUsage(): Record<string, number> {
  return getStorage().toDict();
}
/** Return the accumulated usage across responses. */

export function getAccumulatedUsage(): UsageMetadata {
  return getStorage();
}
/** Create a graph node that resets usage counters. */

export function createResetUsageNode() {
  return function resetUsageNode<TState>(
    _state: TState,
  ): Record<string, number> {
    resetUsage();
    return {
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost: 0,
    };
  };
}
/** Create a graph node that captures usage counters. */

export function createCaptureUsageNode() {
  return function captureUsageNode(
    state: UsageMetadata,
  ): Record<string, number> {
    return {
      total_input_tokens: state.total_input_tokens,
      total_output_tokens: state.total_output_tokens,
      total_cost: state.total_cost,
    };
  };
}
