import type { MetadataFilter, FilterOperator } from "../../types/index.js";

/**
 * Translate Victor's unified filter format to Pinecone's native filter format.
 *
 * Pinecone uses MongoDB-style operators natively, so this is largely
 * a passthrough with normalization of shorthand values.
 *
 * @example
 * ```ts
 * // Input (Victor format):
 * { genre: { $eq: "drama" }, year: { $gte: 2020 } }
 *
 * // Output (Pinecone format — same structure):
 * { genre: { $eq: "drama" }, year: { $gte: 2020 } }
 *
 * // Shorthand input:
 * { genre: "drama" }
 *
 * // Normalized output:
 * { genre: { $eq: "drama" } }
 * ```
 */
export function translateFilter(
	filter: MetadataFilter,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(filter)) {
		if (value === undefined) continue;

		if (key === "$and" && Array.isArray(value)) {
			result.$and = (value as MetadataFilter[]).map(translateFilter);
		} else if (key === "$or" && Array.isArray(value)) {
			result.$or = (value as MetadataFilter[]).map(translateFilter);
		} else if (isFilterOperator(value)) {
			result[key] = value;
		} else {
			// Shorthand: { field: "value" } → { field: { $eq: "value" } }
			result[key] = { $eq: value };
		}
	}

	return result;
}

function isFilterOperator(value: unknown): value is FilterOperator {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	const operatorKeys = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin"];
	return keys.some((k) => operatorKeys.includes(k));
}
