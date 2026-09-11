const socket = io();

const AVATAR_OPTIONS = ["🙂", "😎", "🦊", "🐼", "🚀", "🔥", "🎯", "🐙", "🍀", "🦄"];

function isValidLength(value, length) {
  return new RegExp(`^\\d{${length}}$`).test(value);
}

function generateToken() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "t-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* localStorage no disponible */
  }
}

/* ---------- Cajas de dígitos reutilizables ---------- */

function createDigitBoxes(container, length) {
  container.innerHTML = "";
  const inputs = [];

  for (let i = 0; i < length; i++) {
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

/* ---------- Tema claro/oscuro ---------- */

let theme = readLS("n1v1_theme", "dark");

function applyTheme(t) {
  theme = t;
  document.documentElement.setAttribute("data-theme", t);
}
applyTheme(theme);

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

let muted = readLS("numeros1vs1_muted", "0") === "1";

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
  chat: () => beep({ freq: 720, duration: 0.06, type: "sine", volume: 0.08 }),
};

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
  home: document.getElementById("home-screen"),
  profile: document.getElementById("profile-screen"),
  settings: document.getElementById("settings-screen"),
  quickmatch: document.getElementById("quickmatch-screen"),
  friends: document.getElementById("friends-screen"),
  joinCode: document.getElementById("join-code-screen"),
  roomCode: document.getElementById("room-code-screen"),
  lobby: document.getElementById("lobby-screen"),
  secretSetup: document.getElementById("secret-setup-screen"),
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

/* ---------- Estadísticas persistentes ---------- */

function readStats() {
  try {
    return JSON.parse(localStorage.getItem("n1v1_stats") || "null") || { wins: 0, losses: 0 };
  } catch (e) {
    return { wins: 0, losses: 0 };
  }
}

function writeStats(stats) {
  try {
    localStorage.setItem("n1v1_stats", JSON.stringify(stats));
  } catch (e) {
    /* localStorage no disponible */
  }
}

function refreshStatsSummary() {
  const stats = readStats();
  if (stats.wins + stats.losses === 0) {
    statsSummary.classList.add("hidden");
    return;
  }
  statsSummary.textContent = `Tus estadísticas: ${stats.wins} victorias · ${stats.losses} derrotas`;
  statsSummary.classList.remove("hidden");
}

/* ---------- Sesión (para reconectar tras recargar) ---------- */

function saveSession() {
  try {
    sessionStorage.setItem(
      "n1v1_session",
      JSON.stringify({ token: myToken, secret: mySecret, name: myName, avatar: myAvatar, length: currentLength })
    );
  } catch (e) {
    /* sessionStorage no disponible */
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem("n1v1_session");
  } catch (e) {
    /* sessionStorage no disponible */
  }
}

/* ---------- Inicio ---------- */

const homeProfileSummary = document.getElementById("home-profile-summary");
const homeAvatarEl = document.getElementById("home-avatar");
const homeNameEl = document.getElementById("home-name");
const findMatchBtn = document.getElementById("find-match-btn");
const playFriendsBtn = document.getElementById("play-friends-btn");
const openProfileBtn = document.getElementById("open-profile-btn");
const openSettingsBtn = document.getElementById("open-settings-btn");

function refreshHomeSummary() {
  homeAvatarEl.textContent = readLS("n1v1_avatar", AVATAR_OPTIONS[0]);
  homeNameEl.textContent = readLS("n1v1_name", "").trim() || "Jugador";
}

function goHome() {
  refreshHomeSummary();
  showScreen("home");
}

findMatchBtn.addEventListener("click", () => {
  refreshDifficultyButtons();
  quickmatchError.textContent = "";
  showScreen("quickmatch");
});
playFriendsBtn.addEventListener("click", () => showScreen("friends"));
homeProfileSummary.addEventListener("click", openProfile);
openProfileBtn.addEventListener("click", openProfile);
openSettingsBtn.addEventListener("click", () => {
  refreshSettingsDisplay();
  showScreen("settings");
});

/* ---------- Perfil ---------- */

const nameInput = document.getElementById("name-input");
const avatarPicker = document.getElementById("avatar-picker");
const statsSummary = document.getElementById("stats-summary");
const profileSaveBtn = document.getElementById("profile-save-btn");
const profileBackBtn = document.getElementById("profile-back-btn");

let selectedAvatar = readLS("n1v1_avatar", AVATAR_OPTIONS[0]);

AVATAR_OPTIONS.forEach((emoji) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "avatar-option" + (emoji === selectedAvatar ? " selected" : "");
  btn.textContent = emoji;
  btn.addEventListener("click", () => {
    selectedAvatar = emoji;
    avatarPicker.querySelectorAll(".avatar-option").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    writeLS("n1v1_avatar", emoji);
  });
  avatarPicker.appendChild(btn);
});

