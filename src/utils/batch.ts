import type { BatchOptions } from "../types/index.js";

/**
 * Split an array into chunks of the given size.
 */
export function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

/**
 * Process items in batches, calling the handler for each batch.
 *
 * @param items - The full array of items to process.
 * @param handler - Async function to process each batch.
 * @param options - Batch size and optional progress callback.
 * @param defaultBatchSize - Default batch size if not specified in options.
 */
export async function processBatches<T>(
	items: T[],
	handler: (batch: T[]) => Promise<void>,
	options?: BatchOptions,
	defaultBatchSize = 100,
): Promise<void> {
	const batchSize = options?.batchSize ?? defaultBatchSize;
	const batches = chunk(items, batchSize);

	for (let i = 0; i < batches.length; i++) {
		const batch = batches[i];
		if (batch) {
			await handler(batch);
			options?.onBatchComplete?.(i, batches.length);
		}
	}
}
