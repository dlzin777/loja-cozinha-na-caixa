/**
 * Meta Pixel — carrega fbq e dispara eventos padrão.
 * ID vem de /api/config (META_PIXEL_ID no Render) ou window.__META_PIXEL_ID__.
 */
(function () {
  const state = { ready: false, id: "" };

  function loadFbq(pixelId) {
    if (!pixelId || window.fbq) {
      if (pixelId && window.fbq && !state.ready) {
        state.id = pixelId;
        state.ready = true;
      }
      return;
    }
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

    fbq("init", pixelId);
    fbq("track", "PageView");
    state.id = pixelId;
    state.ready = true;
  }

  async function init() {
    let id = (window.__META_PIXEL_ID__ || "").trim();
    if (!id) {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          id = (data.metaPixelId || "").trim();
        }
      } catch {
        // offline / static
      }
    }
    if (id) loadFbq(id);
  }

  function track(eventName, params, options) {
    if (!state.ready || typeof window.fbq !== "function") return;
    if (options) fbq("track", eventName, params || {}, options);
    else fbq("track", eventName, params || {});
  }

  function parseMoney(str) {
    if (typeof str === "number") return str;
    return Number(String(str || "0").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
  }

  window.MetaPixel = {
    init,
    track,
    pageView() {
      track("PageView");
    },
    viewContent(product) {
      track("ViewContent", {
        content_name: product?.name,
        content_ids: [product?.url || product?.id || product?.name].filter(Boolean),
        content_type: "product",
        value: parseMoney(product?.price),
        currency: "BRL",
      });
    },
    addToCart(product) {
      track("AddToCart", {
        content_name: product?.name,
        content_ids: [product?.url || product?.name].filter(Boolean),
        content_type: "product",
        value: parseMoney(product?.price),
        currency: "BRL",
      });
    },
    initiateCheckout(items, total) {
      const list = items || [];
      track("InitiateCheckout", {
        content_ids: list.map((i) => i.url || i.name).filter(Boolean),
        contents: list.map((i) => ({
          id: i.url || i.name,
          quantity: i.qty || 1,
          item_price: parseMoney(i.price),
        })),
        num_items: list.reduce((s, i) => s + (i.qty || 1), 0),
        value: typeof total === "number" ? total : list.reduce((s, i) => s + parseMoney(i.price) * (i.qty || 1), 0),
        currency: "BRL",
      });
    },
    purchase(orderCode, value, items) {
      const list = items || [];
      track("Purchase", {
        content_ids: list.map((i) => i.url || i.name).filter(Boolean),
        contents: list.map((i) => ({
          id: i.url || i.name,
          quantity: i.qty || 1,
          item_price: parseMoney(i.price),
        })),
        num_items: list.reduce((s, i) => s + (i.qty || 1), 0),
        value: typeof value === "number" ? value : 0,
        currency: "BRL",
      }, orderCode ? { eventID: String(orderCode) } : undefined);
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
