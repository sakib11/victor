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
 * Configuration for the Weaviate adapter.
 */
export interface WeaviateAdapterConfig {
	/** Connection scheme. @default "local" */
	scheme?: "local" | "cloud" | "custom";

	/** Weaviate Cloud cluster URL (for scheme: "cloud"). */
	clusterUrl?: string;

	/** API key for Weaviate Cloud. */
	apiKey?: string;

	/** HTTP host (for scheme: "local" or "custom"). @default "localhost" */
	httpHost?: string;

	/** HTTP port. @default 8080 */
	httpPort?: number;

	/** gRPC host. @default "localhost" */
	grpcHost?: string;

	/** gRPC port. @default 50051 */
	grpcPort?: number;

	/** Additional headers (e.g., for API keys of integrated modules). */
	headers?: Record<string, string>;
}

// Minimal types to avoid deep coupling to the Weaviate SDK
type WeaviateClient = {
	collections: {
		create(config: Record<string, unknown>): Promise<WeaviateCollection>;
		get(name: string): WeaviateCollection;
		listAll(): Promise<{ name: string; [key: string]: unknown }[]>;
		delete(name: string): Promise<void>;
	};
	close(): Promise<void>;
};

type WeaviateCollection = {
	name: string;
	data: {
		insertMany(objects: Record<string, unknown>[]): Promise<{ allResponses?: unknown[]; errors?: Record<string, unknown>; uuids?: Record<string, string> }>;
		insert(object: Record<string, unknown>): Promise<string>;
		update(params: { id: string; properties?: Record<string, unknown>; vectors?: number[] }): Promise<void>;
		deleteMany(filter: unknown): Promise<unknown>;
		deleteById(id: string): Promise<boolean>;
	};
	query: {
		nearVector(vector: number[], opts?: Record<string, unknown>): Promise<{ objects: WeaviateObject[] }>;
		fetchObjectById(id: string, opts?: Record<string, unknown>): Promise<WeaviateObject | null>;
		fetchObjects(opts?: Record<string, unknown>): Promise<{ objects: WeaviateObject[] }>;
	};
	aggregate: {
		overAll(): Promise<{ totalCount: number }>;
	};
	config: {
		get(): Promise<{ name: string; vectorIndexConfig?: Record<string, unknown>; properties?: { name: string; dataType: string }[] }>;
	};
};

type WeaviateObject = {
	uuid: string;
	properties: Record<string, unknown>;
	vectors?: Record<string, number[]> | number[];
	metadata?: { distance?: number; certainty?: number; score?: number };
};

/**
 * Weaviate vector database adapter.
 *
 * Wraps the `weaviate-client` (v3) SDK and implements the unified
 * `VectorStore` interface. Maps Victor's flat ID/values/metadata model
 * to Weaviate's property-based schema.
 *
 * Metadata fields are stored as Weaviate properties. The vector ID is
 * stored in a `_victorId` property so it can be retrieved by string ID
 * (Weaviate uses UUIDs internally).
 *
 * @example
 * ```ts
 * import { WeaviateAdapter } from "@sakib11/victor/weaviate";
 *
 * // Local
 * const adapter = new WeaviateAdapter({ scheme: "local" });
 *
 * // Weaviate Cloud
 * const adapter = new WeaviateAdapter({
 *   scheme: "cloud",
 *   clusterUrl: "https://your-instance.weaviate.network",
 *   apiKey: "your-key",
 * });
 *
 * await adapter.connect();
 * ```
 *
 * @requires weaviate-client
 */
export class WeaviateAdapter implements VectorStore {
	readonly name = "weaviate";
	private client: WeaviateClient | null = null;
	private readonly config: WeaviateAdapterConfig;

	constructor(config: WeaviateAdapterConfig = {}) {
		this.config = config;
	}

	// ── Connection ───────────────────────────────────────────────────

