//+------------------------------------------------------------------+
//|                                                GrapherTicker.mq5 |
//|  Enregistre TOUS les ticks du symbole du graphe et les envoie au  |
//|  serveur Grapher à chaque clôture de bougie M1.                   |
//|                                                                   |
//|  Les ticks ne sont PAS lus dans OnTick() : le terminal regroupe   |
//|  les arrivées quand l'EA est occupé, et OnTick() en manquerait.   |
//|  On lit le cache du terminal avec CopyTicks() depuis un curseur   |
//|  en millisecondes, ce qui rend TOUS les ticks, y compris ceux     |
//|  arrivés pendant que l'EA travaillait.                            |
//|                                                                   |
//|  Rien n'est perdu tant que le serveur ne l'a pas confirmé :       |
//|   - le tampon n'est vidé que si le serveur RECOMPTE le lot ;      |
//|   - serveur injoignable → le lot reste en mémoire et repart au    |
//|     cycle suivant ;                                               |
//|   - seul un tampon saturé (InpMaxBuffer) jette des ticks, en le   |
//|     disant dans le journal.                                       |
//|                                                                   |
//|  Cet EA ne remonte AUCUN historique : il n'envoie que ce qu'il    |
//|  voit passer. Détaché, il ne manque rien tant qu'il reste dans    |
//|  la minute en cours ; au-delà, la minute est simplement absente   |
//|  et le graphe le montre comme un trou.                            |
//|                                                                   |
//|  Il est complémentaire de GrapherFeeder (bougies M1) et peut      |
//|  tourner en même temps sur le même symbole, dans un autre graphe. |
//|                                                                   |
//|  PRÉREQUIS MT5 :                                                  |
//|   Outils > Options > Expert Advisors >                            |
//|   « Autoriser WebRequest pour les URL listées »                   |
//|   et ajouter l'URL du serveur (ex. http://127.0.0.1:3000).        |
//+------------------------------------------------------------------+
#property copyright   "grapher"
#property version     "1.00"
#property description "Envoie tous les ticks au serveur Grapher, à chaque clôture M1"
#property strict

input string InpServerUrl   = "http://127.0.0.1:3000"; // URL du serveur Grapher (sans / final)
input string InpApiKey      = "";      // GRAPHER_INGEST_KEY (vide si non configurée)
input int    InpPollMs      = 1000;    // Période de relève du cache de ticks (ms)
input int    InpChunkSize   = 20000;   // Ticks par POST (transport — chaque lot est acquitté)
input int    InpTimeoutMs   = 30000;   // Timeout WebRequest (ms)
input int    InpMaxBuffer   = 2000000; // Ticks gardés au plus en mémoire si le serveur est muet
input bool   InpShowPanel   = true;    // Afficher l'état sur le graphe

#define PANEL_PREFIX "GrapherTicker_"

// Tampon des ticks pas encore confirmés par le serveur.
MqlTick  g_buf[];
int      g_bufN = 0;

// Curseur de relève. CopyTicks rend les ticks de time_msc >= g_cursorMsc, borne
// COMPRISE : sans mémoire du nombre déjà pris à cette milliseconde exacte, les
// ticks de la frontière reviendraient en double à chaque relève. On ne peut pas
// simplement avancer le curseur d'une milliseconde — on sauterait les ticks
// suivants de la même milliseconde, qui sont précisément ce que ce graphe
// prétend montrer.
long     g_cursorMsc  = 0;
int      g_cursorTake = 0;   // ticks déjà pris à g_cursorMsc

datetime g_lastBar    = 0;   // début de la bougie M1 en formation, à la dernière relève
long     g_sentTotal  = 0;
long     g_dropped    = 0;
string   g_lastError  = "";
datetime g_lastOkTime = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpPollMs < 50 || InpChunkSize < 1 || InpMaxBuffer < 1000)
   {
      Print("GrapherTicker: paramètres invalides");
      return INIT_PARAMETERS_INCORRECT;
   }

   ArrayResize(g_buf, 0, 65536);

   // Départ au début de la minute EN COURS : les ticks déjà écoulés de cette
   // minute sont encore dans le cache du terminal, la première bougie envoyée
   // est donc complète et non tronquée à l'instant de l'attache.
   datetime bar0 = iTime(_Symbol, PERIOD_M1, 0);
   if(bar0 <= 0) bar0 = (datetime)(TimeCurrent() / 60 * 60);
   g_cursorMsc  = (long)bar0 * 1000;
   g_cursorTake = 0;
   g_lastBar    = bar0;

   EventSetMillisecondTimer(InpPollMs);
   PrintFormat("GrapherTicker: démarré sur %s → %s (relève toutes les %d ms)",
               _Symbol, InpServerUrl, InpPollMs);
   UpdatePanel();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0, PANEL_PREFIX);
   if(g_bufN > 0)
      PrintFormat("GrapherTicker: arrêt avec %d tick(s) non confirmé(s) — ils sont perdus", g_bufN);
}

