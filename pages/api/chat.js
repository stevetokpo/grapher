import Anthropic from '@anthropic-ai/sdk';
import { PROVIDERS, DEFAULT_SYSTEM } from '../../lib/chatModels';

// Réponses en streaming (texte brut) → désactive la limite de taille de réponse.
export const config = { api: { responseLimit: false } };

const MAX_TOKENS = 4096;

function validModel(provider, model) {
  return PROVIDERS[provider]?.models.some(m => m.id === model);
}

// Convertit une part de message ({type:'text'|'image'}) au format du fournisseur.
function toPart(p, provider) {
  if (!p) return null;
  if (p.type === 'text') {
    return p.text ? { type: 'text', text: p.text } : null;
  }
  if (p.type === 'image' && typeof p.dataUrl === 'string') {
    if (provider === 'groq') {
      return { type: 'image_url', image_url: { url: p.dataUrl } };
    }
    // Claude : base64 + media_type extrait du data URL.
    const m = /^data:(.*?);base64,(.*)$/s.exec(p.dataUrl);
    if (!m) return null;
    return { type: 'image', source: { type: 'base64', media_type: m[1] || p.mediaType || 'image/png', data: m[2] } };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST requis' }); return; }

  const { provider, model, messages } = req.body || {};

  if (!provider || !PROVIDERS[provider]) { res.status(400).json({ error: 'Fournisseur invalide' }); return; }
  if (!validModel(provider, model)) { res.status(400).json({ error: 'Modèle inconnu pour ce fournisseur' }); return; }
  if (!Array.isArray(messages) || messages.length === 0) { res.status(400).json({ error: 'Aucun message' }); return; }

  // Normalise role/content. Le contenu peut être une string ou un tableau de
  // parts ({type:'text'} | {type:'image', dataUrl}) → converti au format du fournisseur.
  const msgs = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content };
      if (Array.isArray(m.content)) {
        const parts = m.content.map(p => toPart(p, provider)).filter(Boolean);
        return parts.length ? { role: m.role, content: parts } : null;
      }
      return null;
    })
    .filter(Boolean);

  if (msgs.length === 0 || msgs[0].role !== 'user') {
    res.status(400).json({ error: 'Le premier message doit venir de l’utilisateur' });
    return;
  }

  try {
    if (provider === 'claude') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_API_KEY manquante dans .env.local' }); return; }

      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        system: DEFAULT_SYSTEM,
        messages: msgs,
      });

      stream.on('text', (delta) => res.write(delta));
      await stream.finalMessage();
      res.end();
      return;
    }

    if (provider === 'groq') {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) { res.status(400).json({ error: 'GROQ_API_KEY manquante dans .env.local' }); return; }

      const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: 'system', content: DEFAULT_SYSTEM }, ...msgs],
        }),
      });

      if (!upstream.ok || !upstream.body) {
        let detail = `Erreur Groq ${upstream.status}`;
        try {
          const j = await upstream.json();
          detail = j.error?.message || detail;
        } catch {}
        res.status(upstream.status || 502).json({ error: detail });
        return;
      }

      // Parse le flux SSE OpenAI-compatible et ne renvoie que le texte.
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) res.write(delta);
          } catch {
            /* ligne SSE partielle ou non-JSON, ignorée */
          }
        }
      }
      res.end();
      return;
    }

    res.status(400).json({ error: 'Fournisseur non supporté' });
  } catch (err) {
    console.error('[chat]', err);
    const message = err?.error?.error?.message || err?.message || 'Erreur serveur';
    if (res.headersSent) { res.end(); return; }
    res.status(err?.status || 500).json({ error: message });
  }
}
