import { describe, it, expect } from "vitest";

// Import filter translators from each adapter
import { translateFilter as pineconeFilter } from "../../src/adapters/pinecone/filter.js";
import { translateFilter as qdrantFilter } from "../../src/adapters/qdrant/filter.js";
import { translateFilter as chromaFilter } from "../../src/adapters/chroma/filter.js";
import { translateFilter as milvusFilter } from "../../src/adapters/milvus/filter.js";
import { translateFilter as pgvectorFilter } from "../../src/adapters/pgvector/filter.js";
import { translateFilter as weaviateFilter } from "../../src/adapters/weaviate/filter.js";

// ── Pinecone Filter ──────────────────────────────────────────────────

describe("Pinecone filter translation", () => {
	it("passes through operator filters", () => {
		const result = pineconeFilter({ genre: { $eq: "drama" } });
		expect(result).toEqual({ genre: { $eq: "drama" } });
	});

	it("normalizes shorthand to $eq", () => {
		const result = pineconeFilter({ genre: "drama" });
		expect(result).toEqual({ genre: { $eq: "drama" } });
	});

	it("handles $and", () => {
		const result = pineconeFilter({
			$and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }],
		});
		expect(result).toEqual({
			$and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }],
		});
	});

	it("handles $or", () => {
		const result = pineconeFilter({
			$or: [{ genre: "drama" }, { genre: "comedy" }],
		});
		expect(result.$or).toHaveLength(2);
	});
});

// ── Qdrant Filter ────────────────────────────────────────────────────

describe("Qdrant filter translation", () => {
	it("translates equality to match condition", () => {
		const result = qdrantFilter({ genre: "drama" });
		expect(result).toEqual({
			must: [{ key: "genre", match: { value: "drama" } }],
		});
	});

	it("translates $eq operator", () => {
		const result = qdrantFilter({ genre: { $eq: "drama" } });
		expect(result).toEqual({
			must: [{ key: "genre", match: { value: "drama" } }],
		});
	});

	it("translates range operators", () => {
		const result = qdrantFilter({ year: { $gte: 2020, $lt: 2025 } });
		expect(result).toEqual({
			must: [{ key: "year", range: { gte: 2020, lt: 2025 } }],
		});
	});

	it("translates $in to any match", () => {
		const result = qdrantFilter({ genre: { $in: ["drama", "comedy"] } });
		expect(result).toEqual({
			must: [{ key: "genre", match: { any: ["drama", "comedy"] } }],
		});
	});

	it("translates $and to must array", () => {
		const result = qdrantFilter({
			$and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }],
		});
		expect(result.must).toHaveLength(2);
	});

	it("translates $or to should array", () => {
		const result = qdrantFilter({
			$or: [{ genre: "drama" }, { genre: "comedy" }],
		});
		expect(result.should).toHaveLength(2);
	});
});

// ── ChromaDB Filter ──────────────────────────────────────────────────

describe("ChromaDB filter translation", () => {
	it("passes through operator filters (same as Pinecone)", () => {
		const result = chromaFilter({ genre: { $eq: "drama" } });
		expect(result).toEqual({ genre: { $eq: "drama" } });
	});

	it("normalizes shorthand", () => {
		const result = chromaFilter({ genre: "drama" });
		expect(result).toEqual({ genre: { $eq: "drama" } });
	});
});

// ── Milvus Filter ────────────────────────────────────────────────────

describe("Milvus filter translation", () => {
	it("translates equality to SQL expression", () => {
		const result = milvusFilter({ genre: { $eq: "drama" } });
		expect(result).toBe('genre == "drama"');
	});

	it("translates shorthand to SQL expression", () => {
		const result = milvusFilter({ genre: "drama" });
		expect(result).toBe('genre == "drama"');
	});

	it("translates range operators", () => {
		const result = milvusFilter({ year: { $gte: 2020 } });
		expect(result).toBe("year >= 2020");
	});

	it("translates $in", () => {
		const result = milvusFilter({ genre: { $in: ["drama", "comedy"] } });
		expect(result).toBe('genre in ["drama", "comedy"]');
	});

	it("translates $and", () => {
		const result = milvusFilter({
			$and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }],
		});
		expect(result).toBe('(genre == "drama") and (year >= 2020)');
	});

	it("translates $or", () => {
		const result = milvusFilter({
			$or: [{ genre: "drama" }, { genre: "comedy" }],
		});
		expect(result).toBe('(genre == "drama") or (genre == "comedy")');
	});

	it("translates $ne", () => {
		const result = milvusFilter({ genre: { $ne: "horror" } });
		expect(result).toBe('genre != "horror"');
	});

	it("translates $nin", () => {
		const result = milvusFilter({ genre: { $nin: ["horror", "thriller"] } });
		expect(result).toBe('genre not in ["horror", "thriller"]');
	});

	it("handles boolean values", () => {
		const result = milvusFilter({ active: { $eq: true } });
		expect(result).toBe("active == true");
	});

	it("handles multiple fields with AND", () => {
		const result = milvusFilter({
			genre: { $eq: "drama" },
			year: { $gte: 2020 },
		});
		expect(result).toBe('genre == "drama" and year >= 2020');
	});

	it("escapes quotes in string values", () => {
		const result = milvusFilter({ title: { $eq: 'He said "hello"' } });
		expect(result).toBe('title == "He said \\"hello\\""');
	});
});

