//+------------------------------------------------------------------+
//|                                               GrapherFeeder.mq5  |
//|  Envoie les bougies M1 clôturées du symbole du graphe au serveur |
//|  Grapher, à chaque clôture M1.                                   |
//|                                                                  |
//|  Au démarrage :                                                  |
//|   - symbole déjà en base  → rattrape tout ce qui manque depuis   |
//|     la dernière bougie connue du serveur, puis suit le flux ;    |
//|   - symbole inconnu       → envoie les InpHistoryBars dernières  |
//|     bougies M1 clôturées, puis suit le flux.                     |
//|                                                                  |
//|  Auto-réparant : si le serveur est injoignable, le curseur ne    |
//|  bouge pas et les bougies manquées repartent au cycle suivant.   |
//|  Seules les bougies CLÔTURÉES sont envoyées (jamais la bougie    |
//|  en formation).                                                  |
//|                                                                  |
//|  PRÉREQUIS MT5 :                                                 |
//|   Outils > Options > Expert Advisors >                           |
//|   "Autoriser WebRequest pour les URL listées"                    |
//|   et ajouter l'URL du serveur (ex. http://127.0.0.1:3000).       |
//|   L'historique M1 disponible dépend du réglage "Max. barres      |
//|   dans les graphiques" du terminal.                              |
//+------------------------------------------------------------------+
#property copyright   "grapher"
#property version     "1.00"
#property description "Alimente le serveur Grapher en bougies M1 clôturées"
#property strict

input string InpServerUrl   = "https://5bd0-137-255-58-137.ngrok-free.app"; // URL du serveur Grapher (sans / final)
input string InpApiKey      = "";                      // GRAPHER_INGEST_KEY (vide si non configurée)
input int    InpHistoryBars = 500;                     // Historique envoyé si symbole inconnu
input int    InpChunkSize   = 5000;                    // Bougies par POST (transport uniquement — aucune perte : chaque lot est acquitté avant d'avancer)
input int    InpTimeoutMs   = 30000;                   // Timeout WebRequest (ms) — large pour les gros backfills
input int    InpTimerSec    = 2;                       // Période de vérification (secondes)

// Curseur : on n'envoie que les bougies STRICTEMENT postérieures à ce timestamp.
datetime g_threshold = 0;
bool     g_synced    = false;

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpHistoryBars < 1 || InpChunkSize < 1)
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
//| Boucle principale : sync initiale puis push des nouvelles barres |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(!g_synced && !Sync())
      return;              // serveur injoignable — nouvel essai au prochain tick
   PushNewBars();
}

//+------------------------------------------------------------------+
//| Demande au serveur son dernier timestamp pour ce symbole et      |
//| positionne le curseur de départ.                                 |
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

   long lastTs = JsonGetLong(resp, "lastTs");
   if(lastTs > 0)
   {
      // Symbole connu : on comble le trou depuis la dernière bougie en base.
      g_threshold = (datetime)lastTs;
   }
   else
   {
      // Symbole inconnu (ou sans bougie) : les InpHistoryBars dernières clôturées.
      // Barre 0 = en formation → les clôturées vont de l'index 1 à InpHistoryBars.
      datetime t = iTime(_Symbol, PERIOD_M1, InpHistoryBars + 1);
      g_threshold = (t > 0 ? t : 0);   // moins de barres dispo → tout l'historique
   }

   g_synced = true;
   PrintFormat("GrapherFeeder: synchronisé — envoi des bougies après %s",
               TimeToString(g_threshold, TIME_DATE|TIME_MINUTES));

   // Seul cas où un trou est réellement incomblable : l'historique M1 du
   // broker ne remonte pas jusqu'à la dernière bougie connue du serveur.
   datetime serverFirst = (datetime)SeriesInfoInteger(_Symbol, PERIOD_M1, SERIES_SERVER_FIRSTDATE);
   if(g_threshold > 0 && serverFirst > 0 && serverFirst > g_threshold + 60)
      PrintFormat("GrapherFeeder: ATTENTION — le broker n'a pas d'historique M1 avant %s ; "
                  "le trou entre %s et cette date ne peut pas être comblé depuis MT5",
                  TimeToString(serverFirst, TIME_DATE|TIME_MINUTES),
                  TimeToString(g_threshold, TIME_DATE|TIME_MINUTES));
   return true;
}

//+------------------------------------------------------------------+
//| Envoie toutes les bougies clôturées situées après g_threshold.   |
//| Sert au backfill initial comme au flux bougie par bougie.        |
//+------------------------------------------------------------------+
void PushNewBars()
{
   datetime lastClosed = iTime(_Symbol, PERIOD_M1, 1);  // dernière bougie clôturée
   if(lastClosed <= 0 || lastClosed <= g_threshold)
      return;                                            // rien de nouveau

   MqlRates rates[];
   int n = CopyRates(_Symbol, PERIOD_M1, g_threshold + 1, lastClosed, rates);
   if(n <= 0)
      return;   // historique pas encore téléchargé par le terminal — on retentera

   // Envoi par lots (ordre chronologique : rates[0] = la plus ancienne)
   int i = 0;
   while(i < n)
   {
      int count = MathMin(InpChunkSize, n - i);
      string resp;
      int status = HttpPost("/api/live/bars", BuildBarsJson(rates, i, count), resp);
      if(status != 200)
      {
         PrintFormat("GrapherFeeder: envoi échoué (HTTP %d) — rattrapage au prochain cycle", status);
         return;   // curseur inchangé → ces bougies seront renvoyées
      }
      long ack = JsonGetLong(resp, "lastTs");
      g_threshold = (ack > 0 ? (datetime)ack : rates[i + count - 1].time);
      i += count;
   }
}

//+------------------------------------------------------------------+
//| JSON { symbol, bars: [[t,o,h,l,c,tickVol,realVol,spread], …] }   |
//+------------------------------------------------------------------+
string BuildBarsJson(const MqlRates &r[], const int start, const int count)
{
   string bars = "";
   for(int k = 0; k < count; k++)
   {
      if(k > 0) bars += ",";
      bars += "[" + (string)(long)r[start + k].time
            + "," + DoubleToString(r[start + k].open,  _Digits)
            + "," + DoubleToString(r[start + k].high,  _Digits)
            + "," + DoubleToString(r[start + k].low,   _Digits)
            + "," + DoubleToString(r[start + k].close, _Digits)
            + "," + (string)r[start + k].tick_volume
            + "," + (string)r[start + k].real_volume
            + "," + (string)r[start + k].spread + "]";
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
//+------------------------------------------------------------------+
