const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
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

function normalizeText(text) {
    if (!text) return "";
    return text.toString().trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u065F]/g, '');
}

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

    socket.on('create_private_room', ({ name, avatarConfig }) => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomCode] = {
            code: roomCode, hostId: socket.id, players: [], settings: {},
            gameState: 'setup', currentRound: 0, chooserIndex: 0,
            currentLies: [], votes: [], usedQuestions: [], currentVoteOptions: [],
            timer: null 
        };
        const player = { id: socket.id, name, score: 0, isHost: true, avatarConfig: avatarConfig || {color:0, face:0, hat:0}, lastPoints: 0 };
        rooms[roomCode].players.push(player);
        socket.join(roomCode);
        socket.emit('go_to_setup', roomCode);
    });

    socket.on('save_settings', ({ roomCode, settings }) => {
        const room = rooms[roomCode];
        if(!room) return;
        room.settings = settings;
        room.gameState = 'lobby';
        io.to(roomCode).emit('update_lobby', { code: roomCode, players: room.players, settings: room.settings, hostId: room.hostId });
    });

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

    // --- REJOIN GAME LOGIC ---
    socket.on('rejoin_game', ({ roomCode, name, avatarConfig }) => {
        const room = rooms[roomCode];
        if (!room) return; 

        const player = room.players.find(p => p.name === name);
        if (player) {
            player.id = socket.id;
            socket.join(roomCode);
            
            if (player.isHost) room.hostId = socket.id;

            let statePayload = {
                roomCode: room.code,
                name: player.name,
                isHost: player.isHost,
                gameState: room.gameState,
                players: room.players,
                hostId: room.hostId
            };

            if (room.gameState === 'picking_topic') {
                const chooser = room.players[room.chooserIndex % room.players.length];
                statePayload.topicData = {
                    chooserId: chooser.id, 
                    chooserName: chooser.name,
                    availableTopics: room.settings.topics
                };
            } else if (room.gameState === 'input') {
                const hasAnswered = room.currentLies.some(l => l.ownerId === socket.id);
                const doneIds = room.currentLies.map(l => l.ownerId);
                statePayload.questionData = {
                    question: room.currentQuestion.q,
                    inputType: (room.currentQuestion.truth.match(/^\d+$/)) ? 'number' : 'text'
                };
                statePayload.hasAnswered = hasAnswered;
                statePayload.donePlayers = doneIds;
            } else if (room.gameState === 'voting') {
                statePayload.voteOptions = room.currentVoteOptions;
                // إضافة قائمة المصوتين ليستعيد اللاعب حالتهم
                statePayload.votedPlayers = room.votes.map(v => v.voterId);
            } else if (room.gameState === 'results') {
                statePayload.resultData = {
                    truth: room.currentQuestion.truth,
                    leaderboard: room.players,
                    isFinal: room.currentRound >= parseInt(room.settings.rounds),
                    hostId: room.hostId 
                };
            }

            socket.emit('rejoin_success', statePayload);
            
            if(room.gameState === 'lobby') {
                io.to(roomCode).emit('update_lobby', { code: roomCode, players: room.players, settings: room.settings, hostId: room.hostId });
            }
        }
    });

    // --- LOGIC FOR LEAVING GAME (تمت الإضافة هنا) ---
    socket.on('leave_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        // 1. حذف اللاعب من القائمة
        room.players = room.players.filter(p => p.id !== socket.id);
        socket.leave(roomCode);

        // 2. إذا الغرفة أصبحت فارغة نحذفها
        if (room.players.length === 0) {
            delete rooms[roomCode];
            return;
        }

        // 3. نقل الهوست إذا كان هو الذي غادر
        if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
            room.players[0].isHost = true;
        }

        // 4. تحديث اللاعبين المتبقين
        if (room.gameState === 'lobby') {
            io.to(roomCode).emit('update_lobby', { code: roomCode, players: room.players, settings: room.settings, hostId: room.hostId });
        } else {
            // إرسال تحديث خاص لإزالة الأفاتار من الفوتر أثناء اللعب
            io.to(roomCode).emit('player_left_update', room.players);
        }
    });
    // ------------------------------------------------

    socket.on('start_game_flow', (roomCode) => {
        const room = rooms[roomCode];
        if(!room || room.hostId !== socket.id) return;
        startTopicSelectionPhase(room);
    });

    function startTopicSelectionPhase(room) {
        if(room.timer) clearTimeout(room.timer); 
        
        if (room.currentRound >= parseInt(room.settings.rounds)) return finishGame(room);
        room.gameState = 'picking_topic';
        const chooser = room.players[room.chooserIndex % room.players.length];
        io.to(room.code).emit('choose_topic_phase', {
            chooserId: chooser.id, chooserName: chooser.name,
            availableTopics: room.settings.topics, currentRound: room.currentRound + 1, totalRounds: room.settings.rounds
        });
    }

    socket.on('topic_selected', ({ roomCode, topic }) => {
        const room = rooms[roomCode];
        if(!room) return;
        
        let qList = (questionsDB && questionsDB[topic]) ? questionsDB[topic] : generalQuestions;
        let available = qList.filter(q => !room.usedQuestions.includes(q.q));
        if (available.length === 0) { available = qList; room.usedQuestions = []; }

        const randomIndex = Math.floor(Math.random() * available.length);
        const question = available[randomIndex];
        room.usedQuestions.push(question.q); 
        
        const cleanTruth = normalizeText(question.truth);
        let displayQuestion = question.q;
        let inputType = 'text';

        if (/^\d+$/.test(cleanTruth)) {
            displayQuestion += " (الإجابة رقم)";
            inputType = 'number';
        } else if (cleanTruth.split(' ').length === 2) {
            displayQuestion += " (كلمتين)";
        }

        room.currentQuestion = { q: displayQuestion, truth: cleanTruth, originalTruth: question.truth };
        room.currentLies = [];
        room.votes = [];
        room.gameState = 'input';

        // === بدء تايمر السيرفر للإجابة ===
        const timeLimit = parseInt(room.settings.time) + 2; 
        if(room.timer) clearTimeout(room.timer);
        room.timer = setTimeout(() => {
            startVoting(room);
        }, timeLimit * 1000);

        io.to(roomCode).emit('start_round', {
            question: displayQuestion,
            inputType: inputType,
            time: room.settings.time,
            roundNum: room.currentRound + 1
        });
    });

    socket.on('submit_answer', ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        if(!room || room.gameState !== 'input') return;

        const userAns = normalizeText(answer);
        const systemTruth = room.currentQuestion.truth;

        if(userAns === systemTruth) {
            return socket.emit('truth_detected', 'كفو! جبتها صح.. بس غيرها عشان تغشهم 😉');
        }

        const existing = room.currentLies.find(l => l.ownerId === socket.id);
        if(!existing) {
            room.currentLies.push({ text: answer, ownerId: socket.id });
            io.to(roomCode).emit('player_done', socket.id);
        }
        socket.emit('wait_for_others');

        if(room.currentLies.length === room.players.length) {
            if(room.timer) clearTimeout(room.timer);
            startVoting(room);
        }
    });

    function startVoting(room) {
        if(room.timer) clearTimeout(room.timer);

        room.gameState = 'voting';
        let options = [{ text: room.currentQuestion.truth, type: 'TRUTH', ownerId: 'SYS' }];
        room.currentLies.forEach(l => options.push({ text: l.text, type: 'LIE', ownerId: l.ownerId }));
        options = shuffleArray(options);
        
        room.currentVoteOptions = options;

        const timeLimit = parseInt(room.settings.time) + 2; 
        room.timer = setTimeout(() => {
            calcResults(room);
        }, timeLimit * 1000);

        io.to(room.code).emit('voting_phase', {
            question: room.currentQuestion.q,
            options: options,
            time: room.settings.time
        });
    }

    socket.on('submit_vote', ({ roomCode, choiceData }) => {
        const room = rooms[roomCode];
        if(!room || room.gameState !== 'voting') return;

        const existing = room.votes.find(v => v.voterId === socket.id);
        if(!existing) {
            room.votes.push({ voterId: socket.id, choice: choiceData });
            // === إضافة مهمة: إعلام الجميع أن هذا اللاعب قد صوّت ===
            io.to(roomCode).emit('player_voted', socket.id);
        }

        if(room.votes.length === room.players.length) {
            if(room.timer) clearTimeout(room.timer); 
            calcResults(room);
        }
    });

    function calcResults(room) {
        if(room.timer) clearTimeout(room.timer);

        room.players.forEach(p => p.lastPoints = 0);
        
        room.votes.forEach(vote => {
            const voter = room.players.find(p => p.id === vote.voterId);
            const choice = vote.choice;
            if(voter) { 
                if(choice.type === 'TRUTH') {
                    voter.score += 2; voter.lastPoints += 2;
                } else if(choice.type === 'LIE') {
                    const liar = room.players.find(p => p.id === choice.ownerId);
                    if(liar && liar.id !== voter.id) { 
                        liar.score += 1; liar.lastPoints += 1; 
                    }
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

    socket.on('restart_game', (roomCode) => {
        const room = rooms[roomCode];
        if(!room || socket.id !== room.hostId) return;
        
        if(room.timer) clearTimeout(room.timer);

        room.players.forEach(p => { p.score = 0; p.lastPoints = 0; });
        room.currentRound = 0;
        room.usedQuestions = [];
        room.gameState = 'lobby';
        io.to(roomCode).emit('update_lobby', { code: roomCode, players: room.players, settings: room.settings, hostId: room.hostId });
    });

    function finishGame(room) {
        if(room.timer) clearTimeout(room.timer);
        room.gameState = 'gameover';
        io.to(room.code).emit('game_over', {
            winner: room.players[0],
            leaderboard: room.players,
            hostId: room.hostId
        });
    }
});

server.listen(3000, () => { console.log('Server running on 3000'); });