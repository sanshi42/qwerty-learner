import AiProviderConfigDialog from './AiProviderConfigDialog'
import { buildExplanationMessages, getAiCacheKey, getCachedText, setCachedText, streamChatCompletion } from './aiHelpers'
import { copyTextToClipboard } from './clipboardHelpers'
import { buildVocabularyPrompt } from './vocabularyHelpers'
import type { VocabularyWord } from './vocabularyHelpers'
import { aiProviderConfigAtom } from '@/store'
import { useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import IconArrowsMaximize from '~icons/tabler/arrows-maximize'
import IconCopy from '~icons/tabler/copy'
import IconMinus from '~icons/tabler/minus'
import IconPlus from '~icons/tabler/plus'
import IconRefresh from '~icons/tabler/refresh'
import IconSettings from '~icons/tabler/settings'
import IconX from '~icons/tabler/x'

type AiLearningPanelProps = {
  words: VocabularyWord[]
  dictId: string
  chapter: number
}

type ReaderProps = {
  result: string
  status: 'idle' | 'loading' | 'success' | 'error'
  scale: number
}

const readingScaleStorageKey = 'resultScreenAiReadingScale'
const minReadingScale = 80
const maxReadingScale = 160
const readingScaleStep = 10

const clampScale = (value: number) => Math.min(maxReadingScale, Math.max(minReadingScale, value))

const getStoredReadingScale = () => {
  const storedValue = Number(window.localStorage.getItem(readingScaleStorageKey))
  return Number.isFinite(storedValue) && storedValue > 0 ? clampScale(storedValue) : 100
}

export default function AiLearningPanel({ words, dictId, chapter }: AiLearningPanelProps) {
  const config = useAtomValue(aiProviderConfigAtom)
  const [result, setResult] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [showPromptFallback, setShowPromptFallback] = useState(false)
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [readingScale, setReadingScale] = useState(getStoredReadingScale)
  const abortControllerRef = useRef<AbortController>()

  const cacheKey = useMemo(() => getAiCacheKey('explanation', dictId, chapter, words, config), [chapter, config, dictId, words])
  const hasApiKey = config.apiKey.trim().length > 0

  useEffect(() => {
    window.localStorage.setItem(readingScaleStorageKey, String(readingScale))
  }, [readingScale])

  useEffect(() => {
    const cachedResult = getCachedText(cacheKey)
    setResult(cachedResult || '')
    setStatus(cachedResult ? 'success' : 'idle')
    setMessage(cachedResult ? '已从本地缓存载入。' : '')
  }, [cacheKey])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!isFullscreen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  const generateExplanation = useCallback(
    async (forceRefresh = false) => {
      if (!hasApiKey) {
        setStatus('error')
        setMessage('请先打开 AI 配置填写 API Key。Key 只会保存在本机浏览器。')
        setIsConfigOpen(true)
        return
      }

      const cachedResult = getCachedText(cacheKey)
      if (cachedResult && !forceRefresh) {
        setResult(cachedResult)
        setStatus('success')
        setMessage('已从本地缓存载入。')
        return
      }

      abortControllerRef.current?.abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      setStatus('loading')
      setResult('')
      setMessage('正在流式生成 AI 讲解...')

      try {
        const content = await streamChatCompletion(config, buildExplanationMessages(words), {
          signal: abortController.signal,
          onDelta: (_delta, fullText) => {
            setResult(fullText)
          },
        })
        if (abortController.signal.aborted) {
          return
        }
        setCachedText(cacheKey, content)
        setResult(content)
        setStatus('success')
        setMessage('生成完成，已缓存到本机。')
      } catch (error) {
        if (abortController.signal.aborted) {
          setStatus('idle')
          setMessage('已取消生成，当前已返回内容未写入缓存。')
          return
        }
        setStatus('error')
        setMessage(error instanceof Error ? error.message : '生成失败，请检查配置后重试。')
      }
    },
    [cacheKey, config, hasApiKey, words],
  )

  const copyPrompt = useCallback(async () => {
    const prompt = buildVocabularyPrompt(words)
    const isCopied = await copyTextToClipboard(prompt)
    setShowPromptFallback(!isCopied)
    setMessage(isCopied ? '提示词已复制。' : '复制失败，已展开提示词文本。')
  }, [words])

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  const updateReadingScale = useCallback((delta: number) => {
    setReadingScale((old) => clampScale(old + delta))
  }, [])

  const resetReadingScale = useCallback(() => {
    setReadingScale(100)
  }, [])

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl bg-indigo-50 p-4 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="my-btn-primary h-9 px-4 text-sm"
            type="button"
            onClick={() => generateExplanation(false)}
            disabled={status === 'loading'}
          >
            {result ? '查看/载入讲解' : '生成 AI 讲解'}
          </button>
          <IconButton title="重新生成" onClick={() => generateExplanation(true)} disabled={status === 'loading'}>
            <IconRefresh className="icon" />
          </IconButton>
          <IconButton title="复制提示词" onClick={copyPrompt}>
            <IconCopy className="icon" />
          </IconButton>
          <IconButton title="AI 配置" onClick={() => setIsConfigOpen(true)}>
            <IconSettings className="icon" />
          </IconButton>
          {status === 'loading' && (
            <button
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-500 dark:text-gray-200"
              type="button"
              onClick={cancelGeneration}
            >
              取消
            </button>
          )}

          <div className="ml-auto flex items-center gap-1">
            <IconButton title="缩小字号" onClick={() => updateReadingScale(-readingScaleStep)} disabled={readingScale <= minReadingScale}>
              <IconMinus className="icon" />
            </IconButton>
            <button
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 dark:border-gray-500 dark:text-gray-200"
              type="button"
              onClick={resetReadingScale}
            >
              {readingScale}%
            </button>
            <IconButton title="放大字号" onClick={() => updateReadingScale(readingScaleStep)} disabled={readingScale >= maxReadingScale}>
              <IconPlus className="icon" />
            </IconButton>
            <IconButton title="全屏阅读" onClick={() => setIsFullscreen(true)}>
              <IconArrowsMaximize className="icon" />
            </IconButton>
          </div>
        </div>

        {message && <div className={`${status === 'error' ? 'text-red-500' : 'text-gray-500 dark:text-gray-300'} text-xs`}>{message}</div>}
        {showPromptFallback && (
          <textarea
            className="h-20 w-full flex-shrink-0 resize-none rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-700 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            readOnly
            value={buildVocabularyPrompt(words)}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}

        <AiReader result={result} status={status} scale={readingScale} />
      </div>

      {isFullscreen && (
        <div className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white text-gray-800 dark:bg-gray-900 dark:text-gray-100">
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-4 dark:border-gray-700">
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">AI 讲解</div>
              {message && (
                <div className={`${status === 'error' ? 'text-red-500' : 'text-gray-500 dark:text-gray-300'} mt-1 truncate text-xs`}>
                  {message}
                </div>
              )}
            </div>
            <IconButton title="缩小字号" onClick={() => updateReadingScale(-readingScaleStep)} disabled={readingScale <= minReadingScale}>
              <IconMinus className="icon" />
            </IconButton>
            <button
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 dark:border-gray-500 dark:text-gray-200"
              type="button"
              onClick={resetReadingScale}
            >
              {readingScale}%
            </button>
            <IconButton title="放大字号" onClick={() => updateReadingScale(readingScaleStep)} disabled={readingScale >= maxReadingScale}>
              <IconPlus className="icon" />
            </IconButton>
            <button
              type="button"
              className="my-btn-primary ml-4 flex items-center gap-1 px-4 py-2 text-sm"
              onClick={() => setIsFullscreen(false)}
            >
              <IconX className="icon" />
              退出全屏
            </button>
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden p-6">
            <AiReader result={result} status={status} scale={readingScale} />
          </div>
        </div>
      )}

      <AiProviderConfigDialog isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} />
    </>
  )
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:border-indigo-300 hover:text-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-500 dark:text-gray-200"
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  )
}