	async connect(): Promise<void> {
		try {
			const weaviate = await import("weaviate-client");
			const w = weaviate.default ?? weaviate;

			let client: WeaviateClient;

			switch (this.config.scheme) {
				case "cloud":
					if (!this.config.clusterUrl) {
						throw new Error("clusterUrl is required for cloud connections");
					}
					client = (await w.connectToWeaviateCloud(this.config.clusterUrl, {
						authCredentials: this.config.apiKey
							? new w.ApiKey(this.config.apiKey)
							: undefined,
						headers: this.config.headers,
					})) as unknown as WeaviateClient;
					break;

				case "custom":
					client = (await w.connectToCustom({
						httpHost: this.config.httpHost ?? "localhost",
						httpPort: this.config.httpPort ?? 8080,
						grpcHost: this.config.grpcHost ?? "localhost",
						grpcPort: this.config.grpcPort ?? 50051,
						headers: this.config.headers,
					})) as unknown as WeaviateClient;
					break;

				default:
					// "local" — default
					client = (await w.connectToLocal({
						host: this.config.httpHost ?? "localhost",
						port: this.config.httpPort ?? 8080,
						grpcPort: this.config.grpcPort ?? 50051,
						headers: this.config.headers,
					})) as unknown as WeaviateClient;
					break;
			}

			this.client = client;
		} catch (error) {
			throw new ConnectionError("weaviate", error);
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
			const className = this.toClassName(config.name);

			const existing = await client.collections.listAll();
			const exists = existing.some((c) => c.name === className);
			if (exists) {
				throw new CollectionAlreadyExistsError(config.name);
			}

			await client.collections.create({
				name: className,
				properties: [
					{ name: "_victorId", dataType: "text" },
					{ name: "_victorMetadata", dataType: "text" },
				],
				vectorIndexConfig: {
					distance: this.toNativeDistance(config.metric ?? "cosine"),
				},
			});
		} catch (error) {
			if (error instanceof CollectionAlreadyExistsError) throw error;
			throw new AdapterError("weaviate", "createCollection", error);
		}
	}

	async listCollections(): Promise<string[]> {
		const client = this.getClient();
		try {
			const collections = await client.collections.listAll();
			return collections.map((c) => c.name);
		} catch (error) {
			throw new AdapterError("weaviate", "listCollections", error);
		}
	}

	async deleteCollection(name: string): Promise<void> {
		const client = this.getClient();
		try {
			const className = this.toClassName(name);
			await client.collections.delete(className);
		} catch (error) {
			throw this.handleNotFound(name, error, "deleteCollection");
		}
	}

	async describeCollection(name: string): Promise<CollectionInfo> {
		const client = this.getClient();
		try {
			const className = this.toClassName(name);
			const collection = client.collections.get(className);
			const config = await collection.config.get();
			const agg = await collection.aggregate.overAll();

			return {
				name: config.name,
				dimension: 0, // Weaviate doesn't expose vector dimension via config
				metric: this.fromNativeDistance(
					config.vectorIndexConfig?.distance as string ?? "cosine",
				),
				count: agg.totalCount,
			};
		} catch (error) {
			throw this.handleNotFound(name, error, "describeCollection");
		}
	}

	// ── CRUD ─────────────────────────────────────────────────────────

	async upsert(collection: string, records: VectorRecord[]): Promise<void> {
		const client = this.getClient();
		try {
			const className = this.toClassName(collection);
			const col = client.collections.get(className);

			// For upsert semantics, delete existing records first, then insert
			for (const record of records) {
				// Try to find and delete existing object with same _victorId
				const existing = await col.query.fetchObjects({
					filters: { path: ["_victorId"], operator: "Equal", valueText: record.id },
					limit: 1,
				});
				if (existing.objects.length > 0) {
					await col.data.deleteById(existing.objects[0]!.uuid);
				}
			}

			const objects = records.map((r) => ({
				properties: {
					_victorId: r.id,
					_victorMetadata: JSON.stringify(r.metadata ?? {}),
				},
				vectors: r.values,
			}));

			await col.data.insertMany(objects);
		} catch (error) {
			throw new AdapterError("weaviate", "upsert", error);
		}
	}

	async get(collection: string, ids: string[]): Promise<VectorRecord[]> {
		const client = this.getClient();
		try {
			const className = this.toClassName(collection);
			const col = client.collections.get(className);

			const results: VectorRecord[] = [];

			for (const id of ids) {
				const result = await col.query.fetchObjects({
					filters: { path: ["_victorId"], operator: "Equal", valueText: id },
					limit: 1,
					includeVector: true,
				});

				if (result.objects.length > 0) {
					const obj = result.objects[0]!;
					results.push(this.objectToRecord(obj));
				}
			}

			return results;
		} catch (error) {
			throw new AdapterError("weaviate", "get", error);
		}
	}

