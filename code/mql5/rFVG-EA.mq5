//+------------------------------------------------------------------+
//|                                                       rFVG-EA.mq5 |
//|      Expert Advisor rFVG — entrées/sorties 100 % VIRTUELLES       |
//|                                                                  |
//|  Trade la stratégie rFVG (cf. pines/rFVG-strategy.pine). AUCUN   |
//|  ordre en attente, AUCUN SL/TP côté broker : tout est géré au    |
//|  tick, exécuté au marché. Une seule position à la fois.          |
//|                                                                  |
//|  SIGNAUX — lus dans l'indicateur rFVG.mq5 via iCustom (buffer    |
//|  Side, shift 2 : à l'ouverture d'une bougie, la centrale du      |
//|  dernier motif confirmé y est, sa 3e bougie vient de clore au    |
//|  shift 1).                                                       |
//|                                                                  |
//|  ENTRÉE — décidée par le sens de la 3e bougie vs le rFVG :       |
//|    • 3e À CONTRE-SENS (cas super) → MARCHÉ à l'ouverture de la    |
//|      bougie suivante (premier tick de la nouvelle bougie).       |
//|    • 3e DANS LE SENS → attente VIRTUELLE au niveau open(3e) :     |
//|        achat si Ask <= open(3e) · vente si Bid >= open(3e).       |
//|      Abandonnée si non touchée dans `expiry` bougies (centrale). |
//|                                                                  |
//|  SORTIE — SL/TP/BE virtuels EN POINTS, surveillés au tick :      |
//|    stop testé AVANT le TP ; break-even optionnel (déplace le     |
//|    stop dès un profit donné). Clôture au marché.                 |
//|                                                                  |
//|  Distances en POINTS (× _Point) — varient selon le symbole ; le  |
//|  configurateur (règle) aide à les calibrer visuellement.         |
//+------------------------------------------------------------------+
#property copyright   "Grapher — EA rFVG virtuel (tick-by-tick)"
#property version     "1.00"
#property description "rFVG EA — entrées/sorties virtuelles au tick, une position à la fois."

#include <Trade/Trade.mqh>

//--- énumérations (mêmes valeurs que l'indicateur rFVG.mq5, pour iCustom)
enum ENUM_RFVG_MODE { RFVG_ONLY = 0, RFVG_ALL = 1, RFVG_SUPER = 2 };
enum ENUM_RFVG_DIR  { DIR_BOTH  = 0, DIR_BULL = 1, DIR_BEAR  = 2 };
enum ENUM_RFVG_SIZE { SIZE_RANGE = 0, SIZE_BODY = 1 };
enum ENUM_RULER_SIDE { RULER_LONG = 0, RULER_SHORT = 1 };

//======================= INPUTS ====================================
input group "Détection (transmis à l'indicateur rFVG)"
input string         InpIndicatorName = "rFVG";      // Nom de l'indicateur (dossier Indicators)
input ENUM_RFVG_MODE InpMode      = RFVG_ONLY;       // Motifs retenus
input ENUM_RFVG_DIR  InpDirection = DIR_BOTH;        // Direction
input int            InpMaFast    = 15;              // MM rapide — période
input int            InpMaSlow    = 200;             // MM lente — période
input ENUM_RFVG_SIZE InpSizeMode  = SIZE_RANGE;      // Mesure de la taille de la centrale
input int            InpAtrPeriod = 14;              // ATR — période
input double         InpAtrMult   = 1.5;             // Taille centrale >= ATR × (0 = off)
input double         InpMinGap    = 0.0;             // Gap minimum (PRIX, SIGNÉ : <0 = chevauchement toléré)

input group "Position (distances en POINTS)"
input double InpSLPoints     = 200;                  // SL — distance (points)
input double InpTPPoints     = 400;                  // TP — distance (points)
input double InpBELevelPoints = 0;                   // BE — niveau du stop vs entrée (points, +/-)
input double InpBEThreshPoints = 0;                  // Seuil BE — profit d'armement (points, 0 = off)
input int    InpExpiryBars   = 20;                   // Expiration de l'entrée virtuelle (bougies)

input group "Trading"
input double InpLot        = 0.10;                   // Lot fixe
input long   InpMagic      = 270721;                 // Magic number
input int    InpDeviation  = 20;                     // Slippage max (points)
input bool   InpBlockOnPending = true;               // Ignorer les signaux tant qu'une entrée virtuelle attend

