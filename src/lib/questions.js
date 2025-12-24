const MIN_CATEGORIES = 7
const MANIFEST_PATH = '/questions/manifest.json'

function stableQuestionId(categoryId, prompt, index) {
  const base = `${categoryId}-${prompt}-${index}`
  let hash = 0
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) % 2147483647
  }
  return `${categoryId}-${hash.toString(16)}`
}

function normalizeQuestion(categoryId, question, index, errors) {
  if (!question || typeof question.prompt !== 'string' || !question.prompt.trim()) {
    errors.push(`Category ${categoryId} question ${index + 1} is missing a prompt`)
    return null
  }
  if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 6) {
    errors.push(`Question "${question.prompt}" must have 2-6 choices`)
    return null
  }
  const answerIndex = question.answerIndex
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.choices.length) {
    errors.push(`Question "${question.prompt}" has invalid answerIndex`)
    return null
  }
  return {
    id: question.id || stableQuestionId(categoryId, question.prompt, index),
    prompt: question.prompt.trim(),
    choices: question.choices,
    answerIndex,
    explanation: question.explanation || '',
    difficulty: question.difficulty || 'normal',
    tags: Array.isArray(question.tags) ? question.tags : [],
  }
}

function normalizeCategory(category, index, ids, errors, sourceLabel = 'manifest') {
  if (!category || typeof category.id !== 'string' || !category.id.trim()) {
    errors.push(`Category from ${sourceLabel} is missing an id`)
    return null
  }
  const id = category.id.trim()
  if (ids.has(id)) {
    errors.push(`Duplicate category id: ${id}`)
    return null
  }
  ids.add(id)
  if (typeof category.name !== 'string' || !category.name.trim()) {
    errors.push(`Category ${id} (${sourceLabel}) is missing a name`)
    return null
  }
  if (!Array.isArray(category.questions) || category.questions.length === 0) {
    errors.push(`Category ${id} must include at least one question`)
    return null
  }
  const normalizedQuestions = []
  category.questions.forEach((question, questionIndex) => {
    const normalized = normalizeQuestion(id, question, questionIndex, errors)
    if (normalized) {
      normalizedQuestions.push(normalized)
    }
  })
  return {
    id,
    name: category.name.trim(),
    questions: normalizedQuestions,
  }
}

async function fetchJson(path, label) {
  let response
  try {
    response = await fetch(path, { cache: 'no-store' })
  } catch (error) {
    const err = new Error(`Unable to reach ${label}.`)
    err.details = ['Network request failed.']
    throw err
  }

  if (!response.ok) {
    const err = new Error(`Unable to load ${label}.`)
    err.details = [`Server responded with status ${response.status}`]
    throw err
  }

  try {
    return await response.json()
  } catch (error) {
    const err = new Error(`${label} is not valid JSON.`)
    err.details = ['Please ensure the file contains valid JSON.']
    throw err
  }
}

export async function fetchQuestionBank() {
  const manifest = await fetchJson(MANIFEST_PATH, 'the question manifest')
  const errors = []
  if (!Array.isArray(manifest.files)) {
    errors.push('"files" must be an array inside manifest.json.')
  } else if (manifest.files.length < MIN_CATEGORIES) {
    errors.push(`Manifest must list at least ${MIN_CATEGORIES} files.`)
  }

  if (errors.length > 0) {
    const err = new Error('Question manifest failed validation.')
    err.details = errors
    throw err
  }

  const ids = new Set()
  const loadedCategories = []
  await Promise.all(
    manifest.files.map(async (file, index) => {
      const label = `questions/${file}`
      try {
        const payload = await fetchJson(`/questions/${file}`, label)
        const categoryData = payload.category
          || (Array.isArray(payload.categories) ? payload.categories[0] : null)
        if (!categoryData) {
          errors.push(`File ${file} does not include a "category" entry.`)
          return
        }
        const normalized = normalizeCategory(categoryData, index, ids, errors, file)
        if (normalized) {
          loadedCategories.push(normalized)
        }
      } catch (error) {
        errors.push(error.message)
      }
    })
  )

  if (loadedCategories.length < MIN_CATEGORIES) {
    errors.push(`Only ${loadedCategories.length} categories loaded; ${MIN_CATEGORIES} required.`)
  }

  if (errors.length > 0) {
    const err = new Error('Question data failed validation.')
    err.details = errors
    throw err
  }

  return {
    version: manifest.version || 1,
    categories: loadedCategories,
  }
}
