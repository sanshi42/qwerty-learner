import { buildVocabularyPrompt, hashString } from './vocabularyHelpers'
import type { VocabularyWord } from './vocabularyHelpers'
import type { AiProviderConfig } from '@/typings'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AiQuizQuestion = {
  id: string
  word: string
  type: 'choice' | 'blank' | 'collocation'
  prompt: string
  options?: string[]
  answer: string
  acceptedAnswers: string[]
  explanation: string
}

export type AiQuizPayload = {
  questions: AiQuizQuestion[]
}

type ChatCompletionOptions = {
  signal?: AbortSignal
  responseFormat?: Record<string, unknown>
  onDelta?: (delta: string, fullText: string) => void
}

type AiCacheKind = 'explanation' | 'quiz'

export const getAiCacheKey = (
  kind: AiCacheKind,
  dictId: string,
  chapter: number,
  words: VocabularyWord[],
  config: Pick<AiProviderConfig, 'providerName' | 'baseUrl' | 'model'>,
) => {
  const wordHash = hashString(words.map((word) => `${word.name}:${word.trans.join('|')}`).join('\n'))
  const providerHash = hashString(`${config.providerName}|${config.baseUrl}|${config.model}`)
  return `result-screen-ai:${kind}:${dictId}:${chapter}:${wordHash}:${providerHash}`
}

export const getCachedText = (key: string) => {
  return window.localStorage.getItem(key)
}

export const setCachedText = (key: string, value: string) => {
  window.localStorage.setItem(key, value)
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '')

const extractErrorMessage = (responseText: string, fallback: string) => {
  try {
    const errorBody = JSON.parse(responseText)
    return errorBody?.error?.message || responseText || fallback
  } catch {
    return responseText || fallback
  }
}

export const callChatCompletion = async (config: AiProviderConfig, messages: ChatMessage[], options: ChatCompletionOptions = {}) => {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
    signal: options.signal,
  })

  const responseText = await response.text()

  if (!response.ok) {
    const message = extractErrorMessage(responseText, response.statusText)
    throw new Error(`AI 请求失败 (${response.status})：${message || response.statusText}`)
  }

  const data = JSON.parse(responseText)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('AI 返回格式不符合预期，未找到 message.content')
  }

  return content
}

export const streamChatCompletion = async (config: AiProviderConfig, messages: ChatMessage[], options: ChatCompletionOptions = {}) => {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const responseText = await response.text()
    const message = extractErrorMessage(responseText, response.statusText)
    throw new Error(`AI 请求失败 (${response.status})：${message || response.statusText}`)
  }

  if (!response.body) {
    throw new Error('当前浏览器不支持读取 AI 流式响应。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return

    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }

    const choices = (parsed as { choices?: Array<{ delta?: { content?: string } }> }).choices ?? []
    const delta = choices
      .map((choice) => choice.delta?.content)
      .filter((content): content is string => typeof content === 'string')
      .join('')

    if (!delta) return

    fullText += delta
    options.onDelta?.(delta, fullText)
  }

  let isStreamDone = false
  while (!isStreamDone) {
    const { value, done } = await reader.read()
    isStreamDone = done
    if (done) continue

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    lines.forEach(handleLine)
  }

  buffer += decoder.decode()
  if (buffer) {
    buffer.split(/\r?\n/).forEach(handleLine)
  }

  return fullText
}

export const fetchProviderModels = async (config: Pick<AiProviderConfig, 'baseUrl' | 'apiKey'>) => {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  })

  const responseText = await response.text()
  if (!response.ok) {
    const message = extractErrorMessage(responseText, response.statusText)
    throw new Error(`模型列表获取失败 (${response.status})：${message || response.statusText}`)
  }

  const data = JSON.parse(responseText) as { data?: Array<{ id?: unknown }> }
  const models = (data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .sort((a, b) => a.localeCompare(b))

  if (models.length === 0) {
    throw new Error('模型列表为空，请手动填写模型名。')
  }

  return models
}

