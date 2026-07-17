import duckdb from 'duckdb';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'grapher.duckdb');

// Schema is idempotent — safe to run on every cold start
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS symbols (
  id         INTEGER PRIMARY KEY,
  name       VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT current_timestamp
);

CREATE SEQUENCE IF NOT EXISTS seq_symbols START 1;

-- Source of truth: raw M1 bars
-- Higher timeframes are derived on the fly via time_bucket aggregation
CREATE TABLE IF NOT EXISTS bars_m1 (
  symbol_id INTEGER   NOT NULL,
  ts        TIMESTAMP NOT NULL,
  open      DOUBLE    NOT NULL,
  high      DOUBLE    NOT NULL,
  low       DOUBLE    NOT NULL,
  close     DOUBLE    NOT NULL,
  tick_vol  INTEGER   NOT NULL DEFAULT 0,
  real_vol  DOUBLE    NOT NULL DEFAULT 0,
  spread    INTEGER   NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol_id, ts)
);

-- Raw tick data for footprint / order-flow analysis.
-- MT5 FLAGS: bit1=BID update, bit2=ASK update, bit3=LAST trade, bit4=VOLUME.
-- bid/ask are NULL for LAST-only ticks (bit3 set, no quote update).
-- last_price and volume are NULL for quote-only ticks (FLAGS=6 on synthetic instruments).
CREATE TABLE IF NOT EXISTS ticks (
  symbol_id  INTEGER   NOT NULL,
  ts         TIMESTAMP NOT NULL,
  bid        DOUBLE,
  ask        DOUBLE,
  last_price DOUBLE,
  volume     DOUBLE,
  flags      INTEGER   NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol_id, ts)
);

-- Alertes : une stratégie du registre lib/backtest/strategies évaluée en live
-- à la clôture de chaque bougie TF (voir lib/notify/evaluate.js).
CREATE TABLE IF NOT EXISTS alerts (
  id            INTEGER PRIMARY KEY,
  name          VARCHAR   NOT NULL,
  symbol_id     INTEGER   NOT NULL,
  tf            VARCHAR   NOT NULL,
  strategy_id   VARCHAR   NOT NULL,
  params        VARCHAR   NOT NULL DEFAULT '{}',  -- JSON du schéma de la stratégie
  channels      VARCHAR   NOT NULL DEFAULT '[]',  -- JSON : ids de lib/notify/channels
  enabled       BOOLEAN   NOT NULL DEFAULT true,
  cooldown_sec  INTEGER   NOT NULL DEFAULT 0,
  dedup_signal  BOOLEAN   NOT NULL DEFAULT true,  -- ne notifier qu'au CHANGEMENT de signal
  -- État d'évaluation (voir evaluate.js) :
  -- last_bucket = bougie TF en cours lors de la dernière évaluation. Un bucket
  -- plus récent ⇒ la bougie précédente vient de clôturer ⇒ on évalue.
  -- NULL = jamais évalué : la première passe ne fait qu'enregistrer le bucket,
  -- elle ne déclenche pas (sinon toute alerte créée tirerait sur l'historique).
  last_bucket   BIGINT,
  last_signal   VARCHAR,                          -- 'buy' | 'sell' | NULL
  last_fired_ts BIGINT,
  created_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE SEQUENCE IF NOT EXISTS seq_alerts START 1;

-- Journal des notifications. La PK (alert_id, candle_ts) EST le verrou de
-- déduplication : l'EA renvoie des plages qui se recouvrent, la même bougie
-- peut donc être évaluée plusieurs fois. L'INSERT échoue au 2e passage.
CREATE TABLE IF NOT EXISTS notif_log (
  alert_id  INTEGER   NOT NULL,
  candle_ts BIGINT    NOT NULL,
  ts        TIMESTAMP NOT NULL DEFAULT current_timestamp,
  signal    VARCHAR,
  payload   VARCHAR,                              -- JSON du signal notifié
  results   VARCHAR,                              -- JSON : [{ channel, ok, error }]
  PRIMARY KEY (alert_id, candle_ts)
);

-- Réception par canal : coupe un canal pour TOUTES les alertes d'un coup, sans
-- avoir à les éditer une par une. Distinct de la config : un canal peut être
-- correctement configuré (ready) et volontairement muet (enabled = false).
-- Absence de ligne = canal actif (c'est le défaut, on n'écrit qu'en cas de coupure).
CREATE TABLE IF NOT EXISTS channel_prefs (
  channel_id VARCHAR PRIMARY KEY,
  enabled    BOOLEAN   NOT NULL DEFAULT true,
  updated_at TIMESTAMP DEFAULT current_timestamp
);

-- Abonnements Web Push (un par navigateur/profil). endpoint = identifiant unique.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   VARCHAR PRIMARY KEY,
  p256dh     VARCHAR NOT NULL,
  auth       VARCHAR NOT NULL,
  label      VARCHAR,
  created_at TIMESTAMP DEFAULT current_timestamp
);
`;

let _db, _conn, _ready;

// Survive Next.js hot-reload in dev by attaching to global
function getInstance() {
  if (!_db) {
    const key = process.env.NODE_ENV !== 'production' ? '__duckdb_inst' : null;
    if (key && global[key]) {
      ({ db: _db, conn: _conn } = global[key]);
    } else {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      _db = new duckdb.Database(DB_FILE);
      _conn = _db.connect();
      if (key) global[key] = { db: _db, conn: _conn };
    }
  }
  return _conn;
}

// Drop NOT NULL on bid/ask for existing databases (LAST-only ticks have no quote update).
// Safe to run repeatedly — DuckDB ignores DROP NOT NULL when the column is already nullable.
const MIGRATION_SQL = `
ALTER TABLE ticks ALTER bid DROP NOT NULL;
ALTER TABLE ticks ALTER ask DROP NOT NULL;
`;

function getReadyPromise() {
  const key = process.env.NODE_ENV !== 'production' ? '__duckdb_ready' : null;
  if (key && global[key]) return ((_ready = global[key]), _ready);
  if (!_ready) {
    const conn = getInstance();
    _ready = new Promise((resolve, reject) => {
      conn.exec(SCHEMA_SQL, (err) => {
        if (err) return reject(err);
        conn.exec(MIGRATION_SQL, (merr) => (merr ? reject(merr) : resolve()));
      });
    });
    if (key) global[key] = _ready;
  }
  return _ready;
}

// Execute multiple SQL statements (no params, no return rows)
export async function exec(sql) {
  await getReadyPromise();
  const conn = getInstance();
  return new Promise((resolve, reject) => {
    conn.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

// Execute a single statement (no return rows); supports ? params
export async function run(sql, ...params) {
  await getReadyPromise();
  const conn = getInstance();
  return new Promise((resolve, reject) => {
    conn.run(sql, ...params, (err) => (err ? reject(err) : resolve()));
  });
}

// Execute a SELECT; returns array of row objects
export async function query(sql, ...params) {
  await getReadyPromise();
  const conn = getInstance();
  return new Promise((resolve, reject) => {
    conn.all(sql, ...params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])));
  });
}