function openProfile() {
  nameInput.value = readLS("n1v1_name", "");
  refreshStatsSummary();
  showScreen("profile");
}

function saveProfileAndGoHome() {
  writeLS("n1v1_name", nameInput.value.trim());
  goHome();
}

profileSaveBtn.addEventListener("click", saveProfileAndGoHome);
profileBackBtn.addEventListener("click", saveProfileAndGoHome);

/* ---------- Ajustes ---------- */

const themeToggleRow = document.getElementById("theme-toggle-row");
const themeIcon = document.getElementById("theme-icon");
const themeValue = document.getElementById("theme-value");
const soundToggleRow = document.getElementById("sound-toggle-row");
const soundIcon = document.getElementById("sound-icon");
const soundValue = document.getElementById("sound-value");
const settingsBackBtn = document.getElementById("settings-back-btn");

function refreshSettingsDisplay() {
  themeIcon.textContent = theme === "light" ? "☀️" : "🌙";
  themeValue.textContent = theme === "light" ? "Claro" : "Oscuro";
  soundIcon.textContent = muted ? "🔇" : "🔊";
  soundValue.textContent = muted ? "Desactivado" : "Activado";
}

themeToggleRow.addEventListener("click", () => {
  applyTheme(theme === "light" ? "dark" : "light");
  writeLS("n1v1_theme", theme);
  refreshSettingsDisplay();
});

soundToggleRow.addEventListener("click", () => {
  muted = !muted;
  writeLS("numeros1vs1_muted", muted ? "1" : "0");
  refreshSettingsDisplay();
});

settingsBackBtn.addEventListener("click", goHome);

/* ---------- Jugar con amigos ---------- */

const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const friendsBackBtn = document.getElementById("friends-back-btn");

createRoomBtn.addEventListener("click", () => {
  resumeAudio();
  myToken = generateToken();
  myName = readLS("n1v1_name", "").trim() || "Jugador";
  myAvatar = selectedAvatar;
  socket.emit("create_room", { name: myName, avatar: myAvatar, token: myToken });
  waitingText.textContent = "Creando partida...";
  showScreen("waiting");
});

joinRoomBtn.addEventListener("click", () => {
  joinCodeInput.value = "";
  joinCodeError.textContent = "";
  showScreen("joinCode");
  joinCodeInput.focus();
});
friendsBackBtn.addEventListener("click", goHome);

/* ---------- Unirse con código ---------- */

const joinCodeInput = document.getElementById("join-code-input");
const joinCodeError = document.getElementById("join-code-error");
const joinCodeCheckBtn = document.getElementById("join-code-check-btn");
const joinCodeBackBtn = document.getElementById("join-code-back-btn");

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
});
joinCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinCodeCheckBtn.click();
});

