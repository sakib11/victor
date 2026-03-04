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
 * Configuration for the ChromaDB adapter.
 */
export interface ChromaAdapterConfig {
	/** ChromaDB server URL. @default "http://localhost:8000" */
	path?: string;

	/** Authentication token or API key for Chroma Cloud. */
	auth?: string;
}

type ChromaClient = {
	createCollection(params: { name: string; metadata?: Record<string, unknown> }): Promise<ChromaCollection>;
	getCollection(params: { name: string }): Promise<ChromaCollection>;
	getOrCreateCollection(params: { name: string; metadata?: Record<string, unknown> }): Promise<ChromaCollection>;
	listCollections(): Promise<{ name: string }[]>;
	deleteCollection(params: { name: string }): Promise<void>;
};

type ChromaCollection = {
	name: string;
	add(params: { ids: string[]; embeddings?: number[][]; metadatas?: (Record<string, unknown> | null)[]; documents?: (string | null)[] }): Promise<void>;
	upsert(params: { ids: string[]; embeddings?: number[][]; metadatas?: (Record<string, unknown> | null)[] }): Promise<void>;
	get(params: { ids?: string[]; where?: Record<string, unknown>; include?: string[] }): Promise<{ ids: string[]; embeddings: number[][] | null; metadatas: (Record<string, unknown> | null)[] | null; documents: (string | null)[] | null }>;
	query(params: { queryEmbeddings: number[][]; nResults?: number; where?: Record<string, unknown>; include?: string[] }): Promise<{ ids: string[][]; distances: number[][] | null; metadatas: ((Record<string, unknown> | null)[] | null)[] | null; embeddings: (number[][] | null)[] | null }>;
	update(params: { ids: string[]; embeddings?: number[][]; metadatas?: (Record<string, unknown> | null)[] }): Promise<void>;
	delete(params: { ids: string[] }): Promise<void>;
	count(): Promise<number>;
	peek(params?: { limit?: number }): Promise<{ ids: string[] }>;
};

/**
 * ChromaDB vector database adapter.
 *
 * Wraps the `chromadb` SDK and implements the unified `VectorStore` interface.
 * ChromaDB uses a document-centric model with parallel arrays, which this
 * adapter normalizes to the record-based format.
 *
 * @example
 * ```ts
 * import { ChromaAdapter } from "@victor/core/chroma";
 *
 * const adapter = new ChromaAdapter({
 *   path: "http://localhost:8000",
 * });
 * await adapter.connect();
 * ```
 *
 * @requires chromadb
 */
export class ChromaAdapter implements VectorStore {
	readonly name = "chroma";
	private client: ChromaClient | null = null;
	private readonly config: ChromaAdapterConfig;

	constructor(config: ChromaAdapterConfig = {}) {
		this.config = config;
	}

	// ── Connection ───────────────────────────────────────────────────

	async connect(): Promise<void> {
		try {
			const chromadb = await import("chromadb");
			const ClientClass = chromadb.ChromaClient ?? (chromadb as unknown as { default: { ChromaClient: new (params?: { path?: string }) => ChromaClient } }).default.ChromaClient;
			this.client = new ClientClass({
				path: this.config.path ?? "http://localhost:8000",
			}) as unknown as ChromaClient;
		} catch (error) {
			throw new ConnectionError("chroma", error);
		}
	}

	async disconnect(): Promise<void> {
		this.client = null;
	}

	// ── Collection Management ────────────────────────────────────────

	async createCollection(config: CollectionConfig): Promise<void> {
		const client = this.getClient();
		try {
			const collections = await client.listCollections();
			const exists = collections.some((c) => c.name === config.name);
			if (exists) {
				throw new CollectionAlreadyExistsError(config.name);
			}

			await client.createCollection({
				name: config.name,
				metadata: {
					"hnsw:space": this.toNativeMetric(config.metric ?? "cosine"),
					dimension: config.dimension,
				},
			});
		} catch (error) {
			if (error instanceof CollectionAlreadyExistsError) throw error;
			throw new AdapterError("chroma", "createCollection", error);
		}
	}

	async listCollections(): Promise<string[]> {
		const client = this.getClient();
		try {
			const collections = await client.listCollections();
			return collections.map((c) => c.name);
		} catch (error) {
			throw new AdapterError("chroma", "listCollections", error);
		}
	}

	async deleteCollection(name: string): Promise<void> {
		const client = this.getClient();
		try {
			await client.deleteCollection({ name });
		} catch (error) {
			throw this.handleNotFound(name, error, "deleteCollection");
		}
	}

