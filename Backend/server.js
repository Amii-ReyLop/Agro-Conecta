require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const { body, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Product = require('./models/Product');
const User = require('./models/User');
const Order = require('./models/Order');
const Review = require('./models/Review');
const Notification = require('./models/Notification');

const app = express();

// =========================
// CONFIGURACIÓN
// =========================

const SHIPPING_COST = 5000;
const ORDER_STATUSES = ['pendiente', 'confirmada', 'enviada', 'entregada', 'cancelada'];
const PAYMENT_METHODS = ['tarjeta', 'pse', 'efecty', 'contra_entrega', 'nequi', 'daviplata', 'transferencia', 'efectivo'];
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const FRONTEND_DIR = path.join(__dirname, '..', 'Frontend');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

// Cabeceras HTTP seguras. HSTS se activa en producción bajo HTTPS.

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
            imgSrc: ["'self'", 'data:', 'https:'],
            fontSrc: ["'self'", 'data:', 'https://cdnjs.cloudflare.com'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'self'"],
            baseUri: ["'self'"]
        }
    },
    frameguard: {
        action: 'deny'
    },
    crossOriginEmbedderPolicy: false,
    hsts: process.env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false
}));


// CORS restringido a los orígenes declarados. En desarrollo se refleja el origen.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : (process.env.NODE_ENV === 'production' ? false : true),
    credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

// =========================
// SUBIDA DE IMÁGENES
// =========================

const IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOADS_DIR),
        filename: (req, file, cb) => {
            const random = crypto.randomBytes(4).toString('hex');
            cb(null, `${Date.now()}-${random}${IMAGE_TYPES[file.mimetype]}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
        cb(new HttpError(400, 'Solo se permiten imágenes JPG, PNG, WEBP o GIF'));
    }
});

// =========================
// AUTENTICACIÓN Y UTILIDADES
// =========================

function autenticarToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = req.cookies?.agroconecta_session || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

    if (!token) {
        return res.status(401).json({ message: 'Debes iniciar sesión' });
    }

    try {
        req.usuario = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Sesión inválida o expirada' });
    }
}

function requerirRol(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.usuario.role)) {
            return res.status(403).json({ message: 'No tienes permisos para esta acción' });
        }
        next();
    };
}

function validarId(valor, nombre = 'ID') {
    if (!mongoose.isValidObjectId(valor)) {
        throw new HttpError(400, `${nombre} no válido`);
    }
}

const esAdmin = req => req.usuario.role === 'admin';

function esUrlHttp(valor) {
    try {
        const url = new URL(valor);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function urlDeImagen(req, file) {
    return `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
}

function borrarImagenLocal(imageUrl) {
    if (typeof imageUrl !== 'string' || !imageUrl.includes('/uploads/')) return;
    const nombre = path.basename(imageUrl.split('/uploads/')[1] || '');
    if (!nombre) return;
    fs.unlink(path.join(UPLOADS_DIR, nombre), () => {});
}

// Si la petición termina con error, elimina la imagen que multer ya había guardado.
function limpiarArchivoSiFalla(req, res, next) {
    res.on('finish', () => {
        if (res.statusCode >= 400 && req.file) fs.unlink(req.file.path, () => {});
    });
    next();
}

function usuarioPublico(user) {
    return {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        address: user.address,
        photo: user.photo,
        bio: user.bio
    };
}

// Rate limiting: máximo cinco intentos fallidos por IP cada 15 minutos.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Demasiados intentos. Intenta de nuevo después de 15 minutos.' },
    skipSuccessfulRequests: true
});

const csrfProtection = csrf({
    cookie: {
        key: '_csrf',
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
    }
});

function validarEntrada(req, res, next) {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
        return res.status(400).json({ message: 'Datos de entrada no válidos', errors: errores.array() });
    }
    next();
}


// El frontend solicita este token y lo envía en X-CSRF-Token en cada operación modificadora.
app.get('/api/csrf-token', csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});

// Protege POST, PUT, PATCH y DELETE contra CSRF (incluye registro y login).
app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return csrfProtection(req, res, next);
    }
    next();
});

