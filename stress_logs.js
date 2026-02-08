const { io } = require('socket.io-client');

const SERVER = process.env.SERVER || 'http://localhost:4000';
const TOTAL = parseInt(process.env.TOTAL || '2000', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '50', 10);
const DELAY_MS = parseInt(process.env.DELAY_MS || '30', 10);

let started = 0;
let completed = 0;

function makeClient(i) {
    return new Promise((resolve) => {
        const socket = io(SERVER, { reconnection: false, timeout: 5000 });
        socket.on('connect', () => {
            socket.emit('create_private_room', { name: `stress-${i}`, avatarConfig: {}, social: {} });
            setTimeout(() => {
                try { socket.disconnect(); } catch(e){}
                completed++;
                resolve();
            }, DELAY_MS);
        });
        socket.on('connect_error', () => { completed++; resolve(); });
        socket.on('error', () => { completed++; resolve(); });
    });
}

async function runBatch() {
    const batch = [];
    while (started < TOTAL && batch.length < CONCURRENCY) {
        const i = started++;
        batch.push(makeClient(i));
    }
    await Promise.all(batch);
}

(async () => {
    console.log('Stress test start:', { SERVER, TOTAL, CONCURRENCY, DELAY_MS });
    while (completed < TOTAL) {
        await runBatch();
        process.stdout.write(`\rProgress: ${completed}/${TOTAL}`);
        await new Promise(r => setTimeout(r, 50));
    }
    console.log('\nStress test completed');
    process.exit(0);
})();
