const money = (value) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parsePrice = (str) =>
  Number(String(str).replace(/[^\d,]/g, "").replace(/\./g, "").replace(",", "."));

const CATEGORY_META = {
  "": { slug: "promocoes", title: "Promoções" },
  promocoes: { slug: "promocoes", title: "Promoções" },
  produtos: { slug: "produtos", title: "Produtos", isAll: true },
  "ofertas-dia-dos-pais": { slug: "ofertas-dia-dos-pais", title: "Ofertas Dia dos Pais" },
  "panelas-de-pressao": { slug: "panelas-de-pressao", title: "Pressão" },
  jogos: { slug: "jogos", title: "Jogos" },
  "panelas-de-pedra": { slug: "panelas-de-pedra", title: "Panelas de Pedra" },
  churras: { slug: "churras", title: "Churrasco" },
  fondue: { slug: "fondue", title: "Fondue" },
};

const state = {
  allProducts: [],
  products: [],
  category: "promocoes",
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
  pageTitle: document.getElementById("pageTitle"),
  breadcrumb: document.getElementById("breadcrumb"),
};

function currentCategoryFromPath() {
  const seg = (location.pathname || "/").replace(/\/+$/, "").split("/").filter(Boolean)[0] || "";
  const meta = CATEGORY_META[seg] || CATEGORY_META.promocoes;
  return meta;
}

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
      return items.sort((a, b) => (b.discount || 0) - (a.discount || 0));
    default:
      return items;
  }
}

function filterByCategory(list, meta) {
  if (meta.isAll || meta.slug === "produtos") return list;
  return list.filter((p) => (p.categories || []).includes(meta.slug));
}

function updateCategoryUI(meta) {
  state.category = meta.slug;
  if (els.pageTitle) els.pageTitle.textContent = meta.title;
  if (els.breadcrumb) {
    els.breadcrumb.innerHTML = `<a href="/">Início</a> &gt; ${meta.title}`;
  }
  document.title = `${meta.title} | Reino da Pedra`;
  document.querySelectorAll("[data-nav-slug]").forEach((a) => {
    a.classList.toggle("active", a.dataset.navSlug === meta.slug);
  });
}

function renderProducts() {
  const sorted = sortProducts(state.products, els.sort?.value || "featured");
  if (els.count) els.count.textContent = String(sorted.length);
  if (!els.grid) return;
  els.grid.innerHTML = sorted
    .map(
      (p, index) => `
      <article class="product-card ${p.outOfStock ? "out" : ""}" style="animation: fadeUp .4s ease both; animation-delay: ${Math.min(index, 8) * 40}ms">
        <div class="product-media">
          <img src="${p.image}" alt="${p.name}" loading="lazy" />
        </div>
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          <div class="price-row">
            ${p.compare && p.compare !== p.price ? `<span class="compare">${p.compare}</span>` : ""}
            <span class="price">${p.price}</span>
            ${p.discount ? `<span class="discount">${p.discount}% OFF</span>` : ""}
          </div>
          <div class="installments">${p.installments || 15} x de ${p.installmentPrice}</div>
          <div class="pix-price">${p.pix} com Pix</div>
          <button class="btn-buy" type="button" data-product-url="${p.url}" ${p.outOfStock ? "disabled" : ""}>
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
  const product =
    state.products.find((p) => p.url === url) ||
    state.allProducts.find((p) => p.url === url);
  if (!product || product.outOfStock) return;
  state.cart.push(product);
  saveCart();
  renderCart();
  openCart(true);
  try {
    window.MetaPixel?.addToCart(product);
  } catch {
    /* ignore */
  }
}

async function refreshAccountUI() {
  try {
    const user = await Auth.getMe();
    const link = document.getElementById("accountLink");
    const label = document.getElementById("accountLabel");
    if (!link || !label) return;
    if (user) {
      label.textContent = user.name.split(" ")[0];
      link.href = "/conta.html";
    } else {
      label.textContent = "Entrar";
      link.href = "/login.html";
    }
  } catch {
    // servidor antigo (sem Flask) — ignora
  }
}

function applyCategory(meta) {
  updateCategoryUI(meta);
  state.products = filterByCategory(state.allProducts, meta);
  renderProducts();
}

async function init() {
  const meta = currentCategoryFromPath();
  const res = await fetch("/products.json");
  state.allProducts = await res.json();
  applyCategory(meta);
  renderCart();
  refreshAccountUI();

  els.sort?.addEventListener("change", renderProducts);

  els.grid?.addEventListener("click", (e) => {
    // Nunca navega para página externa do produto
    const anchor = e.target.closest("a");
    if (anchor && els.grid.contains(anchor)) {
      e.preventDefault();
    }
    const btn = e.target.closest(".btn-buy");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    addToCart(btn.dataset.productUrl);
  });

  els.cartBody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    state.cart.splice(Number(btn.dataset.remove), 1);
    saveCart();
    renderCart();
  });

  document.getElementById("cartOpen")?.addEventListener("click", () => openCart(true));
  document.getElementById("cartClose")?.addEventListener("click", () => openCart(false));
  els.cartOverlay.addEventListener("click", () => openCart(false));

  document.getElementById("menuOpen")?.addEventListener("click", () => openMenu(true));
  els.menuOverlay.addEventListener("click", () => openMenu(false));

  document.getElementById("checkoutBtn")?.addEventListener("click", async () => {
    if (!state.cart.length) {
      localStorage.removeItem("cnc-cart");
    }
    try {
      const user = await Auth.getMe();
      if (!user) {
        window.location.href = "/login.html?next=/checkout.html";
        return;
      }
    } catch {
      // se API não estiver no ar, segue para checkout
    }
    window.location.href = "/checkout.html";
  });

  const cookieBar = document.getElementById("cookieBar");
  if (cookieBar) {
    if (localStorage.getItem("cnc-cookies") === "1") {
      cookieBar.classList.add("hidden");
    }
    document.getElementById("cookieOk")?.addEventListener("click", () => {
      localStorage.setItem("cnc-cookies", "1");
      cookieBar.classList.add("hidden");
    });
  }

  // Busca simples na categoria atual
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");
  searchForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = (searchInput?.value || "").trim().toLowerCase();
    const base = filterByCategory(state.allProducts, currentCategoryFromPath());
    state.products = q
      ? base.filter((p) => p.name.toLowerCase().includes(q))
      : base;
    renderProducts();
  });
}

const style = document.createElement("style");
style.textContent = `
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.nav-desktop a.active { font-weight: 700; text-decoration: underline; text-underline-offset: 4px; }
`;
document.head.appendChild(style);

init();
