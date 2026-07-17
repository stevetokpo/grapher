//+------------------------------------------------------------------+
//|                                                      rFVG-EA.mq5 |
//|        rFVG / aFVG — Expert Advisor « positions »                |
//|                                                                  |
//|  Portage fidèle de calcRFVGPositions() (lib/patterns.js) de la   |
//|  plateforme Grapher : le mode « position prise » du pattern.     |
//|                                                                  |
//|  LOGIQUE — une PRÉ-ENTRÉE est posée à la clôture de la 3e bougie |
//|  du motif, à SON prix de clôture : achat sur zone haussière,     |
//|  vente sur zone baissière. L'entrée n'est PRISE que si le prix   |
//|  revient toucher le niveau (achat par en dessous, vente par      |
//|  au-dessus).                                                     |
//|                                                                  |
//|  TOUT EST VIRTUEL, TOUT EST TICK PAR TICK — aucun ordre limite,  |
//|  aucun stop ni target n'est envoyé au broker. L'EA garde ses     |
//|  niveaux en mémoire et surveille chaque tick :                   |
//|    • niveau d'entrée touché  → ordre AU MARCHÉ                   |
//|    • SL virtuel touché       → clôture AU MARCHÉ (le SL est jugé |
//|      AVANT le TP à chaque tick — le pessimisme de la plateforme) |
//|    • TP virtuel touché       → clôture AU MARCHÉ                 |
//|  Côté broker il n'existe que des positions nues. CONSÉQUENCE À   |
//|  ASSUMER : si le terminal ou l'EA s'arrête, plus rien ne protège |
//|  les positions ouvertes.                                         |
//|                                                                  |
//|  L'EXPIRATION ne concerne que la pré-entrée : non déclenchée     |
//|  dans les `expiry` barres (comptées à droite de la bougie        |
//|  CENTRALE — la longueur de la zone), elle meurt avec la zone.    |
//|  Une fois l'entrée prise, plus d'horloge : la position court     |
//|  jusqu'à son SL ou TP virtuel. Pas de break-even.                |
//|                                                                  |
//|  DÉTECTION — via iCustom sur l'indicateur rFVG.mq5 (à compiler   |
//|  d'abord). À l'ouverture d'une bougie, le dernier motif confirmé |
//|  a sa centrale au shift 2 : buffer 1 (side ±1), buffer 4         |
//|  (rFVG=1 / aFVG=0). Aucun lookahead.                             |
//|                                                                  |
//|  DASHBOARD — stats en haut à droite du graphique, dans l'esprit  |
//|  du moniteur rFVG de la plateforme : signaux, en attente, en     |
//|  position, TP/SL/manqués, winrate, points nets + flottant.       |
//|                                                                  |
//|  RÈGLE DE CALIBRAGE — optionnelle : deux lignes à ± un           |
//|  intervalle du prix en temps réel + panneau de conversion        |
//|  (points MT5, × ATR, % de spread) pour régler SL/TP sans         |
//|  tâtonner d'un symbole à l'autre.                                |
//|                                                                  |
//|  RAPPORT — à la décharge de l'EA (fin de backtest incluse), un   |
//|  fichier rfvg-rapport-*.json est écrit dans MQL5/Files : récap   |
//|  et, par position, fillTime/fillPrice, barsToFill, barsHeld,     |
//|  MFE/MAE plafonnés au TP/SL (maxPullupPts / maxDrawdownPts).     |
//|                                                                  |
//|  NOTE COMPTE — chaque motif vit sa vie : plusieurs positions     |
//|  peuvent coexister, comme la simulation de la plateforme →       |
//|  compte HEDGING requis.                                          |
//+------------------------------------------------------------------+
#property copyright   "Grapher — portage de lib/patterns.js (calcRFVGPositions)"
#property version     "2.00"
#property description "rFVG / aFVG en mode positions : pré-entrée, SL et TP entièrement"
#property description "virtuels, surveillés tick par tick et exécutés au marché."

#include <Trade\Trade.mqh>

//--- énumérations de l'indicateur (mêmes valeurs, requises par iCustom)
enum ENUM_RFVG_MODE
  {
   RFVG_ONLY = 0, // Seuls les rFVG
   RFVG_ALL  = 1  // Toutes (aFVG)
  };
enum ENUM_RFVG_DIR
  {
   DIR_BOTH = 0,  // Les deux sens
   DIR_BULL = 1,  // Haussiers seulement
   DIR_BEAR = 2   // Baissiers seulement
  };
enum ENUM_RFVG_SIZE
  {
   SIZE_RANGE = 0, // Amplitude (haut-bas)
   SIZE_BODY  = 1  // Corps (|clôture-ouverture|)
  };
enum ENUM_RFVG_UNIT
  {
   UNIT_PRICE = 0, // Unités de prix (comme la plateforme)
   UNIT_POINT = 1  // Points MT5 (× _Point)
  };

