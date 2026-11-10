// The site's addresses, in one place and with no other import, so the home page can link to every bài
// without pulling the exercises (and the sim's page code) into its own bundle.

/** Sa hình hạng B has eleven bài. */
export const LESSON_COUNT = 11;

export const HOME_HREF = '/';

/** `?so=tu-dong` when the learner drives an automatic; the manual car is the address with nothing on it. */
const so = (automatic: boolean) => (automatic ? '?so=tu-dong' : '');

/** Bài 1 lives at `/thi/`, bài N at `/thi/N/` (the site is exported with trailing slashes). */
export function lessonHref(lesson: number, automatic = false): string {
  return `${lesson === 1 ? '/thi/' : `/thi/${lesson}/`}${so(automatic)}`;
}

export function lienHoanHref(automatic = false): string {
  return `/lien-hoan/${so(automatic)}`;
}
