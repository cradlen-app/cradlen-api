/**
 * Maps a gestational age to its pregnancy trimester (the episode `order` in the
 * PREGNANCY journey template: 1=First, 2=Second, 3=Third). Standard obstetric
 * boundaries by completed weeks: T1 < 14w, T2 14–27w, T3 >= 28w. A missing GA
 * returns null (the caller leaves the visit on its booked/first episode).
 */
import type { GestationalAge } from './ga.util';

export type TrimesterOrder = 1 | 2 | 3;

export function trimesterOrderForGa(
  ga: GestationalAge | null,
): TrimesterOrder | null {
  if (!ga) return null;
  if (ga.weeks < 14) return 1;
  if (ga.weeks < 28) return 2;
  return 3;
}