//--- inputs
input group "Détection (mêmes réglages que l'indicateur)"
input string         InpIndicator = "rFVG";      // Nom de l'indicateur compilé (dossier Indicators)
input ENUM_RFVG_MODE InpMode      = RFVG_ONLY;   // Motifs retenus
input ENUM_RFVG_DIR  InpDirection = DIR_BOTH;    // Direction
input int            InpMaPeriod  = 50;          // MM simple — période
input ENUM_RFVG_SIZE InpSizeMode  = SIZE_RANGE;  // Mesure de la taille de la centrale
input int            InpAtrPeriod = 14;          // ATR — période
input double         InpAtrMult   = 1.5;         // Taille centrale >= ATR × (0 = filtre off)
input double         InpMinGap    = 0.0;         // Gap minimum (unités de prix, 0 = tous)

input group "Position (niveaux virtuels, gérés tick par tick)"
input ENUM_RFVG_UNIT InpUnit   = UNIT_PRICE;     // Unité du SL et du TP
input double         InpSl     = 10.0;           // SL — distance sous/sur l'entrée
input double         InpTp     = 10.0;           // TP — distance sur/sous l'entrée
input int            InpExpiry = 20;             // Vie de la pré-entrée (barres après la centrale)
input double         InpLots   = 0.10;           // Volume
input int            InpMaxOpen = 0;             // Pré-entrées+positions simultanées max (0 = illimité)

input group "Affichage"
input bool           InpDashboard = true;        // Dashboard des stats sur le graphique
input bool           InpRulerOn   = false;       // Règle de distance en temps réel
input double         InpRulerPts  = 10.0;        // Intervalle de la règle (même unité que SL/TP)

input group "Divers"
input long           InpMagic  = 20260717;       // Magic number
input int            InpSlippagePts = 20;        // Déviation max (points MT5)

//--- suivi des positions, dans la forme du rapport de la plateforme
struct SRec
  {
   int      id;
   int      dir;           // +1 achat / -1 vente
   string   label;         // "rFVG" | "aFVG"
   long     posId;         // POSITION_ID une fois l'entrée prise, 0 avant
   datetime centralTime;   // bougie centrale — l'horloge d'expiration part d'elle
   datetime confTime;      // 3e bougie (confirmation) — entryTime du rapport
   double   entry;         // niveau de pré-entrée : clôture de la 3e bougie
   double   slLevel;       // niveaux virtuels, ancrés sur le NIVEAU d'entrée
   double   tpLevel;
   double   slDist;        // distances en unités de prix (plafonds MFE/MAE)
   double   tpDist;
   datetime fillTime;
   double   fillPrice;     // prix RÉEL de l'ordre au marché
   int      barsToFill;    // -1 = jamais déclenchée
   datetime exitTime;
   double   exitPrice;     // prix RÉEL de la clôture
   string   exitReason;    // "tp" | "sl" | "manual" | "stopout" | "missed" | "" (en vie)
   int      barsHeld;      // -1 tant que la position vit
   double   mfe;           // maxPullupPts   (unités de prix, plafonné au TP)
   double   mae;           // maxDrawdownPts (unités de prix, plafonné au SL)
   bool     done;          // plus rien à suivre
  };

CTrade   g_trade;
int      g_hInd = INVALID_HANDLE;
int      g_hAtr = INVALID_HANDLE;    // ATR d'affichage (règle) — la détection garde le sien
datetime g_lastBar = 0;
SRec     g_recs[];
int      g_nextId = 1;
bool     g_visual = true;            // faux en optimisation / testeur non visuel
bool     g_boot   = false;           // adoption + backfill faits une fois les données prêtes

const string RPREFIX = "rFVGEA#";    // préfixe de tous les objets de l'EA

//+------------------------------------------------------------------+
int OnInit()
  {
   // L'indicateur est la seule source de détection : mêmes inputs, dans
   // l'ordre exact de rFVG.mq5. extLen = vie de la pré-entrée pour que les
   // boîtes (testeur visuel) montrent exactement la fenêtre de déclenchement.
   g_hInd = iCustom(_Symbol, _Period, InpIndicator,
                    InpMode, InpDirection, InpMaPeriod, InpSizeMode,
                    InpAtrPeriod, InpAtrMult, InpMinGap,
                    InpExpiry,                    // extLen
                    true,                         // showLabel
                    false,                        // showMa
                    (color)C'38,166,154', (color)C'239,83,80',
                    true,                         // fill
                    0,                            // historyBars (0 = tout)
                    false);                       // alerts
   if(g_hInd == INVALID_HANDLE)
     {
      Print("rFVG-EA : impossible de charger l'indicateur « ", InpIndicator,
            " » — compiler mql5/rFVG.mq5 dans MQL5/Indicators d'abord.");
      return INIT_FAILED;
     }

   if(!(InpSl > 0) || !(InpTp > 0))
     {
      Print("rFVG-EA : SL et TP doivent être strictement positifs.");
      return INIT_PARAMETERS_INCORRECT;
     }

   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE)
      != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      Print("rFVG-EA : compte NETTING détecté — les positions simultanées se ",
            "cumulent au lieu de vivre indépendamment ; le rapport perd son sens.");

   g_trade.SetExpertMagicNumber((ulong)InpMagic);
   g_trade.SetDeviationInPoints(InpSlippagePts);

   g_visual = !MQLInfoInteger(MQL_OPTIMIZATION)
           && (!MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_VISUAL_MODE));

   if(InpRulerOn && g_visual)
      g_hAtr = iATR(_Symbol, _Period, InpAtrPeriod);

   // L'affichage ne dépend pas des ticks : un timer le fait vivre même
   // marché fermé, et il est dessiné dès l'attache.
   if(g_visual)
     {
      EventSetTimer(1);
      UpdateDisplays();
     }

   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   Boot();
   UpdateDisplays();
  }

