import type { VectorStore } from "../../interfaces/vector-store.js";
import type {
	BatchOptions,
	CollectionConfig,
	CollectionInfo,
	SearchQuery,
	SearchResult,
	MetadataValue,
	VectorRecord,
} from "../../types/index.js";
import {
	AdapterError,
	CollectionAlreadyExistsError,
	CollectionNotFoundError,
	ConnectionError,
	VectorNotFoundError,
} from "../../errors.js";
import { processBatches } from "../../utils/batch.js";
import { translateFilter } from "./filter.js";

/**
 * Configuration for the Milvus adapter.
 */
export interface MilvusAdapterConfig {
	/** Milvus server address (e.g., "localhost:19530"). */
	address?: string;

	/** Authentication token (for Zilliz Cloud). */
	token?: string;

	/** Username for authentication. */
	username?: string;

	/** Password for authentication. */
	password?: string;

	/**
	 * Index type for vector search.
	 * @default "HNSW"
	 */
	indexType?: string;

	/**
	 * Index build parameters.
	 * @default { M: 16, efConstruction: 256 }
	 */
	indexParams?: Record<string, number>;

	/**
	 * Search parameters.
	 * @default { ef: 64 }
	 */
	searchParams?: Record<string, number>;
}

// Minimal type for the Milvus client to avoid deep coupling to SDK types
type MilvusClient = {
	connectPromise: Promise<void>;
	createCollection(params: Record<string, unknown>): Promise<unknown>;
	dropCollection(params: { collection_name: string }): Promise<unknown>;
	hasCollection(params: { collection_name: string }): Promise<{ value: boolean }>;
	showCollections(): Promise<{ data: { name: string }[] }>;
	describeCollection(params: { collection_name: string }): Promise<{
		schema: { fields: { name: string; data_type: string; type_params: { dim?: string }[] }[] };
	}>;
	getCollectionStatistics(params: { collection_name: string }): Promise<{
		data: { row_count: number };
	}>;
	createIndex(params: Record<string, unknown>): Promise<unknown>;
	loadCollectionSync(params: { collection_name: string }): Promise<unknown>;
	releaseCollection(params: { collection_name: string }): Promise<unknown>;
	insert(params: { collection_name: string; data: Record<string, unknown>[] }): Promise<{ IDs?: string[] }>;
	upsert(params: { collection_name: string; data: Record<string, unknown>[] }): Promise<unknown>;
	get(params: { collection_name: string; ids: string[]; output_fields: string[] }): Promise<{ data: Record<string, unknown>[] }>;
	query(params: { collection_name: string; filter: string; output_fields: string[]; limit?: number }): Promise<{ data: Record<string, unknown>[] }>;
	deleteEntities(params: { collection_name: string; filter: string }): Promise<unknown>;
	search(params: Record<string, unknown>): Promise<{ results: { id: string; score: number; [key: string]: unknown }[] }>;
	close(): Promise<void>;
};

/**
 * Milvus/Zilliz vector database adapter.
 *
 * Wraps the `@zilliz/milvus2-sdk-node` SDK and implements the unified
 * `VectorStore` interface. Handles the complex Milvus lifecycle internally:
 * schema definition, index creation, and collection loading.
 *
 * @example
 * ```ts
 * import { MilvusAdapter } from "@victor/core/milvus";
 *
 * const adapter = new MilvusAdapter({
 *   address: "localhost:19530",
 * });
 * await adapter.connect();
 *
 * // Or for Zilliz Cloud:
 * const adapter = new MilvusAdapter({
 *   address: "your-endpoint.zillizcloud.com:443",
 *   token: "your-api-key",
 * });
 * ```
 *
 * @requires @zilliz/milvus2-sdk-node
 */
export class MilvusAdapter implements VectorStore {
	readonly name = "milvus";
	private client: MilvusClient | null = null;
	private readonly config: MilvusAdapterConfig;

	constructor(config: MilvusAdapterConfig = {}) {
		this.config = config;
	}

	// ── Connection ───────────────────────────────────────────────────

