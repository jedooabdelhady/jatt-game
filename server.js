const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
// تأكد من وجود ملف questions.js بجانب هذا الملف
const questionsDB = require('./questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public'))); 
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// أسئلة احتياطية
const fallbackQuestions = [{ q: "ما هو لون حليب فرس النهر؟", truth: "وردي" }];
const generalQuestions = questionsDB ? [...(questionsDB.weird || []), ...(questionsDB.science || [])] : fallbackQuestions;

// === 1. دالة تنظيف النص (إزالة الهمزات والتشكيل والتاء المربوطة) ===
function normalizeText(text) {
    if (!text) return "";
    return text.toString().trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')   // استبدال أ إ آ -> ا
        .replace(/ؤ/g, 'و')       // استبدال ؤ -> و
        .replace(/ئ/g, 'ي')       // استبدال ئ -> ي
        .replace(/ة/g, 'ه')       // استبدال ة -> ه
        .replace(/[\u064B-\u065F]/g, ''); // إزالة التشكيل (الفتحة، الضمة، إلخ)
}

// === 2. دالة خلط المصفوفة (لضمان عشوائية أماكن الإجابات) ===
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

let rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. إنشاء الغرفة
    socket.on('create_private_room', ({ name, avatarConfig }) => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomCode] = {
            code: roomCode, hostId: socket.id, players: [], settings: {},
            gameState: 'setup', currentRound: 0, chooserIndex: 0,
            currentLies: [], votes: [], usedQuestions: [] 
        };
        const player = { id: socket.id, name, score: 0, isHost: true, avatarConfig: avatarConfig || {color:0, face:0, hat:0}, lastPoints: 0 };
        rooms[roomCode].players.push(player);
        socket.join(roomCode);
        socket.emit('go_to_setup', roomCode);
    });

    // 2. حفظ الإعدادات
    socket.on('save_settings', ({ roomCode, settings }) => {
        const room = rooms[roomCode];
        if(!room) return;
        room.settings = settings;
        room.gameState = 'lobby';
        io.to(roomCode).emit('update_lobby', { code: roomCode, players: room.players, settings: room.settings, hostId: room.hostId });
    });

    // 3. انضمام لاعب
    socket.on('join_room', ({ code, name, avatarConfig }) => {
        const room = rooms[code];
        if (!room) return socket.emit('error_msg', 'الغرفة غير موجودة');
        if (room.gameState !== 'lobby') return socket.emit('error_msg', 'اللعبة بدأت بالفعل');
        if (room.settings.maxPlayers && room.players.length >= room.settings.maxPlayers) return socket.emit('error_msg', 'الغرفة ممتلئة');

        const player = { id: socket.id, name, score: 0, isHost: false, avatarConfig: avatarConfig || {color:0, face:0, hat:0}, lastPoints: 0 };
        room.players.push(player);
        socket.join(code);
        io.to(code).emit('update_lobby', { code, players: room.players, settings: room.settings, hostId: room.hostId });
    });

    // 4. بدء اللعبة
    socket.on('start_game_flow', (roomCode) => {
        const room = rooms[roomCode];
        if(!room || room.hostId !== socket.id) return;
        startTopicSelectionPhase(room);
    });

    function startTopicSelectionPhase(room) {
        if (room.currentRound >= parseInt(room.settings.rounds)) return finishGame(room);
        room.gameState = 'picking_topic';
        const chooser = room.players[room.chooserIndex % room.players.length];
        io.to(room.code).emit('choose_topic_phase', {
            chooserId: chooser.id, chooserName: chooser.name,
            availableTopics: room.settings.topics, currentRound: room.currentRound + 1, totalRounds: room.settings.rounds
        });
    }

    // 5. اختيار الموضوع (مع التنظيف والعشوائية)
    socket.on('topic_selected', ({ roomCode, topic }) => {
        const room = rooms[roomCode];
        if(!room) return;
        
        let qList = (questionsDB && questionsDB[topic]) ? questionsDB[topic] : generalQuestions;
        
        // استبعاد الأسئلة المستخدمة
        let available = qList.filter(q => !room.usedQuestions.includes(q.q));
        
        // إعادة التدوير إذا انتهت
        if (available.length === 0) {
            available = qList;
            room.usedQuestions = []; // إعادة تعيين
        }

        // اختيار عشوائي
        const randomIndex = Math.floor(Math.random() * available.length);
        const question = available[randomIndex];
        room.usedQuestions.push(question.q); 
        
        // تنظيف الإجابة وتجهيز التلميحات
        const cleanTruth = normalizeText(question.truth);
        let displayQuestion = question.q;
        
        if (/^\d+$/.test(cleanTruth)) {
            displayQuestion += " (الإجابة رقم)";
        } else if (cleanTruth.split(' ').length === 2) {
            displayQuestion += " (كلمتين)";
        }

        room.currentQuestion = {
            q: displayQuestion,
            truth: cleanTruth, // نحفظ النسخة النظيفة للمقارنة
            originalTruth: question.truth // نحفظ النسخة الأصلية للعرض (اختياري)
        };

        room.currentLies = [];
        room.votes = [];
        room.gameState = 'input';

        io.to(roomCode).emit('start_round', {
            question: displayQuestion,
            time: room.settings.time,
            roundNum: room.currentRound + 1
        });
    });

    // 6. استلام الإجابات
    socket.on('submit_answer', ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        if(!room || room.gameState !== 'input') return;

        // تنظيف إجابة اللاعب للمقارنة
        const userAns = normalizeText(answer);
        const systemTruth = room.currentQuestion.truth;

        if(userAns === systemTruth) {
            return socket.emit('truth_detected', 'كفو! جبتها صح.. بس غيرها عشان تغشهم 😉');
        }

        const existing = room.currentLies.find(l => l.ownerId === socket.id);
        if(!existing) {
            // نحفظ الإجابة كما كتبها اللاعب (للعرض)، لكن المقارنة تمت بالتنظيف
            room.currentLies.push({ text: answer, ownerId: socket.id });
            io.to(roomCode).emit('player_done', socket.id);
        }
        socket.emit('wait_for_others');

        if(room.currentLies.length === room.players.length) {
            startVoting(room);
        }
    });

    function startVoting(room) {
        room.gameState = 'voting';
        
        // تجميع الخيارات
        let options = [{ text: room.currentQuestion.truth, type: 'TRUTH', ownerId: 'SYS' }];
        room.currentLies.forEach(l => options.push({ text: l.text, type: 'LIE', ownerId: l.ownerId }));
        
        // === خلط الخيارات (Shuffling) ===
        // هذا يضمن أن الإجابة الصحيحة لا تظهر دائماً في الأول
        options = shuffleArray(options);

        io.to(room.code).emit('voting_phase', {
            question: room.currentQuestion.q,
            options: options,
            time: room.settings.time
        });
    }

    // 7. التصويت
    socket.on('submit_vote', ({ roomCode, choiceData }) => {
        const room = rooms[roomCode];
        if(!room) return;

        const existing = room.votes.find(v => v.voterId === socket.id);
        if(!existing) {
            room.votes.push({ voterId: socket.id, choice: choiceData });
        }

        if(room.votes.length === room.players.length) {
            calcResults(room);
        }
    });

    // 8. النتائج
    function calcResults(room) {
        room.players.forEach(p => p.lastPoints = 0);

        room.votes.forEach(vote => {
            const voter = room.players.find(p => p.id === vote.voterId);
            const choice = vote.choice;

            if(choice.type === 'TRUTH') {
                voter.score += 2; voter.lastPoints += 2;
            } else if(choice.type === 'LIE') {
                const liar = room.players.find(p => p.id === choice.ownerId);
                if(liar && liar.id !== voter.id) { 
                    liar.score += 1; 
                    liar.lastPoints += 1; 
                }
            }
        });

        room.players.sort((a,b) => b.score - a.score);
        room.currentRound++;
        room.chooserIndex++; 
        room.gameState = 'results';

        io.to(room.code).emit('show_results', {
            truth: room.currentQuestion.truth,
            leaderboard: room.players,
            isFinal: room.currentRound >= parseInt(room.settings.rounds),
            hostId: room.hostId 
        });
    }

    // 9. التالي
    socket.on('next_step', (roomCode) => {
        const room = rooms[roomCode];
        if(!room) return;
        if(socket.id !== room.hostId) return;

        if(room.gameState === 'results') {
            if (room.currentRound >= parseInt(room.settings.rounds)) {
                finishGame(room);
            } else {
                startTopicSelectionPhase(room);
            }
        }
    });

    // 10. إعادة اللعب
    socket.on('restart_game', (roomCode) => {
        const room = rooms[roomCode];
        if(!room || socket.id !== room.hostId) return;

        room.players.forEach(p => { p.score = 0; p.lastPoints = 0; });
        room.currentRound = 0;
        room.usedQuestions = [];
        room.gameState = 'lobby';
        
        io.to(roomCode).emit('update_lobby', { 
            code: roomCode, 
            players: room.players, 
            settings: room.settings, 
            hostId: room.hostId
        });
    });

    function finishGame(room) {
        room.gameState = 'gameover';
        io.to(room.code).emit('game_over', {
            winner: room.players[0],
            leaderboard: room.players,
            hostId: room.hostId
        });
    }
});

server.listen(3000, () => { console.log('Server running on 3000'); });