//+------------------------------------------------------------------+
//| Amorçage, une seule fois, dès que l'indicateur a calculé :       |
//|  • réadopter les positions ouvertes par cet EA avant un          |
//|    redémarrage (sinon elles restent nues, sans SL/TP virtuel) ;  |
//|  • réarmer les zones confirmées AVANT l'attache mais encore      |
//|    dans leur fenêtre de déclenchement.                           |
//+------------------------------------------------------------------+
void Boot()
  {
   if(g_boot)
      return;
   if(BarsCalculated(g_hInd) <= 0)
      return;                        // l'indicateur n'a pas encore ses données
   AdoptOrphans();
   Backfill();
   g_boot = true;
  }

//+------------------------------------------------------------------+
//| Après un redémarrage ou une recompilation, la mémoire de l'EA    |
//| est vide : les positions qu'il avait ouvertes (magic) n'ont plus |
//| de SL/TP virtuels. Elles sont réadoptées ici, niveaux réancrés   |
//| sur leur prix d'ouverture réel — mieux que de les laisser nues.  |
//+------------------------------------------------------------------+
void AdoptOrphans()
  {
   for(int p = PositionsTotal() - 1; p >= 0; p--)
     {
      if(PositionGetTicket(p) == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;

      const long posId = PositionGetInteger(POSITION_IDENTIFIER);
      bool known = false;
      for(int i = 0; i < ArraySize(g_recs) && !known; i++)
         known = (g_recs[i].posId == posId);
      if(known)
         continue;

      const bool   isBuy = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE)
                           == POSITION_TYPE_BUY;
      const double fill  = PositionGetDouble(POSITION_PRICE_OPEN);
      const string cmt   = PositionGetString(POSITION_COMMENT);

      const int k = ArraySize(g_recs);
      ArrayResize(g_recs, k + 1);
      g_recs[k].id          = g_nextId++;
      g_recs[k].dir         = isBuy ? 1 : -1;
      g_recs[k].label       = StringFind(cmt, "aFVG") >= 0 ? "aFVG" : "rFVG";
      g_recs[k].posId       = posId;
      g_recs[k].centralTime = 0;
      g_recs[k].confTime    = 0;
      g_recs[k].entry       = fill;
      g_recs[k].slDist      = SlDist();
      g_recs[k].tpDist      = TpDist();
      g_recs[k].slLevel     = NormalizeDouble(isBuy ? fill - SlDist() : fill + SlDist(), _Digits);
      g_recs[k].tpLevel     = NormalizeDouble(isBuy ? fill + TpDist() : fill - TpDist(), _Digits);
      g_recs[k].fillTime    = (datetime)PositionGetInteger(POSITION_TIME);
      g_recs[k].fillPrice   = fill;
      g_recs[k].barsToFill  = -1;
      g_recs[k].exitTime    = 0;
      g_recs[k].exitPrice   = 0;
      g_recs[k].exitReason  = "";
      g_recs[k].barsHeld    = -1;
      g_recs[k].mfe         = 0;
      g_recs[k].mae         = 0;
      g_recs[k].done        = false;

      Print("rFVG-EA : position orpheline #", posId, " réadoptée (",
            isBuy ? "BUY" : "SELL", " @ ", DoubleToString(fill, _Digits),
            ") — SL/TP virtuels réancrés sur le prix d'ouverture.");
     }
  }

//+------------------------------------------------------------------+
//| Zones confirmées avant l'attache mais dont la fenêtre court      |
//| encore (centrale au shift 3..expiry). Réarmées, SAUF si le       |
//| niveau a déjà été touché depuis la confirmation : la simulation  |
//| y serait déjà en position — ce train-là est passé, entrer sur un |
//| second toucher serait un autre trade que celui du pattern.       |
//+------------------------------------------------------------------+
void Backfill()
  {
   for(int s = InpExpiry; s >= 3; s--)      // du plus ancien au plus récent
     {
      double side[1];
      if(CopyBuffer(g_hInd, 1, s, 1, side) != 1 || side[0] == 0.0)
         continue;

      const bool   isBuy = side[0] > 0;
      const double entry = NormalizeDouble(iClose(_Symbol, _Period, s - 1), _Digits);

      bool touched = false;
      for(int j = s - 2; j >= 0 && !touched; j--)   // bougies après la confirmation, bougie courante incluse
         touched = isBuy ? iLow(_Symbol, _Period, j)  <= entry
                         : iHigh(_Symbol, _Period, j) >= entry;
      if(touched)
         continue;

      if(RegisterFromShift(s))
         Print("rFVG-EA : zone d'avant l'attache réarmée (centrale ", s,
               " barres en arrière, niveau ", DoubleToString(entry, _Digits), ").");
     }
  }

