import type { DistanceMetric } from "./vector.js";

/**
 * Configuration for creating a new vector collection/index.
 *
 * Adapters translate this into database-specific configuration.
 * For example, Milvus will generate a schema with typed fields,
 * create an appropriate index, and load the collection.
 */
export interface CollectionConfig {
	/** Name of the collection/index. */
	name: string;

	/** Dimensionality of vectors in this collection. */
	dimension: number;

	/** Distance metric for similarity computation. Defaults to `"cosine"`. */
	metric?: DistanceMetric;

	/**
	 * Adapter-specific configuration options.
	 * These are passed directly to the underlying database client.
	 *
	 * @example
	 * ```ts
	 * // Pinecone serverless
	 * { cloud: "aws", region: "us-east-1" }
	 *
	 * // Milvus HNSW index params
	 * { indexType: "HNSW", indexParams: { M: 16, efConstruction: 256 } }
	 * ```
	 */
	adapterOptions?: Record<string, unknown>;
}

/**
 * Information about an existing collection.
 */
export interface CollectionInfo {
	/** Name of the collection/index. */
	name: string;

	/** Dimensionality of vectors in this collection. */
	dimension: number;

	/** Distance metric used. */
	metric: DistanceMetric;

	/** Approximate number of vectors stored (may not be exact for all databases). */
	count: number;
}
