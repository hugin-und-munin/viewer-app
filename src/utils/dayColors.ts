// Weekday-indexed color scheme (0 = Sonntag … 6 = Samstag), shared across
// modules that visually tag content by day of week (Routine, Time).

export const DAY_NAMES = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
]

export const DAY_COLORS: Record<number, string> = {
  1: '#2196F3', // Montag     – Blau
  2: '#F44336', // Dienstag   – Rot
  3: '#F5C518', // Mittwoch   – Gelb
  4: '#FF9800', // Donnerstag – Orange
  5: '#4CAF50', // Freitag    – Grün
  6: '#9C27B0', // Samstag    – Lila
  0: '#BDBDBD', // Sonntag    – Grau
}

export const DAY_OUTLINE_WIDTH = '10px'

// Contrast-checked variants (>=3:1 against white) for use as borders/outlines.
export const DAY_OUTLINE_COLORS: Record<number, string> = {
  1: '#2196F3', // Montag     – Blau   (3.12:1)
  2: '#E53935', // Dienstag   – Rot    (4.23:1)
  3: '#bd8d00', // Mittwoch   – Gelb   (3.01:1)
  4: '#e17a00', // Donnerstag – Orange (3.01:1)
  5: '#44a748', // Freitag    – Grün   (3.06:1)
  6: '#9C27B0', // Samstag    – Lila   (6.30:1)
  0: '#757575', // Sonntag    – Grau   (4.61:1)
}
