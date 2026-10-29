import { z } from 'zod';

export const uuid = z.uuid();
export const timezone = z.string().max(80).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Invalid IANA timezone');
export const decimal = z.string().regex(/^-?(0|[1-9]\d{0,11})(\.\d{1,6})?$/, 'Use a decimal string with up to 6 fractional digits');
export const fieldSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), label: z.string().min(1).max(60),
  type: z.enum(['text', 'textarea', 'integer', 'decimal', 'date', 'boolean', 'single_select']),
  required: z.boolean(), unit: z.string().max(30).nullable().default(null),
  options: z.array(z.string().min(1).max(80)).max(30).default([]),
  minimum: z.number().finite().nullable().default(null), maximum: z.number().finite().nullable().default(null)
});
