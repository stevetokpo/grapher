import fs from 'fs';
import readline from 'readline';
import formidable from 'formidable';
import { query, exec } from '../../lib/db';
import { getOrCreateSymbol } from '../../lib/ingest';
import { parseFilename, detectCsvType } from '../../lib/parsers';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

function readFirstLine(filepath) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(filepath), crlfDelay: Infinity });
    rl.once('line', (line) => { rl.close(); resolve(line); });
    rl.once('error', reject);
  });
}

function safePath(p) {
  return p.replace(/'/g, "''");
}

// ── Tick streaming helpers ────────────────────────────────────────────────────

const TICK_BATCH = 5_000;

function sqlDouble(s) {
  if (!s || s === '') return 'NULL';
  const n = Number(s);
  return Number.isFinite(n) ? n : 'NULL';
}

function sqlInt(s, fallback = 0) {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? fallback : n;
}

async function flushBatch(rows, symbolId) {
  const values = rows.map(({ date, time, bid, ask, last_price, volume, flags }) => {
    // Sanitize date/time to safe characters only before embedding in SQL
    const d = date.replace(/[^0-9.]/g, '').replace(/\./g, '-');
    const t = time.replace(/[^0-9:.]/g, '');
    return `(${symbolId},'${d} ${t}'::TIMESTAMP,${sqlDouble(bid)},${sqlDouble(ask)},${sqlDouble(last_price)},${sqlDouble(volume)},${sqlInt(flags)})`;
  }).join(',');

  await exec(
    `INSERT OR IGNORE INTO ticks (symbol_id,ts,bid,ask,last_price,volume,flags) VALUES ${values}`
  );
}

// Streams the CSV line-by-line, inserting in batches of TICK_BATCH rows.
// Returns the total number of data rows read from the file.
async function importTicksStream(filepath, symbolId) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filepath),
    crlfDelay: Infinity,
  });

  let colMap = null;
  let batch = [];
  let fileRows = 0;

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split('\t');

    // First non-empty line is the header
    if (!colMap) {
      colMap = {};
      cols.forEach((h, i) => {
        colMap[h.trim().replace(/[<>]/g, '').toLowerCase()] = i;
      });
      continue;
    }

    fileRows++;
    const get = (k) => cols[colMap[k] ?? -1]?.trim() ?? '';
    const date = get('date');
    const time = get('time');
    if (!date || !time) continue; // skip malformed rows

    batch.push({
      date,
      time,
      bid:        get('bid'),
      ask:        get('ask'),
      last_price: get('last_price'),
      volume:     get('volume'),
      flags:      get('flags'),
    });

    if (batch.length >= TICK_BATCH) {
      await flushBatch(batch, symbolId);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await flushBatch(batch, symbolId);
  }

  return fileRows;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = formidable({
    uploadDir: '/tmp',
    keepExtensions: true,
    maxFileSize: 2_000 * 1024 * 1024, // 2 GB
  });

  let filepath, originalFilename;
  try {
    const [, files] = await form.parse(req);
    const uploaded = files.file?.[0] ?? Object.values(files)[0]?.[0];
    if (!uploaded) throw new Error('No file found in request');
    filepath = uploaded.filepath;
    originalFilename = uploaded.originalFilename ?? 'unknown.csv';
  } catch (err) {
    return res.status(400).json({ error: 'Upload failed: ' + err.message });
  }

  try {
    const meta = parseFilename(originalFilename);
    if (!meta) {
      return res.status(400).json({ error: 'Cannot parse MT5 filename: ' + originalFilename });
    }

    const headerLine = await readFirstLine(filepath);
    const csvType = detectCsvType(headerLine);

    if (meta.type !== csvType) {
      return res.status(400).json({
        error: `Filename indicates ${meta.type} but CSV header looks like ${csvType}`,
      });
    }

    const symbolId = await getOrCreateSymbol(meta.symbol);
    const p = safePath(filepath);

    // ── Bars (single read_csv pass — bar files are small) ─────────────────────
    if (meta.type === 'bars') {
      const [{ cnt: before }] = await query(
        'SELECT count(*)::BIGINT AS cnt FROM bars_m1 WHERE symbol_id = ?',
        symbolId,
      );

      await exec(`
        INSERT OR IGNORE INTO bars_m1 (symbol_id, ts, open, high, low, close, tick_vol, real_vol, spread)
        SELECT
          ${symbolId},
          strptime(date || ' ' || time, '%Y.%m.%d %H:%M:%S')::TIMESTAMP,
          open::DOUBLE, high::DOUBLE, low::DOUBLE, close::DOUBLE,
          tick_vol::INTEGER, real_vol::DOUBLE, spread::INTEGER
        FROM read_csv(
          '${p}',
          delim  = '\t',
          header = true,
          names  = ['date','time','open','high','low','close','tick_vol','real_vol','spread'],
          types  = {
            'date':'VARCHAR','time':'VARCHAR',
            'open':'DOUBLE','high':'DOUBLE','low':'DOUBLE','close':'DOUBLE',
            'tick_vol':'INTEGER','real_vol':'DOUBLE','spread':'INTEGER'
          }
        )
      `);

      const [{ cnt: after }] = await query(
        'SELECT count(*)::BIGINT AS cnt FROM bars_m1 WHERE symbol_id = ?',
        symbolId,
      );
      const imported = Number(after) - Number(before);

      return res.json({
        ok:        true,
        dataType:  'bars',
        symbol:    meta.symbol,
        symbolId,
        timeframe: meta.timeframe,
        imported,
        total:     Number(after),
        range:     { from: meta.from, to: meta.to },
      });
    }

    // ── Ticks (streaming batch insert — handles arbitrarily large files) ───────
    const [{ cnt: before }] = await query(
      'SELECT count(*)::BIGINT AS cnt FROM ticks WHERE symbol_id = ?',
      symbolId,
    );

    const fileRows = await importTicksStream(filepath, symbolId);

    const [{ cnt: after }] = await query(
      'SELECT count(*)::BIGINT AS cnt FROM ticks WHERE symbol_id = ?',
      symbolId,
    );
    const imported = Number(after) - Number(before);

    return res.json({
      ok:         true,
      dataType:   'ticks',
      symbol:     meta.symbol,
      symbolId,
      imported,
      duplicates: fileRows - imported,
      total:      Number(after),
      range:      { from: meta.from, to: meta.to },
    });

  } catch (err) {
    console.error('[import]', err);
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(filepath); } catch {}
  }
}
