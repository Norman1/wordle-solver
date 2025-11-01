import { WORD_LIST_EMBEDDED } from './data/wordlist-embedded.js';

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const TILE_STATES = ['absent', 'present', 'correct'];
const PATTERN_FROM_STATE = { absent: '0', present: '1', correct: '2' };
const LARGE_SET_THRESHOLD = 2000;
const HIGH_VALUE_POOL_SIZE = 512;
const DEFAULT_FALLBACK_RECOMMENDATION = 'soare';
const SOLVE_PROBABILITY_WEIGHT = 1;

const elements = {
  board: document.getElementById('board'),
  applyBtn: document.getElementById('apply-btn'),
  resetBtn: document.getElementById('reset-btn'),
  recommendation: document.getElementById('recommendation'),
  summary: document.getElementById('summary'),
  status: document.getElementById('status-area'),
  remaining: document.getElementById('remaining'),
  topCandidates: document.getElementById('top-candidates'),
  keyboard: document.getElementById('keyboard'),
};

const state = {
  guessWordData: [],
  answerWordData: [],
  candidates: [],
  highValueWords: [],
  guessHistory: [],
  rows: [],
  activeRow: 0,
  solved: false,
  keyboardKeys: new Map(),
  letterStatuses: new Uint8Array(26),
};

main().catch((error) => {
  console.error(error);
  setStatus('Failed to initialize solver. See console for details.', 'error');
});

async function main() {
  const { guessWordData, answerWordData } = await loadWordSets();
  if (!guessWordData.length) {
    throw new Error('Word list is empty.');
  }
  if (!answerWordData.length) {
    throw new Error('Answer list is empty.');
  }

  state.guessWordData = guessWordData;
  state.answerWordData = answerWordData;
  state.candidates = answerWordData.slice();
  state.highValueWords = computeHighValueWords(state.guessWordData);

  buildBoard();
  buildKeyboard();
  bindEvents();
  resetSolver({ announce: false });
  setStatus('Solver ready. Start by typing the recommended guess.', 'info');
}

async function loadWordSets() {
  const guessWords = await loadWordListFile('./data/wordlist.txt', WORD_LIST_EMBEDDED);
  if (!guessWords.length) {
    return { guessWordData: [], answerWordData: [] };
  }

  let answerWords = await loadWordListFile('./data/answerlist.txt');
  if (!answerWords.length) {
    console.warn('Falling back to full word list for answers.');
    answerWords = guessWords;
  }

  const guessSet = new Set(guessWords);
  const overlappingAnswers = [];
  let ignoredAnswers = 0;

  for (const word of answerWords) {
    if (guessSet.has(word)) {
      overlappingAnswers.push(word);
    } else {
      ignoredAnswers += 1;
    }
  }

  if (!overlappingAnswers.length) {
    console.warn('Answer list did not overlap allowed guesses; reverting to full word list for answers.');
    overlappingAnswers.push(...guessWords);
  } else if (ignoredAnswers > 0) {
    console.warn(`Omitted ${ignoredAnswers} answer words not present in allowed guesses.`);
  }

  const wordDataMap = new Map();
  const guessWordData = guessWords.map((word) => {
    const entry = makeWordData(word);
    wordDataMap.set(word, entry);
    return entry;
  });
  const answerWordData = overlappingAnswers.map((word) => wordDataMap.get(word));

  return { guessWordData, answerWordData };
}

async function loadWordListFile(relativePath, embeddedFallback) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    return parseWordList(text);
  } catch (error) {
    if (embeddedFallback) {
      console.warn(`Falling back to embedded list for ${relativePath}.`, error);
      return normalizeWords(embeddedFallback);
    }
    console.warn(`Failed to load ${relativePath}.`, error);
    return [];
  }
}

function parseWordList(text) {
  const words = text.split(/\s+/);
  return normalizeWords(words);
}

function normalizeWords(words) {
  const filtered = words
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length === WORD_LENGTH && /^[a-z]+$/.test(word));
  return Array.from(new Set(filtered));
}

