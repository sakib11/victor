import type { MetadataFilter, FilterOperator } from "../../types/index.js";

/**
 * Weaviate filter structure (simplified).
 */
interface WeaviateFilter {
	operator: string;
	operands?: WeaviateFilter[];
	path?: string[];
	valueText?: string;
	valueInt?: number;
	valueNumber?: number;
	valueBoolean?: boolean;
	valueTextArray?: string[];
}

/**
 * Translate Victor's unified filter format to Weaviate's native filter format.
 *
 * Weaviate uses a structured filter object with operators like "Equal", "GreaterThan", etc.
 * and accesses properties via a `path` array.
 *
 * @example
 * ```ts
 * // Input (Victor format):
 * { $and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }] }
 *
 * // Output (Weaviate format):
 * {
 *   operator: "And",
 *   operands: [
 *     { path: ["genre"], operator: "Equal", valueText: "drama" },
 *     { path: ["year"], operator: "GreaterThanEqual", valueInt: 2020 }
 *   ]
 * }
 * ```
 */
export function translateFilter(filter: MetadataFilter): WeaviateFilter {
	const conditions: WeaviateFilter[] = [];

	for (const [key, value] of Object.entries(filter)) {
		if (value === undefined) continue;

		if (key === "$and" && Array.isArray(value)) {
			return {
				operator: "And",
				operands: (value as MetadataFilter[]).map(translateFilter),
			};
		}

		if (key === "$or" && Array.isArray(value)) {
			return {
				operator: "Or",
				operands: (value as MetadataFilter[]).map(translateFilter),
			};
		}

		if (isFilterOperator(value)) {
			conditions.push(...translateOperator(key, value));
		} else {
			// Shorthand: { field: "value" } → Equal condition
			conditions.push(createCondition(key, "Equal", value as string | number | boolean));
		}
	}

	if (conditions.length === 1) {
		return conditions[0]!;
	}

	return {
		operator: "And",
		operands: conditions,
	};
}

function translateOperator(key: string, op: FilterOperator): WeaviateFilter[] {
	const conditions: WeaviateFilter[] = [];

	if (op.$eq !== undefined) {
		conditions.push(createCondition(key, "Equal", op.$eq as string | number | boolean));
	}
	if (op.$ne !== undefined) {
		conditions.push(createCondition(key, "NotEqual", op.$ne as string | number | boolean));
	}
	if (op.$gt !== undefined) {
		conditions.push(createCondition(key, "GreaterThan", op.$gt));
	}
	if (op.$gte !== undefined) {
		conditions.push(createCondition(key, "GreaterThanEqual", op.$gte));
	}
	if (op.$lt !== undefined) {
		conditions.push(createCondition(key, "LessThan", op.$lt));
	}
	if (op.$lte !== undefined) {
		conditions.push(createCondition(key, "LessThanEqual", op.$lte));
	}
	if (op.$in !== undefined) {
		// Weaviate doesn't have a direct $in. Use OR + Equal for each value.
		const operands = (op.$in as (string | number | boolean)[])
			.filter((v) => !Array.isArray(v))
			.map((v) => createCondition(key, "Equal", v));
		if (operands.length === 1) {
			conditions.push(operands[0]!);
		} else if (operands.length > 1) {
			conditions.push({ operator: "Or", operands });
		}
	}
	if (op.$nin !== undefined) {
		// Use AND + NotEqual for each value
		const operands = (op.$nin as (string | number | boolean)[])
			.filter((v) => !Array.isArray(v))
			.map((v) => createCondition(key, "NotEqual", v));
		if (operands.length === 1) {
			conditions.push(operands[0]!);
		} else if (operands.length > 1) {
			conditions.push({ operator: "And", operands });
		}
	}

	return conditions;
}

function createCondition(
	key: string,
	operator: string,
	value: string | number | boolean,
): WeaviateFilter {
	const condition: WeaviateFilter = {
		path: [key],
		operator,
	};

	if (typeof value === "string") {
		condition.valueText = value;
	} else if (typeof value === "boolean") {
		condition.valueBoolean = value;
	} else if (typeof value === "number") {
		condition.valueNumber = value;
		if (Number.isInteger(value)) {
			condition.valueInt = value;
		}
	}

	return condition;
}

function isFilterOperator(value: unknown): value is FilterOperator {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	const operatorKeys = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin"];
	return keys.some((k) => operatorKeys.includes(k));
}
