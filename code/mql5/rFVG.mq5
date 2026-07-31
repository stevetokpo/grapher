//+------------------------------------------------------------------+
//|                                                         rFVG.mq5 |
//|        rFVG / aFVG — Fair Value Gaps de retournement             |
//|                                                                  |
//|  Portage fidèle de calcRFVG() (lib/patterns.js) de la plateforme |
//|  Grapher — cf. pines/rFVG.pine pour la version TradingView.      |
//|                                                                  |
//|  MOTIF DE BASE (3 bougies) — la bougie CENTRALE, directionnelle  |
//|  et large, creuse un gap entre les deux bougies qui l'encadrent :|
//|    • baissier : centrale baissière,                              |
//|      gap = plus_bas(précédente) − plus_haut(suivante)            |
//|    • haussier : centrale haussière,                              |
//|      gap = plus_bas(suivante)   − plus_haut(précédente)          |
//|    gap > 0 → VIDE : la zone est l'espace laissé entre elles.     |
//|    gap < 0 → CHEVAUCHEMENT : elles se recouvrent, la zone est    |
//|      leur bande commune (mêmes bornes, dans l'autre ordre).      |
//|    « Gap minimum » est SIGNÉ et décide seul de ce qui passe :    |
//|      0 = vide strict (motif classique) · négatif = chevauchement |
//|      toléré jusque-là. Un gap nul est rejeté (zone plate).       |
//|    Taille : la centrale doit mesurer >= x × ATR(période), l'ATR  |
//|    étant lu AVANT elle (sinon il contiendrait la bougie jugée).  |
//|                                                                  |
//|  rFVG vs aFVG — la centrale doit être ENTIÈREMENT à contre-      |
//|  courant de son sens, sans toucher NI la MM rapide NI la MM      |
//|  lente (les deux à la fois) : baissière au-dessus des deux MM,   |
//|  haussière en dessous des deux. En mode « Toutes », la position  |
//|  vs MM n'est plus un filtre mais sert encore à étiqueter.        |
//|                                                                  |
//|  MODES : rFVG (retournements seuls) · Toutes (aFVG ⊇ rFVG,       |
//|  étiquetées) · Super (rFVG dont la 3e bougie referme le gap à    |
//|  CONTRE-SENS du motif → superFVG).                               |
//|                                                                  |
//|  Pas de mitigation, pas d'inversion : chaque zone est une boîte  |
//|  tirée à droite sur extLen bougies, puis coupée net.             |
//|                                                                  |
//|  ANTI-REPAINT — le motif a besoin de la bougie SUIVANTE pour     |
//|  exister : une zone de centrale i n'est tracée (et ses buffers   |
//|  remplis) qu'une fois la bougie i+1 CLOSE. Une zone tracée ne    |
//|  disparaît jamais.                                               |
//|                                                                  |
//|  BUFFERS (pour l'EA, via iCustom/CopyBuffer) — les valeurs de    |
//|  signal sont posées à l'index de la bougie CENTRALE :            |
//|    0  MM rapide (ligne)                                          |
//|    1  MM lente (ligne)                                           |
//|    2  Side : +1 haussier / -1 baissier / 0 rien                  |
//|    3  Top de la zone (0 si rien)                                 |
//|    4  Bottom de la zone (0 si rien)                              |
//|    5  1 = rFVG/superFVG, 0 = aFVG (lu seulement si Side != 0)    |
//|  Côté EA : à l'ouverture d'une bougie, le dernier motif confirmé |
//|  a sa centrale au shift 2 (sa « suivante » vient de clore).      |
//+------------------------------------------------------------------+
#property copyright   "Grapher — portage de lib/patterns.js (calcRFVG)"
#property version     "2.00"
#property description "rFVG / aFVG — Fair Value Gaps de retournement."
#property description "Gap 3 bougies creusé par une centrale large (>= x ATR),"
#property description "à contre-courant des DEUX MM (rFVG) ou partout (aFVG)."
#property indicator_chart_window
#property indicator_buffers 6
#property indicator_plots   6

