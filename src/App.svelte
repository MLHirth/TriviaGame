<script>
  import { onMount, onDestroy } from 'svelte'
  import { engine } from './lib/engine'
  import CategoryWheel from './lib/CategoryWheel.svelte'

const CATEGORY_QUESTION_COUNT = 5
const WHEEL_SPIN_SEGMENT_MS = 1800
const WHEEL_REVEAL_PAUSE_MS = 650
const WHEEL_FINAL_PAUSE_MS = 900
const WHEEL_TRACK_COPIES = 5
const WHEEL_TICK_MS = 85
const { state, actions } = engine

  let appState
  let unsubscribe = state.subscribe((value) => {
    appState = value
  })

let clipboardMessage = ''
let clipboardTimeout
let wheelTimeout
let wheelInterval
let timerInterval
let timerProgress = 1
let timerSeconds = 0
let timerExpired = false
let wheelRevealedIds = []
let wheelActiveId = null
let wheelSpinning = false
let wheelSpinQueue = []
let wheelTickerPosition = 0
let wheelPool = []
let wheelSpinInitialized = false

  const DAY_MS = 24 * 60 * 60 * 1000

  function categoryName(id) {
    return appState?.categoryMap?.[id]?.name || id
  }

  function hasActiveRun() {
    return Boolean(appState?.run && !appState.run.finished)
  }

  function runsRemaining() {
    if (!appState) return 0
    const limit = appState.dailyLimit || 0
    const recent = (appState.playLog || []).filter((timestamp) => Date.now() - timestamp < DAY_MS).length
    return Math.max(limit - recent, 0)
  }

  function isDailyClosed() {
    if (!appState?.closedUntil) return false
    return Date.now() < appState.closedUntil
  }

  function unlockTime() {
    if (!isDailyClosed()) return ''
    return new Date(appState.closedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function currentOffer() {
    return appState?.run?.currentOffer || null
  }

  function wheelItems() {
    if (!appState?.run) return []
    return appState.run.selectedCategoryIds.map((id) => {
      let status = 'pending'
      if (appState.run.categoriesPlayed.includes(id)) status = 'played'
      if (appState.run.currentSession?.categoryId === id) status = 'selected'
      return { id, name: categoryName(id), status }
    })
  }

  function questionStats() {
    const session = appState?.run?.currentSession
    if (!session) return { number: 0, total: 0 }
    return { number: session.answers.length + 1, total: session.questions.length }
  }

  function buildShareText(purchase) {
    return `I won ${purchase.prizeName}! Use claim code ${purchase.claimCode} at the venue. ${purchase.shareUrl}`
  }

  function animatedCardSvg(purchase) {
    const gradient = purchase.claimToken.slice(0, 6)
    const timestamp = new Date(purchase.createdAt).toLocaleString()
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="540" height="860" viewBox="0 0 540 860" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad-${gradient}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#58cc02">
        <animate attributeName="stop-color" values="#58cc02;#ffd75c;#58cc02" dur="4s" repeatCount="indefinite" />
      </stop>
      <stop offset="100%" stop-color="#6b21a8">
        <animate attributeName="stop-color" values="#6b21a8;#3b82f6;#6b21a8" dur="4s" repeatCount="indefinite" />
      </stop>
    </linearGradient>
  </defs>
  <rect width="540" height="860" rx="40" fill="url(#grad-${gradient})" opacity="0.95" />
  <text x="50%" y="120" text-anchor="middle" fill="white" font-size="34" font-family="Nunito" opacity="0.95">BILLIARDS GIFT CARD</text>
  <text x="50%" y="240" text-anchor="middle" fill="white" font-size="22" font-family="Nunito" opacity="0.8">Claim code</text>
  <text x="50%" y="290" text-anchor="middle" fill="white" font-size="58" font-family="DM Mono">${purchase.claimCode}</text>
  <text x="50%" y="340" text-anchor="middle" fill="white" font-size="18" font-family="Nunito" opacity="0.8">Issued ${timestamp}</text>
  <g>
    <rect x="170" y="400" width="200" height="200" rx="30" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.4)" />
    <rect x="200" y="450" width="140" height="80" rx="12" fill="#0f172a" opacity="0.6" />
    <rect x="210" y="460" width="60" height="20" fill="#ffdd00" />
    <rect x="275" y="460" width="55" height="20" fill="#ffdd00" />
    <rect x="210" y="485" width="90" height="25" fill="#fff" />
    <rect x="305" y="485" width="30" height="25" fill="#fff" />
  </g>
  <text x="50%" y="740" text-anchor="middle" fill="white" font-size="18" font-family="Nunito" opacity="0.9">Show this animated card at the billiards desk to redeem.</text>
</svg>`
  }

  function buildAnimatedCardFile(purchase) {
    const svg = animatedCardSvg(purchase)
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    return new File([blob], `${purchase.claimCode}.svg`, { type: 'image/svg+xml' })
  }

  async function sharePurchase(purchase) {
    if (!purchase) return
    const shareText = buildShareText(purchase)
    try {
      const file = buildAnimatedCardFile(purchase)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Billiards Gift Card',
          text: shareText,
          files: [file],
        })
        return
      }
    } catch (error) {
      console.warn('Share with file failed', error)
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Billiards Gift Card', text: shareText, url: purchase.shareUrl })
        return
      } catch (error) {
        // ignore cancellation
      }
    }
    copyValue(shareText, 'Share text')
  }

  function downloadCard(purchase) {
    if (!purchase) return
    const file = buildAnimatedCardFile(purchase)
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async function copyValue(value, label) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      clipboardMessage = `${label} copied to clipboard`
    } catch (error) {
      clipboardMessage = 'Clipboard is unavailable in this browser.'
    }
    clearTimeout(clipboardTimeout)
    clipboardTimeout = setTimeout(() => (clipboardMessage = ''), 2500)
  }

  function closeClipboardMessage() {
    clipboardMessage = ''
    clearTimeout(clipboardTimeout)
  }

  function openPrizeCard(purchase) {
    if (!purchase) return
    actions.viewPrizeCard(purchase.purchaseId)
  }

  function closePrizeCard() {
    actions.closeModal()
  }

  function wheelIsSpinningState() {
    return appState?.run?.currentStep === 'wheel'
  }

  function baseTickerPosition(length) {
    if (!length) return 0
    return length * Math.floor(WHEEL_TRACK_COPIES / 2)
  }

  function startTicker() {
    if (wheelPool.length === 0) return
    const poolLength = wheelPool.length
    const cycleLength = poolLength * WHEEL_TRACK_COPIES
    if (!cycleLength) return
    if (wheelTickerPosition === 0 || wheelTickerPosition >= cycleLength) {
      wheelTickerPosition = baseTickerPosition(poolLength) % cycleLength
    }
    wheelActiveId = wheelPool[wheelTickerPosition % poolLength]
    wheelSpinning = true
    wheelInterval = setInterval(() => {
      wheelTickerPosition = (wheelTickerPosition + 1) % cycleLength
      wheelActiveId = wheelPool[wheelTickerPosition % poolLength]
    }, WHEEL_TICK_MS)
  }

  function pauseTicker() {
    clearInterval(wheelInterval)
    wheelInterval = null
    wheelSpinning = false
  }

  function runWheelQueue() {
    if (wheelSpinQueue.length === 0) {
      wheelTimeout = setTimeout(() => actions.confirmWheelReveal(), WHEEL_FINAL_PAUSE_MS)
      return
    }
    wheelTimeout = setTimeout(() => {
      pauseTicker()
      const revealed = wheelSpinQueue.shift()
      wheelActiveId = revealed
      wheelRevealedIds = [...wheelRevealedIds, revealed]
      const pause = wheelSpinQueue.length > 0 ? WHEEL_REVEAL_PAUSE_MS : WHEEL_FINAL_PAUSE_MS
      wheelTimeout = setTimeout(() => {
        if (wheelSpinQueue.length > 0) {
          startTicker()
          runWheelQueue()
        } else {
          actions.confirmWheelReveal()
        }
      }, pause)
    }, WHEEL_SPIN_SEGMENT_MS)
  }

  function stopWheelSpin() {
    pauseTicker()
    clearTimeout(wheelTimeout)
    wheelTimeout = null
    wheelSpinQueue = []
    wheelPool = []
  }

  function startWheelSpin() {
    stopWheelSpin()
    const pool = appState?.run?.selectedCategoryIds || []
    const offer = currentOffer()
    if (pool.length === 0 || !offer?.options?.length) return false
    wheelPool = [...pool]
    wheelSpinQueue = [...offer.options]
    wheelRevealedIds = []
    wheelTickerPosition = baseTickerPosition(pool.length)
    startTicker()
    runWheelQueue()
    return true
  }

  $: if (wheelIsSpinningState()) {
    if (!wheelSpinInitialized) {
      const started = startWheelSpin()
      if (started) wheelSpinInitialized = true
    }
  } else {
    wheelSpinInitialized = false
    stopWheelSpin()
    const offer = currentOffer()
    if (offer?.options?.length) {
      wheelRevealedIds = offer.options
      wheelActiveId = offer.options[offer.options.length - 1]
    } else if (!appState?.run) {
      wheelRevealedIds = []
      wheelActiveId = null
    }
  }

  function stopQuestionTimer() {
    clearInterval(timerInterval)
    timerInterval = null
    timerExpired = false
    timerProgress = 1
    timerSeconds = 0
  }

  function armQuestionTimer(timer) {
    stopQuestionTimer()
    if (!timer) return
    const { deadline, duration } = timer
    const update = () => {
      const now = Date.now()
      const remaining = Math.max(deadline - now, 0)
      timerProgress = remaining / duration
      timerSeconds = Math.ceil(remaining / 1000)
      if (remaining <= 0 && !timerExpired) {
        timerExpired = true
        actions.timeoutQuestion()
      }
    }
    update()
    timerInterval = setInterval(update, 100)
  }

  $: if (appState?.run?.currentStep === 'question' && appState.run.questionTimer) {
    armQuestionTimer(appState.run.questionTimer)
  } else {
    stopQuestionTimer()
  }

  function shareUnavailable() {
    return Boolean(appState?.prizeClaimedAt)
  }

  function handleWheelSkip() {
    stopWheelSpin()
    const reveal = currentOffer()?.options || []
    wheelRevealedIds = reveal
    wheelActiveId = reveal[reveal.length - 1] || wheelActiveId
    actions.confirmWheelReveal()
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && appState?.modal?.type === 'prizeCard') {
      event.preventDefault()
      closePrizeCard()
    }
  }

  onMount(() => {
    const popHandler = () => {
      actions.handleNavigationViolation()
      if (appState?.run?.currentStep === 'question') {
        history.pushState({ locked: true }, '', window.location.href)
      }
    }
    const visibilityHandler = () => {
      if (document.hidden) {
        actions.handleBackgrounding()
      }
    }
    const hashHandler = () => {
      const token = window.location.hash.match(/#\/claim\/(.+)/)?.[1]
      if (token) actions.openClaim(token)
    }
    window.addEventListener('popstate', popHandler)
    document.addEventListener('visibilitychange', visibilityHandler)
    window.addEventListener('hashchange', hashHandler)
    window.addEventListener('keydown', handleKeydown)

    const token = window.location.hash.match(/#\/claim\/(.+)/)?.[1]
    if (token) actions.openClaim(token)

    return () => {
      window.removeEventListener('popstate', popHandler)
      document.removeEventListener('visibilitychange', visibilityHandler)
      window.removeEventListener('hashchange', hashHandler)
      window.removeEventListener('keydown', handleKeydown)
    }
  })

  onDestroy(() => {
    unsubscribe()
    clearTimeout(clipboardTimeout)
    clearTimeout(wheelTimeout)
    clearInterval(wheelInterval)
    stopQuestionTimer()
  })
</script>

<main>
  {#if appState?.message}
    <div class="banner">
      <span>{appState.message}</span>
      <button class="ghost" on:click={actions.acknowledgeMessage}>Dismiss</button>
    </div>
  {/if}

  {#if appState?.tamperDetected}
    <div class="banner warning">
      <span>Previous manual edits were detected. Compromised runs restart automatically.</span>
    </div>
  {/if}

  {#if clipboardMessage}
    <div class="banner success">
      <span>{clipboardMessage}</span>
      <button class="ghost" on:click={closeClipboardMessage}>Close</button>
    </div>
  {/if}

  {#if appState?.questionStatus === 'loading'}
    <section class="screen hero">
      <h1>Loading trivia pool…</h1>
      <p class="subtitle">Fetching categories from multiple files.</p>
    </section>
  {:else if appState?.questionStatus === 'error'}
    <section class="screen hero">
      <h1>Unable to load questions</h1>
      <p>{appState?.questionError?.message}</p>
      <button on:click={actions.retryLoad}>Retry</button>
    </section>
  {:else}
    {#if appState?.screen === 'home'}
      <section class="screen hero">
        <h1>Trivia Gauntlet</h1>
        <p class="subtitle">Survive 5 rounds (25 questions) to unlock the holographic billiards card.</p>
        <div class="stat-grid">
          <div class="stat">
            <span>Daily plays</span>
            <strong>{runsRemaining()} / {appState?.dailyLimit || 0}</strong>
          </div>
          <div class="stat">
            <span>Wins needed</span>
            <strong>{Math.max(0, 4 - (appState?.run?.winsCount || 0))}</strong>
          </div>
        </div>
        {#if isDailyClosed()}
          <div class="card notice">
            <h2>Arcade closed today</h2>
            <p>Come back after {unlockTime()} for a fresh run.</p>
          </div>
        {/if}
        {#if hasActiveRun()}
          <div class="card emphasis">
            <header>
              <h2>Run in progress</h2>
              <span>Round {appState.run.roundPointer + 1} / 5</span>
            </header>
            <p>Wins: {appState.run.winsCount} / 5 — {Math.max(0, 4 - appState.run.winsCount)} more for the prize.</p>
            <div class="actions">
              <button on:click={handleWheelSkip} disabled={appState.run.currentStep !== 'roundChoice' && appState.run.currentStep !== 'wheel'}>
                Resume round
              </button>
              <button class="ghost" on:click={actions.restartRun}>Restart</button>
            </div>
          </div>
        {:else}
          <div class="card emphasis">
            <h2>Ready to play?</h2>
            <p>The wheel reveals 2 categories for rounds 1-3 and locks you into the final two.</p>
            <button on:click={actions.startNewRun} disabled={isDailyClosed()}>Start run</button>
          </div>
        {/if}
      </section>

      <section class="screen secondary">
        <h2>Billiards gift card</h2>
        <p>Only one shimmering gift card exists. Once claimed, the shop becomes a museum.</p>
        <button on:click={actions.openShop}>Open shop</button>
        <p class="helper">{shareUnavailable() ? 'Gift card already claimed—play for fun!' : 'Win 4 categories to reveal the card.'}</p>
      </section>
    {:else if appState?.screen === 'wheel'}
      <section class="screen hero">
        <h1>Wheel of categories</h1>
        <p class="subtitle">Spinning…</p>
        <CategoryWheel
          items={wheelItems()}
          activeId={wheelActiveId}
          revealedIds={wheelRevealedIds}
          spinning={wheelSpinning && wheelIsSpinningState()}
          tickerPosition={wheelTickerPosition}
          trackCopies={WHEEL_TRACK_COPIES}
        />
        {#if currentOffer()?.type === 'choice'}
          <p>The wheel will throw two categories for you to choose from.</p>
        {:else}
          <p>The wheel will force you to play the highlighted category.</p>
        {/if}
        <button class="ghost" on:click={handleWheelSkip}>Skip animation</button>
      </section>
    {:else if appState?.screen === 'roundChoice'}
      <section class="screen hero">
        <h1>Choose your fate</h1>
        <p class="subtitle">Select the category to attempt first. Each category hides 5 rapid-fire questions.</p>
        <CategoryWheel
          items={wheelItems()}
          activeId={wheelActiveId}
          revealedIds={wheelRevealedIds}
          spinning={false}
          tickerPosition={wheelTickerPosition}
          trackCopies={WHEEL_TRACK_COPIES}
        />
        <div class="round-options">
          {#each currentOffer()?.options || [] as categoryId}
            <div class="card option">
              <h2>{categoryName(categoryId)}</h2>
              <p>Answer 5 questions from this category.</p>
              <button on:click={() => actions.chooseCategory(categoryId)}>Play this category</button>
            </div>
          {/each}
        </div>
      </section>
    {:else if appState?.screen === 'question'}
      <section class="screen hero question-card">
        <div class="progress">
          <span>Round {appState?.run?.roundPointer + 1} / 5</span>
          <span>Wins {appState?.run?.winsCount} / 5</span>
        </div>
        <div class="timer">
          <div class="timer-bar" style={`width:${Math.max(timerProgress, 0) * 100}%`}></div>
        </div>
        <div class="question-meta">
          <span>{categoryName(appState?.run?.currentSession?.categoryId)}</span>
          <span>Question {questionStats().number} / {questionStats().total}</span>
          <span>{timerSeconds > 0 ? `${timerSeconds}s left` : ''}</span>
        </div>
        <h1>{appState?.run?.currentQuestion?.prompt}</h1>
        <div class="choices">
          {#each appState?.run?.currentQuestion?.choices || [] as choice, index}
            <button class="choice" on:click={() => actions.submitAnswer(index)}>{choice}</button>
          {/each}
        </div>
        <p class="note">Timer hits zero? The question counts as incorrect.</p>
      </section>
    {:else if appState?.screen === 'answer'}
      <section class="screen hero">
        <div class={`result-card ${appState?.run?.lastResult?.correct ? 'correct' : 'incorrect'}`}>
          <h1>{appState?.run?.lastResult?.correct ? 'Correct!' : appState?.run?.lastResult?.timedOut ? 'Time up!' : 'Incorrect'}</h1>
          <p>{appState?.run?.lastResult?.prompt}</p>
          <p class="explanation">{appState?.run?.lastResult?.explanation}</p>
          <p>
            Progress {appState?.run?.currentSession ? questionStats().number - 1 : CATEGORY_QUESTION_COUNT} /
            {CATEGORY_QUESTION_COUNT}
          </p>
          <button on:click={actions.continueAfterAnswer}>Continue</button>
        </div>
      </section>
    {:else if appState?.screen === 'end'}
      <section class="screen hero">
        <h1>{appState?.run?.prizeUnlocked && !shareUnavailable() ? 'You unlocked the gift card!' : 'Run complete'}</h1>
        <p>You won {appState?.run?.winsCount} of 5 categories.</p>
        <div class="actions">
          <button on:click={actions.startNewRun} disabled={isDailyClosed()}>Play again</button>
          <button class="ghost" on:click={actions.openShop}>Open shop</button>
        </div>
      </section>
    {/if}
  {/if}

  {#if appState?.modal?.type === 'shop'}
    <div class="modal-backdrop">
      <div class="modal">
        <header>
          <h2>Prize shop</h2>
          <button class="ghost" on:click={actions.closeModal}>Close</button>
        </header>
        <p class="subtitle">The holographic gift card exists once. First to finish wins.</p>
        <div class="inventory single">
          {#each appState.shopInventory as prize}
            <div class="card">
              <h3>{prize.name}</h3>
              <p>{prize.description}</p>
              <small>{prize.instructions}</small>
              <button
                disabled={!appState?.run?.prizeUnlocked || appState?.purchases.length > 0 || shareUnavailable()}
                on:click={() => actions.purchasePrize(prize.id)}
              >
                {shareUnavailable()
                  ? 'Gift card claimed'
                  : appState?.purchases.length > 0
                  ? 'Already generated'
                  : appState?.run?.prizeUnlocked
                  ? 'Reveal gift card'
                  : 'Locked until win'}
              </button>
            </div>
          {/each}
        </div>
        <section>
          <h3>Your claims</h3>
          {#if appState?.purchases.length === 0}
            <p>No purchases yet.</p>
          {:else}
            {#each appState.purchases as purchase}
              <div class="card purchase">
                <header>
                  <strong>{purchase.prizeName}</strong>
                  <span class={`status ${purchase.status}`}>{purchase.status}</span>
                </header>
                <p>Claim code: <span class="code">{purchase.claimCode}</span></p>
                <p>Share link: <a href={purchase.shareUrl} target="_blank" rel="noreferrer">{purchase.shareUrl}</a></p>
                <div class="share-grid">
                  <button on:click={() => sharePurchase(purchase)}>Share animated card</button>
                  <button class="ghost" on:click={() => copyValue(purchase.shareUrl, 'Link')}>Copy link</button>
                  <button class="ghost" on:click={() => copyValue(purchase.claimCode, 'Code')}>Copy code</button>
                  <button class="ghost" on:click={() => downloadCard(purchase)}>Download animated SVG</button>
                </div>
                <div class="actions">
                  <button class="ghost" on:click={() => openPrizeCard(purchase)}>View card</button>
                  {#if purchase.status === 'unredeemed'}
                    <button class="ghost" on:click={() => actions.redeemPrize(purchase.purchaseId)}>Mark redeemed</button>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </section>
      </div>
    </div>
  {/if}

  {#if appState?.modal?.type === 'prizeCard'}
    <div class="modal-backdrop card-mode">
      <div class="card-stage">
        <button class="card-close" on:click={closePrizeCard}>Close</button>
        {#if appState.modal.purchase}
          <div class="prize-card" aria-live="polite">
            <div class="card-glow"></div>
            <div class="card-face">
              <p class="card-eyebrow">VIP ACCESS</p>
              <h2>{appState.modal.purchase.prizeName}</h2>
              <p>{appState.modal.purchase.description}</p>
              <p class="card-code">{appState.modal.purchase.claimCode}</p>
              <p class="card-instructions">
                {appState.modal.purchase.status === 'redeemed'
                  ? 'Already redeemed — hologram remains for verification.'
                  : 'Show this animated hologram at the desk to redeem your free game of billiards.'}
              </p>
            </div>
          </div>
          <div class="card-actions">
            <button on:click={() => sharePurchase(appState.modal.purchase)}>Share animated card</button>
            <button class="ghost" on:click={() => copyValue(appState.modal.purchase.shareUrl, 'Link')}>Copy link</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if appState?.modal?.type === 'claim'}
    <div class="modal-backdrop">
      <div class="modal">
        <header>
          <h2>Claim prize</h2>
          <button class="ghost" on:click={actions.closeModal}>Close</button>
        </header>
        {#if appState.modal.purchase}
          <p>Prize: <strong>{appState.modal.purchase.prizeName}</strong></p>
          <p>Code: <span class="code">{appState.modal.purchase.claimCode}</span></p>
          <p>Status: {appState.modal.purchase.status}</p>
        {:else}
          <p>This claim token belongs to another device. Ask the winner to share their animated card.</p>
        {/if}
      </div>
    </div>
  {/if}
</main>
