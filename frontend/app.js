const socket = io();

function isFourDigits(value) {
  return /^\d{4}$/.test(value);
}

/* ---------- Cajas de dígitos reutilizables ---------- */

function createDigitBoxes(container) {
  container.innerHTML = "";
  const inputs = [];

  for (let i = 0; i < 4; i++) {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.maxLength = 1;
    input.className = "digit-box";
    input.autocomplete = "off";
    inputs.push(input);
    container.appendChild(input);
  }

  function focusIndex(i) {
    if (i >= 0 && i < inputs.length) inputs[i].focus();
  }

  inputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      input.classList.toggle("filled", input.value !== "");
      if (input.value && i < inputs.length - 1) {
        focusIndex(i + 1);
      }
      container.dispatchEvent(new CustomEvent("digitschange"));
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && i > 0) {
        focusIndex(i - 1);
      } else if (e.key === "ArrowLeft" && i > 0) {
        focusIndex(i - 1);
      } else if (e.key === "ArrowRight" && i < inputs.length - 1) {
        focusIndex(i + 1);
      } else if (e.key === "Enter") {
        container.dispatchEvent(new CustomEvent("digitsenter"));
      }
    });

    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
      if (!text) return;
      inputs.forEach((box, j) => {
        box.value = text[j] || "";
        box.classList.toggle("filled", box.value !== "");
      });
      focusIndex(Math.min(text.length, inputs.length) - 1);
      container.dispatchEvent(new CustomEvent("digitschange"));
    });
  });

  return {
    inputs,
    getValue: () => inputs.map((i) => i.value).join(""),
    isComplete: () => inputs.every((i) => i.value !== ""),
    clear: () => {
      inputs.forEach((i) => {
        i.value = "";
        i.classList.remove("filled");
      });
    },
    focusFirst: () => focusIndex(0),
    setDisabled: (disabled) => {
      inputs.forEach((i) => (i.disabled = disabled));
    },
    shake: () => {
      inputs.forEach((i) => i.classList.add("shake"));
      setTimeout(() => inputs.forEach((i) => i.classList.remove("shake")), 300);
    },
  };
}

/* ---------- Sonido (generado con Web Audio, sin ficheros externos) ---------- */

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function resumeAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) {
    /* audio no disponible */
  }
}

let muted = false;
try {
  muted = localStorage.getItem("numeros1vs1_muted") === "1";
} catch (e) {
  /* localStorage no disponible */
}

function beep({ freq = 440, duration = 0.15, type = "sine", volume = 0.2, delay = 0 } = {}) {
  if (muted) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const startTime = ctx.currentTime + delay;
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  } catch (e) {
    /* audio no disponible */
  }
}

const sounds = {
  submit: () => beep({ freq: 520, duration: 0.08, type: "square", volume: 0.12 }),
  hit: (hits) => beep({ freq: 280 + hits * 110, duration: 0.16, type: "triangle", volume: 0.18 }),
  yourTurn: () => beep({ freq: 660, duration: 0.1, volume: 0.1 }),
  match: () => {
    beep({ freq: 440, duration: 0.1, volume: 0.15 });
    beep({ freq: 554, duration: 0.1, volume: 0.15, delay: 0.1 });
    beep({ freq: 659, duration: 0.16, volume: 0.15, delay: 0.2 });
  },
  win: () => {
    beep({ freq: 523, duration: 0.15, volume: 0.2 });
    beep({ freq: 659, duration: 0.15, volume: 0.2, delay: 0.15 });
    beep({ freq: 784, duration: 0.35, volume: 0.22, delay: 0.3 });
  },
  lose: () => {
    beep({ freq: 392, duration: 0.22, type: "sawtooth", volume: 0.15 });
    beep({ freq: 294, duration: 0.4, type: "sawtooth", volume: 0.15, delay: 0.2 });
  },
  timeout: () => beep({ freq: 220, duration: 0.25, type: "sawtooth", volume: 0.15 }),
};

const muteBtn = document.getElementById("mute-btn");
function updateMuteBtn() {
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.title = muted ? "Activar sonido" : "Silenciar sonido";
}
updateMuteBtn();
muteBtn.addEventListener("click", () => {
  muted = !muted;
  try {
    localStorage.setItem("numeros1vs1_muted", muted ? "1" : "0");
  } catch (e) {
    /* localStorage no disponible */
  }
  updateMuteBtn();
});

/* ---------- Confeti ---------- */

function launchConfetti() {
  const container = document.createElement("div");
  container.className = "confetti-container";
  document.body.appendChild(container);
  const colors = ["#38bdf8", "#22d3ee", "#22c55e", "#fbbf24", "#f472b6", "#a78bfa"];
  for (let i = 0; i < 120; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = 2.2 + Math.random() * 1.8 + "s";
    piece.style.animationDelay = Math.random() * 0.4 + "s";
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(piece);
  }
  setTimeout(() => container.remove(), 4500);
}

/* ---------- Barra de tiempo por turno ---------- */