app.get('/api/health', (req, res) => {
    res.json({ message: 'API de Agroconecta funcionando' });
});

// =========================
// USUARIOS Y AUTENTICACIÓN
// =========================

// Registro público (nunca permite crear administradores)
app.post('/api/users',
    body('name').isString().trim().isLength({ min: 3, max: 30 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('password').isString().isLength({ min: 8, max: 128 }),
    body('phone').optional().isString().isLength({ max: 30 }),
    body('address').optional().isString().isLength({ max: 200 }),
    validarEntrada, async (req, res) => {
    const { name, email, password, phone, role, address } = req.body ?? {};

    if (
        typeof name !== 'string' || !name.trim() ||
        typeof email !== 'string' || !email.trim() ||
        typeof password !== 'string' || password.length < 8
    ) {
        throw new HttpError(400, 'Nombre, correo y contraseña de al menos 8 caracteres son obligatorios');
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new HttpError(400, 'El correo no tiene un formato válido');
    }

    if (await User.findOne({ email: normalizedEmail })) {
        throw new HttpError(409, 'Ese correo ya está registrado');
    }

    const rolesPermitidos = {
        buyer: 'comprador',
        farmer: 'agricultor',
        comprador: 'comprador',
        agricultor: 'agricultor'
    };

    const passwordHash = await bcrypt.hash(password, 12);

    try {
        const user = await User.create({
            name: name.trim(),
            email: normalizedEmail,
            passwordHash,
            phone: typeof phone === 'string' ? phone.trim() : '',
            role: rolesPermitidos[role] || 'comprador',
            address: typeof address === 'string' ? address.trim() : ''
        });

        res.status(201).json({
            message: 'Usuario registrado correctamente',
            user: { id: user._id, name: user.name, email: user.email, role: user.role }
        });
    } catch (error) {
        if (error.code === 11000) throw new HttpError(409, 'Ese correo ya está registrado');
        throw error;
    }
});

// Inicio de sesión
app.post('/api/auth/login', loginLimiter,
    body('email').isEmail().normalizeEmail(),
    body('password').isString().isLength({ min: 1, max: 128 }),
    validarEntrada, async (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string') {
        throw new HttpError(400, 'Correo y contraseña son obligatorios');
    }


    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new HttpError(401, 'Correo o contraseña incorrectos');
    }

    const token = jwt.sign(
        { userId: user._id.toString(), role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
    );

    res.cookie('agroconecta_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 2 * 60 * 60 * 1000,
        path: '/'
    });
    res.json({ message: 'Inicio de sesión correcto', user: usuarioPublico(user) });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('agroconecta_session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
    });
    res.json({ message: 'Sesión cerrada correctamente' });
});

// Datos del usuario autenticado (sirve para validar la sesión al recargar)
app.get('/api/users/me', autenticarToken, async (req, res) => {
    const user = await User.findById(req.usuario.userId);
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    res.json({ user: usuarioPublico(user) });
});

// Actualizar el propio perfil
app.put('/api/users/me', autenticarToken, async (req, res) => {
    const { name, phone, address, photo, bio } = req.body ?? {};
    const cambios = {};

    if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'El nombre no puede estar vacío');
        cambios.name = name.trim();
    }
    if (phone !== undefined) cambios.phone = String(phone).trim().slice(0, 30);
    if (address !== undefined) cambios.address = String(address).trim().slice(0, 200);
    if (bio !== undefined) cambios.bio = String(bio).trim().slice(0, 500);
    if (photo !== undefined) {
        const foto = String(photo).trim();
        if (foto && !esUrlHttp(foto)) throw new HttpError(400, 'La foto debe ser una URL http(s) válida');
        cambios.photo = foto;
    }

    const user = await User.findByIdAndUpdate(req.usuario.userId, cambios, { new: true, runValidators: true });
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    res.json({ user: usuarioPublico(user) });
});

