import { useState, useEffect, useCallback } from 'react';
import { TF_SECONDS } from '../lib/replayUtils';
import { pushSupported, currentSubscription, subscribePush, unsubscribePush } from '../lib/notifyClient';
import { fmtBrokerTime } from '../lib/notify/format';
import styles from './AlertsPanel.module.css';

const TF_IDS = Object.keys(TF_SECONDS);

// Rend un champ du schéma de params d'une stratégie (même contrat que BacktestConfig).
function ParamField({ schema, value, onChange }) {
  switch (schema.type) {
    case 'select':
      return (
        <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
          {schema.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'bool':
      return (
        <button
          className={`${styles.toggle}${value ? ` ${styles.toggleOn}` : ''}`}
          onClick={() => onChange(!value)}
        >
          {value ? 'Activé' : 'Désactivé'}
        </button>
      );
    default: {
      const step = schema.step ?? 1;
      return (
        <input
          type="number"
          className={styles.num}
          value={value}
          min={schema.min} max={schema.max} step={step}
          onChange={e => {
            const n = step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            if (!isNaN(n)) onChange(n);
          }}
        />
      );
    }
  }
}

const defaultsOf = strategy =>
  Object.fromEntries((strategy?.params ?? []).map(p => [p.key, p.def]));

export default function AlertsPanel({ symbols = [], symbolId, onClose }) {
  const [strategies, setStrategies] = useState([]);
  const [channels,   setChannels]   = useState([]);
  const [meta,       setMeta]       = useState({ vapidPublicKey: null, enabled: true, lastHour: 0, maxPerHour: 30 });
  const [alerts,     setAlerts]     = useState([]);
  const [log,        setLog]        = useState([]);
  const [pushSub,    setPushSub]    = useState(null);
  const [busy,       setBusy]       = useState(false);
  const [msg,        setMsg]        = useState(null);

  // Brouillon du formulaire (création ou édition)
  const [draft, setDraft] = useState(null);

  const refresh = useCallback(async () => {
    const [a, l] = await Promise.all([
      fetch('/api/notify/alerts').then(r => r.json()),
      fetch('/api/notify/log?limit=15').then(r => r.json()),
    ]);
    setAlerts(Array.isArray(a) ? a : []);
    setLog(Array.isArray(l) ? l : []);
  }, []);

  useEffect(() => {
    (async () => {
      const [s, c] = await Promise.all([
        fetch('/api/backtest').then(r => r.json()),          // schémas des stratégies
        fetch('/api/notify/channels').then(r => r.json()),
      ]);
      setStrategies(Array.isArray(s) ? s : []);
      setChannels(c.channels ?? []);
      setMeta(c);
      await refresh();
      if (pushSupported()) setPushSub(await currentSubscription());
    })().catch(e => setMsg({ err: e.message }));
  }, [refresh]);

  const newDraft = () => {
    const strategy = strategies[0];
    if (!strategy) return;
    setDraft({
      id:          null,
      name:        '',
      symbolId:    symbolId ?? symbols[0]?.id,
      tf:          '1h',
      strategyId:  strategy.id,
      params:      defaultsOf(strategy),
      channels:    channels.filter(c => c.ready).map(c => c.id),
      cooldownSec: 0,
      dedupSignal: true,
      enabled:     true,
    });
  };

  const editDraft = a => setDraft({ ...a });

  const pickStrategy = id => {
    const s = strategies.find(x => x.id === id);
    setDraft(d => ({ ...d, strategyId: id, params: defaultsOf(s) }));
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(
      draft.id ? `/api/notify/alerts/${draft.id}` : '/api/notify/alerts',
      { method: draft.id ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft) },
    );
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ err: body.error ?? 'échec de l’enregistrement' });
    setDraft(null);
    await refresh();
  };

  const toggle = async (a) => {
    await fetch(`/api/notify/alerts/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    await refresh();
  };

  const remove = async (a) => {
    await fetch(`/api/notify/alerts/${a.id}`, { method: 'DELETE' });
    await refresh();
  };

  // Rejoue la stratégie sur la dernière bougie CLOSE, sans envoyer ni journaliser.
  const preview = async (a) => {
    setBusy(true); setMsg(null);
    const res  = await fetch(`/api/notify/alerts/${a.id}`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ err: body.error ?? 'échec' });
    setMsg({ ok: body.signal
      ? `Dernière bougie close (${fmtBrokerTime(body.candleTs)}) : signal ${body.signal.toUpperCase()} (${body.action}).`
      : `Dernière bougie close (${fmtBrokerTime(body.candleTs)}) : aucun signal. ${body.tfBarCount} bougies ${a.tf} analysées.` });
  };

  // Coupe / rétablit la réception d'un canal, pour toutes les alertes à la fois.
  const toggleChannel = async (c) => {
    setBusy(true); setMsg(null);
    const res  = await fetch('/api/notify/channels', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: c.id, enabled: !c.enabled }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ err: body.error ?? 'échec' });
    setChannels(body.channels);
    setMeta(body);
  };

  const testChannels = async () => {
    const ready = channels.filter(c => c.ready && c.enabled).map(c => c.id);
    if (ready.length === 0) return setMsg({ err: 'aucun canal configuré et actif' });
    setBusy(true); setMsg(null);
    const res  = await fetch('/api/notify/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channels: ready }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    const fails = (body.results ?? []).filter(r => !r.ok);
    setMsg(fails.length === 0
      ? { ok: `Test envoyé sur : ${ready.join(', ')}` }
      : { err: fails.map(f => `${f.channel} : ${f.error}`).join(' · ') });
  };

  const togglePush = async () => {
    setBusy(true); setMsg(null);
    const r = pushSub ? await unsubscribePush() : await subscribePush(meta.vapidPublicKey);
    setBusy(false);
    if (r.error) return setMsg({ err: r.error });
    setPushSub(await currentSubscription());
    setMsg({ ok: pushSub ? 'Navigateur désabonné.' : 'Navigateur abonné au push.' });
  };

  const strategy = strategies.find(s => s.id === draft?.strategyId);

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog" aria-modal="true" aria-labelledby="alerts-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        <h2 id="alerts-title" className={styles.title}>Alertes</h2>

        {!meta.enabled && (
          <p className={styles.warn}>
            NOTIFY_ENABLED=false — le coupe-circuit global est actif, rien ne partira.
          </p>
        )}

        {/* ── Canaux ─────────────────────────────────────────── */}
        <section className={styles.section}>
          <h3 className={styles.h3}>Canaux</h3>
          <div className={styles.chanList}>
            {channels.map(c => {
              const live = c.ready && c.enabled;
              return (
                <div key={c.id} className={`${styles.chan}${c.ready && !c.enabled ? ` ${styles.chanMuted}` : ''}`}>
                  <span className={`${styles.dot} ${live ? styles.dotOk : styles.dotOff}`} />
                  <div className={styles.chanBody}>
                    <span className={styles.chanLabel}>{c.label}</span>
                    <span className={styles.chanDesc}>
                      {!c.ready   ? `manque : ${c.missing.join(', ')}`
                       : !c.enabled ? 'réception coupée'
                       : c.desc}
                    </span>
                  </div>
                  {c.id === 'push' && live && pushSupported() && (
                    <button className={styles.mini} onClick={togglePush} disabled={busy}>
                      {pushSub ? 'Désabonner' : 'Abonner ce navigateur'}
                    </button>
                  )}
                  {/* Interrupteur de réception : n'a de sens que si le canal est configuré. */}
                  <button
                    className={`${styles.switch}${c.enabled ? ` ${styles.switchOn}` : ''}`}
                    onClick={() => toggleChannel(c)}
                    disabled={busy || !c.ready}
                    title={c.enabled ? 'Couper la réception sur ce canal' : 'Rétablir la réception'}
                    aria-label={`${c.label} : ${c.enabled ? 'couper' : 'rétablir'} la réception`}
                    aria-pressed={c.enabled}
                  />
                </div>
              );
            })}
          </div>
          <div className={styles.chanFoot}>
            <button className={styles.mini} onClick={testChannels} disabled={busy}>
              Envoyer une notif de test
            </button>
            <span className={styles.quota}>{meta.lastHour}/{meta.maxPerHour} sur l’heure</span>
          </div>
        </section>

        {msg && <p className={msg.err ? styles.err : styles.ok}>{msg.err ?? msg.ok}</p>}

        {/* ── Alertes ────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.h3}>Mes alertes</h3>
            {!draft && (
              <button className={styles.mini} onClick={newDraft} disabled={!strategies.length}>
                + Nouvelle
              </button>
            )}
          </div>

          {alerts.length === 0 && !draft && (
            <p className={styles.empty}>Aucune alerte. Une alerte évalue une stratégie à la clôture de chaque bougie du timeframe choisi.</p>
          )}

          {alerts.map(a => (
            <div key={a.id} className={styles.alert}>
              <button
                className={`${styles.switch}${a.enabled ? ` ${styles.switchOn}` : ''}`}
                onClick={() => toggle(a)}
                aria-label={a.enabled ? 'Désarmer' : 'Armer'}
              />
              <div className={styles.alertBody}>
                <span className={styles.alertName}>{a.name}</span>
                <span className={styles.alertMeta}>
                  {a.symbol} · {a.tf} · {a.channels.join(', ')}
                  {a.lastSignal && ` · dernier : ${a.lastSignal}`}
                </span>
              </div>
              <button className={styles.mini} onClick={() => preview(a)} disabled={busy}>Tester</button>
              <button className={styles.mini} onClick={() => editDraft(a)}>Éditer</button>
              <button className={styles.miniDanger} onClick={() => remove(a)}>×</button>
            </div>
          ))}

          {/* ── Formulaire ───────────────────────────────────── */}
          {draft && (
            <div className={styles.form}>
              <div className={styles.row}>
                <label className={styles.label}>Nom</label>
                <input
                  className={styles.text}
                  value={draft.name}
                  placeholder={strategy ? `${strategy.label} ${draft.tf}` : ''}
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                />
              </div>

              <div className={styles.row}>
                <label className={styles.label}>Symbole</label>
                <select
                  className={styles.select}
                  value={draft.symbolId ?? ''}
                  onChange={e => setDraft({ ...draft, symbolId: Number(e.target.value) })}
                >
                  {symbols.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div className={styles.row}>
                <label className={styles.label}>Timeframe</label>
                <select
                  className={styles.select}
                  value={draft.tf}
                  onChange={e => setDraft({ ...draft, tf: e.target.value })}
                >
                  {TF_IDS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className={styles.row}>
                <label className={styles.label}>Stratégie</label>
                <select
                  className={styles.select}
                  value={draft.strategyId}
                  onChange={e => pickStrategy(e.target.value)}
                >
                  {strategies.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              {strategy && (
                <details className={styles.params}>
                  <summary className={styles.summary}>Paramètres ({strategy.params.length})</summary>
                  {strategy.params.map(p => (
                    <div key={p.key} className={styles.row}>
                      <label className={styles.label} title={p.hint}>{p.label}</label>
                      <ParamField
                        schema={p}
                        value={draft.params[p.key] ?? p.def}
                        onChange={v => setDraft({ ...draft, params: { ...draft.params, [p.key]: v } })}
                      />
                    </div>
                  ))}
                </details>
              )}

              <div className={styles.row}>
                <label className={styles.label}>Canaux</label>
                <div className={styles.chips}>
                  {channels.map(c => {
                    const on = draft.channels.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        className={`${styles.chip}${on ? ` ${styles.chipOn}` : ''}`}
                        disabled={!c.ready}
                        title={!c.ready   ? `manque : ${c.missing.join(', ')}`
                             : !c.enabled ? 'réception coupée — l’alerte restera évaluée, mais rien ne partira sur ce canal'
                             : c.desc}
                        onClick={() => setDraft({
                          ...draft,
                          channels: on ? draft.channels.filter(x => x !== c.id) : [...draft.channels, c.id],
                        })}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.row}>
                <label className={styles.label} title="Ne notifier qu'au changement de sens du signal">
                  Anti-répétition
                </label>
                <button
                  className={`${styles.toggle}${draft.dedupSignal ? ` ${styles.toggleOn}` : ''}`}
                  onClick={() => setDraft({ ...draft, dedupSignal: !draft.dedupSignal })}
                >
                  {draft.dedupSignal ? 'Au changement de signal' : 'À chaque signal'}
                </button>
              </div>

              <div className={styles.row}>
                <label className={styles.label}>Cooldown (s)</label>
                <input
                  type="number" className={styles.num} min={0} max={86400} step={60}
                  value={draft.cooldownSec}
                  onChange={e => setDraft({ ...draft, cooldownSec: parseInt(e.target.value, 10) || 0 })}
                />
              </div>

              <div className={styles.formFoot}>
                <button className={styles.ghost} onClick={() => setDraft(null)}>Annuler</button>
                <button className={styles.primary} onClick={save} disabled={busy || !draft.symbolId}>
                  {draft.id ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Journal ────────────────────────────────────────── */}
        {log.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.h3}>Dernières notifications</h3>
            {log.map(n => (
              <div key={`${n.alertId}-${n.candleTs}`} className={styles.logRow}>
                <span className={n.signal === 'buy' ? styles.buy : styles.sell}>
                  {n.signal === 'buy' ? '▲' : '▼'}
                </span>
                <span className={styles.logName}>{n.name ?? `#${n.alertId}`}</span>
                <span className={styles.logTime}>{fmtBrokerTime(n.candleTs)}</span>
                <span className={styles.logChans}>
                  {n.results.map(r => (
                    <span
                      key={r.channel}
                      className={r.ok ? styles.chanOk : r.muted ? styles.chanOff : styles.chanKo}
                      title={r.muted ? 'réception coupée' : r.error ?? 'envoyé'}
                    >
                      {r.channel}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
