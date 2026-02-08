const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true }, // اسم المستخدم (لا يتكرر)
    password: { type: String, required: true }, // كلمة المرور
    
    // شكل الأفاتار (نحفظ الأرقام عشان يظهر بنفس الشكل دائماً)
    avatarConfig: {
        color: Number,
        face: Number,
        hat: Number,
        item: Number
    },

    // إحصائيات اللعب
    stats: {
        wins: { type: Number, default: 0 },       // عدد مرات الفوز
        totalPoints: { type: Number, default: 0 }, // مجموع النقاط
        gamesPlayed: { type: Number, default: 0 }, // عدد المباريات
        level: { type: Number, default: 1 }        // المستوى
    },

    createdAt: { type: Date, default: Date.now } // تاريخ إنشاء الحساب
});

module.exports = mongoose.model('User', userSchema);