// Subir o reemplazar la foto de perfil del usuario autenticado.
app.post('/api/users/me/photo', autenticarToken, upload.single('photo'), limpiarArchivoSiFalla, async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Selecciona una imagen JPG, PNG, WEBP o GIF');
    const user = await User.findById(req.usuario.userId);
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    const fotoAnterior = user.photo;
    user.photo = urlDeImagen(req, req.file);
    await user.save();
    if (fotoAnterior && fotoAnterior !== user.photo) borrarImagenLocal(fotoAnterior);
    res.json({ message: 'Foto de perfil actualizada', user: usuarioPublico(user) });
});

// Listado completo de usuarios: solo administradores
app.get('/api/users', autenticarToken, requerirRol('admin'), async (req, res) => {
    const users = await User.find().select('name email phone role address photo bio createdAt');
    res.json(users.map(user => ({ ...user.toObject(), id: user._id.toString() })));
});

// Campesinos públicos (sin correo ni teléfono) con su calificación promedio
app.get('/api/farmers', async (req, res) => {
    const farmers = await User.find({ role: 'agricultor' }).select('name photo bio address');

    const stats = await Review.aggregate([
        { $sort: { createdAt: -1 } },
        {
            $group: {
                _id: '$farmerId',
                rating: { $avg: '$rating' },
                reviewCount: { $sum: 1 },
                lastComment: { $first: '$comment' }
            }
        }
    ]);

    const statsById = new Map(stats.map(s => [s._id.toString(), s]));

    res.json(farmers.map(farmer => {
        const s = statsById.get(farmer._id.toString());
        return {
            id: farmer._id.toString(),
            name: farmer.name,
            photo: farmer.photo,
            bio: farmer.bio,
            address: farmer.address,
            rating: s ? Math.round(s.rating * 10) / 10 : 0,
            reviewCount: s ? s.reviewCount : 0,
            lastComment: s ? s.lastComment : ''
        };
    }));
});

// =========================
// PRODUCTOS
// =========================

// Consultar productos (público)
app.get('/api/products', async (req, res) => {
    const products = await Product.find();
    const farmerIds = [...new Set(products.map(p => p.farmerId).filter(id => mongoose.isValidObjectId(id)))];
    const farmers = await User.find({ _id: { $in: farmerIds } }).select('name');
    const names = new Map(farmers.map(f => [f._id.toString(), f.name]));

    res.json(products.map(p => ({ ...p.toObject(), farmerName: names.get(p.farmerId) || '' })));
});

function validarDatosProducto(body) {
    const name = String(body.name ?? '').trim();
    const price = Number(body.price);
    const stock = Number(body.stock ?? 0);

    if (!name || !Number.isFinite(price) || price < 0) {
        throw new HttpError(400, 'El nombre y un precio válido son obligatorios');
    }
    if (!Number.isInteger(stock) || stock < 0) {
        throw new HttpError(400, 'El stock debe ser un entero no negativo');
    }

    return {
        name,
        price,
        stock,
        description: String(body.description ?? '').trim(),
        category: String(body.category ?? '').trim()
    };
}

// Crear producto (agricultores y administradores)
app.post('/api/products', autenticarToken, requerirRol('agricultor', 'admin'), upload.single('image'), limpiarArchivoSiFalla, async (req, res) => {
    const datos = validarDatosProducto(req.body ?? {});

    let image = '';
    if (req.file) {
        image = urlDeImagen(req, req.file);
    } else if (req.body?.image) {
        if (!esUrlHttp(req.body.image)) throw new HttpError(400, 'La imagen debe ser una URL http(s) válida');
        image = req.body.image;
    }

    const product = await Product.create({ ...datos, farmerId: req.usuario.userId, image });
    res.status(201).json({ ...product.toObject(), farmerName: '' });
});

// Productos del agricultor autenticado
app.get('/api/farmer/products', autenticarToken, requerirRol('agricultor'), async (req, res) => {
    res.json(await Product.find({ farmerId: req.usuario.userId }).sort({ _id: -1 }));
});