function buildBoard() {
  elements.board.innerHTML = '';
  state.rows = [];

  for (let rowIndex = 0; rowIndex < MAX_GUESSES; rowIndex++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';

    const tiles = [];
    const letters = Array(WORD_LENGTH).fill('');
    const statuses = Array(WORD_LENGTH).fill('absent');

    for (let colIndex = 0; colIndex < WORD_LENGTH; colIndex++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.state = 'absent';
      tile.dataset.active = rowIndex === 0 ? 'true' : 'false';
      tile.dataset.filled = 'false';
      tile.dataset.row = rowIndex;
      tile.dataset.col = colIndex;

      const span = document.createElement('span');
      span.textContent = '';
      tile.appendChild(span);

      tile.addEventListener('click', () => cycleTileState(rowIndex, colIndex));
      rowEl.appendChild(tile);
      tiles.push(tile);
    }

    state.rows.push({
      letters,
      statuses,
      tiles,
      locked: false,
    });

    elements.board.appendChild(rowEl);
  }
}

function bindEvents() {
  window.addEventListener('keydown', handleKeydown);
  elements.applyBtn.addEventListener('click', onApplyFeedback);
  elements.resetBtn.addEventListener('click', () => resetSolver({ announce: true }));
}

function buildKeyboard() {
  const layout = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'delete'],
  ];

  elements.keyboard.innerHTML = '';
  state.keyboardKeys.clear();

  for (const rowKeys of layout) {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyboard-row';

    for (const label of rowKeys) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key';
      button.dataset.key = label;
      button.textContent = label === 'delete' ? '⌫' : label === 'enter' ? 'Enter' : label.toUpperCase();
      button.addEventListener('click', () => handleVirtualKey(label));
      rowEl.appendChild(button);

      if (label !== 'enter' && label !== 'delete') {
        state.keyboardKeys.set(label, button);
      }
    }

    elements.keyboard.appendChild(rowEl);
  }
}

function handleKeydown(event) {
  if (state.solved) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  const key = event.key.toLowerCase();
  const activeRowData = state.rows[state.activeRow];
  if (!activeRowData || activeRowData.locked) {
    return;
  }

  if (key === 'enter') {
    if (!elements.applyBtn.disabled) {
      event.preventDefault();
      onApplyFeedback();
    }
    return;
  }

  if (key === 'backspace') {
    event.preventDefault();
    removeLetter();
    return;
  }

  if (/^[a-z]$/.test(key)) {
    event.preventDefault();
    insertLetter(key);
  }
}

function handleVirtualKey(value) {
  if (state.solved) {
    return;
  }

  if (value === 'enter') {
    if (!elements.applyBtn.disabled) {
      onApplyFeedback();
    }
    return;
  }

  if (value === 'delete') {
    removeLetter();
    return;
  }

  if (/^[a-z]$/.test(value)) {
    insertLetter(value);
  }
}

function insertLetter(letter) {
  const row = state.rows[state.activeRow];
  if (!row) {
    return;
  }

  const nextIndex = row.letters.findIndex((value) => value === '');
  if (nextIndex === -1) {
    return;
  }

  row.letters[nextIndex] = letter;
  row.statuses[nextIndex] = row.statuses[nextIndex] || 'absent';
  updateTile(row, nextIndex);
  updateApplyButtonState();
}

function removeLetter() {
  const row = state.rows[state.activeRow];
  if (!row) {
    return;
  }

  let lastIndex = -1;
  for (let i = WORD_LENGTH - 1; i >= 0; i--) {
    if (row.letters[i]) {
      lastIndex = i;
      break;
    }
  }

  if (lastIndex === -1) {
    return;
  }

  row.letters[lastIndex] = '';
  row.statuses[lastIndex] = 'absent';
  updateTile(row, lastIndex);
  updateApplyButtonState();
}

function cycleTileState(rowIndex, colIndex) {
  if (state.solved) {
    return;
  }

  if (state.activeRow !== rowIndex) {
    return;
  }

  const row = state.rows[rowIndex];
  if (!row || row.locked) {
    return;
  }

  if (!row.letters[colIndex]) {
    return;
  }

  const current = row.statuses[colIndex] || 'absent';
  const nextIndex = (TILE_STATES.indexOf(current) + 1) % TILE_STATES.length;
  const nextState = TILE_STATES[nextIndex];
  row.statuses[colIndex] = nextState;
  updateTile(row, colIndex);
  updateApplyButtonState();
}

