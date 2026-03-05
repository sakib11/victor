import type { VectorStore } from "../../interfaces/vector-store.js";
import type {
	BatchOptions,
	CollectionConfig,
	CollectionInfo,
	DistanceMetric,
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
 * Configuration for the Qdrant adapter.
 */
export interface QdrantAdapterConfig {
	/** Qdrant server URL (e.g., "http://localhost:6333"). */
	url?: string;

	/** Qdrant host (alternative to URL). */
	host?: string;

	/** Qdrant port. @default 6333 */
	port?: number;

	/** API key for Qdrant Cloud. */
	apiKey?: string;

	/** Whether to use HTTPS. */
	https?: boolean;
}

/**
 * Qdrant vector database adapter.
 *
 * Wraps the `@qdrant/js-client-rest` SDK and implements the
 * unified `VectorStore` interface.
 *
 * @example
 * ```ts
 * import { QdrantAdapter } from "@sakib11/victor/qdrant";
 *
 * const adapter = new QdrantAdapter({
 *   url: "http://localhost:6333",
 * });
 * await adapter.connect();
 * ```
 *
 * @requires @qdrant/js-client-rest
 */
export class QdrantAdapter implements VectorStore {
	readonly name = "qdrant";
	private client: import("@qdrant/js-client-rest").QdrantClient | null = null;
	private readonly config: QdrantAdapterConfig;

	constructor(config: QdrantAdapterConfig = {}) {
		this.config = config;
	}

	// ── Connection ───────────────────────────────────────────────────

	async connect(): Promise<void> {
		try {
			const { QdrantClient } = await import("@qdrant/js-client-rest");

			if (this.config.url) {
				this.client = new QdrantClient({
					url: this.config.url,
					apiKey: this.config.apiKey,
				});
			} else {
				this.client = new QdrantClient({
					host: this.config.host ?? "localhost",
					port: this.config.port ?? 6333,
					apiKey: this.config.apiKey,
					https: this.config.https,
				});
			}
		} catch (error) {
			throw new ConnectionError("qdrant", error);
		}
	}

	async disconnect(): Promise<void> {
		this.client = null;
	}

	// ── Collection Management ────────────────────────────────────────

	async createCollection(config: CollectionConfig): Promise<void> {
		const client = this.getClient();
		try {
			const collections = await client.getCollections();
			const exists = collections.collections.some((c) => c.name === config.name);
			if (exists) {
				throw new CollectionAlreadyExistsError(config.name);
			}

			await client.createCollection(config.name, {
				vectors: {
					size: config.dimension,
					distance: this.toNativeDistance(config.metric ?? "cosine"),
				},
			});
		} catch (error) {
			if (error instanceof CollectionAlreadyExistsError) throw error;
			throw new AdapterError("qdrant", "createCollection", error);
		}
	}

	async listCollections(): Promise<string[]> {
		const client = this.getClient();
		try {
			const result = await client.getCollections();
			return result.collections.map((c) => c.name);
		} catch (error) {
			throw new AdapterError("qdrant", "listCollections", error);
		}
	}

	async deleteCollection(name: string): Promise<void> {
		const client = this.getClient();
		try {
			await client.deleteCollection(name);
		} catch (error) {
			throw this.handleNotFound(name, error, "deleteCollection");
		}
	}

	async describeCollection(name: string): Promise<CollectionInfo> {
		const client = this.getClient();
		try {
			const info = await client.getCollection(name);
			const vectorsConfig = info.config.params.vectors;

			let dimension = 0;
			let metric: DistanceMetric = "cosine";

			if (
				vectorsConfig &&
				typeof vectorsConfig === "object" &&
				"size" in vectorsConfig &&
				"distance" in vectorsConfig
			) {
				dimension = vectorsConfig.size as number;
				metric = this.fromNativeDistance(String(vectorsConfig.distance));
			}

			return {
				name,
				dimension,
				metric,
				count: info.points_count ?? 0,
			};
		} catch (error) {
			throw this.handleNotFound(name, error, "describeCollection");
		}
	}

	// ── CRUD ─────────────────────────────────────────────────────────

	async upsert(collection: string, records: VectorRecord[]): Promise<void> {
		const client = this.getClient();
		try {
			await client.upsert(collection, {
				wait: true,
				points: records.map((r) => ({
					id: r.id,
					vector: r.values,
					payload: r.metadata ?? {},
				})),
			});
		} catch (error) {
			throw new AdapterError("qdrant", "upsert", error);
		}
	}

	async get(collection: string, ids: string[]): Promise<VectorRecord[]> {
		const client = this.getClient();
		try {
			const result = await client.retrieve(collection, {
				ids,
				with_vector: true,
				with_payload: true,
			});

			return result.map((point: { id: string | number; vector?: unknown; payload?: Record<string, unknown> | null }) => ({
				id: String(point.id),
				values: Array.isArray(point.vector) ? (point.vector as number[]) : [],
				metadata: this.normalizePayload(point.payload as Record<string, unknown> | null | undefined),
			}));
		} catch (error) {
			throw new AdapterError("qdrant", "get", error);
		}
	}

	async update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void> {
		const client = this.getClient();
		try {
			// Verify the point exists
			const existing = await client.retrieve(collection, { ids: [id] });
			if (existing.length === 0) {
				throw new VectorNotFoundError(id, collection);
			}

			if (data.values) {
				await client.updateVectors(collection, {
					wait: true,
					points: [{ id, vector: data.values }],
				});
			}

			if (data.metadata) {
				await client.setPayload(collection, {
					wait: true,
					points: [id],
					payload: data.metadata,
				});
			}
		} catch (error) {
			if (error instanceof VectorNotFoundError) throw error;
			throw new AdapterError("qdrant", "update", error);
		}
	}

	async delete(collection: string, ids: string[]): Promise<void> {
		const client = this.getClient();
		try {
			await client.delete(collection, {
				wait: true,
				points: ids,
			});
		} catch (error) {
			throw new AdapterError("qdrant", "delete", error);
		}
	}

	// ── Search ───────────────────────────────────────────────────────

	async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
		const client = this.getClient();
		try {
			const response = await client.query(collection, {
				query: query.vector,
				limit: query.topK,
				with_payload: query.includeMetadata ?? true,
				with_vector: query.includeValues ?? false,
				filter: query.filter ? translateFilter(query.filter) : undefined,
			});

			const points = response.points ?? [];

			return points.map((point: { id: string | number; score: number; vector?: unknown; payload?: Record<string, unknown> | null }) => ({
				id: String(point.id),
				score: point.score ?? 0,
				values: query.includeValues && Array.isArray(point.vector)
					? (point.vector as number[])
					: undefined,
				metadata:
					query.includeMetadata !== false
						? this.normalizePayload(point.payload as Record<string, unknown> | null | undefined)
						: undefined,
			}));
		} catch (error) {
			throw new AdapterError("qdrant", "search", error);
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
			100,
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

	private getClient(): import("@qdrant/js-client-rest").QdrantClient {
		if (!this.client) {
			throw new ConnectionError("qdrant");
		}
		return this.client;
	}

	private toNativeDistance(metric: string): "Cosine" | "Euclid" | "Dot" {
		const map: Record<string, "Cosine" | "Euclid" | "Dot"> = {
			cosine: "Cosine",
			euclidean: "Euclid",
			dotproduct: "Dot",
		};
		return map[metric] ?? "Cosine";
	}

	private fromNativeDistance(distance: string): DistanceMetric {
		const map: Record<string, DistanceMetric> = {
			Cosine: "cosine",
			Euclid: "euclidean",
			Dot: "dotproduct",
			Manhattan: "euclidean",
		};
		return map[distance] ?? "cosine";
	}

	private normalizePayload(
		payload: Record<string, unknown> | null | undefined,
	): Record<string, MetadataValue> | undefined {
		if (!payload) return undefined;

		const result: Record<string, MetadataValue> = {};
		for (const [key, value] of Object.entries(payload)) {
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

	private handleNotFound(collection: string, error: unknown, operation: string): Error {
		if (error instanceof Error && error.message.includes("not found")) {
			return new CollectionNotFoundError(collection, error);
		}
		return new AdapterError("qdrant", operation, error);
	}
}
