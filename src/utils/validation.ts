import type { CollectionConfig, SearchQuery, VectorRecord } from "../types/index.js";
import { ValidationError } from "../errors.js";

/**
 * Validate a collection configuration before creation.
 */
export function validateCollectionConfig(config: CollectionConfig): void {
	if (!config.name || typeof config.name !== "string") {
		throw new ValidationError("Collection name must be a non-empty string.");
	}

	if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(config.name)) {
		throw new ValidationError(
			`Invalid collection name "${config.name}". Must start with a letter and contain only letters, numbers, hyphens, and underscores.`,
		);
	}

	if (!Number.isInteger(config.dimension) || config.dimension <= 0) {
		throw new ValidationError(
			`Dimension must be a positive integer, got ${config.dimension}.`,
		);
	}

	const validMetrics = ["cosine", "euclidean", "dotproduct"];
	if (config.metric && !validMetrics.includes(config.metric)) {
		throw new ValidationError(
			`Invalid metric "${config.metric}". Must be one of: ${validMetrics.join(", ")}.`,
		);
	}
}

/**
 * Validate a vector record before upsert.
 */
export function validateVectorRecord(
	record: VectorRecord,
	expectedDimension?: number,
): void {
	if (!record.id || typeof record.id !== "string") {
		throw new ValidationError("Vector record ID must be a non-empty string.");
	}

	if (!Array.isArray(record.values) || record.values.length === 0) {
		throw new ValidationError(
			`Vector record "${record.id}" must have a non-empty values array.`,
		);
	}

	if (record.values.some((v) => typeof v !== "number" || Number.isNaN(v))) {
		throw new ValidationError(
			`Vector record "${record.id}" contains invalid values. All values must be finite numbers.`,
		);
	}

	if (expectedDimension !== undefined && record.values.length !== expectedDimension) {
		throw new ValidationError(
			`Vector record "${record.id}" has dimension ${record.values.length}, expected ${expectedDimension}.`,
		);
	}
}

/**
 * Validate multiple vector records.
 */
export function validateVectorRecords(
	records: VectorRecord[],
	expectedDimension?: number,
): void {
	if (!Array.isArray(records) || records.length === 0) {
		throw new ValidationError("Records array must be non-empty.");
	}

	for (const record of records) {
		validateVectorRecord(record, expectedDimension);
	}

	// Check for duplicate IDs
	const ids = new Set<string>();
	for (const record of records) {
		if (ids.has(record.id)) {
			throw new ValidationError(`Duplicate vector ID "${record.id}" in records.`);
		}
		ids.add(record.id);
	}
}

/**
 * Validate a search query.
 */
export function validateSearchQuery(query: SearchQuery): void {
	if (!Array.isArray(query.vector) || query.vector.length === 0) {
		throw new ValidationError("Search query vector must be a non-empty array.");
	}

	if (query.vector.some((v) => typeof v !== "number" || Number.isNaN(v))) {
		throw new ValidationError("Search query vector contains invalid values.");
	}

	if (!Number.isInteger(query.topK) || query.topK <= 0) {
		throw new ValidationError(`topK must be a positive integer, got ${query.topK}.`);
	}

	if (query.topK > 10000) {
		throw new ValidationError(`topK must be <= 10000, got ${query.topK}.`);
	}
}

/**
 * Validate that a collection name is valid.
 */
export function validateCollectionName(name: string): void {
	if (!name || typeof name !== "string") {
		throw new ValidationError("Collection name must be a non-empty string.");
	}
}

/**
 * Validate an array of IDs.
 */
export function validateIds(ids: string[]): void {
	if (!Array.isArray(ids) || ids.length === 0) {
		throw new ValidationError("IDs array must be non-empty.");
	}

	for (const id of ids) {
		if (!id || typeof id !== "string") {
			throw new ValidationError("Each ID must be a non-empty string.");
		}
	}
}