//+------------------------------------------------------------------+
void UpdateDisplays()
  {
   if(!g_visual)
      return;
   if(InpRulerOn)   UpdateRuler();
   if(InpDashboard) UpdateDashboard();
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, RPREFIX);
   Comment("");
   WriteReport();
  }

//+------------------------------------------------------------------+
//| Distances SL/TP en unités de prix, selon l'unité choisie.        |
//+------------------------------------------------------------------+
double SlDist() { return InpUnit == UNIT_POINT ? InpSl * _Point : InpSl; }
double TpDist() { return InpUnit == UNIT_POINT ? InpTp * _Point : InpTp; }

//+------------------------------------------------------------------+
//| Pré-entrées + positions encore en vie (pour InpMaxOpen).         |
//+------------------------------------------------------------------+
int AliveCount()
  {
   int n = 0;
   for(int i = 0; i < ArraySize(g_recs); i++)
      if(!g_recs[i].done) n++;
   return n;
  }

//+------------------------------------------------------------------+
//| Le cœur : chaque tick est analysé. Les décisions de POSE de      |
//| pré-entrée restent à l'ouverture de bougie (le motif n'existe    |
//| qu'à la clôture de sa 3e bougie — rien à décider avant) ; tout   |
//| le reste — déclenchement, SL, TP — se joue au tick.              |
//+------------------------------------------------------------------+
void OnTick()
  {
   Boot();                             // adoption + backfill, une seule fois

   // Le bloc de bougie passe AVANT la gestion du tick : une pré-entrée qui
   // expire ne peut pas être déclenchée par le premier tick de la bougie de
   // trop, et une pré-entrée fraîchement armée peut l'être dès ce tick-ci.
   const datetime bt = iTime(_Symbol, _Period, 0);
   if(bt != g_lastBar)
     {
      g_lastBar = bt;
      ExpireStalePendings();           // horloge en barres, jugée à l'ouverture
      CheckSignal();                   // motif confirmé au shift 2 → pré-entrée
     }

   ManageTick();                       // entrées/sorties : à CHAQUE tick

   UpdateDisplays();
  }

//+------------------------------------------------------------------+
//| Surveillance tick par tick des niveaux virtuels.                 |
//|  • Pré-entrée : achat déclenché quand l'ASK revient au niveau    |
//|    (c'est le prix payable), vente quand le BID y monte. Jamais   |
//|    mieux que le marché : l'ordre part au marché à cet instant.   |
//|  • Position : le prix de SORTIE fait foi (bid pour un achat,     |
//|    ask pour une vente). SL jugé AVANT TP à chaque tick — le      |
//|    pessimisme intra-bougie de la plateforme, au tick près.       |
//| Les excursions MFE/MAE sont mesurées sur ces mêmes prix.         |
//+------------------------------------------------------------------+
void ManageTick()
  {
   const double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   const double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(bid <= 0 || ask <= 0)
      return;

   for(int i = 0; i < ArraySize(g_recs); i++)
     {
      if(g_recs[i].done)
         continue;

      // ── Pré-entrée en attente : toucher du niveau → marché ──────────
      if(g_recs[i].posId == 0)
        {
         const bool touch = g_recs[i].dir > 0 ? (ask <= g_recs[i].entry)
                                              : (bid >= g_recs[i].entry);
         if(!touch)
            continue;

         const bool ok = g_recs[i].dir > 0
            ? g_trade.Buy(InpLots, _Symbol, 0, 0, 0, g_recs[i].label)
            : g_trade.Sell(InpLots, _Symbol, 0, 0, 0, g_recs[i].label);
         if(!ok)
           {
            Print("rFVG-EA : entrée #", g_recs[i].id, " refusée (",
                  g_trade.ResultRetcode(), " — ",
                  g_trade.ResultRetcodeDescription(), ") — retentera au tick suivant");
            continue;
           }

         long posId = 0;
         const ulong deal = g_trade.ResultDeal();
         if(deal > 0 && HistoryDealSelect(deal))
            posId = HistoryDealGetInteger(deal, DEAL_POSITION_ID);

         g_recs[i].posId      = posId;
         g_recs[i].fillPrice  = g_trade.ResultPrice();
         g_recs[i].fillTime   = TimeCurrent();
         g_recs[i].barsToFill = iBarShift(_Symbol, _Period, g_recs[i].confTime);
         continue;   // SL/TP jugés à partir du tick suivant
        }

      // ── Position vivante : excursions puis niveaux virtuels ─────────
      const double px  = g_recs[i].dir > 0 ? bid : ask;
      const double fav = g_recs[i].dir > 0 ? px - g_recs[i].entry : g_recs[i].entry - px;
      const double adv = g_recs[i].dir > 0 ? g_recs[i].entry - px : px - g_recs[i].entry;
      if(fav > g_recs[i].mfe) g_recs[i].mfe = fav;
      if(adv > g_recs[i].mae) g_recs[i].mae = adv;

      const bool hitSl = g_recs[i].dir > 0 ? px <= g_recs[i].slLevel
                                           : px >= g_recs[i].slLevel;
      const bool hitTp = g_recs[i].dir > 0 ? px >= g_recs[i].tpLevel
                                           : px <= g_recs[i].tpLevel;
      if(!hitSl && !hitTp)
         continue;

      if(!g_trade.PositionClose((ulong)g_recs[i].posId))
        {
         Print("rFVG-EA : clôture #", g_recs[i].id, " refusée (",
               g_trade.ResultRetcode(), " — ",
               g_trade.ResultRetcodeDescription(), ") — retentera au tick suivant");
         continue;
        }

      g_recs[i].done       = true;
      g_recs[i].exitReason = hitSl ? "sl" : "tp";   // les deux au même tick → le stop gagne
      g_recs[i].exitPrice  = g_trade.ResultPrice();
      g_recs[i].exitTime   = TimeCurrent();
      g_recs[i].barsHeld   = iBarShift(_Symbol, _Period, g_recs[i].fillTime);
      // Plafonds de la plateforme : jamais plus loin que le TP en MFE, que le
      // SL en MAE — avec un stop (même virtuel), on ne compte pas au-delà.
      if(g_recs[i].exitReason == "sl") g_recs[i].mae = g_recs[i].slDist;
      if(g_recs[i].exitReason == "tp") g_recs[i].mfe = g_recs[i].tpDist;
      g_recs[i].mfe = MathMin(g_recs[i].mfe, g_recs[i].tpDist);
      g_recs[i].mae = MathMin(g_recs[i].mae, g_recs[i].slDist);
     }
  }

