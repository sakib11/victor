import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../src/utils/retry.js";

describe("withRetry", () => {
	it("returns result on first success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn, { maxRetries: 3 });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on retryable errors", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("timeout"))
			.mockRejectedValueOnce(new Error("timeout"))
			.mockResolvedValue("ok");

		const result = await withRetry(fn, {
			maxRetries: 3,
			initialDelayMs: 1,
			maxDelayMs: 10,
		});

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("throws immediately for non-retryable errors", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("invalid input"));

		await expect(
			withRetry(fn, { maxRetries: 3, initialDelayMs: 1 }),
		).rejects.toThrow("invalid input");

		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("throws after exhausting retries", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("timeout"));

		await expect(
			withRetry(fn, { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5 }),
		).rejects.toThrow("timeout");

		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it("uses custom isRetryable function", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("custom-retry"))
			.mockResolvedValue("ok");

		const result = await withRetry(fn, {
			maxRetries: 3,
			initialDelayMs: 1,
			isRetryable: (err) =>
				err instanceof Error && err.message === "custom-retry",
		});

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retries on rate limit errors", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("429 Too Many Requests"))
			.mockResolvedValue("ok");

		const result = await withRetry(fn, {
			maxRetries: 3,
			initialDelayMs: 1,
		});

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
