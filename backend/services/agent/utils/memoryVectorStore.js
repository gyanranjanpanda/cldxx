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

/**
 * Ranks one entry against another exactly as sorting the whole array would.
 *
 * Score decides it; equal scores fall back to arrival order. That second rule
 * is not cosmetic. Chunks tie constantly -- every chunk orthogonal to the
 * query scores 0 -- and without it the entry evicted to make room could be an
 * earlier chunk that a full sort would have kept, so the heap would return a
 * different set of passages, not merely a different order.
 */
const worse = (a, b) =>
  a.score < b.score || (a.score === b.score && a.index > b.index);

/**
 * The k best-scoring items seen so far, held as a binary heap.
 *
 * A search wants the top handful of chunks, not a ranking of every chunk, and
 * sorting the whole array to discard all but five of them is work nobody
 * reads. The heap holds only k entries with the weakest of them at the root,
 * so a new candidate is accepted or rejected in a single comparison and
 * admitting it costs O(log k) -- about two levels for k=5, against the
 * thirteen a full sort of ten thousand chunks walks.
 */
class TopK {

  constructor(k) {
    this.k = k;
    // Heap-ordered worst-first, so items[0] is the entry to evict next.
    this.items = [];
  }

  offer(item) {

    if (this.items.length < this.k) {
      this.items.push(item);
      this.#siftUp(this.items.length - 1);
      return;
    }

    // Strictly greater, because a newcomer always arrives later: on an equal
    // score it loses the tiebreak and the chunk already held stays.
    if (item.score > this.items[0].score) {
      this.items[0] = item;
      this.#siftDown(0);
    }

  }

  /** The kept items, best first. O(k log k) on a list at most k long. */
  drain() {
    return [...this.items].sort((a, b) => (worse(a, b) ? 1 : -1));
  }

  #swap(i, j) {
    const held = this.items[i];
    this.items[i] = this.items[j];
    this.items[j] = held;
  }

  #siftUp(index) {

    while (index > 0) {

      const parent = (index - 1) >> 1;

      if (!worse(this.items[index], this.items[parent])) break;

      this.#swap(parent, index);

      index = parent;

    }

  }

  #siftDown(index) {

    const size = this.items.length;

    for (;;) {

      const left  = index * 2 + 1;
      const right = left + 1;

      let weakest = index;

      if (left  < size && worse(this.items[left],  this.items[weakest])) weakest = left;
      if (right < size && worse(this.items[right], this.items[weakest])) weakest = right;

      if (weakest === index) break;

      this.#swap(weakest, index);

      index = weakest;

    }

  }

}

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

    if (k <= 0) return [];

    const queryVector = await this.embeddings.embedQuery(query);

    // Hoisted out of the loop: the query's own magnitude is the same for every
    // comparison, and computing it inside cosine() meant a second full pass
    // over the query vector once per chunk.
    const queryMagnitude = magnitude(queryVector);

    const top = new TopK(k);

    for (let i = 0; i < this.vectors.length; i++) {

      const vector = this.vectors[i];
      const scale  = queryMagnitude * magnitude(vector);

      top.offer({
        doc:   this.docs[i],
        index: i,
        // A zero-length vector has no direction to compare, so it scores 0
        // rather than dividing by zero.
        score: scale ? dot(queryVector, vector) / scale : 0
      });

    }

    return top.drain().map((x) => x.doc);

  }
}