#property indicator_label1  "MM rapide"
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrDarkOrange
#property indicator_style1  STYLE_SOLID
#property indicator_width1  1

#property indicator_label2  "MM lente"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrDodgerBlue
#property indicator_style2  STYLE_SOLID
#property indicator_width2  1

#property indicator_label3  "Side (+1 bull / -1 bear)"
#property indicator_type3   DRAW_NONE
#property indicator_label4  "Zone top"
#property indicator_type4   DRAW_NONE
#property indicator_label5  "Zone bottom"
#property indicator_type5   DRAW_NONE
#property indicator_label6  "rFVG/superFVG (1) / aFVG (0)"
#property indicator_type6   DRAW_NONE

//--- énumérations (mêmes options que calcRFVG)
enum ENUM_RFVG_MODE
  {
   RFVG_ONLY  = 0, // Seuls les rFVG
   RFVG_ALL   = 1, // Toutes (aFVG)
   RFVG_SUPER = 2  // Super (3e bougie à contre-sens)
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

//--- inputs
input group "Détection"
input ENUM_RFVG_MODE InpMode      = RFVG_ONLY;  // Motifs retenus
input ENUM_RFVG_DIR  InpDirection = DIR_BOTH;   // Direction
input int            InpMaFast    = 15;         // MM rapide — période
input int            InpMaSlow    = 200;        // MM lente — période
input ENUM_RFVG_SIZE InpSizeMode  = SIZE_RANGE; // Mesure de la taille de la centrale
input int            InpAtrPeriod = 14;         // ATR — période
input double         InpAtrMult   = 1.5;        // Taille centrale >= ATR × (0 = filtre off)
input double         InpMinGap    = 0.0;        // Gap minimum (prix, SIGNÉ : <0 = chevauchement toléré)

input group "Affichage"
input int    InpExtLen      = 20;               // Extension max (bougies)
input bool   InpShowLabel   = true;             // Label dans la boîte
input bool   InpShowMa      = false;            // Tracer les MM
input color  InpBullColor   = C'38,166,154';    // Couleur haussière (#26A69A)
input color  InpBearColor   = C'239,83,80';     // Couleur baissière (#EF5350)
input bool   InpFill        = true;             // Remplir les boîtes
input int    InpHistoryBars = 5000;             // Bougies d'historique analysées (0 = tout)

input group "Alertes"
input bool   InpAlerts = false;                 // Alert() sur nouvelle zone confirmée

//--- buffers
double BufMaFast[], BufMaSlow[], BufSide[], BufTop[], BufBottom[], BufIsR[];

//--- état
double g_maFast[];           // MM rapide, EMPTY_VALUE avant la période
double g_maSlow[];           // MM lente, EMPTY_VALUE avant la période
double g_atr[];              // ATR de Wilder, EMPTY_VALUE avant la période
int    g_done = 1;           // prochaine bougie centrale à examiner
long   g_openCentral[];      // zones dont le bord droit n'est pas encore figé
string g_openName[];

const string PREFIX = "rFVG#";

//+------------------------------------------------------------------+
int OnInit()
  {
   SetIndexBuffer(0, BufMaFast, INDICATOR_DATA);
   SetIndexBuffer(1, BufMaSlow, INDICATOR_DATA);
   SetIndexBuffer(2, BufSide,   INDICATOR_DATA);
   SetIndexBuffer(3, BufTop,    INDICATOR_DATA);
   SetIndexBuffer(4, BufBottom, INDICATOR_DATA);
   SetIndexBuffer(5, BufIsR,    INDICATOR_DATA);

   ArraySetAsSeries(BufMaFast, false);
   ArraySetAsSeries(BufMaSlow, false);
   ArraySetAsSeries(BufSide,   false);
   ArraySetAsSeries(BufTop,    false);
   ArraySetAsSeries(BufBottom, false);
   ArraySetAsSeries(BufIsR,    false);

   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   for(int p = 2; p <= 5; p++)
      PlotIndexSetDouble(p, PLOT_EMPTY_VALUE, 0.0);

   IndicatorSetString(INDICATOR_SHORTNAME, "rFVG/aFVG");
   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| MM simple sur les clôtures — comme smaArr() : définie à partir   |
//| de l'index period-1, EMPTY_VALUE avant.                          |
//+------------------------------------------------------------------+
void ComputeSma(const double &close[], const int total, const int period, double &dst[])
  {
   ArrayResize(dst, total);
   double sum = 0;
   for(int i = 0; i < total; i++)
     {
      sum += close[i];
      if(i >= period)     sum -= close[i - period];
      dst[i] = (i >= period - 1) ? sum / period : EMPTY_VALUE;
     }
  }

//+------------------------------------------------------------------+
//| ATR de Wilder (RMA des true ranges) — comme atrArr() : première  |
//| valeur à l'index `period` (moyenne simple des TR), puis RMA.     |
//+------------------------------------------------------------------+
void ComputeAtr(const double &high[], const double &low[], const double &close[], const int total)
  {
   const int period = InpAtrPeriod;
   ArrayResize(g_atr, total);
   ArrayInitialize(g_atr, EMPTY_VALUE);
   if(period < 1 || total < 2)
      return;

   double sum = 0, prev = 0;
   for(int i = 1; i < total; i++)
     {
      double tr = MathMax(high[i] - low[i],
                  MathMax(MathAbs(high[i] - close[i - 1]),
                          MathAbs(low[i]  - close[i - 1])));
      if(i <= period)
        {
         sum += tr;
         if(i == period) { prev = sum / period; g_atr[i] = prev; }
        }
      else
        {
         prev = (prev * (period - 1) + tr) / period;
         g_atr[i] = prev;
        }
     }
  }

//+------------------------------------------------------------------+
//| Bord droit de la boîte : l'index central + extLen si la bougie   |
//| existe déjà, sinon une projection au-delà du bord droit (mise à  |
//| jour à chaque nouvelle bougie jusqu'à figer le bord).            |
//+------------------------------------------------------------------+
datetime EndTime(const datetime &time[], const int total, const long central, bool &isFixed)
  {
   const long endIdx = central + InpExtLen;
   isFixed = (endIdx < total);
   if(isFixed)
      return time[(int)endIdx];
   return (datetime)((long)time[total - 1] + (endIdx - (total - 1)) * PeriodSeconds());
  }

//+------------------------------------------------------------------+
//| Boîte + label d'une zone confirmée (centrale à l'index i).       |
//+------------------------------------------------------------------+
void DrawZone(const datetime &time[], const int total, const int i,
              const bool isBear, const double top, const double bottom, const string lbl)
  {
   const string id   = IntegerToString((long)time[i]);
   const string rect = PREFIX + "z" + id;
   const color  col  = isBear ? InpBearColor : InpBullColor;

   bool isFixed;
   const datetime t2 = EndTime(time, total, i, isFixed);

   if(ObjectCreate(0, rect, OBJ_RECTANGLE, 0, time[i], top, t2, bottom))
     {
      ObjectSetInteger(0, rect, OBJPROP_COLOR,      col);
      ObjectSetInteger(0, rect, OBJPROP_FILL,       InpFill ? 1 : 0);
      ObjectSetInteger(0, rect, OBJPROP_BACK,       true);
      ObjectSetInteger(0, rect, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rect, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, rect, OBJPROP_ZORDER,     0);
     }

   if(!isFixed)
     {
      const int k = ArraySize(g_openCentral);
      ArrayResize(g_openCentral, k + 1);
      ArrayResize(g_openName,    k + 1);
      g_openCentral[k] = i;
      g_openName[k]    = rect;
     }

   if(InpShowLabel)
     {
      const string txt = PREFIX + "t" + id;
      if(ObjectCreate(0, txt, OBJ_TEXT, 0, time[i], top))
        {
         ObjectSetString(0,  txt, OBJPROP_TEXT,       lbl);
         ObjectSetString(0,  txt, OBJPROP_FONT,       "Arial");
         ObjectSetInteger(0, txt, OBJPROP_FONTSIZE,   8);
         ObjectSetInteger(0, txt, OBJPROP_COLOR,      col);
         ObjectSetInteger(0, txt, OBJPROP_ANCHOR,     ANCHOR_LEFT_LOWER);
         ObjectSetInteger(0, txt, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, txt, OBJPROP_HIDDEN,     true);
        }
     }
  }

//+------------------------------------------------------------------+
//| Fige le bord droit des zones encore ouvertes dès que la bougie   |
//| centrale + extLen existe. En attendant, la projection est refaite|
//| à chaque nouvelle bougie (les gaps de cotation décalent l'heure).|
//+------------------------------------------------------------------+
void UpdateOpenEnds(const datetime &time[], const int total)
  {
   for(int k = ArraySize(g_openCentral) - 1; k >= 0; k--)
     {
      bool isFixed;
      const datetime t2 = EndTime(time, total, g_openCentral[k], isFixed);
      ObjectSetInteger(0, g_openName[k], OBJPROP_TIME, 1, t2);
      if(isFixed)
        {
         const int lastIdx = ArraySize(g_openCentral) - 1;
         g_openCentral[k] = g_openCentral[lastIdx];
         g_openName[k]    = g_openName[lastIdx];
         ArrayResize(g_openCentral, lastIdx);
         ArrayResize(g_openName,    lastIdx);
        }
     }
  }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
  {
   // Indexation chronologique (0 = plus ancienne), comme lib/patterns.js.
   ArraySetAsSeries(time,  false);
   ArraySetAsSeries(open,  false);
   ArraySetAsSeries(high,  false);
   ArraySetAsSeries(low,   false);
   ArraySetAsSeries(close, false);

   // Rien à faire tant qu'aucune bougie nouvelle n'est close.
   if(prev_calculated == rates_total && prev_calculated != 0)
      return rates_total;

   const bool firstRun = (prev_calculated == 0);
   if(firstRun)
     {
      ObjectsDeleteAll(0, PREFIX);
      ArrayResize(g_openCentral, 0);
      ArrayResize(g_openName,    0);
      g_done = 1;
      if(InpHistoryBars > 0 && rates_total - InpHistoryBars > g_done)
         g_done = rates_total - InpHistoryBars;
      ArrayInitialize(BufSide,   0.0);
      ArrayInitialize(BufTop,    0.0);
      ArrayInitialize(BufBottom, 0.0);
      ArrayInitialize(BufIsR,    0.0);
     }

   ComputeSma(close, rates_total, InpMaFast, g_maFast);
   ComputeSma(close, rates_total, InpMaSlow, g_maSlow);
   ComputeAtr(high, low, close, rates_total);
   for(int i = 0; i < rates_total; i++)
     {
      BufMaFast[i] = InpShowMa ? g_maFast[i] : EMPTY_VALUE;
      BufMaSlow[i] = InpShowMa ? g_maSlow[i] : EMPTY_VALUE;
     }

   const bool onlyR  = (InpMode != RFVG_ALL);
   const bool useAtr = (InpAtrPeriod > 0 && InpAtrMult > 0);

   // La centrale i n'est jugée qu'une fois sa SUIVANTE (i+1) close, donc
   // seulement quand la bougie i+2 existe : i <= rates_total - 3. La bougie
   // en formation n'entre jamais dans le motif → aucun repaint.
   for(int i = g_done; i <= rates_total - 3; i++)
     {
      // MM requises même en mode « Toutes » (fidèle à calcRFVG : avg == null → skip).
      const double avgFast = g_maFast[i];
      const double avgSlow = g_maSlow[i];
      if(avgFast == EMPTY_VALUE || avgSlow == EMPTY_VALUE)
         continue;

      // Motif de base : centrale directionnelle. Le gap (vide ou chevauchement)
      // est mesuré plus bas et filtré par InpMinGap. Pas de MM ici.
      const bool baseBear = close[i] < open[i];
      const bool baseBull = close[i] > open[i];
      if(!baseBear && !baseBull)
         continue;

      // Retournement : la centrale entièrement du côté opposé à son sens, sans
      // toucher NI la MM rapide NI la MM lente. Seule séparation rFVG / aFVG.
      const bool maBear = low[i]  > avgFast && low[i]  > avgSlow;
      const bool maBull = high[i] < avgFast && high[i] < avgSlow;

      bool isBear = baseBear && (!onlyR || maBear);
      bool isBull = baseBull && (!onlyR || maBull);
      if(!isBear && !isBull)
         continue;

      // Mode Super : la 3e bougie (celle qui referme le gap) doit clôturer à
      // contre-sens du motif.
      if(InpMode == RFVG_SUPER)
        {
         if(isBear && !(close[i + 1] > open[i + 1])) isBear = false;
         if(isBull && !(close[i + 1] < open[i + 1])) isBull = false;
         if(!isBear && !isBull)
            continue;
        }

      if(InpDirection == DIR_BULL && !isBull) continue;
      if(InpDirection == DIR_BEAR && !isBear) continue;

      const string lbl = (InpMode == RFVG_SUPER) ? "superFVG"
                         : ((isBear ? maBear : maBull) ? "rFVG" : "aFVG");

      // Les deux niveaux du motif et leur écart SIGNÉ : positif = vide entre la
      // 1re et la 3e bougie, négatif = elles se chevauchent et la zone devient
      // leur bande commune (mêmes bornes, dans l'autre ordre). InpMinGap, lui
      // aussi signé, décide de ce qui passe. Gap nul = zone plate, rejetée.
      const double hiLvl = isBear ? low[i - 1]  : low[i + 1];
      const double loLvl = isBear ? high[i + 1] : high[i - 1];
      const double gap   = hiLvl - loLvl;

      if(gap == 0.0 || gap < InpMinGap)
         continue;

      const double top    = (gap > 0.0) ? hiLvl : loLvl;
      const double bottom = (gap > 0.0) ? loLvl : hiLvl;

      // Taille de la centrale vs ATR lu AVANT elle (i-1).
      if(useAtr)
        {
         const double ref = g_atr[i - 1];
         if(ref == EMPTY_VALUE)
            continue;
         const double size = (InpSizeMode == SIZE_BODY) ? MathAbs(close[i] - open[i])
                                                        : high[i] - low[i];
         if(size < InpAtrMult * ref)
            continue;
        }

      // Signal confirmé → buffers (à l'index de la centrale) + dessin.
      BufSide[i]   = isBear ? -1.0 : 1.0;
      BufTop[i]    = top;
      BufBottom[i] = bottom;
      BufIsR[i]    = (lbl == "aFVG") ? 0.0 : 1.0;

      DrawZone(time, rates_total, i, isBear, top, bottom, lbl);

      // Alerte uniquement en temps réel, sur le motif tout juste confirmé.
      if(InpAlerts && !firstRun && i == rates_total - 3)
         Alert(lbl, isBear ? " BAISSIER sur " : " HAUSSIER sur ", _Symbol,
               " (", EnumToString(_Period), ")");
     }

   g_done = MathMax(g_done, rates_total - 2);

   UpdateOpenEnds(time, rates_total);
   ChartRedraw();

   return rates_total;
  }
//+------------------------------------------------------------------+
