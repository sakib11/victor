import type { MetadataFilter, FilterOperator } from "../../types/index.js";

/**
 * Result of filter translation for pgvector.
 * Contains the SQL WHERE clause and parameterized values.
 */
export interface PgFilterResult {
	/** The SQL WHERE clause (e.g., "metadata->>'genre' = $1 AND (metadata->>'year')::int >= $2"). */
	where: string;
	/** Parameterized values for the query. */
	values: unknown[];
}

/**
 * Translate Victor's unified filter format to parameterized SQL WHERE clauses
 * for pgvector. Metadata is stored as a JSONB column, so field access uses
 * the `->>` operator.
 *
 * @example
 * ```ts
 * // Input (Victor format):
 * { genre: { $eq: "drama" }, year: { $gte: 2020 } }
 *
 * // Output:
 * {
 *   where: "metadata->>'genre' = $1 AND (metadata->>'year')::numeric >= $2",
 *   values: ["drama", 2020]
 * }
 * ```
 */
export function translateFilter(
	filter: MetadataFilter,
	paramOffset = 1,
): PgFilterResult {
	const conditions: string[] = [];
	const values: unknown[] = [];
	let paramIndex = paramOffset;

	for (const [key, value] of Object.entries(filter)) {
		if (value === undefined) continue;

		if (key === "$and" && Array.isArray(value)) {
			const subResults = (value as MetadataFilter[]).map((f) => {
				const result = translateFilter(f, paramIndex);
				paramIndex += result.values.length;
				return result;
			});
			const subConditions = subResults.map((r) => `(${r.where})`).join(" AND ");
			conditions.push(subConditions);
			for (const r of subResults) values.push(...r.values);
			continue;
		}

		if (key === "$or" && Array.isArray(value)) {
			const subResults = (value as MetadataFilter[]).map((f) => {
				const result = translateFilter(f, paramIndex);
				paramIndex += result.values.length;
				return result;
			});
			const subConditions = subResults.map((r) => `(${r.where})`).join(" OR ");
			conditions.push(`(${subConditions})`);
			for (const r of subResults) values.push(...r.values);
			continue;
		}

		if (isFilterOperator(value)) {
			const ops = translateOperator(key, value, paramIndex);
			conditions.push(...ops.conditions);
			values.push(...ops.values);
			paramIndex += ops.values.length;
		} else {
			// Shorthand: { field: "value" } → metadata->>'field' = $N
			conditions.push(`metadata->>'${escapeField(key)}' = $${paramIndex}`);
			values.push(value);
			paramIndex++;
		}
	}

	return {
		where: conditions.join(" AND "),
		values,
	};
}

function translateOperator(
	key: string,
	op: FilterOperator,
	startParam: number,
): { conditions: string[]; values: unknown[] } {
	const conditions: string[] = [];
	const values: unknown[] = [];
	let paramIndex = startParam;
	const field = escapeField(key);

	if (op.$eq !== undefined) {
		conditions.push(`metadata->>'${field}' = $${paramIndex}`);
		values.push(op.$eq);
		paramIndex++;
	}

	if (op.$ne !== undefined) {
		conditions.push(`metadata->>'${field}' != $${paramIndex}`);
		values.push(op.$ne);
		paramIndex++;
	}

	if (op.$gt !== undefined) {
		conditions.push(`(metadata->>'${field}')::numeric > $${paramIndex}`);
		values.push(op.$gt);
		paramIndex++;
	}

	if (op.$gte !== undefined) {
		conditions.push(`(metadata->>'${field}')::numeric >= $${paramIndex}`);
		values.push(op.$gte);
		paramIndex++;
	}

	if (op.$lt !== undefined) {
		conditions.push(`(metadata->>'${field}')::numeric < $${paramIndex}`);
		values.push(op.$lt);
		paramIndex++;
	}

	if (op.$lte !== undefined) {
		conditions.push(`(metadata->>'${field}')::numeric <= $${paramIndex}`);
		values.push(op.$lte);
		paramIndex++;
	}

	if (op.$in !== undefined) {
		const placeholders = (op.$in as unknown[]).map((_, i) => `$${paramIndex + i}`).join(", ");
		conditions.push(`metadata->>'${field}' IN (${placeholders})`);
		values.push(...(op.$in as unknown[]));
		paramIndex += (op.$in as unknown[]).length;
	}

	if (op.$nin !== undefined) {
		const placeholders = (op.$nin as unknown[]).map((_, i) => `$${paramIndex + i}`).join(", ");
		conditions.push(`metadata->>'${field}' NOT IN (${placeholders})`);
		values.push(...(op.$nin as unknown[]));
		paramIndex += (op.$nin as unknown[]).length;
	}

	return { conditions, values };
}

/**
 * Escape field names to prevent SQL injection in JSONB access paths.
 */
function escapeField(field: string): string {
	return field.replace(/'/g, "''");
}

function isFilterOperator(value: unknown): value is FilterOperator {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	const operatorKeys = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin"];
	return keys.some((k) => operatorKeys.includes(k));
}
