"""Servidor del juego "Adivina el número 1vs1": FastAPI + Socket.IO."""

import asyncio
import pathlib

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from game import (
    ALLOWED_LENGTHS,
    DEFAULT_LENGTH,
    RECONNECT_GRACE_SECONDS,
    TURN_SECONDS,
    GameManager,
    is_valid_number,
)

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


def sanitize_name(raw) -> str:
    return str(raw or "").strip()[:20] or "Jugador"


def sanitize_avatar(raw) -> str:
    avatar = str(raw or "").strip()
    return avatar[:8] if avatar else "🙂"


def sanitize_length(raw) -> int:
    try:
        length = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LENGTH
    return length if length in ALLOWED_LENGTHS else DEFAULT_LENGTH


async def start_room(room):
    """Emite match_found a ambos jugadores y arranca el temporizador de turno."""
    for player_sid, player in room.players.items():
        opponent = room.players[room.opponent_sid(player_sid)]
        await sio.enter_room(player_sid, room.id)
        await sio.emit(
            "match_found",
            {
                "yourTurn": room.turn_sid == player_sid,
                "opponentName": opponent.name,
                "opponentAvatar": opponent.avatar,
                "length": room.length,
                "turnSeconds": TURN_SECONDS,
                **score_payload(player, opponent),
            },
            to=player_sid,
        )
    sio.start_background_task(schedule_turn_timeout, room.id, room.turn_token)


async def schedule_turn_timeout(room_id: str, turn_token: int):
    await asyncio.sleep(TURN_SECONDS)

    result = games.expire_turn(room_id, turn_token)
    if result is None:
        return

    room = result["room"]
    timed_out_sid = result["timed_out_sid"]
    new_turn_sid = room.turn_sid

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


async def schedule_disconnect_grace(room_id: str, sid: str):
    await asyncio.sleep(RECONNECT_GRACE_SECONDS)

    room = games.finalize_disconnect(room_id, sid)
    if room is None:
        return

    opponent_sid = next((s for s in room.players if s != sid), None)
    if opponent_sid:
        await sio.emit("opponent_left", {}, to=opponent_sid)


@sio.event
async def connect(sid, environ):
    print(f"Cliente conectado: {sid}")


@sio.event
async def disconnect(sid):
    room = games.disconnect(sid)
    if room is None:
        return

    opponent_sid = next((s for s in room.players if s != sid), None)
    if opponent_sid:
        await sio.emit("opponent_disconnected", {"graceSeconds": RECONNECT_GRACE_SECONDS}, to=opponent_sid)
    sio.start_background_task(schedule_disconnect_grace, room.id, sid)


@sio.event
async def join_game(sid, data):
    data = data or {}
    name = sanitize_name(data.get("name"))
    avatar = sanitize_avatar(data.get("avatar"))
    token = str(data.get("token") or "").strip()
    secret = str(data.get("secret") or "").strip()
    length = sanitize_length(data.get("length"))

    if not token:
        await sio.emit("join_error", {"message": "Falta identificador de sesión. Recarga la página."}, to=sid)
        return

    if not is_valid_number(secret, length):
        await sio.emit(
            "join_error",
            {"message": f"El número secreto debe tener exactamente {length} cifras (0-9)."},
            to=sid,
        )
        return

    status, room = games.join(sid, name, secret, length, avatar, token)

    if status == "waiting":
        await sio.emit("waiting_for_opponent", {}, to=sid)
        return

    await start_room(room)


@sio.event
async def create_room(sid, data):
    data = data or {}
    name = sanitize_name(data.get("name"))
    avatar = sanitize_avatar(data.get("avatar"))
    token = str(data.get("token") or "").strip()
    secret = str(data.get("secret") or "").strip()
    length = sanitize_length(data.get("length"))

    if not token:
        await sio.emit("join_error", {"message": "Falta identificador de sesión. Recarga la página."}, to=sid)
        return

    if not is_valid_number(secret, length):
        await sio.emit(
            "join_error",
            {"message": f"El número secreto debe tener exactamente {length} cifras (0-9)."},
            to=sid,
        )
        return

    code = games.create_room_code(sid, name, secret, length, avatar, token)
    await sio.emit("room_created", {"code": code, "length": length}, to=sid)


@sio.event
async def cancel_room_code(sid, data=None):
    games.cancel_room_code(sid)


@sio.event
async def check_room_code(sid, data):
    data = data or {}
    code = str(data.get("code") or "").strip().upper()
    pending = games.peek_room_code(code)

    if not pending:
        await sio.emit("room_code_checked", {"valid": False}, to=sid)
        return

    await sio.emit(
        "room_code_checked",
        {
            "valid": True,
            "code": code,
            "length": pending["length"],
            "creatorName": pending["name"],
            "creatorAvatar": pending["avatar"],
        },
        to=sid,
    )