async function obtenerProductoEditable(req) {
    validarId(req.params.id, 'ID de producto');
    const product = await Product.findById(req.params.id);
    if (!product) throw new HttpError(404, 'Producto no encontrado');

    const esDueno = req.usuario.role === 'agricultor' && String(product.farmerId) === String(req.usuario.userId);
    if (!esDueno && !esAdmin(req)) {
        throw new HttpError(403, 'No tienes permisos sobre este producto');
    }
    return product;
}

// Editar producto (dueño o administrador)
app.put('/api/products/:id', autenticarToken, upload.single('image'), limpiarArchivoSiFalla, async (req, res) => {
    const product = await obtenerProductoEditable(req);
    const datos = validarDatosProducto(req.body ?? {});

    Object.assign(product, datos);

    if (req.file) {
        borrarImagenLocal(product.image);
        product.image = urlDeImagen(req, req.file);
    }

    await product.save();
    res.json(product);
});

// Eliminar producto (dueño o administrador)
app.delete('/api/products/:id', autenticarToken, async (req, res) => {
    const product = await obtenerProductoEditable(req);
    const imagen = product.image;

    await product.deleteOne();

    // Solo borra el archivo si ningún otro producto lo usa.
    if (imagen && !(await Product.exists({ image: imagen }))) borrarImagenLocal(imagen);

    res.json({ message: 'Producto eliminado' });
});

// =========================
// RESEÑAS
// =========================

app.get('/api/reviews', async (req, res) => {
    const filtro = {};
    if (req.query.farmerId) {
        validarId(req.query.farmerId, 'ID de agricultor');
        filtro.farmerId = req.query.farmerId;
    }

    const reviews = await Review.find(filtro)
        .populate('buyerId', 'name photo')
        .populate('farmerId', 'name photo')
        .sort({ createdAt: -1 })
        .limit(30);

    res.json(reviews);
});

// Un comprador deja (o actualiza) su reseña sobre un agricultor

app.post(
    '/api/reviews',
    autenticarToken,
    requerirRol('comprador'),

    // Validaciones y sanitización en el backend
    body('farmerId').isMongoId(),
    body('rating').isInt({ min: 1, max: 5 }).toInt(),
    body('comment')
        .isString()
        .trim()
        .isLength({ min: 1, max: 1000 })
        .escape(),

    validarEntrada,

    async (req, res) => {
        const { farmerId, rating, comment } = req.body;
        const texto = comment;

        if (!mongoose.isValidObjectId(farmerId) ||
            !Number.isInteger(rating) ||
            rating < 1 || rating > 5 ||
            !texto) {
            throw new HttpError(
                400,
                'Agricultor, calificación de 1 a 5 y comentario son obligatorios'
            );
        }

        const farmer = await User.findOne({
            _id: farmerId,
            role: 'agricultor'
        });

        if (!farmer) {
            throw new HttpError(404, 'Agricultor no encontrado');
        }

        const review = await Review.findOneAndUpdate(
            { buyerId: req.usuario.userId, farmerId },
            { rating, comment: texto },
            {
                new: true,
                upsert: true,
                runValidators: true,
                setDefaultsOnInsert: true
            }
        );

        res.status(201).json(review);
    }
);


// =========================
// ÓRDENES
// =========================

