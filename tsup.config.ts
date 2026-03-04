import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/pinecone/index": "src/adapters/pinecone/index.ts",
    "adapters/qdrant/index": "src/adapters/qdrant/index.ts",
    "adapters/chroma/index": "src/adapters/chroma/index.ts",
    "adapters/milvus/index": "src/adapters/milvus/index.ts",
    "adapters/pgvector/index": "src/adapters/pgvector/index.ts",
    "adapters/weaviate/index": "src/adapters/weaviate/index.ts",
    "embeddings/openai": "src/embeddings/openai.ts",
    "embeddings/cohere": "src/embeddings/cohere.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    "@pinecone-database/pinecone",
    "@qdrant/js-client-rest",
    "@zilliz/milvus2-sdk-node",
    "chromadb",
    "cohere-ai",
    "openai",
    "pg",
    "pgvector",
    "weaviate-client",
  ],
});
