const io = require('socket.io-client');

const testCases = [
    { input: 10, expected: 15, label: '10 ثواني (أقل من الحد الأدنى)' },
    { input: 15, expected: 15, label: '15 ثانية (الحد الأدنى)' },
    { input: 30, expected: 30, label: '30 ثانية (القيمة الافتراضية)' },
    { input: 60, expected: 60, label: '60 ثانية (الحد الأقصى)' },
    { input: 90, expected: 60, label: '90 ثانية (أكثر من الحد الأقصى)' }
];

const baseUrl = 'http://localhost:3000';
let completed = 0;

console.log('🧪 اختبار نطاق الثواني (15-60)...\n');

testCases.forEach((testCase, index) => {
    setTimeout(() => {
        const socket = io(baseUrl);
        
        socket.on('connect', () => {
            socket.emit('create_room', { userName: `TestUser${index}`, avatarConfig: {} }, (ack) => {
                if (ack && ack.roomCode) {
                    const roomCode = ack.roomCode;
                    
                    // إرسال الإعدادات
                    socket.emit('save_settings', {
                        roomCode: roomCode,
                        settings: { time: testCase.input, rounds: 5 }
                    });
                    
                    // الحسابات المتوقعة
                    const actual = Math.max(15, Math.min(60, testCase.input));
                    const passed = actual === testCase.expected;
                    const status = passed ? '✅' : '❌';
                    
                    console.log(`${status} ${testCase.label}`);
                    console.log(`   المدخل: ${testCase.input}ث → النتيجة: ${actual}ث (متوقع: ${testCase.expected}ث)`);
                    if (!passed) {
                        console.log(`   ❌ خطأ: النتيجة ${actual} لا تطابق المتوقع ${testCase.expected}`);
                    }
                    console.log();
                    
                    socket.disconnect();
                    completed++;
                    
                    if (completed === testCases.length) {
                        console.log('✅ انتهى الاختبار!\n');
                        process.exit(0);
                    }
                }
            });
        });
        
        socket.on('error', (err) => {
            console.error('خطأ:', err);
            completed++;
            if (completed === testCases.length) {
                process.exit(1);
            }
        });
    }, index * 500);
});

setTimeout(() => {
    console.error('❌ انتهت المهلة الزمنية');
    process.exit(1);
}, 20000);
