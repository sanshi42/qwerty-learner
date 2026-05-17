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
    content: '你是一名擅长考研英语词汇记忆、联想记忆和考试高频用法讲解的老师。回答要清晰、适合复习背诵。',
  },
  {
    role: 'user',
    content: buildVocabularyPrompt(words),
  },
]

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
    content: '你是一名严格的英语词汇出题老师。只输出 JSON，不要输出 Markdown。题目用于检查用户是否记住单词含义、搭配和常见辨析。',
  },
  {
    role: 'user',
    content: `请为下面每个单词生成 1 道混合题，题型在 choice、blank、collocation 中均衡分布。

字段要求：
- id: 稳定短字符串
- word: 对应英文单词
- type: choice | blank | collocation
- prompt: 中文题干或英文语境题干
- options: 选择题给 4 个选项；非选择题给空数组
- answer: 标准答案
- acceptedAnswers: 可接受答案数组，至少包含标准答案和对应英文单词
- explanation: 简短解析，说明为什么答案正确

单词列表：
${words.map((word) => `${word.name}：${word.trans.join('；')}`).join('\n')}`,
  },
]

export const parseAndValidateAiQuiz = (rawText: string): AiQuizPayload => {
  const trimmed = rawText.trim()
  const jsonText = trimmed.startsWith('{') ? trimmed : trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
  const parsed = JSON.parse(jsonText) as AiQuizPayload

  if (!Array.isArray(parsed.questions)) {
    throw new Error('AI 习题 JSON 缺少 questions 数组')
  }

  return {
    questions: parsed.questions
      .filter((question) => {
        return (
          typeof question.id === 'string' &&
          typeof question.word === 'string' &&
          ['choice', 'blank', 'collocation'].includes(question.type) &&
          typeof question.prompt === 'string' &&
          typeof question.answer === 'string' &&
          Array.isArray(question.acceptedAnswers) &&
          typeof question.explanation === 'string'
        )
      })
      .map((question) => ({
        ...question,
        options: Array.isArray(question.options) ? question.options : [],
        acceptedAnswers: question.acceptedAnswers.length ? question.acceptedAnswers : [question.answer, question.word],
      })),
  }
}
