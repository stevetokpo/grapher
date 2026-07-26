//+------------------------------------------------------------------+
//|                                               GrapherFeeder.mq5  |
//|  Envoie les bougies M1 clôturées du symbole du graphe au serveur |
//|  Grapher, à chaque clôture M1.                                   |
//|                                                                  |
//|  À l'attache (et après toute coupure), l'EA RÉCONCILIE tout      |
//|  l'historique déjà en base avant de se contenter de suivre :     |
//|   - le serveur renvoie son relevé de couverture (nombre de       |
//|     bougies par jour) ;                                          |
//|   - l'EA compte ses propres bougies jour par jour et renvoie     |
//|     tout jour où il en a plus que la base.                       |
//|  Tous les trous sont donc comblés, y compris ceux INTERNES à     |
//|  l'historique (import CSV partiel, backfill interrompu, EA resté |
//|  détaché), et pas seulement la queue après la dernière bougie    |
//|  connue. Les jours fermés sont vides des deux côtés : ils ne     |
//|  déclenchent aucun renvoi.                                       |
//|                                                                  |
//|  Ce comblement tourne en TÂCHE DE FOND, par tranches bornées en  |
//|  temps : descendre plusieurs années d'historique ne retarde pas  |
//|  les bougies du jour, qui partent dès le premier cycle.          |
//|                                                                  |
//|  Aucun curseur ne franchit une plage non confirmée :             |
//|   - historique pas encore descendu par le terminal → la fenêtre  |
//|     est retentée, jamais sautée ;                                |
//|   - serveur injoignable, ou qui ne recompte pas tout le lot →    |
//|     rien n'avance et le cycle suivant reprend au même point.     |
//|  Seules les bougies CLÔTURÉES sont envoyées (jamais la bougie    |
//|  en formation).                                                  |
//|                                                                  |
//|  PRÉREQUIS MT5 :                                                 |
//|   Outils > Options > Expert Advisors >                           |
//|   "Autoriser WebRequest pour les URL listées"                    |
//|   et ajouter l'URL du serveur (ex. http://127.0.0.1:3000).       |
//|   L'historique M1 disponible dépend du réglage "Max. barres      |
//|   dans les graphiques" du terminal : mettez-le au maximum pour   |
//|   que l'EA puisse combler loin en arrière.                       |
//+------------------------------------------------------------------+
#property copyright   "grapher"
#property version     "2.00"
#property description "Alimente le serveur Grapher en bougies M1 clôturées"
#property strict

input string InpServerUrl      = "https://5bd0-137-255-58-137.ngrok-free.app"; // URL du serveur Grapher (sans / final)
input string InpApiKey         = "";     // GRAPHER_INGEST_KEY (vide si non configurée)
input int    InpHistoryBars    = 500;    // Historique envoyé si symbole inconnu
input int    InpRepairDays     = 0;      // Remonter au plus N jours (0 = jusqu'à la 1re bougie en base)
input int    InpChunkSize      = 5000;   // Bougies par POST (transport uniquement — chaque lot est acquitté)
input int    InpTimeoutMs      = 30000;  // Timeout WebRequest (ms) — large pour les gros backfills
input int    InpTimerSec       = 2;      // Période de vérification (secondes)
input int    InpBudgetMs       = 5000;   // Temps max de comblement par cycle (ms) — garde le terminal réactif
input int    InpWindowRetries  = 30;     // Tentatives sur une fenêtre vide avant de la déclarer absente
input int    InpLiveGapSec     = 900;    // Retard au-delà duquel on repasse par une réconciliation complète

#define SEC_PER_DAY    86400
#define WINDOW_DAYS    30                // Taille de la fenêtre d'analyse locale (~43 000 bougies M1)

enum EState { ST_SYNC, ST_REPAIR, ST_LIVE };

EState   g_state     = ST_SYNC;
datetime g_threshold = 0;   // curseur live : on n'envoie que les bougies STRICTEMENT postérieures

// Relevé de couverture du serveur : g_srvDay[i] = début du jour, g_srvCnt[i] = bougies en base.
long     g_srvDay[];
int      g_srvCnt[];
int      g_srvN = 0;

