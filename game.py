"""Lógica del juego: cola de emparejamiento, salas de partida y reglas."""

import random
import uuid
from dataclasses import dataclass, field
from typing import Optional

DEFAULT_LENGTH = 4
ALLOWED_LENGTHS = (3, 4, 5)
TURN_SECONDS = 60
RECONNECT_GRACE_SECONDS = 60
CHAMPION_WINS = 3
ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin caracteres ambiguos (0/O, 1/I)
ROOM_CODE_LENGTH = 5


def generate_room_code() -> str:
    return "".join(random.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


def is_valid_number(value: str, length: int) -> bool:
    """Un número válido es una cadena de exactamente `length` dígitos (se permiten ceros a la izquierda)."""
    return isinstance(value, str) and len(value) == length and value.isdigit()


def count_hits(guess: str, secret: str) -> int:
    """Cuenta aciertos exactos: mismo dígito en la misma posición."""
    return sum(1 for g, s in zip(guess, secret) if g == s)


@dataclass
class Player:
    sid: str
    name: str
    secret: str
    avatar: str
    token: str
    attempts: list = field(default_factory=list)
    wins: int = 0


@dataclass
class Lobby:
    """Sala de amigos: primero se unen los dos jugadores, luego se elige la
    dificultad (solo el anfitrión) y por último cada uno pone su secreto."""

    code: str
    host_sid: str
    host_name: str
    host_avatar: str
    host_token: str
    guest_sid: Optional[str] = None
    guest_name: Optional[str] = None
    guest_avatar: Optional[str] = None
    guest_token: Optional[str] = None
    length: Optional[int] = None
    secrets: dict = field(default_factory=dict)  # sid -> secret

    def other_sid(self, sid: str) -> Optional[str]:
        if sid == self.host_sid:
            return self.guest_sid
        if sid == self.guest_sid:
            return self.host_sid
        return None


@dataclass
class Room:
    id: str
    length: int
    players: dict  # sid -> Player
    turn_sid: str
    finished: bool = False
    turn_token: int = 0
    last_winner_sid: Optional[str] = None
    rematch_ready: set = field(default_factory=set)
    disconnected_sid: Optional[str] = None
    last_result: Optional[dict] = None  # {"winner_token", "reason", "secrets_by_token"}

    def opponent_sid(self, sid: str) -> str:
        return next(s for s in self.players if s != sid)


class GameManager:
    """Mantiene en memoria la cola de espera y las partidas activas."""

    def __init__(self):
        self.waiting: dict[int, dict] = {}
        self.rooms: dict[str, Room] = {}
        self.sid_to_room: dict[str, str] = {}
        self.token_to_room: dict[str, str] = {}
        self.lobbies: dict[str, Lobby] = {}
        self.sid_to_lobby: dict[str, str] = {}

    def join(self, sid: str, name: str, length: int, avatar: str, token: str):
        """Añade al jugador a la cola de su dificultad o, si ya había alguien esperando
        con la misma dificultad, los une directamente en una Lobby ya completa
        (mismo mecanismo que "jugar con amigos", pero emparejados al azar),
        pendiente solo de que cada uno elija su número secreto.

        Devuelve una tupla (estado, lobby) donde estado es "waiting" o "matched".
        """
        self.cancel_lobby(sid)
        pending = self.waiting.get(length)
        if pending is None:
            self.waiting[length] = {
                "sid": sid,
                "name": name,
                "avatar": avatar,
                "token": token,
            }
            return "waiting", None

        del self.waiting[length]

        code = generate_room_code()
        while code in self.lobbies:
            code = generate_room_code()

        lobby = Lobby(
            code=code,
            host_sid=pending["sid"],
            host_name=pending["name"],
            host_avatar=pending["avatar"],
            host_token=pending["token"],
            guest_sid=sid,
            guest_name=name,
            guest_avatar=avatar,
            guest_token=token,
            length=length,
        )
        self.lobbies[code] = lobby
        self.sid_to_lobby[pending["sid"]] = code
        self.sid_to_lobby[sid] = code
        return "matched", lobby

    def cancel_waiting(self, sid: str) -> None:
        for length, pending in list(self.waiting.items()):
            if pending["sid"] == sid:
                del self.waiting[length]

    def get_room(self, sid: str) -> Optional[Room]:
        room_id = self.sid_to_room.get(sid)
        return self.rooms.get(room_id) if room_id else None

    def make_guess(self, sid: str, guess: str) -> Optional[dict]:
        """Valida el turno, calcula aciertos y actualiza el estado de la sala."""
        room = self.get_room(sid)
        if not room or room.finished or room.turn_sid != sid:
            return None

        player = room.players[sid]
        opponent = room.players[room.opponent_sid(sid)]
        hits = count_hits(guess, opponent.secret)
        player.attempts.append({"guess": guess, "hits": hits})

        won = hits == room.length
        champion = False
        if won:
            room.finished = True
            room.last_winner_sid = player.sid
            player.wins += 1
            room.last_result = {
                "winner_token": player.token,
                "reason": "win",
                "secrets_by_token": {p.token: p.secret for p in room.players.values()},
            }
            champion = player.wins >= CHAMPION_WINS
        else:
            room.turn_sid = opponent.sid
            room.turn_token += 1

        return {
            "room": room,
            "guesser": player,
            "opponent": opponent,
            "hits": hits,
            "won": won,
            "champion": champion,
        }

    def surrender(self, sid: str) -> Optional[dict]:
        """Rinde la partida: el rival gana automáticamente."""
        room = self.get_room(sid)
        if not room or room.finished:
            return None

        quitter = room.players[sid]
        winner = room.players[room.opponent_sid(sid)]
        room.finished = True
        room.last_winner_sid = winner.sid
        winner.wins += 1
        room.last_result = {
            "winner_token": winner.token,
            "reason": "surrender",
            "secrets_by_token": {p.token: p.secret for p in room.players.values()},
        }
        champion = winner.wins >= CHAMPION_WINS
        return {"room": room, "quitter": quitter, "winner": winner, "champion": champion}

    def expire_turn(self, room_id: str, expected_token: int) -> Optional[dict]:
        """Si el turno sigue vigente tras agotarse el tiempo, lo pasa al rival."""
        room = self.rooms.get(room_id)
        if not room or room.finished or room.turn_token != expected_token:
            return None

        timed_out_sid = room.turn_sid
        opponent = room.players[room.opponent_sid(timed_out_sid)]
        room.turn_sid = opponent.sid
        room.turn_token += 1
        return {"room": room, "timed_out_sid": timed_out_sid}

    def submit_rematch_secret(self, sid: str, secret: str):
        """Registra el nuevo número secreto de un jugador para la revancha.

        Devuelve (estado, room) con estado "waiting" o "started", o None si no procede.
        """
        room = self.get_room(sid)
        if not room or not room.finished:
            return None

        room.players[sid].secret = secret
        room.rematch_ready.add(sid)

        if len(room.rematch_ready) < 2:
            return "waiting", room

        for player in room.players.values():
            player.attempts = []

        loser_sid = room.opponent_sid(room.last_winner_sid) if room.last_winner_sid else random.choice(
            list(room.players)
        )
        room.turn_sid = loser_sid
        room.turn_token += 1
        room.finished = False
        room.rematch_ready.clear()
        room.last_result = None
        return "started", room

    def create_lobby(self, sid: str, name: str, avatar: str, token: str) -> str:
        """Crea una sala de amigos vacía, pendiente de que se una un invitado."""
        self.cancel_waiting(sid)
        self.cancel_lobby(sid)
        code = generate_room_code()
        while code in self.lobbies:
            code = generate_room_code()
        self.lobbies[code] = Lobby(code=code, host_sid=sid, host_name=name, host_avatar=avatar, host_token=token)
        self.sid_to_lobby[sid] = code
        return code

    def get_lobby(self, sid: str) -> Optional[Lobby]:
        code = self.sid_to_lobby.get(sid)
        return self.lobbies.get(code) if code else None

    def join_lobby(self, code: str, sid: str, name: str, avatar: str, token: str) -> Optional[Lobby]:
        """Une a un segundo jugador a la sala `code`. Devuelve la Lobby, o None si no procede."""
        lobby = self.lobbies.get(code)
        if not lobby or lobby.guest_sid is not None or lobby.host_sid == sid:
            return None

        self.cancel_waiting(sid)
        self.cancel_lobby(sid)
        lobby = self.lobbies.get(code)
        if not lobby or lobby.guest_sid is not None:
            return None

        lobby.guest_sid = sid
        lobby.guest_name = name
        lobby.guest_avatar = avatar
        lobby.guest_token = token
        self.sid_to_lobby[sid] = code
        return lobby

    def set_lobby_length(self, sid: str, length: int) -> Optional[Lobby]:
        """Fija la dificultad de la sala. Solo el anfitrión puede hacerlo."""
        lobby = self.get_lobby(sid)
        if not lobby or lobby.host_sid != sid or lobby.guest_sid is None:
            return None
        lobby.length = length
        lobby.secrets = {}
        return lobby

    def submit_lobby_secret(self, sid: str, secret: str):
        """Registra el secreto de un jugador de la sala.

        Devuelve (estado, dato) con estado "waiting" (dato=Lobby) o "started" (dato=Room),
        o None si no procede.
        """
        lobby = self.get_lobby(sid)
        if not lobby or lobby.length is None or lobby.guest_sid is None:
            return None
        if sid not in (lobby.host_sid, lobby.guest_sid):
            return None

        lobby.secrets[sid] = secret
        if len(lobby.secrets) < 2:
            return "waiting", lobby

        del self.lobbies[lobby.code]
        self.sid_to_lobby.pop(lobby.host_sid, None)
        self.sid_to_lobby.pop(lobby.guest_sid, None)

        room_id = uuid.uuid4().hex[:8]
        p1 = Player(
            sid=lobby.host_sid,
            name=lobby.host_name,
            secret=lobby.secrets[lobby.host_sid],
            avatar=lobby.host_avatar,
            token=lobby.host_token,
        )
        p2 = Player(
            sid=lobby.guest_sid,
            name=lobby.guest_name,
            secret=lobby.secrets[lobby.guest_sid],
            avatar=lobby.guest_avatar,
            token=lobby.guest_token,
        )
        first_sid = random.choice([p1.sid, p2.sid])

        room = Room(id=room_id, length=lobby.length, players={p1.sid: p1, p2.sid: p2}, turn_sid=first_sid)
        self.rooms[room_id] = room
        self.sid_to_room[p1.sid] = room_id
        self.sid_to_room[p2.sid] = room_id
        self.token_to_room[p1.token] = room_id
        self.token_to_room[p2.token] = room_id
        return "started", room

    def cancel_lobby(self, sid: str) -> Optional[str]:
        """Cierra la sala de amigos de `sid` (si la hay) y devuelve el sid del otro
        jugador (si ya se había unido), para poder avisarle."""
        code = self.sid_to_lobby.pop(sid, None)
        if not code:
            return None
        lobby = self.lobbies.pop(code, None)
        if not lobby:
            return None
        other_sid = lobby.other_sid(sid)
        if other_sid:
            self.sid_to_lobby.pop(other_sid, None)
        return other_sid

    def remove_room(self, room_id: str) -> None:
        room = self.rooms.pop(room_id, None)
        if room:
            for player in room.players.values():
                self.sid_to_room.pop(player.sid, None)
                self.token_to_room.pop(player.token, None)

    def disconnect(self, sid: str):
        """Gestiona la desconexión de un socket: sale de la cola, cierra su sala de
        amigos pendiente (si la había) y marca su partida como pendiente de
        reconexión (no se borra al instante).

        Devuelve (room, lobby_other_sid): `room` si estaba en una partida activa,
        y el sid del otro jugador de su sala de amigos (si la había) para avisarle.
        """
        self.cancel_waiting(sid)
        lobby_other_sid = self.cancel_lobby(sid)
        room = self.get_room(sid)
        if room:
            room.disconnected_sid = sid
        return room, lobby_other_sid

    def finalize_disconnect(self, room_id: str, sid: str) -> Optional[Room]:
        """Tras agotarse el tiempo de gracia sin reconexión, cierra la sala definitivamente."""
        room = self.rooms.get(room_id)
        if not room or room.disconnected_sid != sid:
            return None
        self.remove_room(room_id)
        return room

    def rejoin(self, token: str, new_sid: str) -> Optional[Room]:
        """Reasocia una sala existente a una nueva conexión (tras recargar la página)."""
        room_id = self.token_to_room.get(token)
        room = self.rooms.get(room_id) if room_id else None
        if not room:
            return None

        old_sid = next((p.sid for p in room.players.values() if p.token == token), None)
        if old_sid is None:
            return None

        player = room.players.pop(old_sid)
        player.sid = new_sid
        room.players[new_sid] = player

        self.sid_to_room.pop(old_sid, None)
        self.sid_to_room[new_sid] = room.id

        if room.turn_sid == old_sid:
            room.turn_sid = new_sid
        if room.last_winner_sid == old_sid:
            room.last_winner_sid = new_sid
        if room.disconnected_sid == old_sid:
            room.disconnected_sid = None
        if old_sid in room.rematch_ready:
            room.rematch_ready.discard(old_sid)
            room.rematch_ready.add(new_sid)

        return room