export const testAiProviderConfig = async (config: AiProviderConfig) => {
  const content = await callChatCompletion(config, [
    { role: 'system', content: 'You are a connection test endpoint. Reply with OK only.' },
    { role: 'user', content: 'Reply OK.' },
  ])

  if (!content.trim()) {
    throw new Error('连接测试成功返回，但内容为空。')
  }

  return content
}

export const buildExplanationMessages = (words: VocabularyWord[]): ChatMessage[] => [
  {
    role: 'system',
    content: `你是英语词汇讲解老师。只输出讲解正文，不要问候语、不要确认词。

格式要求：
- 用 ### 标题分组（如 ### 核心词汇、### 易混淆词、### 词组搭配）
- 每个单词用 **加粗** 突出，后面跟简洁释义和用法
- 列表用 - 开头，保持紧凑
- 不使用代码块`,
  },
  {
    role: 'user',
    content: buildVocabularyPrompt(words),
  },
]

export const QUIZ_QUESTION_SEPARATOR = '\n---\n'

/**
 * 用括号计数器从流式文本中提取完整 JSON 对象。
 * 兼容 JSON 数组格式 [{...}, {...}] 和分隔符格式 {...}\n---\n{...}。
 * 只返回 alreadyParsedCount 之后新出现的完整对象。
 */
export const extractJsonObjects = (fullText: string, alreadyParsedCount: number): string[] => {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escape = false

  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        objects.push(fullText.slice(start, i + 1))
        start = -1
      }
    }
  }

  return objects.slice(alreadyParsedCount)
}

export const extractCompletedQuestions = (fullText: string, alreadyParsedCount: number): AiQuizQuestion[] => {
  const jsonBlocks = extractJsonObjects(fullText, alreadyParsedCount)
  // 在原本的 block 计数基础上也记下新 block 数（用于 QuizPanel 的 ref 同步）
  const questions: AiQuizQuestion[] = []
  for (const block of jsonBlocks) {
    try {
      const q = parseSingleQuestionBlock(block)
      if (q) questions.push(q)
    } catch {
      // 跳过解析失败的 block
    }
  }
  return questions
}

export const parseSingleQuestionBlock = (block: string): AiQuizQuestion | null => {
  let jsonText = block.trim()

  // 去除可能的 ```json ... ``` 包裹
  if (jsonText.startsWith('```')) {
    const codeContent = jsonText.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '')
    jsonText = codeContent.trim()
  }

  const parsed = JSON.parse(jsonText)
  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.word !== 'string' ||
    !['choice', 'blank', 'collocation'].includes(parsed.type) ||
    typeof parsed.prompt !== 'string' ||
    typeof parsed.answer !== 'string' ||
    !Array.isArray(parsed.acceptedAnswers) ||
    typeof parsed.explanation !== 'string'
  ) {
    return null
  }

  return {
    id: parsed.id,
    word: parsed.word,
    type: parsed.type,
    prompt: parsed.prompt,
    options: Array.isArray(parsed.options) ? parsed.options : [],
    answer: parsed.answer,
    acceptedAnswers: parsed.acceptedAnswers.length ? parsed.acceptedAnswers : [parsed.answer, parsed.word],
    explanation: parsed.explanation,
  }
}

export const aiQuizResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'vocabulary_quiz',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              word: { type: 'string' },
              type: { type: 'string', enum: ['choice', 'blank', 'collocation'] },
              prompt: { type: 'string' },
              options: {
                type: 'array',
                items: { type: 'string' },
              },
              answer: { type: 'string' },
              acceptedAnswers: {
                type: 'array',
                items: { type: 'string' },
              },
              explanation: { type: 'string' },
            },
            required: ['id', 'word', 'type', 'prompt', 'options', 'answer', 'acceptedAnswers', 'explanation'],
          },
        },
      },
      required: ['questions'],
    },
  },
}