// Progression du comblement
datetime g_repairFrom   = 0;   // début de la fenêtre en cours
datetime g_repairEnd    = 0;   // dernière bougie clôturée au moment de la sync
int      g_windowRetry  = 0;
long     g_repairSent   = 0;
bool     g_repairLogged = false;

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpHistoryBars < 1 || InpChunkSize < 1 || InpTimerSec < 1)
   {
      Print("GrapherFeeder: paramètres invalides");
      return INIT_PARAMETERS_INCORRECT;
   }
   EventSetTimer(InpTimerSec);
   PrintFormat("GrapherFeeder: démarré sur %s → %s", _Symbol, InpServerUrl);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

//+------------------------------------------------------------------+
//| Boucle principale. Deux travaux indépendants, chacun reprenable  |
//| (un échec ne fait avancer aucun curseur) :                       |
//|  - le flux, qui envoie les bougies au fil des clôtures ;         |
//|  - le comblement, qui remonte l'historique par tranches en tâche |
//|    de fond. Il passe APRÈS le flux : descendre plusieurs années  |
//|    d'historique ne doit pas retarder les bougies du jour.        |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(g_state == ST_SYNC)
   {
      if(!Sync())
         return;             // serveur injoignable — nouvel essai au prochain cycle
      g_state = ST_REPAIR;
   }

   PushNewBars();

   if(g_state == ST_REPAIR && ProcessRepair())
      g_state = ST_LIVE;
}

//+------------------------------------------------------------------+
//| Demande au serveur son relevé de couverture et délimite la plage |
//| à réconcilier.                                                   |
//+------------------------------------------------------------------+
bool Sync()
{
   string resp;
   int status = HttpPost("/api/live/sync",
                         "{\"symbol\":\"" + JsonEscape(_Symbol) + "\"}", resp);
   if(status != 200)
   {
      PrintFormat("GrapherFeeder: sync échouée (HTTP %d) — nouvel essai dans %ds",
                  status, InpTimerSec);
      return false;
   }

   datetime lastClosed = iTime(_Symbol, PERIOD_M1, 1);
   if(lastClosed <= 0)
   {
      Print("GrapherFeeder: historique M1 pas encore disponible — nouvel essai");
      return false;
   }

   g_srvN = JsonGetPairs(resp, "days", g_srvDay, g_srvCnt);
   long firstTs = JsonGetLong(resp, "firstTs");
   long lastTs  = JsonGetLong(resp, "lastTs");

   datetime from;
   if(lastTs <= 0)
   {
      // Symbole inconnu (ou base vide) : on sème les InpHistoryBars dernières
      // clôturées. Barre 0 = en formation → les clôturées démarrent à l'index 1.
      datetime t = iTime(_Symbol, PERIOD_M1, InpHistoryBars + 1);
      from = (t > 0 ? t : (datetime)SeriesInfoInteger(_Symbol, PERIOD_M1, SERIES_FIRSTDATE));
   }
   else
   {
      // Symbole connu : on repasse sur TOUTE la plage déjà en base pour en
      // combler les trous internes, pas seulement la queue.
      from = (datetime)firstTs;
   }
   if(InpRepairDays > 0)
   {
      datetime floorTs = lastClosed - (datetime)InpRepairDays * SEC_PER_DAY;
      if(from < floorTs) from = floorTs;
   }

   // Partage net : le comblement traite [g_repairFrom … lastClosed], le flux
   // prend la suite STRICTEMENT après lastClosed. Aucune bougie entre les deux,
   // et le flux démarre tout de suite même si le comblement dure une heure.
   g_repairFrom   = DayStart(from);
   g_repairEnd    = lastClosed;
   g_threshold    = lastClosed;
   g_windowRetry  = 0;
   g_repairSent   = 0;
   g_repairLogged = false;

   PrintFormat("GrapherFeeder: sync OK — base : %d jour(s) couvert(s), dernière bougie %s. "
               "Vérification de %s à %s en tâche de fond, flux immédiat.",
               g_srvN,
               lastTs > 0 ? TimeToString((datetime)lastTs, TIME_DATE|TIME_MINUTES) : "aucune",
               TimeToString(g_repairFrom, TIME_DATE|TIME_MINUTES),
               TimeToString(g_repairEnd,  TIME_DATE|TIME_MINUTES));

   // Seul trou réellement incomblable : le broker ne conserve pas l'historique.
   datetime serverFirst = (datetime)SeriesInfoInteger(_Symbol, PERIOD_M1, SERIES_SERVER_FIRSTDATE);
   if(serverFirst > 0 && serverFirst > g_repairFrom + 60)
      PrintFormat("GrapherFeeder: ATTENTION — le broker n'a pas d'historique M1 avant %s ; "
                  "rien ne pourra être comblé avant cette date",
                  TimeToString(serverFirst, TIME_DATE|TIME_MINUTES));
   return true;
}

