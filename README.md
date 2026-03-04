# @victor/core

Unified wrapper around popular vector databases. One API, any backend.

Write your vector search code once and swap between **Pinecone**, **Qdrant**, **ChromaDB**, **Milvus**, **pgvector**, and **Weaviate** without changing a line of application logic.

## Features

- **Unified interface** — Single `VectorStore` contract implemented by every adapter
- **Adapter pattern** — Install only the database SDK you need (tree-shakeable, zero bundled clients)
- **Embedding helpers** — Built-in OpenAI and Cohere embedders with auto-embed workflows
- **Type-safe** — Written in TypeScript with strict types and full JSDoc documentation
- **Unified filter DSL** — MongoDB-style filters translated to each database's native format
- **Batch operations** — Built-in chunking with progress callbacks
- **Retry logic** — Configurable retry with exponential backoff for transient failures
- **Input validation** — Catches invalid dimensions, duplicate IDs, and malformed queries before they hit the database
- **Dual format** — Ships ESM + CJS builds

## Install

```bash
# Core package (always required)
npm install @victor/core

# Then install only the database SDK you need:
npm install @pinecone-database/pinecone    # Pinecone
npm install @qdrant/js-client-rest         # Qdrant
npm install chromadb                       # ChromaDB
npm install @zilliz/milvus2-sdk-node       # Milvus / Zilliz
npm install pg pgvector                    # pgvector (PostgreSQL)
npm install weaviate-client                # Weaviate

# Optional: embedding providers
npm install openai                         # OpenAI embeddings
npm install cohere-ai                      # Cohere embeddings
```

## Quick Start

```typescript
import { VictorClient } from "@victor/core";
import { PineconeAdapter } from "@victor/core/pinecone";

// 1. Create adapter + client
const client = new VictorClient({
  store: new PineconeAdapter({ apiKey: process.env.PINECONE_API_KEY }),
});

await client.connect();

// 2. Create a collection
await client.createCollection({
  name: "articles",
  dimension: 1536,
  metric: "cosine",
});

// 3. Upsert vectors
await client.upsert("articles", [
  {
    id: "article-1",
    values: [0.1, 0.2, /* ... 1536 dimensions */],
    metadata: { title: "Introduction to Vector Search", category: "tutorial" },
  },
]);

// 4. Search
const results = await client.search("articles", {
  vector: [0.15, 0.25, /* ... */],
  topK: 5,
  filter: { category: { $eq: "tutorial" } },
});

console.log(results);
// [{ id: "article-1", score: 0.95, metadata: { title: "...", category: "tutorial" } }]

await client.disconnect();
```

## Text-Based Workflow (Auto-Embedding)

Pair any adapter with an embedder to skip manual embedding entirely:

```typescript
import { VictorClient } from "@victor/core";
import { QdrantAdapter } from "@victor/core/qdrant";
import { OpenAIEmbedder } from "@victor/core/embeddings/openai";

const client = new VictorClient({
  store: new QdrantAdapter({ url: "http://localhost:6333" }),
  embedder: new OpenAIEmbedder({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-small",
  }),
});

await client.connect();

// Upsert text — automatically embedded
await client.upsertTexts("docs", [
  { id: "1", text: "Vector databases store embeddings for similarity search" },
  { id: "2", text: "PostgreSQL can be extended with pgvector for vector ops" },
]);

// Search by text — automatically embedded
const results = await client.searchByText("docs", {
  text: "How do vector databases work?",
  topK: 3,
});
```

## Adapter Configuration

### Pinecone

```typescript
import { PineconeAdapter } from "@victor/core/pinecone";

const adapter = new PineconeAdapter({
  apiKey: "your-api-key",     // or set PINECONE_API_KEY env var
  cloud: "aws",               // default cloud for new indexes
  region: "us-east-1",        // default region
  namespace: "production",    // optional namespace for data partitioning
});
```

### Qdrant

```typescript
import { QdrantAdapter } from "@victor/core/qdrant";

// Self-hosted
const adapter = new QdrantAdapter({
  url: "http://localhost:6333",
});

// Qdrant Cloud
const adapter = new QdrantAdapter({
  url: "https://your-cluster.qdrant.io",
  apiKey: "your-api-key",
});
```

### ChromaDB

```typescript
import { ChromaAdapter } from "@victor/core/chroma";

const adapter = new ChromaAdapter({
  path: "http://localhost:8000",   // Chroma server URL
});
```

### Milvus / Zilliz

```typescript
import { MilvusAdapter } from "@victor/core/milvus";

// Self-hosted Milvus
const adapter = new MilvusAdapter({
  address: "localhost:19530",
});

// Zilliz Cloud
const adapter = new MilvusAdapter({
  address: "your-endpoint.zillizcloud.com:443",
  token: "your-api-key",
  indexType: "HNSW",                             // default
  indexParams: { M: 16, efConstruction: 256 },   // HNSW build params
  searchParams: { ef: 64 },                      // HNSW search params
});
```

### pgvector (PostgreSQL)

```typescript
import { PgVectorAdapter } from "@victor/core/pgvector";

const adapter = new PgVectorAdapter({
  connectionString: "postgresql://user:pass@localhost:5432/mydb",
  tablePrefix: "victor",     // tables named victor_{collection}
  indexType: "hnsw",         // or "ivfflat"
  hnswParams: { m: 16, ef_construction: 64 },
});
```

