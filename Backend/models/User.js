
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true,
        select: false
    },
    phone: {
        type: String,
        default: ''
    },
    role: {
        type: String,
        enum: ['agricultor', 'comprador', 'admin'],
        default: 'comprador'
    },
    address: { type: String, default: '' },
    photo: { type: String, default: '' },
    bio: { type: String, default: '' }
}, {
    timestamps: true,
    collection: 'usuarios'
});

module.exports = mongoose.model('User', UserSchema);
