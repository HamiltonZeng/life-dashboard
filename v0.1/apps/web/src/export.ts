/// <reference lib="dom" />
/**
 * S1 minimal user-data export helpers.
 *
 * The web UI only *downloads* the server export envelope returned by
 * `GET /api/v1/export`; it never restores data and never touches credentials.
 * The downloaded file is the exact JSON object the CLI restore command expects
 * (`format`, `schema_version`, `checksum`, `migrations` + whitelisted tables),
 * so it cannot drift into a lossy "pretty summary" format.
 */
import type { UserExportPayload } from './types.js';

const EXPORT_FORMAT = 'life-dashboard-user-export';
const EXPORT_SCHEMA_VERSION = 1;

export class ExportPayloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExportPayloadError';
    this.code = code;
  }
}

/**
 * Resolves the `<YYYY-MM-DD>` part of the export filename in the *user's*
 * timezone, so a late-evening export does not get yesterday's date.
 * Falls back to the UTC calendar date when the timestamp/timezone is invalid.
 */
export function formatExportDate(exportedAt: string, timezone?: string | null): string {
  const parsed = new Date(exportedAt);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const zone = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(parsed);
    const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    const year = pick('year');
    const month = pick('month');
    const day = pick('day');
    if (/^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day)) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Invalid IANA timezone -> fall through to the UTC date.
  }
  return parsed.toISOString().slice(0, 10);
}

export function buildExportFilename(exportedAt: string, timezone?: string | null): string {
  return `life-dashboard-${formatExportDate(exportedAt, timezone)}.json`;
}

/**
 * Validates the minimum shape the restore CLI requires before we hand data to
 * the user. Deliberately shallow: the server owns full checksum validation.
 */
export function assertUserExportPayload(value: unknown): UserExportPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExportPayloadError('INVALID_EXPORT', '服务器返回的导出数据不是 JSON 对象');
  }
  const candidate = value as Partial<UserExportPayload>;
  if (candidate.format !== EXPORT_FORMAT) {
    throw new ExportPayloadError(
      'INVALID_EXPORT_FORMAT',
      `导出数据格式不匹配（期望 ${EXPORT_FORMAT}，实际 ${String(candidate.format)}）`
    );
  }
  if (candidate.schema_version !== EXPORT_SCHEMA_VERSION) {
    throw new ExportPayloadError(
      'UNSUPPORTED_EXPORT_VERSION',
      `不支持的导出数据版本 ${String(candidate.schema_version)}（当前支持 ${EXPORT_SCHEMA_VERSION}）`
    );
  }
  if (typeof candidate.exported_at !== 'string' || Number.isNaN(new Date(candidate.exported_at).getTime())) {
    throw new ExportPayloadError('INVALID_EXPORT', '导出数据缺少有效的 exported_at 时间戳');
  }
  if (typeof candidate.checksum !== 'string' || candidate.checksum.length === 0) {
    throw new ExportPayloadError('INVALID_EXPORT', '导出数据缺少服务端校验和 (checksum)');
  }
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isPlainObject(candidate.counts) || !isPlainObject(candidate.data)) {
    throw new ExportPayloadError('INVALID_EXPORT', '导出数据缺少 counts 或 data 表集合');
  }
  return value as UserExportPayload;
}

/**
 * Serializes the complete export envelope exactly as the CLI restore expects.
 * The returned text never contains the local login secret / session cookie.
 */
export function serializeUserExport(payload: UserExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function summarizeUserExport(payload: UserExportPayload): {
  table_count: number;
  row_count: number;
} {
  const entries = Object.values(payload.counts ?? {});
  return {
    table_count: entries.length,
    row_count: entries.reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0)
  };
}