function AiReader({ result, status, scale }: ReaderProps) {
  return (
    <div className="customized-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg bg-white p-4 text-left shadow-sm dark:bg-gray-800">
      {result ? (
        <div className="min-w-0 max-w-full break-words" style={{ fontSize: `${scale}%`, overflowWrap: 'anywhere' }}>
          <ReactMarkdown components={markdownComponents}>{result}</ReactMarkdown>
        </div>
      ) : (
        <div className="text-sm leading-6 text-gray-500 dark:text-gray-300">
          {status === 'loading'
            ? '正在等待 AI 返回内容...'
            : '打开 AI 配置填写 API Key 后，可以直接生成本章单词讲解；也可以复制提示词手动使用。'}
        </div>
      )}
    </div>
  )
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-[1.5em] font-bold text-gray-900 dark:text-gray-50">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-[1.25em] font-bold text-gray-900 dark:text-gray-50">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-[1.125em] font-semibold text-gray-800 dark:text-gray-100">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-[1em] font-semibold text-gray-800 dark:text-gray-100">{children}</h4>,
  p: ({ children }) => <p className="my-1.5 break-words text-[1em] leading-relaxed text-gray-700 dark:text-gray-300">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc break-words pl-5 text-[1em] text-gray-700 dark:text-gray-300">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal break-words pl-5 text-[1em] text-gray-700 dark:text-gray-300">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-50">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.875em] text-pink-600 dark:bg-gray-700 dark:text-pink-300">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-gray-100 p-3 text-[0.875em] text-gray-800 dark:bg-gray-700 dark:text-gray-200">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-indigo-300 pl-3 text-[1em] italic text-gray-600 dark:border-indigo-500 dark:text-gray-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-gray-200 dark:border-gray-600" />,
  a: ({ href, children }) => (
    <a href={href} className="text-indigo-500 underline hover:text-indigo-600" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
}