	async update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void> {
		const client = this.getClient();
		try {
			const className = this.toClassName(collection);
			const col = client.collections.get(className);

			// Find the object
			const existing = await col.query.fetchObjects({
				filters: { path: ["_victorId"], operator: "Equal", valueText: id },
				limit: 1,
				includeVector: true,
			});

			if (existing.objects.length === 0) {
				throw new VectorNotFoundError(id, collection);
			}

			const obj = existing.objects[0]!;
			const updateParams: { id: string; properties?: Record<string, unknown>; vectors?: number[] } = {
				id: obj.uuid,
			};

			if (data.metadata) {
				const currentMetadata = this.parseMetadata(
					obj.properties._victorMetadata as string,
				);
				updateParams.properties = {
					_victorMetadata: JSON.stringify({
						...currentMetadata,
						...data.metadata,
					}),
				};
			}

			if (data.values) {
				updateParams.vectors = data.values;
			}

			await col.data.update(updateParams);
		} catch (error) {
			if (error instanceof VectorNotFoundError) throw error;
			throw new AdapterError("weaviate", "update", error);
		}
	}

	async delete(collection: string, ids: string[]): Promise<void> {
		const client = this.getClient();
		try {
			const className = this.toClassName(collection);
			const col = client.collections.get(className);

			for (const id of ids) {
				const existing = await col.query.fetchObjects({
					filters: { path: ["_victorId"], operator: "Equal", valueText: id },
					limit: 1,
				});
				if (existing.objects.length > 0) {
					await col.data.deleteById(existing.objects[0]!.uuid);
				}
			}
		} catch (error) {
			throw new AdapterError("weaviate", "delete", error);
		}
	}

	// ── Search ───────────────────────────────────────────────────────

	async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
		const client = this.getClient();
		try {
			const className = this.toClassName(collection);
			const col = client.collections.get(className);

			const opts: Record<string, unknown> = {
				limit: query.topK,
				includeVector: query.includeValues ?? false,
				returnMetadata: ["distance"],
			};

			if (query.filter) {
				opts.filters = translateFilter(query.filter);
			}

			const result = await col.query.nearVector(query.vector, opts);

			return result.objects.map((obj) => {
				const record = this.objectToRecord(obj);
				return {
					id: record.id,
					// Convert distance to similarity score (1 - distance)
					score: 1 - (obj.metadata?.distance ?? 0),
					values: query.includeValues ? record.values : undefined,
					metadata: query.includeMetadata !== false ? record.metadata : undefined,
				};
			});
		} catch (error) {
			throw new AdapterError("weaviate", "search", error);
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
			100,
		);
	}

	// ── Private ──────────────────────────────────────────────────────

	private getClient(): WeaviateClient {
		if (!this.client) {
			throw new ConnectionError("weaviate");
		}
		return this.client;
	}

	/**
	 * Convert a collection name to a Weaviate class name.
	 * Weaviate requires class names to start with uppercase.
	 */
	private toClassName(name: string): string {
		return name.charAt(0).toUpperCase() + name.slice(1);
	}

	private toNativeDistance(metric: DistanceMetric): string {
		const map: Record<string, string> = {
			cosine: "cosine",
			euclidean: "l2-squared",
			dotproduct: "dot",
		};
		return map[metric] ?? "cosine";
	}

	private fromNativeDistance(distance: string): DistanceMetric {
		const map: Record<string, DistanceMetric> = {
			cosine: "cosine",
			"l2-squared": "euclidean",
			dot: "dotproduct",
		};
		return map[distance] ?? "cosine";
	}

	private objectToRecord(obj: WeaviateObject): VectorRecord {
		const victorId = (obj.properties._victorId as string) ?? obj.uuid;
		const metadata = this.parseMetadata(
			obj.properties._victorMetadata as string | undefined,
		);

		let values: number[] = [];
		if (obj.vectors) {
			if (Array.isArray(obj.vectors)) {
				values = obj.vectors;
			} else if (typeof obj.vectors === "object") {
				// Named vectors — use default vector
				const defaultVec = (obj.vectors as Record<string, number[]>).default;
				if (defaultVec) values = defaultVec;
			}
		}

		return {
			id: victorId,
			values,
			metadata,
		};
	}

	private parseMetadata(
		raw: string | undefined,
	): Record<string, MetadataValue> | undefined {
		if (!raw) return undefined;
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const result: Record<string, MetadataValue> = {};
			for (const [key, value] of Object.entries(parsed)) {
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
			return Object.keys(result).length > 0 ? result : undefined;
		} catch {
			return undefined;
		}
	}

	private handleNotFound(collection: string, error: unknown, operation: string): Error {
		if (
			error instanceof Error &&
			(error.message.includes("not found") || error.message.includes("does not exist"))
		) {
			return new CollectionNotFoundError(collection, error);
		}
		return new AdapterError("weaviate", operation, error);
	}
}