function updateTile(row, colIndex) {
  const tile = row.tiles[colIndex];
  const letter = row.letters[colIndex];
  const stateValue = row.statuses[colIndex] || 'absent';

  tile.dataset.state = stateValue;
  tile.dataset.filled = letter ? 'true' : 'false';
  tile.querySelector('span').textContent = letter.toUpperCase();
}

function updateApplyButtonState() {
  const activeRowData = state.rows[state.activeRow];
  const ready =
    !state.solved &&
    !!activeRowData &&
    !activeRowData.locked &&
    activeRowData.letters.every((letter) => letter.length === 1);

  elements.applyBtn.disabled = !ready;
}

function onApplyFeedback() {
  const rowIndex = state.activeRow;
  const row = state.rows[rowIndex];
  if (!row) {
    return;
  }

  if (row.letters.some((letter) => !letter)) {
    setStatus('Please fill all five letters before applying feedback.', 'warning');
    return;
  }

  if (row.letters.some((letter) => !letter)) {
    setStatus('Please fill all five letters before applying feedback.', 'warning');
    return;
  }

  const word = row.letters.join('');
  const pattern = row.statuses.map((tileState) => PATTERN_FROM_STATE[tileState || 'absent']).join('');
  const guessData = makeWordData(word);
  const entry = {
    word,
    pattern,
    data: guessData,
  };
  entry.constraint = buildConstraint(entry);

  state.guessHistory.push(entry);
  state.candidates = state.candidates.filter((candidate) => matchesConstraint(candidate, entry.constraint));

  row.locked = true;
  setRowActive(rowIndex, false);

  const solved = pattern === '22222';
  const exhausted = state.candidates.length === 0;

  if (solved) {
    state.solved = true;
    setStatus(`Solved! The answer is likely ${word.toUpperCase()}.`, 'success');
    setRecommendation(word);
  } else if (state.activeRow === MAX_GUESSES - 1) {
    state.activeRow += 1;
    state.solved = exhausted;
    if (exhausted) {
      setStatus('No candidates remain. Check the feedback provided.', 'warning');
      setRecommendation('');
    } else {
      setStatus('No guesses remaining. Reset to start over.', 'warning');
      setRecommendation('');
    }
  } else {
    state.activeRow += 1;
    setRowActive(state.activeRow, true);
    if (exhausted) {
      setStatus('No candidates remain. Adjust the feedback or reset.', 'warning');
    } else {
      setStatus('', 'info');
    }
    setRecommendation(pickNextRecommendation());
  }

  updateLetterStatuses(row);
  updateKeyboardVisuals();
  updateApplyButtonState();
  updateSummary();
  updateDiagnostics();
}

function setRowActive(rowIndex, isActive) {
  const row = state.rows[rowIndex];
  if (!row) {
    return;
  }
  row.tiles.forEach((tile) => {
    tile.dataset.active = isActive && !row.locked ? 'true' : 'false';
  });
}

function resetSolver({ announce }) {
  state.candidates = state.answerWordData.slice();
  state.guessHistory = [];
  state.activeRow = 0;
  state.solved = false;
  state.letterStatuses.fill(0);

  state.rows.forEach((row, rowIndex) => {
    row.locked = false;
    for (let col = 0; col < WORD_LENGTH; col++) {
      row.letters[col] = '';
      row.statuses[col] = 'absent';
      updateTile(row, col);
    }
    setRowActive(rowIndex, rowIndex === 0);
  });

  const recommendation = pickNextRecommendation() || DEFAULT_FALLBACK_RECOMMENDATION;
  setRecommendation(recommendation);
  updateApplyButtonState();
  updateSummary();
  updateDiagnostics();
  updateKeyboardVisuals();

  if (announce) {
    setStatus('Solver reset. Type the recommendation or any five-letter word.', 'info');
  }
}

function updateSummary() {
  if (state.solved) {
    const guesses = state.guessHistory.length;
    elements.summary.textContent = `Solved in ${guesses} guess${guesses === 1 ? '' : 'es'}.`;
    return;
  }

  const attemptNumber = Math.min(state.activeRow + 1, MAX_GUESSES);
  elements.summary.textContent = `Guess ${attemptNumber} of ${MAX_GUESSES}.`;
}

