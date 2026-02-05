const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// استيراد ملف الأسئلة
const questionsData = require('./questions');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// تقديم الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// تقديم الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// متغيرات تخزين حالة اللعبة (مؤقتة في الذاكرة - RAM)
const rooms = {};
const players = {};

// دالة توليد كود عشوائي للغرفة
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    console.log('New player connected:', socket.id);

    // === 1. إدارة الغرف والدخول ===

    socket.on('create_private_room', ({ name, avatarConfig }) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            hostId: socket.id,
            players: [],
            gameState: 'lobby',
            settings: { rounds: 5, time: 30, maxPlayers: 8, topics: [] },
            currentRound: 0,
            scores: {},
            roundData: {},
            usedQuestions: [],
            availableChoosers: [] // قائمة تتبع من عليه الدور في الاختيار
        };

        joinRoom(socket, roomCode, name, avatarConfig, true);
    });

    socket.on('join_room', ({ code, name, avatarConfig }) => {
        if (rooms[code]) {
            if (rooms[code].players.length >= rooms[code].settings.maxPlayers) {
                socket.emit('error_msg', 'الغرفة ممتلئة!');
                return;
            }
            if (rooms[code].gameState !== 'lobby') {
                socket.emit('error_msg', 'اللعبة بدأت بالفعل!');
                return;
            }
            joinRoom(socket, code, name, avatarConfig, false);
        } else {
            socket.emit('error_msg', 'الكود غلط يا فنان!');
        }
    });

    function joinRoom(socket, code, name, avatarConfig, isHost) {
        players[socket.id] = {
            id: socket.id,
            name: name,
            avatarConfig: avatarConfig,
            roomCode: code,
            isHost: isHost,
            score: 0,
            lastPoints: 0
        };

        socket.join(code);
        rooms[code].players.push(players[socket.id]);
        rooms[code].scores[socket.id] = 0;

        io.to(code).emit('update_lobby', {
            code: code,
            players: rooms[code].players,
            hostId: rooms[code].hostId
        });

        if (isHost) {
            socket.emit('go_to_setup', code);
        }
    }

    // === 2. ميزة الاستعادة (Reconnect) ===
    socket.on('rejoin_game', ({ roomCode, name, avatarConfig }) => {
        const room = rooms[roomCode];
        if (room) {
            players[socket.id] = {
                id: socket.id,
                name: name,
                avatarConfig: avatarConfig,
                roomCode: roomCode,
                isHost: (room.hostId === null) ? true : false,
                score: 0 
            };
            
            const existingPlayerIndex = room.players.findIndex(p => p.name === name);
            if (existingPlayerIndex !== -1) {
                players[socket.id].score = room.players[existingPlayerIndex].score;
                players[socket.id].isHost = room.players[existingPlayerIndex].isHost;
                if(players[socket.id].isHost) room.hostId = socket.id;
                room.players[existingPlayerIndex] = players[socket.id];
            } else {
                room.players.push(players[socket.id]);
            }
            
            socket.join(roomCode);

            socket.emit('rejoin_success', {
                roomCode: roomCode,
                name: name,
                isHost: players[socket.id].isHost,
                players: room.players,
                gameState: room.gameState,
                topicData: (room.gameState === 'picking_topic') ? { chooserId: room.roundData.chooserId, chooserName: players[room.roundData.chooserId]?.name, availableTopics: room.settings.topics } : null,
                questionData: (room.gameState === 'input') ? { question: room.roundData.currentQuestion.q, inputType: 'text' } : null,
                voteOptions: (room.gameState === 'voting') ? room.roundData.voteOptions : null,
                resultData: (room.gameState === 'results') ? { truth: room.roundData.currentQuestion.truth, leaderboard: getLeaderboard(room), hostId: room.hostId } : null,
                hasAnswered: (room.gameState === 'input' && room.roundData.answers && room.roundData.answers[socket.id]),
                donePlayers: (room.gameState === 'input') ? Object.keys(room.roundData.answers || {}) : [],
                votedPlayers: (room.gameState === 'voting') ? Object.keys(room.roundData.votes || {}) : []
            });
        } else {
            socket.emit('error_msg', 'الغرفة انتهت أو غير موجودة');
        }
    });

    // === 3. إعدادات اللعبة ===
    socket.on('save_settings', ({ roomCode, settings }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].settings = { ...rooms[roomCode].settings, ...settings };
        }
    });

    // === 4. تدفق اللعبة ===
    socket.on('start_game_flow', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.players.length < 2) { 
            socket.emit('error_msg', 'لازم لاعبين اثنين على الأقل!');
            return;
        }

        // تصفير القائمة عند بداية اللعبة
        room.availableChoosers = []; 
        startTopicPhase(room);
    });

    function startTopicPhase(room) {
        room.gameState = 'picking_topic';
        room.currentRound++;
        
        // 🔥 منطق اختيار اللاعب بالدور العشوائي
        // إذا القائمة فارغة (أو أول مرة)، نملؤها بجميع اللاعبين
        if (!room.availableChoosers || room.availableChoosers.length === 0) {
            room.availableChoosers = room.players.map(p => p.id);
        }

        // اختيار لاعب عشوائي من القائمة المتاحة
        const randomIndex = Math.floor(Math.random() * room.availableChoosers.length);
        const chooserId = room.availableChoosers[randomIndex];
        
        // إزالة اللاعب من القائمة حتى لا يختار مرة أخرى في نفس الدورة
        room.availableChoosers.splice(randomIndex, 1);

        const chooser = room.players.find(p => p.id === chooserId);

        // إذا اللاعب خرج، نعيد الاختيار
        if (!chooser) {
            return startTopicPhase(room);
        }
        
        room.roundData = {
            chooserId: chooser.id,
            chooserName: chooser.name,
            answers: {},
            votes: {}
        };

        io.to(room.code).emit('choose_topic_phase', {
            chooserId: chooser.id,
            chooserName: chooser.name,
            availableTopics: room.settings.topics 
        });
    }

    socket.on('topic_selected', ({ roomCode, topic }) => {
        const room = rooms[roomCode];
        if (room && socket.id === room.roundData.chooserId) {
            startQuestionPhase(room, topic);
        }
    });

    function startQuestionPhase(room, topicId) {
        room.gameState = 'input';
        
        let categoryQuestions = questionsData[topicId];
        if (!categoryQuestions) categoryQuestions = questionsData['variety'];

        let qIndex;
        let attempts = 0;
        // محاولة اختيار سؤال لم يستخدم من قبل
        do {
            qIndex = Math.floor(Math.random() * categoryQuestions.length);
            attempts++;
        } while (room.usedQuestions.includes(`${topicId}-${qIndex}`) && attempts < 10);

        room.usedQuestions.push(`${topicId}-${qIndex}`);
        const selectedQ = categoryQuestions[qIndex];

        room.roundData.currentQuestion = selectedQ;
        room.roundData.answers = {}; 

        io.to(room.code).emit('start_round', {
            question: selectedQ.q,
            inputType: 'text',
            time: room.settings.time
        });
    }

    // === 5. استلام الإجابات ===
    socket.on('submit_answer', ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'input') return;

        const cleanAns = answer.trim();
        const truth = room.roundData.currentQuestion.truth;

        if (cleanAns.toLowerCase() === truth.toLowerCase()) {
            socket.emit('truth_detected', 'يا ذكي! لازم تألف كذبة، ما تكتب الحقيقة!');
            return;
        }

        room.roundData.answers[socket.id] = cleanAns;
        
        io.to(roomCode).emit('player_done', socket.id);
        socket.emit('wait_for_others');

        if (Object.keys(room.roundData.answers).length === room.players.length) {
            startVotingPhase(room);
        }
    });

    function startVotingPhase(room) {
        room.gameState = 'voting';
        
        const options = [];
        // إضافة الحقيقة
        options.push({ text: room.roundData.currentQuestion.truth, type: 'TRUTH', id: 'truth' });

        // إضافة كذبات اللاعبين
        for (const [pid, ans] of Object.entries(room.roundData.answers)) {
            options.push({ text: ans, type: 'LIE', id: pid }); 
        }

        // خلط الخيارات
        options.sort(() => Math.random() - 0.5);

        room.roundData.voteOptions = options;
        room.roundData.votes = {};

        io.to(room.code).emit('voting_phase', {
            options: options.map(o => ({ text: o.text, id: o.id }))
        });
    }

    // === 6. التصويت ===
    socket.on('submit_vote', ({ roomCode, choiceData }) => {
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'voting') return;

        room.roundData.votes[socket.id] = choiceData.id;
        io.to(roomCode).emit('player_voted', socket.id);

        if (Object.keys(room.roundData.votes).length === room.players.length) {
            calculateResults(room);
        }
    });

    function calculateResults(room) {
        room.gameState = 'results';
        room.players.forEach(p => p.lastPoints = 0);

        for (const [voterId, choiceId] of Object.entries(room.roundData.votes)) {
            const voter = players[voterId];
            if (!voter) continue;

            if (choiceId === 'truth') {
                // صوت للحقيقة: +2 نقطة
                voter.score += 2;
                voter.lastPoints += 2;
            } else {
                // صوت لكذبة لاعب آخر
                const liarId = choiceId;
                const liar = players[liarId];
                if (liar && liarId !== voterId) {
                    // الكذاب يحصل على +1 نقطة
                    liar.score += 1;
                    liar.lastPoints += 1;
                }
            }
        }

        io.to(room.code).emit('show_results', {
            truth: room.roundData.currentQuestion.truth,
            leaderboard: getLeaderboard(room),
            isFinal: (room.currentRound >= room.settings.rounds),
            hostId: room.hostId
        });
    }

    function getLeaderboard(room) {
        return room.players
            .sort((a, b) => b.score - a.score)
            .map(p => ({ 
                id: p.id, 
                name: p.name, 
                score: p.score, 
                lastPoints: p.lastPoints, 
                avatarConfig: p.avatarConfig 
            }));
    }

    // === 7. الجولة التالية / إنهاء اللعبة ===
    socket.on('next_step', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.currentRound >= room.settings.rounds) {
            const winner = room.players.reduce((prev, current) => (prev.score > current.score) ? prev : current);
            const loser = room.players.reduce((prev, current) => (prev.score < current.score) ? prev : current);

            room.gameState = 'gameover';
            io.to(roomCode).emit('game_over', { 
                winner: winner,
                loser: loser,
                hostId: room.hostId
            });
        } else {
            startTopicPhase(room);
        }
    });

    socket.on('restart_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentRound = 0;
            room.players.forEach(p => { p.score = 0; p.lastPoints = 0; });
            room.gameState = 'lobby';
            room.usedQuestions = [];
            room.availableChoosers = []; // تصفير الدور
            
            io.to(roomCode).emit('update_lobby', {
                code: roomCode,
                players: room.players,
                hostId: room.hostId
            });
        }
    });

    socket.on('leave_game', (roomCode) => {
        leaveRoomLogic(socket, roomCode);
    });

    // === الشات ===
    socket.on('send_chat', ({ roomCode, message }) => {
        if (!message || !message.trim()) return;
        io.to(roomCode).emit('receive_chat', {
            senderId: socket.id,
            senderName: players[socket.id] ? players[socket.id].name : 'مجهول',
            message: message
        });
    });

    // === 8. قطع الاتصال ===
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const player = players[socket.id];
        if (player) {
            leaveRoomLogic(socket, player.roomCode);
            delete players[socket.id];
        }
    });

    function leaveRoomLogic(socket, code) {
        const room = rooms[code];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            
            // تحديث قائمة الدور إذا خرج لاعب
            if (room.availableChoosers) {
                room.availableChoosers = room.availableChoosers.filter(id => id !== socket.id);
            }

            if (socket.id === room.hostId && room.players.length > 0) {
                room.hostId = room.players[0].id;
                room.players[0].isHost = true;
            }
            if (room.players.length === 0) {
                delete rooms[code];
            } else {
                io.to(code).emit('player_left_update', room.players);
                if (room.gameState === 'lobby') {
                    io.to(code).emit('update_lobby', {
                        code: code,
                        players: room.players,
                        hostId: room.hostId
                    });
                }
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});