/**
 * Configuration for an embedding provider.
 */
export interface EmbedderConfig {
	/** API key for the embedding provider. */
	apiKey?: string;

	/** Model identifier (e.g., "text-embedding-3-small", "embed-english-v3.0"). */
	model: string;

	/**
	 * Maximum number of texts to embed in a single API call.
	 * Defaults to provider-specific limits.
	 */
	maxBatchSize?: number;

	/** Base URL override for custom/proxy endpoints. */
	baseUrl?: string;
}

/**
 * Result of an embedding operation.
 */
export interface EmbeddingResult {
	/** The embedding vector. */
	values: number[];

	/** Number of tokens used (if reported by the provider). */
	tokenCount?: number;
}

/**
 * Input for text-based operations on the VictorClient.
 */
export interface TextRecord {
	/** Unique identifier for this record. */
	id: string;

	/** The text content to be embedded. */
	text: string;

	/** Optional metadata to store alongside the vector. */
	metadata?: Record<string, import("./vector.js").MetadataValue>;
}

/**
 * Search query using text instead of a raw vector.
 * The text will be embedded automatically using the configured embedder.
 */
export interface TextSearchQuery {
	/** The text to search for. */
	text: string;

	/** Number of top results to return. */
	topK: number;

	/** Optional metadata filter. */
	filter?: import("./filter.js").MetadataFilter;

	/** Whether to include metadata in results. Defaults to `true`. */
	includeMetadata?: boolean;

	/** Whether to include vector values in results. Defaults to `false`. */
	includeValues?: boolean;
}
