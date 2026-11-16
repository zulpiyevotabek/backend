import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** zod sxemasi bo'yicha tekshirib, tozalangan qiymatni qaytaradi yoki 400 beradi */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    throw new HttpError(400, 'Ma\'lumotlar noto\'g\'ri', details);
  }
  return result.data;
}

export function paging(q, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function idParam(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'ID noto\'g\'ri');
  return id;
}

/** LIKE uchun maxsus belgilarni escape qilish */
export const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export { z };
