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
  // M1.8: the renderer seam pulls in the sheet and overlay modules through the
  // Canvas renderer's existing import cycle, so their nodes must exist too.
  'limitsBtn', 'mathBtn', 'toast',
];

export function installDom(){
  document.body.innerHTML = IDS.map(id => `<div id="${id}"></div>`).join('')
    + '<input id="takeProfitIn" type="number">'
    + '<input id="stopLossIn" type="number">'
    // M1.8: the renderer seam imports the Canvas renderer, which resolves
    // #sceneWrap and #scene at module load exactly as the UI modules resolve
    // theirs. Tests that import the seam need both to exist first.
    + '<div id="sceneWrap"><canvas id="scene"></canvas></div>';

  // jsdom defines `getContext` but throws "not implemented" on it, so the stub
  // is assigned unconditionally rather than only when the method is absent.
  // The Canvas renderer needs `getContext` to return *something* at module
  // load; these tests assert on the seam, never on drawing commands, so a
  // no-op is the honest fixture here — a test that wanted to check pixels
  // would need a real canvas, not this.
  const canvas = document.querySelector('#scene');
  if (canvas) canvas.getContext = () => stubContext();
}

/** A 2D-context shape that records nothing and throws on nothing. */
function stubContext(){
  const noop = () => {};
  return new Proxy({}, {
    get(target, prop){
      if (prop in target) return target[prop];
      if (prop === 'canvas') return null;
      // Gradient factories must return an object with addColorStop.
      if (typeof prop === 'string' && prop.startsWith('create')){
        return () => ({ addColorStop: noop });
      }
      return noop;
    },
    set(target, prop, value){ target[prop] = value; return true; },
  });
}
