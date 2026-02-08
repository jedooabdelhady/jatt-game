// 🔥 اختبار الإجهاد: 20 لاعب مع اختبار شامل
const { io } = require('socket.io-client');

const NUM_PLAYERS = 20;
const SERVER_URL = 'http://localhost:3000';

let testResults = {
  connected: 0,
  failedJoin: 0,
  questionReceived: 0,
  votingReceived: 0,
  resultsReceived: 0,
  votingTimers: 0,
  resultsTimers: 0,
  errors: []
};

let roomCode = null;

async function runTest() {
  console.log(`\n🔥 اختبار الإجهاد مع ${NUM_PLAYERS} لاعب`);
  console.log('═'.repeat(70));

  const players = [];

  // المرحلة 1: إنشاء جميع العملاء
  console.log(`\n📊 المرحلة 1: إنشاء ${NUM_PLAYERS} عميل Socket.IO...`);
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const socket = io(SERVER_URL, { reconnectionDelay: 0, forceNew: true });
    
    socket.on('connect', () => {
      testResults.connected++;
      if (testResults.connected % 5 === 0) {
        console.log(`  ✓ متصل: ${testResults.connected}/${NUM_PLAYERS}`);
      }
    });

    socket.on('connect_error', (err) => {
      testResults.failedJoin++;
    });

    // تسجيل الأحداث
    socket.on('start_round', (data) => {
      testResults.questionReceived++;
    });

    socket.on('voting_phase', (data) => {
      testResults.votingReceived++;
      if (data.startTime && data.time) {
        testResults.votingTimers++;
      }
    });

    socket.on('show_results', (data) => {
      testResults.resultsReceived++;
      if (data.startTime && data.time) {
        testResults.resultsTimers++;
      }
    });

    socket.on('error', (msg) => {
      testResults.errors.push(`[Player ${i}] ${msg}`);
    });

    players.push({
      id: socket.id,
      socket: socket,
      name: i === 0 ? 'HostPlayer' : `Guest_${i}`,
      isHost: i === 0
    });
  }

  // انتظر اتصال جميع العملاء
  await wait(3000);
  console.log(`✅ عدد المتصلين: ${testResults.connected}/${NUM_PLAYERS}`);

  // المرحلة 2: Host ينشئ غرفة
  console.log(`\n📍 المرحلة 2: Host ينشئ غرفة اللعبة`);
  const host = players[0].socket;

  await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), 3000);
    host.once('join_room', (code) => {
      roomCode = code;
      console.log(`✓ تم إنشاء الغرفة: ${code}`);
      clearTimeout(timeout);
      resolve();
    });

    host.emit('create_room', {
      name: players[0].name,
      avatarConfig: { color: 0 },
      social: {}
    });
  });

  // المرحلة 3: جميع اللاعبين ينضمون
  console.log(`\n📍 المرحلة 3: ${NUM_PLAYERS - 1} لاعب ينضمون للغرفة...`);
  
  players.slice(1).forEach((player, idx) => {
    setTimeout(() => {
      player.socket.emit('join_room', {
        code: roomCode,
        name: player.name,
        avatarConfig: { color: (idx + 1) % 10 },
        social: {}
      });
    }, idx * 100);
  });

  await wait(3000);
  console.log(`✓ الانضمام اكتمل`);

  // المرحلة 4: Host يحفظ الإعدادات
  console.log(`\n📍 المرحلة 4: حفظ إعدادات اللعبة...`);
  host.emit('save_settings', {
    roomCode,
    settings: {
      rounds: 1,
      time: 5,
      maxPlayers: NUM_PLAYERS,
      topics: ['variety']
    }
  });

  await wait(1000);
  console.log(`✓ تم حفظ الإعدادات`);

  // المرحلة 5: Host يبدأ اللعبة
  console.log(`\n📍 المرحلة 5: بدء اللعبة...`);
  host.emit('start_game_flow', roomCode);
  
  await wait(2000);
  console.log(`✓ بدأت اللعبة`);

  // المرحلة 6: اختيار الموضوع
  console.log(`\n📍 المرحلة 6: اختيار الموضوع...`);
  
  for (let i = 1; i < Math.min(3, NUM_PLAYERS); i++) {
    players[i].socket.emit('topic_selected', {
      roomCode,
      topic: 'variety'
    });
  }

  await wait(2000);
  console.log(`✓ تم اختيار الموضوع`);

  // المرحلة 7: انتظر مرحلة السؤال
  console.log(`\n📍 المرحلة 7: انتظار مرحلة السؤال...`);
  let questionWaitTime = 0;
  while (testResults.questionReceived === 0 && questionWaitTime < 10000) {
    await wait(500);
    questionWaitTime += 500;
  }

  if (testResults.questionReceived > 0) {
    console.log(`✓ استقبلت مرحلة السؤال: ${testResults.questionReceived}/${NUM_PLAYERS} لاعب`);
  } else {
    console.log(`⚠️ لم تصل مرحلة السؤال`);
  }

  // المرحلة 8: جميع اللاعبين يرسلون إجابات
  console.log(`\n📍 المرحلة 8: إرسال الإجابات (${NUM_PLAYERS} لاعب)...`);
  players.forEach((player, idx) => {
    setTimeout(() => {
      player.socket.emit('submit_answer', {
        roomCode,
        answer: idx === 0 ? 'الإجابة الصحيحة' : `إجابة كاذبة ${idx}`
      });
    }, Math.random() * 2000);
  });

  await wait(3000);
  console.log(`✓ تم إرسال جميع الإجابات`);

  // المرحلة 9: انتظر مرحلة التصويت
  console.log(`\n📍 المرحلة 9: انتظار مرحلة التصويت...`);
  let votingWaitTime = 0;
  while (testResults.votingReceived < NUM_PLAYERS * 0.7 && votingWaitTime < 15000) {
    await wait(500);
    votingWaitTime += 500;
  }

  if (testResults.votingReceived > 0) {
    console.log(`✓ استقبلت مرحلة التصويت: ${testResults.votingReceived}/${NUM_PLAYERS} لاعب`);
    console.log(`  ⏱️  عدد من استقبل Timer: ${testResults.votingTimers}/${testResults.votingReceived}`);
  } else {
    console.log(`⚠️ لم تصل مرحلة التصويت`);
  }

  // المرحلة 10: جميع اللاعبين يصوتون
  console.log(`\n📍 المرحلة 10: إرسال الأصوات...`);
  players.forEach((player, idx) => {
    if (idx > 0 && idx < 15) {  // فقط 14 لاعب يصوتون
      setTimeout(() => {
        player.socket.emit('submit_vote', {
          roomCode,
          choiceData: { id: idx % 2 === 0 ? 'truth' : players[1].socket.id }
        });
      }, Math.random() * 2000);
    }
  });

  await wait(3000);
  console.log(`✓ تم إرسال الأصوات`);

  // المرحلة 11: انتظر النتائج
  console.log(`\n📍 المرحلة 11: انتظار النتائج...`);
  let resultsWaitTime = 0;
  while (testResults.resultsReceived < NUM_PLAYERS * 0.6 && resultsWaitTime < 20000) {
    await wait(500);
    resultsWaitTime += 500;
  }

  if (testResults.resultsReceived > 0) {
    console.log(`✓ استقبلت النتائج: ${testResults.resultsReceived}/${NUM_PLAYERS} لاعب`);
    console.log(`  ⏱️  عدد من استقبل Timer: ${testResults.resultsTimers}/${testResults.resultsReceived}`);
  } else {
    console.log(`⚠️ لم تصل النتائج`);
  }

  // طباعة النتائج
  printFinalResults();

  // تنظيف
  players.forEach(p => p.socket.close());
  process.exit(testResults.errors.length > 0 ? 1 : 0);
}

