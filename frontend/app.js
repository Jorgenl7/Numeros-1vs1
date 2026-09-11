const socket = io();

const screens = {
  setup: document.getElementById("setup-screen"),
  waiting: document.getElementById("waiting-screen"),
  game: document.getElementById("game-screen"),
  gameover: document.getElementById("gameover-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function restrictToDigits(input) {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 4);
  });
}

function isFourDigits(value) {
  return /^\d{4}$/.test(value);
}

const setupForm = document.getElementById("setup-form");
const nameInput = document.getElementById("name-input");
const secretInput = document.getElementById("secret-input");
const setupError = document.getElementById("setup-error");

const opponentLabel = document.getElementById("opponent-label");
const turnIndicator = document.getElementById("turn-indicator");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const guessBtn = document.getElementById("guess-btn");
const guessError = document.getElementById("guess-error");
const myAttemptsList = document.getElementById("my-attempts");
const opponentAttemptsList = document.getElementById("opponent-attempts");

const gameoverTitle = document.getElementById("gameover-title");
const gameoverDetail = document.getElementById("gameover-detail");
const playAgainBtn = document.getElementById("play-again-btn");

restrictToDigits(secretInput);
restrictToDigits(guessInput);

setupForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const secret = secretInput.value.trim();
  if (!isFourDigits(secret)) {
    setupError.textContent = "Introduce un número de exactamente 4 cifras.";
    return;
  }
  setupError.textContent = "";
  socket.emit("join_game", { name: nameInput.value.trim(), secret });
  showScreen("waiting");
});

socket.on("join_error", ({ message }) => {
  setupError.textContent = message;
  showScreen("setup");
});

socket.on("waiting_for_opponent", () => {
  showScreen("waiting");
});

socket.on("match_found", ({ opponentName, yourTurn }) => {
  opponentLabel.textContent = `Rival: ${opponentName}`;
  myAttemptsList.innerHTML = "";
  opponentAttemptsList.innerHTML = "";
  guessError.textContent = "";
  setTurn(yourTurn);
  showScreen("game");
});

function setTurn(yourTurn) {
  guessInput.disabled = !yourTurn;
  guessBtn.disabled = !yourTurn;
  turnIndicator.textContent = yourTurn ? "¡Tu turno!" : "Turno del rival";
  turnIndicator.className = "badge " + (yourTurn ? "badge-your-turn" : "badge-opponent-turn");
  if (yourTurn) {
    guessInput.focus();
  }
}

guessForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const guess = guessInput.value.trim();
  if (!isFourDigits(guess)) {
    guessError.textContent = "El intento debe tener 4 cifras.";
    return;
  }
  guessError.textContent = "";
  socket.emit("make_guess", { guess });
  guessInput.value = "";
});

socket.on("guess_error", ({ message }) => {
  guessError.textContent = message;
});

socket.on("guess_result", ({ by, guess, hits, yourTurn }) => {
  const list = by === socket.id ? myAttemptsList : opponentAttemptsList;
  const li = document.createElement("li");
  li.innerHTML = `<span class="guess">${guess}</span><span class="hits">${hits} acierto${hits === 1 ? "" : "s"}</span>`;
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
  setTurn(yourTurn);
});

socket.on("game_over", ({ won, yourSecret, opponentSecret }) => {
  gameoverTitle.textContent = won ? "🎉 ¡Has ganado!" : "😔 Has perdido";
  gameoverDetail.textContent = `Tu número era ${yourSecret}. El número del rival era ${opponentSecret}.`;
  showScreen("gameover");
});

socket.on("opponent_left", () => {
  gameoverTitle.textContent = "Tu rival se ha desconectado";
  gameoverDetail.textContent = "La partida ha finalizado.";
  showScreen("gameover");
});

playAgainBtn.addEventListener("click", () => {
  location.reload();
});
