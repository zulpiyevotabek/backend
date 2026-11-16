// Namuna testlar: `npm run seed`. Bir xil nomli test bo'lsa qayta qo'shilmaydi.
import { migrate, pool, query } from './db.js';

const samples = [
  {
    title: 'Reading — Namuna 1 (Urban Gardens)',
    section: 'reading',
    description: 'Namuna test: 6 ta savol',
    duration_minutes: 20,
    is_published: true,
    content: {
      passage:
        'Urban gardening has grown rapidly over the past decade. Cities such as Singapore and Detroit have turned unused rooftops and empty lots into productive farms. Supporters argue that these gardens reduce food miles, cool buildings and build community. Critics point out that yields are small compared with rural farms and that soil contamination can be a problem.',
    },
    questions: [
      { type: 'tfng', prompt: 'Urban gardening has become more popular in the last ten years.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], correct_answer: 'TRUE' },
      { type: 'tfng', prompt: 'Urban gardens produce more food than rural farms.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], correct_answer: 'FALSE' },
      { type: 'tfng', prompt: 'Tokyo has the largest number of rooftop farms.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], correct_answer: 'NOT GIVEN' },
      { type: 'mcq', prompt: 'Which city is mentioned as having turned empty lots into farms?', options: ['A. Paris', 'B. Detroit', 'C. Cairo', 'D. Sydney'], correct_answer: 'B' },
      { type: 'fill', prompt: 'Supporters say urban gardens reduce food ______.', correct_answer: ['miles', 'food miles'] },
      { type: 'multi', prompt: 'Choose TWO problems mentioned by critics.', options: ['A. Small yields', 'B. High water prices', 'C. Soil contamination', 'D. Noise'], correct_answer: ['A', 'C'] },
    ],
  },
  {
    title: 'Writing — Task 2 Namuna',
    section: 'writing',
    description: 'Essay: kamida 250 so\'z. Admin qo\'lda baholaydi.',
    duration_minutes: 40,
    is_published: true,
    content: {},
    questions: [
      {
        type: 'essay',
        prompt:
          'Some people think that universities should focus on practical skills for jobs, while others believe they should teach theoretical knowledge. Discuss both views and give your own opinion. (Write at least 250 words)',
        points: 0,
      },
    ],
  },
];

async function main() {
  await migrate();
  for (const t of samples) {
    const exists = await query('SELECT 1 FROM tests WHERE title = $1', [t.title]);
    if (exists.rowCount) {
      console.log(`- mavjud: ${t.title}`);
      continue;
    }
    const { rows } = await query(
      `INSERT INTO tests (title, section, description, duration_minutes, content, is_published)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [t.title, t.section, t.description, t.duration_minutes, JSON.stringify(t.content), t.is_published],
    );
    let pos = 0;
    for (const q of t.questions) {
      await query(
        `INSERT INTO questions (test_id, position, type, prompt, options, correct_answer, points)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
        [
          rows[0].id,
          ++pos,
          q.type,
          q.prompt,
          q.options ? JSON.stringify(q.options) : null,
          q.correct_answer !== undefined ? JSON.stringify(q.correct_answer) : null,
          q.points ?? 1,
        ],
      );
    }
    console.log(`+ qo'shildi: ${t.title}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
