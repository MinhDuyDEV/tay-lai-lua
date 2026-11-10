// The catalogue the home page and the top bar navigate by: one row per bài, in exam order. The name is
// the exercise's own title (`exercise.ts`), so a renamed bài cannot drift here; only the one-line
// blurb, which says what the learner has to do in words a first-timer reads, lives in this file.
// Built on the server: the home page gets the rows as plain data (see `links.ts` for the addresses).

import { exerciseFor, type Lesson } from './exercise.ts';

export interface LessonCard {
  lesson: Lesson;
  /** The title without its "Bài N — " prefix. */
  name: string;
  /** One sentence: what the learner does in this bài. */
  blurb: string;
}

const BLURB: Record<Lesson, string> = {
  1: 'Nổ máy, thắt dây an toàn, bật xi nhan trái rồi đưa xe qua vạch xuất phát.',
  2: 'Dừng đúng vạch để nhường người đi bộ, rồi đi tiếp.',
  3: 'Dừng trước vạch trên dốc rồi khởi hành lại mà không để xe tụt dốc.',
  4: 'Giữ bánh xe trong vệt và qua đường vòng vuông góc mà không đè vạch.',
  5: 'Dừng đúng vạch khi đèn đỏ, chờ đèn xanh, bật xi nhan rồi rẽ qua ngã tư.',
  6: 'Lái qua đường vòng chữ S mà không để bánh xe đè vạch.',
  7: 'Lùi xe vào ô đỗ dọc cho thân xe nằm trọn trong ô.',
  8: 'Lùi xe vào ô đỗ ngang (đỗ song song) cho thân xe nằm trọn trong ô.',
  9: 'Tạm dừng đúng vạch trước đường sắt, rồi đi tiếp.',
  10: 'Lên số và tăng tốc, rồi về số và giảm tốc đúng chỗ các biển báo.',
  11: 'Bật xi nhan phải, qua vạch kết thúc rồi dừng xe.',
};

const ALL: readonly Lesson[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export const LESSONS: readonly LessonCard[] = ALL.map((lesson) => ({
  lesson,
  name: exerciseFor(lesson, false).title.replace(/^Bài \d+ — /, ''),
  blurb: BLURB[lesson],
}));
