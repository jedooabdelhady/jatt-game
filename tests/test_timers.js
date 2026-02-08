// 🕐 Test specifically for voting and results timers
const { io } = require('socket.io-client');

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function run() {
  console.log('🕐 Testing Voting & Results Timers...');
  const host = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });
  const guest = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });

  let currentCode = null;
  let votingTimerReceived = false;
  let resultsTimerReceived = false;

  host.on('go_to_setup', (code) => {
    console.log('✓ Host setup:', code);
    currentCode = code;
    host.emit('save_settings', { roomCode: code, settings: { rounds: 1, time: 5, maxPlayers: 8, topics: ['variety'] } });
    setTimeout(()=> {
      console.log('✓ Starting game flow');
      host.emit('start_game_flow', code);
    }, 1200);
  });

  // Test 1: Question Phase Timer (baseline)
  host.on('start_round', (d) => {
    console.log('✓ Question Phase timer:', d.startTime && d.time ? 'YES' : 'NO');
  });
  guest.on('start_round', (d) => {
    console.log('✓ Guest received question');
  });

  // Test 2: Voting Phase Timer
  host.on('voting_phase', (d) => {
    console.log('✓ Voting phase received:', { hasTiming: !!d.startTime, hasTime: !!d.time });
    if (d.startTime && d.time) {
      console.log('✅ Voting Phase HAS TIMER');
      votingTimerReceived = true;
    }
  });
  guest.on('voting_phase', (d) => {
    console.log('✓ Guest voting phase');
  });

  // Test 3: Results Phase Timer
  host.on('show_results', (d) => {
    console.log('✓ Results received:', { hasTiming: !!d.startTime, hasTime: !!d.time });
    if (d.startTime && d.time) {
      console.log('✅ Results Phase HAS TIMER');
      resultsTimerReceived = true;
    }
    cleanup();
  });
  guest.on('show_results', (d) => {
    console.log('✓ Guest results');
  });

  host.on('choose_topic_phase', (d) => {
    console.log('✓ Choosing topic');
    host.emit('topic_selected', { roomCode: currentCode, topic: 'variety' });
  });

  guest.on('choose_topic_phase', (d) => {
    console.log('✓ Guest topic phase');
    if (d.chooserId === guest.id) {
      guest.emit('topic_selected', { roomCode: currentCode, topic: 'variety' });
    }
  });

  // Submit answer: guest submits
  guest.on('start_round', (d) => {
    console.log('✓ Guest will submit answer');
    setTimeout(() => {
      guest.emit('submit_answer', { roomCode: currentCode, answer: 'test' });
      console.log('✓ Guest submitted');
    }, 300);
  });

  // Submit answer: host submits
  host.on('start_round', (d) => {
    console.log('✓ Host will submit answer');
    setTimeout(() => {
      host.emit('submit_answer', { roomCode: currentCode, answer: 'truth' });
      console.log('✓ Host submitted');
    }, 300);
  });

  // Voting: both vote
  let hostVoted = false, guestVoted = false;
  host.on('voting_phase', (d) => {
    if (!hostVoted) {
      hostVoted = true;
      console.log('✓ Host voting');
      setTimeout(() => {
        if (d.options && d.options[0]) {
          host.emit('submit_vote', { roomCode: currentCode, choiceData: { id: d.options[0].id } });
          console.log('✓ Host voted');
        }
      }, 300);
    }
  });

  guest.on('voting_phase', (d) => {
    if (!guestVoted) {
      guestVoted = true;
      console.log('✓ Guest voting');
      setTimeout(() => {
        if (d.options && d.options[0]) {
          guest.emit('submit_vote', { roomCode: currentCode, choiceData: { id: d.options[0].id } });
          console.log('✓ Guest voted');
        }
      }, 300);
    }
  });

  host.on('error_msg', (msg) => console.log('❌ Error:', msg));
  guest.on('error_msg', (msg) => console.log('❌ Error:', msg));

  // Join as guest
  guest.emit('create_room', { name: 'GuestTimer', avatarConfig: {color:1}, social: {} });
  guest.on('join_room', (code) => {
    console.log('✓ Guest created room:', code);
    host.emit('join_room', { code, name: 'HostTimer', avatarConfig: {color:0}, social: {} });
  });

  host.on('update_lobby', (players) => {
    console.log('✓ Lobby updated:', players.length, 'players');
  });

  function cleanup() {
    setTimeout(() => {
      console.log('\n📊 Test Results:');
      console.log('  Voting Timer: ', votingTimerReceived ? '✅ PASS' : '❌ FAIL');
      console.log('  Results Timer:', resultsTimerReceived ? '✅ PASS' : '❌ FAIL');
      host.close();
      guest.close();
      process.exit(votingTimerReceived && resultsTimerReceived ? 0 : 1);
    }, 1000);
  }

  // Timeout
  setTimeout(() => {
    console.log('⏱️ Test timeout - results not reached');
    cleanup();
  }, 30000);
}

run().catch(e => { console.error('Test error:', e); process.exit(1); });
