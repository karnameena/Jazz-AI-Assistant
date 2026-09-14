export class MemoryStore {
  #items = [];

  add(item) {
    this.#items.push({ ...item, createdAt: item.createdAt ?? new Date().toISOString() });
  }

  list() {
    return [...this.#items];
  }

  search(term) {
    const q = String(term).toLowerCase();
    return this.#items.filter(item => JSON.stringify(item).toLowerCase().includes(q));
  }
}
