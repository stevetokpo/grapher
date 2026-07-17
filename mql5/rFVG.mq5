//+------------------------------------------------------------------+
//|                                                         rFVG.mq5 |
//|        rFVG / aFVG — Fair Value Gaps de retournement             |
//|                                                                  |
//|  Portage fidèle de calcRFVG() (lib/patterns.js) de la plateforme |
//|  Grapher — cf. pines/rFVG.pine pour la version TradingView.      |
//|                                                                  |
//|  MOTIF DE BASE (3 bougies) — la bougie CENTRALE, directionnelle  |
//|  et large, laisse un gap béant :                                 |
//|    • baissier : centrale baissière, et plus_bas(précédente) >    |
//|      plus_haut(suivante)   → zone [haut suivante ; bas préc.]    |
//|    • haussier : centrale haussière, et plus_haut(précédente) <   |
//|      plus_bas(suivante)    → zone [haut préc. ; bas suivante]    |
//|    Taille : la centrale doit mesurer >= x × ATR(période), l'ATR  |
//|    étant lu AVANT elle (sinon il contiendrait la bougie jugée).  |
//|                                                                  |
//|  rFVG vs aFVG — un seul critère les sépare : en mode rFVG la     |
//|  centrale est entièrement à CONTRE-COURANT de son côté de la     |
//|  MM50 (baissière entièrement au-dessus, haussière entièrement    |
//|  en dessous), sans la toucher. En mode « Toutes », la MM n'est   |
//|  plus un filtre mais sert encore à étiqueter chaque boîte.       |
//|                                                                  |
//|  Pas de mitigation, pas d'inversion : chaque zone est une boîte  |
//|  tirée à droite sur extLen bougies, puis coupée net.             |
//|                                                                  |
//|  ANTI-REPAINT — le motif a besoin de la bougie SUIVANTE pour     |
//|  exister : une zone de centrale i n'est tracée (et ses buffers   |
//|  remplis) qu'une fois la bougie i+1 CLOSE. Une zone tracée ne    |
//|  disparaît jamais.                                               |
//|                                                                  |
//|  BUFFERS (pour l'EA, via iCustom/CopyBuffer) — les valeurs sont  |
//|  posées à l'index de la bougie CENTRALE :                        |
//|    0  MM simple (ligne)                                          |
//|    1  Side : +1 haussier / -1 baissier / 0 rien                  |
//|    2  Top de la zone (0 si rien)                                 |
//|    3  Bottom de la zone (0 si rien)                              |
//|    4  1 = rFVG, 0 = aFVG (lu seulement si Side != 0)             |
//|  Côté EA : à l'ouverture d'une bougie, le dernier motif confirmé |
//|  a sa centrale au shift 2 (sa « suivante » vient de clore).      |
//+------------------------------------------------------------------+
#property copyright   "Grapher — portage de lib/patterns.js (calcRFVG)"
#property version     "1.00"
#property description "rFVG / aFVG — Fair Value Gaps de retournement."
#property description "Gap 3 bougies creusé par une centrale large (>= x ATR),"
#property description "à contre-courant de la MM50 (rFVG) ou partout (aFVG)."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   5

#property indicator_label1  "MM"
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrGray
#property indicator_style1  STYLE_SOLID
#property indicator_width1  1

#property indicator_label2  "Side (+1 bull / -1 bear)"
#property indicator_type2   DRAW_NONE
#property indicator_label3  "Zone top"
#property indicator_type3   DRAW_NONE
#property indicator_label4  "Zone bottom"
#property indicator_type4   DRAW_NONE
#property indicator_label5  "rFVG (1) / aFVG (0)"
#property indicator_type5   DRAW_NONE

//--- énumérations (mêmes options que calcRFVG)
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

//--- inputs
input group "Détection"
input ENUM_RFVG_MODE InpMode      = RFVG_ONLY;  // Motifs retenus
input ENUM_RFVG_DIR  InpDirection = DIR_BOTH;   // Direction
input int            InpMaPeriod  = 50;         // MM simple — période
input ENUM_RFVG_SIZE InpSizeMode  = SIZE_RANGE; // Mesure de la taille de la centrale
input int            InpAtrPeriod = 14;         // ATR — période
input double         InpAtrMult   = 1.5;        // Taille centrale >= ATR × (0 = filtre off)
input double         InpMinGap    = 0.0;        // Gap minimum (unités de prix, 0 = tous)

