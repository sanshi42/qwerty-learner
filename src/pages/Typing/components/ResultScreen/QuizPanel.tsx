import AiProviderConfigDialog from './AiProviderConfigDialog'
import {
  aiQuizResponseFormat,
  buildAiQuizMessages,
  getAiCacheKey,
  getCachedText,
  parseAndValidateAiQuiz,
  setCachedText,
  streamChatCompletion,
} from './aiHelpers'
import type { AiQuizQuestion } from './aiHelpers'
import { buildLocalQuiz, checkAcceptedAnswer, checkLocalQuizAnswer } from './quizHelpers'
import type { LocalQuizMode, LocalQuizQuestion, QuizAnswerResult } from './quizHelpers'
import type { VocabularyWord } from './vocabularyHelpers'
import { aiProviderConfigAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import IconSettings from '~icons/tabler/settings'

type QuizPanelProps = {
  words: VocabularyWord[]
  dictId: string
  chapter: number
}

type LocalQuizResult = QuizAnswerResult & {
  question: LocalQuizQuestion
  answer: string
}

type AiQuizResult = {
  question: AiQuizQuestion
  answer: string
  isCorrect: boolean
}

const normalizeAiQuestions = (questions: AiQuizQuestion[]) => {
  return questions.map((question, index) => ({
    ...question,
    id: question.id || `${question.word}-${index}`,
    options: question.options || [],
    acceptedAnswers: Array.from(new Set([question.answer, question.word, ...question.acceptedAnswers].filter(Boolean))),
  }))
}

export default function QuizPanel({ words, dictId, chapter }: QuizPanelProps) {
  const aiConfig = useAtomValue(aiProviderConfigAtom)
  const [quizMode, setQuizMode] = useState<'local' | 'ai'>('local')
  const [localMode, setLocalMode] = useState<LocalQuizMode>('spelling')
  const [localQuestions, setLocalQuestions] = useState<LocalQuizQuestion[]>([])
  const [localIndex, setLocalIndex] = useState(0)
  const [localAnswer, setLocalAnswer] = useState('')
  const [localCurrentResult, setLocalCurrentResult] = useState<LocalQuizResult>()
  const [localResults, setLocalResults] = useState<LocalQuizResult[]>([])

  const [aiQuestions, setAiQuestions] = useState<AiQuizQuestion[]>([])
  const [aiIndex, setAiIndex] = useState(0)
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiCurrentResult, setAiCurrentResult] = useState<AiQuizResult>()
  const [aiResults, setAiResults] = useState<AiQuizResult[]>([])
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [aiMessage, setAiMessage] = useState('')
  const [aiRawText, setAiRawText] = useState('')
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const abortControllerRef = useRef<AbortController>()

  const aiCacheKey = useMemo(() => getAiCacheKey('quiz', dictId, chapter, words, aiConfig), [aiConfig, chapter, dictId, words])
  const localQuestion = localQuestions[localIndex]
  const aiQuestion = aiQuestions[aiIndex]
  const localFinished = localQuestions.length > 0 && localResults.length === localQuestions.length
  const aiFinished = aiQuestions.length > 0 && aiResults.length === aiQuestions.length
  const localWrongResults = localResults.filter((result) => !result.isCorrect)
  const aiWrongResults = aiResults.filter((result) => !result.isCorrect)

  const resetLocalQuiz = useCallback(
    (mode: LocalQuizMode, sourceWords = words) => {
      setLocalMode(mode)
      setLocalQuestions(buildLocalQuiz(sourceWords, mode))
      setLocalIndex(0)
      setLocalAnswer('')
      setLocalCurrentResult(undefined)
      setLocalResults([])
    },
    [words],
  )

  useEffect(() => {
    resetLocalQuiz(localMode)
  }, [localMode, resetLocalQuiz])

  useEffect(() => {
    const cachedQuiz = getCachedText(aiCacheKey)
    if (!cachedQuiz) {
      setAiQuestions([])
      setAiStatus('idle')
      setAiMessage('')
      setAiRawText('')
      return
    }

    try {
      const payload = parseAndValidateAiQuiz(cachedQuiz)
      setAiQuestions(normalizeAiQuestions(payload.questions))
      setAiStatus('success')
      setAiMessage('已从本地缓存载入 AI 习题。')
      setAiRawText(cachedQuiz)
    } catch {
      setAiQuestions([])
      setAiStatus('idle')
      setAiMessage('')
      setAiRawText('')
    }
    setAiIndex(0)
    setAiAnswer('')
    setAiCurrentResult(undefined)
    setAiResults([])
  }, [aiCacheKey])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const submitLocalAnswer = useCallback(() => {
    if (!localQuestion || localCurrentResult) return

    const result = checkLocalQuizAnswer(localQuestion, localAnswer)
    const nextResult = { ...result, question: localQuestion, answer: localAnswer }
    setLocalCurrentResult(nextResult)
    setLocalResults((old) => [...old, nextResult])
  }, [localAnswer, localCurrentResult, localQuestion])

  const nextLocalQuestion = useCallback(() => {
    setLocalAnswer('')
    setLocalCurrentResult(undefined)
    setLocalIndex((old) => Math.min(old + 1, localQuestions.length - 1))
  }, [localQuestions.length])

  const retryLocalWrong = useCallback(() => {
    const wrongWords = localWrongResults.map((result) => result.question.word)
    resetLocalQuiz(localMode, wrongWords.length ? wrongWords : words)
  }, [localMode, localWrongResults, resetLocalQuiz, words])

  const generateAiQuiz = useCallback(
    async (forceRefresh = false) => {
      if (!aiConfig.apiKey.trim()) {
        setAiStatus('error')
        setAiMessage('请先打开 AI 配置填写 API Key。')
        setIsConfigOpen(true)
        return
      }

      const cachedQuiz = getCachedText(aiCacheKey)
      if (cachedQuiz && !forceRefresh) {
        const payload = parseAndValidateAiQuiz(cachedQuiz)
        setAiQuestions(normalizeAiQuestions(payload.questions))
        setAiStatus('success')
        setAiMessage('已从本地缓存载入 AI 习题。')
        setAiRawText(cachedQuiz)
        return
      }

      abortControllerRef.current?.abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      setAiStatus('loading')
      setAiMessage('正在流式生成 AI 习题...')
      setAiRawText('')

      try {
        const content = await streamChatCompletion(aiConfig, buildAiQuizMessages(words), {
          signal: abortController.signal,
          onDelta: (_delta, fullText) => {
            setAiRawText(fullText)
          },
          responseFormat:
            aiConfig.providerName.trim().toLowerCase() === 'openai' && aiConfig.supportsStructuredJson ? aiQuizResponseFormat : undefined,
        })
        if (abortController.signal.aborted) {
          return
        }
        const payload = parseAndValidateAiQuiz(content)
        if (payload.questions.length === 0) {
          throw new Error('AI 未返回可用题目，请重新生成。')
        }
        const normalizedPayloadText = JSON.stringify(payload)
        setCachedText(aiCacheKey, normalizedPayloadText)
        setAiQuestions(normalizeAiQuestions(payload.questions))
        setAiStatus('success')
        setAiMessage('AI 习题生成完成，已缓存到本机。')
        setAiRawText(normalizedPayloadText)
        setAiIndex(0)
        setAiAnswer('')
        setAiCurrentResult(undefined)
        setAiResults([])
      } catch (error) {
        if (abortController.signal.aborted) {
          setAiStatus('idle')
          setAiMessage('已取消生成，当前已返回内容未写入缓存。')
          return
        }
        setAiStatus('error')
        setAiMessage(error instanceof Error ? error.message : 'AI 习题生成失败。')
      }
    },
    [aiCacheKey, aiConfig, words],
  )

  const submitAiAnswer = useCallback(() => {
    if (!aiQuestion || aiCurrentResult) return

    const answer = aiQuestion.type === 'choice' ? aiAnswer : aiAnswer.trim()
    const isCorrect = checkAcceptedAnswer(answer, aiQuestion.acceptedAnswers)
    const result = { question: aiQuestion, answer, isCorrect }
    setAiCurrentResult(result)
    setAiResults((old) => [...old, result])
  }, [aiAnswer, aiCurrentResult, aiQuestion])

  const nextAiQuestion = useCallback(() => {
    setAiAnswer('')
    setAiCurrentResult(undefined)
    setAiIndex((old) => Math.min(old + 1, aiQuestions.length - 1))
  }, [aiQuestions.length])

  const retryAiWrong = useCallback(() => {
    const wrongQuestions = aiWrongResults.map((result) => result.question)
    setAiQuestions(wrongQuestions.length ? wrongQuestions : aiQuestions)
    setAiIndex(0)
    setAiAnswer('')
    setAiCurrentResult(undefined)
    setAiResults([])
  }, [aiQuestions, aiWrongResults])

  return (
    <>
      <div className="flex h-full min-h-0 flex-col rounded-xl bg-indigo-50 p-4 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex rounded-lg bg-white p-1 shadow-sm dark:bg-gray-800">
            <button
              className={`${quizMode === 'local' ? 'bg-indigo-400 text-white' : 'text-gray-500'} rounded-md px-3 py-1`}
              type="button"
              onClick={() => setQuizMode('local')}
            >
              本地快测
            </button>
            <button
              className={`${quizMode === 'ai' ? 'bg-indigo-400 text-white' : 'text-gray-500'} rounded-md px-3 py-1`}
              type="button"
              onClick={() => setQuizMode('ai')}
            >
              AI混合题
            </button>
          </div>
          {quizMode === 'local' && (
            <div className="flex rounded-lg bg-white p-1 shadow-sm dark:bg-gray-800">
              <button
                className={`${
                  localMode === 'spelling' ? 'bg-indigo-100 text-indigo-600 dark:bg-gray-600 dark:text-white' : 'text-gray-500'
                } rounded-md px-3 py-1`}
                type="button"
                onClick={() => setLocalMode('spelling')}
              >
                释义默写
              </button>
              <button
                className={`${
                  localMode === 'meaning' ? 'bg-indigo-100 text-indigo-600 dark:bg-gray-600 dark:text-white' : 'text-gray-500'
                } rounded-md px-3 py-1`}
                type="button"
                onClick={() => setLocalMode('meaning')}
              >
                单词选义
              </button>
            </div>
          )}
        </div>

        {quizMode === 'local' && (
          <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
            <QuizHeader
              current={localIndex + 1}
              total={localQuestions.length}
              score={localResults.filter((result) => result.isCorrect).length}
            />
            {localFinished ? (
              <FinishPanel
                correctCount={localResults.filter((result) => result.isCorrect).length}
                total={localResults.length}
                wrongItems={localWrongResults.map((result) => result.question.word.name)}
                onRetryWrong={retryLocalWrong}
                onRestart={() => resetLocalQuiz(localMode)}
              />
            ) : (
              localQuestion && (
                <div className="mt-4 flex flex-1 flex-col gap-3">
                  <div className="rounded-lg bg-indigo-50 p-4 text-lg font-medium dark:bg-gray-700">{localQuestion.prompt}</div>
                  {localQuestion.mode === 'spelling' ? (
                    <input
                      className="rounded-md border border-gray-200 px-3 py-2 text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      value={localAnswer}
                      onChange={(event) => setLocalAnswer(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submitLocalAnswer()
                      }}
                      disabled={Boolean(localCurrentResult)}
                      placeholder="输入英文单词"
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {localQuestion.options?.map((option) => (
                        <button
                          key={option}
                          className={`${
                            localAnswer === option ? 'border-indigo-400 bg-indigo-50 dark:bg-gray-700' : 'border-gray-200'
                          } rounded-md border px-3 py-2 text-left dark:border-gray-600`}
                          type="button"
                          onClick={() => setLocalAnswer(option)}
                          disabled={Boolean(localCurrentResult)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                  <QuestionResult
                    isAnswered={Boolean(localCurrentResult)}
                    isCorrect={localCurrentResult?.isCorrect}
                    explanation={localCurrentResult ? `正确答案：${localCurrentResult.expectedAnswer}` : ''}
                  />
                  <QuizActions
                    canSubmit={Boolean(localAnswer)}
                    isAnswered={Boolean(localCurrentResult)}
                    isLastQuestion={localResults.length >= localQuestions.length}
                    onSubmit={submitLocalAnswer}
                    onNext={nextLocalQuestion}
                  />
                </div>
              )
            )}
          </div>
        )}

        {quizMode === 'ai' && (
          <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                className="my-btn-primary h-9 px-4 text-sm"
                type="button"
                onClick={() => generateAiQuiz(false)}
                disabled={aiStatus === 'loading'}
              >
                {aiQuestions.length ? '载入 AI 题' : '生成 AI 题'}
              </button>
              <button
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-50 dark:border-gray-500 dark:text-gray-200"
                type="button"
                onClick={() => generateAiQuiz(true)}
                disabled={aiStatus === 'loading'}
              >
                重新生成
              </button>
              <button
                className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:border-indigo-300 hover:text-indigo-500 dark:border-gray-500 dark:text-gray-200"
                type="button"
                onClick={() => setIsConfigOpen(true)}
                title="AI 配置"
                aria-label="AI 配置"
              >
                <IconSettings className="icon" />
              </button>
              {aiStatus === 'loading' && (
                <button
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-500 dark:text-gray-200"
                  type="button"
                  onClick={() => abortControllerRef.current?.abort()}
                >
                  取消
                </button>
              )}
              {aiMessage && (
                <span className={`${aiStatus === 'error' ? 'text-red-500' : 'text-gray-500 dark:text-gray-300'} text-xs`}>{aiMessage}</span>
              )}
            </div>
            {aiStatus === 'loading' && (
              <div className="customized-scrollbar min-h-0 flex-1 overflow-y-auto rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                {aiRawText ? <pre className="whitespace-pre-wrap break-words font-mono">{aiRawText}</pre> : '正在等待 AI 返回题目...'}
              </div>
            )}
            {aiStatus !== 'loading' && aiQuestions.length === 0 && (
              <div className="text-gray-500">先生成 AI 题。题目会按章节和模型配置缓存到本机。</div>
            )}
            {aiStatus !== 'loading' && aiQuestions.length > 0 && (
              <>
                <QuizHeader
                  current={aiIndex + 1}
                  total={aiQuestions.length}
                  score={aiResults.filter((result) => result.isCorrect).length}
                />
                {aiFinished ? (
                  <FinishPanel
                    correctCount={aiResults.filter((result) => result.isCorrect).length}
                    total={aiResults.length}
                    wrongItems={aiWrongResults.map((result) => result.question.word)}
                    onRetryWrong={retryAiWrong}
                    onRestart={() => {
                      setAiIndex(0)
                      setAiAnswer('')
                      setAiCurrentResult(undefined)
                      setAiResults([])
                    }}
                  />
                ) : (
                  aiQuestion && (
                    <div className="mt-4 flex flex-1 flex-col gap-3">
                      <div className="rounded-lg bg-indigo-50 p-4 text-base font-medium dark:bg-gray-700">{aiQuestion.prompt}</div>
                      {aiQuestion.type === 'choice' && aiQuestion.options && aiQuestion.options.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {aiQuestion.options.map((option) => (
                            <button
                              key={option}
                              className={`${
                                aiAnswer === option ? 'border-indigo-400 bg-indigo-50 dark:bg-gray-700' : 'border-gray-200'
                              } rounded-md border px-3 py-2 text-left dark:border-gray-600`}
                              type="button"
                              onClick={() => setAiAnswer(option)}
                              disabled={Boolean(aiCurrentResult)}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <input
                          className="rounded-md border border-gray-200 px-3 py-2 text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                          value={aiAnswer}
                          onChange={(event) => setAiAnswer(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') submitAiAnswer()
                          }}
                          disabled={Boolean(aiCurrentResult)}
                          placeholder="输入答案"
                        />
                      )}
                      <QuestionResult
                        isAnswered={Boolean(aiCurrentResult)}
                        isCorrect={aiCurrentResult?.isCorrect}
                        explanation={aiCurrentResult ? `答案：${aiQuestion.answer}。${aiQuestion.explanation}` : ''}
                      />
                      <QuizActions
                        canSubmit={Boolean(aiAnswer)}
                        isAnswered={Boolean(aiCurrentResult)}
                        isLastQuestion={aiResults.length >= aiQuestions.length}
                        onSubmit={submitAiAnswer}
                        onNext={nextAiQuestion}
                      />
                    </div>
                  )
                )}
              </>
            )}
          </div>
        )}
      </div>
      <AiProviderConfigDialog isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} />
    </>
  )
}

function QuizHeader({ current, total, score }: { current: number; total: number; score: number }) {
  return (
    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-300">
      <span>
        第 {current || 0} / {total} 题
      </span>
      <span>当前得分：{score}</span>
    </div>
  )
}

function QuestionResult({ isAnswered, isCorrect, explanation }: { isAnswered: boolean; isCorrect?: boolean; explanation: string }) {
  if (!isAnswered) return null

  return (
    <div className={`${isCorrect ? 'text-green-600' : 'text-red-500'} rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-700`}>
      {isCorrect ? '回答正确。' : '回答错误。'} {explanation}
    </div>
  )
}

function QuizActions({
  canSubmit,
  isAnswered,
  isLastQuestion,
  onSubmit,
  onNext,
}: {
  canSubmit: boolean
  isAnswered: boolean
  isLastQuestion: boolean
  onSubmit: () => void
  onNext: () => void
}) {
  if (isAnswered) {
    return (
      <button className="my-btn-primary h-9 self-start px-4 text-sm" type="button" onClick={onNext} disabled={isLastQuestion}>
        {isLastQuestion ? '已完成' : '下一题'}
      </button>
    )
  }

  return (
    <button
      className="my-btn-primary h-9 self-start px-4 text-sm disabled:opacity-50"
      type="button"
      onClick={onSubmit}
      disabled={!canSubmit}
    >
      提交答案
    </button>
  )
}

function FinishPanel({
  correctCount,
  total,
  wrongItems,
  onRetryWrong,
  onRestart,
}: {
  correctCount: number
  total: number
  wrongItems: string[]
  onRetryWrong: () => void
  onRestart: () => void
}) {
  return (
    <div className="mt-4 flex flex-1 flex-col gap-3">
      <div className="rounded-lg bg-indigo-50 p-4 text-lg font-medium dark:bg-gray-700">
        完成：{correctCount} / {total}
      </div>
      {wrongItems.length > 0 && (
        <div className="customized-scrollbar max-h-24 overflow-y-auto rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-700">
          <span className="text-gray-500 dark:text-gray-300">错题：</span>
          {wrongItems.join('、')}
        </div>
      )}
      <div className="flex gap-2">
        <button className="my-btn-primary h-9 px-4 text-sm" type="button" onClick={onRestart}>
          重新乱序
        </button>
        <button
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-50 dark:border-gray-500 dark:text-gray-200"
          type="button"
          onClick={onRetryWrong}
          disabled={wrongItems.length === 0}
        >
          重测错题
        </button>
      </div>
    </div>
  )
}
