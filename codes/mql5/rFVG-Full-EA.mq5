//+------------------------------------------------------------------+
//|                                                  rFVG-Full-EA.mq5 |
//|   Expert Advisor rFVG COMPLET — machine à états, 100 % au marché  |
//|                                                                  |
//|  AUTONOME : la détection est DANS l'EA (aucun iCustom), portage  |
//|  fidèle et À JOUR de calcRFVG() — lib/patterns.js. Les TROIS      |
//|  modes sont là (rFVG · aFVG · superFVG), avec tous les filtres   |
//|  de la plateforme, y compris ceux que superFVG-EA ignorait :     |
//|  petitesse de la 3e bougie et mèche de rejet.                    |
//|                                                                  |
//|  La GESTION DES TRADES est celle de superFVG-EA, inchangée :     |
//|  aucun ordre en attente, aucun SL/TP côté broker. Tout est géré  |
//|  au tick : l'EA ouvre au marché, surveille, ferme au marché.     |
//|                                                                  |
//|  ── LE MOTIF (3 bougies : B1 précédente, B2 centrale, B3 suivante)|
//|  B2 est directionnelle et LARGE : sa taille (corps ou amplitude)  |
//|  vaut au moins x × ATR, l'ATR étant lu sur B1 — AVANT elle, sinon |
//|  il contiendrait déjà la bougie à qualifier.                     |
//|  B1 et B3 définissent deux niveaux dont l'écart SIGNÉ est le gap :|
//|    • baissier : gap = bas(B1) − haut(B3)                         |
//|    • haussier : gap = bas(B3) − haut(B1)                         |
//|    gap > 0 → vide entre les bougies · gap < 0 → chevauchement,    |
//|    la zone devient leur bande commune. « Gap minimum » est SIGNÉ  |
//|    et décide seul : 0 = vide strict · négatif = chevauchement     |
//|    toléré. Un gap nul est rejeté (zone plate).                   |
//|                                                                  |
//|  ── LES TROIS MODES ne diffèrent que par la position de B2 vs les |
//|  DEUX MM (rapide + lente), plus le sens de B3 :                  |
//|    • rFVG  — RETOURNEMENT : B2 entièrement à contre-courant de    |
//|      son sens, sans toucher NI l'une NI l'autre des MM :         |
//|        baissière → son PLUS BAS est au-dessus des DEUX MM        |
//|        haussière → son PLUS HAUT est en dessous des DEUX MM      |
//|    • aFVG  — les MM ne filtrent plus rien, tout motif de base     |
//|      compte (aFVG ⊇ rFVG). Chaque signal garde l'étiquette de ce  |
//|      qu'il est vraiment : rFVG s'il respecte aussi les MM.       |
//|    • super — sous-ensemble des rFVG dont B3 clôture à CONTRE-SENS |
//|      du motif (motif baissier → B3 haussière). Double réfutation. |
//|                                                                  |
//|  ── DEUX FILTRES OPTIONNELS SUR B3, la bougie de pré-entrée       |
//|    • petitesse : son CORPS |clôture−ouverture| <= x × ATR, l'ATR  |
//|      étant lu sur la CENTRALE (la bougie qui précède B3). Le      |
//|      corps toujours, même en mesure « amplitude ». 0 = off.      |
//|    • mèche de rejet : sa mèche du côté d'où vient le motif doit   |
//|      dépasser son corps — mèche BASSE > corps si le motif est     |
//|      haussier, mèche HAUTE > corps s'il est baissier. Avec le     |
//|      filtre ci-dessus, ça exige un marteau ou une étoile filante. |
//|                                                                  |
//|  ── ATR : celui de WILDER (RMA des true ranges), recalculé ici à  |
//|  la main. Ce n'est PAS iATR : en MT5, iATR est une moyenne SIMPLE |
//|  des true ranges. Sans ce calcul, le seuil « taille >= x × ATR »  |
//|  ne déclenche pas aux mêmes bougies que la plateforme.           |
//|                                                                  |
//|  ── LA MACHINE À ÉTATS                                            |
//|  RECHERCHE — à chaque nouvelle bougie, B3 vient de clore (shift 1)|
//|    et le motif est jugé. S'il passe → ENTRÉE MARCHÉ immédiate à   |
//|    l'ouverture de B4 (le tick même de la nouvelle bougie), dans   |
//|    le SENS DU MOTIF (motif haussier → BUY).                      |
//|  POSITION / SL EN ATTENTE — pendant toute B4 le stop n'existe     |
//|    pas encore : on ne connaît son niveau qu'à la clôture de B4.   |
//|    Seul le TP est actif. C'est voulu, mais c'est une fenêtre      |
//|    d'exposition non protégée : la taille de B4 fait le risque.   |
//|  POSITION / SL ARMÉ — à la clôture de B4 :                        |
//|    BUY  → SL = min(bas B3, bas B4)   − marge                     |
//|    SELL → SL = max(haut B3, haut B4) + marge                     |
//|    Le prix n'a plus le droit de repartir derrière ce niveau.     |
//|  Tant qu'une position vit, l'état est OCCUPÉ : tout nouveau       |
//|  signal est ignoré, dans le sens comme à contre-sens.            |
//|                                                                  |
//|  SORTIES — surveillées au tick, stop testé AVANT le TP :          |
//|    BUY  jugé au Bid (on sort en vendant) · SELL jugé à l'Ask.    |
//|  TP en POINTS depuis l'entrée. Lot = multiplicateur × lot minimal.|
//|                                                                  |
//|  SIZER — règle visuelle : matérialise N points depuis le prix     |
//|  courant, convertis en prix, en devise et en ATR, pour calibrer   |
//|  un TP d'un symbole à l'autre.                                    |
//+------------------------------------------------------------------+
#property copyright   "Grapher — EA rFVG complet (machine à états, tick-by-tick)"
#property version     "1.00"
#property description "rFVG / aFVG / superFVG — détection intégrée à jour,"
#property description "entrée à l'ouverture de B4, SL posé à la clôture de B4"
#property description "sous/sur les extrêmes B3-B4, TP en points."
#property description "Une seule position à la fois, tout au marché."

#include <Trade/Trade.mqh>

