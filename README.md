# NEO VICE

Sandbox open-world top-down in stile GTA, costruito con **Next.js (App Router) + TypeScript + Canvas 2D**.
Nessun asset esterno: città, veicoli, personaggi e audio sono generati a runtime.

## Avvio

```bash
npm install
npm run dev
# http://localhost:3000
```

Altri script: `npm run build`, `npm start`, `npm run typecheck`.

## Cosa c'è nel gioco

- **Città procedurale** da seed deterministico (13×13 blocchi): strade con corsie e strisce, marciapiedi,
  parchi, piazze, palazzi con estrusione pseudo-3D e finestre illuminate di notte.
- **Guida arcade** con modello forward/lateral: grip, sottosterzo, freno a mano per il drift, danni da
  impatto, incendio ed esplosione con onda d'urto.
- **8 tipi di veicolo** (berlina, sportiva, SUV, pickup, taxi, polizia, ambulanza, autobus) con
  statistiche proprie, traffico AI che segue il grafo stradale e frena per evitare tamponamenti.
- **A piedi**: cammina/corri, mira col mouse, pugni + pistola, mitraglietta e fucile a pompa.
- **Passanti** che vagano, si spaventano al primo sparo, scappano e possono essere investiti.
- **Polizia**: livello di sospetto a 5 stelle, volanti che inseguono, agenti che scendono a piedi e
  sparano; il sospetto decade se resti tranquillo.
- **8 missioni** a catena (consegna, furto d'auto, eliminazioni, inseguimento, rampage) con timer,
  waypoint e ricompense.
- **Pickup** di vita, giubbotto, munizioni e contanti sparsi, con respawn.
- **Ciclo giorno/notte**, minimappa circolare + mappa a schermo intero (Tab), HUD React, salvataggio
  su `localStorage`.

## Comandi

| Tasto | Azione |
| --- | --- |
| `W A S D` | camminare / guidare |
| `Shift` | corsa |
| Mouse / Click sx | mira / spara |
| `F` | entra o esci dal veicolo |
| `Spazio` | freno a mano |
| `1‑4`, rotella | cambio arma |
| `E` | accetta la missione sul marker `$` |
| `Tab` / `M` | mappa |
| `H` | clacson |
| `P` | audio on/off |
| `Esc` | pausa |

## Struttura

```
app/                 layout, pagina, stile globale
components/
  GameShell.tsx      client component: canvas, menu, ciclo di vita del gioco
  Hud.tsx            HUD React (barre, stelle, missione, messaggi)
lib/game/
  config.ts          costanti di tuning, veicoli, armi, palette
  math.ts            vettori, PRNG deterministico, collisioni cerchio/rect, spatial grid
  city.ts            generazione città, grafo stradale, texture della mappa
  types.ts           tipi di entità e stato
  state.ts           GameState + helper (heat, messaggi, particelle)
  input.ts           tastiera/mouse con eventi edge-triggered
  audio.ts           synth WebAudio (spari, motore, sirena, esplosioni)
  vehicle.ts         fisica arcade, collisioni, steering AI
  peds.ts            pedoni: stati wander/flee/attack
  missions.ts        definizioni e macchina a stati delle missioni
  render.ts          rendering mondo, entità, minimappa, mappa
  engine.ts          game loop a passo fisso, streaming, polizia, danni, HUD
```

Il loop gira a passo fisso (1/60 s) con accumulatore, quindi la fisica è indipendente dal frame rate.
Entità e traffico sono in streaming attorno al giocatore (spawn ~700‑1900 px, despawn a 2700 px).

## Note

- Il salvataggio contiene solo denaro e missioni completate (chiave `neo-vice.save.v1`).
- La palette e il tuning stanno tutti in `lib/game/config.ts`: velocità, grip, danni, densità di
  traffico e pedoni sono modificabili da lì.
- Progetto didattico/homage: nessun asset o marchio di terzi è incluso.
