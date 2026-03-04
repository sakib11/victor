import type { MetadataValue } from "./vector.js";

/**
 * Operators for filtering metadata fields.
 *
 * Uses MongoDB-style syntax since it's the most common pattern
 * across vector databases (Pinecone and ChromaDB use it natively).
 * Each adapter translates this to its native filter format.
 */
export interface FilterOperator {
	/** Equal to */
	$eq?: MetadataValue;
	/** Not equal to */
	$ne?: MetadataValue;
	/** Greater than */
	$gt?: number;
	/** Greater than or equal to */
	$gte?: number;
	/** Less than */
	$lt?: number;
	/** Less than or equal to */
	$lte?: number;
	/** Value is in the given array */
	$in?: MetadataValue[];
	/** Value is not in the given array */
	$nin?: MetadataValue[];
}

/**
 * A metadata filter expression using MongoDB-style query operators.
 *
 * Supports logical combinators (`$and`, `$or`) and field-level operators.
 *
 * @example
 * ```ts
 * // Simple equality
 * const filter: MetadataFilter = { genre: { $eq: "drama" } };
 *
 * // Combined conditions
 * const filter: MetadataFilter = {
 *   $and: [
 *     { genre: { $eq: "drama" } },
 *     { year: { $gte: 2020 } },
 *   ],
 * };
 *
 * // Shorthand equality (value directly instead of { $eq: value })
 * const filter: MetadataFilter = { genre: "drama" };
 * ```
 */
export type MetadataFilter = {
	/** Logical AND — all conditions must match. */
	$and?: MetadataFilter[];
	/** Logical OR — at least one condition must match. */
	$or?: MetadataFilter[];
} & {
	/** Field-level filter: either an operator object or a direct value (shorthand for $eq). */
	[field: string]: FilterOperator | MetadataValue | MetadataFilter[] | undefined;
};