joinCodeCheckBtn.addEventListener("click", () => {
  const code = joinCodeInput.value.trim();
  if (code.length !== 5) {
    joinCodeError.textContent = "El código debe tener 5 caracteres.";
    return;
  }
  joinCodeError.textContent = "";
  resumeAudio();
  myToken = generateToken();
  myName = readLS("n1v1_name", "").trim() || "Jugador";
  myAvatar = selectedAvatar;
  socket.emit("join_room", { code, name: myName, avatar: myAvatar, token: myToken });
  waitingText.textContent = "Uniéndote a la sala...";
  showScreen("waiting");
});

joinCodeBackBtn.addEventListener("click", () => showScreen("friends"));

socket.on("join_room_error", ({ message }) => {
  joinCodeError.textContent = message;
  showScreen("joinCode");
});

socket.on("waiting_for_opponent", () => {
  waitingText.textContent = "Buscando rival...";
  showScreen("waiting");
});

/* ---------- Crear partida (código de sala) ---------- */

const roomCodeDisplay = document.getElementById("room-code-display");
const copyCodeBtn = document.getElementById("copy-code-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const copyFeedback = document.getElementById("copy-feedback");
const roomCodeCancelBtn = document.getElementById("room-code-cancel-btn");

let currentRoomCode = "";
let copyFeedbackTimeout = null;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e2) {
      return;
    }
  }
  copyFeedback.classList.remove("hidden");
  clearTimeout(copyFeedbackTimeout);
  copyFeedbackTimeout = setTimeout(() => copyFeedback.classList.add("hidden"), 2000);
}

copyCodeBtn.addEventListener("click", () => copyText(currentRoomCode));
copyLinkBtn.addEventListener("click", () => {
  const link = `${location.origin}${location.pathname}?room=${currentRoomCode}`;
  copyText(link);
});
roomCodeCancelBtn.addEventListener("click", () => {
  socket.emit("cancel_lobby");
  goHome();
});

socket.on("room_created", ({ code }) => {
  currentRoomCode = code;
  roomCodeDisplay.textContent = code;
  copyFeedback.classList.add("hidden");
  showScreen("roomCode");
});

/* ---------- Sala de amigos (lobby): primero os unís, luego dificultad ---------- */

const lobbyYouAvatar = document.getElementById("lobby-you-avatar");
const lobbyYouName = document.getElementById("lobby-you-name");
const lobbyOpponentAvatar = document.getElementById("lobby-opponent-avatar");
const lobbyOpponentName = document.getElementById("lobby-opponent-name");
const lobbyHostControls = document.getElementById("lobby-host-controls");
const lobbyGuestWaiting = document.getElementById("lobby-guest-waiting");
const lobbyConfirmLengthBtn = document.getElementById("lobby-confirm-length-btn");
const lobbyCancelBtn = document.getElementById("lobby-cancel-btn");

const lobbyDifficultyPicker = document.getElementById("lobby-difficulty-picker");
const lobbyDifficultyButtons = Array.from(lobbyDifficultyPicker.querySelectorAll(".difficulty-option"));
let lobbySelectedLength = parseInt(readLS("n1v1_length", "4"), 10) || 4;
let isLobbyHost = false;

function refreshLobbyDifficultyButtons() {
  lobbyDifficultyButtons.forEach((b) => {
    b.classList.toggle("selected", parseInt(b.dataset.length, 10) === lobbySelectedLength);
  });
}
refreshLobbyDifficultyButtons();

lobbyDifficultyButtons.forEach((b) => {
  b.addEventListener("click", () => {
    lobbySelectedLength = parseInt(b.dataset.length, 10);
    refreshLobbyDifficultyButtons();
  });
});

lobbyConfirmLengthBtn.addEventListener("click", () => {
  socket.emit("set_lobby_length", { length: lobbySelectedLength });
});

lobbyCancelBtn.addEventListener("click", () => {
  socket.emit("cancel_lobby");
  goHome();
});

