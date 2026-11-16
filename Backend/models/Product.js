const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    price: { type: Number, required: true },
    category: String,
    image: String,
    stock: Number,
    farmerId: String // Por ahora lo guardaremos como string simple
});

module.exports = mongoose.model('Product', ProductSchema, 'productos');