	async connect(): Promise<void> {
		try {
			const { MilvusClient } = await import("@zilliz/milvus2-sdk-node");

			const clientConfig: Record<string, unknown> = {
				address: this.config.address ?? "localhost:19530",
			};

			if (this.config.token) {
				clientConfig.token = this.config.token;
			}
			if (this.config.username && this.config.password) {
				clientConfig.username = this.config.username;
				clientConfig.password = this.config.password;
			}

			this.client = new MilvusClient(clientConfig as { address: string }) as unknown as MilvusClient;
			await this.client.connectPromise;
		} catch (error) {
			throw new ConnectionError("milvus", error);
		}
	}

	async disconnect(): Promise<void> {
		if (this.client) {
			try {
				await this.client.close();
			} catch {
				// Ignore close errors
			}
			this.client = null;
		}
	}

	// ── Collection Management ────────────────────────────────────────

	async createCollection(config: CollectionConfig): Promise<void> {
		const client = this.getClient();
		try {
			const hasResult = await client.hasCollection({
				collection_name: config.name,
			});
			if (hasResult.value) {
				throw new CollectionAlreadyExistsError(config.name);
			}

			const { DataType } = await import("@zilliz/milvus2-sdk-node");

			// Create collection with schema
			await client.createCollection({
				collection_name: config.name,
				fields: [
					{
						name: "id",
						data_type: DataType.VarChar,
						is_primary_key: true,
						max_length: 256,
					},
					{
						name: "vector",
						data_type: DataType.FloatVector,
						dim: config.dimension,
					},
					{
						name: "metadata",
						data_type: DataType.JSON,
					},
				],
				enable_dynamic_field: true,
			});

			// Create index on vector field
			const indexType = (config.adapterOptions?.indexType as string) ?? this.config.indexType ?? "HNSW";
			const indexParams = (config.adapterOptions?.indexParams as Record<string, number>) ??
				this.config.indexParams ?? { M: 16, efConstruction: 256 };

			await client.createIndex({
				collection_name: config.name,
				field_name: "vector",
				index_type: indexType,
				metric_type: this.toNativeMetric(config.metric ?? "cosine"),
				params: indexParams,
			});

			// Load collection into memory for searching
			await client.loadCollectionSync({
				collection_name: config.name,
			});
		} catch (error) {
			if (error instanceof CollectionAlreadyExistsError) throw error;
			throw new AdapterError("milvus", "createCollection", error);
		}
	}

	async listCollections(): Promise<string[]> {
		const client = this.getClient();
		try {
			const result = await client.showCollections();
			return result.data.map((c) => c.name);
		} catch (error) {
			throw new AdapterError("milvus", "listCollections", error);
		}
	}

	async deleteCollection(name: string): Promise<void> {
		const client = this.getClient();
		try {
			const hasResult = await client.hasCollection({ collection_name: name });
			if (!hasResult.value) {
				throw new CollectionNotFoundError(name);
			}
			await client.dropCollection({ collection_name: name });
		} catch (error) {
			if (error instanceof CollectionNotFoundError) throw error;
			throw new AdapterError("milvus", "deleteCollection", error);
		}
	}

	async describeCollection(name: string): Promise<CollectionInfo> {
		const client = this.getClient();
		try {
			const hasResult = await client.hasCollection({ collection_name: name });
			if (!hasResult.value) {
				throw new CollectionNotFoundError(name);
			}

			const desc = await client.describeCollection({ collection_name: name });
			const stats = await client.getCollectionStatistics({ collection_name: name });

			let dimension = 0;
			const vectorField = desc.schema.fields.find(
				(f) => f.data_type === "FloatVector" || f.data_type === "101",
			);
			if (vectorField?.type_params) {
				const dimParam = vectorField.type_params.find(
					(p) => "dim" in p,
				);
				if (dimParam?.dim) {
					dimension = Number.parseInt(dimParam.dim, 10);
				}
			}

			return {
				name,
				dimension,
				metric: "cosine", // Milvus doesn't easily expose this via describe
				count: stats.data.row_count,
			};
		} catch (error) {
			if (error instanceof CollectionNotFoundError) throw error;
			throw new AdapterError("milvus", "describeCollection", error);
		}
	}

	// ── CRUD ─────────────────────────────────────────────────────────

	async upsert(collection: string, records: VectorRecord[]): Promise<void> {
		const client = this.getClient();
		try {
			await client.upsert({
				collection_name: collection,
				data: records.map((r) => ({
					id: r.id,
					vector: r.values,
					metadata: r.metadata ?? {},
				})),
			});
		} catch (error) {
			throw new AdapterError("milvus", "upsert", error);
		}
	}