socket.on("lobby_ready", ({ isHost, opponentName, opponentAvatar }) => {
  isLobbyHost = isHost;
  lobbyYouAvatar.textContent = myAvatar;
  lobbyYouName.textContent = myName;
  lobbyOpponentAvatar.textContent = opponentAvatar;
  lobbyOpponentName.textContent = opponentName;
  lobbyHostControls.classList.toggle("hidden", !isHost);
  lobbyGuestWaiting.classList.toggle("hidden", isHost);
  if (isHost) {
    lobbySelectedLength = selectedLength;
    refreshLobbyDifficultyButtons();
  }
  showScreen("lobby");
});

socket.on("lobby_length_set", ({ length }) => {
  openSecretSetup({ length, opponentName: lobbyOpponentName.textContent, opponentAvatar: lobbyOpponentAvatar.textContent });
});

socket.on("lobby_cancelled", ({ message }) => {
  alert(message || "La sala se ha cerrado.");
  goHome();
});

/* ---------- Buscar Rival (emparejamiento aleatorio por dificultad) ---------- */

const difficultyPicker = document.getElementById("difficulty-picker");
const difficultyButtons = Array.from(difficultyPicker.querySelectorAll(".difficulty-option"));
let selectedLength = parseInt(readLS("n1v1_length", "4"), 10);
if (![3, 4, 5].includes(selectedLength)) selectedLength = 4;

function refreshDifficultyButtons() {
  difficultyButtons.forEach((b) => {
    b.classList.toggle("selected", parseInt(b.dataset.length, 10) === selectedLength);
  });
}
refreshDifficultyButtons();

difficultyButtons.forEach((b) => {
  b.addEventListener("click", () => {
    selectedLength = parseInt(b.dataset.length, 10);
    writeLS("n1v1_length", String(selectedLength));
    refreshDifficultyButtons();
  });
});

const quickmatchError = document.getElementById("quickmatch-error");
const quickmatchSearchBtn = document.getElementById("quickmatch-search-btn");
const quickmatchBackBtn = document.getElementById("quickmatch-back-btn");

quickmatchSearchBtn.addEventListener("click", () => {
  resumeAudio();
  myToken = generateToken();
  myName = readLS("n1v1_name", "").trim() || "Jugador";
  myAvatar = selectedAvatar;
  socket.emit("join_game", { name: myName, avatar: myAvatar, length: selectedLength, token: myToken });
  waitingText.textContent = "Buscando rival...";
  showScreen("waiting");
});

quickmatchBackBtn.addEventListener("click", goHome);

socket.on("join_error", ({ message }) => {
  quickmatchError.textContent = message;
  showScreen("quickmatch");
});

socket.on("quickmatch_paired", ({ length, opponentName, opponentAvatar }) => {
  openSecretSetup({ length, opponentName, opponentAvatar });
});

/* ---------- Pantalla de elección de secreto (compartida) ---------- */

const secretSetupTitle = document.getElementById("secret-setup-title");
const setupJoinInfo = document.getElementById("setup-join-info");
const setupLengthHint = document.getElementById("setup-length-hint");
const setupError = document.getElementById("setup-error");
const setupSubmitBtn = document.getElementById("setup-submit-btn");
const setupBackBtn = document.getElementById("setup-back-btn");
const setupLobbyStatus = document.getElementById("setup-lobby-status");
const secretBoxesEl = document.getElementById("secret-boxes");
let secretBoxes = null;
let setupLength = selectedLength;

function rebuildSecretBoxes(length) {
  setupLength = length;
  secretBoxes = createDigitBoxes(secretBoxesEl, length);
  setupLengthHint.textContent = `Tu número secreto (${length} cifras)`;
  setupSubmitBtn.disabled = true;
  setupSubmitBtn.classList.remove("hidden");
  setupLobbyStatus.classList.add("hidden");
  setupError.textContent = "";
  secretBoxes.focusFirst();
}

