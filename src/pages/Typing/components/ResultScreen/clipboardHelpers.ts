const fallbackCopyText = (text: string) => {
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.style.top = '-9999px'

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  const isCopied = document.execCommand('copy')
  document.body.removeChild(textArea)

  return isCopied
}

export const copyTextToClipboard = async (text: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to execCommand for local browsers that block clipboard writes.
  }

  return fallbackCopyText(text)
}
