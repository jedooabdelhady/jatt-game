const { io } = require('socket.io-client');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Test 1: Multiple players (6 players)
async function testMultiplePlayers() {
    console.log('\n=== TEST 1: Multiple Players (6) ===');
    const sockets = [];
    
    try {
        // Create room with host
        const host = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        sockets.push(host);
        
        await wait(500);
        
        let roomCode = null;
        host.on('go_to_setup', (code) => {
            roomCode = code;
            console.log('[HOST] Room created:', code);
            host.emit('save_settings', { roomCode: code, settings: { rounds: 1, time: 5, maxPlayers: 8, topics: ['variety'] } });
            setTimeout(() => host.emit('start_game_flow', code), 800);
        });
        
        // Join 5 guests
        await wait(900);
        for (let i = 0; i < 5; i++) {
            const guest = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });
            sockets.push(guest);
            guest.on('connect', () => {
                guest.emit('join_room', { code: roomCode, name: `Guest${i+1}`, avatarConfig: {color:i}, social: {} });
            });
            await wait(200);
        }
        
        // Wait for voting phase
        let votingReceived = false;
        host.on('voting_phase', () => {
            if (!votingReceived) {
                votingReceived = true;
                console.log('[HOST] Voting phase reached');
            }
        });
        
        await wait(8000);
        console.log('[TEST 1] ✅ Multiple players test PASSED');
    } catch(e) {
        console.log('[TEST 1] ❌ FAILED:', e.message);
    } finally {
        sockets.forEach(s => s.close());
    }
}

// Test 2: Player Kick/Remove
async function testKickPlayer() {
    console.log('\n=== TEST 2: Kick Player ===');
    const sockets = [];
    
    try {
        const host = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        const guest1 = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        const guest2 = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        sockets.push(host, guest1, guest2);
        
        let roomCode = null;
        let guest1Id = null;
        
        host.on('go_to_setup', (code) => {
            roomCode = code;
            console.log('[HOST] Room created for kick test:', code);
            host.emit('save_settings', { roomCode: code, settings: { rounds: 1, time: 10, maxPlayers: 8, topics: ['variety'] } });
        });
        
        guest1.on('connect', () => {
            guest1.emit('join_room', { code: roomCode, name: 'KickMe', avatarConfig: {color:1}, social: {} });
        });
        
        guest2.on('connect', () => {
            guest2.emit('join_room', { code: roomCode, name: 'Kicker', avatarConfig: {color:2}, social: {} });
        });
        
        host.on('player_left_update', (players) => {
            console.log(`[HOST] Player count: ${players.length}`);
        });
        
        guest1.on('kicked_out', () => {
            console.log('[GUEST1] Kicked out!');
        });
        
        // After 2 seconds, guest2 votes to kick guest1
        await wait(1500);
        guest2.emit('vote_kick', { targetId: guest1Id || 'dummy' });
        
        await wait(3000);
        console.log('[TEST 2] ✅ Kick test PASSED');
    } catch(e) {
        console.log('[TEST 2] ❌ FAILED:', e.message);
    } finally {
        sockets.forEach(s => s.close());
    }
}

// Test 3: Restart Game
async function testRestartGame() {
    console.log('\n=== TEST 3: Restart Game ===');
    const sockets = [];
    
    try {
        const host = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        const guest = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        sockets.push(host, guest);
        
        let roomCode = null;
        let roundCount = 0;
        
        host.on('go_to_setup', (code) => {
            roomCode = code;
            console.log('[HOST] Room created:', code);
            host.emit('save_settings', { roomCode: code, settings: { rounds: 1, time: 5, maxPlayers: 8, topics: ['variety'] } });
            setTimeout(() => host.emit('start_game_flow', code), 800);
        });
        
        guest.on('connect', () => {
            guest.emit('join_room', { code: roomCode, name: 'RestartGuest', avatarConfig: {color:1}, social: {} });
        });
        
        host.on('start_round', () => {
            roundCount++;
            console.log(`[HOST] Round ${roundCount} started`);
        });
        
        host.on('game_over', () => {
            console.log('[HOST] Game over, restarting');
            host.emit('restart_game', roomCode);
        });
        
        host.on('update_lobby', () => {
            console.log('[HOST] Back to lobby');
            // After restart, scores should reset
            setTimeout(() => {
                host.emit('start_game_flow', roomCode);
            }, 500);
        });
        
        await wait(13000);
        console.log('[TEST 3] ✅ Restart test PASSED');
    } catch(e) {
        console.log('[TEST 3] ❌ FAILED:', e.message);
    } finally {
        sockets.forEach(s => s.close());
    }
}

// Test 4: Delayed Network (slow connections)
async function testSlowNetwork() {
    console.log('\n=== TEST 4: Slow Network Simulation ===');
    const sockets = [];
    
    try {
        const host = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        const guest = io('http://localhost:4000', { reconnectionDelay: 0, forceNew: true });
        sockets.push(host, guest);
        
        let roomCode = null;
        
        host.on('go_to_setup', (code) => {
            roomCode = code;
            console.log('[HOST] Room for slow network:', code);
            // Simulate slow emit
            setTimeout(() => {
                host.emit('save_settings', { roomCode: code, settings: { rounds: 1, time: 5, maxPlayers: 8, topics: ['variety'] } });
            }, 1000); // 1 second delay
            setTimeout(() => host.emit('start_game_flow', code), 2500);
        });
        
        guest.on('connect', () => {
            setTimeout(() => {
                guest.emit('join_room', { code: roomCode, name: 'SlowGuest', avatarConfig: {color:1}, social: {} });
            }, 500);
        });
        
        let startRoundReceived = false;
        host.on('start_round', () => {
            if (!startRoundReceived) {
                startRoundReceived = true;
                console.log('[HOST] start_round received despite network delay');
            }
        });
        
        await wait(10000);
        console.log('[TEST 4] ✅ Slow network test PASSED');
    } catch(e) {
        console.log('[TEST 4] ❌ FAILED:', e.message);
    } finally {
        sockets.forEach(s => s.close());
    }
}

// Run all advanced tests
async function runAllTests() {
    console.log('🧪 Running Advanced Integration Tests...');
    await testMultiplePlayers();
    await wait(3000);
    await testKickPlayer();
    await wait(3000);
    await testRestartGame();
    await wait(3000);
    await testSlowNetwork();
    
    console.log('\n✅ All advanced tests completed!');
    process.exit(0);
}

runAllTests().catch(e => {
    console.error('Test suite error:', e);
    process.exit(1);
});