//+------------------------------------------------------------------+
//| fillLastIdx = centrale + expiry : la pré-entrée non déclenchée   |
//| `expiry` barres après la CENTRALE meurt en même temps que sa     |
//| zone. Compté en barres réelles (iBarShift), pas en horloge.      |
//+------------------------------------------------------------------+
void ExpireStalePendings()
  {
   for(int i = 0; i < ArraySize(g_recs); i++)
     {
      if(g_recs[i].done || g_recs[i].posId != 0)
         continue;
      if(iBarShift(_Symbol, _Period, g_recs[i].centralTime) <= InpExpiry)
         continue;
      g_recs[i].done       = true;
      g_recs[i].exitReason = "missed";
      g_recs[i].exitTime   = TimeCurrent();
      g_recs[i].exitPrice  = g_recs[i].entry;
     }
  }

//+------------------------------------------------------------------+
//| Pré-entrée : motif confirmé au shift 2 → niveau virtuel en       |
//| mémoire, rien n'est envoyé au broker.                            |
//+------------------------------------------------------------------+
void CheckSignal()
  {
   RegisterFromShift(2);
  }

//+------------------------------------------------------------------+
//| Arme la pré-entrée du motif dont la bougie CENTRALE est au shift |
//| donné (sa confirmation est au shift-1). Utilisé par le signal    |
//| courant (shift 2) et par le backfill (shifts 3..expiry).         |
//+------------------------------------------------------------------+
bool RegisterFromShift(const int central)
  {
   double side[1], isr[1];
   if(CopyBuffer(g_hInd, 1, central, 1, side) != 1 || side[0] == 0.0)
      return false;
   if(CopyBuffer(g_hInd, 4, central, 1, isr) != 1)
      isr[0] = 0.0;

   if(InpMaxOpen > 0 && AliveCount() >= InpMaxOpen)
      return false;

   const bool   isBuy = side[0] > 0;
   const double entry = NormalizeDouble(iClose(_Symbol, _Period, central - 1), _Digits);

   const int k = ArraySize(g_recs);
   ArrayResize(g_recs, k + 1);
   g_recs[k].id          = g_nextId++;
   g_recs[k].dir         = isBuy ? 1 : -1;
   g_recs[k].label       = isr[0] > 0 ? "rFVG" : "aFVG";
   g_recs[k].posId       = 0;
   g_recs[k].centralTime = iTime(_Symbol, _Period, central);
   g_recs[k].confTime    = iTime(_Symbol, _Period, central - 1);
   g_recs[k].entry       = entry;
   g_recs[k].slDist      = SlDist();
   g_recs[k].tpDist      = TpDist();
   g_recs[k].slLevel     = NormalizeDouble(isBuy ? entry - SlDist() : entry + SlDist(), _Digits);
   g_recs[k].tpLevel     = NormalizeDouble(isBuy ? entry + TpDist() : entry - TpDist(), _Digits);
   g_recs[k].fillTime    = 0;
   g_recs[k].fillPrice   = 0;
   g_recs[k].barsToFill  = -1;
   g_recs[k].exitTime    = 0;
   g_recs[k].exitPrice   = 0;
   g_recs[k].exitReason  = "";
   g_recs[k].barsHeld    = -1;
   g_recs[k].mfe         = 0;
   g_recs[k].mae         = 0;
   g_recs[k].done        = false;
   return true;
  }