	async get(collection: string, ids: string[]): Promise<VectorRecord[]> {
		const client = this.getClient();
		try {
			const result = await client.get({
				collection_name: collection,
				ids,
				output_fields: ["id", "vector", "metadata"],
			});

			return result.data.map((row) => ({
				id: String(row.id),
				values: (row.vector as number[]) ?? [],
				metadata: this.normalizeMetadata(row.metadata as Record<string, unknown> | undefined),
			}));
		} catch (error) {
			throw new AdapterError("milvus", "get", error);
		}
	}

	async update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void> {
		const client = this.getClient();
		try {
			// Verify record exists
			const existing = await client.get({
				collection_name: collection,
				ids: [id],
				output_fields: ["id", "vector", "metadata"],
			});

			if (existing.data.length === 0) {
				throw new VectorNotFoundError(id, collection);
			}

			const currentRow = existing.data[0]!;
			await client.upsert({
				collection_name: collection,
				data: [
					{
						id,
						vector: data.values ?? currentRow.vector,
						metadata: data.metadata
							? { ...(currentRow.metadata as Record<string, unknown>), ...data.metadata }
							: currentRow.metadata,
					},
				],
			});
		} catch (error) {
			if (error instanceof VectorNotFoundError) throw error;
			throw new AdapterError("milvus", "update", error);
		}
	}

	async delete(collection: string, ids: string[]): Promise<void> {
		const client = this.getClient();
		try {
			const idList = ids.map((id) => `"${id}"`).join(", ");
			await client.deleteEntities({
				collection_name: collection,
				filter: `id in [${idList}]`,
			});
		} catch (error) {
			throw new AdapterError("milvus", "delete", error);
		}
	}

	// ── Search ───────────────────────────────────────────────────────

	async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
		const client = this.getClient();
		try {
			const outputFields: string[] = ["id"];
			if (query.includeMetadata !== false) outputFields.push("metadata");
			if (query.includeValues) outputFields.push("vector");

			const searchParams: Record<string, unknown> = {
				collection_name: collection,
				data: [query.vector],
				limit: query.topK,
				output_fields: outputFields,
				params: this.config.searchParams ?? { ef: 64 },
			};

			if (query.filter) {
				searchParams.filter = translateFilter(query.filter);
			}

			const result = await client.search(searchParams);

			return result.results.map((row) => ({
				id: String(row.id),
				score: row.score,
				values: query.includeValues
					? (row.vector as number[] | undefined)
					: undefined,
				metadata:
					query.includeMetadata !== false
						? this.normalizeMetadata(row.metadata as Record<string, unknown> | undefined)
						: undefined,
			}));
		} catch (error) {
			throw new AdapterError("milvus", "search", error);
		}
	}

	// ── Batch ────────────────────────────────────────────────────────

	async batchUpsert(
		collection: string,
		records: VectorRecord[],
		options?: BatchOptions,
	): Promise<void> {
		await processBatches(
			records,
			(batch) => this.upsert(collection, batch),
			options,
			1000, // Milvus handles larger batches well
		);
	}

	async batchDelete(
		collection: string,
		ids: string[],
		options?: BatchOptions,
	): Promise<void> {
		await processBatches(
			ids,
			(batch) => this.delete(collection, batch),
			options,
			1000,
		);
	}

	// ── Private ──────────────────────────────────────────────────────

	private getClient(): MilvusClient {
		if (!this.client) {
			throw new ConnectionError("milvus");
		}
		return this.client;
	}

	private toNativeMetric(metric: string): string {
		const map: Record<string, string> = {
			cosine: "COSINE",
			euclidean: "L2",
			dotproduct: "IP",
		};
		return map[metric] ?? "COSINE";
	}

	private normalizeMetadata(
		metadata: Record<string, unknown> | undefined,
	): Record<string, MetadataValue> | undefined {
		if (!metadata) return undefined;

		const result: Record<string, MetadataValue> = {};
		for (const [key, value] of Object.entries(metadata)) {
			if (
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean"
			) {
				result[key] = value;
			} else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
				result[key] = value as string[];
			}
		}
		return result;
	}
}
