const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    type: { type: String, enum: ['new_order', 'order_confirmed'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    read: { type: Boolean, default: false }
}, { timestamps: true, collection: 'notificaciones' });

NotificationSchema.index({ userId: 1, createdAt: -1 });
module.exports = mongoose.model('Notification', NotificationSchema);
