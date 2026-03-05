import type {
	BatchOptions,
	CollectionConfig,
	CollectionInfo,
	SearchQuery,
	SearchResult,
	VectorRecord,
} from "../types/index.js";

/**
 * The core interface that all vector database adapters must implement.
 *
 * This provides a unified API across Pinecone, Qdrant, ChromaDB, Milvus,
 * pgvector, and Weaviate. Each adapter translates these operations into
 * the native SDK calls for its database.
 *
 * @example
 * ```ts
 * import { VictorClient } from "victordb";
 * import { PineconeAdapter } from "victordb/pinecone";
 *
 * const store: VectorStore = new PineconeAdapter({ apiKey: "..." });
 * await store.connect();
 * await store.upsert("my-collection", [{ id: "1", values: [0.1, 0.2, ...] }]);
 * ```
 */
export interface VectorStore {
	/** Human-readable name of the adapter (e.g., "pinecone", "qdrant"). */
	readonly name: string;

	// ── Connection Lifecycle ─────────────────────────────────────────

	/**
	 * Initialize the connection to the vector database.
	 * Must be called before any other operations.
	 */
	connect(): Promise<void>;

	/**
	 * Gracefully close the connection and release resources.
	 */
	disconnect(): Promise<void>;

	// ── Collection Management ────────────────────────────────────────

	/**
	 * Create a new collection/index with the given configuration.
	 * Adapters handle database-specific setup (schemas, indexes, loading).
	 *
	 * @throws {CollectionAlreadyExistsError} If the collection already exists.
	 */
	createCollection(config: CollectionConfig): Promise<void>;

	/**
	 * List all collection/index names.
	 */
	listCollections(): Promise<string[]>;

	/**
	 * Delete a collection/index and all its data.
	 *
	 * @throws {CollectionNotFoundError} If the collection does not exist.
	 */
	deleteCollection(name: string): Promise<void>;

	/**
	 * Get information about an existing collection.
	 *
	 * @throws {CollectionNotFoundError} If the collection does not exist.
	 */
	describeCollection(name: string): Promise<CollectionInfo>;

	// ── CRUD Operations ──────────────────────────────────────────────

	/**
	 * Insert or update vectors. If a vector with the same ID exists,
	 * it will be overwritten.
	 */
	upsert(collection: string, records: VectorRecord[]): Promise<void>;

	/**
	 * Retrieve vectors by their IDs.
	 * Returns only the vectors that were found (no error for missing IDs).
	 */
	get(collection: string, ids: string[]): Promise<VectorRecord[]>;

	/**
	 * Update a single vector's values and/or metadata.
	 * Only the provided fields are updated; others remain unchanged.
	 *
	 * @throws {VectorNotFoundError} If no vector with the given ID exists.
	 */
	update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void>;

	/**
	 * Delete vectors by their IDs.
	 * Silently ignores IDs that don't exist.
	 */
	delete(collection: string, ids: string[]): Promise<void>;

	// ── Search ───────────────────────────────────────────────────────

	/**
	 * Perform a similarity search using a query vector.
	 *
	 * @returns Results sorted by relevance (highest score first).
	 */
	search(collection: string, query: SearchQuery): Promise<SearchResult[]>;

	// ── Batch Operations ─────────────────────────────────────────────

	/**
	 * Upsert vectors in batches for better throughput on large datasets.
	 * Internally chunks the records and upserts each batch sequentially.
	 */
	batchUpsert(
		collection: string,
		records: VectorRecord[],
		options?: BatchOptions,
	): Promise<void>;

	/**
	 * Delete vectors in batches.
	 */
	batchDelete(
		collection: string,
		ids: string[],
		options?: BatchOptions,
	): Promise<void>;
}
