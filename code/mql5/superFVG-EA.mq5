//+------------------------------------------------------------------+
//|                                                  superFVG-EA.mq5 |
//|   Expert Advisor superFVG — machine à états, 100 % au marché     |
//|                                                                  |
//|  AUTONOME : la détection est DANS l'EA (aucun iCustom), portage  |
//|  fidèle de calcRFVG(mode:'super') — lib/patterns.js.             |
//|                                                                  |
//|  AUCUN ordre en attente, AUCUN SL/TP côté broker. Tout est géré  |
//|  au tick : l'EA ouvre au marché, surveille, ferme au marché.     |
//|                                                                  |
//|  ── LE MOTIF (3 bougies : B1 précédente, B2 centrale, B3 suivante)|
//|  B2 est directionnelle et LARGE : sa taille (corps ou amplitude)  |
//|  vaut au moins x × ATR, l'ATR étant lu sur B1 — AVANT elle, sinon |
//|  il contiendrait déjà la bougie à qualifier.                     |
//|  B2 est ENTIÈREMENT à contre-courant de son côté des deux MM :    |
//|    • baissière → son PLUS BAS est au-dessus des DEUX MM          |
//|    • haussière → son PLUS HAUT est en dessous des DEUX MM        |
//|  B1 et B3 définissent deux niveaux dont l'écart SIGNÉ est le gap :|
//|    • baissier : gap = bas(B1) − haut(B3)                         |
//|    • haussier : gap = bas(B3) − haut(B1)                         |
//|    gap > 0 → vide entre les bougies · gap < 0 → chevauchement,    |
//|    la zone devient leur bande commune. « Gap minimum » est SIGNÉ  |
//|    et décide seul : 0 = vide strict · négatif = chevauchement     |
//|    toléré. Un gap nul est rejeté (zone plate).                   |
//|  SUPER : B3 doit clôturer à CONTRE-SENS du motif (motif baissier  |
//|    → B3 haussière, et inversement). C'est la double réfutation.  |
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
#property copyright   "Grapher — EA superFVG (machine à états, tick-by-tick)"
#property version     "1.00"
#property description "superFVG — détection intégrée, entrée à l'ouverture de B4,"
#property description "SL posé à la clôture de B4 sous/sur les extrêmes B3-B4,"
#property description "TP en points. Une seule position à la fois, tout au marché."

#include <Trade/Trade.mqh>

//--- énumérations
enum ENUM_SF_DIR
  {
   SF_BOTH = 0,  // Les deux sens
   SF_BULL = 1,  // Haussiers seulement (BUY)
   SF_BEAR = 2   // Baissiers seulement (SELL)
  };
enum ENUM_SF_SIZE
  {
   SF_BODY  = 0, // Corps (|clôture-ouverture|)
   SF_RANGE = 1  // Amplitude (haut-bas)
  };
enum ENUM_SF_SIZER
  {
   SIZER_UP   = 0, // Vers le haut (TP d'un BUY)
   SIZER_DOWN = 1  // Vers le bas (TP d'un SELL)
  };

//======================= INPUTS ====================================
input group "Détection superFVG"
input ENUM_SF_DIR  InpDirection   = SF_BOTH;   // Direction tradée
input int          InpMaFast      = 199;       // MM rapide — période
input int          InpMaSlow      = 201;       // MM lente — période
input ENUM_SF_SIZE InpSizeMode    = SF_BODY;   // Mesure de la taille de la centrale
input int          InpAtrPeriod   = 14;        // ATR — période
input double       InpAtrMult     = 1.0;       // Taille centrale >= ATR × (0 = filtre off)
input double       InpMinGapPts   = 0.0;       // Gap minimum (POINTS, SIGNÉ : <0 = chevauchement toléré)

input group "Position (distances en POINTS)"
input double InpTPPoints       = 500;          // TP — distance depuis l'entrée (points)
input double InpSLMarginPoints = 20;           // SL — marge sous/sur l'extrême B3-B4 (points)