	async describeCollection(name: string): Promise<CollectionInfo> {
		const client = this.getClient();
		try {
			const collection = await client.getCollection({ name });
			const count = await collection.count();

			return {
				name: collection.name,
				dimension: 0, // ChromaDB doesn't expose dimension directly
				metric: "cosine", // Default — ChromaDB doesn't expose this via API
				count,
			};
		} catch (error) {
			throw this.handleNotFound(name, error, "describeCollection");
		}
	}

	// ── CRUD ─────────────────────────────────────────────────────────

	async upsert(collection: string, records: VectorRecord[]): Promise<void> {
		const client = this.getClient();
		try {
			const col = await client.getCollection({ name: collection });

			await col.upsert({
				ids: records.map((r) => r.id),
				embeddings: records.map((r) => r.values),
				metadatas: records.map((r) =>
					(r.metadata as Record<string, unknown> | undefined) ?? null,
				),
			});
		} catch (error) {
			throw new AdapterError("chroma", "upsert", error);
		}
	}

	async get(collection: string, ids: string[]): Promise<VectorRecord[]> {
		const client = this.getClient();
		try {
			const col = await client.getCollection({ name: collection });
			const result = await col.get({
				ids,
				include: ["embeddings", "metadatas"],
			});

			return result.ids.map((id, i) => ({
				id,
				values: result.embeddings?.[i] ?? [],
				metadata: this.normalizeMetadata(result.metadatas?.[i]),
			}));
		} catch (error) {
			throw new AdapterError("chroma", "get", error);
		}
	}

	async update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void> {
		const client = this.getClient();
		try {
			const col = await client.getCollection({ name: collection });

			// Verify the record exists
			const existing = await col.get({ ids: [id] });
			if (existing.ids.length === 0) {
				throw new VectorNotFoundError(id, collection);
			}

			await col.update({
				ids: [id],
				embeddings: data.values ? [data.values] : undefined,
				metadatas: data.metadata
					? [data.metadata as Record<string, unknown>]
					: undefined,
			});
		} catch (error) {
			if (error instanceof VectorNotFoundError) throw error;
			throw new AdapterError("chroma", "update", error);
		}
	}

	async delete(collection: string, ids: string[]): Promise<void> {
		const client = this.getClient();
		try {
			const col = await client.getCollection({ name: collection });
			await col.delete({ ids });
		} catch (error) {
			throw new AdapterError("chroma", "delete", error);
		}
	}

	// ── Search ───────────────────────────────────────────────────────

	async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
		const client = this.getClient();
		try {
			const col = await client.getCollection({ name: collection });

			const include: string[] = [];
			if (query.includeMetadata !== false) include.push("metadatas");
			if (query.includeValues) include.push("embeddings");
			include.push("distances");

			const result = await col.query({
				queryEmbeddings: [query.vector],
				nResults: query.topK,
				where: query.filter ? translateFilter(query.filter) : undefined,
				include,
			});

			// ChromaDB returns nested arrays: outer = per query, inner = per result
			const ids = result.ids[0] ?? [];
			const distances = result.distances?.[0] ?? [];
			const metadatas = result.metadatas?.[0] ?? [];
			const embeddings = result.embeddings?.[0] ?? [];

			return ids.map((id, i) => ({
				id,
				// ChromaDB returns distances (lower = closer), convert to similarity score
				score: 1 - (distances[i] ?? 0),
				values: query.includeValues ? (embeddings?.[i] ?? undefined) : undefined,
				metadata:
					query.includeMetadata !== false
						? this.normalizeMetadata(metadatas?.[i])
						: undefined,
			}));
		} catch (error) {
			throw new AdapterError("chroma", "search", error);
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

	private getClient(): ChromaClient {
		if (!this.client) {
			throw new ConnectionError("chroma");
		}
		return this.client;
	}

	private toNativeMetric(metric: string): string {
		const map: Record<string, string> = {
			cosine: "cosine",
			euclidean: "l2",
			dotproduct: "ip",
		};
		return map[metric] ?? "cosine";
	}

	private normalizeMetadata(
		metadata: Record<string, unknown> | null | undefined,
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

	private handleNotFound(collection: string, error: unknown, operation: string): Error {
		if (error instanceof Error && error.message.includes("not found")) {
			return new CollectionNotFoundError(collection, error);
		}
		return new AdapterError("chroma", operation, error);
	}
}
