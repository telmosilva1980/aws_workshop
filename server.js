const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const MAX_NAME_LEN = 20;
const MAX_SCORE = 999999;
const MAX_ENTRIES = 50;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]');
}

function readScores() {
  ensureStore();
  try {
    const raw = fs.readFileSync(SCORES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeScores(scores) {
  ensureStore();
  const tmp = SCORES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(scores, null, 2));
  fs.renameSync(tmp, SCORES_FILE);
}

function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= MAX_NAME_LEN;
}

function isValidScore(score) {
  return typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= MAX_SCORE;
}

const app = express();
app.use(express.json());

// Open CORS for the sandboxed game page; this API carries no credentials.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Top scores, highest first.
app.get('/api/scores', (req, res) => {
  const scores = readScores()
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  res.json(scores);
});

// Record a completed round's score.
app.post('/api/scores', (req, res) => {
  const { name, score } = req.body || {};

  if (!isValidName(name)) {
    return res.status(400).json({ error: 'name must be a string between 1 and ' + MAX_NAME_LEN + ' characters' });
  }
  if (!isValidScore(score)) {
    return res.status(400).json({ error: 'score must be an integer between 0 and ' + MAX_SCORE });
  }

  const entry = {
    name: name.trim().slice(0, MAX_NAME_LEN),
    score,
    at: new Date().toISOString(),
  };

  const scores = readScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  writeScores(scores.slice(0, MAX_ENTRIES));

  const rank = scores.findIndex((s) => s === entry) + 1;
  res.status(201).json({ entry, rank, top: scores.slice(0, 10) });
});

app.listen(PORT, () => {
  console.log(`Ship & Deliver listening on http://localhost:${PORT}`);
});
