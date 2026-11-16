// ========== CONFIGURACIÓN DE LA API ==========
// Si abres la página desde el propio backend (http://localhost:3000) usa ese mismo origen.
// Si la abres con Live Server u otro, apunta a localhost:3000.
// Puedes forzar otra dirección definiendo window.AGRO_API_BASE antes de cargar este script.
const API_BASE = window.AGRO_API_BASE
    || ((location.protocol.startsWith('http') && location.port === '3000') ? location.origin : 'http://localhost:3000');
const API = `${API_BASE}/api`;
let csrfTokenCache = null;

const SHIPPING_COST = 5000;
const USER_KEY = 'agroconecta_user';
const CART_KEY = 'agroconecta_cart';

const ROLE_TO_TYPE = { agricultor: 'farmer', comprador: 'buyer', admin: 'admin' };

const STATUS_LABELS = {
    pendiente: 'Pendiente',
    confirmada: 'Confirmada',
    enviada: 'Enviada',
    entregada: 'Entregada',
    cancelada: 'Cancelada'
};
const STATUS_BADGES = {
    pendiente: 'bg-warning text-dark',
    confirmada: 'bg-info text-dark',
    enviada: 'bg-primary',
    entregada: 'bg-success',
    cancelada: 'bg-danger'
};
const PAYMENT_LABELS = {
    tarjeta: 'Tarjeta',
    pse: 'PSE',
    efecty: 'Efecty',
    contra_entrega: 'Pago contra entrega',
    nequi: 'Nequi',
    daviplata: 'Daviplata',
    transferencia: 'Transferencia bancaria',
    efectivo: 'Efectivo (pago presencial)'
};

const FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='500' height='300'>" +
    "<rect width='100%' height='100%' fill='#e7fad2'/>" +
    "<text x='50%' y='50%' font-size='22' text-anchor='middle' fill='#2e7d32' font-family='sans-serif'>Sin imagen</text></svg>"
);
const FALLBACK_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>" +
    "<rect width='100%' height='100%' fill='#c8e6c9'/>" +
    "<circle cx='60' cy='45' r='20' fill='#2e7d32'/>" +
    "<path d='M20 110c0-25 18-40 40-40s40 15 40 40z' fill='#2e7d32'/></svg>"
);

// ========== ESTADO DE LA APLICACIÓN ==========
const state = {
    currentUser: null,
    products: [],
    productsLoaded: false,
    farmers: [],
    cart: [],
    orders: [],
    notifications: []
};

// ========== UTILIDADES ==========
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function formatPrice(value) {
    return '$' + Number(value || 0).toLocaleString('es-CO');
}

function imageSrc(url, fallback = FALLBACK_IMG) {
    if (!url || typeof url !== 'string') return fallback;
    if (url.startsWith('/')) return API_BASE + url;
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : fallback;
    } catch {
        return fallback;
    }
}

function findProduct(id) {
    return state.products.find(p => String(p.id) === String(id));
}

function showNotification(msg, type = 'info') {
    if (type === 'error') type = 'danger';

    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'position-fixed top-0 end-0 p-3 d-flex flex-column gap-2';
        container.style.zIndex = 9999;
        container.style.pointerEvents = 'none';
        document.body.appendChild(container);
    }

    const div = document.createElement('div');
    div.className = `alert alert-${type} mb-0 shadow-sm`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => div.remove(), 3500);
}

function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
        button.dataset.originalText = button.textContent;
        button.textContent = busyText;
        button.disabled = true;
    } else {
        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = false;
    }
}

// ========== CLIENTE HTTP ==========

async function obtenerTokenCSRF() {
    if (!csrfTokenCache) {
        const response = await fetch(`${API}/csrf-token`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('No fue posible obtener el token CSRF.');
        }

        const data = await response.json();
        csrfTokenCache = data.csrfToken;
    }

    const campoCSRF = document.getElementById('loginCsrfToken');

    if (campoCSRF) {
        campoCSRF.value = csrfTokenCache;
        campoCSRF.setAttribute('value', csrfTokenCache);
    }

    return csrfTokenCache;
}


function cargarTokenFormulario() {
    obtenerTokenCSRF().catch(error => console.error(error));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cargarTokenFormulario);
} else {
    cargarTokenFormulario();
}

