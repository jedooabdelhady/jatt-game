const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const questionsData = require('./questions');

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

function normalizeCode(input) {
    if (!input) return "";
    return input.toString()
        .replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
        .replace(/[۰۱۲۳٤۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776)
        .trim();
}

function initPermanentRooms() {
    const permRooms = [
        { code: "1000", name: "Room num 1", topics: ['football','variety', 'weird', 'guinness','sudanese','math', 'science', 'history', 'tech','songs','inventors','arts','anime','flags','geography','movies'] },
        { code: "2000", name: "Room num 2", topics: ['football','variety', 'weird', 'guinness','sudanese','math', 'science', 'history', 'tech','songs','inventors','arts','anime','flags','geography','movies'] },
        { code: "3000", name: "Room num 3", topics: ['football','variety', 'weird', 'guinness','sudanese','math', 'science', 'history', 'tech','songs','inventors','arts','anime','flags','geography','movies'] },
        { code: "4000", name: "Room num 4", topics: ['football','variety', 'weird', 'guinness','sudanese','math', 'science', 'history', 'tech','songs','inventors','arts','anime','flags','geography','movies'] }
    ];

    permRooms.forEach(p => {
        rooms[p.code] = {
            code: p.code,
            hostId: null, 
            hostName: "غرفة عامة",
            players: [],
            gameState: 'lobby',
            settings: { rounds: 10, time: 30, maxPlayers: 10, topics: p.topics },
            currentRound: 0, scores: {}, roundData: {}, usedQuestions: [], availableChoosers: [], kickVotes: {}, roundTimer: null,
            isPublic: true,
            isPermanent: true,
            roomName: p.name,
            readyPlayers: [] // 🔥 قائمة اللاعبين الجاهزين
        };
        console.log(`✅ Permanent Room Created: ${p.name} (${p.code})`);
    });
}

initPermanentRooms();

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // === إنشاء غرفة خاصة ===
    socket.on('create_private_room', ({ name, avatarConfig, social, isPublic }) => {
        let rawCode = generateRoomCode();
        let roomCode = normalizeCode(rawCode);
        while (rooms[roomCode]) { rawCode = generateRoomCode(); roomCode = normalizeCode(rawCode); }

        rooms[roomCode] = {
            code: roomCode, hostId: socket.id, players: [], gameState: 'lobby',
            settings: { rounds: 5, time: 30, maxPlayers: 8, topics: [] },
            currentRound: 0, scores: {}, roundData: {}, usedQuestions: [], availableChoosers: [],
            kickVotes: {}, roundTimer: null,
            isPublic: isPublic || false,
            hostName: name,
            isPermanent: false,
            readyPlayers: [] // 🔥
        };
        joinRoom(socket, roomCode, name, avatarConfig, social, true);
    });

    // === جلب الغرف العامة ===
    socket.on('get_public_rooms', () => {
        const publicRooms = [];
        for (const code in rooms) {
            const r = rooms[code];
            if (r.isPublic && r.gameState === 'lobby' && r.players.length < r.settings.maxPlayers) {
                publicRooms.push({
                    code: r.code,
                    hostName: r.isPermanent ? r.roomName : r.hostName,
                    playersCount: r.players.length,
                    maxPlayers: r.settings.maxPlayers,
                    rounds: r.settings.rounds,
                    isPermanent: r.isPermanent || false
                });
            }
        }
        socket.emit('public_rooms_list', publicRooms);
    });

    socket.on('join_room', ({ code, name, avatarConfig, social }) => {
        const cleanCode = normalizeCode(code);
        if (rooms[cleanCode]) {
            if (rooms[cleanCode].players.length >= rooms[cleanCode].settings.maxPlayers) return socket.emit('error_msg', 'الغرفة ممتلئة!');
            let isHost = false;
            // في الغرف العامة، لا أحد هوست (إلا إذا كانت خاصة جعلت عامة)
            if (!rooms[cleanCode].isPermanent && rooms[cleanCode].players.length === 0) {
                isHost = true;
                rooms[cleanCode].hostId = socket.id;
            } else if (rooms[cleanCode].isPermanent) {
                isHost = false; // الغرف الدائمة لا هوست لها في النظام الجديد
            }
            joinRoom(socket, cleanCode, name, avatarConfig, social, isHost);
        } else {
            socket.emit('error_msg', 'الكود غلط يا فنان!');
        }
    });

    function joinRoom(socket, code, name, avatarConfig, social, isHost) {
        const room = rooms[code];
        if (!room) { socket.emit('error_msg', 'الغرفة غير موجودة.'); return; }

        const existingPlayerById = room.players.find(p => p.id === socket.id);
        if (existingPlayerById) { handlePlayerReconnect(socket, room, existingPlayerById, avatarConfig, social); return; }

        const existingPlayerByName = room.players.find(p => p.name === name);
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
        
        // تحديث حالة الجاهزية (إرسال عدد الجاهزين)
        io.to(code).emit('update_lobby', { 
            code: code, 
            players: room.players, 
            hostId: room.hostId, 
            isPublic: room.isPublic,
            readyCount: room.readyPlayers.length 
        });

        if (isHost && !room.isPermanent && !room.isPublic) {
            socket.emit('go_to_setup', code);
        }
    }

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
        
        if (player.isHost) room.hostId = socket.id;

        // تحديث قائمة الجاهزين بالـ ID الجديد
        if(room.readyPlayers.includes(oldSocketId)) {
            room.readyPlayers = room.readyPlayers.filter(id => id !== oldSocketId);
            room.readyPlayers.push(socket.id);
        }

        socket.join(room.code);

        // نقل بيانات الجولة
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
        socket.emit('rejoin_success', {
            roomCode: room.code, name: player.name, isHost: player.isHost, players: room.players, gameState: room.gameState,
            topicData: (room.gameState === 'picking_topic') ? { chooserId: room.roundData.chooserId, chooserName: players[room.roundData.chooserId]?.name, availableTopics: room.settings.topics } : null,
            questionData: (room.gameState === 'input' || room.gameState === 'voting') ? { question: room.roundData.currentQuestion.q, inputType: 'text' } : null,
            voteOptions: (room.gameState === 'voting') ? room.roundData.voteOptions : null,
            resultData: (room.gameState === 'results') ? { 
                truth: room.roundData.currentQuestion.truth, 
                leaderboard: getLeaderboard(room), 
                hostId: room.hostId, 
                isFinal: (room.currentRound >= room.settings.rounds),
                isPublic: room.isPublic, // 🔥
                readyCount: room.readyPlayers.length // 🔥
            } : null,
            hasAnswered: (room.gameState === 'input' && room.roundData.answers && room.roundData.answers[socket.id]),
            hasVoted: (room.gameState === 'voting' && room.roundData.votes && room.roundData.votes[socket.id]),
            donePlayers: (room.gameState === 'input') ? Object.keys(room.roundData.answers || {}) : [],
            votedPlayers: (room.gameState === 'voting') ? Object.keys(room.roundData.votes || {}) : [],
            isReady: room.readyPlayers.includes(socket.id), // 🔥 هل أنا جاهز؟
            isPublic: room.isPublic
        });
    }

    // === 🔥 نظام التصويت الجديد (Toggle Ready) ===
    socket.on('toggle_ready', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.readyPlayers.includes(socket.id)) {
            room.readyPlayers = room.readyPlayers.filter(id => id !== socket.id); // إلغاء الجاهزية
        } else {
            room.readyPlayers.push(socket.id); // أصبح جاهزاً
        }

        // إرسال تحديث للجميع
        io.to(roomCode).emit('update_ready_status', { 
            readyCount: room.readyPlayers.length, 
            totalPlayers: room.players.length,
            readyIds: room.readyPlayers
        });

        // التحقق: هل الجميع جاهز؟
        if (room.players.length > 1 && room.readyPlayers.length === room.players.length) {
            // إذا كنا في اللوبي -> ابدأ اللعبة
            if (room.gameState === 'lobby') {
                startTopicPhase(room);
            } 
            // إذا كنا في شاشة النتائج -> الجولة التالية
            else if (room.gameState === 'results') {
                if (room.currentRound >= room.settings.rounds) {
                    const winner = room.players.reduce((p, c) => (p.score > c.score) ? p : c);
                    const loser = room.players.reduce((p, c) => (p.score < c.score) ? p : c);
                    room.gameState = 'gameover';
                    io.to(roomCode).emit('game_over', { winner: winner, loser: loser, hostId: room.hostId });
                } else {
                    startTopicPhase(room);
                }
            }
        }
    });

    // === (تعديل) بدء اللعبة (للغرف الخاصة فقط) ===
    socket.on('start_game_flow', (roomCode) => {
        const room = rooms[roomCode]; if (!room) return;
        // في الغرف العامة، نمنع الهوست من البدء يدوياً (يجب التصويت)
        if (room.isPublic) return; 
        if (room.players.length < 2) return socket.emit('error_msg', 'لازم لاعبين اثنين على الأقل!');
        room.availableChoosers = []; startTopicPhase(room);
    });

    // === (تعديل) التالي (للغرف الخاصة فقط) ===
    socket.on('next_step', (roomCode) => {
        const room = rooms[roomCode]; if (!room) return;
        if (room.isPublic) return; // ممنوع في العامة
        if (room.currentRound >= room.settings.rounds) {
            const winner = room.players.reduce((p, c) => (p.score > c.score) ? p : c);
            const loser = room.players.reduce((p, c) => (p.score < c.score) ? p : c);
            room.gameState = 'gameover';
            io.to(roomCode).emit('game_over', { winner: winner, loser: loser, hostId: room.hostId });
        } else startTopicPhase(room);
    });

    function startTopicPhase(room) {
        if (room.roundTimer) clearTimeout(room.roundTimer); 
        room.gameState = 'picking_topic'; room.currentRound++;
        room.readyPlayers = []; // تصفير الجاهزية للجولة الجديدة
        
        if (!room.availableChoosers || room.availableChoosers.length === 0) room.availableChoosers = room.players.map(p => p.id);
        room.availableChoosers = room.availableChoosers.filter(id => players[id]); 
        
        const idx = Math.floor(Math.random() * room.availableChoosers.length);
        const chooserId = room.availableChoosers[idx]; room.availableChoosers.splice(idx, 1);
        
        const chooser = room.players.find(p => p.id === chooserId);
        if (!chooser) return startTopicPhase(room);
        
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
        io.to(room.code).emit('start_round', { question: selectedQ.q, inputType: 'text', time: room.settings.time });

        if (room.roundTimer) clearTimeout(room.roundTimer);
        room.roundTimer = setTimeout(() => {
            if (rooms[room.code] && room.gameState === 'input') {
                startVotingPhase(room);
            }
        }, (room.settings.time + 1) * 1000);
    }

    socket.on('submit_answer', ({ roomCode, answer }) => {
        const room = rooms[roomCode]; if (!room || room.gameState !== 'input') return;
        if (room.roundData.answers[socket.id]) return;
        const cleanAns = answer.trim(); const truth = room.roundData.currentQuestion.truth;
        if (cleanAns.toLowerCase() === truth.toLowerCase()) return socket.emit('truth_detected', 'يا ذكي! لازم تألف كذبة!');
        room.roundData.answers[socket.id] = cleanAns;
        io.to(roomCode).emit('player_done', socket.id);
        socket.emit('wait_for_others');
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
        io.to(room.code).emit('voting_phase', { options: options.map(o => ({ text: o.text, id: o.id })) });
    }

    socket.on('submit_vote', ({ roomCode, choiceData }) => {
        const room = rooms[roomCode]; if (!room || room.gameState !== 'voting') return;
        if (room.roundData.votes[socket.id]) return;
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
            hostId: room.hostId,
            isPublic: room.isPublic, // 🔥 لتحديد نوع الأزرار
            readyCount: room.readyPlayers.length
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

    socket.on('restart_game', (roomCode) => {
        const room = rooms[roomCode]; if (room) {
            room.currentRound = 0; room.players.forEach(p => { p.score = 0; p.lastPoints = 0; }); room.gameState = 'lobby'; room.usedQuestions = []; room.availableChoosers = [];
            room.readyPlayers = []; // تصفير الجاهزية
            io.to(roomCode).emit('update_lobby', { code: roomCode, players: room.players, hostId: room.hostId, isPublic: room.isPublic, readyCount: 0 });
        }
    });

    socket.on('leave_game', (roomCode) => leaveRoomLogic(socket, roomCode));
    socket.on('send_chat', ({ roomCode, message }) => { if (!message || !message.trim()) return; io.to(roomCode).emit('receive_chat', { senderId: socket.id, senderName: players[socket.id]?.name, message: message }); });
    socket.on('disconnect', () => { console.log('Disconnect:', socket.id); }); 

    function leaveRoomLogic(socket, code) {
        const room = rooms[code]; if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.availableChoosers) room.availableChoosers = room.availableChoosers.filter(id => id !== socket.id);
            if (room.kickVotes && room.kickVotes[socket.id]) delete room.kickVotes[socket.id];
            
            // إزالة من قائمة الجاهزين وتحديث العد
            if(room.readyPlayers.includes(socket.id)) {
                room.readyPlayers = room.readyPlayers.filter(id => id !== socket.id);
                io.to(code).emit('update_ready_status', { readyCount: room.readyPlayers.length, totalPlayers: room.players.length, readyIds: room.readyPlayers });
            }

            if (socket.id === room.hostId && room.players.length > 0 && !room.isPublic) { 
                room.hostId = room.players[0].id; room.players[0].isHost = true; 
            }

            if (room.players.length === 0) {
                if (room.roundTimer) clearTimeout(room.roundTimer); 
                if (room.isPermanent) {
                    room.gameState = 'lobby'; room.currentRound = 0; room.usedQuestions = []; room.availableChoosers = []; room.readyPlayers = [];
                } else {
                    delete rooms[code];
                }
            } else { 
                io.to(code).emit('player_left_update', room.players); 
                if (room.gameState === 'lobby') io.to(code).emit('update_lobby', { code: code, players: room.players, hostId: room.hostId, isPublic: room.isPublic, readyCount: room.readyPlayers.length }); 
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));