function openSecretSetup({ length, opponentName, opponentAvatar }) {
  setupJoinInfo.textContent = `Jugarás contra ${opponentAvatar} ${opponentName}`;
  secretSetupTitle.textContent = "Elige tu número secreto";
  setupSubmitBtn.textContent = "Confirmar";
  rebuildSecretBoxes(length);
  showScreen("secretSetup");
}

setupBackBtn.addEventListener("click", () => {
  socket.emit("cancel_lobby");
  goHome();
});

secretBoxesEl.addEventListener("digitschange", () => {
  if (secretBoxes) setupSubmitBtn.disabled = !secretBoxes.isComplete();
});
secretBoxesEl.addEventListener("digitsenter", () => {
  if (secretBoxes && !setupSubmitBtn.disabled) submitSecretSetup();
});
setupSubmitBtn.addEventListener("click", submitSecretSetup);

function submitSecretSetup() {
  const secret = secretBoxes.getValue();
  if (!isValidLength(secret, setupLength)) {
    setupError.textContent = `Introduce un número de exactamente ${setupLength} cifras.`;
    secretBoxes.shake();
    return;
  }
  setupError.textContent = "";
  resumeAudio();
  mySecret = secret;
  secretBoxes.setDisabled(true);
  setupSubmitBtn.classList.add("hidden");
  setupLobbyStatus.classList.remove("hidden");
  socket.emit("submit_lobby_secret", { secret });
}

socket.on("lobby_secret_error", ({ message }) => {
  setupError.textContent = message;
  secretBoxes.setDisabled(false);
  setupSubmitBtn.classList.remove("hidden");
  setupSubmitBtn.disabled = !secretBoxes.isComplete();
  setupLobbyStatus.classList.add("hidden");
  showScreen("secretSetup");
});

socket.on("lobby_waiting_secret", () => {
  setupLobbyStatus.classList.remove("hidden");
});

/* ---------- Pantalla de partida ---------- */

const waitingText = document.getElementById("waiting-text");
const opponentLabel = document.getElementById("opponent-label");
const scoreLabel = document.getElementById("score-label");
const mySecretLabel = document.getElementById("my-secret-label");
const reconnectBanner = document.getElementById("reconnect-banner");
const turnIndicator = document.getElementById("turn-indicator");
const guessBoxesEl = document.getElementById("guess-boxes");
const guessBtn = document.getElementById("guess-btn");
const guessError = document.getElementById("guess-error");
const myAttemptsList = document.getElementById("my-attempts");
const opponentAttemptsList = document.getElementById("opponent-attempts");

let myToken = "";
let mySecret = "";
let myName = "";
let myAvatar = "";
let currentLength = 4;
let isMyTurn = false;
let guessBoxes = null;
let rematchBoxes = null;

function appendAttempt(list, { guess, hits, timeout }) {
  const li = document.createElement("li");
  if (timeout) {
    li.innerHTML = `<span class="timeout">⏱️ Tiempo agotado</span>`;
  } else {
    const hitsClass = hits === currentLength ? "hits hits-high" : "hits";
    li.innerHTML = `<span class="guess">${guess}</span><span class="${hitsClass}">${hits} acierto${hits === 1 ? "" : "s"}</span>`;
  }
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

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
  if (!isValidLength(guess, currentLength)) {
    guessError.textContent = `El intento debe tener ${currentLength} cifras.`;
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

function resetMatchUI() {
  myAttemptsList.innerHTML = "";
  opponentAttemptsList.innerHTML = "";
  chatMessagesEl.innerHTML = "";
  guessError.textContent = "";
  reconnectBanner.classList.add("hidden");
  mySecretLabel.textContent = mySecret;
}

socket.on("match_found", ({ opponentName, opponentAvatar, length, yourTurn, turnSeconds, scoreYou, scoreOpponent }) => {
  currentLength = length;
  guessBoxes = createDigitBoxes(guessBoxesEl, currentLength);
  rematchBoxes = createDigitBoxes(rematchBoxesEl, currentLength);
  opponentLabel.textContent = `${opponentAvatar} ${opponentName}`;
  updateScoreLabel(scoreYou, scoreOpponent);
  resetMatchUI();
  saveSession();
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
  appendAttempt(list, { guess, hits });
  sounds.hit(hits);
  setTurn(yourTurn, turnSeconds);
});

socket.on("turn_timeout", ({ by, yourTurn, turnSeconds }) => {
  const list = by === socket.id ? myAttemptsList : opponentAttemptsList;
  appendAttempt(list, { timeout: true });
  sounds.timeout();
  setTurn(yourTurn, turnSeconds);
});

/* ---------- Chat ---------- */

const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("send_chat", { text });
  chatInput.value = "";
});

