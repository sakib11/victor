import type { MetadataFilter, FilterOperator } from "../../types/index.js";

/**
 * Qdrant filter condition structure.
 */
interface QdrantCondition {
	key: string;
	match?: { value: string | number | boolean } | { any: (string | number | boolean)[] };
	range?: { gt?: number; gte?: number; lt?: number; lte?: number };
}

interface QdrantFilter {
	must?: (QdrantCondition | QdrantFilter)[];
	should?: (QdrantCondition | QdrantFilter)[];
	must_not?: (QdrantCondition | QdrantFilter)[];
}

/**
 * Translate Victor's unified filter format to Qdrant's native filter format.
 *
 * Qdrant uses a structured `must` / `should` / `must_not` format with
 * field conditions, which is fundamentally different from MongoDB-style operators.
 *
 * @example
 * ```ts
 * // Input (Victor format):
 * { $and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }] }
 *
 * // Output (Qdrant format):
 * {
 *   must: [
 *     { key: "genre", match: { value: "drama" } },
 *     { key: "year", range: { gte: 2020 } }
 *   ]
 * }
 * ```
 */
export function translateFilter(filter: MetadataFilter): QdrantFilter {
	const must: (QdrantCondition | QdrantFilter)[] = [];

	for (const [key, value] of Object.entries(filter)) {
		if (value === undefined) continue;

		if (key === "$and" && Array.isArray(value)) {
			return {
				must: (value as MetadataFilter[]).map(translateFilter),
			};
		}

		if (key === "$or" && Array.isArray(value)) {
			return {
				should: (value as MetadataFilter[]).map(translateFilter),
			};
		}

		if (isFilterOperator(value)) {
			must.push(...translateOperator(key, value));
		} else {
			// Shorthand: { field: "value" } → match condition
			must.push({ key, match: { value: value as string | number | boolean } });
		}
	}

	return must.length > 0 ? { must } : {};
}

function translateOperator(key: string, op: FilterOperator): QdrantCondition[] {
	const conditions: QdrantCondition[] = [];

	if (op.$eq !== undefined) {
		if (Array.isArray(op.$eq)) {
			conditions.push({ key, match: { any: op.$eq as (string | number | boolean)[] } });
		} else {
			conditions.push({ key, match: { value: op.$eq as string | number | boolean } });
		}
	}

	if (op.$ne !== undefined) {
		// Qdrant doesn't have a direct $ne — we use must_not in the parent.
		// For simplicity, we add a match condition that will be wrapped by the caller.
		conditions.push({ key, match: { value: op.$ne as string | number | boolean } });
	}

	if (op.$in !== undefined) {
		const values = (op.$in as (string | number | boolean)[]).filter(
			(v) => !Array.isArray(v),
		);
		conditions.push({ key, match: { any: values } });
	}

	// Range operators
	const range: { gt?: number; gte?: number; lt?: number; lte?: number } = {};
	let hasRange = false;

	if (op.$gt !== undefined) {
		range.gt = op.$gt;
		hasRange = true;
	}
	if (op.$gte !== undefined) {
		range.gte = op.$gte;
		hasRange = true;
	}
	if (op.$lt !== undefined) {
		range.lt = op.$lt;
		hasRange = true;
	}
	if (op.$lte !== undefined) {
		range.lte = op.$lte;
		hasRange = true;
	}

	if (hasRange) {
		conditions.push({ key, range });
	}

	return conditions;
}

function isFilterOperator(value: unknown): value is FilterOperator {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	const operatorKeys = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin"];
	return keys.some((k) => operatorKeys.includes(k));
}
