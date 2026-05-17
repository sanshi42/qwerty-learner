import { normalizeAnswer } from './vocabularyHelpers'
import type { VocabularyWord } from './vocabularyHelpers'
import shuffle from '@/utils/shuffle'

export type LocalQuizMode = 'spelling' | 'meaning'

export type LocalQuizQuestion = {
  id: string
  word: VocabularyWord
  mode: LocalQuizMode
  prompt: string
  options?: string[]
}

export type QuizAnswerResult = {
  isCorrect: boolean
  expectedAnswer: string
}

export const buildLocalQuiz = (words: VocabularyWord[], mode: LocalQuizMode): LocalQuizQuestion[] => {
  const shuffledWords = shuffle(words)

  return shuffledWords.map((word, index) => {
    if (mode === 'spelling') {
      return {
        id: `${mode}-${word.name}-${index}`,
        word,
        mode,
        prompt: word.trans.join('；'),
      }
    }

    const otherOptions = shuffle(words.filter((item) => item.name !== word.name).map((item) => item.trans.join('；'))).slice(0, 3)
    const options = shuffle([word.trans.join('；'), ...otherOptions])

    return {
      id: `${mode}-${word.name}-${index}`,
      word,
      mode,
      prompt: word.name,
      options,
    }
  })
}

export const checkLocalQuizAnswer = (question: LocalQuizQuestion, answer: string): QuizAnswerResult => {
  if (question.mode === 'spelling') {
    return {
      isCorrect: normalizeAnswer(answer) === normalizeAnswer(question.word.name),
      expectedAnswer: question.word.name,
    }
  }

  const expectedAnswer = question.word.trans.join('；')
  return {
    isCorrect: answer === expectedAnswer,
    expectedAnswer,
  }
}

export const checkAcceptedAnswer = (answer: string, acceptedAnswers: string[]) => {
  const normalizedAnswer = normalizeAnswer(answer)
  return acceptedAnswers.some((acceptedAnswer) => normalizeAnswer(acceptedAnswer) === normalizedAnswer)
}