input group "Trading"
input double InpLotMult   = 1.0;               // Lot = multiplicateur × lot minimal du symbole
input long   InpMagic     = 230726;            // Magic number
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
input ENUM_SF_SIZER InpSizerDir    = SIZER_UP; // Sens mesuré
input double        InpSizerPoints = 500;      // Distance mesurée (points)

//======================= ÉTAT ======================================
CTrade trade;

enum EA_STATE
  {
   ST_SEARCH  = 0,   // libre — on cherche un superFVG
   ST_POS_RAW = 1,   // en position, B4 en cours, SL pas encore connu
   ST_POS     = 2    // en position, SL armé
  };
EA_STATE g_state = ST_SEARCH;

// dernier motif détecté (mémorisé pour l'affichage)
struct SignalInfo
  {
   bool     valid;
   bool     isBull;
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

// handles indicateurs
int g_hFast = INVALID_HANDLE, g_hSlow = INVALID_HANDLE, g_hAtr = INVALID_HANDLE;

// suivi des bougies
datetime g_lastBar = 0;

// statistiques de session (remises à zéro au rechargement de l'EA)
int    g_nTrades = 0, g_nTP = 0, g_nSL = 0, g_nOther = 0;
double g_sumR = 0.0, g_sumRR = 0.0, g_netProfit = 0.0;
int    g_nR = 0;

// affichage
bool g_forceDraw = true;
uint g_lastDraw  = 0;

const string PFX = "sFVGea_";

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

// Lecture d'une valeur d'indicateur à un shift donné (0 = bougie en cours).
bool BufAt(const int handle, const int shift, double &out)
  {
   double tmp[];
   ArraySetAsSeries(tmp, true);
   if(CopyBuffer(handle, 0, shift, 1, tmp) < 1)
      return false;
   out = tmp[0];
   return (out != EMPTY_VALUE);
  }

//======================= INIT / DEINIT =============================
int OnInit()
  {
   if(InpTPPoints <= 0.0)
     {
      Print("superFVG-EA : TP en points doit être > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpMaFast < 1 || InpMaSlow < 1 || InpAtrPeriod < 1 || InpLotMult <= 0.0)
     {
      Print("superFVG-EA : périodes MM/ATR et multiplicateur de lot doivent être > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }

   g_hFast = iMA(_Symbol, _Period, InpMaFast, 0, MODE_SMA, PRICE_CLOSE);
   g_hSlow = iMA(_Symbol, _Period, InpMaSlow, 0, MODE_SMA, PRICE_CLOSE);
   g_hAtr  = iATR(_Symbol, _Period, InpAtrPeriod);
   if(g_hFast == INVALID_HANDLE || g_hSlow == INVALID_HANDLE || g_hAtr == INVALID_HANDLE)
     {
      Print("superFVG-EA : création des indicateurs impossible.");
      return INIT_FAILED;
     }

   trade.SetExpertMagicNumber((ulong)InpMagic);
   trade.SetDeviationInPoints((ulong)InpDeviation);
   trade.SetTypeFillingBySymbol(_Symbol);

   g_lastBar   = iTime(_Symbol, _Period, 0);
   g_sig.valid = false;

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
      Print("superFVG-EA : position reprise, SL reconstruit à ", DoubleToString(g_sl, _Digits));
     }
   else
     {
      g_state = ST_POS_RAW;
      Print("superFVG-EA : position reprise, SL en attente de la clôture de B4.");
     }
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, PFX);
   if(g_hFast != INVALID_HANDLE) IndicatorRelease(g_hFast);
   if(g_hSlow != INVALID_HANDLE) IndicatorRelease(g_hSlow);
   if(g_hAtr  != INVALID_HANDLE) IndicatorRelease(g_hAtr);
   ChartRedraw();
  }

//======================= DÉTECTION =================================
// Appelée à la NOUVELLE bougie : B3 vient de clore.
//   shift 3 = B1 (précédente) · shift 2 = B2 (centrale) · shift 1 = B3
// MM lues sur B2 (sa clôture est connue quand on la juge), ATR lu sur B1.
bool DetectSuperFVG(SignalInfo &out)
  {
   out.valid = false;

   const int need = InpMaSlow + InpAtrPeriod + 5;
   if(Bars(_Symbol, _Period) < need)
      return false;
   if(BarsCalculated(g_hFast) < need || BarsCalculated(g_hSlow) < need ||
      BarsCalculated(g_hAtr)  < need)
      return false;

   double maFast, maSlow, atr;
   if(!BufAt(g_hFast, 2, maFast)) return false;
   if(!BufAt(g_hSlow, 2, maSlow)) return false;
   if(!BufAt(g_hAtr,  3, atr))    return false;

   const double b1Low  = iLow(_Symbol,  _Period, 3);
   const double b1High = iHigh(_Symbol, _Period, 3);

   const double mOpen  = iOpen(_Symbol,  _Period, 2);
   const double mClose = iClose(_Symbol, _Period, 2);
   const double mHigh  = iHigh(_Symbol,  _Period, 2);
   const double mLow   = iLow(_Symbol,   _Period, 2);

   const double b3Open  = iOpen(_Symbol,  _Period, 1);
   const double b3Close = iClose(_Symbol, _Period, 1);
   const double b3High  = iHigh(_Symbol,  _Period, 1);
   const double b3Low   = iLow(_Symbol,   _Period, 1);

   // 1) Motif de base : la centrale est directionnelle.
   const bool baseBear = (mClose < mOpen);
   const bool baseBull = (mClose > mOpen);
   if(!baseBear && !baseBull)
      return false;

   // 2) Retournement : la centrale ENTIÈREMENT du côté opposé à son sens,
   //    sans toucher NI la MM rapide NI la MM lente — les deux à la fois.
   const bool maBear = (mLow  > maFast && mLow  > maSlow);
   const bool maBull = (mHigh < maFast && mHigh < maSlow);

   bool isBear = baseBear && maBear;
   bool isBull = baseBull && maBull;
   if(!isBear && !isBull)
      return false;

   // 3) SUPER : la 3e bougie clôture à contre-sens du motif.
   if(isBear && !(b3Close > b3Open)) isBear = false;
   if(isBull && !(b3Close < b3Open)) isBull = false;
   if(!isBear && !isBull)
      return false;

   // 4) Direction tradée.
   if(InpDirection == SF_BULL && !isBull) return false;
   if(InpDirection == SF_BEAR && !isBear) return false;

   // 5) Gap signé entre B1 et B3 : positif = vide, négatif = chevauchement.
   const double hi  = isBear ? b1Low  : b3Low;
   const double lo  = isBear ? b3High : b1High;
   const double gap = hi - lo;
   if(gap == 0.0 || gap < MinGap())
      return false;

   // 6) Taille de la centrale, mesurée contre l'ATR lu AVANT elle.
   const double size = (InpSizeMode == SF_BODY) ? MathAbs(mClose - mOpen) : (mHigh - mLow);
   if(InpAtrMult > 0.0 && size < InpAtrMult * atr)
      return false;

   out.valid    = true;
   out.isBull   = isBull;
   out.top      = (gap > 0.0) ? hi : lo;
   out.bottom   = (gap > 0.0) ? lo : hi;
   out.gap      = gap;
   out.size     = size;
   out.atr      = atr;
   out.tCentral = iTime(_Symbol, _Period, 2);
   return true;
  }

//======================= ENTRÉE ====================================
// Marché, à l'ouverture de B4 (premier tick de la nouvelle bougie).
void EnterMarket(const SignalInfo &sig)
  {
   const bool   isBuy = sig.isBull;
   const double lot   = TradeLot();

   bool ok = isBuy ? trade.Buy(lot, _Symbol, 0.0, 0.0, 0.0, "superFVG")
                   : trade.Sell(lot, _Symbol, 0.0, 0.0, 0.0, "superFVG");
   if(!ok)
     {
      Print("superFVG-EA : échec entrée ", (isBuy ? "BUY" : "SELL"),
            " — retcode ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
      return;
     }

   ulong tk = FindOurPosition();
   if(tk == 0 || !PositionSelectByTicket(tk))
     {
      Print("superFVG-EA : position introuvable après l'entrée — vérification au prochain tick.");
      return;
     }

   g_ticket    = tk;
   g_posBuy    = isBuy;
   g_entry     = PositionGetDouble(POSITION_PRICE_OPEN);
   g_lot       = PositionGetDouble(POSITION_VOLUME);
   g_tp        = isBuy ? g_entry + TPdist() : g_entry - TPdist();
   g_sl        = 0.0;                                   // inconnu tant que B4 n'est pas close
   g_entryTime = TimeCurrent();

   // Extrêmes de B3 (shift 1 à cet instant) + identité de B4 (bougie en cours).
   g_b3Low  = iLow(_Symbol,  _Period, 1);
   g_b3High = iHigh(_Symbol, _Period, 1);
   g_b4Time = iTime(_Symbol, _Period, 0);

   g_state     = ST_POS_RAW;
   g_forceDraw = true;

   PrintFormat("superFVG-EA : %s %s @ %s — B4 ouverte, SL à sa clôture (TP %s)",
               (isBuy ? "BUY" : "SELL"), DoubleToString(g_lot, LotDigits()),
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

   PrintFormat("superFVG-EA : SL armé à %s (%.0f pts du prix d'entrée).",
               DoubleToString(g_sl, _Digits), MathAbs(g_entry - g_sl) / _Point);
  }

//======================= GESTION POSITION (tick) ===================
void ManagePosition()
  {
   if(!PositionSelectByTicket(g_ticket))                  // clôturée hors EA
     {
      // Comptée pour que trades = TP + SL + autre reste vrai, mais son P&L
      // nous échappe (clôture manuelle, stop out, fermeture broker).
      Print("superFVG-EA : position disparue (clôture externe) — retour en RECHERCHE.");
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
      Print("superFVG-EA : échec clôture — retcode ", trade.ResultRetcode(),
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

   PrintFormat("superFVG-EA : sortie %s @ %s — %.0f pts, %.2f %s",
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

   // 2) …puis chercher un motif, uniquement si l'état est LIBRE.
   if(newBar && g_state == ST_SEARCH)
     {
      SignalInfo sig;
      if(DetectSuperFVG(sig))
        {
         g_sig = sig;
         if(InpDrawZones)
            DrawZone(sig);
         EnterMarket(sig);
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

   const int x = InpDashX, y = InpDashY, w = 300, lh = 16;
   const int rows = 20;                                   // cf. le compte des lignes ci-dessous
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
   UI_Text("d_title", x, y + lh * row, "◆ superFVG EA", clrWhite, 11, "Consolas Bold");
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
           "MM " + (string)InpMaFast + "/" + (string)InpMaSlow +
           " · " + (InpSizeMode == SF_BODY ? "corps" : "amplitude") +
           " ≥ " + DoubleToString(InpAtrMult, 2) + "×ATR" + (string)InpAtrPeriod, clrGainsboro, 8);

   if(g_sig.valid)
     {
      const color sc = g_sig.isBull ? COL_BULL : COL_BEAR;
      UI_Text("d_sig1", x, y + lh * row++,
              (g_sig.isBull ? "▲ BULL  " : "▼ BEAR  ") +
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
      ObjectSetString(0,  txt, OBJPROP_TEXT,       "superFVG");
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

   // Traductions : prix, argent au lot réellement tradé, et multiple d'ATR.
   double atr = 0.0;
   BufAt(g_hAtr, 1, atr);
   const double lot = (g_lot > 0.0 ? g_lot : TradeLot());
   const string txt =
      StringFormat("%s %.0f pts  =  %s en prix  =  %.2f %s @ %s lot%s",
                   (up ? "▲" : "▼"), InpSizerPoints,
                   DoubleToString(dist, _Digits),
                   Money(dist, lot), AccountInfoString(ACCOUNT_CURRENCY),
                   DoubleToString(lot, LotDigits()),
                   (atr > 0.0 ? StringFormat("  =  %.2f × ATR%d", dist / atr, InpAtrPeriod) : ""));

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
