"""Servidor del juego "Adivina el número 1vs1": FastAPI + Socket.IO."""

import asyncio
import pathlib

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from game import TURN_SECONDS, GameManager, is_valid_number

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


def score_payload(player, opponent):
    return {"scoreYou": player.wins, "scoreOpponent": opponent.wins}


async def schedule_turn_timeout(room_id: str, turn_token: int):
    await asyncio.sleep(TURN_SECONDS)

    result = games.expire_turn(room_id, turn_token)
    if result is None:
        return

    room = result["room"]
    timed_out_sid = result["timed_out_sid"]
    new_turn_sid = room.turn_sid
    timed_out_player = room.players[timed_out_sid]
    other_player = room.players[new_turn_sid]

    await sio.emit(
        "turn_timeout",
        {"by": timed_out_sid, "yourTurn": False, "turnSeconds": TURN_SECONDS},
        to=timed_out_sid,
    )
    await sio.emit(
        "turn_timeout",
        {"by": timed_out_sid, "yourTurn": True, "turnSeconds": TURN_SECONDS},
        to=new_turn_sid,
    )
    sio.start_background_task(schedule_turn_timeout, room.id, room.turn_token)


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
                "turnSeconds": TURN_SECONDS,
                **score_payload(player, opponent),
            },
            to=player_sid,
        )

    sio.start_background_task(schedule_turn_timeout, room.id, room.turn_token)


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
        {"by": guesser.sid, "guess": guess, "hits": hits, "yourTurn": False, "turnSeconds": TURN_SECONDS},
        to=guesser.sid,
    )
    await sio.emit(
        "guess_result",
        {"by": guesser.sid, "guess": guess, "hits": hits, "yourTurn": True, "turnSeconds": TURN_SECONDS},
        to=opponent.sid,
    )

    if won:
        await sio.emit(
            "game_over",
            {"won": True, "yourSecret": guesser.secret, "opponentSecret": opponent.secret, **score_payload(guesser, opponent)},
            to=guesser.sid,
        )
        await sio.emit(
            "game_over",
            {"won": False, "yourSecret": opponent.secret, "opponentSecret": guesser.secret, **score_payload(opponent, guesser)},
            to=opponent.sid,
        )
    else:
        sio.start_background_task(schedule_turn_timeout, room.id, room.turn_token)


@sio.event
async def surrender(sid, data=None):
    result = games.surrender(sid)
    if result is None:
        return

    quitter = result["quitter"]
    winner = result["winner"]

    await sio.emit(
        "game_over",
        {
            "won": False,
            "yourSecret": quitter.secret,
            "opponentSecret": winner.secret,
            "reason": "surrender",
            **score_payload(quitter, winner),
        },
        to=quitter.sid,
    )
    await sio.emit(
        "game_over",
        {
            "won": True,
            "yourSecret": winner.secret,
            "opponentSecret": quitter.secret,
            "reason": "surrender",
            **score_payload(winner, quitter),
        },
        to=winner.sid,
    )


@sio.event
async def request_rematch(sid, data):
    data = data or {}
    secret = str(data.get("secret") or "").strip()

    if not is_valid_number(secret):
        await sio.emit("rematch_error", {"message": "El número secreto debe tener exactamente 4 cifras (0-9)."}, to=sid)
        return

    result = games.submit_rematch_secret(sid, secret)
    if result is None:
        await sio.emit("rematch_error", {"message": "La partida ya no existe. Busca un rival nuevo."}, to=sid)
        return

    status, room = result

    if status == "waiting":
        await sio.emit("rematch_waiting", {}, to=sid)
        return

    for player_sid, player in room.players.items():
        opponent = room.players[room.opponent_sid(player_sid)]
        await sio.emit(
            "rematch_started",
            {
                "yourTurn": room.turn_sid == player_sid,
                "turnSeconds": TURN_SECONDS,
                **score_payload(player, opponent),
            },
            to=player_sid,
        )

    sio.start_background_task(schedule_turn_timeout, room.id, room.turn_token)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:socket_app", host="0.0.0.0", port=8000, reload=True)
