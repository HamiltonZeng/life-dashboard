// Browser-safe identifiers shared by export, download, and restore.
export const BACKUP_FORMAT = 'life-dashboard-user-export';
export const BACKUP_SCHEMA_VERSION = 3;
export const SUPPORTED_BACKUP_VERSIONS = [1, 2, BACKUP_SCHEMA_VERSION] as const;

export function supportsBackupVersion(version: unknown): version is (typeof SUPPORTED_BACKUP_VERSIONS)[number] {
  return SUPPORTED_BACKUP_VERSIONS.some(supported => supported === version);
}
