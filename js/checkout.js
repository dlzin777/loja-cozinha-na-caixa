const money = (value) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parsePrice = (str) =>
  Number(String(str).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

/** Pedido demo (quando carrinho local estiver vazio) */
const DEMO_ORDER = [
  {
    name: "JOGO 5 Peças - De Geração em Geração",
    qty: 1,
    price: 599.4,
    compare: 1981,
    discount: 70,
    image:
      "https://acdn-us.mitiendanube.com/stores/003/396/869/products/17328193866748b9ba2527a-c134530ff73038aa5c17647697646114-480-0.webp",
  },
  {
    name: "Voucher SORTEIO IPHONE",
    qty: 1,
    price: 0,
    compare: null,
    discount: null,
    image:
      "https://acdn-us.mitiendanube.com/stores/003/396/869/products/voucher_iphone17_1mb-c5da71d81a59bd5e3a17845683635916-100-0.webp",
  },
  {
    name: "Panela de Pedra - 4 Litros",
    qty: 1,
    price: 263.4,
    compare: 439,
    discount: 40,
    image:
      "https://acdn-us.mitiendanube.com/stores/003/396/869/products/1-48855aad8a76bcc16517835592532750-480-0.webp",
  },
];

const PIX_DISCOUNT_RATE = 0.05;
const FREE_SHIPPING_MIN = 300; // frete grátis acima de R$300 em produtos

const state = {
  items: [],
  shipping: 19.85,
  selectedShipping: 19.85,
  shippingLabel: "Jadlog - .Package (via Melhor Envio)",
  coupon: null,
  step: "delivery",
  transactionId: null,
  orderCode: null,
  pollTimer: null,
};

function hasFreeShipping() {
  return subtotal() >= FREE_SHIPPING_MIN;
}

function applyShippingRules() {
  const free = hasFreeShipping();
  const note = document.getElementById("shipFreeNote");
  if (note) note.hidden = !free;

  document.querySelectorAll('input[name="shipping"]').forEach((el) => {
    const base = Number(el.value);
    const priceEl = el.closest(".ship-option")?.querySelector("[data-ship-price]");
    if (priceEl) priceEl.textContent = free ? "Grátis" : money(base);
    el.disabled = false;
  });

  if (free) {
    state.shipping = 0;
  } else if (state.coupon?.type === "shipping") {
    state.shipping = 0;
  } else {
    state.shipping = state.selectedShipping;
  }
}

function loadItems() {
  const saved = JSON.parse(localStorage.getItem("cnc-cart") || "[]");
  if (saved.length) {
    state.items = saved.map((p) => ({
      name: p.name,
      qty: 1,
      price: parsePrice(p.price),
      compare: p.compare ? parsePrice(p.compare) : null,
      discount: p.discount ?? null,
      image: p.image.replace("-480-0", "-100-0"),
    }));
    const hasVoucher = state.items.some((i) => /voucher/i.test(i.name));
    if (!hasVoucher) state.items.push(DEMO_ORDER[1]);
    return;
  }
  state.items = DEMO_ORDER.map((i) => ({ ...i }));
}

function subtotal() {
  return state.items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function couponDiscount() {
  if (!state.coupon) return 0;
  if (state.coupon.type === "percent") return subtotal() * state.coupon.value;
  return 0;
}

function pixDiscount() {
  return +(subtotal() * PIX_DISCOUNT_RATE).toFixed(2);
}

function total() {
  return Math.max(0, subtotal() - couponDiscount() - pixDiscount() + state.shipping);
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function formatCep(value) {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length > 5) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
}

function formatCpf(value) {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function formatPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").trim();
  }
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").trim();
}

function validCpf(cpf) {
  cpf = onlyDigits(cpf);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (base) => {
    let sum = 0;
    for (let i = 0; i < base; i++) sum += Number(cpf[i]) * (base + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function customerName() {
  const first = document.getElementById("firstName").value.trim();
  const last = document.getElementById("lastName").value.trim();
  return `${first} ${last}`.trim();
}

function renderSummary() {
  document.getElementById("summaryItems").innerHTML = state.items
    .map(
      (item) => `
      <li>
        <img src="${item.image}" alt="${item.name}" />
        <div><div class="item-name">${item.name} <span class="item-qty">× ${item.qty}</span></div></div>
        <div class="item-prices">
          ${item.discount ? `<span class="discount">-${item.discount}%</span>` : ""}
          ${item.compare ? `<span class="compare">${money(item.compare)}</span>` : ""}
          <span class="price">${money(item.price)}</span>
        </div>
      </li>`
    )
    .join("");

  const coupon = couponDiscount();
  applyShippingRules();

  document.getElementById("sumSubtotal").textContent = money(subtotal());
  document.getElementById("sumShipping").textContent = hasFreeShipping() || state.shipping === 0
    ? "Grátis"
    : money(state.shipping);
  document.getElementById("sumPixDiscount").textContent = `- ${money(pixDiscount())}`;
  document.getElementById("sumTotal").textContent = money(total());
  document.getElementById("mobileTotal").textContent = money(total());

  const discountRow = document.getElementById("discountRow");
  if (coupon > 0) {
    discountRow.classList.remove("hidden");
    document.getElementById("sumDiscount").textContent = `- ${money(coupon)}`;
  } else {
    discountRow.classList.add("hidden");
  }
}

function updatePaymentReview() {
  document.getElementById("reviewEmail").textContent =
    document.getElementById("email").value.trim() || "—";

  const address = document.getElementById("address").value.trim();
  const number = document.getElementById("number").value.trim();
  const complement = document.getElementById("complement").value.trim();
  const zip = document.getElementById("zipcode").value.trim();
  const locality = document.getElementById("locality").value.trim();
  const city = document.getElementById("city").value.trim();
  const uf = document.getElementById("state").value.trim();

  document.getElementById("reviewAddressLine").textContent =
    [address, number].filter(Boolean).join(" ") + (complement ? `, ${complement}` : "");
  document.getElementById("reviewCepLine").textContent = `CEP ${zip}${locality ? ` - ${locality}` : ""}`;
  document.getElementById("reviewCityLine").textContent = [city, uf].filter(Boolean).join(", ");
  const shipText = hasFreeShipping() || state.shipping === 0 ? "Grátis" : money(state.shipping);
  document.getElementById("reviewShipping").textContent =
    `${state.shippingLabel} · ${shipText}`;
}

function setStep(step) {
  state.step = step;
  document.getElementById("stepDelivery").classList.toggle("hidden", step !== "delivery");
  document.getElementById("stepPayment").classList.toggle("hidden", step !== "payment");
  document.getElementById("stepPix").classList.toggle("hidden", step !== "pix");

  document.querySelectorAll(".cko-steps li").forEach((li) => {
    const s = li.dataset.step;
    li.classList.toggle("active", s === step || (step === "pix" && s === "payment"));
    li.classList.toggle(
      "done",
      s === "cart" || (s === "delivery" && (step === "payment" || step === "pix"))
    );
  });

  if (step === "payment") updatePaymentReview();
}

function fillFromUser(user) {
  if (!user) return;
  const map = {
    email: user.email,
    phone: user.phone,
    cpf: user.cpf,
    zipcode: user.zipcode,
    address: user.address,
    number: user.number,
    complement: user.complement,
    locality: user.locality,
    city: user.city,
    state: user.state,
  };
  for (const [id, value] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el || !value) continue;
    if (id === "zipcode") el.value = formatCep(value);
    else if (id === "cpf") el.value = formatCpf(value);
    else if (id === "phone") el.value = formatPhone(value);
    else el.value = value;
  }
  if (user.name) {
    const parts = user.name.trim().split(/\s+/);
    const first = document.getElementById("firstName");
    const last = document.getElementById("lastName");
    if (first && !first.value) first.value = parts[0] || "";
    if (last && !last.value) last.value = parts.slice(1).join(" ");
  }
  document.getElementById("addressBlock").classList.remove("hidden");
}

function profilePayload() {
  return {
    zipcode: document.getElementById("zipcode").value.trim(),
    address: document.getElementById("address").value.trim(),
    number: document.getElementById("number").value.trim(),
    complement: document.getElementById("complement").value.trim(),
    locality: document.getElementById("locality").value.trim(),
    city: document.getElementById("city").value.trim(),
    state: document.getElementById("state").value.trim(),
  };
}

function validateDelivery() {
  const name = customerName();
  const email = document.getElementById("email").value.trim();
  const phone = onlyDigits(document.getElementById("phone").value);
  const cpf = onlyDigits(document.getElementById("cpf").value);
  const zip = onlyDigits(document.getElementById("zipcode").value);
  const number = document.getElementById("number").value.trim();

  if (name.length < 3) {
    alert("Informe nome e sobrenome.");
    return false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("Informe um e-mail válido.");
    return false;
  }
  if (phone.length < 10) {
    alert("Informe um telefone com DDD.");
    return false;
  }
  if (!validCpf(cpf)) {
    alert("Informe um CPF válido.");
    return false;
  }
  if (zip.length !== 8) {
    alert("Informe um CEP válido.");
    return false;
  }
  if (!number) {
    alert("Informe o número do endereço.");
    return false;
  }
  return true;
}

function applyCoupon(inputId, msgId) {
  const code = document.getElementById(inputId).value.trim().toUpperCase();
  const msg = document.getElementById(msgId);
  msg.classList.remove("hidden", "ok", "err");
  if (code === "PANELAS10" || code === "PIX10") {
    state.coupon = { code, type: "percent", value: 0.1 };
    msg.textContent = "Cupom aplicado: 10% de desconto";
    msg.classList.add("ok");
  } else if (code === "FRETEGRATIS") {
    state.shipping = 0;
    state.coupon = { code, type: "shipping", value: 0 };
    document.querySelectorAll('input[name="shipping"]').forEach((r) => {
      r.checked = false;
      r.disabled = true;
    });
    msg.textContent = "Cupom aplicado: frete grátis";
    msg.classList.add("ok");
  } else {
    state.coupon = null;
    msg.textContent = "Cupom inválido";
    msg.classList.add("err");
  }
  renderSummary();
  updatePaymentReview();
}

function renderQr(copyPaste) {
  const box = document.getElementById("qrcode");
  box.innerHTML = "";
  // qrcodejs (global QRCode)
  // eslint-disable-next-line no-undef
  new QRCode(box, {
    text: copyPaste,
    width: 220,
    height: 220,
    correctLevel: QRCode.CorrectLevel.M,
  });
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startPolling(txId) {
  stopPolling();
  const statusEl = document.getElementById("pixStatus");

  const tick = async () => {
    try {
      const { res, data } = await Auth.api(`/api/checkout/pix/${encodeURIComponent(txId)}`);
      if (!res.ok) {
        statusEl.textContent = data.error || "Erro ao consultar pagamento";
        return;
      }
      const status = (data.status || "").toUpperCase();
      statusEl.textContent = `Status: ${status}`;

      if (status === "PAID") {
        stopPolling();
        localStorage.removeItem("cnc-cart");
        location.href = `obrigado.html?code=${encodeURIComponent(state.orderCode || "")}`;
      } else if (["EXPIRED", "FAILED", "CANCELED"].includes(status)) {
        stopPolling();
        statusEl.textContent = `Pagamento ${status}. Gere um novo Pix.`;
        document.getElementById("finishOrder").disabled = false;
      }
    } catch {
      statusEl.textContent = "Falha de rede ao consultar status...";
    }
  };

  tick();
  state.pollTimer = setInterval(tick, 3000); // a cada 3s
}

async function requireLogin() {
  try {
    const user = await Auth.getMe();
    if (!user) {
      location.href =
        "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() || "checkout.html");
      return null;
    }
    return user;
  } catch {
    alert("Inicie o servidor com: python server.py");
    return null;
  }
}

async function createPixCharge() {
  const btn = document.getElementById("finishOrder");
  btn.disabled = true;
  btn.textContent = "Gerando Pix...";

  const payload = {
    code: `CNC-${Date.now().toString().slice(-8)}`,
    items: state.items,
    subtotal: subtotal(),
    pix_discount: pixDiscount(),
    shipping: state.shipping,
    total: total(),
    profile: profilePayload(),
    // UTMs obrigatórios pra UTMify atribuir a venda
    utm: window.UTM ? UTM.getUtm() : {},
    customer: {
      name: customerName(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      cpf: document.getElementById("cpf").value.trim(),
    },
  };

  try {
    const { res, data } = await Auth.api("/api/checkout/pix", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = "Fazer pedido";
      alert(data.error || "Não foi possível gerar o Pix.");
      console.error("BravoPay error:", data);
      return;
    }

    state.transactionId = data.transaction_id;
    state.orderCode = data.code;
    const copy = data.pix?.copy_paste || "";

    document.getElementById("orderCode").textContent = data.code;
    document.getElementById("paidTotal").textContent = money(total());
    document.getElementById("pixCode").textContent = copy;
    document.getElementById("pixStatus").textContent = `Status: ${data.status || "PENDING"}`;

    setStep("pix");
    renderQr(copy);
    startPolling(data.transaction_id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Fazer pedido";
    alert("Servidor offline. Rode: python server.py");
    console.error(err);
  }
}

async function init() {
  // Captura UTMs da URL atual (se vieram do anúncio)
  if (window.UTM) UTM.captureFromUrl();

  const user = await requireLogin();
  if (!user) return;

  loadItems();
  fillFromUser(user);
  renderSummary();
  document.getElementById("addressBlock").classList.remove("hidden");

  const params = new URLSearchParams(location.search);
  if (params.get("step") === "payment") setStep("payment");

  document.getElementById("zipcode").addEventListener("input", (e) => {
    e.target.value = formatCep(e.target.value);
  });
  document.getElementById("cpf").addEventListener("input", (e) => {
    e.target.value = formatCpf(e.target.value);
  });
  document.getElementById("phone").addEventListener("input", (e) => {
    e.target.value = formatPhone(e.target.value);
  });

  document.querySelectorAll('input[name="shipping"]').forEach((el) => {
    el.addEventListener("change", () => {
      state.selectedShipping = Number(el.value);
      state.shippingLabel =
        el.dataset.label || el.closest(".ship-option").querySelector("strong").textContent;
      renderSummary();
    });
  });

  document.getElementById("couponToggle").addEventListener("click", () => {
    document.getElementById("couponRow").classList.toggle("hidden");
  });
  document.getElementById("couponToggleSide").addEventListener("click", () => {
    document.getElementById("couponRow").classList.remove("hidden");
    document.getElementById("couponInput").focus();
  });
  document.getElementById("couponApply").addEventListener("click", () =>
    applyCoupon("couponInput", "couponMsg")
  );
  document.getElementById("couponTogglePay").addEventListener("click", () => {
    document.getElementById("couponRowPay").classList.toggle("hidden");
  });
  document.getElementById("couponApplyPay").addEventListener("click", () =>
    applyCoupon("couponInputPay", "couponMsgPay")
  );

  document.getElementById("continueDelivery").addEventListener("click", () => {
    if (!validateDelivery()) return;
    setStep("payment");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.querySelectorAll(".review-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopPolling();
      setStep("delivery");
    });
  });

  document.getElementById("finishOrder").addEventListener("click", createPixCharge);

  document.getElementById("copyPixBtn").addEventListener("click", async () => {
    const text = document.getElementById("pixCode").textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      document.getElementById("copyPixBtn").textContent = "Copiado!";
      setTimeout(() => {
        document.getElementById("copyPixBtn").textContent = "Copiar código Pix";
      }, 1500);
    } catch {
      alert("Selecione e copie o código manualmente.");
    }
  });

  const summary = document.getElementById("summaryPanel");
  document.getElementById("summaryToggle").addEventListener("click", () => {
    const open = summary.classList.toggle("open");
    document.getElementById("summaryToggle").setAttribute("aria-expanded", String(open));
  });
}

init();