### Weaviate

```typescript
import { WeaviateAdapter } from "@victor/core/weaviate";

// Local Docker
const adapter = new WeaviateAdapter({ scheme: "local" });

// Weaviate Cloud
const adapter = new WeaviateAdapter({
  scheme: "cloud",
  clusterUrl: "https://your-instance.weaviate.network",
  apiKey: "your-key",
});

// Custom deployment
const adapter = new WeaviateAdapter({
  scheme: "custom",
  httpHost: "weaviate.internal",
  httpPort: 8080,
  grpcHost: "weaviate.internal",
  grpcPort: 50051,
});
```

## API Reference

### VictorClient

| Method | Description |
|--------|-------------|
| `connect()` | Initialize database connection |
| `disconnect()` | Close connection and release resources |
| `createCollection(config)` | Create a new collection/index |
| `listCollections()` | List all collection names |
| `deleteCollection(name)` | Delete a collection and all its data |
| `describeCollection(name)` | Get collection info (dimension, count, metric) |
| `upsert(collection, records)` | Insert or update vectors |
| `get(collection, ids)` | Retrieve vectors by ID |
| `update(collection, id, data)` | Update a single vector's values/metadata |
| `delete(collection, ids)` | Delete vectors by ID |
| `search(collection, query)` | Similarity search with vector |
| `searchByText(collection, query)` | Similarity search with text (requires embedder) |
| `upsertText(collection, record)` | Embed and upsert a single text record |
| `upsertTexts(collection, records)` | Batch embed and upsert text records |
| `batchUpsert(collection, records, opts)` | Upsert in configurable batches |
| `batchDelete(collection, ids, opts)` | Delete in configurable batches |

### Unified Filter Syntax

MongoDB-style filters work across all adapters. Victor translates them to each database's native format automatically.

```typescript
// Equality (shorthand)
{ category: "tutorial" }

// Equality (explicit)
{ category: { $eq: "tutorial" } }

// Comparison
{ year: { $gte: 2020, $lt: 2025 } }

// Set membership
{ genre: { $in: ["drama", "comedy"] } }
{ genre: { $nin: ["horror"] } }

// Not equal
{ status: { $ne: "draft" } }

// Logical AND
{ $and: [{ category: "tutorial" }, { year: { $gte: 2020 } }] }

// Logical OR
{ $or: [{ category: "tutorial" }, { category: "guide" }] }
```

**Supported operators:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`

### Embedding Providers

```typescript
import { OpenAIEmbedder } from "@victor/core/embeddings/openai";
import { CohereEmbedder } from "@victor/core/embeddings/cohere";

// OpenAI
const openai = new OpenAIEmbedder({
  apiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-small",   // 1536 dims
  // model: "text-embedding-3-large", // 3072 dims
  // model: "text-embedding-ada-002", // 1536 dims
});

// Cohere
const cohere = new CohereEmbedder({
  apiKey: process.env.COHERE_API_KEY,
  model: "embed-english-v3.0",       // 1024 dims
  inputType: "search_document",       // or "search_query"
});
```

### Error Handling

All errors extend `VictorError` for easy catch-all handling:

```typescript
import {
  VictorError,
  ConnectionError,
  CollectionNotFoundError,
  CollectionAlreadyExistsError,
  VectorNotFoundError,
  ValidationError,
  AdapterError,
  EmbedderNotConfiguredError,
} from "@victor/core";

try {
  await client.search("nonexistent", { vector: [...], topK: 5 });
} catch (error) {
  if (error instanceof CollectionNotFoundError) {
    console.log(`Collection "${error.collection}" not found`);
  } else if (error instanceof VictorError) {
    console.log(`Victor error [${error.code}]: ${error.message}`);
  }
}
```

### Retry Utility

```typescript
import { withRetry } from "@victor/core";

const result = await withRetry(
  () => client.search("collection", { vector: [...], topK: 10 }),
  {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  },
);
```

## Switching Databases

The entire point of Victor — change one line to switch databases:

```typescript
// Before: Pinecone
import { PineconeAdapter } from "@victor/core/pinecone";
const store = new PineconeAdapter({ apiKey: "..." });

// After: Qdrant (everything else stays the same)
import { QdrantAdapter } from "@victor/core/qdrant";
const store = new QdrantAdapter({ url: "http://localhost:6333" });

// Your application code doesn't change:
const client = new VictorClient({ store });
await client.connect();
await client.upsert("collection", records);
const results = await client.search("collection", query);
```

## Architecture

```
@victor/core
├── VictorClient           # Main entry point (validation + embedding integration)
├── VectorStore            # Interface all adapters implement
├── Embedder               # Interface for embedding providers
├── adapters/
│   ├── PineconeAdapter    # @pinecone-database/pinecone
│   ├── QdrantAdapter      # @qdrant/js-client-rest
│   ├── ChromaAdapter      # chromadb
│   ├── MilvusAdapter      # @zilliz/milvus2-sdk-node
│   ├── PgVectorAdapter    # pg + pgvector
│   └── WeaviateAdapter    # weaviate-client
├── embeddings/
│   ├── OpenAIEmbedder     # openai
│   └── CohereEmbedder     # cohere-ai
└── utils/
    ├── validation          # Input validation
    ├── batch               # Chunking + progress callbacks
    └── retry               # Exponential backoff
```

## License

MIT
