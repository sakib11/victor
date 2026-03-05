import type { Embedder } from "../interfaces/embedder.js";
import type { EmbedderConfig, EmbeddingResult } from "../types/index.js";
import { AdapterError, ValidationError } from "../errors.js";
import { chunk } from "../utils/batch.js";

/**
 * Known Cohere embedding model dimensions.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
	"embed-english-v3.0": 1024,
	"embed-multilingual-v3.0": 1024,
	"embed-english-light-v3.0": 384,
	"embed-multilingual-light-v3.0": 384,
	"embed-english-v2.0": 4096,
	"embed-english-light-v2.0": 1024,
	"embed-multilingual-v2.0": 768,
};

/**
 * Cohere input types for embedding requests.
 */
type CohereInputType =
	| "search_document"
	| "search_query"
	| "classification"
	| "clustering";

/**
 * Configuration for the Cohere embedder, extending the base EmbedderConfig.
 */
export interface CohereEmbedderConfig extends EmbedderConfig {
	/**
	 * Input type for the embedding.
	 * - `search_document`: For documents to be searched (indexing)
	 * - `search_query`: For search queries (searching)
	 * - `classification`: For classification tasks
	 * - `clustering`: For clustering tasks
	 *
	 * @default "search_document" for embed/embedBatch, "search_query" for search operations
	 */
	inputType?: CohereInputType;
}

// Minimal Cohere client type
type CohereClient = {
	embed(params: {
		texts: string[];
		model: string;
		inputType: string;
		embeddingTypes?: string[];
	}): Promise<{
		embeddings: { float: number[][] };
		meta?: { billedUnits?: { inputTokens?: number } };
	}>;
};

/**
 * Cohere embedding provider.
 *
 * Wraps the `cohere-ai` SDK to provide text-to-vector embedding
 * via Cohere's embedding models.
 *
 * @example
 * ```ts
 * import { CohereEmbedder } from "@amanat_doulah/victor-db/embeddings/cohere";
 *
 * const embedder = new CohereEmbedder({
 *   apiKey: process.env.COHERE_API_KEY,
 *   model: "embed-english-v3.0",
 * });
 *
 * const result = await embedder.embed("Hello world");
 * console.log(result.values.length); // 1024
 * ```
 *
 * @requires cohere-ai
 */
export class CohereEmbedder implements Embedder {
	readonly model: string;
	readonly dimensions: number;

	private client: CohereClient | null = null;
	private readonly config: CohereEmbedderConfig;
	private readonly maxBatchSize: number;
	private readonly inputType: CohereInputType;

	constructor(config: CohereEmbedderConfig) {
		if (!config.model) {
			throw new ValidationError("Cohere embedding model is required.");
		}

		this.config = config;
		this.model = config.model;
		this.dimensions = MODEL_DIMENSIONS[config.model] ?? 1024;
		this.maxBatchSize = config.maxBatchSize ?? 96; // Cohere's limit
		this.inputType = config.inputType ?? "search_document";
	}

	async embed(text: string): Promise<EmbeddingResult> {
		const results = await this.embedBatch([text]);
		return results[0]!;
	}

	async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
		if (texts.length === 0) return [];

		const client = await this.getClient();
		const batches = chunk(texts, this.maxBatchSize);
		const allResults: EmbeddingResult[] = [];

		try {
			for (const batch of batches) {
				const response = await client.embed({
					texts: batch,
					model: this.model,
					inputType: this.inputType,
					embeddingTypes: ["float"],
				});

				const embeddings = response.embeddings.float;
				const tokensPerText = response.meta?.billedUnits?.inputTokens
					? Math.round(response.meta.billedUnits.inputTokens / batch.length)
					: undefined;

				for (const embedding of embeddings) {
					allResults.push({
						values: embedding,
						tokenCount: tokensPerText,
					});
				}
			}

			return allResults;
		} catch (error) {
			throw new AdapterError("cohere-embedder", "embedBatch", error);
		}
	}

	// ── Private ──────────────────────────────────────────────────────

	private async getClient(): Promise<CohereClient> {
		if (this.client) return this.client;

		try {
			const cohereModule = await import("cohere-ai");
			const CohereClientV2 = cohereModule.CohereClientV2 ?? (cohereModule as unknown as { default: { CohereClientV2: new (params: Record<string, unknown>) => CohereClient } }).default.CohereClientV2;

			this.client = new CohereClientV2({
				token: this.config.apiKey ?? process.env.COHERE_API_KEY ?? process.env.CO_API_KEY,
			}) as unknown as CohereClient;

			return this.client;
		} catch (error) {
			throw new AdapterError("cohere-embedder", "initialize", error);
		}
	}
}
