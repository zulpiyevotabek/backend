// Ballarni hisoblash va IELTS band (0–9) ga o'tkazish.

// Academic Reading/Listening uchun taxminiy 40 savollik jadval: [minimal raw, band]
const BAND_TABLE_40 = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5],
  [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0],
];

/** raw/max ni 40 ga moslab, band qaytaradi. Savollar soni 40 bo'lmasa ham ishlaydi. */
export function rawToBand(raw, max) {
  if (!max) return null;
  const scaled = Math.round((raw / max) * 40);
  for (const [min, band] of BAND_TABLE_40) {
    if (scaled >= min) return band;
  }
  return 0;
}

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Bitta savolga berilgan javob to'g'rimi? (essay uchun doim false — qo'lda baholanadi) */
export function isCorrect(question, given) {
  const { type, correct_answer: correct } = question;
  if (type === 'essay' || correct === null || correct === undefined) return false;
  if (given === null || given === undefined || given === '') return false;

  if (type === 'multi') {
    const want = (Array.isArray(correct) ? correct : [correct]).map(norm).sort();
    const got = (Array.isArray(given) ? given : [given]).map(norm).sort();
    return want.length === got.length && want.every((v, i) => v === got[i]);
  }

  if (Array.isArray(given)) return false;
  const accepted = Array.isArray(correct) ? correct : [correct];
  const g = norm(given);
  return accepted.some((a) => norm(a) === g);
}

/**
 * Javoblarni baholaydi.
 * @returns {{ rawScore, maxScore, band, needsManualGrading, perQuestion }}
 */
export function gradeAttempt(questions, answers) {
  let rawScore = 0;
  let maxScore = 0;
  let needsManualGrading = false;
  const perQuestion = [];

  for (const q of questions) {
    const given = answers?.[String(q.id)] ?? null;
    if (q.type === 'essay') {
      needsManualGrading = true;
      perQuestion.push({ id: q.id, answer: given, is_correct: null });
      continue;
    }
    maxScore += q.points;
    const ok = isCorrect(q, given);
    if (ok) rawScore += q.points;
    perQuestion.push({ id: q.id, answer: given, is_correct: ok });
  }

  const band = needsManualGrading ? null : rawToBand(rawScore, maxScore);
  return { rawScore, maxScore, band, needsManualGrading, perQuestion };
}
