const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const questionsData = require('./questions'); // تأكد أن ملف الأسئلة موجود بنفس الاسم

const app = express();
const server = http.createServer(app);

// إعدادات CORS
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const rooms = {};
const players = {};

function generateRoomCode() { return Math.floor(1000 + Math.random() * 9000).toString(); }

// دالة توحيد الأرقام (موجودة سابقاً)
function normalizeCode(input) {
    if (!input) return "";
    return input.toString()
        .replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
        .replace(/[۰۱۲۳٤۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776)
        .trim();
}

// 🔥 دالة جديدة: توحيد النصوص العربية (لحل مشكلة تطابق الإجابات)
function normalizeText(text) {
    if (!text) return "";
    return text.toString().trim()
        .replace(/[أإآ]/g, 'ا')  // توحيد الألف
        .replace(/ى/g, 'ي')      // توحيد الياء
        .replace(/ة/g, 'ه')      // التاء المربوطة
        .replace(/[\u064B-\u065F]/g, '') // إزالة التشكيل
        .toLowerCase();
}

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // === إنشاء الغرفة ===
    socket.on('create_private_room', ({ name, avatarConfig, social }) => {
        let rawCode = generateRoomCode();
        let roomCode = normalizeCode(rawCode);
        while (rooms[roomCode]) { rawCode = generateRoomCode(); roomCode = normalizeCode(rawCode); }

        rooms[roomCode] = {
            code: roomCode, hostId: socket.id, players: [], gameState: 'lobby',
            settings: { rounds: 5, time: 30, maxPlayers: 8, topics: [] },
            currentRound: 0, scores: {}, roundData: {}, usedQuestions: [], availableChoosers: [],
            kickVotes: {},
            roundTimer: null 
        };
        joinRoom(socket, roomCode, name, avatarConfig, social, true);
    });

    // === الانضمام ===
    socket.on('join_room', ({ code, name, avatarConfig, social }) => {
        const cleanCode = normalizeCode(code);
        if (rooms[cleanCode]) {
            if (rooms[cleanCode].players.length >= rooms[cleanCode].settings.maxPlayers) return socket.emit('error_msg', 'الغرفة ممتلئة!');
            joinRoom(socket, cleanCode, name, avatarConfig, social, false);
        } else {
            socket.emit('error_msg', 'الكود غلط يا فنان!');
        }
    });

    // دالة الدخول الموحدة
    function joinRoom(socket, code, name, avatarConfig, social, isHost) {
        const room = rooms[code];
        if (!room) { socket.emit('error_msg', 'الغرفة غير موجودة.'); return; }

        const existingPlayerByName = room.players.find(p => p.name === name);
        const existingPlayerById = room.players.find(p => p.id === socket.id);

        if (existingPlayerById) {
             handlePlayerReconnect(socket, room, existingPlayerById, avatarConfig, social);
             return;
        }

        if (existingPlayerByName) {
            name = `${name}_${Math.floor(Math.random() * 100)}`;
            socket.emit('error_msg', `الاسم مكرر! دخلت باسم: ${name}`);
        }

        if (room.gameState !== 'lobby') { socket.emit('error_msg', 'اللعبة بدأت!'); return; }
        
        const newPlayer = {
            id: socket.id, name: name, avatarConfig: avatarConfig, social: social || {},
            roomCode: code, isHost: isHost, score: 0, lastPoints: 0
        };
        
        players[socket.id] = newPlayer;
        socket.join(code);
        room.players.push(newPlayer);
        room.scores[socket.id] = 0;
        
        io.to(code).emit('update_lobby', { code: code, players: room.players, hostId: room.hostId });
        if (isHost) socket.emit('go_to_setup', code);
    }

    // === الريفريش ===
    socket.on('rejoin_game', ({ roomCode, name, avatarConfig, social }) => {
        const cleanCode = normalizeCode(roomCode);
        const room = rooms[cleanCode];
        if (room) {
            const existingPlayer = room.players.find(p => p.name === name);
            if (existingPlayer) {
                handlePlayerReconnect(socket, room, existingPlayer, avatarConfig, social);
            } else {
                joinRoom(socket, cleanCode, name, avatarConfig, social, false);
            }
        } else {
            socket.emit('error_msg', 'انتهت الجلسة.');
            socket.emit('force_exit'); 
        }
    });

    function handlePlayerReconnect(socket, room, player, newAvatar, newSocial) {
        const oldSocketId = player.id;
        
        player.id = socket.id; 
        if (newAvatar) player.avatarConfig = newAvatar;
        if (newSocial) player.social = newSocial;
        
        delete players[oldSocketId];
        players[socket.id] = player;
        
        if (player.isHost) {
            room.hostId = socket.id;
        }

        socket.join(room.code);

        // نقل الإجابات والتصويتات للـ ID الجديد
        if (room.roundData) {
            if (room.roundData.answers && room.roundData.answers[oldSocketId]) {
                room.roundData.answers[socket.id] = room.roundData.answers[oldSocketId];
                delete room.roundData.answers[oldSocketId];
            }
            if (room.roundData.votes && room.roundData.votes[oldSocketId]) {
                room.roundData.votes[socket.id] = room.roundData.votes[oldSocketId];
                delete room.roundData.votes[oldSocketId];
            }
            if (room.roundData.chooserId === oldSocketId) {
                room.roundData.chooserId = socket.id;
            }
        }
        sendCurrentStateToRejoiner(socket, room, player);
    }

    function sendCurrentStateToRejoiner(socket, room, player) {
        // 🔥 إصلاح: حساب الوقت المتبقي عند إعادة الدخول
        let timeRemaining = 0;
        if (room.gameState === 'input' && room.roundData.startTime) {
             const timeElapsed = (Date.now() - room.roundData.startTime) / 1000;
             timeRemaining = Math.max(0, room.settings.time - timeElapsed);
        }

        socket.emit('rejoin_success', {
            roomCode: room.code, name: player.name, isHost: player.isHost, players: room.players, gameState: room.gameState,
            topicData: (room.gameState === 'picking_topic') ? { chooserId: room.roundData.chooserId, chooserName: players[room.roundData.chooserId]?.name, availableTopics: room.settings.topics } : null,
            
            // 🔥 إرسال timeRemaining للكلاينت
            questionData: (room.gameState === 'input' || room.gameState === 'voting') ? { 
                question: room.roundData.currentQuestion.q, 
                inputType: 'text',
                timeRemaining: timeRemaining 
            } : null,

            voteOptions: (room.gameState === 'voting') ? room.roundData.voteOptions : null,
            resultData: (room.gameState === 'results') ? { truth: room.roundData.currentQuestion.truth, leaderboard: getLeaderboard(room), hostId: room.hostId, isFinal: (room.currentRound >= room.settings.rounds) } : null,
            hasAnswered: (room.gameState === 'input' && room.roundData.answers && room.roundData.answers[socket.id]),
            hasVoted: (room.gameState === 'voting' && room.roundData.votes && room.roundData.votes[socket.id]),
            donePlayers: (room.gameState === 'input') ? Object.keys(room.roundData.answers || {}) : [],
            votedPlayers: (room.gameState === 'voting') ? Object.keys(room.roundData.votes || {}) : []
        });
    }

    socket.on('send_chat', ({ roomCode, message }) => { 
        if (!message || !message.trim()) return; 
        const player = players[socket.id]; 
        io.to(roomCode).emit('receive_chat', { 
            senderId: socket.id, 
            senderName: player ? player.name : 'مجهول', 
            avatarConfig: player ? player.avatarConfig : {color:0},
            message: message 
        }); 
    });

    socket.on('save_settings', ({ roomCode, settings }) => { if (rooms[roomCode]) rooms[roomCode].settings = { ...rooms[roomCode].settings, ...settings }; });
    
    socket.on('start_game_flow', (roomCode) => {
        const room = rooms[roomCode]; if (!room) return;
        if (room.players.length < 2) return socket.emit('error_msg', 'لازم لاعبين اثنين على الأقل!');
        room.availableChoosers = []; startTopicPhase(room);
    });

    function startTopicPhase(room) {
        if (room.roundTimer) clearTimeout(room.roundTimer); 
        room.gameState = 'picking_topic'; room.currentRound++;
        if (!room.availableChoosers || room.availableChoosers.length === 0) room.availableChoosers = room.players.map(p => p.id);
        room.availableChoosers = room.availableChoosers.filter(id => players[id]); 
        
        const idx = Math.floor(Math.random() * room.availableChoosers.length);
        const chooserId = room.availableChoosers[idx]; room.availableChoosers.splice(idx, 1);
        
        // 🔥 إصلاح: التأكد من أن اللاعب لا يزال موجوداً لتجنب الـ Crash
        const chooser = room.players.find(p => p.id === chooserId);
        if (!chooser) {
            return startTopicPhase(room); // إعادة المحاولة إذا كان اللاعب غادر
        }

        room.roundData = { chooserId: chooser.id, chooserName: chooser.name, answers: {}, votes: {}, voteOptions: [] };
        io.to(room.code).emit('choose_topic_phase', { chooserId: chooser.id, chooserName: chooser.name, availableTopics: room.settings.topics });
    }

    socket.on('topic_selected', ({ roomCode, topic }) => { const room = rooms[roomCode]; if (room && socket.id === room.roundData.chooserId) startQuestionPhase(room, topic); });

    function startQuestionPhase(room, topicId) {
        room.gameState = 'input';
        let categoryQuestions = questionsData[topicId] || questionsData['variety'];
        let qIndex, attempts = 0;
        do { qIndex = Math.floor(Math.random() * categoryQuestions.length); attempts++; } while (room.usedQuestions.includes(`${topicId}-${qIndex}`) && attempts < 10);
        room.usedQuestions.push(`${topicId}-${qIndex}`);
        const selectedQ = categoryQuestions[qIndex];
        room.roundData.currentQuestion = selectedQ; room.roundData.answers = {};
        
        // 🔥 تسجيل وقت البدء
        room.roundData.startTime = Date.now();

        io.to(room.code).emit('start_round', { question: selectedQ.q, inputType: 'text', time: room.settings.time });

        // إعادة ضبط المؤقت
        if (room.roundTimer) clearTimeout(room.roundTimer);
        
        room.roundTimer = setTimeout(() => {
            if (rooms[room.code] && room.gameState === 'input') {
                
                // 🔥 إصلاح: تعبئة إجابات تلقائية للاعبين الخاملين (Idle)
                room.players.forEach(p => {
                    // إذا لم يجاوب وهو ليس الحكم (أو الحكم يلعب أيضاً)
                    // هنا نفترض الجميع يلعبون
                    if (!room.roundData.answers[p.id]) {
                        const funnyLies = ["ما لحقت أكتب 🐢", "النت فصل 🔌", "أنا كذاب محترف 😎", "الإجابة هي 42", "نسيت السؤال 😅"];
                        room.roundData.answers[p.id] = funnyLies[Math.floor(Math.random() * funnyLies.length)];
                    }
                });

                console.log(`Timer ended for room ${room.code}, starting voting.`);
                startVotingPhase(room);
            }
        }, (room.settings.time + 1) * 1000); 
    }

    socket.on('submit_answer', ({ roomCode, answer }) => {
        const room = rooms[roomCode]; if (!room || room.gameState !== 'input') return;
        if (room.roundData.answers[socket.id]) return;
        
        const cleanAns = answer.trim(); 
        const truth = room.roundData.currentQuestion.truth;
        
        // 🔥 إصلاح: استخدام normalizeText لمقارنة الحقيقة
        if (normalizeText(cleanAns) === normalizeText(truth)) {
             return socket.emit('truth_detected', 'يا ذكي! دي الحقيقة، لازم تألف كذبة!');
        }

        room.roundData.answers[socket.id] = cleanAns;
        io.to(roomCode).emit('player_done', socket.id);
        socket.emit('wait_for_others');
        
        // التحقق إذا الكل جاوب
        const activePlayersCount = room.players.filter(p => players[p.id]).length;
        if (Object.keys(room.roundData.answers).length >= activePlayersCount) startVotingPhase(room);
    });

    function startVotingPhase(room) {
        if (room.roundTimer) clearTimeout(room.roundTimer); 
        room.gameState = 'voting'; 
        const options = [{ text: room.roundData.currentQuestion.truth, type: 'TRUTH', id: 'truth' }];
        for (const [pid, ans] of Object.entries(room.roundData.answers)) options.push({ text: ans, type: 'LIE', id: pid });
        options.sort(() => Math.random() - 0.5);
        room.roundData.voteOptions = options; room.roundData.votes = {};
        
        // نرسل الخيارات مع الـ ID عشان الكلاينت يعرف يمنع التصويت للنفس
        io.to(room.code).emit('voting_phase', { options: options.map(o => ({ text: o.text, id: o.id })) });
    }

    socket.on('submit_vote', ({ roomCode, choiceData }) => {
        const room = rooms[roomCode]; if (!room || room.gameState !== 'voting') return;
        if (room.roundData.votes[socket.id]) return;
        
        // حماية إضافية في السيرفر: ممنوع التصويت للنفس
        if (choiceData.id === socket.id) return;

        room.roundData.votes[socket.id] = choiceData.id; 
        io.to(roomCode).emit('player_voted', socket.id);
        const activePlayersCount = room.players.filter(p => players[p.id]).length;
        if (Object.keys(room.roundData.votes).length >= activePlayersCount) calculateResults(room);
    });

    function calculateResults(room) {
        room.gameState = 'results'; room.players.forEach(p => p.lastPoints = 0);
        for (const [voterId, choiceId] of Object.entries(room.roundData.votes)) {
            const voter = players[voterId]; if (!voter) continue;
            if (choiceId === 'truth') { voter.score += 2; voter.lastPoints += 2; }
            else { const liar = players[choiceId]; if (liar && choiceId !== voterId) { liar.score += 1; liar.lastPoints += 1; } }
        }
        io.to(room.code).emit('show_results', { 
            truth: room.roundData.currentQuestion.truth, 
            leaderboard: getLeaderboard(room), 
            isFinal: (room.currentRound >= room.settings.rounds), 
            hostId: room.hostId 
        });
    }

    function getLeaderboard(room) {
        return room.players.sort((a, b) => b.score - a.score).map(p => ({ id: p.id, name: p.name, score: p.score, lastPoints: p.lastPoints, avatarConfig: p.avatarConfig, social: p.social }));
    }

    socket.on('vote_kick', ({ targetId }) => {
        const player = players[socket.id]; if (!player) return;
        const room = rooms[player.roomCode]; if (!room) return;
        if (targetId === socket.id) return;
        if (!room.kickVotes[targetId]) room.kickVotes[targetId] = [];
        if (!room.kickVotes[targetId].includes(socket.id)) {
            room.kickVotes[targetId].push(socket.id);
            const votesCount = room.kickVotes[targetId].length;
            const requiredVotes = Math.floor(room.players.length / 2) + 1;
            const targetName = players[targetId] ? players[targetId].name : "اللاعب";
            io.to(room.code).emit('receive_chat', { senderId: 'SYSTEM', senderName: '⚠️ النظام', message: `تصويت لطرد ${targetName} (${votesCount}/${requiredVotes})` });
            if (votesCount >= requiredVotes) {
                io.to(room.code).emit('receive_chat', { senderId: 'SYSTEM', senderName: '🚫 النظام', message: `تم طرد ${targetName}!` });
                io.to(targetId).emit('kicked_out');
                const targetSocket = io.sockets.sockets.get(targetId);
                if (targetSocket) { leaveRoomLogic(targetSocket, room.code); targetSocket.leave(room.code); }
                else { leaveRoomLogic({ id: targetId }, room.code); }
                delete room.kickVotes[targetId];
            }
        }
    });

    socket.on('next_step', (roomCode) => {
        const room = rooms[roomCode]; if (!room) return;
        if (room.currentRound >= room.settings.rounds) {
            const winner = room.players.reduce((p, c) => (p.score > c.score) ? p : c);
            const loser = room.players.reduce((p, c) => (p.score < c.score) ? p : c);
            room.gameState = 'gameover';
            io.to(roomCode).emit('game_over', { winner: winner, loser: loser, hostId: room.hostId });
        } else startTopicPhase(room);
    });

    socket.on('restart_game', (roomCode) => {
        const room = rooms[roomCode]; if (room) {
            room.currentRound = 0; room.players.forEach(p => { p.score = 0; p.lastPoints = 0; }); room.gameState = 'lobby'; room.usedQuestions = []; room.availableChoosers = [];
            io.to(roomCode).emit('update_lobby', { code: roomCode, players: room.players, hostId: room.hostId });
        }
    });

    socket.on('leave_game', (roomCode) => leaveRoomLogic(socket, roomCode));
    socket.on('disconnect', () => { console.log('Disconnect:', socket.id); }); 

    function leaveRoomLogic(socket, code) {
        const room = rooms[code]; if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.availableChoosers) room.availableChoosers = room.availableChoosers.filter(id => id !== socket.id);
            if (room.kickVotes && room.kickVotes[socket.id]) delete room.kickVotes[socket.id];
            if (socket.id === room.hostId && room.players.length > 0) { room.hostId = room.players[0].id; room.players[0].isHost = true; }
            if (room.players.length === 0) {
                if (room.roundTimer) clearTimeout(room.roundTimer); 
                delete rooms[code];
            }
            else { io.to(code).emit('player_left_update', room.players); if (room.gameState === 'lobby') io.to(code).emit('update_lobby', { code: code, players: room.players, hostId: room.hostId }); }
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));