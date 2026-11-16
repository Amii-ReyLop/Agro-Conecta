// Crea (o promueve) un administrador. Uso:
//   node createAdmin.js correo@dominio.com "Nombre Completo" "ContraseñaSegura123"
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

async function main() {
    const [email, name, password] = process.argv.slice(2);

    if (!email || !name || !password || password.length < 8) {
        console.error('Uso: node createAdmin.js correo "Nombre" "Contraseña (mínimo 8 caracteres)"');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.findOneAndUpdate(
        { email: normalizedEmail },
        { name: name.trim(), email: normalizedEmail, passwordHash, role: 'admin' },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`Administrador listo: ${user.email}`);
    await mongoose.disconnect();
}

main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});
