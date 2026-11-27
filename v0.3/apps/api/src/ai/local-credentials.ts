import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '../../../../packages/domain/src/index.js';

export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';
const format = Buffer.from('life-dashboard/deepseek/v1');

export function isLoopbackOrigin(origin: string): boolean {
  const url = new URL(origin);
  return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function readPrivateFile(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 4096) throw storageError();
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function storageError() {
  return new DomainError('CREDENTIAL_STORAGE_ERROR', '无法读取或写入本机密钥库。请检查服务器配置。', 503);
}

export class LocalDeepSeekCredentials {
  constructor(private readonly masterKeyFile: string, private readonly storeDir: string) {}

  private get path() { return join(this.storeDir, 'deepseek-v1.enc'); }

  private readMasterKey(): Buffer {
    try {
      const key = readPrivateFile(this.masterKeyFile);
      if (key.length !== 32) throw storageError();
      return key;
    } catch {
      throw storageError();
    }
  }

  read(): string | undefined {
    let sealed: Buffer;
    try {
      sealed = readPrivateFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw storageError();
    }
    const key = this.readMasterKey();
    try {
      const iv = sealed.subarray(0, 12);
      const tag = sealed.subarray(12, 28);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(format);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw storageError();
    } finally {
      key.fill(0);
    }
  }

  save(apiKey: string): void {
    const key = this.readMasterKey();
    const tempPath = join(this.storeDir, '.credential-' + randomUUID());
    try {
      mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(format);
      const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
      const sealed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
      writeFileSync(tempPath, sealed, { mode: 0o600, flag: 'wx', flush: true });
      renameSync(tempPath, this.path);
    } catch {
      try { unlinkSync(tempPath); } catch { /* file may not have been created */ }
      throw storageError();
    } finally {
      key.fill(0);
    }
  }

  remove(): void {
    try {
      unlinkSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw storageError();
    }
  }
}
