const STORAGE_KEY = 'triviaGame.state.v2'
const LOCK_KEY = 'triviaGame.lock.v1'

function getLocalStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch (error) {
    console.warn('localStorage unavailable', error)
    return null
  }
}

function getSessionStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch (error) {
    console.warn('sessionStorage unavailable', error)
    return null
  }
}

export function computeStateHash(run) {
  if (!run) return ''
  const payload = {
    runId: run.runId,
    selectedCategoryIds: run.selectedCategoryIds,
    categoriesPlayed: run.categoriesPlayed,
    winsCount: run.winsCount,
    categoryResults: run.categoryResults,
    actionCounter: run.actionCounter ?? 0,
  }
  const json = JSON.stringify(payload)
  let hash = 0
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash + json.charCodeAt(i) * (i + 1)) % 2147483647
  }
  return hash.toString(16)
}

export function loadPersistedState() {
  const storage = getLocalStorage()
  if (!storage)
    return {
      run: null,
      purchases: [],
      tampered: false,
      playLog: [],
      prizeClaimedAt: null,
    }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw)
      return {
        run: null,
        purchases: [],
        tampered: false,
        playLog: [],
        prizeClaimedAt: null,
      }
    const data = JSON.parse(raw)
    const run = data.run || null
    const purchases = data.purchases || []
    const playLog = Array.isArray(data.playLog) ? data.playLog : []
    const prizeClaimedAt = data.prizeClaimedAt || null
    let tampered = false
    if (run) {
      const expected = computeStateHash(run)
      if (expected !== run.stateHash) {
        tampered = true
      }
    }
    return {
      run: tampered ? null : run,
      purchases,
      playLog,
      prizeClaimedAt,
      tampered,
    }
  } catch (error) {
    console.error('Failed to load state', error)
    return { run: null, purchases: [], playLog: [], prizeClaimedAt: null, tampered: true }
  }
}

export function savePersistedState({ run, purchases, playLog, prizeClaimedAt }) {
  const storage = getLocalStorage()
  if (!storage) return
  const payload = {
    run,
    purchases,
    playLog,
    prizeClaimedAt,
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function storeQuestionLock(lock) {
  const session = getSessionStorage()
  if (!session) return
  if (!lock) {
    session.removeItem(LOCK_KEY)
    return
  }
  session.setItem(LOCK_KEY, JSON.stringify(lock))
}

export function loadQuestionLock() {
  const session = getSessionStorage()
  if (!session) return null
  try {
    const raw = session.getItem(LOCK_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    console.error('Failed to parse question lock', error)
    return null
  }
}

export function clearQuestionLock() {
  storeQuestionLock(null)
}
