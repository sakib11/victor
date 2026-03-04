import { describe, it, expect, vi } from "vitest";
import { chunk, processBatches } from "../../src/utils/batch.js";

describe("chunk", () => {
	it("splits array into chunks of given size", () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	it("handles array smaller than chunk size", () => {
		expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
	});

	it("handles exact multiple of chunk size", () => {
		expect(chunk([1, 2, 3, 4], 2)).toEqual([
			[1, 2],
			[3, 4],
		]);
	});

	it("handles empty array", () => {
		expect(chunk([], 5)).toEqual([]);
	});

	it("handles chunk size of 1", () => {
		expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
	});
});

describe("processBatches", () => {
	it("processes all items through handler", async () => {
		const items = [1, 2, 3, 4, 5];
		const processed: number[] = [];

		await processBatches(
			items,
			async (batch) => {
				processed.push(...batch);
			},
			{ batchSize: 2 },
		);

		expect(processed).toEqual([1, 2, 3, 4, 5]);
	});

	it("uses default batch size when not specified", async () => {
		const items = Array.from({ length: 250 }, (_, i) => i);
		const batchSizes: number[] = [];

		await processBatches(
			items,
			async (batch) => {
				batchSizes.push(batch.length);
			},
			undefined,
			100,
		);

		expect(batchSizes).toEqual([100, 100, 50]);
	});

	it("calls onBatchComplete with correct indices", async () => {
		const items = [1, 2, 3, 4, 5];
		const calls: [number, number][] = [];

		await processBatches(
			items,
			async () => {},
			{
				batchSize: 2,
				onBatchComplete: (index, total) => {
					calls.push([index, total]);
				},
			},
		);

		expect(calls).toEqual([
			[0, 3],
			[1, 3],
			[2, 3],
		]);
	});

	it("processes batches sequentially", async () => {
		const order: number[] = [];
		const items = [1, 2, 3, 4];

		await processBatches(
			items,
			async (batch) => {
				await new Promise((r) => setTimeout(r, 10));
				order.push(batch[0]!);
			},
			{ batchSize: 2 },
		);

		expect(order).toEqual([1, 3]);
	});
});
