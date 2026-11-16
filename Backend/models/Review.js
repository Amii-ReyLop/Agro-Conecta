const mongoose = require('mongoose');
const ReviewSchema = new mongoose.Schema({
 buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 rating: { type: Number, required: true, min: 1, max: 5 },
 comment: { type: String, required: true, trim: true, maxlength: 1000 }
}, { timestamps: true, collection: 'resenas' });
module.exports = mongoose.model('Review', ReviewSchema);