input group "Dashboard"
input bool   InpShowDash   = true;                   // Afficher le tableau de bord
input int    InpDashX      = 12;                     // Position X (px)
input int    InpDashY      = 20;                     // Position Y (px)

input group "Configurateur de distance (règle)"
input bool            InpShowRuler = false;          // Afficher la règle de distance (on/off)
input ENUM_RULER_SIDE InpRulerSide = RULER_LONG;     // Sens affiché (SL/TP d'un seul côté)

//======================= ÉTAT ======================================
CTrade   trade;
int      g_handle   = INVALID_HANDLE;
datetime g_lastBar  = 0;

enum EA_STATE { ST_FLAT = 0, ST_PENDING = 1, ST_POS = 2 };
EA_STATE g_state = ST_FLAT;

// entrée virtuelle en attente
bool     g_pendBuy    = false;
double   g_pendLevel  = 0.0;
datetime g_centralTime = 0;

// position en cours
bool     g_posBuy   = false;
double   g_entry    = 0.0, g_sl = 0.0, g_tp = 0.0, g_beStop = 0.0;
bool     g_beArmed  = false;
ulong    g_ticket   = 0;

// statistiques (réinitialisées au rechargement de l'EA)
int      g_nTrades = 0, g_nTP = 0, g_nSL = 0, g_nBE = 0;
double   g_sumR = 0.0, g_netProfit = 0.0;

const string PFX = "rFVGea_";

//======================= UTILITAIRES ===============================
double SLdist()  { return InpSLPoints     * _Point; }
double TPdist()  { return InpTPPoints     * _Point; }
double BElvl()   { return InpBELevelPoints * _Point; }
double BEth()    { return InpBEThreshPoints * _Point; }

double Ask() { return SymbolInfoDouble(_Symbol, SYMBOL_ASK); }
double Bid() { return SymbolInfoDouble(_Symbol, SYMBOL_BID); }

// Retourne le ticket de NOTRE position (magic + symbole), 0 sinon.
ulong FindOurPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         (long)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return tk;
     }
   return 0;
  }

//======================= INIT / DEINIT =============================
int OnInit()
  {
   g_handle = iCustom(_Symbol, _Period, InpIndicatorName,
                      (int)InpMode, (int)InpDirection, InpMaFast, InpMaSlow,
                      (int)InpSizeMode, InpAtrPeriod, InpAtrMult, InpMinGap);
   if(g_handle == INVALID_HANDLE)
     {
      Print("rFVG-EA : impossible de charger l'indicateur '", InpIndicatorName,
            "'. Vérifie qu'il est compilé dans MQL5/Indicators.");
      return INIT_FAILED;
     }

   trade.SetExpertMagicNumber((ulong)InpMagic);
   trade.SetDeviationInPoints((ulong)InpDeviation);
   trade.SetTypeFillingBySymbol(_Symbol);

   g_lastBar = iTime(_Symbol, _Period, 0);

   // Reprise d'une position déjà ouverte (redémarrage EA).
   ulong tk = FindOurPosition();
   if(tk > 0 && PositionSelectByTicket(tk))
     {
      g_ticket = tk;
      g_posBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      g_entry  = PositionGetDouble(POSITION_PRICE_OPEN);
      g_sl     = g_posBuy ? g_entry - SLdist() : g_entry + SLdist();
      g_tp     = g_posBuy ? g_entry + TPdist() : g_entry - TPdist();
      g_beStop = g_posBuy ? g_entry + BElvl()  : g_entry - BElvl();
      g_beArmed = false;                 // état BE non conservé au redémarrage
      g_state  = ST_POS;
      Print("rFVG-EA : position existante adoptée, niveaux virtuels reconstruits.");
     }

   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, PFX);
   if(g_handle != INVALID_HANDLE)
      IndicatorRelease(g_handle);
   ChartRedraw();
  }

