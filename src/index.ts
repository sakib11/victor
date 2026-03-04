// ── Core Client ──────────────────────────────────────────────────────
export { VictorClient } from "./client.js";
export type { VictorClientOptions } from "./client.js";

// ── Interfaces ───────────────────────────────────────────────────────
export type { VectorStore } from "./interfaces/vector-store.js";
export type { Embedder } from "./interfaces/embedder.js";

// ── Types ────────────────────────────────────────────────────────────
export type {
	VectorRecord,
	SearchResult,
	SearchQuery,
	BatchOptions,
	DistanceMetric,
	MetadataValue,
	MetadataFilter,
	FilterOperator,
	CollectionConfig,
	CollectionInfo,
	EmbedderConfig,
	EmbeddingResult,
	TextRecord,
	TextSearchQuery,
} from "./types/index.js";

// ── Errors ───────────────────────────────────────────────────────────
export {
	VictorError,
	ConnectionError,
	CollectionNotFoundError,
	CollectionAlreadyExistsError,
	VectorNotFoundError,
	ValidationError,
	AdapterError,
	EmbedderNotConfiguredError,
} from "./errors.js";

// ── Utilities ────────────────────────────────────────────────────────
export { withRetry } from "./utils/retry.js";
export type { RetryOptions } from "./utils/retry.js";
