# Adivina el Número — 1vs1 online

Juego multijugador en tiempo real donde dos jugadores intentan adivinar el
número secreto de 4 cifras del rival. Backend en **FastAPI + Socket.IO**
(WebSockets), frontend en **HTML/CSS/JS** puro.

## Reglas

1. Cada jugador elige un número secreto de 4 cifras (se permiten repetidos y
   ceros a la izquierda, p. ej. `0032`).
2. Se juega por turnos. En su turno, un jugador introduce un intento de 4
   cifras.
3. El servidor compara el intento contra el número secreto del rival y
   devuelve **solo la cantidad de aciertos exactos** (mismo dígito en la
   misma posición). Nunca revela qué dígitos ni en qué posición son correctos.
4. Gana quien primero consiga 4 aciertos.

## Estructura del proyecto

```
Numeros 1vs1/
├── app.py              # Servidor FastAPI + Socket.IO (eventos, rutas)
├── game.py             # Lógica de partidas: cola, salas, cálculo de aciertos
├── requirements.txt
├── Procfile            # Comando de arranque para Render/Railway
├── render.yaml         # Configuración de despliegue en Render (Blueprint)
├── .python-version
├── .gitignore
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

El número secreto de cada jugador **solo existe en el servidor** (dentro de
`game.py`); nunca se envía al navegador del rival, ni siquiera en el mensaje
de victoria hasta que la partida termina.

## Cómo funciona el emparejamiento

Al pulsar "Buscar partida", el jugador entra en una cola de espera en memoria
del servidor. En cuanto hay dos jugadores esperando, se crea una sala y
empieza la partida (el primer turno se decide al azar). Esto significa que
para probarlo tú solo puedes abrir **dos pestañas** del navegador: la primera
quedará "buscando rival" y, al abrir la segunda y enviar su número secreto,
ambas se emparejarán automáticamente.

## Requisitos

- Python 3.10 o superior
- pip

## Instalación y prueba en local

Desde la carpeta del proyecto, en PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Arranca el servidor en modo desarrollo (con recarga automática):

```powershell
uvicorn app:socket_app --reload
```

Abre en el navegador:

```
http://127.0.0.1:8000
```

Para probar una partida completa tú solo, abre **una segunda pestaña** (o una
ventana de incógnito) con la misma URL. Introduce un nombre y un número
secreto en cada una y pulsa "Buscar partida" en ambas: se emparejarán
automáticamente y podrás jugar el 1 vs 1 entre las dos pestañas.

## Despliegue gratuito en Render

1. Sube el proyecto a un repositorio de GitHub (ver comandos abajo).
2. Entra en [render.com](https://render.com) y crea una cuenta gratuita.
3. Pulsa **New +** → **Blueprint**, y selecciona tu repositorio. Render leerá
   automáticamente el fichero `render.yaml` y configurará el servicio.
   - Si prefieres configurarlo a mano en su lugar, elige **New +** → **Web
     Service**, selecciona el repo y usa:
     - **Build Command:** `pip install -r requirements.txt`
     - **Start Command:** `uvicorn app:socket_app --host 0.0.0.0 --port $PORT`
     - **Plan:** Free
4. Despliega. Cuando termine el build, Render te dará una URL pública tipo
   `https://numeros-1vs1.onrender.com`. Compártela con tu rival para jugar
   online.

> Nota: en el plan gratuito, Render "duerme" el servicio tras un rato de
> inactividad; la primera petición tras dormir tarda unos segundos en
> responder mientras arranca de nuevo.

## Despliegue gratuito en Railway

1. Sube el proyecto a GitHub.
2. Entra en [railway.app](https://railway.app) y crea una cuenta gratuita.
3. **New Project** → **Deploy from GitHub repo** → selecciona tu repositorio.
4. Railway detecta Python automáticamente. Si no usa el `Procfile` por
   defecto, ve a **Settings** → **Deploy** y fija manualmente:
   - **Start Command:** `uvicorn app:socket_app --host 0.0.0.0 --port $PORT`
5. Ve a **Settings** → **Networking** → **Generate Domain** para obtener una
   URL pública HTTPS.
6. Comparte la URL para jugar online.

## Subir el proyecto a GitHub (paso previo a desplegar)

```bash
git init
git add .
git commit -m "Juego 1vs1 adivina el número"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git push -u origin main
```

(Crea antes el repositorio vacío en GitHub desde la web, sin README, para
evitar conflictos al hacer push.)

## Limitaciones conocidas (a tener en cuenta)

- El estado de las partidas se guarda **en memoria** del proceso del
  servidor: si despliegas con varias instancias/réplicas, dos jugadores
  podrían caer en instancias distintas y nunca emparejarse. Usa siempre
  **1 instancia** (es lo que hacen por defecto los planes gratuitos de
  Render/Railway).
- Si un jugador recarga la página a mitad de partida, se le asigna una nueva
  conexión y la partida se da por finalizada para el rival (mensaje "tu rival
  se ha desconectado").
- No hay salas privadas por código: el emparejamiento es automático (el
  primero que llega espera, el segundo se empareja con él). Es la forma más
  sencilla de jugar 1 vs 1 con quien quieras: compartid la misma URL y
  entrad casi a la vez.
