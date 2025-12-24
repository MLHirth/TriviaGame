Core constraints (read first)

No complex backend: app must run as a static site (S3/Netlify/Vercel static/NGINX).

Reality check: With zero backend, you cannot fully prevent cheating (users can edit localStorage, patch JS, etc.). You can:

prevent “casual cheating” (back button, URL changes, refresh abuse),

make tampering obvious / invalidate a run,

make prize sharing easy,

optionally add one tiny serverless endpoint later (recommended for real prizes).

This spec implements “best possible client-only” plus an optional minimal serverless hardening.

1. Define the game rules precisely (state machine)

Total available categories in data: N (can be > 7).
Categories selected per run: exactly 7 unique categories randomly drawn from N.

Rounds:

Round 1: Offer 2 categories → player chooses order → plays both (2 categories).

Round 2: Offer 2 categories → player chooses order → plays both (2 categories).

Round 3: From the 3 remaining, randomly pick 1 → play it (1 category).

Total categories played = 5.

Must win ≥ 4 categories (out of the 5 played) to unlock prize.

Category win condition (simple default):

1 question decides the category result (win if correct).

(Optional variant later: best-of-3 per category.)

2. Project skeleton tasks (Svelte + static hosting)

Create Svelte project (Svelte + Vite is enough; SvelteKit optional).

Ensure the app is SPA-only:

Use a single root route.

Do not rely on query params for state.

Add a public/questions.json file for runtime loading.

Add build scripts for static export (npm run build) and local preview.

3. JSON questions system (drop-in later)
   3.1 JSON file location & loading

Goal: You can replace questions.json on the server later without rebuilding.

Put file at: public/questions.json

App loads it on startup using fetch('/questions.json', { cache: 'no-store' })

If fetch fails: show a friendly error screen with retry button.

3.2 JSON schema (precise)

Use this format:

{
"version": 1,
"categories": [
{
"id": "history",
"name": "History",
"questions": [
{
"id": "hist_001",
"prompt": "The Berlin Wall fell in…",
"choices": ["1987", "1989", "1991", "1993"],
"answerIndex": 1,
"explanation": "It fell in 1989.",
"difficulty": "easy",
"tags": ["europe"]
}
]
}
]
}

3.3 Validation rules (must implement)

On load, validate:

version exists and is a number.

categories is an array with length >= 7.

each category:

has id (string, unique), name (string), questions (array length >= 1)

each question:

has prompt (string), choices (array length 2..6), answerIndex (integer within bounds)

optional: id, explanation, difficulty, tags
If validation fails:

Show an error listing what’s wrong (no stack traces).

Block starting a run.

3.4 Category pool handling (more than 7)

When starting a new run:

Randomly select 7 unique categories from the loaded pool.

Keep the selected category IDs frozen for the run.

All gameplay uses only that run’s selected set.

4. Game engine tasks (logic module, no UI)

Create a single “engine” module that owns all rules and transitions. The UI can only call engine actions.

4.1 State model (minimum)

Persist a GameState object containing:

runId (random UUID)

selectedCategoryIds (7 IDs)

roundIndex (1..3)

round1Offered (2), round2Offered (2), round3Pool (3), round3Chosen (1)

round1OrderChosen (bool), round2OrderChosen (bool)

categoriesPlayed (array of IDs in order played)

categoryResults (map id → "unplayed"|"won"|"lost")

winsCount

finished (bool)

prizeUnlocked (bool)

shopInventory (static config)

purchases (array of purchased prize objects)

antiCheat fields (see section 6)

4.2 Deterministic randomness (important)

To reduce “refresh until easy categories,” derive randomness from:

a per-run seed: seed = cryptoRandom + timestamp

use a deterministic PRNG (seeded) to:

select the 7 categories

decide which 2 are offered in each round

decide round 3 random pick
This makes the run consistent even if the app redraws.

4.3 Question selection

For each played category:

Pick a question randomly from that category’s question list.

Avoid repeating the same question within the run (track used question IDs).

If questions have no IDs, generate stable IDs on load (e.g., hash prompt + categoryId).

5. UI/UX tasks (mobile-first)
   5.1 Screens

Implement as a finite set of screens:

Home (Start/Resume, progress, “Shop”)

Round Choice (for rounds 1–2: pick which category first)

Question (tap answer; large buttons for phone)

Result (correct/wrong, updated win count, continue)

End (win/lose, unlock message)

Shop (prizes, locked/unlocked, purchase/redeem/share)

5.2 Phone-friendly requirements

One-column layout, large tap targets (min 44px height).

Avoid long scrolling during the question screen.

Include subtle progress indicators: Round x/3, Wins x/4.

6. Anti-cheat & “no going back” (client-side mitigations)

Again: not perfectly cheat-proof without a server. These steps block casual abuse.

