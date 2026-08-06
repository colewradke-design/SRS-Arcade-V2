/**
 * core/ai-client.js
 * Sole file that touches Firebase AI Logic.
 * Exposes generateSentencePrompt() and evaluateTranslation().
 * Uses Gemini via GoogleAIBackend (Spark free tier compatible).
 */

import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-ai.js";
import { app } from './auth.js';

// ---------------------------------------------------------------------------
// Model setup (shared)
// ---------------------------------------------------------------------------

const ai = getAI(app, { backend: new GoogleAIBackend() });

// Primary free-tier Flash model (as of Aug 2026 docs)
const MODEL_NAME = "gemini-3.6-flash";

// ---------------------------------------------------------------------------
// Schemas for structured output
// ---------------------------------------------------------------------------

const promptSchema = Schema.object({
  properties: {
    prompt_text: Schema.string(),
    target_word_ids: Schema.array({ items: Schema.string() })
  }
});

const evaluationSchema = Schema.object({
  properties: {
    correct: Schema.boolean(),
    feedback: Schema.string(),
    corrected_examples: Schema.array({ items: Schema.string() }),
    words_used_correctly: Schema.array({ items: Schema.string() }),
    words_missed: Schema.array({ items: Schema.string() })
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMinimalWordList(wordPool) {
  // Only send id + english + native + chapter to keep tokens low
  return (wordPool || []).map(w => ({
    id: w.id,
    english: w.english || w.en || '',
    native: w.native || w.ko || w.hangul || '',
    chapter: w.chapter
  }));
}

async function callModel(systemInstruction, userPrompt, schema) {
  const model = getGenerativeModel(ai, {
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.7,
      maxOutputTokens: 1024
    },
    systemInstruction
  });

  const result = await model.generateContent(userPrompt);
  const text = result.response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[ai-client] JSON parse failed:', text);
    throw new Error('Model returned invalid JSON');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call 1 — Generate an English prompt sentence/passage.
 *
 * @param {Array} wordPool - full unlocked words (minimal fields)
 * @param {string[]} biasedWordIds - preferred word ids
 * @param {'single'|'multi'|'paragraph'} complexity
 * @param {Array} recentMistakes - raw incorrect attempts (feedback + wordsMissed)
 * @param {number} recentAccuracy - 0–1 ratio
 * @param {string} targetLanguage - e.g. 'ko'
 */
export async function generateSentencePrompt(
  wordPool,
  biasedWordIds,
  complexity = 'single',
  recentMistakes = [],
  recentAccuracy = 0.5,
  targetLanguage = 'ko'
) {
  const minimalPool = buildMinimalWordList(wordPool);
  const preferred = (biasedWordIds || []).join(', ') || 'none';

  const complexitySpec = {
    single: 'Write exactly ONE natural English sentence (natural length) that requires translation of 1–2 target words.',
    multi: 'Write 2–3 connected English sentences forming a short coherent scenario. Distribute 2–4 target words across them.',
    paragraph: 'Write a short coherent English paragraph of 4–6 sentences (mini-narrative). Distribute 4–6 target words throughout.'
  }[complexity] || complexitySpec.single;

  const systemInstruction = `You are a language-practice sentence generator for a vocabulary trainer.
Target language the user will translate into: ${targetLanguage}.

STRICT RULES:
- Output ONLY valid JSON matching the schema. No markdown, no preamble.
- The English prompt must be natural and fluent.
- ${complexitySpec}
- You MUST incorporate the preferred target words naturally so the user has to use them when translating.
- You may ONLY use vocabulary that appears in the provided word pool. Never invent words outside the pool.
- If recentMistakes is non-empty, read the feedback and wordsMissed yourself, identify recurring grammar/vocab patterns, and lean the new sentence toward practicing those points without making it feel forced or unnatural.
- Use recentAccuracy to scale difficulty WITHIN the chosen complexity tier only (higher accuracy → slightly harder grammar/phrasing within the tier; lower → simpler). Never change the tier itself.
- Return the exact word ids you targeted in target_word_ids.`;

  const userPrompt = JSON.stringify({
    complexity,
    preferred_word_ids: biasedWordIds || [],
    word_pool: minimalPool,
    recent_mistakes: (recentMistakes || []).slice(0, 8).map(m => ({
      feedback: m.feedback || '',
      wordsMissed: m.wordsMissed || []
    })),
    recent_accuracy: recentAccuracy
  }, null, 0);

  return callModel(systemInstruction, userPrompt, promptSchema);
}

/**
 * Call 2 — Evaluate the user's translation.
 *
 * @param {string} originalPrompt - the English text shown
 * @param {string} userAnswer - user's translation
 * @param {Array} wordPool - for context on correct usage
 * @param {string} targetLanguage
 */
export async function evaluateTranslation(
  originalPrompt,
  userAnswer,
  wordPool,
  targetLanguage = 'ko'
) {
  const minimalPool = buildMinimalWordList(wordPool);

  const systemInstruction = `You are a precise language tutor evaluating a translation from English into ${targetLanguage}.

STRICT RULES:
- Output ONLY valid JSON matching the schema. No markdown, no preamble.
- Be strict but fair: mark correct only if the translation is grammatically and lexically accurate for the intended meaning (minor natural variations are acceptable).
- If correct: feedback must be empty string; provide 2–3 alternative valid phrasings in corrected_examples.
- If incorrect: give a brief, specific explanation of what went wrong (grammar or vocabulary). No filler, no restating the whole sentence. Provide 2–3 corrected example translations.
- Identify which target words were used correctly and which were missed or misused (use the ids from the word pool).
- Never invent vocabulary outside the provided word pool when suggesting corrections.`;

  const userPrompt = JSON.stringify({
    original_english: originalPrompt,
    user_translation: userAnswer,
    word_pool: minimalPool
  }, null, 0);

  return callModel(systemInstruction, userPrompt, evaluationSchema);
}
