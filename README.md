# Wordle Solver Assistant

Browser-based helper that recommends high-entropy Wordle guesses. You type your own guesses, mark the feedback colors, and the solver suggests the next play while tracking remaining candidates.

## Features
- Entropy-driven recommendations using the full answer list (no hard mode restriction).
- Shows both the top overall guess and the best remaining answer, including entropy and solve-chance stats.
- Wordle-style board with keyboard input and tile state cycling.
- Candidate counts and shortlists when the pool shrinks.
- Ships with a static word list and embedded fallback so it works offline or via `file://`.

## Getting Started
```bash
git clone <your-repo-url>
cd WordleSolver
```

Open `index.html` directly in a modern browser or serve it locally for best results:
```bash
npx serve .
```
The app loads automatically; follow the recommendation panel, type your guess letters, click tiles to match feedback colors, then press **Apply Feedback** to get the next suggestion.

## Word List
- Allowed guesses: `data/wordlist.txt` (downloaded from the open Wordle archive).
- Possible answers: `data/answerlist.txt` (the official solution pool, kept alongside the guess list).
- Embedded fallback: `data/wordlist-embedded.js` (auto-generated array) used when the fetch path is unavailable. When the answer list cannot be fetched (e.g., `file://` protocol), the solver falls back to treating the full guess list as the answer pool.
If you update the source list, regenerate the embedded copy with:
```bash
node -e "const fs=require('fs');const words=fs.readFileSync('data/wordlist.txt','utf8').trim().split(/\\s+/);fs.writeFileSync('data/wordlist-embedded.js',`export const WORD_LIST_EMBEDDED = ${JSON.stringify(words)};`);"
```

## Deploying to GitHub Pages
1. Push this repository to GitHub (e.g., `main` branch).
2. In repository Settings → Pages, choose **Deploy from a branch** and select `main` with `/` (root) directory.
3. Save; GitHub will publish at `https://<username>.github.io/<repo>/` within a few minutes.

## Development Notes
- All logic is in `app.js`. The entropy scorer simulates feedback for each candidate to pick the highest information guess.
- UI styling lives in `index.html` (inline CSS). Feel free to extract styles if the project grows.
- No build step required; pure HTML/CSS/JS.
