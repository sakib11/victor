/**
 * Options for configuring retry behavior.
 */
export interface RetryOptions {
	/** Maximum number of retry attempts. Defaults to 3. */
	maxRetries?: number;

	/** Initial delay in milliseconds before the first retry. Defaults to 1000. */
	initialDelayMs?: number;

	/** Maximum delay in milliseconds between retries. Defaults to 10000. */
	maxDelayMs?: number;

	/** Multiplier for exponential backoff. Defaults to 2. */
	backoffMultiplier?: number;

	/**
	 * Function to determine if an error is retryable.
	 * Defaults to retrying on network/timeout errors.
	 */
	isRetryable?: (error: unknown) => boolean;
}

/**
 * Default check for retryable errors.
 * Retries on network errors, timeouts, and 5xx status codes.
 */
function defaultIsRetryable(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		// Network/timeout errors
		if (
			message.includes("timeout") ||
			message.includes("econnrefused") ||
			message.includes("econnreset") ||
			message.includes("socket hang up") ||
			message.includes("network") ||
			message.includes("fetch failed")
		) {
			return true;
		}

		// HTTP 5xx errors (common pattern in SDK errors)
		if (message.includes("status 5") || message.includes("internal server error")) {
			return true;
		}

		// Rate limiting
		if (message.includes("rate limit") || message.includes("429") || message.includes("too many requests")) {
			return true;
		}
	}
	return false;
}

/**
 * Execute an async function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute.
 * @param options - Retry configuration.
 * @returns The result of the function.
 * @throws The last error if all retries are exhausted.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => someFlaklyApiCall(),
 *   { maxRetries: 3, initialDelayMs: 500 }
 * );
 * ```
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options?: RetryOptions,
): Promise<T> {
	const maxRetries = options?.maxRetries ?? 3;
	const initialDelayMs = options?.initialDelayMs ?? 1000;
	const maxDelayMs = options?.maxDelayMs ?? 10000;
	const backoffMultiplier = options?.backoffMultiplier ?? 2;
	const isRetryable = options?.isRetryable ?? defaultIsRetryable;

	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Don't retry if we've exhausted attempts or the error isn't retryable
			if (attempt >= maxRetries || !isRetryable(error)) {
				throw error;
			}

			// Calculate delay with exponential backoff + jitter
			const baseDelay = initialDelayMs * backoffMultiplier ** attempt;
			const jitter = Math.random() * baseDelay * 0.1; // 10% jitter
			const delay = Math.min(baseDelay + jitter, maxDelayMs);

			await sleep(delay);
		}
	}

	// This should not be reachable, but TypeScript needs it
	throw lastError;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
