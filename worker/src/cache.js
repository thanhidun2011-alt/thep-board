// Cache trong bộ nhớ của isolate Worker (mất khi isolate bị thu hồi, đủ để giảm request ra ngoài).
// Nếu nguồn lỗi mà còn bản cũ thì trả bản cũ: web vẫn hiện số liệu gần nhất thay vì báo lỗi.
const store = new Map();
const inflight = new Map();
const MAX_ENTRIES = 500;

export function cached(name, ttlSec, fn) {
  return async (...args) => {
    const key = name + ":" + JSON.stringify(args);
    const hit = store.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = fn(...args)
      .then((value) => {
        if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
        store.set(key, { exp: Date.now() + ttlSec * 1000, value });
        return value;
      })
      .catch((err) => {
        if (hit) return hit.value;
        throw err;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
