// Abonnement Web Push côté navigateur.
//
// Fonctionne sur http://localhost sans HTTPS : localhost est un « contexte
// sécurisé » au sens de la spec. Sur une IP de LAN (192.168.x.x) en revanche,
// ce n'est PAS le cas — le navigateur refusera l'abonnement.

// La clé VAPID publique voyage en base64url ; l'API Push veut un Uint8Array.
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && window.isSecureContext;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return reg ? reg.pushManager.getSubscription() : null;
}

// Enregistre le SW, demande la permission, s'abonne, envoie l'abonnement au serveur.
// Renvoie { ok } ou { error } — jamais de throw, l'UI affiche le message tel quel.
export async function subscribePush(vapidPublicKey) {
  if (!pushSupported()) {
    return { error: window?.isSecureContext === false
      ? 'Contexte non sécurisé : le push exige localhost ou HTTPS.'
      : 'Ce navigateur ne gère pas le Web Push.' };
  }
  if (!vapidPublicKey) return { error: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY absente du .env.local' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { error: 'Permission refusée dans le navigateur.' };

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    const res = await fetch('/api/notify/subscribe', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...sub.toJSON(), label: navigator.userAgent.slice(0, 64) }),
    });
    if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? 'échec côté serveur' };

    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

export async function unsubscribePush() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };

  await fetch('/api/notify/subscribe', {
    method:  'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
  return { ok: true };
}
