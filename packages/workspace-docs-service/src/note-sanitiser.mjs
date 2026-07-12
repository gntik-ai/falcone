import { WORKSPACE_DOCS_NOTE_MAX_LENGTH } from './config.mjs'

const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g

function stripCompleteTags(value) {
  let output = ''
  let index = 0

  while (index < value.length) {
    if (value[index] !== '<') {
      output += value[index]
      index += 1
      continue
    }

    const tagEnd = value.indexOf('>', index + 1)
    if (tagEnd === -1) {
      output += value.slice(index)
      break
    }
    index = tagEnd + 1
  }

  return output
}

export function sanitise(content) {
  const decoded = String(content ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

  const cleaned = stripCompleteTags(decoded).replace(/<|>/g, '').replace(CONTROL_CHARS_REGEX, '').trim()

  if (!cleaned || cleaned.length > WORKSPACE_DOCS_NOTE_MAX_LENGTH) {
    const error = new Error('Invalid note content')
    error.code = 'INVALID_NOTE_CONTENT'
    throw error
  }

  return cleaned
}