//--- énumérations (mêmes valeurs que l'indicateur rFVG.mq5)
enum ENUM_FV_MODE
  {
   FV_RFVG  = 0, // rFVG — retournements seuls
   FV_ALL   = 1, // aFVG — toutes (étiquetées rFVG / aFVG)
   FV_SUPER = 2  // superFVG — 3e bougie à contre-sens
  };
enum ENUM_FV_DIR
  {
   FV_BOTH = 0,  // Les deux sens
   FV_BULL = 1,  // Haussiers seulement (BUY)
   FV_BEAR = 2   // Baissiers seulement (SELL)
  };
enum ENUM_FV_SIZE
  {
   FV_RANGE = 0, // Amplitude (haut-bas)
   FV_BODY  = 1  // Corps (|clôture-ouverture|)
  };
enum ENUM_FV_SIZER
  {
   SIZER_UP   = 0, // Vers le haut (TP d'un BUY)
   SIZER_DOWN = 1  // Vers le bas (TP d'un SELL)
  };

//======================= INPUTS ====================================
input group "Détection (portage de calcRFVG — lib/patterns.js)"
input ENUM_FV_MODE InpMode        = FV_RFVG;   // Motifs retenus
input ENUM_FV_DIR  InpDirection   = FV_BOTH;   // Direction tradée
input int          InpMaFast      = 15;        // MM rapide — période
input int          InpMaSlow      = 200;       // MM lente — période
input ENUM_FV_SIZE InpSizeMode    = FV_RANGE;  // Mesure de la taille de la centrale
input int          InpAtrPeriod   = 14;        // ATR — période (Wilder)
input double       InpAtrMult     = 1.5;       // Taille centrale >= ATR × (0 = filtre off)
input double       InpAtrMult3    = 0.0;       // Corps 3e bougie <= ATR × (0 = filtre off)
input bool         InpWick3       = false;     // Mèche de rejet exigée sur la 3e bougie
input double       InpMinGapPts   = 0.0;       // Gap minimum (POINTS, SIGNÉ : <0 = chevauchement toléré)

input group "Position (distances en POINTS)"
input double InpTPPoints       = 500;          // TP — distance depuis l'entrée (points)
input double InpSLMarginPoints = 20;           // SL — marge sous/sur l'extrême B3-B4 (points)

input group "Trading"
input double InpLotMult   = 1.0;               // Lot = multiplicateur × lot minimal du symbole
input long   InpMagic     = 240726;            // Magic number
input int    InpDeviation = 20;                // Slippage max (points)

input group "Dashboard"
input bool InpShowDash   = true;               // Afficher le tableau de bord
input int  InpDashX      = 12;                 // Position X (px)
input int  InpDashY      = 20;                 // Position Y (px)
input bool InpDrawZones  = true;               // Tracer la zone du motif détecté
input int  InpExtLen     = 20;                 // Zone — extension (bougies)
input bool InpDrawLevels = true;               // Tracer entrée / SL / TP en position

input group "Sizer (règle de calibration)"
input bool          InpSizerOn     = false;    // Afficher le sizer
input ENUM_FV_SIZER InpSizerDir    = SIZER_UP; // Sens mesuré
input double        InpSizerPoints = 500;      // Distance mesurée (points)

//======================= ÉTAT ======================================
CTrade trade;

enum EA_STATE
  {
   ST_SEARCH  = 0,   // libre — on cherche un motif
   ST_POS_RAW = 1,   // en position, B4 en cours, SL pas encore connu
   ST_POS     = 2    // en position, SL armé
  };
EA_STATE g_state = ST_SEARCH;

// dernier motif détecté (mémorisé pour l'affichage)
struct SignalInfo
  {
   bool     valid;
   bool     isBull;
   string   label;                              // "rFVG" | "aFVG" | "superFVG"
   double   top, bottom, gap, size, atr;
   datetime tCentral;
  };
SignalInfo g_sig;

// position en cours
ulong    g_ticket   = 0;
bool     g_posBuy   = false;
double   g_entry    = 0.0, g_sl = 0.0, g_tp = 0.0, g_lot = 0.0;
double   g_b3Low    = 0.0, g_b3High = 0.0;     // extrêmes de la 3e bougie
datetime g_b4Time   = 0;                       // heure d'ouverture de la bougie d'entrée
datetime g_entryTime = 0;

// fenêtre de travail : les N dernières bougies CLOSES, en ordre CHRONOLOGIQUE
// (index 0 = la plus ancienne, g_n-1 = la dernière close). C'est l'indexation
// de lib/patterns.js — la détection en est le portage ligne à ligne.
int      g_n = 0;
double   g_open[], g_high[], g_low[], g_close[];
datetime g_time[];
double   g_maFast[], g_maSlow[], g_atr[];
double g_atrRef = 0.0;                         // ATR sur la dernière bougie close (affichage)

// suivi des bougies
datetime g_lastBar = 0;

// statistiques de session (remises à zéro au rechargement de l'EA)
int    g_nTrades = 0, g_nTP = 0, g_nSL = 0, g_nOther = 0;
double g_sumR = 0.0, g_sumRR = 0.0, g_netProfit = 0.0;
int    g_nR = 0;

// affichage
bool g_forceDraw = true;
uint g_lastDraw  = 0;

const string PFX = "rFVGfull_";

//--- palette
#define COL_BULL   C'38,166,154'
#define COL_BEAR   C'239,83,80'
#define COL_ACC    C'129,140,248'
#define COL_BG     C'18,22,30'
#define COL_BORDER C'55,65,81'
#define COL_DIM    C'120,130,145'

//======================= UTILITAIRES ===============================
double Ask() { return SymbolInfoDouble(_Symbol, SYMBOL_ASK); }
double Bid() { return SymbolInfoDouble(_Symbol, SYMBOL_BID); }

double TPdist()  { return InpTPPoints       * _Point; }
double SLmarge() { return InpSLMarginPoints * _Point; }
double MinGap()  { return InpMinGapPts      * _Point; }

// Valeur d'UN point pour UN lot, dans la devise du compte.
double PointValuePerLot()
  {
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0.0)
      return 0.0;
   return tv * (_Point / ts);
  }

double Money(double points, double lot) { return points * PointValuePerLot() * lot; }

int LotDigits()
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0)
      return 2;
   int d = (int)MathCeil(-MathLog10(step) - 1e-7);
   return (int)MathMax(0, MathMin(8, d));
  }

