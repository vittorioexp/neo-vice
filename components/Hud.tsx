'use client';

import type { HudState } from '@/lib/game/types';

export default function Hud({ hud }: { hud: HudState }) {
  const stars = Array.from({ length: 5 }, (_, i) => (i < hud.wanted ? '★' : '☆'));

  return (
    <div className="overlay">
      <div className="hud-top-left">
        <div className="bar health" title="Salute">
          <span style={{ width: `${hud.health}%` }} />
        </div>
        {hud.armor > 0 && (
          <div className="bar armor" title="Giubbotto">
            <span style={{ width: `${hud.armor}%` }} />
          </div>
        )}
        {hud.vehicleName && (
          <div className="bar car" title="Condizioni veicolo">
            <span style={{ width: `${Math.round(hud.vehicleHealth * 100)}%` }} />
          </div>
        )}
      </div>

      <div className="hud-top-right">
        <div className="money">${hud.money.toLocaleString('it-IT')}</div>
        <div className="stars">
          {stars.map((s, i) =>
            s === '★' ? <b key={i}>{s}</b> : <span key={i}>{s}</span>,
          )}
        </div>
        <div className="clock">
          {hud.clock} · {hud.district}
        </div>
      </div>

      <div className="weapon">
        <strong>{hud.weapon}</strong>
        {hud.melee ? 'corpo a corpo' : `${hud.ammo} colpi`}
      </div>

      {hud.mission && (
        <div className="mission">
          <h3>{hud.mission.title}</h3>
          {hud.mission.objective && <p>{hud.mission.objective}</p>}
          {hud.mission.timer > 0 && (
            <div className={`timer${hud.mission.timer <= 15 ? ' urgent' : ''}`}>
              {String(Math.floor(hud.mission.timer / 60)).padStart(2, '0')}:
              {String(hud.mission.timer % 60).padStart(2, '0')}
            </div>
          )}
        </div>
      )}

      {hud.vehicleName && (
        <div className="speedo">
          <div className="carname">{hud.vehicleName}</div>
          <div className="kmh">{hud.speedKmh}</div>
          <div className="unit">KM/H</div>
        </div>
      )}

      <div className="messages">
        {hud.messages.map((m, i) => (
          <div key={`${i}-${m.text}`} className={m.tone} style={{ opacity: Math.min(1, m.life) }}>
            {m.text}
          </div>
        ))}
      </div>

      {hud.hintNearby && <div className="hint">{hud.hintNearby}</div>}

      {hud.dead && (
        <div className="big-center">
          <h2>ELIMINATO</h2>
        </div>
      )}
    </div>
  );
}