//+------------------------------------------------------------------+
//| Réconciliation par fenêtres de WINDOW_DAYS jours.                |
//| Pour chaque jour : si l'EA a plus de bougies que la base, le jour |
//| entier est renvoyé (INSERT OR IGNORE côté serveur → sans risque). |
//| true = plage entièrement traitée, on peut passer au flux.        |
//+------------------------------------------------------------------+
bool ProcessRepair()
{
   ulong    deadline    = GetTickCount64() + (ulong)MathMax(500, InpBudgetMs);
   datetime serverFirst = (datetime)SeriesInfoInteger(_Symbol, PERIOD_M1, SERIES_SERVER_FIRSTDATE);

   while(g_repairFrom <= g_repairEnd)
   {
      if(GetTickCount64() > deadline)
         return false;                       // budget épuisé — suite au prochain cycle

      datetime wEnd = g_repairFrom + (datetime)WINDOW_DAYS * SEC_PER_DAY - 1;
      if(wEnd > g_repairEnd) wEnd = g_repairEnd;

      // Antérieure au début de l'historique du broker : rien à attendre.
      if(serverFirst > 0 && wEnd < serverFirst)
      {
         g_repairFrom = wEnd + 1;
         continue;
      }

      MqlRates rates[];
      int n = CopyRates(_Symbol, PERIOD_M1, g_repairFrom, wEnd, rates);

      if(n <= 0)
      {
         // CopyRates sur une plage absente déclenche son téléchargement en
         // arrière-plan : on retente, on ne saute pas. Une fenêtre réellement
         // vide (marché fermé toute la période) finit par être déclarée absente
         // au bout de InpWindowRetries essais.
         g_windowRetry++;
         if(g_windowRetry < InpWindowRetries)
         {
            if(g_windowRetry == 1)
               PrintFormat("GrapherFeeder: historique M1 du %s au %s pas encore descendu — attente",
                           TimeToString(g_repairFrom, TIME_DATE),
                           TimeToString(wEnd, TIME_DATE));
            return false;                    // on retente la MÊME fenêtre au prochain cycle
         }
         PrintFormat("GrapherFeeder: aucune bougie M1 du %s au %s côté terminal — fenêtre ignorée",
                     TimeToString(g_repairFrom, TIME_DATE), TimeToString(wEnd, TIME_DATE));
         g_windowRetry = 0;
         g_repairFrom  = wEnd + 1;
         continue;
      }
      g_windowRetry = 0;

      if(!PushMissingDays(rates, n))
         return false;                       // envoi échoué — on reprend cette fenêtre

      g_repairFrom = wEnd + 1;
   }

   if(g_repairSent > 0)
      PrintFormat("GrapherFeeder: historique vérifié jusqu'au %s — %d bougie(s) comblée(s).",
                  TimeToString(g_repairEnd, TIME_DATE|TIME_MINUTES), (int)g_repairSent);
   else
      PrintFormat("GrapherFeeder: historique vérifié jusqu'au %s — aucun trou.",
                  TimeToString(g_repairEnd, TIME_DATE|TIME_MINUTES));
   return true;
}

//+------------------------------------------------------------------+
//| Envoie, parmi les bougies de la fenêtre, celles des jours dont le |
//| compte local dépasse le compte en base. false = envoi interrompu. |
//+------------------------------------------------------------------+
bool PushMissingDays(const MqlRates &rates[], const int n)
{
   MqlRates out[];
   ArrayResize(out, InpChunkSize);   // jamais plus d'un lot en attente : on vide dès qu'il est plein
   int nOut = 0;

   // Les bougies sont triées : un jour = un bloc contigu.
   int i = 0;
   while(i < n)
   {
      datetime day = DayStart(rates[i].time);
      int j = i;
      while(j < n && DayStart(rates[j].time) == day) j++;
      int localCount = j - i;

      if(localCount > ServerCount(day))
      {
         if(!g_repairLogged)
         {
            PrintFormat("GrapherFeeder: comblement à partir du %s", TimeToString(day, TIME_DATE));
            g_repairLogged = true;
         }
         for(int k = i; k < j; k++)
         {
            out[nOut++] = rates[k];
            if(nOut >= InpChunkSize)
            {
               if(!SendBars(out, 0, nOut)) return false;
               g_repairSent += nOut;
               nOut = 0;
            }
         }
      }
      i = j;
   }

   if(nOut > 0)
   {
      if(!SendBars(out, 0, nOut)) return false;
      g_repairSent += nOut;
   }
   return true;
}

