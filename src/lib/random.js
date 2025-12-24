const MULTIPLIER = 12.9898
const OFFSET = 78.233
const SCALE = 43758.5453

function pseudoRandom(seed, cursor) {
  const value = Math.sin(seed * MULTIPLIER + cursor * OFFSET) * SCALE
  return value - Math.floor(value)
}

export function generateSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return buffer[0] || Date.now()
  }
  return Date.now()
}

export function nextRandom(seed, cursor) {
  const value = pseudoRandom(seed, cursor)
  return { value, cursor: cursor + 1 }
}

export function randomInt(max, seed, cursor) {
  if (max <= 0) throw new Error('max must be positive')
  const { value, cursor: nextCursor } = nextRandom(seed, cursor)
  return { index: Math.floor(value * max), cursor: nextCursor }
}

export function takeRandomItems(items, count, seed, cursor) {
  const pool = [...items]
  const picked = []
  let currentCursor = cursor
  while (picked.length < count && pool.length > 0) {
    const { index, cursor: updatedCursor } = randomInt(pool.length, seed, currentCursor)
    picked.push(pool.splice(index, 1)[0])
    currentCursor = updatedCursor
  }
  return { items: picked, cursor: currentCursor }
}

export function shuffleItems(items, seed, cursor) {
  const array = [...items]
  let currentCursor = cursor
  for (let i = array.length - 1; i > 0; i -= 1) {
    const { index, cursor: updatedCursor } = randomInt(i + 1, seed, currentCursor)
    ;[array[i], array[index]] = [array[index], array[i]]
    currentCursor = updatedCursor
  }
  return { items: array, cursor: currentCursor }
}

export function deterministicChoice(items, seed, cursor) {
  const { index, cursor: updatedCursor } = randomInt(items.length, seed, cursor)
  return { choice: items[index], cursor: updatedCursor }
}