// Lot effectif : multiplicateur × lot minimal, aligné sur le pas de volume.
double TradeLot()
  {
   double mn   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double mx   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0)
      step = (mn > 0.0 ? mn : 0.01);

   double v = mn * InpLotMult;
   v = MathRound(v / step) * step;
   if(v < mn) v = mn;
   if(mx > 0.0 && v > mx) v = mx;
   return NormalizeDouble(v, 8);
  }

// Retourne le ticket de NOTRE position (magic + symbole), 0 sinon.
ulong FindOurPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         (long)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return tk;
     }
   return 0;
  }

string ModeName()
  {
   switch(InpMode)
     {
      case FV_ALL:   return "aFVG (toutes)";
      case FV_SUPER: return "superFVG";
      default:       return "rFVG";
     }
  }

string DirName()
  {
   switch(InpDirection)
     {
      case FV_BULL: return "haussiers";
      case FV_BEAR: return "baissiers";
      default:      return "deux sens";
     }
  }

//======================= INDICATEURS (calcul maison) ===============
// MM simple sur les clôtures — copie conforme de smaArr() : définie à partir
// de l'index period-1, EMPTY_VALUE avant.
void ComputeSma(const int period, double &dst[])
  {
   ArrayResize(dst, g_n);
   if(period < 1)
     {
      ArrayInitialize(dst, EMPTY_VALUE);
      return;
     }

   double sum = 0.0;
   for(int i = 0; i < g_n; i++)
     {
      sum += g_close[i];
      if(i >= period)
         sum -= g_close[i - period];
      dst[i] = (i >= period - 1) ? sum / period : EMPTY_VALUE;
     }
  }

// ATR de WILDER (RMA des true ranges) — copie conforme de atrArr() : première
// valeur à l'index `period` (moyenne simple des TR), puis lissage récursif.
// Volontairement recalculé ici : l'iATR de MT5 est une moyenne SIMPLE des true
// ranges, pas celle de Wilder — les seuils ne tomberaient pas aux mêmes bougies.
// Le lissage repart du début de la fenêtre : l'écart avec un ATR calculé depuis
// l'origine de l'historique décroît exponentiellement et la fenêtre est prise
// assez longue (30 × période) pour qu'il soit hors de portée du prix.
void ComputeAtr(const int period)
  {
   ArrayResize(g_atr, g_n);
   ArrayInitialize(g_atr, EMPTY_VALUE);
   if(period < 1 || g_n < 2)
      return;

   double sum = 0.0, prev = 0.0;
   for(int i = 1; i < g_n; i++)
     {
      const double tr = MathMax(g_high[i] - g_low[i],
                        MathMax(MathAbs(g_high[i] - g_close[i - 1]),
                                MathAbs(g_low[i]  - g_close[i - 1])));
      if(i <= period)
        {
         sum += tr;
         if(i == period)
           {
            prev     = sum / period;
            g_atr[i] = prev;
           }
        }
      else
        {
         prev     = (prev * (period - 1) + tr) / period;
         g_atr[i] = prev;
        }
     }
  }

// Recharge la fenêtre de travail à partir de la dernière bougie CLOSE (shift 1)
// et recalcule MM + ATR dessus. Appelée une fois par bougie : la bougie en
// formation n'entre jamais dans le motif, donc aucun repaint possible.
bool RefreshWindow()
  {
   const int strictMin = (int)MathMax(InpMaSlow, InpAtrPeriod + 1) + 3;
   const int total     = Bars(_Symbol, _Period);
   if(total - 1 < strictMin)
     {
      g_n = 0;
      return false;
     }

   int want = (int)MathMax(InpMaSlow, InpAtrPeriod * 30) + 10;
   if(want > total - 1)
      want = total - 1;

   MqlRates r[];
   ArraySetAsSeries(r, false);                   // chronologique : r[0] = la plus ancienne
   const int got = CopyRates(_Symbol, _Period, 1, want, r);   // depuis la dernière bougie CLOSE
   if(got < strictMin)
     {
      g_n = 0;
      return false;
     }

   g_n = got;
   ArrayResize(g_open,  g_n);
   ArrayResize(g_high,  g_n);
   ArrayResize(g_low,   g_n);
   ArrayResize(g_close, g_n);
   ArrayResize(g_time,  g_n);
   for(int i = 0; i < g_n; i++)
     {
      g_open[i]  = r[i].open;
      g_high[i]  = r[i].high;
      g_low[i]   = r[i].low;
      g_close[i] = r[i].close;
      g_time[i]  = r[i].time;
     }

   ComputeSma(InpMaFast, g_maFast);
   ComputeSma(InpMaSlow, g_maSlow);
   ComputeAtr(InpAtrPeriod);

   const double a = g_atr[g_n - 1];
   g_atrRef = (a == EMPTY_VALUE) ? 0.0 : a;
   return true;
  }

