// Typed infrastructure failure (docs/06 §7). Thrown when a dependency — TEI ('tei'),
// Qdrant ('qdrant') or the generation LLM ('llm') — is unreachable, times out, or
// errors mid-request. The service error handler (docs/08 §5 "graceful failure") maps
// it to HTTP 503 {error:'dependency_unavailable', dependency, detail} so Druid gets a
// prompt, machine-readable signal and falls back to its current logic instead of hanging.

export class DependencyError extends Error {
  /** @param {'tei'|'qdrant'|'llm'} dependency @param {string} detail */
  constructor(dependency, detail, opts) {
    super(`${dependency} unavailable: ${detail}`, opts);
    this.name = 'DependencyError';
    this.dependency = dependency;
    this.detail = detail;
  }

  // Wrap a raw failure (fetch TypeError, AbortSignal TimeoutError, client error) at a
  // dependency call site; an already-typed error passes through unchanged.
  static wrap(dependency, err) {
    if (err instanceof DependencyError) return err;
    return new DependencyError(dependency, err?.message ?? String(err), { cause: err });
  }
}
