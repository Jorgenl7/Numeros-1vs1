# Adivina el Número — 1vs1 online

Juego multijugador en tiempo real donde dos jugadores intentan adivinar el
número secreto de 4 cifras del rival. Backend en **FastAPI + Socket.IO**
(WebSockets), frontend en **HTML/CSS/JS** puro.

## Reglas

1. Cada jugador elige un número secreto (3, 4 o 5 cifras, a elegir en el
   menú; se permiten repetidos y ceros a la izquierda, p. ej. `0032`).
2. Se juega por turnos. En su turno, un jugador introduce un intento con el
   mismo número de cifras. Tiene 60 segundos para hacerlo; si se le acaba el
   tiempo, el turno pasa automáticamente al rival.
3. El servidor compara el intento contra el número secreto del rival y
   devuelve **solo la cantidad de aciertos exactos** (mismo dígito en la
   misma posición). Nunca revela qué dígitos ni en qué posición son correctos.
4. Gana quien primero acierte todas las cifras (o si el rival se rinde).
   El primero en ganar **3 partidas** se corona campeón de la sesión y el
   marcador vuelve a 0-0.

## Funciones

- **Pantalla de inicio** con dos acciones principales — "Buscar Rival"
  (emparejamiento aleatorio) y "Jugar con Amigos" (código o enlace) — y
  accesos a Perfil y Ajustes.
- **Perfil persistente**: nombre y avatar (emoji) se eligen una vez y se
  recuerdan para todas las partidas; se pueden cambiar cuando quieras desde
  "Perfil".
- **Jugar con amigos**: crea una partida privada y comparte el código de 5
  caracteres o el enlace directo (`?room=CÓDIGO`) con quien quieras que
  juegue contigo; al abrir el enlace se entra directamente a introducir el
  número secreto, sin pasar por el emparejamiento aleatorio.
- **Ajustes**: tema claro/oscuro y sonido, en una pantalla dedicada.
- **Marcador persistente** durante la sesión, con pantalla especial de
  "campeón" al llegar a 3 victorias.
- **Estadísticas de por vida** (victorias/derrotas totales en este
  navegador), visibles en el Perfil.
- **Revancha instantánea**: al terminar una partida, ambos pulsan "Jugar otra
  vez" y eligen un nuevo número sin volver a emparejarse. Empieza quien
  perdió la ronda anterior.
- **Rendirse**: cualquiera puede rendirse durante la partida; el rival gana
  automáticamente.
- **Reconexión**: si recargas la página a mitad de partida, recuperas tu
  partida en curso (mismo rival, mismos intentos) en vez de perderla. Tu
  rival ve un aviso de "esperando a que vuelva" durante 60 segundos.
- **Chat** en la propia partida.
- **Temporizador por turno**, sonidos y confeti al ganar (todo generado en el
  propio navegador, sin ficheros de audio externos).

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

**Buscar Rival**: primero se elige la dificultad y el jugador entra en una
cola de espera en memoria del servidor (una por cada dificultad), sin haber
elegido aún su número secreto. En cuanto hay dos jugadores esperando con la
misma dificultad, se emparejan (ya viéndose el nombre y avatar del rival) y
solo entonces cada uno elige su número secreto; la partida empieza en cuanto
ambos lo han enviado (el primer turno se decide al azar).

**Jugar con Amigos**: "Crear partida" genera un código de 5 caracteres (y un
enlace `?room=CÓDIGO`) y deja al creador esperando. "Unirme con código"
comprueba el código, muestra quién ha creado la partida y a cuántas cifras,
y al enviar el número secreto empareja inmediatamente con esa sala concreta
(sin pasar por la cola aleatoria).

Para probarlo tú solo puedes abrir **dos pestañas** del navegador con la
misma URL y completar el flujo (perfil + Buscar Rival, o Crear partida +
Unirme con código) en cada una.

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
- El emparejamiento de "Buscar Rival" agrupa a los jugadores por dificultad
  elegida (3/4/5 cifras): solo se empareja a quienes buscan partida con el
  mismo número de cifras.
- Los códigos de sala de "Jugar con Amigos" viven en memoria del servidor:
  si recargas la página mientras esperas a que se una un amigo, el código se
  pierde y hay que crear uno nuevo (no aplica una vez la partida ha
  empezado, ahí sí funciona la reconexión normal).
- Las estadísticas, preferencias y la reconexión se guardan en el navegador
  (localStorage/sessionStorage) de cada jugador, no en una cuenta: si cambias
  de navegador o dispositivo, empiezan de cero. Si abres dos pestañas del
  juego en el mismo navegador para probarlo tú solo, las estadísticas
  globales de "victorias/derrotas" se mezclarán entre ambas pestañas (es solo
  un efecto de probarlo así; entre dos personas en dispositivos distintos no
  ocurre).