//+------------------------------------------------------------------+
//| Deux travaux à chaque cycle, dans cet ordre :                    |
//|  1. relever le cache du terminal (ne jamais rater un tick) ;     |
//|  2. envoyer les ticks des minutes CLÔTURÉES.                     |
//| Un envoi raté ne fait reculer aucun curseur : les ticks restent  |
//| dans le tampon et repartent au cycle suivant.                    |
//+------------------------------------------------------------------+
void OnTimer()
{
   Collect();

   datetime bar0 = iTime(_Symbol, PERIOD_M1, 0);
   if(bar0 > 0)
   {
      // Tout ce qui précède la bougie en formation appartient à une minute
      // close : c'est exactement le lot à envoyer.
      Flush((long)bar0 * 1000);
      g_lastBar = bar0;
   }

   UpdatePanel();
}

//+------------------------------------------------------------------+
//| Relève du cache de ticks depuis le curseur.                      |
//+------------------------------------------------------------------+
void Collect()
{
   MqlTick fresh[];
   // count = 0 : tout ce qui suit le curseur. Si le terminal en rend moins que
   // disponible, rien n'est perdu — le curseur s'arrête sur le dernier tick
   // rendu et le cycle suivant reprend exactement là.
   int n = CopyTicks(_Symbol, fresh, COPY_TICKS_ALL, (ulong)g_cursorMsc, 0);
   if(n <= 0)
   {
      // -1 = historique de ticks encore en cours de chargement (erreur 4401 au
      // premier appel, c'est normal) : on retente au cycle suivant.
      if(n < 0) g_lastError = StringFormat("CopyTicks %d", GetLastError());
      return;
   }

   // Les `g_cursorTake` premiers ticks de la milliseconde du curseur sont déjà
   // en tampon : on les enjambe, et eux seuls.
   int skip = 0;
   while(skip < n && fresh[skip].time_msc == g_cursorMsc && skip < g_cursorTake)
      skip++;
   if(skip >= n) return;

   int added = n - skip;
   if(g_bufN + added > InpMaxBuffer)
   {
      // Tampon saturé : le serveur est muet depuis longtemps. On sacrifie les
      // ticks les PLUS ANCIENS — la vue temps réel reste juste, et la perte est
      // dite plutôt que silencieuse.
      int excess = g_bufN + added - InpMaxBuffer;
      if(excess >= g_bufN) { excess = g_bufN; }
      for(int k = excess; k < g_bufN; k++) g_buf[k - excess] = g_buf[k];
      g_bufN   -= excess;
      g_dropped += excess;
      PrintFormat("GrapherTicker: tampon saturé — %d tick(s) ancien(s) abandonné(s) (total %d)",
                  excess, (int)g_dropped);
   }

   if(ArraySize(g_buf) < g_bufN + added)
      ArrayResize(g_buf, g_bufN + added, 65536);

   for(int i = skip; i < n; i++)
      g_buf[g_bufN++] = fresh[i];

   // Nouveau curseur : la dernière milliseconde vue, et le nombre de ticks
   // déjà pris à cette milliseconde précise.
   long lastMsc = fresh[n - 1].time_msc;
   if(lastMsc == g_cursorMsc)
   {
      g_cursorTake += added;
   }
   else
   {
      g_cursorMsc  = lastMsc;
      g_cursorTake = 0;
      for(int i = n - 1; i >= 0 && fresh[i].time_msc == lastMsc; i--) g_cursorTake++;
   }
}

