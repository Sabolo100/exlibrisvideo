/**
 * Typed browser client for the HTTP API (SPEC §3). Contract file – UI code calls the
 * API only through these helpers. Throws ApiClientError on non-2xx.
 */
import type {
  ApiError,
  BookDTO,
  BookPatch,
  CollectionDTO,
  CollectionPatch,
  CollectionStatusDTO,
  CollectionWithBooksDTO,
  CreateCollectionResponse,
  ExportFormat,
  FrameDTO,
  InitUploadResponse,
  Locale,
  VideoDTO,
  BBox,
} from '@/lib/types';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  let body = init?.body;
  if (init?.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiClientError(err.error ?? res.statusText, res.status, err.code ?? 'internal', err.details);
  }
  return data as T;
}

const enc = encodeURIComponent;

export interface UploadFailureReport {
  /** UploadItem.errorCode */
  code: string;
  /** "Name: message" of the underlying failure */
  detail?: string;
  videoId?: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  bytesSent: number;
  /** false when the browser reported no modification time for the picked file */
  lastModifiedKnown: boolean;
}

export const api = {
  createCollection: (body: { title?: string; email?: string; ownerName?: string; locale: Locale }) =>
    request<CreateCollectionResponse>('/api/collections', { method: 'POST', json: body }),

  getCollection: (id: string) => request<CollectionWithBooksDTO>(`/api/collections/${enc(id)}`),

  updateCollection: (id: string, patch: CollectionPatch) =>
    request<CollectionDTO>(`/api/collections/${enc(id)}`, { method: 'PATCH', json: patch }),

  deleteCollection: (id: string) => request<void>(`/api/collections/${enc(id)}`, { method: 'DELETE' }),

  claim: (id: string, body: { token: string } | { recovery: string }) =>
    request<{ ok: true }>(`/api/collections/${enc(id)}/claim`, { method: 'POST', json: body }),

  unlock: (id: string, pin: string) =>
    request<{ ok: true }>(`/api/collections/${enc(id)}/unlock`, { method: 'POST', json: { pin } }),

  getStatus: (id: string) => request<CollectionStatusDTO>(`/api/collections/${enc(id)}/status`),

  initUpload: (collectionId: string, body: { filename: string; size: number; mimeType: string }) =>
    request<InitUploadResponse>(`/api/collections/${enc(collectionId)}/uploads`, { method: 'POST', json: body }),

  getUpload: (videoId: string) =>
    request<{ bytesReceived: number; sizeBytes: number; uploadStatus: string }>(`/api/uploads/${enc(videoId)}`),

  /** Sends one chunk; on 409 the error details carry { bytesReceived } to resume from. */
  putChunk: (videoId: string, offset: number, chunk: Blob, signal?: AbortSignal) =>
    request<{ bytesReceived: number }>(`/api/uploads/${enc(videoId)}?offset=${offset}`, {
      method: 'PUT',
      body: chunk,
      headers: { 'Content-Type': 'application/octet-stream' },
      signal,
    }),

  completeUpload: (videoId: string) =>
    request<{ video: VideoDTO }>(`/api/uploads/${enc(videoId)}/complete`, { method: 'POST' }),

  deleteUpload: (videoId: string) => request<void>(`/api/uploads/${enc(videoId)}`, { method: 'DELETE' }),

  /** Diagnostics of an upload that failed on this device – written to the server log, nothing else. */
  reportUploadFailure: (report: UploadFailureReport) =>
    request<void>('/api/client-log', { method: 'POST', json: { kind: 'upload_failed', ...report }, keepalive: true }),

  addBook: (collectionId: string, body: BookPatch & { title: string }) =>
    request<BookDTO>(`/api/collections/${enc(collectionId)}/books`, { method: 'POST', json: body }),

  updateBook: (bookId: string, patch: BookPatch) =>
    request<BookDTO>(`/api/books/${enc(bookId)}`, { method: 'PATCH', json: patch }),

  deleteBook: (bookId: string) => request<void>(`/api/books/${enc(bookId)}`, { method: 'DELETE' }),

  mergeBooks: (collectionId: string, keepId: string, mergeIds: string[]) =>
    request<BookDTO>(`/api/collections/${enc(collectionId)}/books/merge`, { method: 'POST', json: { keepId, mergeIds } }),

  getFrames: (collectionId: string) =>
    request<{ frames: FrameDTO[]; detections: { frameId: string; bookId: string | null; bbox: BBox | null }[] }>(
      `/api/collections/${enc(collectionId)}/frames`,
    ),

  exportUrl: (collectionId: string, format: ExportFormat, locale: Locale) =>
    `/api/collections/${enc(collectionId)}/export?format=${format}&lang=${locale}`,

  emailExport: (collectionId: string, body: { email?: string; formats?: ExportFormat[] }) =>
    request<{ queued: true }>(`/api/collections/${enc(collectionId)}/email`, { method: 'POST', json: body }),

  recover: (email: string) => request<{ ok: true }>('/api/recover', { method: 'POST', json: { email } }),
};