@sio.event
async def join_room(sid, data):
    data = data or {}
    code = str(data.get("code") or "").strip().upper()
    name = sanitize_name(data.get("name"))
    avatar = sanitize_avatar(data.get("avatar"))
    token = str(data.get("token") or "").strip()
    secret = str(data.get("secret") or "").strip()

    pending = games.peek_room_code(code)
    if not pending:
        await sio.emit("join_room_error", {"message": "Ese código ya no está disponible."}, to=sid)
        return

    if not token:
        await sio.emit("join_room_error", {"message": "Falta identificador de sesión. Recarga la página."}, to=sid)
        return

    if not is_valid_number(secret, pending["length"]):
        await sio.emit(
            "join_room_error",
            {"message": f"El número secreto debe tener exactamente {pending['length']} cifras (0-9)."},
            to=sid,
        )
        return

    room = games.join_room_code(code, sid, name, secret, avatar, token)
    if room is None:
        await sio.emit("join_room_error", {"message": "No puedes unirte a tu propia partida."}, to=sid)
        return

    await start_room(room)


@sio.event
async def rejoin(sid, data):
    data = data or {}
    token = str(data.get("token") or "").strip()
    if not token:
        await sio.emit("rejoin_failed", {}, to=sid)
        return

    room = games.rejoin(token, sid)
    if room is None:
        await sio.emit("rejoin_failed", {}, to=sid)
        return

    await sio.enter_room(sid, room.id)
    player = room.players[sid]
    opponent = room.players[room.opponent_sid(sid)]

    payload = {
        "opponentName": opponent.name,
        "opponentAvatar": opponent.avatar,
        "length": room.length,
        "myAttempts": player.attempts,
        "opponentAttempts": opponent.attempts,
        **score_payload(player, opponent),
    }

    if room.finished:
        payload["state"] = "finished"
        last_result = room.last_result or {}
        secrets = last_result.get("secrets_by_token", {})
        payload["won"] = last_result.get("winner_token") == player.token
        payload["yourSecret"] = secrets.get(player.token, player.secret)
        payload["opponentSecret"] = secrets.get(opponent.token, opponent.secret)
        payload["reason"] = last_result.get("reason", "win")
    else:
        payload["state"] = "playing"
        payload["yourTurn"] = room.turn_sid == sid
        payload["turnSeconds"] = TURN_SECONDS

    await sio.emit("rejoined", payload, to=sid)
    await sio.emit("opponent_reconnected", {}, to=opponent.sid)


@sio.event
async def make_guess(sid, data):
    data = data or {}
    room = games.get_room(sid)
    length = room.length if room else DEFAULT_LENGTH
    guess = str(data.get("guess") or "").strip()

    if not is_valid_number(guess, length):
        await sio.emit("guess_error", {"message": f"El intento debe tener exactamente {length} cifras (0-9)."}, to=sid)
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
    champion = result["champion"]

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
        payload_guesser = {
            "won": True,
            "yourSecret": guesser.secret,
            "opponentSecret": opponent.secret,
            "champion": champion,
            **score_payload(guesser, opponent),
        }
        payload_opponent = {
            "won": False,
            "yourSecret": opponent.secret,
            "opponentSecret": guesser.secret,
            "champion": champion,
            **score_payload(opponent, guesser),
        }
        if champion:
            guesser.wins = 0
            opponent.wins = 0
        await sio.emit("game_over", payload_guesser, to=guesser.sid)
        await sio.emit("game_over", payload_opponent, to=opponent.sid)
    else:
        sio.start_background_task(schedule_turn_timeout, room.id, room.turn_token)


@sio.event
async def surrender(sid, data=None):
    result = games.surrender(sid)
    if result is None:
        return

    quitter = result["quitter"]
    winner = result["winner"]
    champion = result["champion"]

    payload_quitter = {
        "won": False,
        "yourSecret": quitter.secret,
        "opponentSecret": winner.secret,
        "reason": "surrender",
        "champion": champion,
        **score_payload(quitter, winner),
    }
    payload_winner = {
        "won": True,
        "yourSecret": winner.secret,
        "opponentSecret": quitter.secret,
        "reason": "surrender",
        "champion": champion,
        **score_payload(winner, quitter),
    }
    if champion:
        quitter.wins = 0
        winner.wins = 0
    await sio.emit("game_over", payload_quitter, to=quitter.sid)
    await sio.emit("game_over", payload_winner, to=winner.sid)


@sio.event
async def request_rematch(sid, data):
    data = data or {}
    room = games.get_room(sid)
    length = room.length if room else DEFAULT_LENGTH
    secret = str(data.get("secret") or "").strip()

    if not is_valid_number(secret, length):
        await sio.emit(
            "rematch_error",
            {"message": f"El número secreto debe tener exactamente {length} cifras (0-9)."},
            to=sid,
        )
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


@sio.event
async def send_chat(sid, data):
    data = data or {}
    text = str(data.get("text") or "").strip()[:200]
    if not text:
        return

    room = games.get_room(sid)
    if not room:
        return

    sender = room.players.get(sid)
    if not sender:
        return

    await sio.emit(
        "chat_message",
        {"by": sid, "name": sender.name, "avatar": sender.avatar, "text": text},
        to=room.id,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:socket_app", host="0.0.0.0", port=8000, reload=True)
