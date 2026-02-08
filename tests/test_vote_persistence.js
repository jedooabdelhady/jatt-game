const { io } = require('socket.io-client');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    console.log('🧪 Testing Vote Persistence During Reconnect\n');
    
    const host = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });
    const guest = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });
    
    let currentCode = null;
    let hostReceivedVoting = false;
    let guestVoted = false;
    
    host.on('connect', () => console.log('[HOST] connected', host.id));
    guest.on('connect', () => console.log('[GUEST] connected', guest.id));
    
    host.on('go_to_setup', (code) => {
        console.log('[HOST] go_to_setup', code);
        currentCode = code;
        host.emit('save_settings', { roomCode: code, settings: { rounds: 1, time: 3, maxPlayers: 8, topics: ['variety'] } });
        setTimeout(() => host.emit('start_game_flow', code), 1200);
    });
    
    host.on('start_round', (d) => console.log('[HOST] start_round'));
    guest.on('start_round', (d) => console.log('[GUEST] start_round'));
    
    // Simulate reconnection attempt during voting
    guest.on('voting_phase', (data) => {
        guestVoted = true;
        console.log('[GUEST] voting_phase - will rejoin in 500ms');
        guest.emit('submit_vote', { roomCode: currentCode, choiceData: data.options[0] });
        console.log('[GUEST] submitted vote, now disconnecting');
        
        setTimeout(() => {
            const rejoin = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });
            let rejoinState = null;
            
            rejoin.on('connect', () => {
                console.log('[REJOIN] connected', rejoin.id);
                rejoin.emit('rejoin_game', { 
                    roomCode: currentCode, 
                    name: 'GuestUser',
                    avatarConfig: {},
                    social: {}
                });
            });
            
            rejoin.on('rejoin_success', (state) => {
                rejoinState = state;
                console.log('\n[REJOIN SUCCESS] Received state:');
                console.log(`    gameState: ${state.gameState}`);
                console.log(`    hasVoted: ${state.hasVoted}`);
                
                if (state.gameState === 'voting' && state.hasVoted) {
                    console.log('\n✅ PASS: Vote persisted on reconnect!');
                } else if (state.gameState === 'voting' && !state.hasVoted) {
                    console.log('\n⚠️  WARNING: hasVoted is false (client should restore from sessionStorage)');
                } else {
                    console.log(`\n⏭️  Game state changed to: ${state.gameState}`);
                }
                
                rejoin.close();
                setTimeout(() => finalize(), 500);
            });
            
            rejoin.on('error_msg', m => console.log('[REJOIN ERR]', m));
        }, 500);
    });
    
    host.on('choose_topic_phase', (d) => {
        console.log('[HOST] choose_topic_phase');
        host.emit('topic_selected', { roomCode: currentCode, topic: 'variety' });
    });
    
    guest.on('choose_topic_phase', (d) => {
        console.log('[GUEST] choose_topic_phase');
        if (d.chooserId === guest.id) {
            guest.emit('topic_selected', { roomCode: currentCode, topic: 'variety' });
        }
    });
    
    host.on('voting_phase', (data) => {
        hostReceivedVoting = true;
        console.log('[HOST] voting_phase');
        host.emit('submit_vote', { roomCode: currentCode, choiceData: data.options[1] });
    });
    
    function finalize() {
        console.log('\n✅ Test Complete');
        host.close();
        guest.close();
        process.exit(0);
    }
    
    // Timeout safeguard
    setTimeout(() => {
        if (!hostReceivedVoting) {
            console.log('❌ Timeout: voting phase never reached');
        }
        finalize();
    }, 12000);
    
    // Start the game
    console.log('\n[HOST] Starting game...');
    host.emit('join_game', { name: 'HostUser', roomCode: 'null', avatarConfig: {} });
    
    // Guest joins after a moment
    await wait(800);
    console.log('[GUEST] Joining room...');
    guest.emit('join_game', { name: 'GuestUser', roomCode: currentCode || 'null', avatarConfig: {} });
}

run().catch(console.error);
