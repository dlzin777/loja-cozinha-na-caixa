const money = (value) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parsePrice = (str) =>
  Number(String(str).replace(/[^\d,]/g, "").replace(/\./g, "").replace(",", "."));

const state = {
  products: [],
  cart: JSON.parse(localStorage.getItem("cnc-cart") || "[]"),
};

const els = {
  grid: document.getElementById("productsGrid"),
  count: document.getElementById("productCount"),
  sort: document.getElementById("sortSelect"),
  cartCount: document.getElementById("cartCount"),
  cartBody: document.getElementById("cartBody"),
  cartTotal: document.getElementById("cartTotal"),
  cartDrawer: document.getElementById("cartDrawer"),
  cartOverlay: document.getElementById("cartOverlay"),
  menu: document.getElementById("mobileMenu"),
  menuOverlay: document.getElementById("menuOverlay"),
};

function saveCart() {
  localStorage.setItem("cnc-cart", JSON.stringify(state.cart));
}

function sortProducts(list, mode) {
  const items = [...list];
  switch (mode) {
    case "price-asc":
      return items.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
    case "price-desc":
      return items.sort((a, b) => parsePrice(b.price) - parsePrice(a.price));
    case "name-asc":
      return items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    case "name-desc":
      return items.sort((a, b) => b.name.localeCompare(a.name, "pt-BR"));
    case "discount-desc":
      return items.sort((a, b) => b.discount - a.discount);
    default:
      return items;
  }
}

function renderProducts() {
  const sorted = sortProducts(state.products, els.sort.value);
  els.count.textContent = String(sorted.length);
  els.grid.innerHTML = sorted
    .map(
      (p, index) => `
      <article class="product-card ${p.outOfStock ? "out" : ""}" style="animation: fadeUp .4s ease both; animation-delay: ${Math.min(index, 8) * 40}ms">
        <a class="product-media" href="${p.url}" target="_blank" rel="noopener">
          <img src="${p.image}" alt="${p.name}" loading="lazy" />
        </a>
        <div class="product-info">
          <a class="product-name" href="${p.url}" target="_blank" rel="noopener">${p.name}</a>
          <div class="price-row">
            <span class="compare">${p.compare}</span>
            <span class="price">${p.price}</span>
            <span class="discount">${p.discount}% OFF</span>
          </div>
          <div class="installments">${p.installments} x de ${p.installmentPrice}</div>
          <div class="pix-price">${p.pix} com Pix</div>
          <button class="btn-buy" data-url="${p.url}" ${p.outOfStock ? "disabled" : ""}>
            ${p.outOfStock ? "Esgotado" : "Adicionar"}
          </button>
        </div>
      </article>`
    )
    .join("");
}

function renderCart() {
  els.cartCount.textContent = String(state.cart.length);

  if (!state.cart.length) {
    els.cartBody.innerHTML = `<div class="cart-empty">O carrinho de compras está vazio.</div>`;
    els.cartTotal.textContent = money(0);
    return;
  }

  const total = state.cart.reduce((sum, item) => sum + parsePrice(item.price), 0);
  els.cartTotal.textContent = money(total);
  els.cartBody.innerHTML = state.cart
    .map(
      (item, i) => `
      <div class="cart-item">
        <img src="${item.image}" alt="${item.name}" />
        <div>
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">${item.price}</div>
        </div>
        <button type="button" data-remove="${i}" aria-label="Remover">×</button>
      </div>`
    )
    .join("");
}

function openCart(open = true) {
  els.cartDrawer.classList.toggle("open", open);
  els.cartOverlay.classList.toggle("open", open);
}

function openMenu(open = true) {
  els.menu.classList.toggle("open", open);
  els.menuOverlay.classList.toggle("open", open);
}

function addToCart(url) {
  const product = state.products.find((p) => p.url === url);
  if (!product || product.outOfStock) return;
  state.cart.push(product);
  saveCart();
  renderCart();
  openCart(true);
}

async function refreshAccountUI() {
  try {
    const user = await Auth.getMe();
    const link = document.getElementById("accountLink");
    const label = document.getElementById("accountLabel");
    if (!link || !label) return;
    if (user) {
      label.textContent = user.name.split(" ")[0];
      link.href = "conta.html";
    } else {
      label.textContent = "Entrar";
      link.href = "login.html";
    }
  } catch {
    // servidor antigo (sem Flask) — ignora
  }
}

async function init() {
  const res = await fetch("products.json");
  state.products = await res.json();
  renderProducts();
  renderCart();
  refreshAccountUI();

  els.sort.addEventListener("change", renderProducts);

  els.grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-buy");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    addToCart(btn.dataset.url);
  });

  els.cartBody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    state.cart.splice(Number(btn.dataset.remove), 1);
    saveCart();
    renderCart();
  });

  document.getElementById("cartOpen").addEventListener("click", () => openCart(true));
  document.getElementById("cartClose").addEventListener("click", () => openCart(false));
  els.cartOverlay.addEventListener("click", () => openCart(false));

  document.getElementById("menuOpen").addEventListener("click", () => openMenu(true));
  els.menuOverlay.addEventListener("click", () => openMenu(false));

  document.getElementById("checkoutBtn").addEventListener("click", async () => {
    if (!state.cart.length) {
      localStorage.removeItem("cnc-cart");
    }
    try {
      const user = await Auth.getMe();
      if (!user) {
        window.location.href = "login.html?next=checkout.html";
        return;
      }
    } catch {
      // se API não estiver no ar, segue para checkout
    }
    window.location.href = "checkout.html";
  });

  const cookieBar = document.getElementById("cookieBar");
  if (localStorage.getItem("cnc-cookies") === "1") {
    cookieBar.classList.add("hidden");
  }
  document.getElementById("cookieOk").addEventListener("click", () => {
    localStorage.setItem("cnc-cookies", "1");
    cookieBar.classList.add("hidden");
  });
}

const style = document.createElement("style");
style.textContent = `
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}`;
document.head.appendChild(style);

init();
