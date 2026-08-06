/**
 * engine/phase-manager.js
 * Session Phase Tracker — manages the 3-phase timeline for main game sessions.
 * Phases progress sequentially in equal time blocks: Decoding → Recognition → Blitz.
 *
 * CRITICAL: This module is pure engine logic. UI side-effects are triggered via
 * CustomEvent dispatch so that main-game.js HUD can react without tight coupling.
 */

import { setPhase as setSpeedPhase } from './speed-controller.js';
import { playPhaseTransition } from '../assets/sounds/sounds.js';

// Sequential phase timeline (order matters for progression)
export const PHASES = ['decoding', 'recognition', 'blitz'];

/**
 * Returns the current phase based on remaining session time.
 * Splits totalDuration into 3 equal segments.
 * @param {number} totalDuration - total session length in seconds
 * @param {number} timeRemaining - current remaining time in seconds (decreasing)
 * @returns {'decoding' | 'recognition' | 'blitz'}
 */
export function getPhaseForTime(totalDuration, timeRemaining) {
  if (!totalDuration || totalDuration <= 0 || timeRemaining <= 0) {
    return 'blitz';
  }

  const segment = totalDuration / 3;

  if (timeRemaining > segment * 2) {
    return 'decoding';
  }
  if (timeRemaining > segment) {
    return 'recognition';
  }
  return 'blitz';
}

/**
 * Returns the human-readable display name for a phase.
 * Used by HUD and session summary.
 * @param {'decoding' | 'recognition' | 'blitz'} phase
 * @returns {string}
 */
export function getPhaseName(phase) {
  switch (phase) {
    case 'decoding':
      return 'Decoding';
    case 'recognition':
      return 'Recognition';
    case 'blitz':
      return 'Blitz';
    default:
      return 'Decoding';
  }
}

/**
 * Determines if the phase has changed since last check.
 * Used in the game timer loop to detect transitions.
 * @param {string|null} previousPhase
 * @param {string} currentPhase
 * @returns {boolean}
 */
export function isNewPhase(previousPhase, currentPhase) {
  return previousPhase !== currentPhase;
}

/**
 * Executes the full phase transition contract.
 * Must be called exactly once when a new phase begins.
 *
 * CRITICAL TRANSITION CONTRACT (executed in order):
 * 1. Immediately recalibrate velocity engine via speed-controller
 * 2. Dispatch CustomEvent so HUD can trigger visual notification/animation
 *    on primary HUD elements (phase badge + brief overlay)
 * 3. Play the phase transition sound cue
 *
 * @param {'decoding' | 'recognition' | 'blitz'} newPhase
 */
export function onPhaseTransition(newPhase) {
  if (!PHASES.includes(newPhase)) {
    console.warn(`phase-manager: invalid phase "${newPhase}"`);
    return;
  }

  // 1. Calibrate speed engine for new phase baseline + reset recent answer curve
  setSpeedPhase(newPhase);

  // 2. Dispatch event for HUD to animate phase badge / trigger overlay notification
  //    Main game (or future HUD module) can listen for 'phase-transition'
  const transitionEvent = new CustomEvent('phase-transition', {
    detail: {
      phase: newPhase,
      phaseName: getPhaseName(newPhase),
      timestamp: performance.now()
    },
    bubbles: true,
    cancelable: false
  });
  document.dispatchEvent(transitionEvent);

  // 3. Audio cue (non-blocking)
  playPhaseTransition();
}
