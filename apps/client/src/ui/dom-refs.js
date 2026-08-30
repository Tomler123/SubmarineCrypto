import { $ } from '../util/dom.js';

/* ================================================================
   DOM refs — cached nodes shared by the UI modules.
================================================================ */
export const feedEl = $('#feed');
export const histEl = $('#historyStrip');
export const overlayEl = $('#centerOverlay');
export const scrim=$('#scrim');
export const soundBtn=$('#soundBtn');

export const el={
  idxVal:$('#idxVal'), idxSub:$('#idxSub'), zone:$('#zoneName'),
  rTimer:$('#roundTimer'), bal:$('#balance'), stakeVal:$('#stakeVal'),
  betPanel:$('#betPanel'), armedPanel:$('#armedPanel'), cashPanel:$('#cashPanel'),
  armedTxt:$('#armedTxt'), cashAmt:$('#cashAmt'), cashMult:$('#cashMult'),
  cashLabel:$('#cashLabel'), btnCash:$('#btnCash'), piLeft:$('#piLeft'),
  o2Fill:$('#o2Fill'), hatch:$('#hatchMsg'),
  piRight:$('#piRight'), msg:$('#consoleMsg'),
  takeProfit:$('#takeProfitIn'), stopLoss:$('#stopLossIn'),
  btnS:$('#btnSurface'), btnD:$('#btnDive'), session:$('#sessionClock')
};
