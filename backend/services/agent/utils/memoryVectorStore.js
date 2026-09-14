// A single uploaded PDF is embedded, queried once and thrown away. That does
// not need a hosted vector database -- and depending on one means the feature
// breaks whenever the cluster is suspended. This keeps the vectors in the
// process for the life of one request.

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const magnitude = (a) => Math.sqrt(dot(a, a));

const cosine = (a, b) => {
  const m = magnitude(a) * magnitude(b);
  return m ? dot(a, b) / m : 0;
};

export class MemoryVectorStore {
  constructor(docs, vectors, embeddings) {
    this.docs = docs;
    this.vectors = vectors;
    this.embeddings = embeddings;
  }

  static async fromDocuments(docs, embeddings) {
    const vectors = await embeddings.embedDocuments(
      docs.map((d) => d.pageContent)
    );
    return new MemoryVectorStore(docs, vectors, embeddings);
  }

  async similaritySearch(query, k = 5) {
    const queryVector = await this.embeddings.embedQuery(query);

    return this.vectors
      .map((v, i) => ({ doc: this.docs[i], score: cosine(queryVector, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.doc);
  }
}
