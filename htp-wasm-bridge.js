import init, { calculateFee, calculateWinnerPayout, skillWinPot, hedgeClaim, eventWinStdStake, boardApplyMove } from './pkg/htp_rust_backend.js';

let wasmReady = false;

async function loadWasm() {
    await init();
    wasmReady = true;
    console.log('[HTP WASM] Bridge loaded');
}

window.HTP = window.HTP || {};
window.HTP.feeEngine = {
    skillWinPot: (sompi) => {
        const [p, f] = skillWinPot(BigInt(sompi));
        return [BigInt(p), BigInt(f)];
    },
    hedgeClaim: (sompi) => {
        const [p, f] = hedgeClaim(BigInt(sompi));
        return [BigInt(p), BigInt(f)];
    },
    eventWinStdStake: (sompi, num, den) => {
        const [p, f] = eventWinStdStake(BigInt(sompi), BigInt(num), BigInt(den));
        return [BigInt(p), BigInt(f)];
    },
};
window.HTP.boardEngine = {
    applyMove: (stateJson, moveSan) => boardApplyMove(stateJson, moveSan),
};
window.HTP.covenant = {};

loadWasm();