function updateDiagnostics() {
  const remainingCount = state.candidates.length;
  elements.remaining.textContent = `Remaining candidates: ${remainingCount}`;

  if (remainingCount > 0 && remainingCount <= 8) {
    const list = state.candidates
      .slice(0, 8)
      .map((entry) => entry.word.toUpperCase())
      .join(', ');
    elements.topCandidates.textContent = `Likely answers: ${list}`;
  } else {
    elements.topCandidates.textContent = '';
  }
}

function setRecommendation(word) {
  if (!word) {
    elements.recommendation.textContent = '-----';
    return;
  }
  elements.recommendation.textContent = word.toUpperCase();
}

function setStatus(message, tone) {
  const el = elements.status;
  el.className = 'status';
  if (!message) {
    el.textContent = '';
    return;
  }

  if (tone === 'error') {
    el.classList.add('error');
  } else if (tone === 'warning') {
    el.classList.add('warning');
  } else if (tone === 'success') {
    el.classList.add('success');
  }
  el.textContent = message;
}

function pickNextRecommendation() {
  if (state.solved || state.activeRow >= MAX_GUESSES) {
    return '';
  }

  if (state.candidates.length === 0) {
    return '';
  }

  if (state.candidates.length === 1) {
    return state.candidates[0].word;
  }

  const candidateSet = new Set(state.candidates);
  let guessPool;

  if (state.candidates.length >= LARGE_SET_THRESHOLD) {
    guessPool = mergeGuessPool(state.highValueWords, state.candidates);
  } else {
    guessPool = state.guessWordData;
  }

  let bestWord = '';
  let bestScore = -Infinity;
  const candidateCount = state.candidates.length;

  for (const guess of guessPool) {
    const buckets = Object.create(null);
    for (const candidate of state.candidates) {
      const pattern = simulateFeedback(guess, candidate);
      buckets[pattern] = (buckets[pattern] || 0) + 1;
    }

    let score = 0;
    for (const value of Object.values(buckets)) {
      const p = value / candidateCount;
      score -= p * Math.log2(p);
    }

    const solveProbability = candidateSet.has(guess) ? 1 / candidateCount : 0;
    const totalScore = score + SOLVE_PROBABILITY_WEIGHT * solveProbability + (solveProbability ? 0.0001 : 0);

    if (totalScore > bestScore || (totalScore === bestScore && guess.word < bestWord)) {
      bestScore = totalScore;
      bestWord = guess.word;
    }
  }

  return bestWord;
}

function mergeGuessPool(highValueWords, candidates) {
  const merged = [];
  const seen = new Set();

  const candidateQuota = Math.min(
    candidates.length,
    Math.max(128, Math.floor(HIGH_VALUE_POOL_SIZE / 2))
  );

  for (let i = 0; i < candidateQuota; i++) {
    const entry = candidates[i];
    if (!entry) {
      break;
    }
    merged.push(entry);
    seen.add(entry);
  }

  for (const entry of highValueWords) {
    if (merged.length >= HIGH_VALUE_POOL_SIZE) {
      break;
    }
    if (!seen.has(entry)) {
      merged.push(entry);
      seen.add(entry);
    }
  }

  let index = candidateQuota;
  while (merged.length < HIGH_VALUE_POOL_SIZE && index < candidates.length) {
    const entry = candidates[index];
    if (!seen.has(entry)) {
      merged.push(entry);
      seen.add(entry);
    }
    index += 1;
  }

  return merged;
}

function makeWordData(word) {
  const letters = word.split('');
  const codes = new Uint8Array(WORD_LENGTH);
  const counts = new Uint8Array(26);

  for (let i = 0; i < WORD_LENGTH; i++) {
    const code = letters[i].charCodeAt(0) - 97;
    codes[i] = code;
    counts[code] += 1;
  }

  return { word, letters, codes, counts };
}

