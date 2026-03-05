import type { Embedder } from "./interfaces/embedder.js";
import type { VectorStore } from "./interfaces/vector-store.js";
import type {
	BatchOptions,
	CollectionConfig,
	CollectionInfo,
	SearchQuery,
	SearchResult,
	TextRecord,
	TextSearchQuery,
	VectorRecord,
} from "./types/index.js";
import { EmbedderNotConfiguredError } from "./errors.js";
import {
	validateCollectionConfig,
	validateCollectionName,
	validateIds,
	validateSearchQuery,
	validateVectorRecords,
} from "./utils/validation.js";

/**
 * Options for creating a VictorClient instance.
 */
export interface VictorClientOptions {
	/** The vector store adapter to use. */
	store: VectorStore;

	/**
	 * Optional embedder for text-based operations.
	 * Required for `searchByText`, `upsertText`, and `upsertTexts`.
	 */
	embedder?: Embedder;
}

/**
 * The main entry point for interacting with vector databases through Victor.
 *
 * VictorClient wraps a `VectorStore` adapter and adds:
 * - Input validation before operations reach the database
 * - Optional embedding integration for text-based workflows
 * - Convenience methods like `searchByText` and `upsertText`
 *
 * @example
 * ```ts
 * import { VictorClient } from "@amanat_doulah/victor-db";
 * import { PineconeAdapter } from "@amanat_doulah/victor-db/pinecone";
 * import { OpenAIEmbedder } from "@amanat_doulah/victor-db/embeddings/openai";
 *
 * const client = new VictorClient({
 *   store: new PineconeAdapter({ apiKey: process.env.PINECONE_API_KEY }),
 *   embedder: new OpenAIEmbedder({
 *     apiKey: process.env.OPENAI_API_KEY,
 *     model: "text-embedding-3-small",
 *   }),
 * });
 *
 * await client.connect();
 *
 * // Text-based workflow (auto-embeds)
 * await client.upsertTexts("articles", [
 *   { id: "1", text: "Victor unifies vector databases", metadata: { source: "docs" } },
 * ]);
 * const results = await client.searchByText("articles", {
 *   text: "unified vector search",
 *   topK: 5,
 * });
 *
 * // Vector-based workflow (bring your own embeddings)
 * await client.upsert("articles", [
 *   { id: "2", values: [0.1, 0.2, ...], metadata: { source: "manual" } },
 * ]);
 * ```
 */
export class VictorClient {
	private readonly store: VectorStore;
	private readonly embedder?: Embedder;

	constructor(options: VictorClientOptions) {
		this.store = options.store;
		this.embedder = options.embedder;
	}

	/** The name of the underlying adapter. */
	get adapterName(): string {
		return this.store.name;
	}

	/** The configured embedder, if any. */
	get embeddingModel(): string | undefined {
		return this.embedder?.model;
	}

	// ── Connection Lifecycle ─────────────────────────────────────────

	async connect(): Promise<void> {
		await this.store.connect();
	}

	async disconnect(): Promise<void> {
		await this.store.disconnect();
	}

	// ── Collection Management ────────────────────────────────────────

	async createCollection(config: CollectionConfig): Promise<void> {
		validateCollectionConfig(config);
		await this.store.createCollection(config);
	}

	async listCollections(): Promise<string[]> {
		return this.store.listCollections();
	}

	async deleteCollection(name: string): Promise<void> {
		validateCollectionName(name);
		await this.store.deleteCollection(name);
	}

	async describeCollection(name: string): Promise<CollectionInfo> {
		validateCollectionName(name);
		return this.store.describeCollection(name);
	}

	// ── CRUD Operations ──────────────────────────────────────────────

	async upsert(collection: string, records: VectorRecord[]): Promise<void> {
		validateCollectionName(collection);
		validateVectorRecords(records);
		await this.store.upsert(collection, records);
	}

	async get(collection: string, ids: string[]): Promise<VectorRecord[]> {
		validateCollectionName(collection);
		validateIds(ids);
		return this.store.get(collection, ids);
	}

	async update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void> {
		validateCollectionName(collection);
		validateIds([id]);
		await this.store.update(collection, id, data);
	}

	async delete(collection: string, ids: string[]): Promise<void> {
		validateCollectionName(collection);
		validateIds(ids);
		await this.store.delete(collection, ids);
	}

	// ── Search ───────────────────────────────────────────────────────

	async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
		validateCollectionName(collection);
		validateSearchQuery(query);
		return this.store.search(collection, query);
	}

	/**
	 * Search by text — automatically embeds the query text using the configured embedder.
	 *
	 * @throws {EmbedderNotConfiguredError} If no embedder was provided.
	 */
	async searchByText(
		collection: string,
		query: TextSearchQuery,
	): Promise<SearchResult[]> {
		const embedder = this.getEmbedder();
		validateCollectionName(collection);

		const embedding = await embedder.embed(query.text);

		return this.store.search(collection, {
			vector: embedding.values,
			topK: query.topK,
			filter: query.filter,
			includeMetadata: query.includeMetadata,
			includeValues: query.includeValues,
		});
	}

	// ── Text-based CRUD (requires embedder) ──────────────────────────

	/**
	 * Embed and upsert a single text record.
	 *
	 * @throws {EmbedderNotConfiguredError} If no embedder was provided.
	 */
	async upsertText(collection: string, record: TextRecord): Promise<void> {
		const embedder = this.getEmbedder();
		validateCollectionName(collection);

		const embedding = await embedder.embed(record.text);

		await this.store.upsert(collection, [
			{
				id: record.id,
				values: embedding.values,
				metadata: {
					...record.metadata,
					_text: record.text,
				},
			},
		]);
	}

	/**
	 * Embed and upsert multiple text records in batch.
	 * Uses the embedder's batch API for efficiency.
	 *
	 * @throws {EmbedderNotConfiguredError} If no embedder was provided.
	 */
	async upsertTexts(
		collection: string,
		records: TextRecord[],
		options?: BatchOptions,
	): Promise<void> {
		const embedder = this.getEmbedder();
		validateCollectionName(collection);

		if (records.length === 0) return;

		const texts = records.map((r) => r.text);
		const embeddings = await embedder.embedBatch(texts);

		const vectorRecords: VectorRecord[] = records.map((record, i) => ({
			id: record.id,
			values: embeddings[i]!.values,
			metadata: {
				...record.metadata,
				_text: record.text,
			},
		}));

		if (options) {
			await this.store.batchUpsert(collection, vectorRecords, options);
		} else {
			await this.store.upsert(collection, vectorRecords);
		}
	}

	// ── Batch Operations ─────────────────────────────────────────────

	async batchUpsert(
		collection: string,
		records: VectorRecord[],
		options?: BatchOptions,
	): Promise<void> {
		validateCollectionName(collection);
		validateVectorRecords(records);
		await this.store.batchUpsert(collection, records, options);
	}

	async batchDelete(
		collection: string,
		ids: string[],
		options?: BatchOptions,
	): Promise<void> {
		validateCollectionName(collection);
		validateIds(ids);
		await this.store.batchDelete(collection, ids, options);
	}

	// ── Private ──────────────────────────────────────────────────────

	private getEmbedder(): Embedder {
		if (!this.embedder) {
			throw new EmbedderNotConfiguredError();
		}
		return this.embedder;
	}
}
