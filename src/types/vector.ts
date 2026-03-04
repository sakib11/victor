/**
 * Primitive types allowed in vector metadata values.
 */
export type MetadataValue = string | number | boolean | string[];

/**
 * A record representing a single vector with its ID, embedding values, and optional metadata.
 *
 * This is the unified data shape used across all adapters.
 * Each adapter is responsible for translating this into its native format.
 */
export interface VectorRecord {
	/** Unique identifier for this vector. */
	id: string;

	/** The embedding values (dense vector). */
	values: number[];

	/** Arbitrary key-value metadata attached to this vector. */
	metadata?: Record<string, MetadataValue>;
}

/**
 * A single search result returned from a similarity query.
 */
export interface SearchResult {
	/** The ID of the matched vector. */
	id: string;

	/**
	 * Similarity/distance score.
	 * Higher = more similar for cosine/dotproduct.
	 * Lower = more similar for euclidean (distance).
	 * Each adapter normalizes scores so higher is always better.
	 */
	score: number;

	/** The embedding values, if `includeValues` was set in the query. */
	values?: number[];

	/** Metadata of the matched vector, if `includeMetadata` was set in the query. */
	metadata?: Record<string, MetadataValue>;
}

/**
 * Parameters for a similarity search query.
 */
export interface SearchQuery {
	/** The query vector to find similar vectors for. */
	vector: number[];

	/** Number of top results to return. */
	topK: number;

	/** Optional metadata filter to narrow results. */
	filter?: import("./filter.js").MetadataFilter;

	/** Whether to include metadata in results. Defaults to `true`. */
	includeMetadata?: boolean;

	/** Whether to include vector values in results. Defaults to `false`. */
	includeValues?: boolean;
}

/**
 * Options for batch operations.
 */
export interface BatchOptions {
	/** Number of records per batch. Defaults to adapter-specific limits. */
	batchSize?: number;

	/** Called after each batch completes. */
	onBatchComplete?: (batchIndex: number, totalBatches: number) => void;
}

/**
 * Distance metric used for similarity computation.
 */
export type DistanceMetric = "cosine" | "euclidean" | "dotproduct";
