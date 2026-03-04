import type { MetadataFilter, FilterOperator } from "../../types/index.js";

/**
 * Translate Victor's unified filter format to Milvus's SQL-like expression strings.
 *
 * Milvus uses SQL-like boolean expressions for filtering, not JSON operators.
 *
 * @example
 * ```ts
 * // Input (Victor format):
 * { $and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }] }
 *
 * // Output (Milvus format):
 * '(genre == "drama") and (year >= 2020)'
 *
 * // Input:
 * { genre: { $in: ["drama", "comedy"] } }
 *
 * // Output:
 * 'genre in ["drama", "comedy"]'
 * ```
 */
export function translateFilter(filter: MetadataFilter): string {
	const parts: string[] = [];

	for (const [key, value] of Object.entries(filter)) {
		if (value === undefined) continue;

		if (key === "$and" && Array.isArray(value)) {
			const subExprs = (value as MetadataFilter[]).map(translateFilter);
			return subExprs.map((e) => `(${e})`).join(" and ");
		}

		if (key === "$or" && Array.isArray(value)) {
			const subExprs = (value as MetadataFilter[]).map(translateFilter);
			return subExprs.map((e) => `(${e})`).join(" or ");
		}

		if (isFilterOperator(value)) {
			parts.push(...translateOperator(key, value));
		} else {
			// Shorthand: { field: "value" } → field == "value"
			parts.push(`${key} == ${formatValue(value as string | number | boolean)}`);
		}
	}

	return parts.join(" and ");
}

function translateOperator(key: string, op: FilterOperator): string[] {
	const exprs: string[] = [];

	if (op.$eq !== undefined) {
		exprs.push(`${key} == ${formatValue(op.$eq as string | number | boolean)}`);
	}
	if (op.$ne !== undefined) {
		exprs.push(`${key} != ${formatValue(op.$ne as string | number | boolean)}`);
	}
	if (op.$gt !== undefined) {
		exprs.push(`${key} > ${op.$gt}`);
	}
	if (op.$gte !== undefined) {
		exprs.push(`${key} >= ${op.$gte}`);
	}
	if (op.$lt !== undefined) {
		exprs.push(`${key} < ${op.$lt}`);
	}
	if (op.$lte !== undefined) {
		exprs.push(`${key} <= ${op.$lte}`);
	}
	if (op.$in !== undefined) {
		const vals = (op.$in as (string | number | boolean)[]).map(formatValue);
		exprs.push(`${key} in [${vals.join(", ")}]`);
	}
	if (op.$nin !== undefined) {
		const vals = (op.$nin as (string | number | boolean)[]).map(formatValue);
		exprs.push(`${key} not in [${vals.join(", ")}]`);
	}

	return exprs;
}

function formatValue(value: string | number | boolean): string {
	if (typeof value === "string") {
		// Escape quotes in strings
		return `"${value.replace(/"/g, '\\"')}"`;
	}
	return String(value);
}

function isFilterOperator(value: unknown): value is FilterOperator {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	const operatorKeys = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin"];
	return keys.some((k) => operatorKeys.includes(k));
}
