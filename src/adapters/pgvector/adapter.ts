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
 * Configuration for the pgvector adapter.
 */
export interface PgVectorAdapterConfig {
	/**
	 * PostgreSQL connection string.
	 * @example "postgresql://user:password@localhost:5432/mydb"
	 */
	connectionString?: string;

	/** PostgreSQL host. @default "localhost" */
	host?: string;

	/** PostgreSQL port. @default 5432 */
	port?: number;

	/** Database name. */
	database?: string;

	/** Database user. */
	user?: string;

	/** Database password. */
	password?: string;

	/**
	 * Table name prefix for collections.
	 * Each collection is stored as a separate table: `{prefix}_{collectionName}`.
	 * @default "victor"
	 */
	tablePrefix?: string;

	/**
	 * Index type for vector columns.
	 * @default "hnsw"
	 */
	indexType?: "hnsw" | "ivfflat";

	/**
	 * HNSW index build parameters.
	 * @default { m: 16, ef_construction: 64 }
	 */
	hnswParams?: { m?: number; ef_construction?: number };
}

// Minimal pg client type
type PgClient = {
	connect(): Promise<void>;
	end(): Promise<void>;
	query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

/**
 * pgvector (PostgreSQL) adapter.
 *
 * Uses `pg` (node-postgres) + `pgvector` to store vectors in PostgreSQL
 * with the pgvector extension. Each collection maps to a table with
 * columns: id (TEXT PK), embedding (vector), metadata (JSONB).
 *
 * @example
 * ```ts
 * import { PgVectorAdapter } from "@victor/core/pgvector";
 *
 * const adapter = new PgVectorAdapter({
 *   connectionString: "postgresql://user:pass@localhost:5432/mydb",
 * });
 * await adapter.connect();
 * ```
 *
 * @requires pg
 * @requires pgvector
 */
export class PgVectorAdapter implements VectorStore {
	readonly name = "pgvector";
	private client: PgClient | null = null;
	private readonly config: PgVectorAdapterConfig;
	private readonly prefix: string;

	constructor(config: PgVectorAdapterConfig = {}) {
		this.config = config;
		this.prefix = config.tablePrefix ?? "victor";
	}

	// ── Connection ───────────────────────────────────────────────────

	async connect(): Promise<void> {
		try {
			const pg = await import("pg");
			const pgvector = await import("pgvector/pg");

			const ClientClass = pg.default?.Client ?? pg.Client;

			let client: PgClient;
			if (this.config.connectionString) {
				client = new ClientClass({
					connectionString: this.config.connectionString,
				}) as unknown as PgClient;
			} else {
				client = new ClientClass({
					host: this.config.host ?? "localhost",
					port: this.config.port ?? 5432,
					database: this.config.database,
					user: this.config.user,
					password: this.config.password,
				}) as unknown as PgClient;
			}

			await client.connect();

			// Register pgvector types
			const registerTypes = pgvector.default?.registerTypes ?? pgvector.registerTypes;
			if (typeof registerTypes === "function") {
				await registerTypes(client);
			}

			// Ensure pgvector extension exists
			await client.query("CREATE EXTENSION IF NOT EXISTS vector");

			this.client = client;
		} catch (error) {
			throw new ConnectionError("pgvector", error);
		}
	}

	async disconnect(): Promise<void> {
		if (this.client) {
			try {
				await this.client.end();
			} catch {
				// Ignore close errors
			}
			this.client = null;
		}
	}

	// ── Collection Management ────────────────────────────────────────

	async createCollection(config: CollectionConfig): Promise<void> {
		const client = this.getClient();
		const tableName = this.tableName(config.name);

		try {
			// Check if table already exists
			const exists = await this.tableExists(tableName);
			if (exists) {
				throw new CollectionAlreadyExistsError(config.name);
			}

			// Create table
			await client.query(`
				CREATE TABLE ${tableName} (
					id TEXT PRIMARY KEY,
					embedding vector(${config.dimension}),
					metadata JSONB DEFAULT '{}'::jsonb
				)
			`);

			// Create vector index
			const opsClass = this.getOpsClass(config.metric ?? "cosine");
			const indexType = this.config.indexType ?? "hnsw";

			if (indexType === "hnsw") {
				const m = this.config.hnswParams?.m ?? 16;
				const efConstruction = this.config.hnswParams?.ef_construction ?? 64;
				await client.query(`
					CREATE INDEX ON ${tableName}
					USING hnsw (embedding ${opsClass})
					WITH (m = ${m}, ef_construction = ${efConstruction})
				`);
			} else {
				await client.query(`
					CREATE INDEX ON ${tableName}
					USING ivfflat (embedding ${opsClass})
				`);
			}

			// Create GIN index on metadata for fast filtering
			await client.query(`
				CREATE INDEX ON ${tableName} USING gin (metadata)
			`);

			// Store collection metadata in a registry table
			await this.ensureRegistryTable();
			await client.query(
				`INSERT INTO ${this.prefix}_collections (name, dimension, metric)
				 VALUES ($1, $2, $3)`,
				[config.name, config.dimension, config.metric ?? "cosine"],
			);
		} catch (error) {
			if (error instanceof CollectionAlreadyExistsError) throw error;
			throw new AdapterError("pgvector", "createCollection", error);
		}
	}

	async listCollections(): Promise<string[]> {
		const client = this.getClient();
		try {
			await this.ensureRegistryTable();
			const result = await client.query(
				`SELECT name FROM ${this.prefix}_collections ORDER BY name`,
			);
			return result.rows.map((r) => String(r.name));
		} catch (error) {
			throw new AdapterError("pgvector", "listCollections", error);
		}
	}

	async deleteCollection(name: string): Promise<void> {
		const client = this.getClient();
		const tableName = this.tableName(name);

		try {
			const exists = await this.tableExists(tableName);
			if (!exists) {
				throw new CollectionNotFoundError(name);
			}

			await client.query(`DROP TABLE IF EXISTS ${tableName}`);
			await this.ensureRegistryTable();
			await client.query(
				`DELETE FROM ${this.prefix}_collections WHERE name = $1`,
				[name],
			);
		} catch (error) {
			if (error instanceof CollectionNotFoundError) throw error;
			throw new AdapterError("pgvector", "deleteCollection", error);
		}
	}

	async describeCollection(name: string): Promise<CollectionInfo> {
		const client = this.getClient();
		const tableName = this.tableName(name);

		try {
			const exists = await this.tableExists(tableName);
			if (!exists) {
				throw new CollectionNotFoundError(name);
			}

			await this.ensureRegistryTable();
			const meta = await client.query(
				`SELECT dimension, metric FROM ${this.prefix}_collections WHERE name = $1`,
				[name],
			);

			const countResult = await client.query(
				`SELECT COUNT(*)::int as count FROM ${tableName}`,
			);

			return {
				name,
				dimension: Number(meta.rows[0]?.dimension ?? 0),
				metric: (meta.rows[0]?.metric as DistanceMetric) ?? "cosine",
				count: Number(countResult.rows[0]?.count ?? 0),
			};
		} catch (error) {
			if (error instanceof CollectionNotFoundError) throw error;
			throw new AdapterError("pgvector", "describeCollection", error);
		}
	}

	// ── CRUD ─────────────────────────────────────────────────────────

	async upsert(collection: string, records: VectorRecord[]): Promise<void> {
		const client = this.getClient();
		const tableName = this.tableName(collection);

		try {
			for (const record of records) {
				const vectorStr = `[${record.values.join(",")}]`;
				await client.query(
					`INSERT INTO ${tableName} (id, embedding, metadata)
					 VALUES ($1, $2::vector, $3::jsonb)
					 ON CONFLICT (id) DO UPDATE SET
						embedding = EXCLUDED.embedding,
						metadata = EXCLUDED.metadata`,
					[record.id, vectorStr, JSON.stringify(record.metadata ?? {})],
				);
			}
		} catch (error) {
			throw new AdapterError("pgvector", "upsert", error);
		}
	}

	async get(collection: string, ids: string[]): Promise<VectorRecord[]> {
		const client = this.getClient();
		const tableName = this.tableName(collection);

		try {
			const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
			const result = await client.query(
				`SELECT id, embedding::text, metadata FROM ${tableName} WHERE id IN (${placeholders})`,
				ids,
			);

			return result.rows.map((row) => ({
				id: String(row.id),
				values: this.parseVector(String(row.embedding ?? "")),
				metadata: this.normalizeMetadata(row.metadata as Record<string, unknown> | undefined),
			}));
		} catch (error) {
			throw new AdapterError("pgvector", "get", error);
		}
	}

	async update(
		collection: string,
		id: string,
		data: Partial<Omit<VectorRecord, "id">>,
	): Promise<void> {
		const client = this.getClient();
		const tableName = this.tableName(collection);

		try {
			// Verify record exists
			const existing = await client.query(
				`SELECT id FROM ${tableName} WHERE id = $1`,
				[id],
			);
			if (existing.rows.length === 0) {
				throw new VectorNotFoundError(id, collection);
			}

			const setClauses: string[] = [];
			const values: unknown[] = [];
			let paramIndex = 1;

			if (data.values) {
				setClauses.push(`embedding = $${paramIndex}::vector`);
				values.push(`[${data.values.join(",")}]`);
				paramIndex++;
			}

			if (data.metadata) {
				setClauses.push(`metadata = metadata || $${paramIndex}::jsonb`);
				values.push(JSON.stringify(data.metadata));
				paramIndex++;
			}

			if (setClauses.length > 0) {
				values.push(id);
				await client.query(
					`UPDATE ${tableName} SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
					values,
				);
			}
		} catch (error) {
			if (error instanceof VectorNotFoundError) throw error;
			throw new AdapterError("pgvector", "update", error);
		}
	}

	async delete(collection: string, ids: string[]): Promise<void> {
		const client = this.getClient();
		const tableName = this.tableName(collection);

		try {
			const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
			await client.query(
				`DELETE FROM ${tableName} WHERE id IN (${placeholders})`,
				ids,
			);
		} catch (error) {
			throw new AdapterError("pgvector", "delete", error);
		}
	}

	// ── Search ───────────────────────────────────────────────────────

	async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
		const client = this.getClient();
		const tableName = this.tableName(collection);

		try {
			const vectorStr = `[${query.vector.join(",")}]`;
			const distanceOp = this.getDistanceOperator(collection);

			let selectFields = `id, 1 - (embedding ${distanceOp} $1::vector) as score`;
			if (query.includeMetadata !== false) selectFields += ", metadata";
			if (query.includeValues) selectFields += ", embedding::text";

			let sql = `SELECT ${selectFields} FROM ${tableName}`;
			const values: unknown[] = [vectorStr];
			let paramIndex = 2;

			if (query.filter) {
				const filterResult = translateFilter(query.filter, paramIndex);
				if (filterResult.where) {
					sql += ` WHERE ${filterResult.where}`;
					values.push(...filterResult.values);
					paramIndex += filterResult.values.length;
				}
			}

			sql += ` ORDER BY embedding ${distanceOp} $1::vector LIMIT $${paramIndex}`;
			values.push(query.topK);

			const result = await client.query(sql, values);

			return result.rows.map((row) => ({
				id: String(row.id),
				score: Number(row.score),
				values: query.includeValues
					? this.parseVector(String(row.embedding ?? ""))
					: undefined,
				metadata:
					query.includeMetadata !== false
						? this.normalizeMetadata(row.metadata as Record<string, unknown> | undefined)
						: undefined,
			}));
		} catch (error) {
			throw new AdapterError("pgvector", "search", error);
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
			500,
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

	private getClient(): PgClient {
		if (!this.client) {
			throw new ConnectionError("pgvector");
		}
		return this.client;
	}

	private tableName(collection: string): string {
		// Sanitize collection name for use as a table name
		const safe = collection.replace(/[^a-zA-Z0-9_]/g, "_");
		return `${this.prefix}_${safe}`;
	}

	private async tableExists(tableName: string): Promise<boolean> {
		const client = this.getClient();
		const result = await client.query(
			`SELECT EXISTS (
				SELECT FROM information_schema.tables
				WHERE table_name = $1
			) as exists`,
			[tableName],
		);
		return result.rows[0]?.exists === true;
	}

	private async ensureRegistryTable(): Promise<void> {
		const client = this.getClient();
		await client.query(`
			CREATE TABLE IF NOT EXISTS ${this.prefix}_collections (
				name TEXT PRIMARY KEY,
				dimension INTEGER NOT NULL,
				metric TEXT NOT NULL DEFAULT 'cosine'
			)
		`);
	}

	private getOpsClass(metric: DistanceMetric): string {
		const map: Record<string, string> = {
			cosine: "vector_cosine_ops",
			euclidean: "vector_l2_ops",
			dotproduct: "vector_ip_ops",
		};
		return map[metric] ?? "vector_cosine_ops";
	}

	private getDistanceOperator(_collection: string): string {
		// Use cosine distance by default
		// TODO: Look up actual metric from registry
		return "<=>";
	}

	private parseVector(vectorStr: string): number[] {
		if (!vectorStr) return [];
		// pgvector returns vectors as "[0.1,0.2,0.3]"
		return vectorStr
			.replace(/[\[\]]/g, "")
			.split(",")
			.map(Number);
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
