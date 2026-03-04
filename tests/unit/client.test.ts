import { describe, it, expect, vi, beforeEach } from "vitest";
import { VictorClient } from "../../src/client.js";
import type { VectorStore } from "../../src/interfaces/vector-store.js";
import type { Embedder } from "../../src/interfaces/embedder.js";
import {
	EmbedderNotConfiguredError,
	ValidationError,
} from "../../src/errors.js";

// ── Mock Store ───────────────────────────────────────────────────────

function createMockStore(): VectorStore {
	return {
		name: "mock",
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		createCollection: vi.fn().mockResolvedValue(undefined),
		listCollections: vi.fn().mockResolvedValue(["col1", "col2"]),
		deleteCollection: vi.fn().mockResolvedValue(undefined),
		describeCollection: vi.fn().mockResolvedValue({
			name: "test",
			dimension: 3,
			metric: "cosine",
			count: 100,
		}),
		upsert: vi.fn().mockResolvedValue(undefined),
		get: vi.fn().mockResolvedValue([
			{ id: "1", values: [0.1, 0.2, 0.3], metadata: { key: "val" } },
		]),
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		search: vi.fn().mockResolvedValue([
			{ id: "1", score: 0.95, metadata: { key: "val" } },
		]),
		batchUpsert: vi.fn().mockResolvedValue(undefined),
		batchDelete: vi.fn().mockResolvedValue(undefined),
	};
}

// ── Mock Embedder ────────────────────────────────────────────────────

function createMockEmbedder(): Embedder {
	return {
		model: "test-model",
		dimensions: 3,
		embed: vi.fn().mockResolvedValue({ values: [0.1, 0.2, 0.3] }),
		embedBatch: vi.fn().mockResolvedValue([
			{ values: [0.1, 0.2, 0.3] },
			{ values: [0.4, 0.5, 0.6] },
		]),
	};
}

