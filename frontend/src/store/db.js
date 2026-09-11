const DB_NAME = 'bluepencil'
// 加了 questions 表，版本号必须递增，否则老用户的库不会升级
const DB_VERSION = 2

export const STORES = {
  articles: 'articles',
  questions: 'questions',
  records: 'records',
  notes: 'notes',
  mistakes: 'mistakes',
}

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(store, mode) {
  return open().then((db) => db.transaction(store, mode).objectStore(store))
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function put(store, value) {
  const s = await tx(store, 'readwrite')
  return wrap(s.put(value))
}

export async function putMany(store, values) {
  const s = await tx(store, 'readwrite')
  await Promise.all(values.map((v) => wrap(s.put(v))))
  return values.length
}

export async function getAll(store) {
  const s = await tx(store, 'readonly')
  const list = await wrap(s.getAll())
  return list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
}

export async function remove(store, id) {
  const s = await tx(store, 'readwrite')
  return wrap(s.delete(id))
}

export async function clear(store) {
  const s = await tx(store, 'readwrite')
  return wrap(s.clear())
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function exportAll() {
  const out = {}
  for (const name of Object.values(STORES)) {
    out[name] = await getAll(name)
  }
  return { exportedAt: Date.now(), data: out }
}

export async function importAll(snapshot) {
  const data = snapshot?.data || {}
  let count = 0
  for (const name of Object.values(STORES)) {
    if (!Array.isArray(data[name])) continue
    await putMany(name, data[name])
    count += data[name].length
  }
  return count
}