//+------------------------------------------------------------------+
//| Filet de sécurité : une position fermée SANS l'EA (clôture       |
//| manuelle, stop-out du broker) est constatée ici et enregistrée.  |
//| Nos propres clôtures sont marquées `done` avant que l'événement  |
//| n'arrive : elles ne repassent pas par là.                        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest    &request,
                        const MqlTradeResult     &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   if(!HistoryDealSelect(trans.deal))
      return;
   if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT)
      return;

   const long posId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   for(int i = 0; i < ArraySize(g_recs); i++)
     {
      if(g_recs[i].done || g_recs[i].posId != posId)
         continue;
      const ENUM_DEAL_REASON why =
         (ENUM_DEAL_REASON)HistoryDealGetInteger(trans.deal, DEAL_REASON);
      g_recs[i].done       = true;
      g_recs[i].exitReason = (why == DEAL_REASON_SO) ? "stopout" : "manual";
      g_recs[i].exitPrice  = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
      g_recs[i].exitTime   = (datetime)HistoryDealGetInteger(trans.deal, DEAL_TIME);
      g_recs[i].barsHeld   = iBarShift(_Symbol, _Period, g_recs[i].fillTime);
      g_recs[i].mfe = MathMin(g_recs[i].mfe, g_recs[i].tpDist);
      g_recs[i].mae = MathMin(g_recs[i].mae, g_recs[i].slDist);
      break;
     }
  }

//+------------------------------------------------------------------+
//| Ligne horizontale créée ou déplacée (jamais dupliquée).          |
//+------------------------------------------------------------------+
void HLine(const string name, const double price, const color col,
           const ENUM_LINE_STYLE style)
  {
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, name, OBJPROP_COLOR,      col);
      ObjectSetInteger(0, name, OBJPROP_STYLE,      style);
      ObjectSetInteger(0, name, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN,     true);
     }
   else
      ObjectSetDouble(0, name, OBJPROP_PRICE, price);
  }

//+------------------------------------------------------------------+
//| RÈGLE DE CALIBRAGE — matérialise en temps réel ce que vaut un    |
//| intervalle de points sur CE symbole : deux lignes à ± du prix,   |
//| et le panneau traduit tout (points MT5, × ATR, % de spread).     |
//+------------------------------------------------------------------+
void UpdateRuler()
  {
   if(!(InpRulerPts > 0))
      return;

   const double dist = (InpUnit == UNIT_POINT) ? InpRulerPts * _Point : InpRulerPts;
   const double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   const double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(bid <= 0)
      return;

   HLine(RPREFIX + "mid", bid,        clrGray,       STYLE_DOT);
   HLine(RPREFIX + "up",  bid + dist, clrDarkOrange, STYLE_SOLID);
   HLine(RPREFIX + "dn",  bid - dist, clrDarkOrange, STYLE_SOLID);

   double atr = 0, atrBuf[1];
   if(g_hAtr != INVALID_HANDLE && CopyBuffer(g_hAtr, 0, 1, 1, atrBuf) == 1)
      atr = atrBuf[0];

   const double spread = ask - bid;

   string txt = "═══ rFVG — règle de calibrage (" + _Symbol + " " +
                EnumToString(_Period) + ") ═══\n";
   txt += "Intervalle : " + DoubleToString(dist, _Digits) + " (prix)  =  " +
          IntegerToString((long)MathRound(dist / _Point)) + " points MT5";
   if(atr > 0)
      txt += "  =  " + DoubleToString(dist / atr, 2) + " × ATR(" +
             IntegerToString(InpAtrPeriod) + ")";
   txt += "\n";
   if(atr > 0)
      txt += "ATR(" + IntegerToString(InpAtrPeriod) + ")    : " +
             DoubleToString(atr, _Digits) + " (prix)  =  " +
             IntegerToString((long)MathRound(atr / _Point)) + " points MT5\n";
   txt += "Spread     : " + DoubleToString(spread, _Digits) + " (prix)  =  " +
          IntegerToString((long)MathRound(spread / _Point)) + " points MT5  =  " +
          DoubleToString(dist > 0 ? spread / dist * 100.0 : 0, 1) + " % de l'intervalle\n";
   txt += "SL config  : " + DoubleToString(SlDist(), _Digits) + " (prix)  =  " +
          IntegerToString((long)MathRound(SlDist() / _Point)) + " points MT5" +
          (atr > 0 ? "  =  " + DoubleToString(SlDist() / atr, 2) + " × ATR" : "") + "\n";
   txt += "TP config  : " + DoubleToString(TpDist(), _Digits) + " (prix)  =  " +
          IntegerToString((long)MathRound(TpDist() / _Point)) + " points MT5" +
          (atr > 0 ? "  =  " + DoubleToString(TpDist() / atr, 2) + " × ATR" : "");
   Comment(txt);
  }

//+------------------------------------------------------------------+
//| Une ligne du dashboard (créée au besoin, puis seulement mise à   |
//| jour). Coin haut-droit, police monospace, ancrage à droite.      |
//+------------------------------------------------------------------+
void DashLine(const int row, const string text, const color col)
  {
   const string name = RPREFIX + "dash" + IntegerToString(row);
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER,     CORNER_RIGHT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_ANCHOR,     ANCHOR_RIGHT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE,  16);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE,  18 + row * 17);
      ObjectSetString(0,  name, OBJPROP_FONT,       "Consolas");
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE,   9);
      ObjectSetInteger(0, name, OBJPROP_ZORDER,     1);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN,     true);
     }
   ObjectSetString(0,  name, OBJPROP_TEXT,  text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, col);
  }

