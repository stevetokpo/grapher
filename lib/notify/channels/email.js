// Canal e-mail — SMTP via nodemailer.
import nodemailer from 'nodemailer';
import { formatSignal } from '../format';

// Transporteur réutilisé entre les requêtes (pool SMTP), et attaché au global
// pour survivre au hot-reload de Next en dev — même motif que lib/db.js.
function getTransport() {
  const key = process.env.NODE_ENV !== 'production' ? '__notify_smtp' : null;
  if (key && global[key]) return global[key];

  const t = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    // secure=true ⇒ TLS implicite (port 465). Sinon STARTTLS sur 587/25.
    secure: process.env.SMTP_SECURE === 'true',
    auth:   process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    pool: true,
  });

  if (key) global[key] = t;
  return t;
}

export default {
  id:    'email',
  label: 'E-mail',
  desc:  'Envoi SMTP (nodemailer) vers NOTIFY_EMAIL_TO',
  envKeys: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'NOTIFY_EMAIL_FROM', 'NOTIFY_EMAIL_TO'],

  ready() {
    return Boolean(process.env.SMTP_HOST && process.env.NOTIFY_EMAIL_FROM && process.env.NOTIFY_EMAIL_TO);
  },

  async send(signal) {
    const { title, lines, text } = formatSignal(signal);
    const html = `<div style="font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif">
  <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>
  <table style="border-collapse:collapse">
    ${lines.map(l => {
      const [k, ...rest] = l.split(' : ');
      return `<tr>
        <td style="padding:2px 12px 2px 0;color:#64748b">${escapeHtml(k)}</td>
        <td style="padding:2px 0;font-weight:600">${escapeHtml(rest.join(' : '))}</td>
      </tr>`;
    }).join('')}
  </table>
</div>`;

    await getTransport().sendMail({
      from:    process.env.NOTIFY_EMAIL_FROM,
      to:      process.env.NOTIFY_EMAIL_TO,
      subject: title,
      text,
      html,
    });
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