//+------------------------------------------------------------------+
//| Envoie les ticks antérieurs à `boundaryMsc` (début de la bougie  |
//| en formation). Le tampon n'est vidé que de ce que le serveur a   |
//| recompté.                                                        |
//+------------------------------------------------------------------+
void Flush(const long boundaryMsc)
{
   // Nombre de ticks appartenant à des minutes closes. Le tampon est trié par
   // construction (CopyTicks rend dans l'ordre), une simple avance suffit.
   int ready = 0;
   while(ready < g_bufN && g_buf[ready].time_msc < boundaryMsc) ready++;
   if(ready == 0) return;

   int sent = 0;
   while(sent < ready)
   {
      int count = MathMin(InpChunkSize, ready - sent);
      if(!PostTicks(sent, count))
         break;                       // échec : on garde tout ce qui reste
      sent += count;
   }

   if(sent > 0)
   {
      // Compactage : seuls les ticks confirmés quittent le tampon.
      for(int k = sent; k < g_bufN; k++) g_buf[k - sent] = g_buf[k];
      g_bufN     -= sent;
      g_sentTotal += sent;
      g_lastOkTime = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
//| POST d'une tranche du tampon. true seulement si le serveur       |
//| confirme avoir AU MOINS autant de ticks que le lot en contenait. |
//+------------------------------------------------------------------+
bool PostTicks(const int start, const int count)
{
   string resp;
   int status = HttpPost("/api/live/ticks", BuildTicksJson(start, count), resp);

   if(status != 200)
   {
      g_lastError = StringFormat("HTTP %d", status);
      if(status > 0 && StringLen(resp) > 0)
         PrintFormat("GrapherTicker: envoi refusé (HTTP %d) — %s", status, StringSubstr(resp, 0, 200));
      return false;
   }

   // Le serveur recompte la plage du lot après insertion. Un compte inférieur
   // signifie que des ticks ne sont pas en base : on ne libère rien.
   if(StringFind(resp, "\"stored\":") >= 0)
   {
      long stored = JsonGetLong(resp, "stored");
      if(stored < count)
      {
         PrintFormat("GrapherTicker: le serveur ne compte que %d tick(s) sur les %d envoyés — renvoi au prochain cycle",
                     (int)stored, count);
         g_lastError = "recompte court";
         return false;
      }
   }

   long collapsed = JsonGetLong(resp, "collapsed");
   if(collapsed > 0)
      PrintFormat("GrapherTicker: %d tick(s) au-delà de 1000 dans une même milliseconde — rang saturé",
                  (int)collapsed);

   g_lastError = "";
   return true;
}

//+------------------------------------------------------------------+
//| JSON { symbol, ticks: [[tMs, bid, ask, last, volume, flags], …] }|
//|                                                                  |
//| bid/ask/last/volume valent `null` quand le tick ne les porte pas :|
//| écrire 0 en ferait un PRIX de zéro côté base, et une bougie       |
//| tomberait à l'origine. Un indice synthétique n'a jamais de last   |
//| ni de volume — la colonne doit rester vide, pas nulle.            |
//+------------------------------------------------------------------+
string BuildTicksJson(const int start, const int count)
{
   string body = "{\"symbol\":\"" + JsonEscape(_Symbol) + "\",\"ticks\":[";
   StringReserve(body, (uint)count * 72 + 128);   // évite les réallocations sur les gros lots

   for(int k = 0; k < count; k++)
   {
      int i = start + k;
      if(k > 0) StringAdd(body, ",");

      StringAdd(body, "[" + (string)g_buf[i].time_msc);
      StringAdd(body, "," + PriceOrNull(g_buf[i].bid));
      StringAdd(body, "," + PriceOrNull(g_buf[i].ask));
      StringAdd(body, "," + PriceOrNull(g_buf[i].last));
      StringAdd(body, "," + VolumeOrNull(i));
      StringAdd(body, "," + (string)g_buf[i].flags + "]");
   }

   StringAdd(body, "]}");
   return body;
}

string PriceOrNull(const double p)
{
   if(p <= 0.0) return "null";
   return DoubleToString(p, _Digits);
}

// volume_real prime quand il est renseigné : c'est le seul des deux qui sache
// dire un volume fractionnaire (0,01 lot). volume (entier) sert de repli.
string VolumeOrNull(const int i)
{
   if(g_buf[i].volume_real > 0.0) return DoubleToString(g_buf[i].volume_real, 2);
   if(g_buf[i].volume > 0)        return (string)g_buf[i].volume;
   return "null";
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
         PrintFormat("GrapherTicker: WebRequest interdit — ajoutez %s dans "
                     "Outils > Options > Expert Advisors > URL autorisées", InpServerUrl);
      else
         PrintFormat("GrapherTicker: WebRequest erreur %d", err);
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

//+------------------------------------------------------------------+
//| Panneau d'état — ce qui compte quand on laisse tourner l'EA :    |
//| est-ce que ça part, et depuis quand.                             |
//+------------------------------------------------------------------+
void UpdatePanel()
{
   if(!InpShowPanel) return;

   string lines[5];
   lines[0] = "GRAPHER TICKER — " + _Symbol;
   lines[1] = "envoyés   " + (string)g_sentTotal;
   lines[2] = "en attente " + (string)g_bufN;
   lines[3] = (g_lastOkTime > 0
               ? "dernier   " + TimeToString(g_lastOkTime, TIME_MINUTES|TIME_SECONDS)
               : "dernier   —");
   lines[4] = (g_lastError == ""
               ? (g_dropped > 0 ? "perdus    " + (string)g_dropped : "état      OK")
               : "état      " + g_lastError);

   for(int i = 0; i < 5; i++)
   {
      string name = PANEL_PREFIX + (string)i;
      if(ObjectFind(0, name) < 0)
      {
         ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
         ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, name, OBJPROP_XDISTANCE, 12);
         ObjectSetInteger(0, name, OBJPROP_YDISTANCE, 18 + i * 16);
         ObjectSetInteger(0, name, OBJPROP_FONTSIZE, i == 0 ? 9 : 8);
         ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
         ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      }
      color col = clrGray;
      if(i == 0)                        col = clrGoldenrod;
      else if(i == 4 && g_lastError != "") col = clrTomato;
      else if(i == 4)                   col = clrMediumSeaGreen;
      ObjectSetInteger(0, name, OBJPROP_COLOR, col);
      ObjectSetString(0, name, OBJPROP_TEXT, lines[i]);
   }
   ChartRedraw(0);
}
//+------------------------------------------------------------------+
