/**
 * Rich diagnostics for fetch/LLM failures (cause chains, stage labels).
 */

export type FetchFailureStage = 'main-llm' | 'reference-summary' | 'reference-fetch';

function errnoExtras(err: Error): string {
  const n = err as NodeJS.ErrnoException & { address?: string; port?: number };
  const bits: string[] = [];
  if (typeof n.code === 'string' && n.code.length > 0) {
    bits.push(`code=${n.code}`);
  }
  if (typeof n.syscall === 'string' && n.syscall.length > 0) {
    bits.push(`syscall=${n.syscall}`);
  }
  if (typeof n.address === 'string' && n.address.length > 0) {
    bits.push(`address=${n.address}`);
  }
  if (typeof n.port === 'number') {
    bits.push(`port=${n.port}`);
  }
  return bits.length ? ` (${bits.join(', ')})` : '';
}

/**
 * Walks Error.cause chain and optional errno fields for Node network errors.
 */
export function formatErrorChain(err: unknown, maxDepth = 6): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;

  while (cur != null && depth < maxDepth) {
    if (cur instanceof Error) {
      let s = cur.message || cur.name || 'Error';
      s += errnoExtras(cur);
      parts.push(s);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
    depth++;
  }

  return parts.filter(Boolean).join(' | ');
}

export function summarizeFetchFailure(
  stage: FetchFailureStage,
  url: string,
  err: unknown
): string {
  const chain = formatErrorChain(err);
  const hint =
    stage === 'reference-fetch'
      ? 'Check network, VPN, firewall, DNS, and that the URL is reachable.'
      : 'Check network access and extension settings.';
  return `[${stage}] Request failed for ${url}: ${chain}. ${hint}`;
}

export function summarizeHttpFailure(
  stage: FetchFailureStage,
  url: string,
  status: number,
  bodySnippet: string
): string {
  return `[${stage}] HTTP ${status} for ${url}: ${bodySnippet}`;
}
