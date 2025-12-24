<script>
  export let items = []
  export let activeId = null
  export let revealedIds = []
  export let spinning = false
  export let tickerPosition = 0
  export let trackCopies = 5

  const MIN_COPIES = 3

  $: copies = Math.max(trackCopies, MIN_COPIES)
  $: totalSlots = items.length * copies
  $: centerOffset = items.length * Math.floor(copies / 2)
  $: normalizedOffset = (() => {
    if (totalSlots === 0) return 0
    const raw = tickerPosition - centerOffset
    return ((raw % totalSlots) + totalSlots) % totalSlots
  })()
  $: trackItems =
    totalSlots > 0
      ? Array.from({ length: totalSlots }, (_, index) => {
          const item = items[index % items.length]
          return { ...item, key: `${item.id}-${index}` }
        })
      : []
  $: activeName = activeId ? nameFor(activeId) : ''

  function nameFor(id) {
    const match = items.find((item) => item.id === id)
    return match?.name || id
  }
</script>

<div class="case-wheel">
  <div class="track-wrapper">
    {#if trackItems.length === 0}
      <div class="empty">Waiting for categories…</div>
    {:else}
      <div class="case-track" style={`--offset:${normalizedOffset};`}>
        {#each trackItems as item (item.key)}
          <div class={`case-slot ${item.status || ''} ${revealedIds.includes(item.id) ? 'revealed' : ''}`}>
            <span>{item.name}</span>
          </div>
        {/each}
      </div>
      <div class="case-pointer"></div>
    {/if}
  </div>
  {#if activeName && trackItems.length > 0}
    <p class={`status ${spinning ? 'rolling' : 'locked'}`}>
      {spinning ? 'Spinning…' : 'Landing on'} <strong>{activeName}</strong>
    </p>
  {/if}
</div>

<div class="case-reveals">
  {#if revealedIds.length === 0}
    <p class="helper">Awaiting reveal…</p>
  {:else}
    <div class="reveal-grid">
      {#each revealedIds as id, index}
        <div class="reveal-card">
          <span>{revealedIds.length > 1 ? (index === 0 ? 'First option' : 'Second option') : 'Selected'}</span>
          <strong>{nameFor(id)}</strong>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .case-wheel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .track-wrapper {
    position: relative;
    width: min(520px, 100%);
    height: 150px;
    border-radius: 30px;
    background: radial-gradient(circle at 40% 40%, #253f1d, #091b0e 70%);
    border: 6px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    box-shadow: 0 25px 40px rgba(6, 31, 11, 0.35);
  }

  .case-track {
    --slot-width: 130px;
    --slot-gap: 0.75rem;
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    gap: var(--slot-gap);
    transform: translate3d(
      calc(-50% - var(--offset) * (var(--slot-width) + var(--slot-gap))),
      -50%,
      0
    );
    transition: transform 0.1s linear;
  }

  .case-slot {
    width: var(--slot-width);
    min-width: var(--slot-width);
    height: 82px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.08);
    border: 2px solid rgba(255, 255, 255, 0.25);
    color: #f6ffed;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 0.6rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    box-shadow: 0 18px 30px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(2px);
  }

  .case-slot.played {
    opacity: 0.45;
  }

  .case-slot.selected {
    border-color: var(--accent);
    color: var(--accent);
  }

  .case-slot.revealed {
    border-color: #ffd75c;
    color: #ffd75c;
    background: rgba(255, 215, 92, 0.15);
  }

  .case-pointer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 6px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, transparent, #ffd75c, transparent);
    box-shadow: 0 0 16px rgba(255, 215, 92, 0.8);
    pointer-events: none;
  }

  .status {
    font-size: 0.9rem;
    color: #1f3b15;
  }

  .status strong {
    color: var(--forest-dark);
  }

  .status.rolling {
    color: #0e2d11;
  }

  .case-reveals {
    width: min(520px, 100%);
    margin: 1rem auto 0;
  }

  .reveal-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .reveal-card {
    flex: 1;
    min-width: 160px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 18px;
    border: 2px solid rgba(4, 43, 12, 0.1);
    padding: 0.8rem 1rem;
    box-shadow: 0 12px 30px rgba(4, 43, 12, 0.15);
  }

  .reveal-card span {
    font-size: 0.8rem;
    color: rgba(4, 43, 12, 0.6);
  }

  .reveal-card strong {
    display: block;
    color: var(--forest-dark);
    font-size: 1.1rem;
  }

  .helper {
    text-align: center;
    color: rgba(4, 43, 12, 0.6);
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.8);
    font-weight: 600;
  }

  @media (max-width: 540px) {
    .case-track {
      --slot-width: 110px;
    }

    .track-wrapper {
      height: 130px;
    }

    .case-slot {
      height: 72px;
      font-size: 0.85rem;
    }
  }
</style>
