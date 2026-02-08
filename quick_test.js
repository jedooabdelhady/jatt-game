const testCases = [
    { input: 10, expected: 15, label: '10 ثواني (أقل من الحد الأدنى)' },
    { input: 15, expected: 15, label: '15 ثانية (الحد الأدنى)' },
    { input: 30, expected: 30, label: '30 ثانية (القيمة الافتراضية)' },
    { input: 60, expected: 60, label: '60 ثانية (الحد الأقصى)' },
    { input: 90, expected: 60, label: '90 ثانية (أكثر من الحد الأقصى)' }
];

console.log('🧪 اختبار منطق نطاق الثواني (15-60)...\n');

let allPassed = true;
testCases.forEach((test) => {
    const actual = Math.max(15, Math.min(60, test.input));
    const passed = actual === test.expected;
    const status = passed ? '✅' : '❌';
    
    console.log(`${status} ${test.label}`);
    console.log(`   المدخل: ${test.input}ث → النتيجة: ${actual}ث (متوقع: ${test.expected}ث)\n`);
    
    if (!passed) allPassed = false;
});

if (allPassed) {
    console.log('✅ جميع الاختبارات نجحت!');
} else {
    console.log('❌ بعض الاختبارات فشلت!');
}
