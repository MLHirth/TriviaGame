import { writable, get } from "svelte/store";
import { fetchQuestionBank } from "./questions";
import { generateSeed, takeRandomItems, shuffleItems } from "./random";
import {
    loadPersistedState,
    savePersistedState,
    computeStateHash,
    loadQuestionLock,
    storeQuestionLock,
    clearQuestionLock,
} from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const QUESTION_BATCH_SIZE = 5;
const DAILY_PLAY_LIMIT =
    Number(import.meta.env.VITE_DAILY_PLAY_LIMIT ?? 3) || 3;
const QUESTION_TIME_LIMIT =
    Number(import.meta.env.VITE_QUESTION_TIME_LIMIT_MS ?? 20000) || 20000;

const SHOP_ITEM = {
    id: "billiards-card",
    name: "Billiards Night Gift Card",
    description: "Redeem for a free game of billiards for you and a friend.",
    instructions:
        "Show this animated hologram at the desk to redeem your table time.",
    codePrefix: "CUE",
};

function createInitialState() {
    return {
        questionStatus: "loading",
        questionError: null,
        screen: "loading",
        categories: [],
        categoryMap: {},
        run: null,
        purchases: [],
        shopInventory: [SHOP_ITEM],
        prizeClaimedAt: null,
        message: "",
        tamperDetected: false,
        lastInvalidation: null,
        modal: null,
        playLog: [],
        closedUntil: null,
        dailyLimit: DAILY_PLAY_LIMIT,
    };
}

function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `run-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function nowISO() {
    return new Date().toISOString();
}

function buildClaimCode(prefix) {
    const chunk = Math.floor(Math.random() * 999999);
    return (
        `${prefix}`.toUpperCase().slice(0, 4) +
        "-" +
        chunk.toString().padStart(6, "0")
    );
}

function buildShareUrl(token) {
    if (typeof window === "undefined")
        return `https://example.com/#/claim/${token}`;
    return `${window.location.origin}/#/claim/${token}`;
}

function evaluatePlayWindow(log = []) {
    const now = Date.now();
    const filtered = (log || []).filter(
        (timestamp) => now - timestamp < DAY_MS
    );
    filtered.sort((a, b) => a - b);
    let closedUntil = null;
    if (filtered.length >= DAILY_PLAY_LIMIT) {
        closedUntil = filtered[0] + DAY_MS;
    }
    return { pruned: filtered, closedUntil };
}

function isClosed(closedUntil) {
    return Boolean(closedUntil && closedUntil > Date.now());
}

function sanitizeRun(raw) {
    if (!raw) return null;
    const run = { ...raw };
    run.selectedCategoryIds = Array.isArray(run.selectedCategoryIds)
        ? run.selectedCategoryIds
        : [];
    run.remainingCategoryIds = Array.isArray(run.remainingCategoryIds)
        ? run.remainingCategoryIds
        : [...run.selectedCategoryIds];
    run.roundPointer = Number.isInteger(run.roundPointer)
        ? run.roundPointer
        : 0;
    run.currentOffer = run.currentOffer || null;
    run.currentSession = run.currentSession || null;
    run.currentQuestion = run.currentQuestion || null;
    run.questionTimer = run.questionTimer || null;
    run.lastResult = run.lastResult || null;
    run.categoryResults =
        run.categoryResults ||
        Object.fromEntries(
            run.selectedCategoryIds.map((id) => [id, "unplayed"])
        );
    run.categoriesPlayed = Array.isArray(run.categoriesPlayed)
        ? run.categoriesPlayed
        : [];
    run.questionHistory = run.questionHistory || {};
    run.winsCount = run.winsCount || 0;
    run.finished = Boolean(run.finished);
    run.prizeUnlocked = Boolean(run.prizeUnlocked);
    run.randSeed = run.randSeed || generateSeed();
    run.randCursor = run.randCursor || 0;
    run.actionCounter = run.actionCounter || 0;
    run.currentStep = run.currentStep || "wheel";
    run.wheelRevealAt = run.wheelRevealAt || null;
    run.stateHash = run.stateHash || computeStateHash(run);
    return run;
}

