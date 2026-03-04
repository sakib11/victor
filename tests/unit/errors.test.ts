import { describe, it, expect } from "vitest";
import {
	VictorError,
	ConnectionError,
	CollectionNotFoundError,
	CollectionAlreadyExistsError,
	VectorNotFoundError,
	ValidationError,
	AdapterError,
	EmbedderNotConfiguredError,
} from "../../src/errors.js";

describe("Error hierarchy", () => {
	it("all errors extend VictorError", () => {
		expect(new ConnectionError("test")).toBeInstanceOf(VictorError);
		expect(new CollectionNotFoundError("test")).toBeInstanceOf(VictorError);
		expect(new CollectionAlreadyExistsError("test")).toBeInstanceOf(VictorError);
		expect(new VectorNotFoundError("1", "test")).toBeInstanceOf(VictorError);
		expect(new ValidationError("test")).toBeInstanceOf(VictorError);
		expect(new AdapterError("test", "op")).toBeInstanceOf(VictorError);
		expect(new EmbedderNotConfiguredError()).toBeInstanceOf(VictorError);
	});

	it("all errors extend Error", () => {
		expect(new VictorError("test", "CODE")).toBeInstanceOf(Error);
	});

	it("ConnectionError includes adapter name", () => {
		const err = new ConnectionError("pinecone");
		expect(err.message).toContain("pinecone");
		expect(err.code).toBe("CONNECTION_ERROR");
		expect(err.name).toBe("ConnectionError");
	});

	it("CollectionNotFoundError includes collection name", () => {
		const err = new CollectionNotFoundError("my-collection");
		expect(err.message).toContain("my-collection");
		expect(err.collection).toBe("my-collection");
		expect(err.code).toBe("COLLECTION_NOT_FOUND");
	});

	it("CollectionAlreadyExistsError includes collection name", () => {
		const err = new CollectionAlreadyExistsError("my-collection");
		expect(err.message).toContain("my-collection");
		expect(err.collection).toBe("my-collection");
		expect(err.code).toBe("COLLECTION_ALREADY_EXISTS");
	});

	it("VectorNotFoundError includes vector and collection", () => {
		const err = new VectorNotFoundError("vec-1", "my-collection");
		expect(err.message).toContain("vec-1");
		expect(err.message).toContain("my-collection");
		expect(err.vectorId).toBe("vec-1");
		expect(err.collection).toBe("my-collection");
	});

	it("AdapterError wraps cause message", () => {
		const cause = new Error("original error");
		const err = new AdapterError("qdrant", "search", cause);
		expect(err.message).toContain("qdrant");
		expect(err.message).toContain("search");
		expect(err.message).toContain("original error");
		expect(err.adapter).toBe("qdrant");
		expect(err.operation).toBe("search");
		expect(err.cause).toBe(cause);
	});

	it("EmbedderNotConfiguredError has clear message", () => {
		const err = new EmbedderNotConfiguredError();
		expect(err.message).toContain("embedder");
		expect(err.code).toBe("EMBEDDER_NOT_CONFIGURED");
	});

	it("errors preserve cause chain", () => {
		const original = new Error("root cause");
		const err = new ConnectionError("pinecone", original);
		expect(err.cause).toBe(original);
	});
});