socket.on("chat_message", ({ by, name, avatar, text }) => {
  const li = document.createElement("li");
  const isOwn = by === socket.id;
  li.className = isOwn ? "own" : "";
  const author = isOwn ? "Tú" : `${avatar} ${name}`;
  const safeText = document.createElement("span");
  safeText.textContent = text;
  li.innerHTML = `<span class="chat-author">${author}</span>`;
  li.appendChild(safeText);
  chatMessagesEl.appendChild(li);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  if (!isOwn) sounds.chat();
});

/* ---------- Pantalla de fin de partida ---------- */

const gameoverTitle = document.getElementById("gameover-title");
const gameoverDetail = document.getElementById("gameover-detail");
const gameoverScore = document.getElementById("gameover-score");
const rematchBtn = document.getElementById("rematch-btn");
const newOpponentBtn = document.getElementById("new-opponent-btn");
const surrenderBtn = document.getElementById("surrender-btn");

function handleGameOver(payload, opts = {}) {
  const { won, yourSecret, opponentSecret, scoreYou, scoreOpponent, reason, champion } = payload;
  stopTurnTimer();
  updateScoreLabel(scoreYou, scoreOpponent);

  gameoverTitle.classList.remove("champion-glow");
  if (champion) {
    gameoverTitle.textContent = won ? "🏆 ¡Eres el campeón de la sesión!" : "🏆 Tu rival es el campeón de la sesión";
    if (won) gameoverTitle.classList.add("champion-glow");
  } else if (reason === "surrender") {
    gameoverTitle.textContent = won ? "🏳️ Tu rival se ha rendido" : "🏳️ Te has rendido";
  } else {
    gameoverTitle.textContent = won ? "🎉 ¡Has ganado!" : "😔 Has perdido";
  }

  gameoverDetail.textContent = `Tu número era ${yourSecret}. El número del rival era ${opponentSecret}.`;
  gameoverScore.textContent = `${champion ? "Marcador final" : "Marcador"}: ${scoreYou} – ${scoreOpponent}`;

  if (!opts.isRejoin) {
    const stats = readStats();
    if (won) stats.wins += 1;
    else stats.losses += 1;
    writeStats(stats);

    if (won) {
      sounds.win();
      launchConfetti();
    } else {
      sounds.lose();
    }
  }

  showScreen("gameover");
}

socket.on("game_over", (payload) => handleGameOver(payload));

newOpponentBtn.addEventListener("click", () => {
  clearSession();
  goHome();
});

surrenderBtn.addEventListener("click", () => {
  const confirmed = window.confirm("¿Seguro que quieres rendirte? Tu rival ganará la partida.");
  if (confirmed) {
    socket.emit("surrender");
  }
});

/* ---------- Revancha ---------- */