//+------------------------------------------------------------------+
//| DASHBOARD — le moniteur rFVG de la plateforme, sur le chart :    |
//| signaux, en attente, en position, sorties, winrate, points nets  |
//| (réalisé sur prix réels) et flottant des positions vivantes.     |
//+------------------------------------------------------------------+
void UpdateDashboard()
  {
   // Panneau de fond : rend le dashboard lisible sur fond clair comme sombre.
   const string bg = RPREFIX + "dashbg";
   if(ObjectFind(0, bg) < 0)
     {
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, bg, OBJPROP_CORNER,      CORNER_RIGHT_UPPER);
      ObjectSetInteger(0, bg, OBJPROP_XDISTANCE,   8);
      ObjectSetInteger(0, bg, OBJPROP_YDISTANCE,   10);
      ObjectSetInteger(0, bg, OBJPROP_XSIZE,       300);
      ObjectSetInteger(0, bg, OBJPROP_YSIZE,       140);
      ObjectSetInteger(0, bg, OBJPROP_BGCOLOR,     C'20,24,32');
      ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, bg, OBJPROP_COLOR,       C'70,80,96');
      ObjectSetInteger(0, bg, OBJPROP_ZORDER,      0);
      ObjectSetInteger(0, bg, OBJPROP_SELECTABLE,  false);
      ObjectSetInteger(0, bg, OBJPROP_HIDDEN,      true);
     }

   int nPend = 0, nLive = 0, nTp = 0, nSl = 0, nMissed = 0, nOther = 0;
   int nR = 0, nA = 0;
   double netPts = 0, floatPts = 0;

   const double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   const double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   const int total = ArraySize(g_recs);
   for(int i = 0; i < total; i++)
     {
      if(g_recs[i].label == "rFVG") nR++; else nA++;

      if(!g_recs[i].done)
        {
         if(g_recs[i].posId == 0)
            nPend++;
         else
           {
            nLive++;
            const double px = g_recs[i].dir > 0 ? bid : ask;
            floatPts += g_recs[i].dir > 0 ? px - g_recs[i].fillPrice
                                          : g_recs[i].fillPrice - px;
           }
         continue;
        }

      if(g_recs[i].exitReason == "tp")          nTp++;
      else if(g_recs[i].exitReason == "sl")     nSl++;
      else if(g_recs[i].exitReason == "missed") nMissed++;
      else                                      nOther++;   // manual / stopout

      if(g_recs[i].exitReason != "missed" && g_recs[i].fillPrice > 0)
         netPts += g_recs[i].dir > 0 ? g_recs[i].exitPrice - g_recs[i].fillPrice
                                     : g_recs[i].fillPrice - g_recs[i].exitPrice;
     }

   const int    settled = nTp + nSl;
   const double winrate = settled > 0 ? 100.0 * nTp / settled : 0.0;

   DashLine(0, "rFVG — POSITIONS (" + _Symbol + ")", clrGold);
   DashLine(1, StringFormat("Signaux    : %d  (rFVG %d / aFVG %d)", total, nR, nA), clrSilver);
   DashLine(2, StringFormat("En attente : %d    En position : %d", nPend, nLive), clrSilver);
   DashLine(3, StringFormat("TP %d   SL %d   Manques %d   Autres %d", nTp, nSl, nMissed, nOther),
            clrSilver);
   DashLine(4, settled > 0
               ? StringFormat("Winrate    : %.1f %%  (%d soldees)", winrate, settled)
               : "Winrate    : —", clrSilver);
   DashLine(5, "Realise    : " + (netPts >= 0 ? "+" : "") +
               DoubleToString(netPts, _Digits) + " (prix)",
            netPts >= 0 ? clrLimeGreen : clrTomato);
   DashLine(6, "Flottant   : " + (floatPts >= 0 ? "+" : "") +
               DoubleToString(floatPts, _Digits) + " (prix)",
            floatPts >= 0 ? clrLimeGreen : clrTomato);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Rapport JSON — même esprit que downloadRfvgReport() de la        |
//| plateforme : récap + une entrée par position avec excursions.    |
//+------------------------------------------------------------------+
string JsonTime(const datetime t)
  {
   if(t == 0) return "null";
   return "\"" + TimeToString(t, TIME_DATE | TIME_MINUTES | TIME_SECONDS) + "\"";
  }

