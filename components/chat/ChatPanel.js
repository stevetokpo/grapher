import { useEffect, useRef, useState } from 'react';
import { useChat } from '../../hooks/useChat';
import { PROVIDERS } from '../../lib/chatModels';
import styles from './ChatPanel.module.css';

export default function ChatPanel({ onClose }) {
  const {
    conversations, active, streaming, error,
    createConversation, selectConversation, deleteConversation,
    setProvider, setModel, sendMessage, stop,
  } = useChat();

  const [draft, setDraft] = useState('');
  const [image, setImage] = useState(null); // { dataUrl, mediaType }
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  const messages = active?.messages ?? [];
  const provider = active?.provider ?? 'claude';
  const model = active?.model ?? '';

  // Auto-scroll vers le bas à chaque nouveau contenu.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Fermer avec Échap.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    const text = draft.trim();
    if ((!text && !image) || streaming) return;
    sendMessage(text, image);
    setDraft('');
    setImage(null);
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Coller une image depuis le presse-papier (ex. capture du graphe).
  const onPaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setImage({ dataUrl: reader.result, mediaType: file.type });
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  };

  const onInput = (e) => {
    setDraft(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  };

  return (
    <div className={styles.backdrop} onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label="Assistant IA">
        {/* ── En-tête ─────────────────────────────────────────────── */}
        <header className={styles.head}>
          <div className={styles.titleWrap}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.title}>Assistant IA</span>
          </div>
          <button className={styles.iconBtn} onClick={createConversation} title="Nouvelle discussion" aria-label="Nouvelle discussion">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button className={styles.iconBtn} onClick={onClose} title="Fermer" aria-label="Fermer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {/* ── Barre de contrôles ──────────────────────────────────── */}
        <div className={styles.controls}>
          <select
            className={styles.select}
            value={active?.id ?? ''}
            onChange={e => selectConversation(e.target.value)}
            aria-label="Discussion"
            disabled={conversations.length === 0}
          >
            {conversations.length === 0 && <option value="">Aucune discussion</option>}
            {conversations.map(c => (
              <option key={c.id} value={c.id}>{c.title || 'Sans titre'}</option>
            ))}
          </select>

          {active && (
            <button
              className={styles.iconBtnSm}
              onClick={() => deleteConversation(active.id)}
              title="Supprimer cette discussion"
              aria-label="Supprimer la discussion"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          )}
        </div>

        <div className={styles.modelRow}>
          <select
            className={styles.modelSelect}
            value={provider}
            onChange={e => setProvider(e.target.value)}
            aria-label="Fournisseur"
          >
            {Object.entries(PROVIDERS).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
          <select
            className={styles.modelSelect}
            value={model}
            onChange={e => setModel(e.target.value)}
            aria-label="Modèle"
          >
            {(PROVIDERS[provider]?.models ?? []).map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* ── Messages ────────────────────────────────────────────── */}
        <div className={styles.messages} ref={scrollRef}>
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p className={styles.emptyTitle}>Pose ta question</p>
              <p className={styles.emptyHint}>
                Choisis un modèle ci-dessus, écris ci-dessous. Les discussions sont
                conservées localement.
              </p>
            </div>
          ) : (
            messages.map((m, i) => {
              const parts = Array.isArray(m.content) ? m.content : null;
              const isLast = i === messages.length - 1;
              return (
                <div key={i} className={`${styles.msg} ${m.role === 'user' ? styles.msgUser : styles.msgAi}`}>
                  <span className={styles.role}>{m.role === 'user' ? 'Vous' : 'IA'}</span>
                  <div className={styles.bubble}>
                    {parts ? (
                      parts.map((p, j) => (
                        p.type === 'image'
                          ? <img key={j} src={p.dataUrl} alt="image jointe" className={styles.thumb} />
                          : <span key={j}>{p.text}</span>
                      ))
                    ) : (
                      m.content || (streaming && isLast ? <span className={styles.caret} /> : '')
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && <div className={styles.errorBar}>{error}</div>}

        {/* ── Aperçu image collée ─────────────────────────────────── */}
        {image && (
          <div className={styles.attachRow}>
            <div className={styles.attachThumb}>
              <img src={image.dataUrl} alt="aperçu" />
              <button
                className={styles.attachRemove}
                onClick={() => setImage(null)}
                title="Retirer l'image"
                aria-label="Retirer l'image"
              >×</button>
            </div>
            <span className={styles.attachHint}>Image jointe — sera envoyée avec ton message</span>
          </div>
        )}

        {/* ── Saisie ──────────────────────────────────────────────── */}
        <div className={styles.inputRow}>
          <textarea
            ref={taRef}
            className={styles.textarea}
            value={draft}
            onChange={onInput}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Écris un message…  (Ctrl+V pour coller une capture)"
            rows={1}
          />
          {streaming ? (
            <button className={styles.stopBtn} onClick={stop} title="Arrêter" aria-label="Arrêter">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button className={styles.sendBtn} onClick={submit} disabled={!draft.trim() && !image} title="Envoyer" aria-label="Envoyer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
