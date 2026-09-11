"""Lógica del juego: cola de emparejamiento, salas de partida y reglas."""

import random
import uuid
from dataclasses import dataclass, field
from typing import Optional

SECRET_LENGTH = 4
TURN_SECONDS = 60


def is_valid_number(value: str) -> bool:
    """Un número válido es una cadena de exactamente 4 dígitos (se permiten ceros a la izquierda)."""
    return isinstance(value, str) and len(value) == SECRET_LENGTH and value.isdigit()


def count_hits(guess: str, secret: str) -> int:
    """Cuenta aciertos exactos: mismo dígito en la misma posición."""
    return sum(1 for g, s in zip(guess, secret) if g == s)


@dataclass
class Player:
    sid: str
    name: str
    secret: str
    attempts: list = field(default_factory=list)
    wins: int = 0


@dataclass
class Room:
    id: str
    players: dict  # sid -> Player
    turn_sid: str
    finished: bool = False
    turn_token: int = 0
    last_winner_sid: Optional[str] = None
    rematch_ready: set = field(default_factory=set)

    def opponent_sid(self, sid: str) -> str:
        return next(s for s in self.players if s != sid)


class GameManager:
    """Mantiene en memoria la cola de espera y las partidas activas."""

    def __init__(self):
        self.waiting: Optional[dict] = None
        self.rooms: dict[str, Room] = {}
        self.sid_to_room: dict[str, str] = {}

    def join(self, sid: str, name: str, secret: str):
        """Añade al jugador a la cola o, si ya había alguien esperando, crea la partida.

        Devuelve una tupla (estado, room) donde estado es "waiting" o "matched".
        """
        if self.waiting is None:
            self.waiting = {"sid": sid, "name": name, "secret": secret}
            return "waiting", None

        opponent = self.waiting
        self.waiting = None

        room_id = uuid.uuid4().hex[:8]
        p1 = Player(sid=opponent["sid"], name=opponent["name"], secret=opponent["secret"])
        p2 = Player(sid=sid, name=name, secret=secret)
        first_sid = random.choice([p1.sid, p2.sid])

        room = Room(id=room_id, players={p1.sid: p1, p2.sid: p2}, turn_sid=first_sid)
        self.rooms[room_id] = room
        self.sid_to_room[p1.sid] = room_id
        self.sid_to_room[p2.sid] = room_id
        return "matched", room

    def cancel_waiting(self, sid: str) -> None:
        if self.waiting and self.waiting["sid"] == sid:
            self.waiting = None

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

        won = hits == SECRET_LENGTH
        if won:
            room.finished = True
            room.last_winner_sid = player.sid
            player.wins += 1
        else:
            room.turn_sid = opponent.sid
            room.turn_token += 1

        return {"room": room, "guesser": player, "opponent": opponent, "hits": hits, "won": won}

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
        return "started", room

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
        return {"room": room, "quitter": quitter, "winner": winner}

    def remove_room(self, room_id: str) -> None:
        room = self.rooms.pop(room_id, None)
        if room:
            for sid in room.players:
                self.sid_to_room.pop(sid, None)

    def leave(self, sid: str) -> Optional[Room]:
        """Gestiona la desconexión de un jugador: sale de la cola o cierra su partida."""
        self.cancel_waiting(sid)
        room = self.get_room(sid)
        if room:
            room.finished = True
            self.remove_room(room.id)
        return room
