'use client';

import { useEffect, useRef, useState } from 'react';
import { Game } from '@/lib/game/engine';
import type { HudState } from '@/lib/game/types';
import Hud from './Hud';

const CONTROLS: { keys: string[]; label: string }[] = [
  { keys: ['W', 'A', 'S', 'D'], label: 'camminare / guidare' },
  { keys: ['Shift'], label: 'corsa' },
  { keys: ['Mouse'], label: 'mira' },
  { keys: ['Click sx'], label: 'spara / colpisci' },
  { keys: ['F'], label: 'entra / esci dal veicolo' },
  { keys: ['Spazio'], label: 'freno a mano (drift)' },
  { keys: ['1', '2', '3', '4'], label: 'armi (o rotella)' },
  { keys: ['E'], label: 'accetta missione sul marker $' },
  { keys: ['Tab'], label: 'mappa' },
  { keys: ['H'], label: 'clacson' },
  { keys: ['P'], label: 'audio on/off' },
  { keys: ['Esc'], label: 'pausa' },
];

export default function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [seed, setSeed] = useState(20260819);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new Game(canvas, { seed, onHud: setHud });
    gameRef.current = game;
    game.audio.resume();
    game.start();

    // Debug handle: useful from the devtools console (window.__neoVice.state).
    (window as unknown as { __neoVice?: Game }).__neoVice = game;

    const onResize = () => game.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      game.dispose();
      gameRef.current = null;
      delete (window as unknown as { __neoVice?: Game }).__neoVice;
    };
  }, [started, seed]);

  const paused = started && hud?.paused === true;

  return (
    <div className="shell">
      <canvas ref={canvasRef} className="canvas" />

      {started && hud && <Hud hud={hud} />}

      {!started && (
        <div className="menu">
          <div className="menu-card">
            <h1 className="title">NEO VICE</h1>
            <p className="subtitle">Open world top-down · Next.js + Canvas 2D</p>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#c8d0d9', marginTop: 0 }}>
              Città procedurale, traffico e passanti, furti d’auto, sparatorie, otto missioni e polizia con
              livello di sospetto a cinque stelle. Trova un marker <b style={{ color: '#ffd24a' }}>$</b> per
              iniziare a lavorare.
            </p>
            <ul className="controls">
              {CONTROLS.map((c) => (
                <li key={c.label}>
                  {c.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                  {c.label}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn" onClick={() => setStarted(true)}>
                ENTRA IN CITTÀ
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setSeed(Math.floor(Math.random() * 1_000_000) + 1);
                  setStarted(true);
                }}
              >
                CITTÀ CASUALE
              </button>
            </div>
            <p className="progress">Seed attuale: {seed} · i progressi si salvano nel browser</p>
          </div>
        </div>
      )}

      {paused && (
        <div className="menu">
          <div className="menu-card">
            <h1 className="title" style={{ fontSize: 34 }}>
              PAUSA
            </h1>
            <p className="subtitle">
              Missioni completate: {hud?.missionsDone ?? 0}/{hud?.missionsTotal ?? 0} · ${hud?.money ?? 0}
            </p>
            <ul className="controls">
              {CONTROLS.map((c) => (
                <li key={c.label}>
                  {c.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                  {c.label}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn" onClick={() => gameRef.current?.setPaused(false)}>
                RIPRENDI
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  gameRef.current?.audio.setMuted(!gameRef.current.audio.muted);
                }}
              >
                AUDIO ON/OFF
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  gameRef.current?.save();
                  gameRef.current?.setPaused(false);
                }}
              >
                SALVA
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  gameRef.current?.resetSave();
                  setStarted(false);
                  setHud(null);
                }}
              >
                AZZERA PROGRESSI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
