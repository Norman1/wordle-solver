# Wordle Solver Project Plan

## 1. Word List Acquisition
- Download the canonical Wordle word list once during development from `https://raw.githubusercontent.com/tabatkins/wordle-list/main/words.txt` and check it into the repo as `data/wordlist.txt`.
- At runtime, load the local static file with `fetch(new URL('./data/wordlist.txt', import.meta.url))`; if served via `file://`, fall back to an embedded copy to avoid CORS/file-origin issues.
- Use the stored set as both possible solutions and allowable guesses to keep implementation and UI logic simple.

-## 2. Application Structure
- Build a single-page `index.html` containing semantic markup and optionally inline CSS for layout/theme.
- Place all JavaScript in a dedicated `app.js` module loaded via `<script src="app.js" type="module">`.
- Separate concerns in the script using modular patterns (e.g., encapsulated state manager, solver engine, UI renderer).
- Provide sections for header/instructions, solver status controls, Wordle-style board, and candidate diagnostics.

## 3. Core State & Flow
- Maintain state objects: `wordList`, `candidates`, `guessHistory`, `activeRowIndex`, `pendingFeedback`, and `userEnteredWord`.
- On initialization, download the word list, compute letter frequency metrics, compute the recommended first guess, and render an empty board highlighting the active row.
- Show the current recommendation in a dedicated panel; allow the user to type any five-letter word into the active row (validate against dictionary for guidance but do not block).
- Offer controls: `Apply Feedback` (enabled once five letters and tile states are set) and `Reset Solver`, disabling appropriately when waiting on data.

## 4. Board & Interaction Design
- Render a 6×5 grid styled to mimic the Wordle UI using CSS Grid, consistent tile sizing, and palette for gray/yellow/green states.
- Allow keyboard input for the active row: capture letters A–Z, backspace, and enter; show the typed letters inside tiles, optionally with an on-screen keyboard for reference.
- Enable tile click handlers on the current row that cycle states `absent → present → correct → absent`, updating visuals and internal feedback tracking.
- Freeze previous rows after confirmation while preserving their status display and the letters the user typed.
- Display the solver’s recommendation prominently above or beside the board, updating after each feedback confirmation.

## 5. Solver Logic
- Implement feedback interpretation that infers positional constraints and letter count minimum/maximums, handling duplicate letters correctly.
- Filter `candidates` by enforcing green matches, excluding yellows from their positions, and satisfying global letter occurrences.
- Maintain two sets: `A` (all allowed guesses) and filtered `B` (remaining candidates). Generate recommendations that aim to maximize information gain without requiring hard-mode adherence.
- Precompute per-word metadata (letter arrays, counts) once the list loads to speed up repeated feedback simulations.
- Entropy-based scoring algorithm:
  ```
  bestGuess(A, B):
      bestWord = null
      bestScore = -inf
      for word in A:
          buckets = map pattern -> count
          for candidate in B:
              pattern = simulateFeedback(word, candidate)  // e.g., "GYBBY"
              buckets[pattern] += 1
          score = 0
          for count in buckets.values():
              p = count / |B|
              score -= p * log2(p)
          if word in B:
              score += 1e-4
          if score better than bestScore (or ties alphabetically):
              bestWord = word
              bestScore = score
      return bestWord
  ```
- Feedback simulation follows Wordle rules: first mark greens and decrement per-letter counts, then mark yellows where counts remain; memoize intermediate structures where helpful.
- Cache the initial full-list entropy scores so the first recommendation is instant; reuse cached bucket counts per guess when `B` shrinks to avoid recomputing duplicate patterns.
- Detect terminal states: solved (all greens), exhausted candidates, or reaching six guesses; provide clear messaging for each scenario.

## 6. User Feedback & Diagnostics
- Show current guess index, recommended word, word count remaining, and any relevant status messages near the controls.
- When few candidates remain (e.g., ≤5), optionally list them to aid manual validation.
- Surface non-blocking warnings for inconsistent feedback (when no candidates fit) and allow the user to adjust tiles before retrying.

## 7. Testing & Validation
- Manually test with known answer sequences, including duplicates (e.g., “press”, “array”) to ensure constraint handling works.
- Validate color cycling, board lock/unlock behavior, candidate list updates, and reset flow directly in-browser.
- Confirm resilience against network issues by simulating load failures and ensuring the UI communicates retry instructions.

## 8. Delivery & Follow-up
- Document how to run locally (open `index.html` in a modern browser) and mention the baked-in word list.
- Highlight future enhancement options (dynamic list updates, keyboard input, hard-mode toggle) for potential iterations.
