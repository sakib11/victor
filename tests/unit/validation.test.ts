import { describe, it, expect } from "vitest";
import {
	validateCollectionConfig,
	validateVectorRecord,
	validateVectorRecords,
	validateSearchQuery,
	validateCollectionName,
	validateIds,
} from "../../src/utils/validation.js";

describe("validateCollectionConfig", () => {
	it("accepts valid config", () => {
		expect(() =>
			validateCollectionConfig({ name: "test", dimension: 128 }),
		).not.toThrow();
	});

	it("accepts config with optional metric", () => {
		expect(() =>
			validateCollectionConfig({ name: "test", dimension: 128, metric: "cosine" }),
		).not.toThrow();
	});

	it("rejects empty name", () => {
		expect(() =>
			validateCollectionConfig({ name: "", dimension: 128 }),
		).toThrow("non-empty string");
	});

	it("rejects invalid name characters", () => {
		expect(() =>
			validateCollectionConfig({ name: "my collection!", dimension: 128 }),
		).toThrow("Invalid collection name");
	});

	it("rejects name starting with number", () => {
		expect(() =>
			validateCollectionConfig({ name: "123test", dimension: 128 }),
		).toThrow("Invalid collection name");
	});

	it("rejects zero dimension", () => {
		expect(() =>
			validateCollectionConfig({ name: "test", dimension: 0 }),
		).toThrow("positive integer");
	});

	it("rejects negative dimension", () => {
		expect(() =>
			validateCollectionConfig({ name: "test", dimension: -5 }),
		).toThrow("positive integer");
	});

	it("rejects float dimension", () => {
		expect(() =>
			validateCollectionConfig({ name: "test", dimension: 12.5 }),
		).toThrow("positive integer");
	});

	it("rejects invalid metric", () => {
		expect(() =>
			validateCollectionConfig({
				name: "test",
				dimension: 128,
				metric: "invalid" as "cosine",
			}),
		).toThrow("Invalid metric");
	});

	it("accepts all valid metrics", () => {
		for (const metric of ["cosine", "euclidean", "dotproduct"] as const) {
			expect(() =>
				validateCollectionConfig({ name: "test", dimension: 128, metric }),
			).not.toThrow();
		}
	});

	it("accepts names with hyphens and underscores", () => {
		expect(() =>
			validateCollectionConfig({ name: "my-test_collection", dimension: 128 }),
		).not.toThrow();
	});
});

describe("validateVectorRecord", () => {
	it("accepts valid record", () => {
		expect(() =>
			validateVectorRecord({ id: "1", values: [0.1, 0.2, 0.3] }),
		).not.toThrow();
	});

	it("rejects empty id", () => {
		expect(() =>
			validateVectorRecord({ id: "", values: [0.1] }),
		).toThrow("non-empty string");
	});

	it("rejects empty values array", () => {
		expect(() => validateVectorRecord({ id: "1", values: [] })).toThrow(
			"non-empty values",
		);
	});

	it("rejects NaN values", () => {
		expect(() =>
			validateVectorRecord({ id: "1", values: [0.1, NaN, 0.3] }),
		).toThrow("invalid values");
	});

	it("validates dimension when expected", () => {
		expect(() =>
			validateVectorRecord({ id: "1", values: [0.1, 0.2] }, 3),
		).toThrow("dimension 2, expected 3");
	});

	it("passes dimension check when matching", () => {
		expect(() =>
			validateVectorRecord({ id: "1", values: [0.1, 0.2, 0.3] }, 3),
		).not.toThrow();
	});
});

describe("validateVectorRecords", () => {
	it("accepts valid records array", () => {
		expect(() =>
			validateVectorRecords([
				{ id: "1", values: [0.1, 0.2] },
				{ id: "2", values: [0.3, 0.4] },
			]),
		).not.toThrow();
	});

	it("rejects empty array", () => {
		expect(() => validateVectorRecords([])).toThrow("non-empty");
	});

	it("rejects duplicate IDs", () => {
		expect(() =>
			validateVectorRecords([
				{ id: "1", values: [0.1] },
				{ id: "1", values: [0.2] },
			]),
		).toThrow('Duplicate vector ID "1"');
	});
});

describe("validateSearchQuery", () => {
	it("accepts valid query", () => {
		expect(() =>
			validateSearchQuery({ vector: [0.1, 0.2], topK: 10 }),
		).not.toThrow();
	});

	it("rejects empty vector", () => {
		expect(() => validateSearchQuery({ vector: [], topK: 10 })).toThrow(
			"non-empty array",
		);
	});

	it("rejects zero topK", () => {
		expect(() =>
			validateSearchQuery({ vector: [0.1], topK: 0 }),
		).toThrow("positive integer");
	});

	it("rejects negative topK", () => {
		expect(() =>
			validateSearchQuery({ vector: [0.1], topK: -5 }),
		).toThrow("positive integer");
	});

	it("rejects topK > 10000", () => {
		expect(() =>
			validateSearchQuery({ vector: [0.1], topK: 10001 }),
		).toThrow("<= 10000");
	});

	it("rejects NaN in vector", () => {
		expect(() =>
			validateSearchQuery({ vector: [0.1, NaN], topK: 10 }),
		).toThrow("invalid values");
	});
});

describe("validateCollectionName", () => {
	it("accepts valid name", () => {
		expect(() => validateCollectionName("test")).not.toThrow();
	});

	it("rejects empty name", () => {
		expect(() => validateCollectionName("")).toThrow("non-empty string");
	});
});

describe("validateIds", () => {
	it("accepts valid ids", () => {
		expect(() => validateIds(["1", "2", "3"])).not.toThrow();
	});

	it("rejects empty array", () => {
		expect(() => validateIds([])).toThrow("non-empty");
	});

	it("rejects empty string id", () => {
		expect(() => validateIds(["1", ""])).toThrow("non-empty string");
	});
});
