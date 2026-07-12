import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { DEFAULT_MODEL, PROVIDERS, defaultModelFor } from '../lib/chatModels';

let _seq = 0;
const uid = () => `${Date.now().toString(36)}-${(_seq++).toString(36)}`;

function newConversation() {
  return {
    id: uid(),
    title: 'Nouvelle discussion',
    provider: DEFAULT_MODEL.provider,
    model: DEFAULT_MODEL.model,
    messages: [],            // [{ role: 'user'|'assistant', content }]
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Gère les discussions (persistées dans localStorage) et l'envoi en streaming.
export function useChat() {
  const [conversations, setConversations] = useLocalStorage('grapher.chat.conversations', []);
  const [activeId, setActiveId] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);

  // Miroirs pour éviter les closures périmées dans sendMessage.
  const convsRef = useRef(conversations);
  const activeRef = useRef(activeId);
  const streamingRef = useRef(streaming);
  convsRef.current = conversations;
  activeRef.current = activeId;
  streamingRef.current = streaming;

  const abortRef = useRef(null);

  // Sélectionne la discussion la plus récente après hydratation.
  useEffect(() => {
    if (activeId === null && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  // Discussions triées (plus récentes en premier) pour le sélecteur.
  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  const active = useMemo(
    () => conversations.find(c => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const patch = useCallback((id, updater) => {
    setConversations(prev => prev.map(c => (c.id === id ? updater(c) : c)));
  }, [setConversations]);

  const createConversation = useCallback(() => {
    const conv = newConversation();
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setError(null);
    return conv.id;
  }, [setConversations]);

  const selectConversation = useCallback((id) => {
    setActiveId(id);
    setError(null);
  }, []);

  const deleteConversation = useCallback((id) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (id === activeRef.current) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [setConversations]);

  // Garantit une discussion active : renvoie son id, en la créant si besoin.
  const ensureActive = useCallback((overrides = {}) => {
    const id = activeRef.current;
    if (id && convsRef.current.some(c => c.id === id)) return id;
    const conv = { ...newConversation(), ...overrides };
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    return conv.id;
  }, [setConversations]);

  // Change le fournisseur (et recale le modèle) de la discussion active.
  const setProvider = useCallback((provider) => {
    if (!PROVIDERS[provider]) return;
    const model = defaultModelFor(provider);
    const id = ensureActive({ provider, model });
    patch(id, c => ({ ...c, provider, model }));
  }, [ensureActive, patch]);

  const setModel = useCallback((model) => {
    const id = ensureActive({ model });
    patch(id, c => ({ ...c, model }));
  }, [ensureActive, patch]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // image (optionnel) : { dataUrl, mediaType }
  const sendMessage = useCallback(async (text, image = null) => {
    const content = (text || '').trim();
    if ((!content && !image) || streamingRef.current) return;
    setError(null);

    // Contenu du message : string si texte seul, sinon tableau de parts.
    const userContent = image
      ? [
          ...(content ? [{ type: 'text', text: content }] : []),
          { type: 'image', dataUrl: image.dataUrl, mediaType: image.mediaType || 'image/png' },
        ]
      : content;
    const titleSeed = content || (image ? 'Capture du graphe' : '');

    // Résout (ou crée) la discussion active.
    let convId = activeRef.current;
    let conv = convsRef.current.find(c => c.id === convId);
    if (!conv) {
      conv = newConversation();
      convId = conv.id;
      setActiveId(convId);
    }

    const history = conv.messages;                       // sans le placeholder
    const userMsg = { role: 'user', content: userContent };
    const isFirst = history.length === 0;
    const title = isFirst ? titleSeed.slice(0, 48) : conv.title;
    const provider = conv.provider;
    const model = conv.model;

    // Phase 1 : ajoute le message user + un placeholder assistant vide.
    setConversations(prev => {
      const exists = prev.some(c => c.id === convId);
      const base = exists ? prev : [conv, ...prev];
      return base.map(c => c.id === convId
        ? { ...c, title, updatedAt: Date.now(),
            messages: [...c.messages, userMsg, { role: 'assistant', content: '' }] }
        : c);
    });

    const writeAssistant = (value) => {
      setConversations(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const m = c.messages.slice();
        m[m.length - 1] = { role: 'assistant', content: value };
        return { ...c, messages: m, updatedAt: Date.now() };
      }));
    };

    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);

    let acc = '';
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          messages: [...history, userMsg],
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        writeAssistant(acc);
      }
      if (!acc) writeAssistant('_(réponse vide)_');
    } catch (err) {
      if (err.name === 'AbortError') {
        writeAssistant(acc + (acc ? '\n\n_(interrompu)_' : '_(interrompu)_'));
      } else {
        setError(err.message);
        writeAssistant(acc + (acc ? '\n\n' : '') + `⚠️ ${err.message}`);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [setConversations]);

  return {
    conversations: sorted,
    active,
    activeId,
    streaming,
    error,
    createConversation,
    selectConversation,
    deleteConversation,
    setProvider,
    setModel,
    sendMessage,
    stop,
  };
}