describe("VictorClient", () => {
	let store: VectorStore;
	let embedder: Embedder;
	let client: VictorClient;

	beforeEach(() => {
		store = createMockStore();
		embedder = createMockEmbedder();
		client = new VictorClient({ store, embedder });
	});

	// ── Properties ────────────────────────────────────────────────

	it("exposes adapter name", () => {
		expect(client.adapterName).toBe("mock");
	});

	it("exposes embedding model", () => {
		expect(client.embeddingModel).toBe("test-model");
	});

	it("returns undefined for embedding model when no embedder", () => {
		const noEmbedClient = new VictorClient({ store });
		expect(noEmbedClient.embeddingModel).toBeUndefined();
	});

	// ── Connection ────────────────────────────────────────────────

	it("delegates connect to store", async () => {
		await client.connect();
		expect(store.connect).toHaveBeenCalled();
	});

	it("delegates disconnect to store", async () => {
		await client.disconnect();
		expect(store.disconnect).toHaveBeenCalled();
	});

	// ── Collection Management ─────────────────────────────────────

	it("validates and delegates createCollection", async () => {
		await client.createCollection({ name: "test", dimension: 128 });
		expect(store.createCollection).toHaveBeenCalledWith({
			name: "test",
			dimension: 128,
		});
	});

	it("rejects invalid collection config", async () => {
		await expect(
			client.createCollection({ name: "", dimension: 128 }),
		).rejects.toThrow(ValidationError);
	});

	it("delegates listCollections", async () => {
		const result = await client.listCollections();
		expect(result).toEqual(["col1", "col2"]);
	});

	it("delegates deleteCollection", async () => {
		await client.deleteCollection("test");
		expect(store.deleteCollection).toHaveBeenCalledWith("test");
	});

	it("delegates describeCollection", async () => {
		const info = await client.describeCollection("test");
		expect(info.name).toBe("test");
		expect(info.dimension).toBe(3);
	});

	// ── CRUD ──────────────────────────────────────────────────────

	it("validates and delegates upsert", async () => {
		const records = [{ id: "1", values: [0.1, 0.2, 0.3] }];
		await client.upsert("test", records);
		expect(store.upsert).toHaveBeenCalledWith("test", records);
	});

	it("rejects upsert with empty records", async () => {
		await expect(client.upsert("test", [])).rejects.toThrow(ValidationError);
	});

	it("rejects upsert with duplicate IDs", async () => {
		await expect(
			client.upsert("test", [
				{ id: "1", values: [0.1] },
				{ id: "1", values: [0.2] },
			]),
		).rejects.toThrow("Duplicate");
	});

	it("delegates get with validation", async () => {
		const result = await client.get("test", ["1"]);
		expect(result).toHaveLength(1);
		expect(store.get).toHaveBeenCalledWith("test", ["1"]);
	});

	it("delegates delete", async () => {
		await client.delete("test", ["1", "2"]);
		expect(store.delete).toHaveBeenCalledWith("test", ["1", "2"]);
	});

	// ── Search ────────────────────────────────────────────────────

	it("validates and delegates search", async () => {
		const results = await client.search("test", {
			vector: [0.1, 0.2, 0.3],
			topK: 5,
		});
		expect(results).toHaveLength(1);
		expect(results[0]!.score).toBe(0.95);
	});

	it("rejects search with empty vector", async () => {
		await expect(
			client.search("test", { vector: [], topK: 5 }),
		).rejects.toThrow(ValidationError);
	});

	// ── Text-based operations ─────────────────────────────────────

	it("searchByText embeds and searches", async () => {
		const results = await client.searchByText("test", {
			text: "hello world",
			topK: 5,
		});

		expect(embedder.embed).toHaveBeenCalledWith("hello world");
		expect(store.search).toHaveBeenCalledWith("test", {
			vector: [0.1, 0.2, 0.3],
			topK: 5,
			filter: undefined,
			includeMetadata: undefined,
			includeValues: undefined,
		});
		expect(results).toHaveLength(1);
	});

	it("searchByText throws without embedder", async () => {
		const noEmbedClient = new VictorClient({ store });
		await expect(
			noEmbedClient.searchByText("test", { text: "hello", topK: 5 }),
		).rejects.toThrow(EmbedderNotConfiguredError);
	});

	it("upsertText embeds and upserts", async () => {
		await client.upsertText("test", {
			id: "1",
			text: "hello world",
			metadata: { source: "test" },
		});

		expect(embedder.embed).toHaveBeenCalledWith("hello world");
		expect(store.upsert).toHaveBeenCalledWith("test", [
			{
				id: "1",
				values: [0.1, 0.2, 0.3],
				metadata: { source: "test", _text: "hello world" },
			},
		]);
	});

	it("upsertTexts batch embeds and upserts", async () => {
		await client.upsertTexts("test", [
			{ id: "1", text: "hello" },
			{ id: "2", text: "world" },
		]);

		expect(embedder.embedBatch).toHaveBeenCalledWith(["hello", "world"]);
		expect(store.upsert).toHaveBeenCalledWith("test", [
			{ id: "1", values: [0.1, 0.2, 0.3], metadata: { _text: "hello" } },
			{ id: "2", values: [0.4, 0.5, 0.6], metadata: { _text: "world" } },
		]);
	});

	it("upsertTexts handles empty array", async () => {
		await client.upsertTexts("test", []);
		expect(embedder.embedBatch).not.toHaveBeenCalled();
	});

	// ── Batch Operations ──────────────────────────────────────────

	it("delegates batchUpsert with validation", async () => {
		const records = [{ id: "1", values: [0.1, 0.2, 0.3] }];
		await client.batchUpsert("test", records, { batchSize: 50 });
		expect(store.batchUpsert).toHaveBeenCalledWith("test", records, {
			batchSize: 50,
		});
	});

	it("delegates batchDelete", async () => {
		await client.batchDelete("test", ["1", "2"]);
		expect(store.batchDelete).toHaveBeenCalledWith("test", ["1", "2"], undefined);
	});
});