function cloneRun(run) {
    if (!run) return null;
    return {
        ...run,
        selectedCategoryIds: [...run.selectedCategoryIds],
        remainingCategoryIds: [...run.remainingCategoryIds],
        categoriesPlayed: [...run.categoriesPlayed],
        categoryResults: { ...run.categoryResults },
        questionHistory: Object.fromEntries(
            Object.entries(run.questionHistory).map(([key, value]) => [
                key,
                [...value],
            ])
        ),
        currentOffer: run.currentOffer ? { ...run.currentOffer } : null,
        currentSession: run.currentSession
            ? {
                  ...run.currentSession,
                  questions: [...run.currentSession.questions],
                  answers: [...run.currentSession.answers],
              }
            : null,
        currentQuestion: run.currentQuestion
            ? { ...run.currentQuestion }
            : null,
        questionTimer: run.questionTimer ? { ...run.questionTimer } : null,
        lastResult: run.lastResult ? { ...run.lastResult } : null,
    };
}

function bumpIntegrity(run) {
    run.actionCounter = (run.actionCounter || 0) + 1;
    run.stateHash = computeStateHash(run);
}

function validateRun(run, categoryMap) {
    if (!run) return true;
    if (!run.selectedCategoryIds.every((id) => Boolean(categoryMap[id]))) {
        return false;
    }
    if (!run.remainingCategoryIds.every((id) => Boolean(categoryMap[id]))) {
        return false;
    }
    return true;
}

function determineRoundType(pointer) {
    return pointer < 3 ? "choice" : "forced";
}

function pickOffer(run, count) {
    const available = [...run.remainingCategoryIds];
    const amount = Math.min(count, available.length);
    if (amount === 0) {
        return [];
    }
    const { items, cursor } = takeRandomItems(
        available,
        amount,
        run.randSeed,
        run.randCursor || 0
    );
    run.randCursor = cursor;
    if (items.length === amount) {
        return items;
    }
    return available.slice(0, amount);
}

function pickQuestionBatch(run, category) {
    if (!category || !Array.isArray(category.questions)) {
        throw new Error("Missing question data");
    }
    const { items, cursor } = shuffleItems(
        category.questions,
        run.randSeed,
        run.randCursor || 0
    );
    run.randCursor = cursor;
    const batch = items.slice(0, QUESTION_BATCH_SIZE);
    if (batch.length < QUESTION_BATCH_SIZE) {
        const extended = [...batch];
        while (extended.length < QUESTION_BATCH_SIZE) {
            extended.push(
                category.questions[extended.length % category.questions.length]
            );
        }
        return extended;
    }
    return batch;
}

function shuffleQuestionChoices(run, question) {
    if (!question?.choices) return question;
    const decorated = question.choices.map((choice, index) => ({
        choice,
        index,
    }));
    const { items, cursor } = shuffleItems(
        decorated,
        run.randSeed,
        run.randCursor || 0
    );
    run.randCursor = cursor;
    const choices = items.map((entry) => entry.choice);
    const answerIndex = items.findIndex(
        (entry) => entry.index === question.answerIndex
    );
    return {
        ...question,
        choices,
        answerIndex: answerIndex === -1 ? 0 : answerIndex,
    };
}

function buildQuestionTimer() {
    const deadline = Date.now() + QUESTION_TIME_LIMIT;
    return { deadline, duration: QUESTION_TIME_LIMIT };
}

function setQuestionLock(run) {
    storeQuestionLock({
        runId: run.runId,
        categoryId: run.currentSession?.categoryId,
        questionId: run.currentQuestion?.id,
        presentedAt: Date.now(),
        deadline: run.questionTimer?.deadline,
    });
}

function clearLocks() {
    clearQuestionLock();
}

function determineCategoryWin(session) {
    const needed = Math.ceil(QUESTION_BATCH_SIZE / 2);
    return session.correctCount >= needed;
}

function determineCategoryLockedLoss(session) {
    const needed = Math.ceil(QUESTION_BATCH_SIZE / 2);
    const remaining = QUESTION_BATCH_SIZE - session.answers.length;
    return session.correctCount + remaining < needed;
}

