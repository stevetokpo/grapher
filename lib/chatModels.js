// Configuration des fournisseurs IA et de leurs modèles pour le chat.
// Les clés API vivent côté serveur dans .env.local (ANTHROPIC_API_KEY, GROQ_API_KEY).

export const PROVIDERS = {
  claude: {
    label: 'Claude',
    models: [
      { id: 'claude-opus-4-8',   label: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
    ],
  },
  groq: {
    label: 'Groq',
    models: [
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout · 👁 vision' },
      { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick · 👁 vision' },
      { id: 'llama-3.3-70b-versatile',       label: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant',          label: 'Llama 3.1 8B · instant' },
      { id: 'openai/gpt-oss-120b',           label: 'GPT-OSS 120B' },
      { id: 'openai/gpt-oss-20b',            label: 'GPT-OSS 20B' },
      { id: 'moonshotai/kimi-k2-instruct',   label: 'Kimi K2' },
      { id: 'qwen/qwen3-32b',                label: 'Qwen3 32B' },
      { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 70B' },
    ],
  },
};

export const DEFAULT_MODEL = { provider: 'claude', model: 'claude-opus-4-8' };

export const DEFAULT_SYSTEM =
  "Tu es un assistant IA intégré à Grapher, une application de graphiques de trading sur données MT5. " +
  "Réponds de façon claire et concise, en français par défaut (suis la langue de l'utilisateur). " +
  "Tu peux aider sur le trading, l'analyse technique, le code et toute autre question.";

// Renvoie un modèle valide pour un fournisseur (le 1er par défaut).
export function defaultModelFor(provider) {
  return PROVIDERS[provider]?.models[0]?.id ?? DEFAULT_MODEL.model;
}