const timerFill = document.getElementById("timer-fill");
let timerInterval = null;

function startTurnTimer(seconds) {
  clearInterval(timerInterval);
  timerFill.classList.remove("running", "low-time");
  void timerFill.offsetWidth;
  timerFill.style.animationDuration = seconds + "s";
  timerFill.classList.add("running");

  let remaining = seconds;
  timerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 10) timerFill.classList.add("low-time");
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);
}

function stopTurnTimer() {
  clearInterval(timerInterval);
  timerFill.classList.remove("running", "low-time");
}

/* ---------- Pantallas ---------- */

const screens = {
  setup: document.getElementById("setup-screen"),
  waiting: document.getElementById("waiting-screen"),
  game: document.getElementById("game-screen"),
  gameover: document.getElementById("gameover-screen"),
  rematch: document.getElementById("rematch-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function updateScoreLabel(you, opponent) {
  scoreLabel.textContent = `${you} – ${opponent}`;
}

/* ---------- Pantalla de configuración ---------- */

const setupForm = document.getElementById("setup-form");
const nameInput = document.getElementById("name-input");
const setupError = document.getElementById("setup-error");
const setupSubmitBtn = setupForm.querySelector("button[type=submit]");
const secretBoxesEl = document.getElementById("secret-boxes");
const secretBoxes = createDigitBoxes(secretBoxesEl);

setupSubmitBtn.disabled = true;
secretBoxesEl.addEventListener("digitschange", () => {
  setupSubmitBtn.disabled = !secretBoxes.isComplete();
});

setupForm.addEventListener("submit", (e) => {
  e.preventDefault();
  resumeAudio();
  const secret = secretBoxes.getValue();
  if (!isFourDigits(secret)) {
    setupError.textContent = "Introduce un número de exactamente 4 cifras.";
    secretBoxes.shake();
    return;
  }
  setupError.textContent = "";
  socket.emit("join_game", { name: nameInput.value.trim(), secret });
  showScreen("waiting");
});

socket.on("join_error", ({ message }) => {
  setupError.textContent = message;
  setupSubmitBtn.disabled = !secretBoxes.isComplete();
  showScreen("setup");
});

socket.on("waiting_for_opponent", () => {
  showScreen("waiting");
});

/* ---------- Pantalla de partida ---------- */

const opponentLabel = document.getElementById("opponent-label");
const scoreLabel = document.getElementById("score-label");
const turnIndicator = document.getElementById("turn-indicator");
const guessBoxesEl = document.getElementById("guess-boxes");
const guessBoxes = createDigitBoxes(guessBoxesEl);
const guessBtn = document.getElementById("guess-btn");
const guessError = document.getElementById("guess-error");
const myAttemptsList = document.getElementById("my-attempts");
const opponentAttemptsList = document.getElementById("opponent-attempts");

let isMyTurn = false;

function setTurn(yourTurn, turnSeconds) {
  isMyTurn = yourTurn;
  guessBoxes.clear();
  guessBoxes.setDisabled(!yourTurn);
  updateGuessBtnState();
  turnIndicator.textContent = yourTurn ? "¡Tu turno!" : "Turno del rival";
  turnIndicator.className = "badge " + (yourTurn ? "badge-your-turn" : "badge-opponent-turn");
  if (yourTurn) {
    guessBoxes.focusFirst();
    sounds.yourTurn();
  }
  startTurnTimer(turnSeconds);
}

function updateGuessBtnState() {
  guessBtn.disabled = !isMyTurn || !guessBoxes.isComplete();
}

guessBoxesEl.addEventListener("digitschange", updateGuessBtnState);
guessBoxesEl.addEventListener("digitsenter", () => {
  if (!guessBtn.disabled) submitGuess();
});
guessBtn.addEventListener("click", submitGuess);

function submitGuess() {
  const guess = guessBoxes.getValue();
  if (!isFourDigits(guess)) {
    guessError.textContent = "El intento debe tener 4 cifras.";
    guessBoxes.shake();
    return;
  }
  guessError.textContent = "";
  resumeAudio();
  sounds.submit();
  socket.emit("make_guess", { guess });
  guessBoxes.setDisabled(true);
  guessBtn.disabled = true;
}

socket.on("match_found", ({ opponentName, yourTurn, turnSeconds, scoreYou, scoreOpponent }) => {
  opponentLabel.textContent = `Rival: ${opponentName}`;
  updateScoreLabel(scoreYou, scoreOpponent);
  myAttemptsList.innerHTML = "";
  opponentAttemptsList.innerHTML = "";
  guessError.textContent = "";
  sounds.match();
  setTurn(yourTurn, turnSeconds);
  showScreen("game");
});

socket.on("guess_error", ({ message }) => {
  guessError.textContent = message;
  guessBoxes.setDisabled(!isMyTurn);
  updateGuessBtnState();
});

socket.on("guess_result", ({ by, guess, hits, yourTurn, turnSeconds }) => {
  const list = by === socket.id ? myAttemptsList : opponentAttemptsList;
  const li = document.createElement("li");
  const hitsClass = hits === 4 ? "hits hits-high" : "hits";
  li.innerHTML = `<span class="guess">${guess}</span><span class="${hitsClass}">${hits} acierto${hits === 1 ? "" : "s"}</span>`;
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
  sounds.hit(hits);
  setTurn(yourTurn, turnSeconds);
});

socket.on("turn_timeout", ({ by, yourTurn, turnSeconds }) => {
  const list = by === socket.id ? myAttemptsList : opponentAttemptsList;
  const li = document.createElement("li");
  li.innerHTML = `<span class="timeout">⏱️ Tiempo agotado</span>`;
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
  sounds.timeout();
  setTurn(yourTurn, turnSeconds);
});

/* ---------- Pantalla de fin de partida ---------- */

const gameoverTitle = document.getElementById("gameover-title");
const gameoverDetail = document.getElementById("gameover-detail");
const gameoverScore = document.getElementById("gameover-score");
const rematchBtn = document.getElementById("rematch-btn");
const newOpponentBtn = document.getElementById("new-opponent-btn");
const surrenderBtn = document.getElementById("surrender-btn");

socket.on("game_over", ({ won, yourSecret, opponentSecret, scoreYou, scoreOpponent, reason }) => {
  stopTurnTimer();
  updateScoreLabel(scoreYou, scoreOpponent);

  if (reason === "surrender") {
    gameoverTitle.textContent = won ? "🏳️ Tu rival se ha rendido" : "🏳️ Te has rendido";
  } else {
    gameoverTitle.textContent = won ? "🎉 ¡Has ganado!" : "😔 Has perdido";
  }
  gameoverDetail.textContent = `Tu número era ${yourSecret}. El número del rival era ${opponentSecret}.`;
  gameoverScore.textContent = `Marcador: ${scoreYou} – ${scoreOpponent}`;

  if (won) {
    sounds.win();
    launchConfetti();
  } else {
    sounds.lose();
  }
  showScreen("gameover");
});

newOpponentBtn.addEventListener("click", () => location.reload());

surrenderBtn.addEventListener("click", () => {
  const confirmed = window.confirm("¿Seguro que quieres rendirte? Tu rival ganará la partida.");
  if (confirmed) {
    socket.emit("surrender");
  }
});

/* ---------- Revancha ---------- */

const rematchBoxesEl = document.getElementById("rematch-boxes");
const rematchBoxes = createDigitBoxes(rematchBoxesEl);
const rematchError = document.getElementById("rematch-error");
const rematchConfirmBtn = document.getElementById("rematch-confirm-btn");
const rematchStatus = document.getElementById("rematch-status");

rematchConfirmBtn.disabled = true;
rematchBoxesEl.addEventListener("digitschange", () => {
  rematchConfirmBtn.disabled = !rematchBoxes.isComplete();
});
rematchBoxesEl.addEventListener("digitsenter", () => {
  if (!rematchConfirmBtn.disabled) confirmRematch();
});
rematchConfirmBtn.addEventListener("click", confirmRematch);

rematchBtn.addEventListener("click", () => {
  rematchBoxes.clear();
  rematchBoxes.setDisabled(false);
  rematchConfirmBtn.disabled = true;
  rematchConfirmBtn.classList.remove("hidden");
  rematchStatus.classList.add("hidden");
  rematchError.textContent = "";
  showScreen("rematch");
  rematchBoxes.focusFirst();
});

function confirmRematch() {
  const secret = rematchBoxes.getValue();
  if (!isFourDigits(secret)) {
    rematchError.textContent = "Introduce un número de exactamente 4 cifras.";
    rematchBoxes.shake();
    return;
  }
  rematchError.textContent = "";
  resumeAudio();
  socket.emit("request_rematch", { secret });
  rematchBoxes.setDisabled(true);
  rematchConfirmBtn.classList.add("hidden");
  rematchStatus.classList.remove("hidden");
}

socket.on("rematch_error", ({ message }) => {
  rematchError.textContent = message;
  rematchBoxes.setDisabled(false);
  rematchConfirmBtn.disabled = !rematchBoxes.isComplete();
  rematchConfirmBtn.classList.remove("hidden");
  rematchStatus.classList.add("hidden");
});

socket.on("rematch_waiting", () => {
  rematchStatus.classList.remove("hidden");
});

socket.on("rematch_started", ({ yourTurn, turnSeconds, scoreYou, scoreOpponent }) => {
  myAttemptsList.innerHTML = "";
  opponentAttemptsList.innerHTML = "";
  guessError.textContent = "";
  updateScoreLabel(scoreYou, scoreOpponent);
  sounds.match();
  setTurn(yourTurn, turnSeconds);
  showScreen("game");
});

/* ---------- Desconexión del rival ---------- */

socket.on("opponent_left", () => {
  stopTurnTimer();
  gameoverTitle.textContent = "Tu rival se ha desconectado";
  gameoverDetail.textContent = "La partida ha finalizado.";
  gameoverScore.textContent = "";
  showScreen("gameover");
});
