import type { UploadMeta } from './upload-client';

/**
 * Files chosen but not yet on the server, kept in IndexedDB (§6.14) so a lost connection, a closed
 * tab or a dead battery never loses a photo: the uploader sends them the next time it opens online.
 */
export type PendingUpload = { id: number; file: File; meta: UploadMeta; fileId?: string };

const STORE = 'pending-uploads';

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('portal-uploads', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const queueAdd = (entry: Omit<PendingUpload, 'id'>) =>
  run('readwrite', (store) => store.add(entry)) as Promise<number>;

export const queueAll = () => run<PendingUpload[]>('readonly', (store) => store.getAll());

export const queueRemove = (id: number) => run('readwrite', (store) => store.delete(id));

/** Remembers the server-side file id, so a reload resumes the multipart upload instead of restarting. */
export const queueSetFileId = async (id: number, fileId: string) => {
  const entry = await run<PendingUpload | undefined>('readonly', (store) => store.get(id));
  if (entry) await run('readwrite', (store) => store.put({ ...entry, fileId }));
};