const rematchBoxesEl = document.getElementById("rematch-boxes");
const rematchError = document.getElementById("rematch-error");
const rematchConfirmBtn = document.getElementById("rematch-confirm-btn");
const rematchStatus = document.getElementById("rematch-status");

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
  if (!isValidLength(secret, currentLength)) {
    rematchError.textContent = `Introduce un número de exactamente ${currentLength} cifras.`;
    rematchBoxes.shake();
    return;
  }
  rematchError.textContent = "";
  resumeAudio();
  mySecret = secret;
  saveSession();
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
  resetMatchUI();
  updateScoreLabel(scoreYou, scoreOpponent);
  saveSession();
  sounds.match();
  setTurn(yourTurn, turnSeconds);
  showScreen("game");
});

/* ---------- Desconexión y reconexión ---------- */

let reconnectCountdownInterval = null;

socket.on("opponent_disconnected", ({ graceSeconds }) => {
  let remaining = graceSeconds;
  clearInterval(reconnectCountdownInterval);
  reconnectBanner.classList.remove("hidden");
  reconnectBanner.textContent = `Tu rival se ha desconectado. Esperando a que vuelva... (${remaining}s)`;
  reconnectCountdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(reconnectCountdownInterval);
      return;
    }
    reconnectBanner.textContent = `Tu rival se ha desconectado. Esperando a que vuelva... (${remaining}s)`;
  }, 1000);
});

socket.on("opponent_reconnected", () => {
  clearInterval(reconnectCountdownInterval);
  reconnectBanner.classList.add("hidden");
});

socket.on("opponent_left", () => {
  clearInterval(reconnectCountdownInterval);
  clearSession();
  stopTurnTimer();
  gameoverTitle.classList.remove("champion-glow");
  gameoverTitle.textContent = "Tu rival se ha desconectado";
  gameoverDetail.textContent = "La partida ha finalizado.";
  gameoverScore.textContent = "";
  showScreen("gameover");
});

socket.on("rejoined", (data) => {
  const { opponentName, opponentAvatar, length, scoreYou, scoreOpponent, myAttempts, opponentAttempts, state } = data;
  currentLength = length;
  guessBoxes = createDigitBoxes(guessBoxesEl, currentLength);
  rematchBoxes = createDigitBoxes(rematchBoxesEl, currentLength);
  opponentLabel.textContent = `${opponentAvatar} ${opponentName}`;
  resetMatchUI();
  (myAttempts || []).forEach((a) => appendAttempt(myAttemptsList, a));
  (opponentAttempts || []).forEach((a) => appendAttempt(opponentAttemptsList, a));
  updateScoreLabel(scoreYou, scoreOpponent);
  saveSession();

  if (state === "finished") {
    handleGameOver(data, { isRejoin: true });
  } else {
    setTurn(data.yourTurn, data.turnSeconds);
    showScreen("game");
  }
});

socket.on("rejoin_failed", () => {
  clearSession();
  goHome();
});

/* ---------- Arranque ---------- */

function getRoomCodeFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = params.get("room");
  return code ? code.toUpperCase().slice(0, 5) : null;
}

(function boot() {
  let session = null;
  try {
    session = JSON.parse(sessionStorage.getItem("n1v1_session") || "null");
  } catch (e) {
    session = null;
  }

  if (session && session.token) {
    myToken = session.token;
    mySecret = session.secret;
    myName = session.name;
    myAvatar = session.avatar;
    currentLength = session.length || 4;
    waitingText.textContent = "Reconectando con tu partida...";
    showScreen("waiting");
    socket.emit("rejoin", { token: myToken });
    return;
  }

  const urlCode = getRoomCodeFromUrl();
  if (urlCode) {
    history.replaceState({}, "", location.pathname);
    joinCodeInput.value = urlCode;
    joinCodeError.textContent = "";
    resumeAudio();
    myToken = generateToken();
    myName = readLS("n1v1_name", "").trim() || "Jugador";
    myAvatar = selectedAvatar;
    socket.emit("join_room", { code: urlCode, name: myName, avatar: myAvatar, token: myToken });
    waitingText.textContent = "Uniéndote a la sala...";
    showScreen("waiting");
    return;
  }

  goHome();
})();
