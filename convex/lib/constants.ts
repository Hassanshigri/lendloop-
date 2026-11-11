// Shared with the browser bundle, so this file must not import server code.
export const CATEGORIES = [
  "power tools",
  "hand tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];
