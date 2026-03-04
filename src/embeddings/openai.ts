import type { Embedder } from "../interfaces/embedder.js";
import type { EmbedderConfig, EmbeddingResult } from "../types/index.js";
import { AdapterError, ValidationError } from "../errors.js";
import { chunk } from "../utils/batch.js";

/**
 * Known OpenAI embedding model dimensions.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
	"text-embedding-ada-002": 1536,
};

/**
 * OpenAI embedding provider.
 *
 * Wraps the `openai` SDK to provide text-to-vector embedding
 * via OpenAI's embedding models.
 *
 * @example
 * ```ts
 * import { OpenAIEmbedder } from "@victor/core/embeddings/openai";
 *
 * const embedder = new OpenAIEmbedder({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: "text-embedding-3-small",
 * });
 *
 * const result = await embedder.embed("Hello world");
 * console.log(result.values.length); // 1536
 * ```
 *
 * @requires openai
 */
export class OpenAIEmbedder implements Embedder {
	readonly model: string;
	readonly dimensions: number;

	private client: { embeddings: { create: (params: Record<string, unknown>) => Promise<{ data: { embedding: number[]; index: number }[]; usage?: { prompt_tokens: number; total_tokens: number } }> } } | null =
		null;
	private readonly config: EmbedderConfig;
	private readonly maxBatchSize: number;

	constructor(config: EmbedderConfig) {
		if (!config.model) {
			throw new ValidationError("OpenAI embedding model is required.");
		}

		this.config = config;
		this.model = config.model;
		this.dimensions = MODEL_DIMENSIONS[config.model] ?? 1536;
		this.maxBatchSize = config.maxBatchSize ?? 2048;
	}

	async embed(text: string): Promise<EmbeddingResult> {
		const client = await this.getClient();

		try {
			const response = await client.embeddings.create({
				model: this.model,
				input: text,
			});

			const embedding = response.data[0];
			if (!embedding) {
				throw new Error("No embedding returned from OpenAI.");
			}

			return {
				values: embedding.embedding,
				tokenCount: response.usage?.total_tokens,
			};
		} catch (error) {
			throw new AdapterError("openai-embedder", "embed", error);
		}
	}

	async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
		if (texts.length === 0) return [];

		const client = await this.getClient();
		const batches = chunk(texts, this.maxBatchSize);
		const allResults: EmbeddingResult[] = [];

		try {
			for (const batch of batches) {
				const response = await client.embeddings.create({
					model: this.model,
					input: batch,
				});

				// Sort by index to maintain order
				const sorted = [...response.data].sort((a, b) => a.index - b.index);

				for (const item of sorted) {
					allResults.push({
						values: item.embedding,
						tokenCount: response.usage?.total_tokens
							? Math.round(response.usage.total_tokens / batch.length)
							: undefined,
					});
				}
			}

			return allResults;
		} catch (error) {
			throw new AdapterError("openai-embedder", "embedBatch", error);
		}
	}

	// ── Private ──────────────────────────────────────────────────────

	private async getClient() {
		if (this.client) return this.client;

		try {
			const openaiModule = await import("openai");
			const OpenAI = openaiModule.default ?? openaiModule.OpenAI;

			const clientConfig: Record<string, unknown> = {
				apiKey: this.config.apiKey ?? process.env.OPENAI_API_KEY,
			};
			if (this.config.baseUrl) {
				clientConfig.baseURL = this.config.baseUrl;
			}

			this.client = new OpenAI(clientConfig) as unknown as typeof this.client;
			return this.client!;
		} catch (error) {
			throw new AdapterError("openai-embedder", "initialize", error);
		}
	}
}