//======================= INIT / DEINIT =============================
int OnInit()
  {
   if(InpTPPoints <= 0.0)
     {
      Print("rFVG-Full-EA : TP en points doit être > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpMaFast < 1 || InpMaSlow < 1 || InpAtrPeriod < 1 || InpLotMult <= 0.0)
     {
      Print("rFVG-Full-EA : périodes MM/ATR et multiplicateur de lot doivent être > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }

   trade.SetExpertMagicNumber((ulong)InpMagic);
   trade.SetDeviationInPoints((ulong)InpDeviation);
   trade.SetTypeFillingBySymbol(_Symbol);

   g_lastBar   = iTime(_Symbol, _Period, 0);
   g_sig.valid = false;
   g_sig.label = "";

   RefreshWindow();
   AdoptExistingPosition();

   g_forceDraw = true;
   return INIT_SUCCEEDED;
  }

// Redémarrage EA avec une position déjà ouverte : on reconstruit tout à
// partir de son heure d'ouverture — cette bougie EST B4, la précédente B3,
// donc la règle du stop est rejouable à l'identique.
void AdoptExistingPosition()
  {
   ulong tk = FindOurPosition();
   if(tk == 0 || !PositionSelectByTicket(tk))
      return;

   g_ticket  = tk;
   g_posBuy  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   g_entry   = PositionGetDouble(POSITION_PRICE_OPEN);
   g_lot     = PositionGetDouble(POSITION_VOLUME);
   g_entryTime = (datetime)PositionGetInteger(POSITION_TIME);
   g_tp      = g_posBuy ? g_entry + TPdist() : g_entry - TPdist();

   int sh = iBarShift(_Symbol, _Period, g_entryTime);   // bougie d'entrée = B4
   if(sh < 0)
      sh = 0;
   g_b4Time = iTime(_Symbol, _Period, sh);
   g_b3Low  = iLow(_Symbol,  _Period, sh + 1);
   g_b3High = iHigh(_Symbol, _Period, sh + 1);

   if(sh > 0)                                            // B4 est close → stop calculable
     {
      ArmStop(iLow(_Symbol, _Period, sh), iHigh(_Symbol, _Period, sh));
      g_state = ST_POS;
      Print("rFVG-Full-EA : position reprise, SL reconstruit à ", DoubleToString(g_sl, _Digits));
     }
   else
     {
      g_state = ST_POS_RAW;
      Print("rFVG-Full-EA : position reprise, SL en attente de la clôture de B4.");
     }
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, PFX);
   ChartRedraw();
  }

//======================= DÉTECTION =================================
// Appelée à la NOUVELLE bougie, sur la fenêtre déjà rafraîchie : B3 vient de
// clore. En indices de fenêtre — i3 = g_n-1 (B3) · i = g_n-2 (B2, la centrale)
// · i1 = g_n-3 (B1). MM lues sur la centrale (sa clôture est connue quand on la
// juge), ATR de taille lu sur B1, ATR du filtre « 3e petite » lu sur la centrale.
bool DetectFVG(SignalInfo &out)
  {
   out.valid = false;
   out.label = "";
   if(g_n < 3)
      return false;

   const int i3 = g_n - 1;
   const int i  = g_n - 2;
   const int i1 = g_n - 3;

   // MM requises même en mode « toutes » (fidèle à calcRFVG : avg == null → skip).
   const double avgFast = g_maFast[i];
   const double avgSlow = g_maSlow[i];
   if(avgFast == EMPTY_VALUE || avgSlow == EMPTY_VALUE)
      return false;

   // 1) Motif de base : la centrale est directionnelle. Le gap est mesuré plus
   //    bas et filtré par « gap minimum ». Pas de MM ici.
   const bool baseBear = (g_close[i] < g_open[i]);
   const bool baseBull = (g_close[i] > g_open[i]);
   if(!baseBear && !baseBull)
      return false;

   // 2) Retournement : la centrale ENTIÈREMENT du côté opposé à son sens, sans
   //    toucher NI la MM rapide NI la MM lente — les deux à la fois. C'est elle,
   //    et elle seule, qui sépare rFVG de aFVG.
   const bool maBear = (g_low[i]  > avgFast && g_low[i]  > avgSlow);
   const bool maBull = (g_high[i] < avgFast && g_high[i] < avgSlow);

   const bool onlyR = (InpMode != FV_ALL);
   bool isBear = baseBear && (!onlyR || maBear);
   bool isBull = baseBull && (!onlyR || maBull);
   if(!isBear && !isBull)
      return false;

   // 3) Mode super : la 3e bougie clôture à contre-sens du motif.
   if(InpMode == FV_SUPER)
     {
      if(isBear && !(g_close[i3] > g_open[i3])) isBear = false;
      if(isBull && !(g_close[i3] < g_open[i3])) isBull = false;
      if(!isBear && !isBull)
         return false;
     }

   const string lbl = (InpMode == FV_SUPER) ? "superFVG"
                      : ((isBear ? maBear : maBull) ? "rFVG" : "aFVG");

   // 4) Direction tradée.
   if(InpDirection == FV_BULL && !isBull) return false;
   if(InpDirection == FV_BEAR && !isBear) return false;

   // 5) Gap signé entre B1 et B3 : positif = vide, négatif = chevauchement.
   const double hiLvl = isBear ? g_low[i1]  : g_low[i3];
   const double loLvl = isBear ? g_high[i3] : g_high[i1];
   const double gap   = hiLvl - loLvl;
   if(gap == 0.0 || gap < MinGap())
      return false;

   // 6) Taille de la centrale, mesurée contre l'ATR lu AVANT elle.
   const double size   = (InpSizeMode == FV_BODY) ? MathAbs(g_close[i] - g_open[i])
                                                  : (g_high[i] - g_low[i]);
   const double atrRef = g_atr[i1];
   if(InpAtrMult > 0.0)
     {
      if(atrRef == EMPTY_VALUE)
         return false;
      if(size < InpAtrMult * atrRef)
         return false;
     }

   // 7) La 3e bougie doit rester petite : son CORPS <= x × ATR, l'ATR étant lu
   //    sur la centrale — la bougie qui la précède.
   const double body3 = MathAbs(g_close[i3] - g_open[i3]);
   if(InpAtrMult3 > 0.0)
     {
      const double ref3 = g_atr[i];
      if(ref3 == EMPTY_VALUE)
         return false;
      if(body3 > InpAtrMult3 * ref3)
         return false;
     }

   // 8) Mèche de rejet sur la 3e bougie : du côté d'où vient le motif — la mèche
   //    BASSE si le motif est haussier, la HAUTE s'il est baissier.
   if(InpWick3)
     {
      const double wick = isBull ? (MathMin(g_open[i3], g_close[i3]) - g_low[i3])
                                 : (g_high[i3] - MathMax(g_open[i3], g_close[i3]));
      if(!(wick > body3))
         return false;
     }

   out.valid    = true;
   out.isBull   = isBull;
   out.label    = lbl;
   out.top      = (gap > 0.0) ? hiLvl : loLvl;
   out.bottom   = (gap > 0.0) ? loLvl : hiLvl;
   out.gap      = gap;
   out.size     = size;
   out.atr      = (atrRef == EMPTY_VALUE) ? 0.0 : atrRef;
   out.tCentral = g_time[i];        // l'heure vient de la fenêtre, pas d'un iTime relu
   return true;
  }

//======================= ENTRÉE ====================================
// Marché, à l'ouverture de B4 (premier tick de la nouvelle bougie).
void EnterMarket(const SignalInfo &sig)
  {
   const bool   isBuy = sig.isBull;
   const double lot   = TradeLot();

   bool ok = isBuy ? trade.Buy(lot, _Symbol, 0.0, 0.0, 0.0, sig.label)
                   : trade.Sell(lot, _Symbol, 0.0, 0.0, 0.0, sig.label);
   if(!ok)
     {
      Print("rFVG-Full-EA : échec entrée ", (isBuy ? "BUY" : "SELL"),
            " — retcode ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
      return;
     }

   ulong tk = FindOurPosition();
   if(tk == 0 || !PositionSelectByTicket(tk))
     {
      Print("rFVG-Full-EA : position introuvable après l'entrée — vérification au prochain tick.");
      return;
     }

   g_ticket    = tk;
   g_posBuy    = isBuy;
   g_entry     = PositionGetDouble(POSITION_PRICE_OPEN);
   g_lot       = PositionGetDouble(POSITION_VOLUME);
   g_tp        = isBuy ? g_entry + TPdist() : g_entry - TPdist();
   g_sl        = 0.0;                                   // inconnu tant que B4 n'est pas close
   g_entryTime = TimeCurrent();

   // Extrêmes de B3 — pris dans la fenêtre qui vient de produire le signal, donc
   // exactement la bougie jugée. Puis identité de B4 (la bougie en cours).
   g_b3Low  = g_low[g_n - 1];
   g_b3High = g_high[g_n - 1];
   g_b4Time = iTime(_Symbol, _Period, 0);

   g_state     = ST_POS_RAW;
   g_forceDraw = true;

   PrintFormat("rFVG-Full-EA : %s %s %s @ %s — B4 ouverte, SL à sa clôture (TP %s)",
               sig.label, (isBuy ? "BUY" : "SELL"), DoubleToString(g_lot, LotDigits()),
               DoubleToString(g_entry, _Digits), DoubleToString(g_tp, _Digits));
  }

//======================= ARMEMENT DU STOP ==========================
// À la clôture de B4 : le prix ne repart plus derrière l'extrême B3-B4.
void ArmStop(const double b4Low, const double b4High)
  {
   if(g_posBuy)
      g_sl = MathMin(g_b3Low, b4Low) - SLmarge();
   else
      g_sl = MathMax(g_b3High, b4High) + SLmarge();
   g_sl = NormalizeDouble(g_sl, _Digits);
  }

void ArmStopOnBarClose()
  {
   const int sh = iBarShift(_Symbol, _Period, g_b4Time);   // B4, désormais close
   if(sh < 0)
      return;

   ArmStop(iLow(_Symbol, _Period, sh), iHigh(_Symbol, _Period, sh));
   g_state     = ST_POS;
   g_forceDraw = true;

   PrintFormat("rFVG-Full-EA : SL armé à %s (%.0f pts du prix d'entrée).",
               DoubleToString(g_sl, _Digits), MathAbs(g_entry - g_sl) / _Point);
  }

//======================= GESTION POSITION (tick) ===================
void ManagePosition()
  {
   if(!PositionSelectByTicket(g_ticket))                  // clôturée hors EA
     {
      // Comptée pour que trades = TP + SL + autre reste vrai, mais son P&L
      // nous échappe (clôture manuelle, stop out, fermeture broker).
      Print("rFVG-Full-EA : position disparue (clôture externe) — retour en RECHERCHE.");
      g_nTrades++;
      g_nOther++;
      ResetPosition();
      return;
     }

   const double bid = Bid(), ask = Ask();
   const bool   hasSL = (g_state == ST_POS);

   if(g_posBuy)
     {
      if(hasSL && bid <= g_sl) { ClosePosition("sl", bid); return; }
      if(bid >= g_tp)          { ClosePosition("tp", bid); return; }
     }
   else
     {
      if(hasSL && ask >= g_sl) { ClosePosition("sl", ask); return; }
      if(ask <= g_tp)          { ClosePosition("tp", ask); return; }
     }
  }

//======================= CLÔTURE + STATS ===========================
void ClosePosition(const string reason, const double exitPrice)
  {
   // P&L flottant juste avant la clôture (la commission n'apparaît pas ici :
   // elle est portée par les deals, pas par la position).
   double profit = 0.0;
   if(PositionSelectByTicket(g_ticket))
      profit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);

   if(!trade.PositionClose(g_ticket))
     {
      Print("rFVG-Full-EA : échec clôture — retcode ", trade.ResultRetcode(),
            " ", trade.ResultRetcodeDescription(), " · nouvelle tentative au prochain tick.");
      return;
     }

   // Risque de référence : la distance au stop. Si la sortie tombe avant que
   // B4 soit close, on l'estime avec l'extrême de B4 tel qu'il est à l'instant.
   double risk;
   if(g_state == ST_POS)
      risk = MathAbs(g_entry - g_sl);
   else
     {
      const double lo = MathMin(g_b3Low,  iLow(_Symbol,  _Period, 0));
      const double hi = MathMax(g_b3High, iHigh(_Symbol, _Period, 0));
      risk = g_posBuy ? (g_entry - (lo - SLmarge())) : ((hi + SLmarge()) - g_entry);
     }

   const double won = g_posBuy ? (exitPrice - g_entry) : (g_entry - exitPrice);

   g_nTrades++;
   g_netProfit += profit;
   if(risk > 0.0)
     {
      g_sumR  += won / risk;
      g_sumRR += TPdist() / risk;
      g_nR++;
     }
   if(reason == "tp")      g_nTP++;
   else if(reason == "sl") g_nSL++;
   else                    g_nOther++;

   PrintFormat("rFVG-Full-EA : sortie %s @ %s — %.0f pts, %.2f %s",
               reason, DoubleToString(exitPrice, _Digits), won / _Point,
               profit, AccountInfoString(ACCOUNT_CURRENCY));

   ResetPosition();
  }

void ResetPosition()
  {
   g_state     = ST_SEARCH;
   g_ticket    = 0;
   g_sl        = 0.0;
   g_tp        = 0.0;
   g_forceDraw = true;
   DeleteLevels();
  }

//======================= ONTICK ====================================
void OnTick()
  {
   const datetime bt = iTime(_Symbol, _Period, 0);
   const bool newBar = (bt != g_lastBar);
   if(newBar)
      g_lastBar = bt;

   // 0) Garde-fou : une position à nous existe alors que l'état se croit LIBRE
   //    (exécution asynchrone, position apparue après le retour de l'ordre).
   //    On l'adopte plutôt que d'en ouvrir une deuxième au prochain signal.
   if(g_state == ST_SEARCH && FindOurPosition() > 0)
      AdoptExistingPosition();

   // 1) Nouvelle bougie : d'abord armer le stop si B4 vient de clore…
   if(newBar && g_state == ST_POS_RAW && bt != g_b4Time)
      ArmStopOnBarClose();

   // 2) …puis rafraîchir la fenêtre (MM + ATR sur les bougies closes) et
   //    chercher un motif, uniquement si l'état est LIBRE.
   if(newBar)
     {
      const bool ready = RefreshWindow();
      if(ready && g_state == ST_SEARCH)
        {
         SignalInfo sig;
         if(DetectFVG(sig))
           {
            g_sig = sig;
            if(InpDrawZones)
               DrawZone(sig);
            EnterMarket(sig);
           }
        }
     }

   // 3) Surveillance tick par tick.
   if(g_state == ST_POS_RAW || g_state == ST_POS)
      ManagePosition();

   // 4) Affichage (bridé, sauf événement).
   const uint now = GetTickCount();
   if(g_forceDraw || now - g_lastDraw > 150)
     {
      g_lastDraw  = now;
      g_forceDraw = false;
      UpdateDashboard();
      UpdateLevels();
      UpdateSizer();
      ChartRedraw();
     }
  }

//======================= PRIMITIVES D'AFFICHAGE ====================
void UI_Text(const string key, const int x, const int y, const string txt,
             const color clr, const int fs = 9, const string font = "Consolas")
  {
   const string n = PFX + key;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetString(0,  n, OBJPROP_TEXT, txt);
   ObjectSetString(0,  n, OBJPROP_FONT, font);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, fs);
   ObjectSetInteger(0, n, OBJPROP_COLOR, clr);
  }

void UI_Rect(const string key, const int x, const int y, const int w, const int h,
             const color bg, const color border)
  {
   const string n = PFX + key;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

// Jauge texte : où est le prix entre le stop et l'objectif.
string Gauge(double frac, const int width)
  {
   if(frac < 0.0) frac = 0.0;
   if(frac > 1.0) frac = 1.0;
   const int fill = (int)MathRound(frac * width);
   string s = "";
   for(int i = 0; i < width; i++)
      s += (i < fill ? "■" : "□");
   return s;
  }

//======================= DASHBOARD =================================
void UpdateDashboard()
  {
   if(!InpShowDash)
     {
      ObjectsDeleteAll(0, PFX + "d_");
      return;
     }

   const int x = InpDashX, y = InpDashY, w = 320, lh = 16;
   const int rows = 22;                                   // cf. le compte des lignes ci-dessous
   UI_Rect("d_bg", x - 8, y - 8, w, rows * lh + 26, COL_BG, COL_BORDER);
   UI_Rect("d_strip", x - 8, y - 8, 3, rows * lh + 26,
           g_state == ST_SEARCH ? COL_ACC : (g_posBuy ? COL_BULL : COL_BEAR),
           g_state == ST_SEARCH ? COL_ACC : (g_posBuy ? COL_BULL : COL_BEAR));

   int row = 0;
   const string ccy = AccountInfoString(ACCOUNT_CURRENCY);

   //--- en-tête + badge d'état
   string stTxt = "RECHERCHE";
   color  stCol = COL_ACC;
   switch(g_state)
     {
      case ST_POS_RAW: stTxt = "SL EN ATTENTE"; stCol = clrGoldenrod; break;
      case ST_POS:     stTxt = "EN POSITION";   stCol = (g_posBuy ? COL_BULL : COL_BEAR); break;
      default:         stTxt = "RECHERCHE";     stCol = COL_ACC; break;
     }
   UI_Text("d_title", x, y + lh * row, "◆ rFVG EA", clrWhite, 11, "Consolas Bold");
   UI_Text("d_state", x + 150, y + lh * row++, stTxt, stCol, 10, "Consolas Bold");

   const double spread = (Ask() - Bid()) / _Point;
   const string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)_Period), 7);   // "PERIOD_M5" → "M5"
   UI_Text("d_sym", x, y + lh * row++,
           _Symbol + " · " + tf +
           " · spread " + DoubleToString(spread, 0) + " pts", COL_DIM, 8);

   UI_Text("d_sep1", x, y + lh * row++, "───────────────────────────────", COL_BORDER, 8);

   //--- réglages de détection
   UI_Text("d_h1", x, y + lh * row++, "DÉTECTION", COL_ACC, 8, "Consolas Bold");
   UI_Text("d_cfg1", x, y + lh * row++,
           ModeName() + " · " + DirName(), clrGainsboro, 8);
   UI_Text("d_cfg2", x, y + lh * row++,
           "MM " + (string)InpMaFast + "/" + (string)InpMaSlow +
           " · " + (InpSizeMode == FV_BODY ? "corps" : "amplitude") +
           " ≥ " + DoubleToString(InpAtrMult, 2) + "×ATR" + (string)InpAtrPeriod, clrGainsboro, 8);
   UI_Text("d_cfg3", x, y + lh * row++,
           "gap ≥ " + DoubleToString(InpMinGapPts, 0) + " pts" +
           (InpAtrMult3 > 0.0 ? " · 3e ≤ " + DoubleToString(InpAtrMult3, 2) + "×ATR" : "") +
           (InpWick3 ? " · mèche rejet" : ""), COL_DIM, 8);

   if(g_sig.valid)
     {
      const color sc = g_sig.isBull ? COL_BULL : COL_BEAR;
      UI_Text("d_sig1", x, y + lh * row++,
              (g_sig.isBull ? "▲ " : "▼ ") + g_sig.label + "  " +
              TimeToString(g_sig.tCentral, TIME_DATE | TIME_MINUTES), sc, 9);
      UI_Text("d_sig2", x, y + lh * row++,
              "gap " + DoubleToString(g_sig.gap / _Point, 0) + " pts · taille " +
              DoubleToString(g_sig.atr > 0 ? g_sig.size / g_sig.atr : 0.0, 2) + " ATR", clrGainsboro, 8);
     }
   else
     {
      UI_Text("d_sig1", x, y + lh * row++, "Aucun motif depuis le démarrage", COL_DIM, 8);
      UI_Text("d_sig2", x, y + lh * row++, " ", COL_DIM, 8);
     }

   UI_Text("d_sep2", x, y + lh * row++, "───────────────────────────────", COL_BORDER, 8);

   //--- bloc position
   UI_Text("d_h2", x, y + lh * row++, "POSITION", COL_ACC, 8, "Consolas Bold");

   if(g_state == ST_SEARCH)
     {
      UI_Text("d_p1", x, y + lh * row++, "Libre — prochaine bougie jugée", COL_DIM, 8);
      UI_Text("d_p2", x, y + lh * row++, " ", COL_DIM, 8);
      UI_Text("d_p3", x, y + lh * row++, " ", COL_DIM, 8);
      UI_Text("d_p4", x, y + lh * row++, " ", COL_DIM, 8);
      UI_Text("d_p5", x, y + lh * row++, " ", COL_DIM, 8);
     }
   else
     {
      const double px    = g_posBuy ? Bid() : Ask();
      const double pts   = (g_posBuy ? (px - g_entry) : (g_entry - px)) / _Point;
      const color  pnlC  = pts > 0 ? COL_BULL : (pts < 0 ? COL_BEAR : clrSilver);
      const double money = (PositionSelectByTicket(g_ticket) ? PositionGetDouble(POSITION_PROFIT) : 0.0);

      UI_Text("d_p1", x, y + lh * row++,
              (g_posBuy ? "BUY  " : "SELL ") + DoubleToString(g_lot, LotDigits()) +
              " @ " + DoubleToString(g_entry, _Digits), (g_posBuy ? COL_BULL : COL_BEAR), 9);

      if(g_state == ST_POS_RAW)
        {
         const int left = (int)(PeriodSeconds() - (TimeCurrent() - g_b4Time));
         UI_Text("d_p2", x, y + lh * row++,
                 "SL  armé à la clôture de B4 (" +
                 (left > 0 ? StringFormat("%d:%02d", left / 60, left % 60) : "…") + ")",
                 clrGoldenrod, 8);
        }
      else
        {
         UI_Text("d_p2", x, y + lh * row++,
                 "SL  " + DoubleToString(g_sl, _Digits) + "   (" +
                 DoubleToString(MathAbs(g_entry - g_sl) / _Point, 0) + " pts · " +
                 DoubleToString(Money(MathAbs(g_entry - g_sl), g_lot), 2) + " " + ccy + ")",
                 COL_BEAR, 8);
        }

      UI_Text("d_p3", x, y + lh * row++,
              "TP  " + DoubleToString(g_tp, _Digits) + "   (" +
              DoubleToString(InpTPPoints, 0) + " pts · " +
              DoubleToString(Money(TPdist(), g_lot), 2) + " " + ccy + ")", COL_BULL, 8);

      UI_Text("d_p4", x, y + lh * row++,
              "P&L " + (pts >= 0 ? "+" : "") + DoubleToString(pts, 0) + " pts · " +
              DoubleToString(money, 2) + " " + ccy, pnlC, 9);

      // Jauge SL ↔ TP (seulement quand le stop existe).
      if(g_state == ST_POS && g_tp != g_sl)
        {
         const double frac = g_posBuy ? (px - g_sl) / (g_tp - g_sl) : (g_sl - px) / (g_sl - g_tp);
         UI_Text("d_p5", x, y + lh * row++, Gauge(frac, 18), pnlC, 8);
        }
      else
         UI_Text("d_p5", x, y + lh * row++, "risque non borné tant que B4 court", clrGoldenrod, 8);
     }

   UI_Text("d_sep3", x, y + lh * row++, "───────────────────────────────", COL_BORDER, 8);

   //--- statistiques de session
   const double wr     = (g_nTrades > 0) ? 100.0 * g_nTP / g_nTrades : 0.0;
   const double rrAvg  = (g_nR > 0) ? g_sumRR / g_nR : 0.0;
   const double seuil  = (1.0 + rrAvg > 0.0) ? 100.0 / (1.0 + rrAvg) : 0.0;
   const double expR   = (g_nR > 0) ? g_sumR / g_nR : 0.0;
   const color  expC   = expR > 0 ? COL_BULL : (expR < 0 ? COL_BEAR : clrSilver);
   const color  pnlC2  = g_netProfit > 0 ? COL_BULL : (g_netProfit < 0 ? COL_BEAR : clrSilver);

   UI_Text("d_h3", x, y + lh * row++, "SESSION", COL_ACC, 8, "Consolas Bold");
   UI_Text("d_s1", x, y + lh * row++,
           "Trades " + (string)g_nTrades + "  (TP " + (string)g_nTP +
           " · SL " + (string)g_nSL + " · autre " + (string)g_nOther + ")", clrGainsboro, 8);
   UI_Text("d_s2", x, y + lh * row++,
           "Winrate " + DoubleToString(wr, 1) + " %  (seuil " + DoubleToString(seuil, 1) +
           " % · RR moy " + DoubleToString(rrAvg, 2) + ")", clrGainsboro, 8);
   UI_Text("d_s3", x, y + lh * row++,
           "Espérance " + DoubleToString(expR, 3) + " R/trade", expC, 8);
   UI_Text("d_s4", x, y + lh * row++,
           "P&L net   " + DoubleToString(g_netProfit, 2) + " " + ccy, pnlC2, 8);
  }