// ── pgvector Filter ──────────────────────────────────────────────────

describe("pgvector filter translation", () => {
	it("translates equality to parameterized SQL", () => {
		const result = pgvectorFilter({ genre: { $eq: "drama" } });
		expect(result.where).toBe("metadata->>'genre' = $1");
		expect(result.values).toEqual(["drama"]);
	});

	it("translates shorthand to parameterized SQL", () => {
		const result = pgvectorFilter({ genre: "drama" });
		expect(result.where).toBe("metadata->>'genre' = $1");
		expect(result.values).toEqual(["drama"]);
	});

	it("translates range operators with numeric cast", () => {
		const result = pgvectorFilter({ year: { $gte: 2020 } });
		expect(result.where).toBe("(metadata->>'year')::numeric >= $1");
		expect(result.values).toEqual([2020]);
	});

	it("translates $in with multiple params", () => {
		const result = pgvectorFilter({ genre: { $in: ["drama", "comedy"] } });
		expect(result.where).toBe("metadata->>'genre' IN ($1, $2)");
		expect(result.values).toEqual(["drama", "comedy"]);
	});

	it("translates $and", () => {
		const result = pgvectorFilter({
			$and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }],
		});
		expect(result.where).toBe(
			"(metadata->>'genre' = $1) AND ((metadata->>'year')::numeric >= $2)",
		);
		expect(result.values).toEqual(["drama", 2020]);
	});

	it("translates $or", () => {
		const result = pgvectorFilter({
			$or: [{ genre: "drama" }, { genre: "comedy" }],
		});
		expect(result.where).toBe(
			"((metadata->>'genre' = $1) OR (metadata->>'genre' = $2))",
		);
		expect(result.values).toEqual(["drama", "comedy"]);
	});

	it("handles custom param offset", () => {
		const result = pgvectorFilter({ genre: "drama" }, 5);
		expect(result.where).toBe("metadata->>'genre' = $5");
		expect(result.values).toEqual(["drama"]);
	});
});

// ── Weaviate Filter ──────────────────────────────────────────────────

describe("Weaviate filter translation", () => {
	it("translates equality to Equal condition", () => {
		const result = weaviateFilter({ genre: "drama" });
		expect(result).toEqual({
			path: ["genre"],
			operator: "Equal",
			valueText: "drama",
		});
	});

	it("translates $eq operator", () => {
		const result = weaviateFilter({ genre: { $eq: "drama" } });
		expect(result).toEqual({
			path: ["genre"],
			operator: "Equal",
			valueText: "drama",
		});
	});

	it("translates numeric comparison", () => {
		const result = weaviateFilter({ year: { $gte: 2020 } });
		expect(result).toEqual({
			path: ["year"],
			operator: "GreaterThanEqual",
			valueNumber: 2020,
			valueInt: 2020,
		});
	});

	it("translates $and", () => {
		const result = weaviateFilter({
			$and: [{ genre: { $eq: "drama" } }, { year: { $gte: 2020 } }],
		});
		expect(result.operator).toBe("And");
		expect(result.operands).toHaveLength(2);
	});

	it("translates $or", () => {
		const result = weaviateFilter({
			$or: [{ genre: "drama" }, { genre: "comedy" }],
		});
		expect(result.operator).toBe("Or");
		expect(result.operands).toHaveLength(2);
	});

	it("translates $in as OR of Equal conditions", () => {
		const result = weaviateFilter({ genre: { $in: ["drama", "comedy"] } });
		expect(result).toEqual({
			operator: "Or",
			operands: [
				{ path: ["genre"], operator: "Equal", valueText: "drama" },
				{ path: ["genre"], operator: "Equal", valueText: "comedy" },
			],
		});
	});

	it("translates boolean values", () => {
		const result = weaviateFilter({ active: { $eq: true } });
		expect(result).toEqual({
			path: ["active"],
			operator: "Equal",
			valueBoolean: true,
		});
	});

	it("wraps multiple field filters in And", () => {
		const result = weaviateFilter({
			genre: { $eq: "drama" },
			year: { $gte: 2020 },
		});
		expect(result.operator).toBe("And");
		expect(result.operands).toHaveLength(2);
	});
});
