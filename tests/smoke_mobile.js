const { io } = require('socket.io-client');
const SERVER = process.env.SERVER || 'http://localhost:3000';

function delay(ms){return new Promise(r=>setTimeout(r,ms));}

async function runSmoke(){
  console.log('Smoke test start ->', SERVER);

  const host = io(SERVER, { reconnection: false, timeout: 5000 });
  let roomCode = null;

  host.on('connect', () => console.log('[host] connected', host.id));
  host.on('go_to_setup', (code) => {
    console.log('[host] go_to_setup', code);
    roomCode = code;
  });
  host.on('update_lobby', (data) => console.log('[host] update_lobby', data.players.map(p=>p.name)));
  host.on('choose_topic_phase', (d) => {
    console.log('[host] choose_topic_phase', d);
    if (d.chooserId === host.id) {
      host.emit('topic_selected', { roomCode, topic: 'variety' });
    }
  });
  host.on('start_round', (d) => {
    console.log('[host] start_round', d.question ? d.question.slice(0,60) : '', 'time=', d.time, 'startTime=', d.startTime);
  });
  host.on('error_msg', (m) => console.log('[host] error', m));

  host.emit('create_private_room', { name: 'host-smoke', avatarConfig: {}, social: {} });

  // wait for roomCode
  for (let i=0;i<30 && !roomCode;i++){ await delay(200); }
  if (!roomCode){ console.error('No room code received'); host.disconnect(); process.exit(1); }

  // guest joins
  const guest = io(SERVER, { reconnection: false, timeout: 5000 });
  guest.on('connect', () => { console.log('[guest] connected', guest.id); guest.emit('join_room', { code: roomCode, name: 'guest-smoke', avatarConfig:{}, social:{} }); });
  guest.on('update_lobby', (data) => console.log('[guest] update_lobby', data.players.map(p=>p.name)));
  guest.on('error_msg', (m)=>console.log('[guest] error', m));

  // give time to settle
  await delay(500);

  // save settings with topics
  host.emit('save_settings', { roomCode, settings: { topics: ['variety'], time: 10, rounds: 1 } });
  await delay(200);

  // start game
  host.emit('start_game_flow', roomCode);

  // wait the round to start and finish
  await delay(15000);

  host.disconnect(); guest.disconnect();
  console.log('Smoke test finished');
  process.exit(0);
}

runSmoke().catch(e=>{ console.error('Smoke error', e); process.exit(1); });