//======================= LECTURE DU SIGNAL =========================
// À la nouvelle bougie, lit Side au shift 2 et arme l'entrée (marché ou virtuelle).
void ReadSignalOnNewBar()
  {
   double side[];
   ArraySetAsSeries(side, true);
   if(CopyBuffer(g_handle, 2, 0, 4, side) < 3)     // buffer 2 = Side
      return;

   double s = side[2];                              // centrale = shift 2
   if(s > -0.5 && s < 0.5)                          // 0 → pas de motif
      return;

   bool   isBull = (s > 0.5);
   double open1  = iOpen(_Symbol, _Period, 1);      // 3e bougie = shift 1
   double close1 = iClose(_Symbol, _Period, 1);

   // 3e bougie à contre-sens du rFVG ? (cas super)
   bool contra = isBull ? (close1 < open1) : (close1 > open1);

   if(contra)
      EnterMarket(isBull);                          // entrée marché immédiate
   else
     {
      g_pendBuy     = isBull;                        // entrée virtuelle au retour
      g_pendLevel   = open1;                         // niveau = ouverture de la 3e
      g_centralTime = iTime(_Symbol, _Period, 2);
      g_state       = ST_PENDING;
     }
  }

//======================= ENTRÉE ====================================
void EnterMarket(bool isBuy)
  {
   bool ok = isBuy ? trade.Buy(InpLot, _Symbol, 0.0, 0.0, 0.0, "rFVG")
                   : trade.Sell(InpLot, _Symbol, 0.0, 0.0, 0.0, "rFVG");
   if(!ok)
     {
      Print("rFVG-EA : échec entrée ", (isBuy ? "BUY" : "SELL"),
            " — retcode ", trade.ResultRetcode());
      return;
     }

   ulong tk = FindOurPosition();
   if(tk == 0 || !PositionSelectByTicket(tk))
      return;

   g_ticket = tk;
   g_posBuy = isBuy;
   g_entry  = PositionGetDouble(POSITION_PRICE_OPEN);
   g_sl     = isBuy ? g_entry - SLdist() : g_entry + SLdist();
   g_tp     = isBuy ? g_entry + TPdist() : g_entry - TPdist();
   g_beStop = isBuy ? g_entry + BElvl()  : g_entry - BElvl();
   g_beArmed = false;
   g_state  = ST_POS;
  }

//======================= ATTENTE VIRTUELLE (tick) ==================
void CheckPendingTouch()
  {
   bool touched = g_pendBuy ? (Ask() <= g_pendLevel) : (Bid() >= g_pendLevel);
   if(touched)
      EnterMarket(g_pendBuy);
  }

// Expiration de l'entrée virtuelle : centrale + expiry bougies (comme la stratégie).
void CheckPendingExpiry()
  {
   int k = iBarShift(_Symbol, _Period, g_centralTime);   // âge de la centrale en bougies
   if(k > InpExpiryBars)
      g_state = ST_FLAT;                                  // abandon, rien à annuler
  }

//======================= GESTION POSITION (tick) ===================
void ManagePosition()
  {
   if(!PositionSelectByTicket(g_ticket))                 // clôturée hors EA
     {
      g_state = ST_FLAT; g_ticket = 0; return;
     }

   double bid = Bid(), ask = Ask();

   if(g_posBuy)
     {
      double stop = g_beArmed ? g_beStop : g_sl;
      if(bid <= stop)              { ClosePosition(g_beArmed ? "be" : "sl", bid); return; }
      if(bid >= g_tp)              { ClosePosition("tp", bid); return; }
      if(InpBEThreshPoints > 0 && !g_beArmed && (bid - g_entry) >= BEth())
        {
         g_beArmed = true;                               // armement du break-even
         if(bid <= g_beStop)       { ClosePosition("be", bid); return; }
        }
     }
   else
     {
      double stop = g_beArmed ? g_beStop : g_sl;
      if(ask >= stop)              { ClosePosition(g_beArmed ? "be" : "sl", ask); return; }
      if(ask <= g_tp)              { ClosePosition("tp", ask); return; }
      if(InpBEThreshPoints > 0 && !g_beArmed && (g_entry - ask) >= BEth())
        {
         g_beArmed = true;
         if(ask >= g_beStop)       { ClosePosition("be", ask); return; }
        }
     }
  }