// Crear orden: el comprador sale del token, los precios salen de la base de datos
app.post('/api/orders', autenticarToken, async (req, res) => {
    const { products, address, paymentMethod } = req.body ?? {};
    const direccion = String(address ?? '').trim();

    if (!Array.isArray(products) || products.length === 0 || !direccion) {
        throw new HttpError(400, 'Productos y dirección son obligatorios');
    }
    if (paymentMethod !== undefined && !PAYMENT_METHODS.includes(paymentMethod)) {
        throw new HttpError(400, 'Método de pago no válido');
    }

    // Unir productos repetidos y validar entradas
    const cantidades = new Map();
    for (const item of products) {
        if (!mongoose.isValidObjectId(item?.productId) || !Number.isInteger(item?.quantity) || item.quantity < 1) {
            throw new HttpError(400, 'Producto o cantidad no válidos');
        }
        const id = String(item.productId);
        cantidades.set(id, (cantidades.get(id) || 0) + item.quantity);
    }

    const user = await User.findById(req.usuario.userId);
    if (!user) throw new HttpError(404, 'El usuario no existe');

    const encontrados = await Product.find({ _id: { $in: [...cantidades.keys()] } });
    const porId = new Map(encontrados.map(p => [p._id.toString(), p]));

    const orderProducts = [];
    let subtotal = 0;

    for (const [id, quantity] of cantidades) {
        const product = porId.get(id);
        if (!product) throw new HttpError(404, `No existe el producto ${id}`);
        if (String(product.farmerId) === String(user._id)) {
            throw new HttpError(400, 'No puedes comprar tus propios productos');
        }

        orderProducts.push({ productId: product._id, name: product.name, quantity, unitPrice: product.price });
        subtotal += product.price * quantity;
    }

    // Descuento de stock atómico: evita vender más de lo disponible
    const reservados = [];
    try {
        for (const item of orderProducts) {
            const actualizado = await Product.findOneAndUpdate(
                { _id: item.productId, stock: { $gte: item.quantity } },
                { $inc: { stock: -item.quantity } }
            );
            if (!actualizado) throw new HttpError(409, `Stock insuficiente para ${item.name}`);
            reservados.push(item);
        }

        const order = await Order.create({
            userId: user._id,
            products: orderProducts,
            shipping: SHIPPING_COST,
            total: subtotal + SHIPPING_COST,
            address: direccion,
            paymentMethod
        });

        // Notificar a cada agricultor que tenga productos incluidos en la compra.
        const agricultores = [...new Set(encontrados
            .filter(product => cantidades.has(String(product._id)) && mongoose.isValidObjectId(product.farmerId))
            .map(product => String(product.farmerId)))];
        if (agricultores.length) {
            try {
                await Notification.insertMany(agricultores.map(userId => ({
                    userId,
                    orderId: order._id,
                    type: 'new_order',
                    title: '¡Tienes una nueva compra!',
                    message: `${user.name} realizó un pedido que incluye uno o más de tus productos.`
                })));
            } catch (notificationError) {
                // Un fallo de notificaciones no debe cancelar una compra ya registrada.
                console.error('No se pudieron crear las notificaciones de compra:', notificationError);
            }
        }

        res.status(201).json({ message: 'Orden creada correctamente', order });
    } catch (error) {
        for (const item of reservados) {
            await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } });
        }
        throw error;
    }
});

// Órdenes del usuario autenticado
app.get('/api/orders/mine', autenticarToken, async (req, res) => {
    res.json(await Order.find({ userId: req.usuario.userId }).sort({ createdAt: -1 }));
});

// Todas las órdenes: solo administradores
app.get('/api/orders', autenticarToken, requerirRol('admin'), async (req, res) => {
    res.json(await Order.find().populate('userId', 'name email').sort({ createdAt: -1 }));
});

// Órdenes de un usuario: el propio usuario o un administrador
app.get('/api/orders/user/:userId', autenticarToken, async (req, res) => {
    validarId(req.params.userId, 'ID de usuario');

    if (!esAdmin(req) && req.params.userId !== req.usuario.userId) {
        throw new HttpError(403, 'No puedes ver las órdenes de otro usuario');
    }

    res.json(await Order.find({ userId: req.params.userId }).sort({ createdAt: -1 }));
});

// Órdenes que incluyen productos del agricultor autenticado
app.get('/api/farmer/orders', autenticarToken, requerirRol('agricultor'), async (req, res) => {
    const products = await Product.find({ farmerId: req.usuario.userId }).select('_id');
    const ids = products.map(p => p._id);

    const orders = await Order.find({ 'products.productId': { $in: ids } })
        .populate('userId', 'name email')
        .sort({ createdAt: -1 });

    res.json(orders.map(o => ({
        ...o.toObject(),
        products: o.products.filter(p => ids.some(id => id.equals(p.productId)))
    })));
});