function simulateFeedback(guess, solution) {
  const pattern = new Uint8Array(WORD_LENGTH);
  const remaining = solution.counts.slice();

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess.codes[i] === solution.codes[i]) {
      pattern[i] = 2;
      remaining[guess.codes[i]] -= 1;
    }
  }

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (pattern[i] !== 0) {
      continue;
    }
    const code = guess.codes[i];
    if (remaining[code] > 0) {
      pattern[i] = 1;
      remaining[code] -= 1;
    }
  }

  return Array.from(pattern)
    .map((value) => value.toString())
    .join('');
}

function buildConstraint(entry) {
  const patternNums = new Uint8Array(WORD_LENGTH);
  const greens = new Uint8Array(26);
  const yellows = new Uint8Array(26);
  const blanks = new Uint8Array(26);
  const used = new Uint8Array(26);
  const lettersUsed = [];

  for (let i = 0; i < WORD_LENGTH; i++) {
    const value = Number(entry.pattern[i]);
    patternNums[i] = value;
    const code = entry.data.codes[i];

    if (!used[code]) {
      used[code] = 1;
      lettersUsed.push(code);
    }

    if (value === 2) {
      greens[code] += 1;
    } else if (value === 1) {
      yellows[code] += 1;
    } else {
      blanks[code] += 1;
    }
  }

  const minCounts = new Uint8Array(26);
  const maxCounts = new Uint8Array(26);
  maxCounts.fill(WORD_LENGTH);

  for (const code of lettersUsed) {
    const minValue = greens[code] + yellows[code];
    minCounts[code] = minValue;
    if (blanks[code] > 0) {
      maxCounts[code] = minValue;
    }
  }

  return {
    guessData: entry.data,
    patternNums,
    minCounts,
    maxCounts,
    lettersUsed,
  };
}

function matchesConstraint(candidate, constraint) {
  const { guessData, patternNums, minCounts, maxCounts, lettersUsed } = constraint;

  for (let i = 0; i < WORD_LENGTH; i++) {
    const status = patternNums[i];
    const guessCode = guessData.codes[i];
    const candidateCode = candidate.codes[i];

    if (status === 2) {
      if (candidateCode !== guessCode) {
        return false;
      }
      continue;
    }

    if (status === 1 && candidateCode === guessCode) {
      return false;
    }
  }

  for (const code of lettersUsed) {
    const count = candidate.counts[code];
    if (count < minCounts[code]) {
      return false;
    }
    if (maxCounts[code] !== WORD_LENGTH && count > maxCounts[code]) {
      return false;
    }
  }

  return true;
}

function computeHighValueWords(wordData) {
  const frequency = new Float32Array(26);

  for (const entry of wordData) {
    const seen = new Uint8Array(26);
    for (const code of entry.codes) {
      if (!seen[code]) {
        seen[code] = 1;
        frequency[code] += 1;
      }
    }
  }

  const scored = wordData.map((entry) => {
    const uniqueness = new Uint8Array(26);
    let score = 0;
    for (const code of entry.codes) {
      if (!uniqueness[code]) {
        uniqueness[code] = 1;
        score += frequency[code];
      }
    }
    return { entry, score };
  });

  scored.sort((a, b) => {
    if (b.score === a.score) {
      return a.entry.word.localeCompare(b.entry.word);
    }
    return b.score - a.score;
  });

  return scored.slice(0, HIGH_VALUE_POOL_SIZE).map((item) => item.entry);
}

function updateLetterStatuses(row) {
  const priority = {
    absent: 1,
    present: 2,
    correct: 3,
  };

  for (let i = 0; i < WORD_LENGTH; i++) {
    const letter = row.letters[i];
    if (!letter) {
      continue;
    }
    const code = letter.charCodeAt(0) - 97;
    const stateLabel = row.statuses[i] || 'absent';
    const weight = priority[stateLabel] || 0;
    if (weight > state.letterStatuses[code]) {
      state.letterStatuses[code] = weight;
    }
  }
}

function updateKeyboardVisuals() {
  for (const [letter, button] of state.keyboardKeys.entries()) {
    const code = letter.charCodeAt(0) - 97;
    const value = state.letterStatuses[code];
    let label = '';
    if (value === 1) {
      label = 'absent';
    } else if (value === 2) {
      label = 'present';
    } else if (value >= 3) {
      label = 'correct';
    }
    button.dataset.state = label;
  }
}
