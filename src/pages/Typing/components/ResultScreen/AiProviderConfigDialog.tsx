import { fetchProviderModels, testAiProviderConfig } from './aiHelpers'
import { aiProviderConfigAtom } from '@/store'
import type { AiProviderConfig } from '@/typings'
import { Dialog, Transition } from '@headlessui/react'
import { useAtom } from 'jotai'
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react'
import IconX from '~icons/tabler/x'

type AiProviderConfigDialogProps = {
  isOpen: boolean
  onClose: () => void
}

type ProviderPreset = {
  id: string
  label: string
  config: Omit<AiProviderConfig, 'apiKey'>
  models: string[]
}

const providerPresets: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    config: {
      providerName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      supportsStructuredJson: true,
    },
    models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.3-codex'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    config: {
      providerName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      supportsStructuredJson: false,
    },
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'custom',
    label: 'Custom',
    config: {
      providerName: 'Custom',
      baseUrl: '',
      model: '',
      supportsStructuredJson: false,
    },
    models: [],
  },
]

const findPresetId = (config: AiProviderConfig) => {
  const matchedPreset = providerPresets.find((preset) => preset.config.providerName === config.providerName)
  return matchedPreset?.id ?? 'custom'
}

export default function AiProviderConfigDialog({ isOpen, onClose }: AiProviderConfigDialogProps) {
  const [config, setConfig] = useAtom(aiProviderConfigAtom)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [checkStatus, setCheckStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle')
  const [checkMessage, setCheckMessage] = useState('尚未检查连接。')
  const modelListId = useId()

  const presetId = useMemo(() => findPresetId(config), [config])

  useEffect(() => {
    if (!isOpen) return

    const preset = providerPresets.find((item) => item.id === presetId)
    setModelOptions(preset?.models ?? [])
  }, [isOpen, presetId])

  const updateConfig = useCallback(
    (patch: Partial<AiProviderConfig>) => {
      setConfig((old) => ({ ...old, ...patch }))
      setCheckStatus('idle')
      setCheckMessage('配置已修改，建议重新检查连接。')
    },
    [setConfig],
  )

  const applyPreset = useCallback(
    (nextPresetId: string) => {
      const preset = providerPresets.find((item) => item.id === nextPresetId) ?? providerPresets[2]
      setModelOptions(preset.models)
      setCheckStatus('idle')
      setCheckMessage('已切换预设，建议检查连接。')

      if (preset.id === 'custom') {
        setConfig((old) => ({ ...old, providerName: 'Custom', supportsStructuredJson: false }))
        return
      }

      setConfig((old) => ({ ...old, ...preset.config }))
    },
    [setConfig],
  )

  const clearApiKey = useCallback(() => {
    updateConfig({ apiKey: '' })
  }, [updateConfig])

  const checkConnection = useCallback(async () => {
    const nextConfig = {
      ...config,
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      apiKey: config.apiKey.trim(),
    }

    if (!nextConfig.baseUrl || !nextConfig.model || !nextConfig.apiKey) {
      setCheckStatus('error')
      setCheckMessage('请先填写 Base URL、Model 和 API Key。')
      return
    }

    setCheckStatus('checking')
    setCheckMessage('正在检查模型列表和连接状态...')

    let modelMessage = ''
    try {
      const models = await fetchProviderModels(nextConfig)
      setModelOptions(models)
      modelMessage = `已获取 ${models.length} 个模型。`
    } catch (error) {
      modelMessage = error instanceof Error ? `模型列表未获取：${error.message}` : '模型列表未获取。'
    }

    try {
      const content = await testAiProviderConfig(nextConfig)
      setCheckStatus('success')
      setCheckMessage(`连接可用。${modelMessage} 测试返回：${content.trim().slice(0, 80)}`)
    } catch (error) {
      setCheckStatus('error')
      setCheckMessage(error instanceof Error ? `连接失败：${error.message}` : '连接失败，请检查配置。')
    }
  }, [config])

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[70]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800">
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
                  <Dialog.Title className="text-xl font-semibold text-gray-800 dark:text-gray-100">AI 配置</Dialog.Title>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    onClick={onClose}
                    title="关闭"
                  >
                    <IconX className="icon" />
                  </button>
                </div>

                <div className="space-y-4 px-6 py-5 text-sm text-gray-700 dark:text-gray-200">
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                    API Key 会保存到本机浏览器 localStorage，仅适合本机自用。
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-300">Provider 预设</span>
                    <select
                      className="rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      value={presetId}
                      onChange={(event) => applyPreset(event.target.value)}
                    >
                      {providerPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-300">Provider 名称</span>
                      <input
                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        value={config.providerName}
                        onChange={(event) => updateConfig({ providerName: event.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-300">Model</span>
                      <input
                        list={modelListId}
                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        value={config.model}
                        onChange={(event) => updateConfig({ model: event.target.value })}
                      />
                      <datalist id={modelListId}>
                        {modelOptions.map((model) => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                    </label>
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-300">Base URL</span>
                    <input
                      className="rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      value={config.baseUrl}
                      onChange={(event) => updateConfig({ baseUrl: event.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </label>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-300">API Key</span>
                      <input
                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        type="password"
                        value={config.apiKey}
                        onChange={(event) => updateConfig({ apiKey: event.target.value })}
                        placeholder="保存在本机浏览器"
                      />
                    </label>
                    <button
                      className="self-end rounded-lg border border-gray-300 px-4 py-2 text-gray-600 hover:border-indigo-300 hover:text-indigo-500 dark:border-gray-600 dark:text-gray-200"
                      type="button"
                      onClick={clearApiKey}
                    >
                      清除 Key
                    </button>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={config.supportsStructuredJson}
                      onChange={(event) => updateConfig({ supportsStructuredJson: event.target.checked })}
                    />
                    OpenAI 结构化 JSON
                  </label>

                  <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
                    <button
                      className="my-btn-primary h-10 px-5 text-sm"
                      type="button"
                      onClick={checkConnection}
                      disabled={checkStatus === 'checking'}
                    >
                      {checkStatus === 'checking' ? '检查中...' : '检查连接'}
                    </button>
                    <span
                      className={`text-xs ${
                        checkStatus === 'success'
                          ? 'text-green-600'
                          : checkStatus === 'error'
                          ? 'text-red-500'
                          : 'text-gray-500 dark:text-gray-300'
                      }`}
                    >
                      {checkMessage}
                    </span>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
