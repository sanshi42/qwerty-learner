export const EXPLICIT_SPACE = '␣'

export const DEFAULT_CHAPTER_LENGTH = 20

export const CHAPTER_LENGTH = DEFAULT_CHAPTER_LENGTH

export const MIN_CHAPTER_LENGTH = 5

export const MAX_CHAPTER_LENGTH = 100

export const CHAPTER_LENGTH_OPTIONS = [10, 20, 30, 50]

export const normalizeChapterLength = (value: number) => {
  if (!Number.isFinite(value)) return DEFAULT_CHAPTER_LENGTH
  return Math.min(MAX_CHAPTER_LENGTH, Math.max(MIN_CHAPTER_LENGTH, Math.round(value)))
}

export const DISMISS_START_CARD_DATE_KEY = 'dismissStartCardDate'

export const DONATE_DATE = 'donateDate'

export const CONFETTI_DEFAULTS = {
  colors: ['#5D8C7B', '#F2D091', '#F2A679', '#D9695F', '#8C4646'],
  shapes: ['square'],
  ticks: 500,
} as confetti.Options

export const defaultFontSizeConfig = {
  foreignFont: 48,
  translateFont: 18,
}
