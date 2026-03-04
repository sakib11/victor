import type { VectorStore } from "../../interfaces/vector-store.js";
import type {
	BatchOptions,
	CollectionConfig,
	CollectionInfo,
	DistanceMetric,
	SearchQuery,
	SearchResult,
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
 * Configuration for the Pinecone adapter.
 */
export interface PineconeAdapterConfig {
	/**
	 * Pinecone API key. Falls back to `PINECONE_API_KEY` env var if not provided.
	 */
	apiKey?: string;

	/**
	 * Default cloud provider for serverless indexes.
	 * @default "aws"
	 */
	cloud?: string;

	/**
	 * Default region for serverless indexes.
	 * @default "us-east-1"
	 */
	region?: string;

	/**
	 * Optional namespace for partitioning data within an index.
	 */
	namespace?: string;
}

/**
 * Pinecone vector database adapter.
 *
 * Wraps the `@pinecone-database/pinecone` SDK and implements the
 * unified `VectorStore` interface.
 *
 * @example
 * ```ts
 * import { PineconeAdapter } from "@victor/core/pinecone";
 *
 * const adapter = new PineconeAdapter({
 *   apiKey: process.env.PINECONE_API_KEY,
 * });
 * await adapter.connect();
 * ```
 *
 * @requires @pinecone-database/pinecone
 */
export class PineconeAdapter implements VectorStore {
	readonly name = "pinecone";
	private client: import("@pinecone-database/pinecone").Pinecone | null = null;
	private readonly config: PineconeAdapterConfig;

	constructor(config: PineconeAdapterConfig = {}) {
		this.config = config;
	}

	// ── Connection ───────────────────────────────────────────────────

	async connect(): Promise<void> {
		try {
			const { Pinecone } = await import("@pinecone-database/pinecone");
			this.client = new Pinecone({
				apiKey: this.config.apiKey ?? process.env.PINECONE_API_KEY ?? "",
			});
		} catch (error) {
			throw new ConnectionError("pinecone", error);
		}
	}

	async disconnect(): Promise<void> {
		this.client = null;
	}

	// ── Collection Management ────────────────────────────────────────

	async createCollection(config: CollectionConfig): Promise<void> {
		const pc = this.getClient();

		try {
			const existing = await pc.listIndexes();
			const exists = existing.indexes?.some((idx) => idx.name === config.name);
			if (exists) {
				throw new CollectionAlreadyExistsError(config.name);
			}

			const cloud = (config.adapterOptions?.cloud as string) ?? this.config.cloud ?? "aws";
			const region =
				(config.adapterOptions?.region as string) ?? this.config.region ?? "us-east-1";

			await pc.createIndex({
				name: config.name,
				dimension: config.dimension,
				metric: this.toNativeMetric(config.metric ?? "cosine"),
				spec: { serverless: { cloud: cloud as "aws", region } },
				waitUntilReady: true,
			});
		} catch (error) {
			if (error instanceof CollectionAlreadyExistsError) throw error;
			throw new AdapterError("pinecone", "createCollection", error);
		}
	}

	async listCollections(): Promise<string[]> {
		const pc = this.getClient();
		try {
			const result = await pc.listIndexes();
			return result.indexes?.map((idx) => idx.name) ?? [];
		} catch (error) {
			throw new AdapterError("pinecone", "listCollections", error);
		}
	}

	async deleteCollection(name: string): Promise<void> {
		const pc = this.getClient();
		try {
			await pc.deleteIndex(name);
		} catch (error) {
			throw this.handleNotFound(name, error, "deleteCollection");
		}
	}

	async describeCollection(name: string): Promise<CollectionInfo> {
		const pc = this.getClient();
		try {
			const index = await pc.describeIndex(name);
			const stats = await pc.index(name).describeIndexStats();

			return {
				name: index.name,
				dimension: index.dimension,
				metric: this.fromNativeMetric(index.metric),
				count: stats.totalRecordCount ?? 0,
			};
		} catch (error) {
			throw this.handleNotFound(name, error, "describeCollection");
		}
	}

	// ── CRUD ─────────────────────────────────────────────────────────

	async upsert(collection: string, records: VectorRecord[]): Promise<void> {
		const pc = this.getClient();
		try {
			const index = this.getIndex(pc, collection);
			await index.upsert(
				records.map((r) => ({
					id: r.id,
					values: r.values,
					metadata: r.metadata as Record<string, string | number | boolean | string[]>,
				})),
			);
		} catch (error) {
			throw new AdapterError("pinecone", "upsert", error);
		}
	}

	async get(collection: string, ids: string[]): Promise<VectorRecord[]> {
		const pc = this.getClient();
		try {
			const index = this.getIndex(pc, collection);
			const result = await index.fetch(ids);

			return Object.values(result.records).map((record) => ({
				id: record.id,
				values: record.values,
				metadata: record.metadata as Record<string, string | number | boolean | string[]> | undefined,
			}));
		} catch (error) {
			throw new AdapterError("pinecone", "get", error);
		}
	}

	async update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void> {
		const pc = this.getClient();
		try {
			const index = this.getIndex(pc, collection);

			// Verify the vector exists
			const existing = await index.fetch([id]);
			if (!existing.records[id]) {
				throw new VectorNotFoundError(id, collection);
			}

			await index.update({
				id,
				values: data.values,
				metadata: data.metadata as Record<string, string | number | boolean | string[]>,
			});
		} catch (error) {
			if (error instanceof VectorNotFoundError) throw error;
			throw new AdapterError("pinecone", "update", error);
		}
	}

	async delete(collection: string, ids: string[]): Promise<void> {
		const pc = this.getClient();
		try {
			const index = this.getIndex(pc, collection);
			await index.deleteMany(ids);
		} catch (error) {
			throw new AdapterError("pinecone", "delete", error);
		}
	}

	// ── Search ───────────────────────────────────────────────────────

	async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
		const pc = this.getClient();
		try {
			const index = this.getIndex(pc, collection);

			const result = await index.query({
				vector: query.vector,
				topK: query.topK,
				includeMetadata: query.includeMetadata ?? true,
				includeValues: query.includeValues ?? false,
				filter: query.filter ? translateFilter(query.filter) : undefined,
			});

			return (result.matches ?? []).map((match) => ({
				id: match.id,
				score: match.score ?? 0,
				values: match.values,
				metadata: match.metadata as Record<string, string | number | boolean | string[]> | undefined,
			}));
		} catch (error) {
			throw new AdapterError("pinecone", "search", error);
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
			100, // Pinecone recommends batches of 100
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

	private getClient(): import("@pinecone-database/pinecone").Pinecone {
		if (!this.client) {
			throw new ConnectionError("pinecone");
		}
		return this.client;
	}

	private getIndex(
		pc: import("@pinecone-database/pinecone").Pinecone,
		collection: string,
	) {
		const index = pc.index(collection);
		return this.config.namespace ? index.namespace(this.config.namespace) : index;
	}

	private toNativeMetric(metric: string): "cosine" | "euclidean" | "dotproduct" {
		const map: Record<string, "cosine" | "euclidean" | "dotproduct"> = {
			cosine: "cosine",
			euclidean: "euclidean",
			dotproduct: "dotproduct",
		};
		return map[metric] ?? "cosine";
	}

	private fromNativeMetric(metric: string): DistanceMetric {
		const map: Record<string, DistanceMetric> = {
			cosine: "cosine",
			euclidean: "euclidean",
			dotproduct: "dotproduct",
		};
		return map[metric] ?? "cosine";
	}

	private handleNotFound(collection: string, error: unknown, operation: string): Error {
		if (error instanceof Error && error.message.includes("not found")) {
			return new CollectionNotFoundError(collection, error);
		}
		return new AdapterError("pinecone", operation, error);
	}
}
