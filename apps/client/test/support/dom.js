/* ================================================================
   DOM skeleton for the client tests.

   `ui/dom-refs.js` resolves every node at module load with
   `document.querySelector`, so any test that transitively imports a UI module
   needs those ids to exist BEFORE the import. Call `installDom()` from a
   top-level statement in the test file, above the `await import(...)` of the
   module under test.

   This is a fixture, not a mock: the tests that need it do not assert on the
   DOM, they only need dom-refs.js to not throw on a null node. Everything the
   tests actually assert about is mocked at the module boundary instead
   (see mocks.js), which is what keeps these tests about the seams rather than
   about markup that M1.8 deletes.
================================================================ */

const IDS = [
  'feed', 'historyStrip', 'centerOverlay', 'scrim', 'soundBtn',
  'idxVal', 'idxSub', 'zoneName', 'roundTimer', 'balance', 'stakeVal',
  'betPanel', 'armedPanel', 'cashPanel', 'armedTxt', 'cashAmt', 'cashMult',
  'cashLabel', 'btnCash', 'piLeft', 'o2Fill', 'hatchMsg', 'piRight',
  'consoleMsg', 'btnSurface', 'btnDive', 'sessionClock', 'stakeDown', 'stakeUp',
  'armedCancel',
  'setLimitBtn', 'lossLimitIn', 'limitNote', 'lsTime', 'lsWagered', 'lsNet',
  'rcContinue', 'rcLimits', 'rcModal', 'rcTime', 'rcWagered', 'rcNet',
  'limitsSheet',
];

export function installDom(){
  document.body.innerHTML = IDS.map(id => `<div id="${id}"></div>`).join('')
    + '<input id="takeProfitIn" type="number">'
    + '<input id="stopLossIn" type="number">';
}