//======================= ZONE DU MOTIF =============================
void DrawZone(const SignalInfo &sig)
  {
   const string id   = IntegerToString((long)sig.tCentral);
   const string rect = PFX + "z" + id;
   const color  col  = sig.isBull ? COL_BULL : COL_BEAR;

   const datetime t2 = (datetime)((long)sig.tCentral + (long)InpExtLen * PeriodSeconds());

   if(ObjectCreate(0, rect, OBJ_RECTANGLE, 0, sig.tCentral, sig.top, t2, sig.bottom))
     {
      ObjectSetInteger(0, rect, OBJPROP_COLOR,      col);
      ObjectSetInteger(0, rect, OBJPROP_FILL,       true);
      ObjectSetInteger(0, rect, OBJPROP_BACK,       true);
      ObjectSetInteger(0, rect, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rect, OBJPROP_HIDDEN,     true);
     }

   const string txt = PFX + "t" + id;
   if(ObjectCreate(0, txt, OBJ_TEXT, 0, sig.tCentral, sig.top))
     {
      ObjectSetString(0,  txt, OBJPROP_TEXT,       sig.label);
      ObjectSetString(0,  txt, OBJPROP_FONT,       "Consolas");
      ObjectSetInteger(0, txt, OBJPROP_FONTSIZE,   8);
      ObjectSetInteger(0, txt, OBJPROP_COLOR,      col);
      ObjectSetInteger(0, txt, OBJPROP_ANCHOR,     ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, txt, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, txt, OBJPROP_HIDDEN,     true);
     }
  }

