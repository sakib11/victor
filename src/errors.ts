/**
 * Base error class for all Victor errors.
 * All custom errors extend this so consumers can catch `VictorError`
 * to handle any Victor-specific error.
 */
export class VictorError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "VictorError";
	}
}

/**
 * Thrown when a connection to the vector database fails.
 */
export class ConnectionError extends VictorError {
	constructor(adapter: string, cause?: unknown) {
		super(
			`Failed to connect to ${adapter}. Check your credentials and network.`,
			"CONNECTION_ERROR",
			cause,
		);
		this.name = "ConnectionError";
	}
}

/**
 * Thrown when an operation references a collection that does not exist.
 */
export class CollectionNotFoundError extends VictorError {
	constructor(
		public readonly collection: string,
		cause?: unknown,
	) {
		super(`Collection "${collection}" not found.`, "COLLECTION_NOT_FOUND", cause);
		this.name = "CollectionNotFoundError";
	}
}

/**
 * Thrown when trying to create a collection that already exists.
 */
export class CollectionAlreadyExistsError extends VictorError {
	constructor(
		public readonly collection: string,
		cause?: unknown,
	) {
		super(`Collection "${collection}" already exists.`, "COLLECTION_ALREADY_EXISTS", cause);
		this.name = "CollectionAlreadyExistsError";
	}
}

/**
 * Thrown when an operation references a vector ID that does not exist.
 */
export class VectorNotFoundError extends VictorError {
	constructor(
		public readonly vectorId: string,
		public readonly collection: string,
		cause?: unknown,
	) {
		super(
			`Vector "${vectorId}" not found in collection "${collection}".`,
			"VECTOR_NOT_FOUND",
			cause,
		);
		this.name = "VectorNotFoundError";
	}
}

/**
 * Thrown when input validation fails (wrong dimension, missing fields, etc.).
 */
export class ValidationError extends VictorError {
	constructor(message: string, cause?: unknown) {
		super(message, "VALIDATION_ERROR", cause);
		this.name = "ValidationError";
	}
}

/**
 * Wraps errors from the underlying database SDK with additional context.
 */
export class AdapterError extends VictorError {
	constructor(
		public readonly adapter: string,
		public readonly operation: string,
		cause?: unknown,
	) {
		const causeMessage = cause instanceof Error ? cause.message : String(cause);
		super(
			`[${adapter}] ${operation} failed: ${causeMessage}`,
			"ADAPTER_ERROR",
			cause,
		);
		this.name = "AdapterError";
	}
}

/**
 * Thrown when an embedder is required but not configured.
 */
export class EmbedderNotConfiguredError extends VictorError {
	constructor() {
		super(
			"No embedder configured. Pass an embedder to VictorClient to use text-based operations.",
			"EMBEDDER_NOT_CONFIGURED",
		);
		this.name = "EmbedderNotConfiguredError";
	}
}
