"""Servidor del juego "Adivina el número 1vs1": FastAPI + Socket.IO."""

import pathlib

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from game import GameManager, is_valid_number

BASE_DIR = pathlib.Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
fastapi_app = FastAPI()
socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

fastapi_app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

games = GameManager()


@fastapi_app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@sio.event
async def connect(sid, environ):
    print(f"Cliente conectado: {sid}")


@sio.event
async def disconnect(sid):
    room = games.leave(sid)
    if room:
        opponent_sid = next((s for s in room.players if s != sid), None)
        if opponent_sid:
            await sio.emit("opponent_left", {}, to=opponent_sid)


@sio.event
async def join_game(sid, data):
    data = data or {}
    name = str(data.get("name") or "").strip()[:20] or "Jugador"
    secret = str(data.get("secret") or "").strip()

    if not is_valid_number(secret):
        await sio.emit("join_error", {"message": "El número secreto debe tener exactamente 4 cifras (0-9)."}, to=sid)
        return

    status, room = games.join(sid, name, secret)

    if status == "waiting":
        await sio.emit("waiting_for_opponent", {}, to=sid)
        return

    for player_sid, player in room.players.items():
        opponent = room.players[room.opponent_sid(player_sid)]
        sio.enter_room(player_sid, room.id)
        await sio.emit(
            "match_found",
            {
                "room": room.id,
                "yourTurn": room.turn_sid == player_sid,
                "opponentName": opponent.name,
            },
            to=player_sid,
        )


@sio.event
async def make_guess(sid, data):
    data = data or {}
    guess = str(data.get("guess") or "").strip()

    if not is_valid_number(guess):
        await sio.emit("guess_error", {"message": "El intento debe tener exactamente 4 cifras (0-9)."}, to=sid)
        return

    result = games.make_guess(sid, guess)
    if result is None:
        await sio.emit("guess_error", {"message": "No es tu turno o la partida ya no existe."}, to=sid)
        return

    room = result["room"]
    guesser = result["guesser"]
    opponent = result["opponent"]
    hits = result["hits"]
    won = result["won"]

    await sio.emit(
        "guess_result",
        {"by": guesser.sid, "guess": guess, "hits": hits, "yourTurn": False},
        to=guesser.sid,
    )
    await sio.emit(
        "guess_result",
        {"by": guesser.sid, "guess": guess, "hits": hits, "yourTurn": True},
        to=opponent.sid,
    )

    if won:
        await sio.emit(
            "game_over",
            {"won": True, "yourSecret": guesser.secret, "opponentSecret": opponent.secret},
            to=guesser.sid,
        )
        await sio.emit(
            "game_over",
            {"won": False, "yourSecret": opponent.secret, "opponentSecret": guesser.secret},
            to=opponent.sid,
        )
        games.remove_room(room.id)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:socket_app", host="0.0.0.0", port=8000, reload=True)