//======================= NIVEAUX DE LA POSITION ====================
void LevelRay(const string key, const datetime t0, const double price,
              const color clr, const string txt, const ENUM_LINE_STYLE style)
  {
   const string ln = PFX + "L_" + key;
   if(ObjectFind(0, ln) < 0)
     {
      ObjectCreate(0, ln, OBJ_TREND, 0, t0, price, t0 + PeriodSeconds(), price);
      ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT,  true);
      ObjectSetInteger(0, ln, OBJPROP_BACK,       true);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ln, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ln, OBJPROP_WIDTH,      1);
     }
   ObjectMove(0, ln, 0, t0, price);
   ObjectMove(0, ln, 1, t0 + PeriodSeconds(), price);
   ObjectSetInteger(0, ln, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, ln, OBJPROP_STYLE, style);

   const string tx = PFX + "L_t_" + key;
   const datetime at = iTime(_Symbol, _Period, 0);
   if(ObjectFind(0, tx) < 0)
     {
      ObjectCreate(0, tx, OBJ_TEXT, 0, at, price);
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR,     ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN,     true);
      ObjectSetString(0,  tx, OBJPROP_FONT,       "Consolas");
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE,   8);
     }
   ObjectMove(0, tx, 0, at, price);
   ObjectSetString(0,  tx, OBJPROP_TEXT, " " + txt);
   ObjectSetInteger(0, tx, OBJPROP_COLOR, clr);
  }

