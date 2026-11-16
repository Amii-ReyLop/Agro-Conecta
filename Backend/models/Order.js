
const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    products: [{
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        name: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        unitPrice: {
            type: Number,
            required: true,
            min: 0
        }
    }],
    shipping: {
        type: Number,
        default: 0,
        min: 0
    },
    total: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: [
            'pendiente',
            'confirmada',
            'enviada',
            'entregada',
            'cancelada'
        ],
        default: 'pendiente'
    },
    address: { type: String, required: true },
    paymentMethod: { type: String, enum: ['tarjeta', 'pse', 'efecty', 'contra_entrega', 'nequi', 'daviplata', 'transferencia', 'efectivo'], default: 'contra_entrega' }
}, {
    timestamps: true,
    collection: 'ordenes'
});

module.exports = mongoose.model('Order', OrderSchema);
