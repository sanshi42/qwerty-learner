import type { WordWithIndex } from '@/typings'

export type VocabularyWord = Pick<WordWithIndex, 'name' | 'trans'>

export const buildVocabularyPrompt = (words: VocabularyWord[]) => {
  const wordList = words.map((word) => `${word.name}：${word.trans.join('；')}`).join('\n')

  return `请按照“考研英语词汇记忆”的方式，帮我记忆下面这组单词。

要求：
1. 先把这组单词串成一个有画面感的小故事，尽量用一条主线把所有词联系起来，方便联想记忆。
2. 每个单词都要讲：
   - 发音，最好给出 IPA 音标；
   - 核心含义；
   - 考研常见义和高频考点；
   - 常见搭配；
   - 简单有效的联想记忆方法。
3. 不要只给中文释义，要适当拓展这个词在阅读、翻译、写作中的常见用法。
4. 对容易混淆的词，要单独做辨析，比如：
   - 形近词；
   - 近义词；
   - 词性变化；
   - 常见错误搭配。
5. 如果某个词有重要派生词，也要顺带讲一下，比如动词、名词、形容词、副词形式。
6. 最后整理：
   - 高频短语表；
   - 考研写作可用句；
   - 需要特别注意的易错点。
7. 输出要清晰，适合背诵和复习。可以用表格，但不要太机械，要帮助我真正记住这些词。

下面是单词列表：
${wordList}`
}

export const buildWordListText = (words: VocabularyWord[]) => {
  return words.map((word) => `${word.name}：${word.trans.join('；')}`).join('\n')
}

export const hashString = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export const normalizeAnswer = (value: string) => value.trim().toLowerCase()