6.1 Prevent URL manipulation from changing state

Use a single route.

Ignore query parameters for game logic.

On load: if URL contains unexpected parameters/fragments, do not interpret them as state.

6.2 Handle back/forward navigation

When the game is “in-progress” (question or between screens):

Use History API to push a “locked” state entry when entering a protected screen.

Listen to popstate:

If popstate occurs during a protected screen:

Immediately return user to the current screen state (pushState again)

OR show a modal: “Navigation detected — this run is invalidated” with options:

“Restart run”

“Return to home (run marked invalid)”
Recommendation: Invalidate the run if the user tries to go back mid-question.

6.3 Handle refresh / closing tab

Use a “run lock” + timestamp:

When a question is shown, record:

questionPresentedAt timestamp

questionId

screen = "question"

If app reloads and finds screen="question" but questionId exists:

Mark run as invalidated (or auto-count as loss for that category) and return to home/end.
This prevents “refresh until correct answer”.

6.4 Detect backgrounding / switching apps

Listen to visibilitychange:

If the user hides the page while on a question screen:

either pause with a “resume” prompt and a timer penalty,

or invalidate the run (stricter).
This discourages looking up answers.

6.5 Disable answer changes

Once an answer is submitted, lock the question result permanently in state.

Never allow re-answering the same question.

6.6 Tamper-evident state (not tamper-proof)

Persist state in storage with an integrity marker:

Create a stateHash that hashes:

runId, selected categories, categoriesPlayed, winsCount, results, and a monotonic actionCounter

Update stateHash on every action.

On load, verify the hash; if mismatch → mark run invalidated.

Important note: because all code runs client-side, a determined cheater can bypass this. But it stops casual localStorage edits.

7. Shop, purchase, redeem, and sharing

You asked for a shop where users can “redeem the gift once won” and share the purchased prize via WhatsApp/anywhere.

7.1 Define “purchase” vs “redeem”

Use two steps:

Unlock happens when winsCount >= 4 at end of run.

Purchase creates a transferable claim (a token) that can be shared.

Redeem means “mark this claim as used” (client-side only) or validate on server (optional hardening).

7.2 Purchase object structure

When user purchases a prize, create:

purchaseId (UUID)

prizeId

createdAt

status: "unredeemed"|"redeemed"

claimToken (random, long)

shareUrl (constructed)

7.3 Share mechanics (WhatsApp + everywhere)

Implement sharing in this priority order:

Web Share API (navigator.share) with:

title: “I won a prize!”

text: includes prize name + redemption instructions + claim code

url: shareUrl

Fallback:

“Copy link” button (clipboard)

“Copy code” button (clipboard)

A WhatsApp deep link button that opens WhatsApp with prefilled text

7.4 How to build a shareUrl safely in a static app

Because you aren’t using a backend, you have two viable approaches:

Option A (simplest, but not private): include token in URL fragment

https://yourgame.com/#/claim/<claimToken>
Pros:

Token isn’t sent to servers via HTTP request path/query in many setups (fragment is client-side).
Cons:

Anyone with the link can claim/redeem in their own browser.

Option B (more controlled): share a claim code only

Share: CLAIM-XXXX-YYYY
Pros:

User can read it and forward easily.
Cons:

Still forgeable without server validation.

You can do both: shareUrl + code.

7.5 Claim screen behavior

Add a “Claim Prize” screen:

User lands with claimToken (from URL fragment route).

App checks:

Is this token known in local purchases?

If yes: show prize details + redeem button.

If no: show “This claim belongs to another device. Enter claim code manually” (optional).
Because it’s client-only, “unknown token” cannot be verified. If you want true cross-device redemption, see 10.

8. Storage strategy (important for phone use)

Use:

localStorage for long-term state (purchases, completed runs).

sessionStorage for sensitive in-progress “question lock” fields (optional extra friction against refresh exploits).

On app start:

load game state

validate integrity

if run invalidated: move it to “history” and start fresh.

9. QA checklist (copy/paste test plan)
   Gameplay correctness

With N categories > 7, run selects exactly 7 unique.

Round 1 offers 2; user chooses order; both played.

Round 2 same.

Round 3 picks 1 from remaining 3.

Exactly 5 categories played.

Prize unlock only if wins >= 4.

Anti-cheat

Back button during question invalidates run (or blocks and warns).

Refresh during question invalidates run (or counts category as loss).

Changing URL/query doesn’t change state.

Backgrounding during question triggers configured penalty.

localStorage tamper (basic) causes invalidation (hash mismatch).

Shop & sharing

Shop shows locked until prizeUnlocked.

Purchase creates a claim token + code.

Share button uses Web Share on mobile.

Copy link/code works on desktop and mobile.

WhatsApp share opens with prefilled message.
