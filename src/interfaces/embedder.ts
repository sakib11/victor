import type { EmbeddingResult } from "../types/index.js";

/**
 * Interface for embedding providers that convert text to vectors.
 *
 * Implementations wrap specific providers (OpenAI, Cohere, etc.)
 * and expose a uniform embedding API used by VictorClient for
 * text-based operations like `searchByText` and `upsertText`.
 *
 * @example
 * ```ts
 * import { OpenAIEmbedder } from "@victor/core/embeddings/openai";
 *
 * const embedder = new OpenAIEmbedder({
 *   apiKey: "sk-...",
 *   model: "text-embedding-3-small",
 * });
 *
 * const result = await embedder.embed("Hello world");
 * console.log(result.values); // [0.012, -0.034, ...]
 * ```
 */
export interface Embedder {
	/** The model name being used (e.g., "text-embedding-3-small"). */
	readonly model: string;

	/** The dimensionality of vectors produced by this embedder. */
	readonly dimensions: number;

	/**
	 * Embed a single text string into a vector.
	 */
	embed(text: string): Promise<EmbeddingResult>;

	/**
	 * Embed multiple texts in a single batch call.
	 * More efficient than calling `embed` repeatedly.
	 */
	embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}