void WriteReport()
  {
   const int total = ArraySize(g_recs);
   if(total == 0)
      return;

   int nTp = 0, nSl = 0, nMissed = 0, nOther = 0, nLive = 0, nPend = 0;
   for(int i = 0; i < total; i++)
     {
      if(!g_recs[i].done) { if(g_recs[i].posId == 0) nPend++; else nLive++; continue; }
      if(g_recs[i].exitReason == "tp")          nTp++;
      else if(g_recs[i].exitReason == "sl")     nSl++;
      else if(g_recs[i].exitReason == "missed") nMissed++;
      else                                      nOther++;
     }

   string name = StringFormat("rfvg-rapport-%s-%s.json", _Symbol,
                              TimeToString(TimeCurrent(), TIME_DATE));
   StringReplace(name, ".", "-");
   StringReplace(name, "-json", ".json");

   const int fh = FileOpen(name, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(fh == INVALID_HANDLE)
     {
      Print("rFVG-EA : écriture du rapport impossible (", GetLastError(), ")");
      return;
     }

   FileWriteString(fh, "{\n");
   FileWriteString(fh, "  \"pattern\": \"rFVG — positions (pré-entrée, SL et TP virtuels gérés tick par tick)\",\n");
   FileWriteString(fh, StringFormat("  \"symbol\": \"%s\",\n  \"timeframe\": \"%s\",\n",
                                    _Symbol, EnumToString(_Period)));
   FileWriteString(fh, StringFormat(
      "  \"params\": { \"mode\": \"%s\", \"direction\": \"%s\", \"maPeriod\": %d, \"atrPeriod\": %d, \"atrMult\": %s, \"sizeMode\": \"%s\", \"minGap\": %s, \"expiry\": %d, \"sl\": %s, \"tp\": %s, \"unit\": \"%s\", \"lots\": %s },\n",
      InpMode == RFVG_ONLY ? "rfvg" : "all",
      InpDirection == DIR_BOTH ? "both" : (InpDirection == DIR_BULL ? "bull" : "bear"),
      InpMaPeriod, InpAtrPeriod, DoubleToString(InpAtrMult, 2),
      InpSizeMode == SIZE_RANGE ? "range" : "body",
      DoubleToString(InpMinGap, _Digits), InpExpiry,
      DoubleToString(InpSl, 2), DoubleToString(InpTp, 2),
      InpUnit == UNIT_PRICE ? "price" : "point",
      DoubleToString(InpLots, 2)));
   FileWriteString(fh, StringFormat(
      "  \"recap\": { \"total\": %d, \"tp\": %d, \"sl\": %d, \"missed\": %d, \"autres\": %d, \"open\": %d, \"pending\": %d },\n",
      total, nTp, nSl, nMissed, nOther, nLive, nPend));

   const double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   const double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   FileWriteString(fh, "  \"trades\": [\n");
   for(int i = 0; i < total; i++)
     {
      const bool filled = (g_recs[i].posId != 0);
      double pts = 0;
      if(filled && g_recs[i].done && g_recs[i].exitReason != "missed")
         pts = g_recs[i].dir > 0 ? g_recs[i].exitPrice - g_recs[i].fillPrice
                                 : g_recs[i].fillPrice - g_recs[i].exitPrice;
      else if(filled && !g_recs[i].done)   // encore en vie : flottant au dernier tick
         pts = g_recs[i].dir > 0 ? bid - g_recs[i].fillPrice
                                 : g_recs[i].fillPrice - ask;

      string reason = g_recs[i].exitReason;
      if(reason == "")
         reason = filled ? "open" : "pending";

      FileWriteString(fh, StringFormat(
         "    { \"id\": %d, \"direction\": \"%s\", \"label\": \"%s\", \"entryTime\": %s, \"entryLevel\": %s, "
         "\"fillTime\": %s, \"fillPrice\": %s, \"barsToFill\": %s, \"exitTime\": %s, \"exitPrice\": %s, "
         "\"exitReason\": \"%s\", \"barsHeld\": %s, \"profitPoints\": %s, \"maxPullupPts\": %s, \"maxDrawdownPts\": %s }%s\n",
         g_recs[i].id,
         g_recs[i].dir > 0 ? "BUY" : "SELL",
         g_recs[i].label,
         JsonTime(g_recs[i].confTime),
         DoubleToString(g_recs[i].entry, _Digits),
         JsonTime(g_recs[i].fillTime),
         filled ? DoubleToString(g_recs[i].fillPrice, _Digits) : "null",
         g_recs[i].barsToFill < 0 ? "null" : IntegerToString(g_recs[i].barsToFill),
         JsonTime(g_recs[i].exitTime),
         g_recs[i].done && g_recs[i].exitReason != "missed"
            ? DoubleToString(g_recs[i].exitPrice, _Digits) : "null",
         reason,
         g_recs[i].barsHeld < 0 ? "null" : IntegerToString(g_recs[i].barsHeld),
         DoubleToString(pts, _Digits),
         filled ? DoubleToString(MathMin(g_recs[i].mfe, g_recs[i].tpDist), _Digits) : "null",
         filled ? DoubleToString(MathMin(g_recs[i].mae, g_recs[i].slDist), _Digits) : "null",
         i < total - 1 ? "," : ""));
     }
   FileWriteString(fh, "  ]\n}\n");
   FileClose(fh);

   Print("rFVG-EA : rapport écrit — ", name, " (", total, " positions : ",
         nTp, " tp, ", nSl, " sl, ", nMissed, " manquées, ",
         nLive + nPend, " en vie)");
  }
//+------------------------------------------------------------------+