//+------------------------------------------------------------------+
//| Nombre de bougies M1 en base pour ce jour (0 si jour absent).    |
//| Recherche dichotomique — le relevé serveur est trié.             |
//+------------------------------------------------------------------+
int ServerCount(const datetime day)
{
   long key = (long)day;
   int lo = 0, hi = g_srvN - 1;
   while(lo <= hi)
   {
      int mid = (lo + hi) / 2;
      if(g_srvDay[mid] == key)     return g_srvCnt[mid];
      else if(g_srvDay[mid] < key) lo = mid + 1;
      else                         hi = mid - 1;
   }
   return 0;
}

datetime DayStart(const datetime t) { return (datetime)((long)t / SEC_PER_DAY * SEC_PER_DAY); }

//+------------------------------------------------------------------+
//| Flux : envoie les bougies clôturées situées après g_threshold.   |
//+------------------------------------------------------------------+
void PushNewBars()
{
   datetime lastClosed = iTime(_Symbol, PERIOD_M1, 1);  // dernière bougie clôturée
   if(lastClosed <= 0 || lastClosed <= g_threshold)
      return;                                            // rien de nouveau

   // Retard important (terminal resté fermé, longue coupure réseau, week-end) :
   // sur une telle plage, l'historique du terminal peut être incomplet et
   // CopyRates ne rendrait qu'une partie des bougies — le curseur sauterait
   // par-dessus le reste. On repasse donc par une vérification jour par jour,
   // qui, elle, retente tant que la plage n'est pas descendue.
   if(lastClosed - g_threshold > InpLiveGapSec)
   {
      PrintFormat("GrapherFeeder: %d min de retard — vérification de la plage avant reprise",
                  (int)((lastClosed - g_threshold) / 60));
      g_state = ST_SYNC;
      return;
   }

   MqlRates rates[];
   int n = CopyRates(_Symbol, PERIOD_M1, g_threshold + 1, lastClosed, rates);
   if(n <= 0)
      return;   // historique pas encore reconstruit — on retentera

   // Envoi par lots (ordre chronologique : rates[0] = la plus ancienne).
   // Le curseur ne franchit que ce qui est acquitté, lot par lot.
   int i = 0;
   while(i < n)
   {
      int count = (int)MathMin(InpChunkSize, n - i);
      if(!SendBars(rates, i, count))
         return;   // curseur inchangé → ces bougies repartiront au prochain cycle
      g_threshold = rates[i + count - 1].time;
      i += count;
   }
}

//+------------------------------------------------------------------+
//| POST d'un lot + vérification de l'accusé. Le curseur n'avance    |
//| que si le serveur confirme avoir AU MOINS autant de bougies que  |
//| ce qui a été envoyé sur la plage du lot.                         |
//+------------------------------------------------------------------+
bool SendBars(const MqlRates &bars[], const int start, const int count)
{
   if(count <= 0) return true;

   string resp;
   int status = HttpPost("/api/live/bars", BuildBarsJson(bars, start, count), resp);
   if(status != 200)
   {
      PrintFormat("GrapherFeeder: envoi de %d bougie(s) échoué (HTTP %d) — reprise au prochain cycle",
                  count, status);
      return false;
   }

   // "stored" = bougies réellement en base sur la plage du lot. Inférieur à ce
   // qui a été envoyé ⇒ insertion incomplète : on ne valide pas, on renverra.
   if(StringFind(resp, "\"stored\":") >= 0)
   {
      long stored = JsonGetLong(resp, "stored");
      if(stored < count)
      {
         PrintFormat("GrapherFeeder: le serveur ne compte que %d bougie(s) sur les %d envoyées "
                     "(%s → %s) — renvoi au prochain cycle",
                     (int)stored, count,
                     TimeToString(bars[start].time, TIME_DATE|TIME_MINUTES),
                     TimeToString(bars[start + count - 1].time, TIME_DATE|TIME_MINUTES));
         return false;
      }
   }

   return true;
}