input group "Affichage"
input int    InpExtLen      = 20;               // Extension max (bougies)
input bool   InpShowLabel   = true;             // Label dans la boîte
input bool   InpShowMa      = true;             // Tracer la MM
input color  InpBullColor   = C'38,166,154';    // Couleur haussière (#26A69A)
input color  InpBearColor   = C'239,83,80';     // Couleur baissière (#EF5350)
input bool   InpFill        = true;             // Remplir les boîtes
input int    InpHistoryBars = 5000;             // Bougies d'historique analysées (0 = tout)

input group "Alertes"
input bool   InpAlerts = false;                 // Alert() sur nouvelle zone confirmée

//--- buffers
double BufMa[], BufSide[], BufTop[], BufBottom[], BufIsR[];

//--- état
double g_ma[];               // MM simple, EMPTY_VALUE avant la période
double g_atr[];              // ATR de Wilder, EMPTY_VALUE avant la période
int    g_done = 1;           // prochaine bougie centrale à examiner
long   g_openCentral[];      // zones dont le bord droit n'est pas encore figé
string g_openName[];

const string PREFIX = "rFVG#";

//+------------------------------------------------------------------+
int OnInit()
  {
   SetIndexBuffer(0, BufMa,     INDICATOR_DATA);
   SetIndexBuffer(1, BufSide,   INDICATOR_DATA);
   SetIndexBuffer(2, BufTop,    INDICATOR_DATA);
   SetIndexBuffer(3, BufBottom, INDICATOR_DATA);
   SetIndexBuffer(4, BufIsR,    INDICATOR_DATA);

   ArraySetAsSeries(BufMa, false);
   ArraySetAsSeries(BufSide, false);
   ArraySetAsSeries(BufTop, false);
   ArraySetAsSeries(BufBottom, false);
   ArraySetAsSeries(BufIsR, false);

   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   for(int p = 1; p <= 4; p++)
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
void ComputeMa(const double &close[], const int total)
  {
   const int period = InpMaPeriod;
   ArrayResize(g_ma, total);
   double sum = 0;
   for(int i = 0; i < total; i++)
     {
      sum += close[i];
      if(i >= period)     sum -= close[i - period];
      g_ma[i]  = (i >= period - 1) ? sum / period : EMPTY_VALUE;
      BufMa[i] = InpShowMa ? g_ma[i] : EMPTY_VALUE;
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

   ComputeMa(close, rates_total);
   ComputeAtr(high, low, close, rates_total);

   const bool onlyR  = (InpMode == RFVG_ONLY);
   const bool useAtr = (InpAtrPeriod > 0 && InpAtrMult > 0);

   // La centrale i n'est jugée qu'une fois sa SUIVANTE (i+1) close, donc
   // seulement quand la bougie i+2 existe : i <= rates_total - 3. La bougie
   // en formation n'entre jamais dans le motif → aucun repaint.
   for(int i = g_done; i <= rates_total - 3; i++)
     {
      // MM requise même en mode « Toutes » (fidèle à calcRFVG : avg == null → skip).
      const double avg = g_ma[i];
      if(avg == EMPTY_VALUE)
         continue;

      // Motif de base : centrale directionnelle + gap correspondant. Pas de MM ici.
      const bool baseBear = close[i] < open[i] && low[i - 1]  > high[i + 1];
      const bool baseBull = close[i] > open[i] && high[i - 1] < low[i + 1];
      if(!baseBear && !baseBull)
         continue;

      // Condition de retournement : la centrale est entièrement du côté opposé
      // à son sens, sans toucher la moyenne. Seule séparation rFVG / aFVG.
      const bool maBear = low[i]  > avg;
      const bool maBull = high[i] < avg;

      const bool isBear = baseBear && (!onlyR || maBear);
      const bool isBull = baseBull && (!onlyR || maBull);
      if(!isBear && !isBull)
         continue;

      if(InpDirection == DIR_BULL && !isBull) continue;
      if(InpDirection == DIR_BEAR && !isBear) continue;

      const string lbl = (isBear ? maBear : maBull) ? "rFVG" : "aFVG";

      const double top    = isBear ? low[i - 1]  : low[i + 1];
      const double bottom = isBear ? high[i + 1] : high[i - 1];

      if(InpMinGap > 0 && top - bottom < InpMinGap)
         continue;

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
      BufIsR[i]    = (lbl == "rFVG") ? 1.0 : 0.0;

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