//======================= CLÔTURE + STATS ===========================
void ClosePosition(string reason, double exitPrice)
  {
   double profit = 0.0;
   if(PositionSelectByTicket(g_ticket))
      profit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);

   if(!trade.PositionClose(g_ticket))
     {
      Print("rFVG-EA : échec clôture — retcode ", trade.ResultRetcode());
      return;                                            // on réessaiera au prochain tick
     }

   double risk = SLdist();
   double r = (risk > 0) ? (g_posBuy ? (exitPrice - g_entry) : (g_entry - exitPrice)) / risk : 0.0;

   g_nTrades++;
   g_sumR      += r;
   g_netProfit += profit;
   if(reason == "tp")      g_nTP++;
   else if(reason == "sl") g_nSL++;
   else                    g_nBE++;

   g_state = ST_FLAT; g_ticket = 0;
  }

//======================= ONTICK ====================================
void OnTick()
  {
   if(g_handle == INVALID_HANDLE)
      return;

   // Logique « nouvelle bougie ».
   datetime bt = iTime(_Symbol, _Period, 0);
   if(bt != g_lastBar)
     {
      g_lastBar = bt;
      if(g_state == ST_PENDING)
         CheckPendingExpiry();
      // Lecture d'un nouveau signal : seulement si libre.
      bool canRead = (g_state == ST_FLAT) ||
                     (g_state == ST_PENDING && !InpBlockOnPending);
      if(canRead)
         ReadSignalOnNewBar();
     }

   // Surveillance tick par tick.
   if(g_state == ST_POS)
      ManagePosition();
   else if(g_state == ST_PENDING)
      CheckPendingTouch();

   UpdateDashboard();
   UpdateRuler();
  }

//======================= DASHBOARD =================================
void UI_Text(string key, int x, int y, string txt, color clr, int fs = 9, string font = "Consolas")
  {
   string n = PFX + key;
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

void UI_Panel(int x, int y, int w, int h)
  {
   string n = PFX + "bg";
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
      ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'22,26,34');
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, n, OBJPROP_COLOR, C'55,65,81');
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
  }

void UpdateDashboard()
  {
   if(!InpShowDash)
     { ObjectsDeleteAll(0, PFX + "d_"); ObjectDelete(0, PFX + "bg"); return; }

   int x = InpDashX, y = InpDashY, w = 268, lh = 17;
   UI_Panel(x - 6, y - 6, w, 12 * lh + 14);
   int row = 0;

   // En-tête + badge d'état.
   string stTxt = g_state == ST_POS ? "EN POSITION" : g_state == ST_PENDING ? "ATTENTE" : "LIBRE";
   color  stCol = g_state == ST_POS ? (g_posBuy ? C'38,166,154' : C'239,83,80')
                  : g_state == ST_PENDING ? clrGoldenrod : clrSilver;
   UI_Text("d_title", x, y + lh * row++, "◆ rFVG EA", clrWhite, 11, "Consolas Bold");
   UI_Text("d_state", x + 150, y + lh * (row - 1), stTxt, stCol, 10, "Consolas Bold");

   // Bloc position / attente.
   if(g_state == ST_POS)
     {
      UI_Text("d_pos", x, y + lh * row++, (g_posBuy ? "BUY  @ " : "SELL @ ") + DoubleToString(g_entry, _Digits),
              stCol, 9);
      UI_Text("d_sl", x, y + lh * row++, "SL " + DoubleToString(g_sl, _Digits) +
              (g_beArmed ? "  (BE armé → " + DoubleToString(g_beStop, _Digits) + ")" : ""),
              C'239,83,80', 9);
      UI_Text("d_tp", x, y + lh * row++, "TP " + DoubleToString(g_tp, _Digits), C'38,166,154', 9);
     }
   else if(g_state == ST_PENDING)
     {
      UI_Text("d_pos", x, y + lh * row++, (g_pendBuy ? "Attend BUY" : "Attend SELL") +
              " @ " + DoubleToString(g_pendLevel, _Digits), clrGoldenrod, 9);
      UI_Text("d_sl", x, y + lh * row++, " ", clrSilver, 9);
      UI_Text("d_tp", x, y + lh * row++, " ", clrSilver, 9);
     }
   else
     {
      UI_Text("d_pos", x, y + lh * row++, "En attente de signal…", clrSilver, 9);
      UI_Text("d_sl", x, y + lh * row++, " ", clrSilver, 9);
      UI_Text("d_tp", x, y + lh * row++, " ", clrSilver, 9);
     }

   UI_Text("d_sep1", x, y + lh * row++, "──────────────────────────", C'55,65,81', 9);

   // Statistiques.
   double rr       = (InpSLPoints > 0) ? InpTPPoints / InpSLPoints : 0.0;
   double winrate  = (g_nTrades > 0) ? 100.0 * g_nTP / g_nTrades : 0.0;
   double beWin    = (1.0 + rr > 0) ? 100.0 / (1.0 + rr) : 0.0;   // winrate de rentabilité
   double expR     = (g_nTrades > 0) ? g_sumR / g_nTrades : 0.0;
   color  expCol   = expR > 0 ? C'38,166,154' : expR < 0 ? C'239,83,80' : clrSilver;
   color  pnlCol   = g_netProfit > 0 ? C'38,166,154' : g_netProfit < 0 ? C'239,83,80' : clrSilver;

   UI_Text("d_tr",  x, y + lh * row++, "Trades   " + (string)g_nTrades +
           "   (TP " + (string)g_nTP + " · SL " + (string)g_nSL + " · BE " + (string)g_nBE + ")", clrGainsboro, 9);
   UI_Text("d_wr",  x, y + lh * row++, "Winrate  " + DoubleToString(winrate, 1) + " %" +
           "   (seuil " + DoubleToString(beWin, 1) + " %)", clrGainsboro, 9);
   UI_Text("d_rr",  x, y + lh * row++, "RR conf. " + DoubleToString(rr, 2) +
           "   (SL " + DoubleToString(InpSLPoints, 0) + " / TP " + DoubleToString(InpTPPoints, 0) + " pts)", clrGainsboro, 9);
   UI_Text("d_exp", x, y + lh * row++, "Espérance " + DoubleToString(expR, 3) + " R/trade", expCol, 9);
   UI_Text("d_pnl", x, y + lh * row++, "P&L net   " + DoubleToString(g_netProfit, 2) + " " +
           AccountInfoString(ACCOUNT_CURRENCY), pnlCol, 9);

   ChartRedraw();
  }