// Notificaciones del usuario autenticado
app.get('/api/notifications', autenticarToken, async (req, res) => {
    const notifications = await Notification.find({ userId: req.usuario.userId })
        .sort({ createdAt: -1 }).limit(30);
    res.json(notifications);
});

// Marcar una notificación propia como leída
app.patch('/api/notifications/:id/read', autenticarToken, async (req, res) => {
    validarId(req.params.id, 'ID de notificación');
    const notification = await Notification.findOneAndUpdate(
        { _id: req.params.id, userId: req.usuario.userId },
        { read: true },
        { new: true }
    );
    if (!notification) throw new HttpError(404, 'Notificación no encontrada');
    res.json({ message: 'Notificación marcada como leída', notification });
});

// Cambiar estado de una orden
app.patch('/api/orders/:id/status', autenticarToken, async (req, res) => {
    validarId(req.params.id, 'ID de orden');

    const { status } = req.body ?? {};
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Estado no válido');

    const order = await Order.findById(req.params.id);
    if (!order) throw new HttpError(404, 'Orden no encontrada');

    const esComprador = String(order.userId) === String(req.usuario.userId);
    const esAgricultorDeLaOrden = req.usuario.role === 'agricultor' && !!(await Product.exists({
        _id: { $in: order.products.map(p => p.productId) },
        farmerId: req.usuario.userId
    }));

    if (!esAdmin(req) && !esAgricultorDeLaOrden) {
        // El comprador solo puede cancelar una orden pendiente
        if (!esComprador) throw new HttpError(403, 'No puedes modificar esta orden');
        if (status !== 'cancelada' || order.status !== 'pendiente') {
            throw new HttpError(403, 'Solo puedes cancelar órdenes pendientes');
        }
    }

    if (['entregada', 'cancelada'].includes(order.status)) {
        throw new HttpError(409, `La orden ya está ${order.status} y no se puede modificar`);
    }

    // Al cancelar se devuelve el stock
    if (status === 'cancelada') {
        for (const item of order.products) {
            await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } });
        }
    }

    const estadoAnterior = order.status;
    order.status = status;
    await order.save();

    // Cuando el agricultor acepta el pedido, avisar al comprador.
    if (status === 'confirmada' && estadoAnterior !== 'confirmada') {
        const actor = await User.findById(req.usuario.userId).select('name');
        await Notification.create({
            userId: order.userId,
            orderId: order._id,
            type: 'order_confirmed',
            title: '¡Tu compra fue aceptada!',
            message: `${actor?.name || 'El agricultor'} aceptó tu pedido y pronto comenzará a prepararlo.`
        });
    }

    res.json({ message: 'Estado actualizado', order });
});

// =========================
// FRONTEND Y MANEJO DE ERRORES
// =========================

// Sirve el frontend desde el mismo servidor: abre http://localhost:3000
app.use(express.static(FRONTEND_DIR));

app.use('/api', (req, res) => {
    res.status(404).json({ message: 'Ruta no encontrada' });
});

app.use((error, req, res, next) => {
    if (error.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ message: 'Token CSRF inválido o ausente. Recarga la página e inténtalo nuevamente.' });
    }
    if (error instanceof multer.MulterError) {
        const message = error.code === 'LIMIT_FILE_SIZE'
            ? 'La imagen no puede superar 5 MB'
            : 'Error al subir el archivo';
        return res.status(400).json({ message });
    }

    if (error.name === 'ValidationError') {
        return res.status(400).json({ message: Object.values(error.errors).map(e => e.message).join('. ') });
    }

    if (error.status && error.status < 500) {
        return res.status(error.status).json({ message: error.message });
    }

    console.error('Error interno:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
});

// =========================
// ARRANQUE
// =========================

const PORT = process.env.PORT || 3000;

async function startServer() {
    if (!process.env.MONGO_URI) {
        console.error('Falta MONGO_URI en el archivo .env');
        process.exit(1);
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        console.error('Falta JWT_SECRET en .env o tiene menos de 32 caracteres');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Conectado a MongoDB: AgroConecta');

        app.listen(PORT, () => {
            console.log(`Servidor en http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Error al conectar con MongoDB:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = app;