export const buildAiQuizMessages = (words: VocabularyWord[]): ChatMessage[] => [
  {
    role: 'system',
    content: `你是英语词汇出题老师。只输出 JSON 数组，不要 Markdown、不要解释。

输出格式：[{"id":"q1","word":"cancel","type":"choice","prompt":"cancel 的中文含义是？","options":["确认","取消","删除","保存"],"answer":"取消","acceptedAnswers":["取消","cancel"],"explanation":"cancel 意为取消"},...]

每道题一个 JSON 对象，所有题放在 JSON 数组里输出。题型在 choice、blank、collocation 中均衡分布。`,
  },
  {
    role: 'user',
    content: `为下面每个单词生成 1 道题，输出 JSON 数组。

字段：id(短字符串)、word(单词)、type(choice|blank|collocation)、prompt(题干)、options(选择题4选项否则[])、answer(标准答案)、acceptedAnswers(可接受答案数组，含答案和单词)、explanation(简短解析)

单词：${words.map((word) => `${word.name}：${word.trans.join('；')}`).join('\n')}`,
  },
]

const stripMarkdownCodeBlock = (text: string): string => {
  let result = text.trim()
  if (result.startsWith('```')) {
    result = result
      .replace(/^```[a-z]*\s*\n?/i, '')
      .replace(/\n?```\s*$/, '')
      .trim()
  }
  return result
}

export const parseAndValidateAiQuiz = (rawText: string): AiQuizPayload => {
  const text = stripMarkdownCodeBlock(rawText)
  let parsed: unknown

  // 先尝试按分隔符解析（流式输出格式）
  const separatorBlocks = text.split(QUIZ_QUESTION_SEPARATOR).filter((block) => block.trim())
  if (separatorBlocks.length > 0) {
    const questions = separatorBlocks
      .map((block) => {
        try {
          return parseSingleQuestionBlock(block)
        } catch {
          return null
        }
      })
      .filter((q): q is AiQuizQuestion => q !== null)
    if (questions.length > 0) {
      return { questions }
    }
  }

  // 回退：尝试作为 JSON 数组/对象解析
  try {
    parsed = JSON.parse(text)
  } catch {
    // JSON 直接解析失败，尝试提取 {...} 部分
    const braceStart = text.indexOf('{')
    const braceEnd = text.lastIndexOf('}')
    if (braceStart < 0 || braceEnd <= braceStart) {
      throw new Error('AI 返回内容无法解析为习题，请重新生成。')
    }
    try {
      parsed = JSON.parse(text.slice(braceStart, braceEnd + 1))
    } catch {
      throw new Error('AI 习题 JSON 格式有误，请重新生成。')
    }
  }

  const data = parsed as Record<string, unknown>

  if (Array.isArray(data.questions)) {
    return {
      questions: (data.questions as unknown[])
        .filter((q): q is AiQuizQuestion => {
          return (
            typeof (q as Record<string, unknown>).id === 'string' &&
            typeof (q as Record<string, unknown>).word === 'string' &&
            ['choice', 'blank', 'collocation'].includes((q as Record<string, unknown>).type as string) &&
            typeof (q as Record<string, unknown>).prompt === 'string' &&
            typeof (q as Record<string, unknown>).answer === 'string' &&
            Array.isArray((q as Record<string, unknown>).acceptedAnswers) &&
            typeof (q as Record<string, unknown>).explanation === 'string'
          )
        })
        .map((q) => ({
          ...q,
          options: Array.isArray(q.options) ? q.options : [],
          acceptedAnswers: q.acceptedAnswers.length ? q.acceptedAnswers : [q.answer, q.word],
        })),
    }
  }

  // 如果是数组，每个元素可能是题目
  if (Array.isArray(data)) {
    const questions = (data as unknown[])
      .map((item) => {
        try {
          return parseSingleQuestionBlock(JSON.stringify(item))
        } catch {
          return null
        }
      })
      .filter((q): q is AiQuizQuestion => q !== null)
    if (questions.length > 0) {
      return { questions }
    }
  }

  throw new Error('AI 返回格式无法识别，请重新生成。')
}