function createEngine() {
    const store = writable(createInitialState());
    const context = {
        store,
        questionBank: null,
        categoryMap: {},
    };

    function persist(run, purchases, playLog, prizeClaimedAt) {
        savePersistedState({ run, purchases, playLog, prizeClaimedAt });
    }

    function updateRun(mutator) {
        context.store.update((state) => {
            if (!state.run) return state;
            const run = cloneRun(state.run);
            const proceed = mutator(run, state);
            if (proceed === false) {
                return state;
            }
            bumpIntegrity(run);
            persist(run, state.purchases, state.playLog, state.prizeClaimedAt);
            return {
                ...state,
                run,
                screen: run.finished ? "end" : run.currentStep,
            };
        });
    }

    function scheduleNextRound(run) {
        if (run.roundPointer >= 5) {
            run.finished = true;
            run.prizeUnlocked = run.winsCount >= 4;
            run.currentStep = "end";
            clearLocks();
            return;
        }
        const type = determineRoundType(run.roundPointer);
        const options = pickOffer(run, type === "choice" ? 2 : 1);
        run.currentOffer = { type, options };
        run.currentStep = "wheel";
        run.wheelRevealAt = Date.now();
    }

    function beginSession(run, categoryId) {
        const category = context.categoryMap[categoryId];
        if (!category) {
            throw new Error(`Missing category data for ${categoryId}`);
        }
        const questions = pickQuestionBatch(run, category);
        const preparedQuestions = questions.map((question) =>
            shuffleQuestionChoices(run, question)
        );
        run.currentSession = {
            categoryId,
            questions: preparedQuestions,
            index: 0,
            answers: [],
            correctCount: 0,
        };
        run.currentQuestion = {
            ...preparedQuestions[0],
            id: preparedQuestions[0].id,
        };
        run.questionTimer = buildQuestionTimer();
        run.currentStep = "question";
        setQuestionLock(run);
    }

    function completeSession(run) {
        const session = run.currentSession;
        if (!session) return;
        const won = determineCategoryWin(session);
        run.categoryResults[session.categoryId] = won ? "won" : "lost";
        if (won) {
            run.winsCount += 1;
        }
        run.categoriesPlayed = [...run.categoriesPlayed, session.categoryId];
        run.remainingCategoryIds = run.remainingCategoryIds.filter(
            (id) => id !== session.categoryId
        );
        run.currentSession = null;
        run.currentQuestion = null;
        run.questionTimer = null;
        run.lastResult = {
            categoryId: session.categoryId,
            correctCount: session.correctCount,
            total: QUESTION_BATCH_SIZE,
            won,
        };
        run.roundPointer += 1;
        scheduleNextRound(run);
    }

    function handleAnswer(choiceIndex, timedOut = false) {
        let shouldInvalidate = false;
        updateRun((run) => {
            if (!run.currentSession || !run.currentQuestion) return false;
            if (run.currentStep !== "question") return false;
            const session = run.currentSession;
            const question = run.currentQuestion;
            const correct = !timedOut && choiceIndex === question.answerIndex;
            if (correct) {
                session.correctCount += 1;
            }
            session.answers.push({
                questionId: question.id,
                selectedIndex: timedOut ? null : choiceIndex,
                correct,
                prompt: question.prompt,
                explanation: question.explanation,
            });
            const questionNumber = session.answers.length;
            run.lastResult = {
                correct,
                prompt: question.prompt,
                explanation: question.explanation,
                questionNumber,
                totalInCategory: QUESTION_BATCH_SIZE,
                timedOut,
            };
            run.currentStep = "answer";
            run.questionTimer = null;
            clearLocks();
            if (determineCategoryLockedLoss(session)) {
                shouldInvalidate = true;
            }
            return true;
        });
        if (shouldInvalidate) {
            invalidateRun(
                "Game over. You needed at least 3 correct answers in the category."
            );
        }
    }

    function proceedAfterAnswer() {
        updateRun((run) => {
            if (!run.currentSession) {
                run.currentStep = run.finished ? "end" : run.currentStep;
                return true;
            }
            if (run.currentSession.answers.length >= QUESTION_BATCH_SIZE) {
                completeSession(run);
                return true;
            }
            run.currentSession.index += 1;
            const nextQuestion =
                run.currentSession.questions[run.currentSession.index];
            run.currentQuestion = { ...nextQuestion, id: nextQuestion.id };
            run.questionTimer = buildQuestionTimer();
            run.currentStep = "question";
            setQuestionLock(run);
            return true;
        });
    }

    function startRunFromPool() {
        if (!context.questionBank) return;
        store.update((state) => {
            const { pruned, closedUntil } = evaluatePlayWindow(
                state.playLog || []
            );
            if (isClosed(closedUntil)) {
                persist(
                    state.run,
                    state.purchases,
                    pruned,
                    state.prizeClaimedAt
                );
                const reopen = new Date(closedUntil).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                });
                return {
                    ...state,
                    playLog: pruned,
                    closedUntil,
                    message: `Daily limit reached. Come back after ${reopen}.`,
                };
            }
            const seed = generateSeed();
            const { items: selected, cursor } = takeRandomItems(
                context.questionBank.categories,
                7,
                seed,
                0
            );
            const selectedIds = selected.map((category) => category.id);
            const run = sanitizeRun({
                runId: uuid(),
                randSeed: seed,
                randCursor: cursor,
                selectedCategoryIds: selectedIds,
                remainingCategoryIds: [...selectedIds],
                categoriesPlayed: [],
                categoryResults: Object.fromEntries(
                    selectedIds.map((id) => [id, "unplayed"])
                ),
                questionHistory: {},
                winsCount: 0,
                finished: false,
                prizeUnlocked: false,
                currentStep: "wheel",
                currentOffer: null,
                roundPointer: 0,
                lastResult: null,
            });
            scheduleNextRound(run);
            bumpIntegrity(run);
            const updatedLog = [...pruned, Date.now()];
            persist(run, state.purchases, updatedLog, state.prizeClaimedAt);
            return {
                ...state,
                run,
                screen: run.currentStep,
                playLog: updatedLog,
                closedUntil: null,
                message: "",
            };
        });
    }

    function loadQuestions() {
        store.update((state) => ({
            ...state,
            questionStatus: "loading",
            questionError: null,
        }));
        fetchQuestionBank()
            .then((bank) => {
                const map = {};
                bank.categories.forEach((category) => {
                    map[category.id] = category;
                });
                context.questionBank = bank;
                context.categoryMap = map;
                store.update((state) => {
                    let run = state.run ? sanitizeRun(state.run) : null;
                    if (run && !validateRun(run, map)) {
                        run = null;
                        persist(
                            null,
                            state.purchases,
                            state.playLog,
                            state.prizeClaimedAt
                        );
                    }
                    return {
                        ...state,
                        questionStatus: "ready",
                        questionError: null,
                        categories: bank.categories,
                        categoryMap: map,
                        run,
                        screen: run ? run.currentStep : "home",
                    };
                });
            })
            .catch((error) => {
                store.update((state) => ({
                    ...state,
                    questionStatus: "error",
                    questionError: {
                        message: error.message,
                        details: error.details || [],
                    },
                    screen: "error",
                }));
            });
    }

    function confirmWheelReveal() {
        updateRun((run) => {
            if (!run.currentOffer) return false;
            if (run.currentOffer.type === "forced") {
                const categoryId = run.currentOffer.options[0];
                run.remainingCategoryIds = run.remainingCategoryIds.filter(
                    (id) => id !== categoryId
                );
                beginSession(run, categoryId);
                return true;
            }
            run.currentStep = "roundChoice";
            return true;
        });
    }

    function chooseCategory(categoryId) {
        updateRun((run) => {
            if (!run.currentOffer || run.currentOffer.type !== "choice")
                return false;
            if (!run.currentOffer.options.includes(categoryId)) return false;
            run.remainingCategoryIds = run.remainingCategoryIds.filter(
                (id) => id !== categoryId
            );
            beginSession(run, categoryId);
            return true;
        });
    }

    function timeoutQuestion() {
        const current = get(store);
        if (!current.run || current.run.currentStep !== "question") return;
        handleAnswer(null, true);
    }

    function restartRun() {
        clearLocks();
        store.update((state) => {
            persist(null, state.purchases, state.playLog, state.prizeClaimedAt);
            return { ...state, run: null, screen: "home" };
        });
    }

    function handleNavigationViolation() {
        const state = get(store);
        if (state.run && state.run.currentStep === "question") {
            invalidateRun(
                "Navigation detected during a question. Run invalidated."
            );
        }
    }

    function handleBackgrounding() {
        const state = get(store);
        if (state.run && state.run.currentStep === "question") {
            invalidateRun(
                "Question interrupted while the tab was hidden. Run invalidated."
            );
        }
    }

    function invalidateRun(reason) {
        clearLocks();
        context.store.update((state) => {
            persist(null, state.purchases, state.playLog, state.prizeClaimedAt);
            return {
                ...state,
                run: null,
                screen: "home",
                lastInvalidation: reason,
                message: reason,
            };
        });
    }

    function openShop() {
        store.update((state) => ({ ...state, modal: { type: "shop" } }));
    }

    function closeModal() {
        store.update((state) => ({ ...state, modal: null }));
    }

    function setMessage(message) {
        store.update((state) => ({ ...state, message }));
    }

    function prizeUnavailable(state) {
        return Boolean(state.prizeClaimedAt);
    }

    function purchasePrize(prizeId) {
        const item = SHOP_ITEM;
        if (!item || item.id !== prizeId) return;
        store.update((state) => {
            if (!state.run || !state.run.prizeUnlocked) {
                return {
                    ...state,
                    message: "Win 4 categories to unlock the gift card.",
                };
            }
            if (prizeUnavailable(state)) {
                return {
                    ...state,
                    message:
                        "The billiards gift card has already been claimed.",
                };
            }
            if (state.purchases.length > 0) {
                return {
                    ...state,
                    message: "You already generated the gift card.",
                };
            }
            const claimToken = uuid().replace(/-/g, "");
            const purchase = {
                purchaseId: uuid(),
                prizeId: item.id,
                prizeName: item.name,
                description: item.description,
                status: "unredeemed",
                createdAt: nowISO(),
                claimToken,
                claimCode: buildClaimCode(item.codePrefix),
                shareUrl: buildShareUrl(claimToken),
            };
            const purchases = [purchase];
            const prizeClaimedAt = Date.now();
            persist(state.run, purchases, state.playLog, prizeClaimedAt);
            return {
                ...state,
                purchases,
                prizeClaimedAt,
                message: "Gift card generated! Share it to redeem.",
                modal: { type: "prizeCard", purchase },
            };
        });
    }

    function redeemPrize(purchaseId) {
        store.update((state) => {
            const purchases = state.purchases.map((purchase) =>
                purchase.purchaseId === purchaseId
                    ? { ...purchase, status: "redeemed", redeemedAt: nowISO() }
                    : purchase
            );
            persist(state.run, purchases, state.playLog, state.prizeClaimedAt);
            const nextModal =
                state.modal?.type === "claim"
                    ? {
                          ...state.modal,
                          purchase:
                              purchases.find(
                                  (p) => p.purchaseId === purchaseId
                              ) || null,
                      }
                    : state.modal;
            return { ...state, purchases, modal: nextModal };
        });
    }

    function openClaim(token) {
        if (!token) return;
        store.update((state) => {
            const purchase = state.purchases.find(
                (item) => item.claimToken === token
            );
            return {
                ...state,
                modal: { type: "claim", token, purchase: purchase || null },
            };
        });
    }

    function viewPrizeCard(purchaseId) {
        store.update((state) => {
            const purchase = state.purchases.find(
                (item) => item.purchaseId === purchaseId
            );
            if (!purchase) return state;
            return { ...state, modal: { type: "prizeCard", purchase } };
        });
    }

    function acknowledgeMessage() {
        setMessage("");
    }

    function initialize() {
        if (typeof window === "undefined") return;
        const persisted = loadPersistedState();
        const run = sanitizeRun(persisted.run);
        const { pruned, closedUntil } = evaluatePlayWindow(
            persisted.playLog || []
        );
        store.update((state) => ({
            ...state,
            run,
            purchases: persisted.purchases || [],
            prizeClaimedAt: persisted.prizeClaimedAt || null,
            playLog: pruned,
            closedUntil,
            tamperDetected: persisted.tampered,
            screen: run ? run.currentStep : "home",
        }));
        const lock = loadQuestionLock();
        if (lock && run && !run.finished) {
            invalidateRun(
                "Refresh detected during a question. Run invalidated."
            );
            clearLocks();
        }
        loadQuestions();
    }

    initialize();

    return {
        state: { subscribe: store.subscribe },
        actions: {
            retryLoad: loadQuestions,
            startNewRun: startRunFromPool,
            confirmWheelReveal,
            chooseCategory,
            submitAnswer: (index) => handleAnswer(index, false),
            continueAfterAnswer: proceedAfterAnswer,
            timeoutQuestion,
            restartRun,
            handleNavigationViolation,
            handleBackgrounding,
            openShop,
            closeModal,
            purchasePrize,
            redeemPrize,
            openClaim,
            viewPrizeCard,
            acknowledgeMessage,
        },
    };
}

export const engine = createEngine();