void DeleteLevels() { ObjectsDeleteAll(0, PFX + "L_"); }

void UpdateLevels()
  {
   if(!InpDrawLevels || g_state == ST_SEARCH)
     {
      DeleteLevels();
      return;
     }

   const datetime t0 = (g_b4Time > 0 ? g_b4Time : iTime(_Symbol, _Period, 0));
   LevelRay("entry", t0, g_entry, clrGainsboro, "entrée " + DoubleToString(g_entry, _Digits), STYLE_SOLID);
   LevelRay("tp",    t0, g_tp,    COL_BULL,
            "TP " + DoubleToString(InpTPPoints, 0) + " pts", STYLE_DASH);

   if(g_state == ST_POS)
      LevelRay("sl", t0, g_sl, COL_BEAR,
               "SL " + DoubleToString(MathAbs(g_entry - g_sl) / _Point, 0) + " pts", STYLE_DASH);
   else
     {
      ObjectDelete(0, PFX + "L_sl");
      ObjectDelete(0, PFX + "L_t_sl");
     }
  }

//======================= SIZER =====================================
// Matérialise N points depuis le prix courant, traduits en prix, en devise
// et en ATR — pour choisir un TP qui veut dire la même chose d'un symbole
// à l'autre. Purement visuel : ne touche jamais au trading.
void UpdateSizer()
  {
   if(!InpSizerOn || InpSizerPoints <= 0.0)
     {
      ObjectsDeleteAll(0, PFX + "S_");
      return;
     }

   const bool   up     = (InpSizerDir == SIZER_UP);
   const double anchor = up ? Ask() : Bid();
   const double dist   = InpSizerPoints * _Point;
   const double target = up ? anchor + dist : anchor - dist;
   const color  col    = up ? COL_BULL : COL_BEAR;

   const int      back = (int)MathMin(20, MathMax(1, Bars(_Symbol, _Period) - 1));
   const datetime t1   = iTime(_Symbol, _Period, back);
   const datetime t2   = iTime(_Symbol, _Period, 0) + 6 * PeriodSeconds();

   const string band = PFX + "S_band";
   if(ObjectFind(0, band) < 0)
     {
      ObjectCreate(0, band, OBJ_RECTANGLE, 0, t1, anchor, t2, target);
      ObjectSetInteger(0, band, OBJPROP_FILL,       true);
      ObjectSetInteger(0, band, OBJPROP_BACK,       true);
      ObjectSetInteger(0, band, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, band, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, band, OBJPROP_COLOR,      col);
     }
   ObjectMove(0, band, 0, t1, anchor);
   ObjectMove(0, band, 1, t2, target);
   ObjectSetInteger(0, band, OBJPROP_COLOR, col);

   const string ln = PFX + "S_line";
   if(ObjectFind(0, ln) < 0)
     {
      ObjectCreate(0, ln, OBJ_TREND, 0, t1, target, t2, target);
      ObjectSetInteger(0, ln, OBJPROP_STYLE,      STYLE_DOT);
      ObjectSetInteger(0, ln, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, ln, OBJPROP_BACK,       false);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ln, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ln, OBJPROP_COLOR,      col);
     }
   ObjectMove(0, ln, 0, t1, target);
   ObjectMove(0, ln, 1, t2, target);

   // Traductions : prix, argent au lot réellement tradé, et multiple d'ATR
   // (celui de Wilder, calculé sur la fenêtre de détection).
   const double lot = (g_lot > 0.0 ? g_lot : TradeLot());
   const string txt =
      StringFormat("%s %.0f pts  =  %s en prix  =  %.2f %s @ %s lot%s",
                   (up ? "▲" : "▼"), InpSizerPoints,
                   DoubleToString(dist, _Digits),
                   Money(dist, lot), AccountInfoString(ACCOUNT_CURRENCY),
                   DoubleToString(lot, LotDigits()),
                   (g_atrRef > 0.0 ? StringFormat("  =  %.2f × ATR%d", dist / g_atrRef, InpAtrPeriod) : ""));

   const string tx = PFX + "S_txt";
   if(ObjectFind(0, tx) < 0)
     {
      ObjectCreate(0, tx, OBJ_TEXT, 0, t2, target);
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR,     up ? ANCHOR_RIGHT_LOWER : ANCHOR_RIGHT_UPPER);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN,     true);
      ObjectSetString(0,  tx, OBJPROP_FONT,       "Consolas Bold");
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE,   9);
     }
   ObjectMove(0, tx, 0, t2, target);
   ObjectSetInteger(0, tx, OBJPROP_ANCHOR, up ? ANCHOR_RIGHT_LOWER : ANCHOR_RIGHT_UPPER);
   ObjectSetString(0,  tx, OBJPROP_TEXT, txt + " ");
   ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
  }
//+------------------------------------------------------------------+
