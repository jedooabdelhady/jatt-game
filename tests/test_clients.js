const { io } = require('socket.io-client');

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function run() {
  const host = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });
  const guest = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });

  host.on('connect', () => console.log('[HOST] connected', host.id));
  guest.on('connect', () => console.log('[GUEST] connected', guest.id));

  let currentCode = null;
  host.on('go_to_setup', (code) => {
    console.log('[HOST] go_to_setup', code);
    currentCode = code;
    // host will save settings then wait for guest
    host.emit('save_settings', { roomCode: code, settings: { rounds: 1, time: 8, maxPlayers: 8, topics: ['variety'] } });
    // wait a bit then start flow after guest joins
    setTimeout(()=> host.emit('start_game_flow', code), 1200);
  });

  host.on('start_round', (d)=> console.log('[HOST] start_round', d));
  guest.on('start_round', (d)=> console.log('[GUEST] start_round', d));

  // simulate reconnection: create a new socket that tries to rejoin while original guest still connected
  guest.on('start_round', (d) => {
    console.log('[GUEST] will attempt simulated rejoin in 1500ms');
    setTimeout(() => {
      const rejoin = io('http://localhost:3000', { reconnectionDelay: 0, forceNew: true });
      rejoin.on('connect', () => {
        console.log('[REJOIN] connected', rejoin.id, '-> emitting rejoin_game');
        rejoin.emit('rejoin_game', { roomCode: currentCode, name: 'GuestUser', avatarConfig: {color:1}, social: {} });
      });
      rejoin.on('rejoin_success', (s) => { console.log('[REJOIN] rejoin_success', s); rejoin.close(); });
      rejoin.on('error_msg', m => console.log('[REJOIN ERR]', m));
    }, 1500);
  });

  host.on('choose_topic_phase', (d)=> {
    console.log('[HOST] choose_topic_phase', d);
    // choose first topic
    host.emit('topic_selected', { roomCode: currentCode, topic: 'variety' });
  });
  guest.on('choose_topic_phase', (d)=> console.log('[GUEST] choose_topic_phase', d));
  guest.on('choose_topic_phase', (d)=> {
    console.log('[GUEST] choose_topic_phase', d);
    if (d.chooserId === guest.id) {
      // I'm the chooser, pick topic
      console.log('[GUEST] I am chooser, selecting topic');
      guest.emit('topic_selected', { roomCode: currentCode, topic: 'variety' });
    }
  });

  host.on('voting_phase', (d)=> console.log('[HOST] voting_phase', d));
  guest.on('voting_phase', (d)=> console.log('[GUEST] voting_phase', d));

  host.on('show_results', (d)=> { console.log('[HOST] show_results', d); cleanup(); });
  guest.on('show_results', (d)=> { console.log('[GUEST] show_results', d); cleanup(); });

  // Create room as host
  host.emit('create_private_room', { name: 'HostUser', avatarConfig: {color:0}, social: {} });

  // When host receives go_to_setup it will start; need guest to join after some small delay
  host.on('go_to_setup', (code) => {
    // guest joins after slight delay
    setTimeout(() => {
      guest.emit('join_room', { code, name: 'GuestUser', avatarConfig: {color:1}, social: {} });
    }, 400);
  });

  // basic logging
  [host, guest].forEach(s => {
    s.on('error_msg', m => console.log('[ERR]', m));
    s.on('connect_error', e => console.log('[CONNECT_ERR]', e && e.message));
  });

  // cleanup helper
  let cleaned = false;
  function cleanup(){
    if(cleaned) return; cleaned = true;
    setTimeout(()=>{ host.close(); guest.close(); console.log('Test finished.'); process.exit(0); }, 1000);
  }

  // safety timeout
  setTimeout(()=>{ console.log('Test timeout, exiting'); cleanup(); }, 30000);
}

run().catch(e=>{ console.error(e); process.exit(1); });
