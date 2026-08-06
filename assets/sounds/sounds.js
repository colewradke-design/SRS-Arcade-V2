/**
 * sounds.js
 * ---------------------------------------------------------------------------
 * Audio engine placeholder module for the Korean Vocabulary app.
 *
 * All functions are intentionally empty stubs. Drop in Web Audio API /
 * Howler.js / Tone.js implementations here later — zero changes required in
 * any other file, because every call-site already imports by name from this
 * module.
 *
 * Planned sound palette: 8-bit / chiptune style (square & triangle waves,
 * short envelopes, low sample-rate aesthetic).
 * ---------------------------------------------------------------------------
 */


/**
 * Played when the user selects the correct answer.
 *
 * Target SFX: Classic "correct ding" — two ascending square-wave tones
 * (e.g. C5 → E5), ~80 ms each, fast attack / fast decay, no sustain.
 * Think: NES quiz-show "right answer" jingle.
 */
export function playCorrect() {
  // TODO: implement with Web Audio API or Howler.js
  // Suggested: OscillatorNode, type = "square", freqs [523, 659], dur 160 ms
}


/**
 * Played when the user selects a wrong answer.
 *
 * Target SFX: Low "buzzer" — single descending square-wave note (A3 → F3),
 * ~200 ms, slight pitch-bend downward to signal failure.
 * Think: Game-show wrong-answer thud with a chiptune edge.
 */
export function playWrong() {
  // TODO: implement with Web Audio API or Howler.js
  // Suggested: OscillatorNode, type = "square", freq 220 Hz, detune -200 over 200 ms
}


/**
 * Played when the app transitions between study phases
 * (e.g. recognition → recall, or moving to the next card set).
 *
 * Target SFX: Short upward arpeggio sweep — 4 quick triangle-wave notes
 * (C4 → E4 → G4 → C5), ~50 ms per note, light reverb tail.
 * Signals "level up / new stage" without being distracting.
 */
export function playPhaseTransition() {
  // TODO: implement with Web Audio API or Howler.js
  // Suggested: OscillatorNode, type = "triangle", arpeggio [261, 330, 392, 523],
  //            50 ms per step, mild gain envelope fade-out on final note
}


/**
 * Played when the user unlocks a new vocabulary set or achievement.
 *
 * Target SFX: Celebratory fanfare — 6-note rising square-wave melody
 * (classic "item get" motif), ~300 ms total, followed by a shimmering
 * pulse-wave chord resolving on the tonic.
 * Think: Zelda chest-open or Mario power-up, reimagined for Korean vocab.
 */
export function playUnlock() {
  // TODO: implement with Web Audio API or Howler.js
  // Suggested: OscillatorNode, type = "square", melody [330, 392, 440, 523, 587, 659],
  //            ~40 ms per note + 120 ms sustain chord [523, 659, 784]
}


/**
 * Played at the end of a full study session (all cards reviewed).
 *
 * Target SFX: Satisfying completion jingle — warm triangle-wave chord
 * progression (I → IV → V → I in C major), ~600 ms total, slow attack
 * to feel rewarding rather than abrupt.  Optional: subtle white-noise
 * "shimmer" layer fading in alongside the final chord.
 * Think: RPG "battle won" or end-of-level summary screen music sting.
 */
export function playSessionEnd() {
  // TODO: implement with Web Audio API or Howler.js
  // Suggested: OscillatorNode, type = "triangle", chords [C4,E4,G4] → [F4,A4,C5]
  //            → [G4,B4,D5] → [C4,E4,G4], 150 ms each, gainNode ramp 0→0.4→0
}
