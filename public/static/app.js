/* MealMate frontend — all untrusted values are inserted with textContent. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "mealmate.saved.v1";
  const MAX_COMPARE = 3;

  const state = {
    saved: { meals: [], products: [] },
    compare: new Set(),
    retry: null,
    meta: null,
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function debounce(fn, wait = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function safeUrl(value, allowedHosts) {
    try {
      const url = new URL(String(value || ""), window.location.href);
      if (url.protocol !== "https:") return "";
      if (allowedHosts && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith("." + host))) return "";
      return url.href;
    } catch (_) {
      return "";
    }
  }

  async function api(path) {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw Object.assign(new Error("The server returned an unreadable response."), { retryable: true });
    }
    if (!response.ok) {
      const error = (payload && payload.error) || {};
      const exc = new Error(error.message || `Request failed (HTTP ${response.status}).`);
      exc.status = response.status;
      exc.code = error.code;
      exc.retryable = error.retryable !== false;
      throw exc;
    }
    return payload;
  }

  function showError(error, retry) {
    const box = $("alert");
    $("alertTitle").textContent = error.status ? `Request failed (HTTP ${error.status})` : "Something went wrong";
    $("alertMessage").textContent = `${error.message || "Unknown error."}${error.source ? ` Source: ${error.source}.` : ""}`;
    state.retry = typeof retry === "function" ? retry : null;
    $("retryBtn").hidden = !state.retry;
    box.hidden = false;
  }

  function hideError() {
    $("alert").hidden = true;
    state.retry = null;
  }

  // ---------- Saved items (localStorage only) ----------

  function loadSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      state.saved.meals = Array.isArray(parsed.meals) ? parsed.meals : [];
      state.saved.products = Array.isArray(parsed.products) ? parsed.products : [];
    } catch (_) {
      state.saved = { meals: [], products: [] };
    }
    persistSaved();
  }

  function persistSaved() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.saved));
    } catch (_) {
      // Private browsing / full storage: the app still works for this session.
    }
    $("savedCount").textContent = String(state.saved.meals.length + state.saved.products.length);
  }

  function keyOf(type, item) {
    return `${type}:${type === "meals" ? item.id : item.code}`;
  }

  function findSaved(type, item) {
    return state.saved[type].find((entry) => keyOf(type, entry) === keyOf(type, item));
  }

  function toggleSaved(type, item) {
    const key = keyOf(type, item);
    const index = state.saved[type].findIndex((entry) => keyOf(type, entry) === key);
    if (index >= 0) {
      state.saved[type].splice(index, 1);
      state.compare.delete(key);
    } else {
      state.saved[type].push(item);
    }
    persistSaved();
    refreshVisibleCards();
    if (!$("panel-saved").hidden) renderSaved();
  }

  // ---------- Card builders ----------

  function starButton(type, item) {
    const button = el("button", "star", findSaved(type, item) ? "★" : "☆");
    button.type = "button";
    button.title = "Save to My list";
    button.setAttribute("aria-label", "Save to My list");
    button.dataset.type = type;
    button.dataset.key = keyOf(type, item);
    button.addEventListener("click", () => toggleSaved(type, item));
    return button;
  }

  function compareCheckbox(type, item) {
    const label = el("label", "compare-check");
    const input = el("input");
    input.type = "checkbox";
    input.checked = state.compare.has(keyOf(type, item));
    input.dataset.type = type;
    input.dataset.key = keyOf(type, item);
    input.addEventListener("change", () => {
      const key = keyOf(type, item);
      if (input.checked) state.compare.add(key);
      else state.compare.delete(key);
    });
    label.append(input, document.createTextNode(" Compare"));
    return label;
  }

  function meter(labelText, value, maximum, warning) {
    const wrap = el("div");
    const row = el("div", "meter-label");
    row.append(el("span", "", labelText), el("strong", "", `${Math.round(value)}`));
    const track = el("div", "meter");
    const fill = el("span", warning ? "meter-fill warn" : "meter-fill");
    fill.style.width = `${Math.min(100, Math.max(0, (value / maximum) * 100))}%`;
    track.append(fill);
    wrap.append(row, track);
    return wrap;
  }

  function mealCard(meal, savedView) {
    const card = el("article", "card");
    const media = el("div", "card-media");
    const image = safeUrl(meal.image, ["www.themealdb.com"]);
    if (image) {
      const img = el("img");
      img.src = image;
      img.alt = `Photo of ${meal.name}`;
      img.loading = "lazy";
      media.append(img);
    } else {
      media.classList.add("placeholder");
      media.textContent = "🍲";
    }

    const body = el("div", "card-body");
    const badges = el("div", "badges");
    badges.append(el("span", "badge", meal.area), el("span", "badge", meal.category));
    if (meal.protein_score > 0) badges.append(el("span", "badge protein", `Protein cue ${meal.protein_score}`));

    body.append(
      badges,
      el("h3", "card-title", meal.name),
      el("p", "card-meta", meal.protein_cues && meal.protein_cues.length ? `Cues: ${meal.protein_cues.join(", ")}` : "No protein cues detected"),
      meter("Protein cue score / 100", meal.protein_score || 0, 100, false)
    );

    const actions = el("div", "card-actions");
    if (savedView) {
      const remove = el("button", "btn small ghost", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => toggleSaved("meals", meal));
      actions.append(remove);
    } else {
      const details = el("button", "btn small", "View recipe");
      details.type = "button";
      details.addEventListener("click", () => openMeal(meal.id));
      actions.append(details);
    }
    const star = starButton("meals", meal);
    actions.append(star);
    if (savedView) actions.append(compareCheckbox("meals", meal));
    body.append(actions);
    card.append(media, body);
    return card;
  }

  function productCard(product, savedView) {
    const card = el("article", "card");
    const media = el("div", "card-media");
    const image = safeUrl(product.image, ["images.openfoodfacts.org"]);
    if (image) {
      const img = el("img");
      img.src = image;
      img.alt = `Photo of ${product.name}`;
      img.loading = "lazy";
      media.append(img);
    } else {
      media.classList.add("placeholder");
      media.textContent = "🏷️";
    }

    const body = el("div", "card-body");
    const badges = el("div", "badges");
    const grade = el("span", `grade grade-${product.grade || "none"}`, (product.grade || "?").toUpperCase());
    badges.append(grade);
    if (product.brand) badges.append(el("span", "badge brand", product.brand));
    if (product.nova) badges.append(el("span", "badge", `NOVA ${product.nova}`));

    const macros = el("div", "macros");
    [["Protein", product.protein, "g"], ["Sugar", product.sugar, "g"], ["Energy", product.calories, "kcal"]].forEach(([label, value, unit]) => {
      const cell = el("div", "macro");
      cell.append(el("span", "", label), el("strong", "", value === null || value === undefined ? "–" : `${value}${unit}`));
      macros.append(cell);
    });

    body.append(
      badges,
      el("h3", "card-title", product.name),
      el("p", "card-meta", "Values per 100 g"),
      macros,
      meter("Protein (g / 100 g)", product.protein || 0, 30, false)
    );

    const actions = el("div", "card-actions");
    if (savedView) {
      const remove = el("button", "btn small ghost", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => toggleSaved("products", product));
      actions.append(remove);
    } else {
      const detail = el("button", "btn small ghost", "Open OFF");
      detail.type = "button";
      detail.addEventListener("click", () => {
        const url = product.code ? safeUrl(`https://world.openfoodfacts.org/product/${product.code}`, ["world.openfoodfacts.org"]) : "";
        if (url) window.open(url, "_blank", "noopener");
      });
      actions.append(detail);
    }
    actions.append(starButton("products", product));
    if (savedView) actions.append(compareCheckbox("products", product));
    body.append(actions);
    card.append(media, body);
    return card;
  }

  function fillGrid(target, items, builder, emptyTarget) {
    target.replaceChildren();
    items.forEach((item) => target.append(builder(item)));
    emptyTarget.hidden = items.length > 0;
  }

  function refreshVisibleCards() {
    if (!$("panel-recipes").hidden && state.lastRecipes) {
      fillGrid($("recipeGrid"), state.lastRecipes, (meal) => mealCard(meal, false), $("recipeEmpty"));
    }
    if (!$("panel-labels").hidden && state.lastProducts) {
      fillGrid($("productGrid"), state.lastProducts, (product) => productCard(product, false), $("productEmpty"));
    }
    if (!$("panel-saved").hidden) renderSaved();
  }

  // ---------- Data loading ----------

  function recipeParams() {
    const params = new URLSearchParams();
    const query = $("recipeQuery").value.trim();
    if (query) params.set("q", query);
    ["areaFilter:area", "categoryFilter:category", "ingredientFilter:ingredient"].forEach((pair) => {
      const [id, key] = pair.split(":");
      if ($(id).value) params.set(key, $(id).value);
    });
    params.set("sort", $("mealSort").value);
    if ($("proteinOnly").checked) params.set("protein_only", "1");
    return params;
  }

  async function loadRecipes() {
    const params = recipeParams();
    $("recipeLabel").textContent = "Loading meals…";
    try {
      const data = await api(`/api/meals?${params}`);
      state.lastRecipes = data.items;
      fillGrid($("recipeGrid"), data.items, (meal) => mealCard(meal, false), $("recipeEmpty"));
      $("recipeLabel").textContent = data.label;
      $("recipeCount").textContent = `${data.count} result${data.count === 1 ? "" : "s"}`;
      hideError();
    } catch (error) {
      $("recipeLabel").textContent = "Could not load meals";
      showError(error, loadRecipes);
    }
  }

  async function loadProducts() {
    const query = $("productQuery").value.trim();
    if (!query) {
      state.lastProducts = [];
      fillGrid($("productGrid"), [], (p) => productCard(p, false), $("productEmpty"));
      $("productLabel").textContent = "Search for a food to begin.";
      $("productCount").textContent = "0 results";
      return;
    }
    const params = new URLSearchParams({ q: query, sort: $("productSort").value });
    const minProtein = Number($("minProtein").value);
    const maxSugar = Number($("maxSugar").value);
    if (minProtein > 0) params.set("min_protein", String(minProtein));
    if ($("maxSugar").value && maxSugar >= 0) params.set("max_sugar", String(maxSugar));
    if ($("maxGrade").value) params.set("max_grade", $("maxGrade").value);
    if ($("maxNova").value) params.set("max_nova", $("maxNova").value);

    $("productLabel").textContent = "Checking labels…";
    try {
      const data = await api(`/api/products?${params}`);
      state.lastProducts = data.items;
      fillGrid($("productGrid"), data.items, (product) => productCard(product, false), $("productEmpty"));
      $("productLabel").textContent = data.label;
      $("productCount").textContent = `${data.count} result${data.count === 1 ? "" : "s"}`;
      hideError();
    } catch (error) {
      $("productLabel").textContent = "Could not load labels";
      showError(error, loadProducts);
    }
  }

  async function loadBarcode() {
    const code = $("barcodeInput").value.replace(/\D/g, "");
    if (!/^\d{8,18}$/.test(code)) {
      showError(Object.assign(new Error("Enter a barcode with 8 to 18 digits."), { retryable: false }));
      return;
    }
    $("productLabel").textContent = "Looking up barcode…";
    try {
      const data = await api(`/api/products/barcode/${encodeURIComponent(code)}`);
      state.lastProducts = data.items;
      fillGrid($("productGrid"), data.items, (product) => productCard(product, false), $("productEmpty"));
      $("productLabel").textContent = data.label;
      $("productCount").textContent = `${data.count} result`;
      hideError();
    } catch (error) {
      showError(error, loadBarcode);
    }
  }

  async function loadMeta() {
    try {
      const meta = await api("/api/meta");
      state.meta = meta;
      populateSelect("areaFilter", meta.areas || []);
      populateSelect("categoryFilter", meta.categories || []);
      populateSelect("ingredientFilter", meta.ingredients || []);
    } catch (error) {
      showError(error, loadMeta);
    }
  }

  function populateSelect(id, values) {
    const select = $(id);
    const first = select.firstElementChild;
    select.replaceChildren(first);
    values.forEach((value) => {
      const option = el("option", "", value);
      option.value = value;
      select.append(option);
    });
  }

  async function loadStatus() {
    const host = $("sourceStatus");
    host.replaceChildren();
    try {
      const result = await api("/api/status");
      Object.entries(result).forEach(([name, info]) => {
        const pill = el("span", `source-pill ${info.ok ? "ok" : "bad"}`);
        pill.append(el("span", "dot"), document.createTextNode(`${name}: ${info.ok ? "online" : "offline"}`));
        pill.title = info.ok ? "Reachable right now" : String(info.message || "Unavailable");
        host.append(pill);
      });
    } catch (_) {
      host.append(el("span", "source-pill bad", "Source status unavailable"));
    }
  }

  // ---------- Recipe detail dialog ----------

  async function openMeal(id) {
    const dialog = $("detailDialog");
    $("dialogTitle").textContent = "Loading recipe…";
    $("dialogBody").replaceChildren(el("p", "sub", "Fetching recipe details from TheMealDB…"));
    if (!dialog.open) dialog.showModal();
    try {
      const meal = await api(`/api/meals/${encodeURIComponent(id)}`);
      $("dialogKicker").textContent = `${meal.area} · ${meal.category}`;
      $("dialogTitle").textContent = meal.name;
      const body = $("dialogBody");
      body.replaceChildren();

      const image = safeUrl(meal.image, ["www.themealdb.com"]);
      if (image) {
        const img = el("img", "hero-image");
        img.src = image;
        img.alt = `Photo of ${meal.name}`;
        body.append(img);
      }
      body.append(meter("Protein cue score / 100", meal.protein_score || 0, 100, false));

      const ingredientsSection = el("div", "dialog-section");
      ingredientsSection.append(el("h3", "", "Ingredients — tick as you gather them"));
      const list = el("ul", "ingredient-list");
      (meal.ingredients || []).forEach((ingredient) => {
        const li = el("li", "ingredient-row");
        const check = el("input");
        check.type = "checkbox";
        check.addEventListener("change", () => li.classList.toggle("checked", check.checked));
        const label = el("span", "", ingredient.measure ? `${ingredient.measure} ${ingredient.name}` : ingredient.name);
        li.append(check, label);
        list.append(li);
      });
      ingredientsSection.append(list);
      body.append(ingredientsSection);

      const methodSection = el("div", "dialog-section");
      methodSection.append(el("h3", "", "Method"));
      methodSection.append(el("p", "instructions", meal.instructions || "No instructions were provided."));
      body.append(methodSection);

      const links = el("div", "source-links");
      const source = safeUrl(meal.source_url, ["www.themealdb.com"]);
      if (source) links.append(anchor(source, "View on TheMealDB"));
      const video = safeUrl(meal.youtube, ["www.youtube.com"]);
      if (video) links.append(anchor(video, "Watch the cooking video"));
      body.append(links);
    } catch (error) {
      $("dialogBody").replaceChildren(el("p", "sub", error.message || "Could not load this recipe."));
      showError(error, () => openMeal(id));
    }
  }

  function anchor(url, text) {
    const link = el("a", "", text);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  // ---------- My list + comparison ----------

  function renderSaved() {
    const all = [...state.saved.meals.map((item) => ({ type: "meals", item })), ...state.saved.products.map((item) => ({ type: "products", item }))];
    fillGrid($("savedGrid"), all, ({ type, item }) => (type === "meals" ? mealCard(item, true) : productCard(item, true)), $("savedEmpty"));
  }

  function renderCompare() {
    const area = $("compareArea");
    area.replaceChildren();
    const keys = [...state.compare].filter((key) => {
      const [type, id] = key.split(":");
      return (state.saved[type] || []).some((item) => String(type === "meals" ? item.id : item.code) === id);
    });
    if (!keys.length) {
      area.hidden = true;
      return;
    }
    area.hidden = false;
    area.append(el("h3", "", "Side-by-side comparison"));
    if (keys.length > MAX_COMPARE) {
      area.append(el("p", "sub", `You selected ${keys.length} items. Showing the first ${MAX_COMPARE}.`));
    }
    const grid = el("div", "compare-grid");
    keys.slice(0, MAX_COMPARE).forEach((key) => {
      const [type, id] = key.split(":");
      const item = state.saved[type].find((entry) => String(type === "meals" ? entry.id : entry.code) === id);
      const column = el("div", "compare-col");
      column.append(el("h4", "", item.name));
      const rows = type === "meals"
        ? [["Region", item.area], ["Category", item.category], ["Protein cue", `${item.protein_score || 0}/100`], ["Cues", (item.protein_cues || []).join(", ") || "—"]]
        : [["Brand", item.brand || "—"], ["Protein /100 g", item.protein === null || item.protein === undefined ? "—" : `${item.protein} g`], ["Sugar /100 g", item.sugar === null || item.sugar === undefined ? "—" : `${item.sugar} g`], ["Nutri-Score", (item.grade || "?").toUpperCase()], ["NOVA", item.nova || "—"]];
      rows.forEach(([label, value]) => {
        const row = el("div", "compare-row");
        row.append(el("span", "", label), el("strong", "", value));
        column.append(row);
      });
      grid.append(column);
    });
    area.append(grid);
  }

  // ---------- Wiring ----------

  function setTab(name) {
    ["recipes", "labels", "saved"].forEach((tab) => {
      const panel = $(`panel-${tab}`);
      const button = document.querySelector(`.tab[data-tab="${tab}"]`);
      const active = tab === name;
      panel.hidden = !active;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (name === "saved") renderSaved();
  }

  function wire() {
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.tab));
    });
    document.querySelectorAll("[data-jump]").forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.jump));
    });

    $("recipeForm").addEventListener("submit", (event) => { event.preventDefault(); loadRecipes(); });
    $("productForm").addEventListener("submit", (event) => { event.preventDefault(); loadProducts(); });
    $("barcodeForm").addEventListener("submit", (event) => { event.preventDefault(); loadBarcode(); });
    $("resetRecipes").addEventListener("click", () => {
      $("recipeQuery").value = "";
      ["areaFilter", "categoryFilter", "ingredientFilter"].forEach((id) => { $(id).value = ""; });
      $("mealSort").value = "relevance";
      $("proteinOnly").checked = false;
      loadRecipes();
    });

    ["areaFilter", "categoryFilter", "ingredientFilter", "mealSort", "proteinOnly"].forEach((id) => {
      $(id).addEventListener("change", debounce(loadRecipes, 150));
    });
    ["productSort", "minProtein", "maxSugar", "maxGrade", "maxNova"].forEach((id) => {
      $(id).addEventListener("change", debounce(loadProducts, 250));
    });

    $("retryBtn").addEventListener("click", () => { if (state.retry) state.retry(); });
    $("dismissAlert").addEventListener("click", hideError);
    $("closeDialog").addEventListener("click", () => $("detailDialog").close());
    $("compareBtn").addEventListener("click", renderCompare);
    $("clearSaved").addEventListener("click", () => {
      state.saved = { meals: [], products: [] };
      state.compare.clear();
      persistSaved();
      renderSaved();
      $("compareArea").hidden = true;
      refreshVisibleCards();
    });
    $("detailDialog").addEventListener("click", (event) => {
      if (event.target === $("detailDialog")) $("detailDialog").close();
    });
  }

  loadSaved();
  wire();
  loadMeta().finally(loadRecipes);
  loadStatus();
})();