//======================= CONFIGURATEUR / RÈGLE =====================
void RulerLine(string key, double price, color clr, string txt)
  {
   string ln = PFX + "r_l_" + key;
   if(ObjectFind(0, ln) < 0)
     {
      ObjectCreate(0, ln, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, ln, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, ln, OBJPROP_BACK, true);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ln, OBJPROP_HIDDEN, true);
     }
   ObjectSetDouble(0,  ln, OBJPROP_PRICE, price);
   ObjectSetInteger(0, ln, OBJPROP_COLOR, clr);

   string tx = PFX + "r_t_" + key;
   datetime at = iTime(_Symbol, _Period, 0);
   if(ObjectFind(0, tx) < 0)
     {
      ObjectCreate(0, tx, OBJ_TEXT, 0, at, price);
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_LEFT);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
      ObjectSetString(0,  tx, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 8);
     }
   ObjectMove(0, tx, 0, at, price);
   ObjectSetString(0,  tx, OBJPROP_TEXT, " " + txt);
   ObjectSetInteger(0, tx, OBJPROP_COLOR, clr);
  }

void UpdateRuler()
  {
   if(!InpShowRuler)
     { ObjectsDeleteAll(0, PFX + "r_"); return; }

   double p = Bid();
   color  g = C'38,166,154', r = C'239,83,80', o = clrGoldenrod;
   bool   lng = (InpRulerSide == RULER_LONG);
   string dir = lng ? "LONG" : "SHORT";

   // Un seul sens : TP et SL du côté correspondant, seuil BE côté profit.
   double tpPrice = lng ? p + TPdist() : p - TPdist();
   double slPrice = lng ? p - SLdist() : p + SLdist();
   RulerLine("tp", tpPrice, g, "TP " + dir + " " + DoubleToString(InpTPPoints, 0) + " pts");
   RulerLine("sl", slPrice, r, "SL " + dir + " " + DoubleToString(InpSLPoints, 0) + " pts");

   if(InpBEThreshPoints > 0)
     {
      double bePrice = lng ? p + BEth() : p - BEth();
      RulerLine("be", bePrice, o, "seuil BE " + dir + " " + DoubleToString(InpBEThreshPoints, 0) + " pts");
     }
   else
     { ObjectDelete(0, PFX + "r_l_be"); ObjectDelete(0, PFX + "r_t_be"); }
  }
//+------------------------------------------------------------------+