//+------------------------------------------------------------------+
//| JSON { symbol, bars: [[t,o,h,l,c,tickVol,realVol,spread], …] }   |
//+------------------------------------------------------------------+
string BuildBarsJson(const MqlRates &r[], const int start, const int count)
{
   string bars = "";
   StringReserve(bars, (uint)count * 80 + 128);   // évite les réallocations sur les gros lots
   for(int k = 0; k < count; k++)
   {
      if(k > 0) StringAdd(bars, ",");
      StringAdd(bars, "[" + (string)(long)r[start + k].time
                    + "," + DoubleToString(r[start + k].open,  _Digits)
                    + "," + DoubleToString(r[start + k].high,  _Digits)
                    + "," + DoubleToString(r[start + k].low,   _Digits)
                    + "," + DoubleToString(r[start + k].close, _Digits)
                    + "," + (string)r[start + k].tick_volume
                    + "," + (string)r[start + k].real_volume
                    + "," + (string)r[start + k].spread + "]");
   }
   return "{\"symbol\":\"" + JsonEscape(_Symbol) + "\",\"bars\":[" + bars + "]}";
}

//+------------------------------------------------------------------+
//| POST JSON → code HTTP (-1 = erreur WebRequest), réponse en texte |
//+------------------------------------------------------------------+
int HttpPost(const string path, const string body, string &response)
{
   string url     = InpServerUrl + path;
   string headers = "Content-Type: application/json\r\n"
                    "ngrok-skip-browser-warning: 1\r\n"; // sans effet hors tunnel ngrok
   if(InpApiKey != "")
      headers += "x-ingest-key: " + InpApiKey + "\r\n";

   char data[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1; // sans le \0
   if(len < 0) len = 0;
   ArrayResize(data, len);

   char   result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", url, headers, InpTimeoutMs, data, result, resultHeaders);

   if(status == -1)
   {
      int err = GetLastError();
      if(err == 4014)
         PrintFormat("GrapherFeeder: WebRequest interdit — ajoutez %s dans "
                     "Outils > Options > Expert Advisors > URL autorisées", InpServerUrl);
      else
         PrintFormat("GrapherFeeder: WebRequest erreur %d", err);
      response = "";
      return -1;
   }

   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return status;
}

//+------------------------------------------------------------------+
//| Helpers JSON minimaux (réponses compactes du serveur)            |
//+------------------------------------------------------------------+
string JsonEscape(const string s)
{
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
}

// Valeur numérique de "key" dans un JSON plat ; 0 si absente ou null.
long JsonGetLong(const string json, const string key)
{
   int p = StringFind(json, "\"" + key + "\":");
   if(p < 0) return 0;
   p += StringLen(key) + 3;
   int e = p, n = StringLen(json);
   while(e < n)
   {
      ushort c = StringGetCharacter(json, e);
      if((c >= '0' && c <= '9') || (c == '-' && e == p)) e++;
      else break;
   }
   if(e == p) return 0;   // "null" ou format inattendu
   return StringToInteger(StringSubstr(json, p, e - p));
}

// Lit "key":[[a,b],[a,b],…] → deux tableaux parallèles. Renvoie le nombre de paires.
int JsonGetPairs(const string json, const string key, long &first[], int &second[])
{
   ArrayResize(first, 0, 4096);
   ArrayResize(second, 0, 4096);
   int p = StringFind(json, "\"" + key + "\":");
   if(p < 0) return 0;
   p = StringFind(json, "[", p);
   if(p < 0) return 0;

   int n = StringLen(json), depth = 0, idx = 0, field = 0;
   long cur = 0;
   bool inNum = false;
   for(int i = p; i < n; i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(c >= '0' && c <= '9') { cur = cur * 10 + (long)(c - '0'); inNum = true; continue; }
      if(inNum)
      {
         if(field == 0)
         {
            ArrayResize(first, idx + 1, 4096);
            first[idx] = cur;
            field = 1;
         }
         else
         {
            ArrayResize(second, idx + 1, 4096);
            second[idx] = (int)cur;
            field = 0;
            idx++;
         }
         cur   = 0;
         inNum = false;
      }
      if(c == '[') depth++;
      else if(c == ']') { depth--; if(depth <= 0) break; }
   }
   return idx;
}
//+------------------------------------------------------------------+