async function apiFetch(path, { method = 'GET', body, formData, auth = true } = {}) {
    const headers = {};
    const upperMethod = method.toUpperCase();
    let payload;
    if (formData) {
        payload = formData;
    } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod)) {
        headers['X-CSRF-Token'] = await obtenerTokenCSRF();
    }

    let response;
    try {
        response = await fetch(`${API}${path}`, {
            method: upperMethod, headers, body: payload, credentials: 'include'
        });
    } catch (error) {
        throw new Error('No se pudo conectar con el servidor. Verifica que el backend esté funcionando.');
    }

    let data = null;
    try { data = await response.json(); } catch { /* respuesta sin cuerpo */ }

    if (!response.ok) {
        if (response.status === 403 && String(data?.message || '').toLowerCase().includes('csrf')) {
            csrfTokenCache = null;
        }
        if (response.status === 401 && auth) {
            clearSession();
            updateUserUI();
            showNotification('Tu sesión expiró. Inicia sesión de nuevo.', 'warning');
        }
        const error = new Error(data?.message || `Error ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return data;
}

// ========== SESIÓN ==========
function buildUser(apiUser) {
    const parts = String(apiUser.name || '').trim().split(/\s+/);
    return {
        id: apiUser.id,
        name: apiUser.name,
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' '),
        email: apiUser.email,
        type: ROLE_TO_TYPE[apiUser.role] || 'buyer',
        phone: apiUser.phone || '',
        address: apiUser.address || '',
        bio: apiUser.bio || '',
        photo: apiUser.photo || ''
    };
}

function persistUser() {
    sessionStorage.setItem(USER_KEY, JSON.stringify(state.currentUser));
}

function saveSession(apiUser) {
    state.currentUser = buildUser(apiUser);
    persistUser();
}

function clearSession() {
    sessionStorage.removeItem(USER_KEY);
    state.currentUser = null;
    state.orders = [];
    state.notifications = [];
}

function restoreSession() {
    try {
        const raw = sessionStorage.getItem(USER_KEY);
        if (raw) state.currentUser = JSON.parse(raw);
    } catch {
        clearSession();
    }
}

async function validateSession() {
    if (!state.currentUser) return;
    try {
        const data = await apiFetch('/users/me');
        state.currentUser = buildUser(data.user);
        persistUser();
        updateUserUI();
        loadOrders();
        loadNotifications();
    } catch (error) {
        if (error.status !== 401) showNotification(error.message, 'danger');
    }
}

async function loginUser(email, password) {
    try {
        const data = await apiFetch('/auth/login', { method: 'POST', auth: false, body: { email, password } });
        saveSession(data.user);
        updateUserUI();
        selectDefaultDashboardTab();
        loadOrders();
        loadNotifications();
        showNotification(`Bienvenido, ${data.user.name}`, 'success');
        return true;
    } catch (error) {
        showNotification(error.message, 'danger');
        return false;
    }
}

async function logout() {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (error) { console.warn('No se pudo invalidar la cookie de sesión:', error.message); }
    csrfTokenCache = null;
    clearSession();
    updateUserUI();
    showNotification('Sesión cerrada', 'info');
}

// ========== CARRITO (se guarda en el navegador) ==========
function loadCart() {
    try {
        const saved = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
        if (Array.isArray(saved)) {
            state.cart = saved;
            return;
        }
        // Migración desde la versión anterior (guardaba también el usuario, lo descartamos)
        const old = JSON.parse(localStorage.getItem('agroconecta_state') || 'null');
        if (old && Array.isArray(old.cart)) state.cart = old.cart;
        localStorage.removeItem('agroconecta_state');
    } catch {
        state.cart = [];
    }
}

function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

function cartLines() {
    return state.cart
        .map(item => {
            const product = findProduct(item.productId);
            return product ? { ...item, product } : null;
        })
        .filter(Boolean);
}

function addToCart(productId) {
    const product = findProduct(productId);
    if (!product) return;

    if (!(product.stock > 0)) {
        showNotification('Este producto está agotado', 'warning');
        return;
    }

    const existing = state.cart.find(item => String(item.productId) === String(productId));
    if (existing) {
        if (existing.quantity >= product.stock) {
            showNotification('No hay suficiente stock disponible', 'warning');
            return;
        }
        existing.quantity++;
    } else {
        state.cart.push({ productId: String(productId), quantity: 1 });
    }

    updateCartUI();
    saveCart();
    showNotification(`${product.name} agregado al carrito`, 'success');
}

function updateCartQuantity(productId, newQuantity) {
    const item = state.cart.find(i => String(i.productId) === String(productId));
    const product = findProduct(productId);
    if (!item || !product) return;

    if (newQuantity <= 0) return removeFromCart(productId);
    if (newQuantity > product.stock) {
        showNotification('No hay suficiente stock disponible', 'warning');
        return;
    }

    item.quantity = newQuantity;
    updateCartUI();
    saveCart();
}

function removeFromCart(productId) {
    state.cart = state.cart.filter(item => String(item.productId) !== String(productId));
    updateCartUI();
    saveCart();
}

function pruneCart() {
    // Solo después de cargar los productos, para no vaciar el carrito si falla la conexión.
    if (!state.productsLoaded) return;
    state.cart = state.cart
        .filter(item => findProduct(item.productId))
        .map(item => ({ ...item, quantity: Math.min(item.quantity, findProduct(item.productId).stock) }))
        .filter(item => item.quantity > 0);
    saveCart();
}

function renderCartItems() {
    const container = document.getElementById('cartItems');
    const lines = cartLines();

    if (lines.length === 0) {
        container.innerHTML = '<p class="text-center text-muted">Tu carrito está vacío</p>';
        return;
    }

    container.innerHTML = lines.map(({ product, quantity }) => {
        const id = escapeHTML(product.id);
        return `
            <div class="cart-item border-bottom pb-3 mb-3">
                <div class="d-flex align-items-start">
                    <img src="${escapeHTML(imageSrc(product.image))}" style="width: 60px; height: 60px; object-fit: cover;" class="rounded me-3" alt="">
                    <div class="flex-grow-1">
                        <h6 class="mb-1">${escapeHTML(product.name)}</h6>
                        <p class="mb-1 text-success">${formatPrice(product.price)}</p>
                    </div>
                    <div class="quantity-control">
                        <button type="button" class="quantity-btn" data-cart-action="dec" data-id="${id}">-</button>
                        <span class="mx-2">${quantity}</span>
                        <button type="button" class="quantity-btn" data-cart-action="inc" data-id="${id}">+</button>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger ms-2" data-cart-action="remove" data-id="${id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function updateCartUI() {
    pruneCart();
    const lines = cartLines();
    const count = lines.reduce((sum, l) => sum + l.quantity, 0);
    const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
    const shipping = count > 0 ? SHIPPING_COST : 0;

    document.getElementById('cartCount').textContent = count;
    document.getElementById('cartSubtotal').textContent = formatPrice(subtotal);
    document.getElementById('cartShipping').textContent = formatPrice(shipping);
    document.getElementById('cartTotal').textContent = formatPrice(subtotal + shipping);

    renderCartItems();
}

function openCart() {
    document.getElementById('cartSidebar').classList.add('open');
    document.getElementById('cartOverlay').classList.add('show');
}

function closeCart() {
    document.getElementById('cartSidebar').classList.remove('open');
    document.getElementById('cartOverlay').classList.remove('show');
}

// ========== PRODUCTOS ==========
async function fetchProducts() {
    try {
        const data = await apiFetch('/products', { auth: false });
        state.products = data.map(item => ({ ...item, id: item._id }));
        state.productsLoaded = true;
    } catch (error) {
        console.error('Error cargando productos:', error);
        showNotification(error.message, 'danger');
    }
    renderFeaturedProducts();
    renderAllProducts();
    renderMyProducts();
    updateCartUI();
}

function canEditProduct(product) {
    const user = state.currentUser;
    if (!user) return false;
    if (user.type === 'admin') return true;
    return user.type === 'farmer' && String(product.farmerId) === String(user.id);
}

function createProductCardHTML(product, colClass = 'col-lg-3') {
    const id = escapeHTML(product.id);
    const canEdit = canEditProduct(product);
    const soldOut = !(product.stock > 0);

    return `
        <div class="col-md-6 ${colClass}">
            <div class="card product-card position-relative h-100">
                ${canEdit ? `
                    <button type="button" class="edit-product-btn" data-product-action="edit" data-id="${id}" title="Editar producto">
                        <i class="fas fa-edit text-primary"></i>
                    </button>
                    ${state.currentUser.type === 'admin' ? '<span class="admin-badge">ADMIN</span>' : ''}
                ` : ''}
                <img src="${escapeHTML(imageSrc(product.image))}" class="card-img-top product-img" alt="${escapeHTML(product.name)}">
                <div class="card-body d-flex flex-column">
                    <h5 class="card-title">${escapeHTML(product.name)}</h5>
                    <p class="card-text flex-grow-1">${escapeHTML(product.description)}</p>
                    <div class="mb-2">
                        <span class="farmer-badge">
                            <i class="fas fa-user me-1"></i> ${escapeHTML(product.farmerName || 'Campesino Local')}
                        </span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center mt-auto">
                        <span class="fw-bold text-success">${formatPrice(product.price)}/kg</span>
                        <button type="button" class="btn btn-sm btn-primary" data-product-action="add" data-id="${id}" ${soldOut ? 'disabled' : ''}>
                            ${soldOut ? 'Agotado' : 'Agregar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderFeaturedProducts() {
    const container = document.getElementById('featuredProducts');
    const featured = state.products.slice(-8).reverse();

    container.innerHTML = featured.length
        ? featured.map(p => createProductCardHTML(p)).join('')
        : '<p class="text-center text-muted">Aún no hay productos publicados.</p>';
}

function renderAllProducts() {
    const container = document.getElementById('allProducts');
    const category = document.getElementById('categoryFilter').value;
    const list = category === 'all' ? state.products : state.products.filter(p => p.category === category);

    container.innerHTML = list.length
        ? list.map(p => createProductCardHTML(p, 'col-lg-4')).join('')
        : '<p class="text-center text-muted">No hay productos en esta categoría.</p>';
}

function renderMyProducts() {
    const user = state.currentUser;
    if (!user) return;

    const container = document.getElementById('myProductsTable');
    const mine = user.type === 'admin'
        ? state.products
        : state.products.filter(p => String(p.farmerId) === String(user.id));

    if (mine.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No hay productos registrados.</td></tr>';
        return;
    }

    container.innerHTML = mine.map(product => {
        const id = escapeHTML(product.id);
        return `
            <tr>
                <td><img src="${escapeHTML(imageSrc(product.image))}" style="width: 50px; height: 50px; object-fit: cover;" alt=""></td>
                <td>${escapeHTML(product.name)}</td>
                <td>${escapeHTML(product.farmerName || '—')}</td>
                <td><span class="badge bg-secondary">${escapeHTML(product.category || '—')}</span></td>
                <td>${formatPrice(product.price)}</td>
                <td><span class="badge ${product.stock > 10 ? 'bg-success' : 'bg-danger'}">${Number(product.stock) || 0} unid.</span></td>
                <td>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-product-action="edit" data-id="${id}"><i class="fas fa-edit"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-product-action="delete" data-id="${id}"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

function resetProductForm() {
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = '';
    updateImagePreview(null);
    document.getElementById('productModalTitle').textContent = 'Agregar Producto';
    document.getElementById('productSubmitBtn').textContent = 'Guardar Producto';
}

function editProduct(productId) {
    const product = findProduct(productId);
    if (!product || !canEditProduct(product)) {
        showNotification('No tienes permisos para editar este producto', 'danger');
        return;
    }

    document.getElementById('productForm').reset();
    document.getElementById('productId').value = product.id;
    document.getElementById('productName').value = product.name || '';
    document.getElementById('productDescription').value = product.description || '';
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productCategory').value = product.category || 'otros';
    document.getElementById('productStock').value = product.stock ?? 0;

    updateImagePreview(product.image ? imageSrc(product.image) : null);

    document.getElementById('productModalTitle').textContent = 'Editar Producto';
    document.getElementById('productSubmitBtn').textContent = 'Actualizar Producto';
    showModal('productModal');
}

async function deleteProduct(productId) {
    const product = findProduct(productId);
    if (!product || !canEditProduct(product)) return;
    if (!confirm(`¿Eliminar "${product.name}"? Esta acción no se puede deshacer.`)) return;

    try {
        await apiFetch(`/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
        showNotification('Producto eliminado', 'success');
        await fetchProducts();
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

async function submitProductForm(event) {
    event.preventDefault();

    const btn = document.getElementById('productSubmitBtn');
    const productId = document.getElementById('productId').value;

    const formData = new FormData();
    formData.append('name', document.getElementById('productName').value.trim());
    formData.append('description', document.getElementById('productDescription').value.trim());
    formData.append('price', document.getElementById('productPrice').value);
    formData.append('category', document.getElementById('productCategory').value);
    formData.append('stock', document.getElementById('productStock').value);

    const file = document.getElementById('productImage').files[0];
    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            showNotification('La imagen no puede superar 5 MB', 'warning');
            return;
        }
        formData.append('image', file);
    }

    setBusy(btn, true, 'Guardando...');
    try {
        await apiFetch(productId ? `/products/${encodeURIComponent(productId)}` : '/products', {
            method: productId ? 'PUT' : 'POST',
            formData
        });

        hideModal('productModal');
        resetProductForm();
        showNotification(productId ? 'Producto actualizado' : '¡Producto publicado!', 'success');
        await fetchProducts();
    } catch (error) {
        showNotification(error.message, 'danger');
    } finally {
        setBusy(btn, false);
    }
}

// ========== CAMPESINOS Y RESEÑAS ==========
async function fetchFarmers() {
    try {
        state.farmers = await apiFetch('/farmers', { auth: false });
    } catch (error) {
        console.error('Error cargando campesinos:', error);
        state.farmers = [];
    }
    renderFarmers();
}

function renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5;
    const empty = 5 - full - (half ? 1 : 0);
    return `${'<i class="fas fa-star"></i>'.repeat(full)}${half ? '<i class="fas fa-star-half-alt"></i>' : ''}${'<i class="far fa-star"></i>'.repeat(empty)}`;
}

function renderFarmers() {
    const container = document.getElementById('farmersList');
    const isBuyer = state.currentUser?.type === 'buyer';

    if (state.farmers.length === 0) {
        container.innerHTML = '<p class="text-center text-muted">Aún no hay campesinos registrados.</p>';
        return;
    }

    container.innerHTML = state.farmers.map(farmer => `
        <div class="col-md-4">
            <div class="farmer-card h-100">
                <img src="${escapeHTML(imageSrc(farmer.photo, FALLBACK_AVATAR))}" class="farmer-img" alt="${escapeHTML(farmer.name)}">
                <h5>${escapeHTML(farmer.name)}</h5>
                <p class="text-muted">${escapeHTML(farmer.address || 'Productor agrícola')}</p>
                ${farmer.bio ? `<p>"${escapeHTML(farmer.bio)}"</p>` : ''}
                ${farmer.reviewCount > 0 ? `
                    <div class="rating text-warning">${renderStars(farmer.rating)} <small class="text-muted">(${farmer.rating} · ${farmer.reviewCount} reseña${farmer.reviewCount === 1 ? '' : 's'})</small></div>
                    <p class="small text-muted mt-2 mb-0">Última reseña: "${escapeHTML(farmer.lastComment)}"</p>
                ` : '<p class="small text-muted mb-0">Aún sin reseñas</p>'}
                ${isBuyer ? `
                    <button type="button" class="btn btn-sm btn-outline-success mt-3"
                            data-review-farmer="${escapeHTML(farmer.id)}" data-farmer-name="${escapeHTML(farmer.name)}">
                        <i class="fas fa-star me-1"></i>Dejar reseña
                    </button>` : ''}
            </div>
        </div>
    `).join('');
}

function openReviewModal(farmerId, farmerName) {
    document.getElementById('reviewForm').reset();
    document.getElementById('reviewFarmerId').value = farmerId;
    document.getElementById('reviewModalTitle').textContent = `Reseña para ${farmerName}`;
    showModal('reviewModal');
}

async function submitReviewForm(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');

    setBusy(btn, true, 'Enviando...');
    try {
        await apiFetch('/reviews', {
            method: 'POST',
            body: {
                farmerId: document.getElementById('reviewFarmerId').value,
                rating: Number(document.getElementById('reviewRating').value),
                comment: document.getElementById('reviewComment').value.trim()
            }
        });
        hideModal('reviewModal');
        showNotification('¡Gracias por tu reseña!', 'success');
        await fetchFarmers();
    } catch (error) {
        showNotification(error.message, 'danger');
    } finally {
        setBusy(btn, false);
    }
}

// ========== MÉTODOS DE PAGO ==========
const PAYMENT_DETAILS = {
    contra_entrega: { title: 'Paga cuando recibas tu pedido', text: 'Coordina la entrega con el agricultor y realiza el pago al recibir los productos.', icon: 'fa-truck', note: 'No necesitas realizar un pago en este momento.' },
    efectivo: { title: 'Pago en efectivo', text: 'El pago se realiza presencialmente al coordinar la entrega o recogida.', icon: 'fa-money-bill-wave', note: 'Ten preparado el valor exacto de tu compra.' },
    nequi: { title: 'Pago mediante Nequi', text: 'El agricultor te compartirá los datos para coordinar la transferencia después de aceptar el pedido.', icon: 'fa-mobile-alt', note: 'Esta opción registra el método elegido; no procesa transferencias automáticamente.' },
    daviplata: { title: 'Pago mediante Daviplata', text: 'Podrás coordinar el envío del dinero con el agricultor una vez acepte el pedido.', icon: 'fa-wallet', note: 'Esta opción no realiza débitos automáticos.' },
    transferencia: { title: 'Transferencia bancaria', text: 'El agricultor te facilitará los datos bancarios para completar el pago de forma acordada.', icon: 'fa-university', note: 'Verifica los datos directamente con el agricultor.' },
    efecty: { title: 'Pago en punto Efecty', text: 'Coordina con el agricultor los datos necesarios para realizar el pago en un punto autorizado.', icon: 'fa-receipt', note: 'El comprobante debe ser verificado por las partes.' },
    pse: { title: 'Pago por PSE', text: 'El pedido quedará registrado con PSE como método seleccionado.', icon: 'fa-building-columns', note: 'La pasarela PSE no está conectada todavía; no ingreses datos bancarios en esta página.' },
    tarjeta: { title: 'Tarjeta débito o crédito', text: 'El pedido quedará registrado con tarjeta como método seleccionado.', icon: 'fa-credit-card', note: 'No se solicitan ni almacenan números de tarjeta. La pasarela de pago debe integrarse por separado.' }
};

function updatePaymentMethodUI(method) {
    const select = document.getElementById('checkoutPayment');
    const info = PAYMENT_DETAILS[method] || PAYMENT_DETAILS.contra_entrega;
    if (select) select.value = method;
    document.querySelectorAll('[data-payment-method]').forEach(card => {
        const active = card.dataset.paymentMethod === method;
        card.classList.toggle('active', active);
        card.setAttribute('aria-pressed', String(active));
    });
    const panel = document.getElementById('paymentInfoPanel');
    if (panel) panel.innerHTML = `
        <div class="d-flex gap-3 align-items-start">
            <span class="payment-info-icon"><i class="fas ${info.icon}"></i></span>
            <div><strong>${escapeHTML(info.title)}</strong><p class="small mb-1 mt-1">${escapeHTML(info.text)}</p><small class="text-muted"><i class="fas fa-info-circle me-1"></i>${escapeHTML(info.note)}</small></div>
        </div>`;
}

// ========== CHECKOUT ==========
function openCheckout() {
    const lines = cartLines();

    if (lines.length === 0) {
        showNotification('Tu carrito está vacío', 'warning');
        return;
    }
    if (!state.currentUser) {
        closeCart();
        showNotification('Inicia sesión para completar tu compra', 'warning');
        openAuthModal('login');
        return;
    }

    const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
    updatePaymentMethodUI(document.getElementById('checkoutPayment').value || 'contra_entrega');
    document.getElementById('checkoutAddress').value = state.currentUser.address || '';
    document.getElementById('checkoutSummary').innerHTML = `
        ${lines.map(l => `<div class="d-flex justify-content-between small"><span>${escapeHTML(l.product.name)} × ${l.quantity}</span><span>${formatPrice(l.product.price * l.quantity)}</span></div>`).join('')}
        <hr class="my-2">
        <div class="d-flex justify-content-between small"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
        <div class="d-flex justify-content-between small"><span>Envío</span><span>${formatPrice(SHIPPING_COST)}</span></div>
        <div class="d-flex justify-content-between fw-bold"><span>Total</span><span>${formatPrice(subtotal + SHIPPING_COST)}</span></div>
    `;
    showModal('checkoutModal');
}

async function submitCheckout(event) {
    event.preventDefault();
    const btn = document.getElementById('checkoutSubmitBtn');

    const products = cartLines().map(l => ({ productId: l.productId, quantity: l.quantity }));
    if (products.length === 0) return;

    setBusy(btn, true, 'Procesando...');
    try {
        await apiFetch('/orders', {
            method: 'POST',
            body: {
                products,
                address: document.getElementById('checkoutAddress').value.trim(),
                paymentMethod: document.getElementById('checkoutPayment').value
            }
        });

        state.cart = [];
        saveCart();
        hideModal('checkoutModal');
        closeCart();
        showNotification('¡Pedido realizado con éxito!', 'success');

        await Promise.all([fetchProducts(), loadOrders()]);
        showSection('dashboardSection');
        showDashboardTab('ordersTabLink');
    } catch (error) {
        showNotification(error.message, 'danger');
        fetchProducts(); // el stock pudo cambiar
    } finally {
        setBusy(btn, false);
    }
}

// ========== NOTIFICACIONES ==========
async function loadNotifications(showNew = false) {
    if (!state.currentUser) return;
    try {
        const previousUnread = new Set(state.notifications.filter(n => !n.read).map(n => String(n._id)));
        state.notifications = await apiFetch('/notifications');
        renderNotifications();
        if (showNew) {
            const newest = state.notifications.find(n => !n.read && !previousUnread.has(String(n._id)));
            if (newest) showNotification(newest.title, 'info');
        }
    } catch (error) {
        if (error.status !== 401) console.warn('No se pudieron cargar las notificaciones:', error.message);
    }
}

function renderNotifications() {
    const list = document.getElementById('notificationList');
    const badge = document.getElementById('notificationCount');
    if (!list || !badge) return;
    if (!state.currentUser) {
        badge.classList.add('d-none');
        list.innerHTML = '<p class="text-muted text-center small p-3 mb-0">Inicia sesión para ver tus notificaciones.</p>';
        return;
    }
    const unread = state.notifications.filter(n => !n.read).length;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('d-none', unread === 0);
    if (!state.notifications.length) {
        list.innerHTML = '<p class="text-muted text-center small p-3 mb-0">No tienes notificaciones por ahora.</p>';
        return;
    }
    list.innerHTML = state.notifications.map(n => `
        <button type="button" class="notification-item ${n.read ? '' : 'unread'}" data-notification-id="${escapeHTML(n._id)}">
            <span class="notification-item-icon"><i class="fas ${n.type === 'new_order' ? 'fa-bag-shopping' : 'fa-circle-check'}"></i></span>
            <span class="flex-grow-1"><strong>${escapeHTML(n.title)}</strong><span>${escapeHTML(n.message)}</span><small>${new Date(n.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
            ${n.read ? '' : '<span class="notification-unread-dot"></span>'}
        </button>`).join('');
}

async function markNotificationRead(id) {
    try {
        await apiFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: {} });
        const item = state.notifications.find(n => String(n._id) === String(id));
        if (item) item.read = true;
        renderNotifications();
        showSection('dashboardSection');
        showDashboardTab('ordersTabLink');
        await loadOrders();
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

// ========== PEDIDOS ==========
async function loadOrders() {
    const user = state.currentUser;
    if (!user) return;

    const path = user.type === 'farmer' ? '/farmer/orders' : user.type === 'admin' ? '/orders' : '/orders/mine';

    try {
        state.orders = await apiFetch(path);
    } catch (error) {
        if (error.status !== 401) showNotification(error.message, 'danger');
        state.orders = [];
    }
    renderOrders();
}

function renderOrders() {
    const container = document.getElementById('ordersList');
    const title = document.getElementById('ordersTitle');
    const user = state.currentUser;
    if (!user) return;

    const isManager = user.type === 'farmer' || user.type === 'admin';
    title.textContent = user.type === 'farmer' ? 'Pedidos recibidos'
        : user.type === 'admin' ? 'Todos los pedidos'
        : 'Historial de compras';

    if (state.orders.length === 0) {
        container.innerHTML = '<p class="text-muted">No hay pedidos registrados.</p>';
        return;
    }

    container.innerHTML = state.orders.map(order => {
        const id = escapeHTML(order._id);
        const finished = ['entregada', 'cancelada'].includes(order.status);
        const amount = user.type === 'farmer'
            ? order.products.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0)
            : order.total;
        const buyer = order.userId && typeof order.userId === 'object'
            ? `${escapeHTML(order.userId.name)} (${escapeHTML(order.userId.email)})`
            : '';
        const date = new Date(order.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

        let actions = '';
        if (isManager && !finished) {
            actions = `
                <select class="form-select form-select-sm w-auto" data-order-status="${id}">
                    ${Object.entries(STATUS_LABELS).map(([value, label]) =>
                        `<option value="${value}" ${value === order.status ? 'selected' : ''}>${label}</option>`).join('')}
                </select>`;
        } else if (!isManager && order.status === 'pendiente') {
            actions = `<button type="button" class="btn btn-sm btn-outline-danger" data-order-action="cancel" data-id="${id}">Cancelar pedido</button>`;
        }

        return `
            <div class="card mb-3">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                        <div>
                            <h6 class="mb-0">Pedido #${escapeHTML(String(order._id).slice(-6).toUpperCase())}</h6>
                            <small class="text-muted">${escapeHTML(date)}</small>
                        </div>
                        <span class="badge ${STATUS_BADGES[order.status] || 'bg-secondary'}">${escapeHTML(STATUS_LABELS[order.status] || order.status)}</span>
                    </div>
                    ${buyer ? `<p class="small mb-1 mt-2"><i class="fas fa-user me-1"></i>${buyer}</p>` : ''}
                    <ul class="mt-2 mb-2">
                        ${order.products.map(p => `<li>${escapeHTML(p.name)} × ${p.quantity} — ${formatPrice(p.unitPrice * p.quantity)}</li>`).join('')}
                    </ul>
                    <p class="small mb-1"><i class="fas fa-map-marker-alt me-1"></i>${escapeHTML(order.address)}</p>
                    <p class="small mb-2"><i class="fas fa-credit-card me-1"></i>${escapeHTML(PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod)}</p>
                    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <strong>${user.type === 'farmer' ? 'Total de tus productos' : 'Total'}: ${formatPrice(amount)}</strong>
                        ${actions}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function updateOrderStatus(orderId, status) {
    if (status === 'cancelada' && !confirm('¿Cancelar este pedido? El stock volverá a estar disponible.')) {
        renderOrders();
        return;
    }

    try {
        await apiFetch(`/orders/${encodeURIComponent(orderId)}/status`, { method: 'PATCH', body: { status } });
        showNotification('Estado del pedido actualizado', 'success');
        await loadOrders();
        if (status === 'cancelada') fetchProducts();
    } catch (error) {
        showNotification(error.message, 'danger');
        await loadOrders();
    }
}

// ========== PERFIL ==========
function fillProfileForm() {
    const user = state.currentUser;
    if (!user) return;
    document.getElementById('profileFirstName').value = user.firstName;
    document.getElementById('profileLastName').value = user.lastName;
    document.getElementById('profileEmail').value = user.email;
    document.getElementById('profilePhone').value = user.phone;
    document.getElementById('profileAddress').value = user.address;
    document.getElementById('profileBio').value = user.bio;
    const preview = document.getElementById('profilePhotoPreview');
    preview.src = imageSrc(user.photo, FALLBACK_AVATAR);
}

async function submitProfileForm(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    const first = document.getElementById('profileFirstName').value.trim();
    const last = document.getElementById('profileLastName').value.trim();

    setBusy(btn, true, 'Guardando...');
    try {
        const photoInput = document.getElementById('profilePhoto');
        if (photoInput.files && photoInput.files.length) {
            const photoData = new FormData();
            photoData.append('photo', photoInput.files[0]);
            const photoResult = await apiFetch('/users/me/photo', { method: 'POST', formData: photoData });
            state.currentUser = buildUser(photoResult.user);
        }
        const data = await apiFetch('/users/me', {
            method: 'PUT',
            body: {
                name: `${first} ${last}`.trim(),
                phone: document.getElementById('profilePhone').value.trim(),
                address: document.getElementById('profileAddress').value.trim(),
                bio: document.getElementById('profileBio').value.trim()
            }
        });
        state.currentUser = buildUser(data.user);
        persistUser();
        updateUserUI();
        document.getElementById('profilePhoto').value = '';
        fillProfileForm();
        showNotification('Perfil actualizado', 'success');
        fetchFarmers();
    } catch (error) {
        showNotification(error.message, 'danger');
    } finally {
        setBusy(btn, false);
    }
}

// ========== INTERFAZ ==========
function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }

function updateImagePreview(url) {
    const preview = document.getElementById('imagePreview');
    if (url) {
        preview.src = url;
        preview.style.display = 'block';
    } else {
        preview.removeAttribute('src');
        preview.style.display = 'none';
    }
}

function showSection(id) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'block';
    window.scrollTo(0, 0);
    if (id === 'dashboardSection' && state.currentUser) loadOrders();
}

function navigateTo(section) {
    if (section === 'farmers') {
        // "Campesinos" es una sección dentro del inicio
        showSection('homeSection');
        document.getElementById('farmers').scrollIntoView({ behavior: 'smooth' });
    } else {
        showSection(section + 'Section');
    }
}

function showDashboardTab(linkId) {
    const link = document.getElementById(linkId);
    if (link && typeof bootstrap !== 'undefined') bootstrap.Tab.getOrCreateInstance(link).show();
}

function selectDefaultDashboardTab() {
    const type = state.currentUser?.type;
    showDashboardTab(type === 'farmer' || type === 'admin' ? 'productsTabLink' : 'ordersTabLink');
}

function openAuthModal(tab = 'login') {
    showModal('authModal');
    const link = document.querySelector(`#authTabs a[href="#${tab}Tab"]`);
    if (link && typeof bootstrap !== 'undefined') bootstrap.Tab.getOrCreateInstance(link).show();
}

function updateUserUI() {
    const user = state.currentUser;
    const canManage = user && (user.type === 'farmer' || user.type === 'admin');

    document.getElementById('userName').textContent = user ? (user.firstName || user.name) : 'Invitado';
    document.getElementById('authDivider').classList.toggle('d-none', !user);
    document.getElementById('profileLink').classList.toggle('d-none', !user);
    document.getElementById('logoutLink').classList.toggle('d-none', !user);
    document.querySelectorAll('[data-action="login"], [data-action="register"]').forEach(el => {
        el.classList.toggle('d-none', !!user);
    });

    document.getElementById('guestDashboard').style.display = user ? 'none' : 'block';
    document.getElementById('userDashboard').style.display = user ? 'block' : 'none';

    if (user) {
        document.getElementById('productsTabLink').parentElement.style.display = canManage ? '' : 'none';
        document.getElementById('adminAlert').style.display = user.type === 'admin' ? 'block' : 'none';
        fillProfileForm();
        renderMyProducts();
        renderOrders();
        renderNotifications();
    } else {
        renderNotifications();
    }

    // Se vuelven a dibujar para mostrar/ocultar botones según el rol
    renderFeaturedProducts();
    renderAllProducts();
    renderFarmers();
}

// ========== EVENTOS ==========
function setupEventListeners() {
    // Navegación
    document.querySelectorAll('[data-section]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            navigateTo(link.dataset.section);
        });
    });

    // Carrito
    document.getElementById('cartToggle').addEventListener('click', openCart);
    document.getElementById('closeCart').addEventListener('click', closeCart);
    document.getElementById('cartOverlay').addEventListener('click', closeCart);
    document.getElementById('checkoutBtn').addEventListener('click', openCheckout);
    document.getElementById('notificationToggle').addEventListener('click', () => {
        if (!state.currentUser) { showNotification('Inicia sesión para consultar tus notificaciones.', 'warning'); return; }
        document.getElementById('notificationDropdown').classList.toggle('show');
        loadNotifications();
    });
    document.getElementById('paymentMethodGrid').addEventListener('click', event => {
        const card = event.target.closest('[data-payment-method]');
        if (card) updatePaymentMethodUI(card.dataset.paymentMethod);
    });

    // Menú de usuario
    document.getElementById('userToggle').addEventListener('click', () => {
        document.getElementById('userMenu').classList.toggle('show');
    });

    document.querySelectorAll('[data-action="login"]').forEach(el => {
        el.addEventListener('click', e => { e.preventDefault(); openAuthModal('login'); });
    });
    document.querySelectorAll('[data-action="register"]').forEach(el => {
        el.addEventListener('click', e => { e.preventDefault(); openAuthModal('register'); });
    });
    document.querySelectorAll('[data-action="logout"]').forEach(el => {
        el.addEventListener('click', e => { e.preventDefault(); logout(); });
    });
    document.querySelectorAll('[data-action="profile"]').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            showSection('dashboardSection');
            showDashboardTab('profileTabLink');
        });
    });

    // Cerrar modales
    document.getElementById('closeAuthModal').addEventListener('click', () => hideModal('authModal'));
    document.getElementById('closeProductModal').addEventListener('click', () => hideModal('productModal'));
    document.getElementById('closeCheckoutModal').addEventListener('click', () => hideModal('checkoutModal'));
    document.getElementById('closeReviewModal').addEventListener('click', () => hideModal('reviewModal'));
    document.querySelectorAll('.modal-custom').forEach(modal => {
        modal.addEventListener('mousedown', e => { if (e.target === modal) hideModal(modal.id); });
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') document.querySelectorAll('.modal-custom.show').forEach(m => hideModal(m.id));
    });

    // Formularios
    document.getElementById('loginForm').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        setBusy(btn, true, 'Ingresando...');
        const ok = await loginUser(
            document.getElementById('loginEmail').value.trim(),
            document.getElementById('loginPassword').value
        );
        setBusy(btn, false);
        if (ok) {
            hideModal('authModal');
            e.target.reset();
        }
    });

    document.getElementById('registerForm').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const email = document.getElementById('registerEmail').value.trim();
        const password = document.getElementById('registerPassword').value;
        const first = document.getElementById('registerFirstName').value.trim();
        const last = document.getElementById('registerLastName').value.trim();
        const isFarmer = document.getElementById('registerType').value === 'farmer';

        setBusy(btn, true, 'Registrando...');
        try {
            await apiFetch('/users', {
                method: 'POST',
                auth: false,
                body: { name: `${first} ${last}`.trim(), email, password, role: isFarmer ? 'agricultor' : 'comprador' }
            });
            showNotification('¡Registro exitoso!', 'success');

            if (await loginUser(email, password)) {
                hideModal('authModal');
                e.target.reset();
                if (isFarmer) fetchFarmers();
            }
        } catch (error) {
            showNotification(error.message, 'danger');
        } finally {
            setBusy(btn, false);
        }
    });

    document.getElementById('productForm').addEventListener('submit', submitProductForm);
    document.getElementById('checkoutForm').addEventListener('submit', submitCheckout);
    document.getElementById('reviewForm').addEventListener('submit', submitReviewForm);
    document.getElementById('profilePhoto').addEventListener('change', event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
            event.target.value = '';
            showNotification('Selecciona una imagen JPG, PNG, WEBP o GIF de máximo 5 MB.', 'warning');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => { document.getElementById('profilePhotoPreview').src = reader.result; };
        reader.readAsDataURL(file);
    });
    document.getElementById('profileForm').addEventListener('submit', submitProfileForm);

    document.getElementById('categoryFilter').addEventListener('change', renderAllProducts);

    document.getElementById('productImage').addEventListener('change', event => {
        const file = event.target.files[0];
        if (!file) return updateImagePreview(null);
        const reader = new FileReader();
        reader.onload = e => updateImagePreview(e.target.result);
        reader.readAsDataURL(file);
    });

    const addProductBtn = document.getElementById('addProductBtn');
    if (addProductBtn) {
        addProductBtn.addEventListener('click', () => {
            resetProductForm();
            showModal('productModal');
        });
    }

    // Acciones dentro de contenido generado dinámicamente (delegación de eventos)
    document.addEventListener('click', e => {
        const productBtn = e.target.closest('[data-product-action]');
        if (productBtn) {
            const { productAction, id } = productBtn.dataset;
            if (productAction === 'add') addToCart(id);
            if (productAction === 'edit') editProduct(id);
            if (productAction === 'delete') deleteProduct(id);
            return;
        }

        const cartBtn = e.target.closest('[data-cart-action]');
        if (cartBtn) {
            const { cartAction, id } = cartBtn.dataset;
            const item = state.cart.find(i => String(i.productId) === String(id));
            if (cartAction === 'inc' && item) updateCartQuantity(id, item.quantity + 1);
            if (cartAction === 'dec' && item) updateCartQuantity(id, item.quantity - 1);
            if (cartAction === 'remove') removeFromCart(id);
            return;
        }

        const notificationBtn = e.target.closest('[data-notification-id]');
        if (notificationBtn) return markNotificationRead(notificationBtn.dataset.notificationId);

        const orderBtn = e.target.closest('[data-order-action="cancel"]');
        if (orderBtn) return updateOrderStatus(orderBtn.dataset.id, 'cancelada');

        const reviewBtn = e.target.closest('[data-review-farmer]');
        if (reviewBtn) return openReviewModal(reviewBtn.dataset.reviewFarmer, reviewBtn.dataset.farmerName);

        if (!e.target.closest('#notificationMenu')) {
            document.getElementById('notificationDropdown').classList.remove('show');
        }
        if (!e.target.closest('.user-menu')) {
            document.getElementById('userMenu').classList.remove('show');
        } else if (e.target.closest('.dropdown-item')) {
            document.getElementById('userMenu').classList.remove('show');
        }
    });

    document.addEventListener('change', e => {
        const select = e.target.closest('[data-order-status]');
        if (select) updateOrderStatus(select.dataset.orderStatus, select.value);
    });

    // Imagen de reemplazo si alguna URL falla
    document.addEventListener('error', e => {
        const img = e.target;
        if (img.tagName !== 'IMG' || img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = '1';
        img.src = img.classList.contains('farmer-img') ? FALLBACK_AVATAR : FALLBACK_IMG;
    }, true);
}

// ========== INICIALIZACIÓN ==========
document.addEventListener('DOMContentLoaded', () => {
    loadCart();
    restoreSession();
    setupEventListeners();
    updateCartUI();
    updateUserUI();
    if (state.currentUser) {
        selectDefaultDashboardTab();
        loadNotifications();
    }
    window.setInterval(() => { if (state.currentUser) loadNotifications(true); }, 12000);

    Promise.all([fetchProducts(), fetchFarmers()]).then(validateSession);
});