function printFinalResults() {
  console.log('\n' + '═'.repeat(70));
  console.log('📊 نتائج الاختبار الشامل');
  console.log('═'.repeat(70));

  const metrics = [
    { 
      label: '🔗 الاتصالات', 
      value: `${testResults.connected}/${NUM_PLAYERS}`,
      ok: testResults.connected >= NUM_PLAYERS * 0.95
    },
    {
      label: '❓ استقبال السؤال',
      value: `${testResults.questionReceived}/${NUM_PLAYERS}`,
      ok: testResults.questionReceived >= NUM_PLAYERS * 0.85
    },
    {
      label: '🗳️ استقبال التصويت',
      value: `${testResults.votingReceived}/${NUM_PLAYERS}`,
      ok: testResults.votingReceived >= NUM_PLAYERS * 0.70
    },
    {
      label: '⏱️  Timer في التصويت',
      value: `${testResults.votingTimers}/${testResults.votingReceived}`,
      ok: testResults.votingTimers >= testResults.votingReceived * 0.9
    },
    {
      label: '📋 استقبال النتائج',
      value: `${testResults.resultsReceived}/${NUM_PLAYERS}`,
      ok: testResults.resultsReceived >= NUM_PLAYERS * 0.60
    },
    {
      label: '⏱️  Timer في النتائج',
      value: `${testResults.resultsTimers}/${testResults.resultsReceived}`,
      ok: testResults.resultsTimers >= testResults.resultsReceived * 0.9
    }
  ];

  metrics.forEach(m => {
    const icon = m.ok ? '✅' : '⚠️';
    console.log(`${icon} ${m.label.padEnd(30)} : ${m.value}`);
  });

  // حساب معدل النجاح
  const connectionRate = Math.round((testResults.connected / NUM_PLAYERS) * 100);
  const questionRate = Math.round((testResults.questionReceived / NUM_PLAYERS) * 100);
  const votingRate = Math.round((testResults.votingReceived / NUM_PLAYERS) * 100);
  const resultsRate = Math.round((testResults.resultsReceived / NUM_PLAYERS) * 100);

  console.log('\n📈 معدلات النجاح:');
  console.log(`  • الاتصالات: ${connectionRate}%`);
  console.log(`  • السؤال: ${questionRate}%`);
  console.log(`  • التصويت: ${votingRate}%`);
  console.log(`  • النتائج: ${resultsRate}%`);

  const overallSuccess = (connectionRate + questionRate + votingRate + resultsRate) / 4;
  console.log(`\n🎯 معدل النجاح الكلي: ${Math.round(overallSuccess)}%`);

  if (overallSuccess >= 80) {
    console.log('\n✅ نجح الاختبار! السيرفر يتعامل بكفاءة مع 20 لاعب');
  } else if (overallSuccess >= 60) {
    console.log('\n⚠️  الاختبار متوسط - يوجد مجال للتحسين');
  } else {
    console.log('\n❌ الاختبار فشل - يحتاج لتحسينات كبيرة');
  }

  if (testResults.errors.length > 0) {
    console.log('\n❌ الأخطاء:');
    testResults.errors.slice(0, 5).forEach(err => {
      console.log(`  • ${err}`);
    });
  }

  console.log('═'.repeat(70) + '\n');
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// تشغيل الاختبار
runTest().catch(err => {
  console.error('❌ خطأ:', err);
  process.exit(1);
});
