import { query } from '../db.js';
import { gradeAttempt } from './scoring.js';

/** Savollar + to'g'ri javoblar + foydalanuvchi javobi + to'g'ri/noto'g'ri belgisi */
export async function buildReview(attempt) {
  const { rows: questions } = await query(
    `SELECT id, position, type, prompt, options, correct_answer, points
       FROM questions WHERE test_id = $1 ORDER BY position, id`,
    [attempt.test_id],
  );
  const graded = gradeAttempt(questions, attempt.answers);
  const byId = new Map(graded.perQuestion.map((p) => [p.id, p]));
  return questions.map((q) => ({
    ...q,
    your_answer: byId.get(q.id)?.answer ?? null,
    is_correct: byId.get(q.id)?.is_correct ?? null,
  }));
}
