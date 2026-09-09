(function () {
  'use strict';

  var root = document.getElementById('app-root');
  if (!root) return;

  var supabase = window.supabase.createClient(window.LMS_SUPABASE_URL, window.LMS_SUPABASE_ANON_KEY);

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Number(n).toFixed(2); }
  function uniqueSorted(arr) {
    var seen = [];
    arr.forEach(function (v) { if (v && seen.indexOf(v) === -1) seen.push(v); });
    seen.sort();
    return seen;
  }
  function confirmThenDelete(btn, action) {
    if (btn.dataset.confirm === '0') {
      btn.dataset.confirm = '1'; btn.textContent = 'Confirm Delete'; btn.classList.add('confirming');
      setTimeout(function () { if (btn.dataset.confirm === '1') { btn.dataset.confirm = '0'; btn.textContent = 'Delete'; btn.classList.remove('confirming'); } }, 3000);
    } else {
      action().catch(function (e) { alert(e.message); });
    }
  }
  function throwIfError(result) {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  // ==============================================================
  // Shell
  // ==============================================================
  function shell(bodyHtml, opts) {
    opts = opts || {};
    root.innerHTML =
      '<div class="app">' +
        '<div class="topbar">' +
          '<div class="brand">' +
            '<div class="brand-mark">LMS</div>' +
            '<div><div class="brand-text">LMS Spare Parts</div><div class="brand-sub">' + (opts.subtitle || '') + '</div></div>' +
          '</div>' +
          '<div class="topbar-actions">' + (opts.topbarActions || '') + '</div>' +
        '</div>' +
        bodyHtml +
      '</div>';
  }

  // ==============================================================
  // PUBLIC CATALOG
  // ==============================================================
  var PRODUCTS = [];
  var cart = {};

  function renderCatalog() {
    shell(
      '<div class="catalog-layout">' +
        '<div class="main">' +
          '<h1 class="page-title">Browse &amp; select spare parts</h1>' +
          '<p class="page-desc">Tick the parts you need and set quantities — your selection is shown on the right as you go. Prices are <b>excl. shipping &amp; tariffs</b>.</p>' +
          '<div class="filters">' +
            '<select id="filterCategory"><option value="all">All Categories</option></select>' +
            '<select id="filterModel"><option value="all">All Machine Models</option></select>' +
            '<input type="text" id="filterSearch" placeholder="Search by name or SKU&hellip;">' +
          '</div>' +
          '<div class="grid" id="productGrid"><div class="empty-state">Loading&hellip;</div></div>' +
        '</div>' +
        selectionPanelHtml() +
      '</div>' +
      '<p class="footnote">LMS Machinery &middot; Contact: Wilson Mai (wilson@lmsmachinery.com) &middot; <button class="ghost-link-btn" id="toAdminLogin" style="margin-left:6px;">Admin</button></p>',
      { subtitle: 'Public catalog &middot; no login required' }
    );

    document.getElementById('toAdminLogin').addEventListener('click', renderAdminLogin);
    document.getElementById('filterCategory').addEventListener('change', renderGrid);
    document.getElementById('filterModel').addEventListener('change', renderGrid);
    document.getElementById('filterSearch').addEventListener('input', renderGrid);
    document.getElementById('generatePdfBtn').addEventListener('click', generateInvoicePdf);
    renderSelectionPanel();

    supabase.from('products').select('id, sku, name, category, machine_model, price, image_url, description')
      .order('name', { ascending: true })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        PRODUCTS = res.data;
        populateFilters();
        renderGrid();
      })
      .catch(function (e) {
        document.getElementById('productGrid').innerHTML = '<div class="empty-state">Could not load catalog: ' + esc(e.message) + '</div>';
      });
  }

  function populateFilters() {
    var cats = uniqueSorted(PRODUCTS.map(function (p) { return p.category; }));
    var models = uniqueSorted(PRODUCTS.map(function (p) { return p.machine_model; }));
    document.getElementById('filterCategory').innerHTML = '<option value="all">All Categories</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    document.getElementById('filterModel').innerHTML = '<option value="all">All Machine Models</option>' + models.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('');
  }

  function filteredProducts() {
    var cat = document.getElementById('filterCategory').value;
    var model = document.getElementById('filterModel').value;
    var q = document.getElementById('filterSearch').value.trim().toLowerCase();
    return PRODUCTS.filter(function (p) {
      if (cat !== 'all' && p.category !== cat) return false;
      if (model !== 'all' && p.machine_model !== model) return false;
      if (q && p.name.toLowerCase().indexOf(q) === -1 && p.sku.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function renderGrid() {
    var list = filteredProducts();
    var grid = document.getElementById('productGrid');
    if (list.length === 0) { grid.innerHTML = '<div class="empty-state">No parts match your filters.</div>'; return; }

    grid.innerHTML = list.map(function (p) {
      var imgHtml = p.image_url ? '<img src="' + esc(p.image_url) + '" alt="" onerror="this.parentElement.textContent=\'No image\';">' : 'No image';
      var qty = cart[p.id] || 1;
      var isAdded = !!cart[p.id];
      return (
        '<div class="card"><div class="card-img">' + imgHtml + '</div><div class="card-body">' +
          '<div class="card-tags"><span class="tag">' + esc(p.category || '-') + '</span><span class="tag">' + esc(p.machine_model || '-') + '</span></div>' +
          '<div class="card-name">' + esc(p.name) + '</div>' +
          '<div class="card-sku">SKU: ' + esc(p.sku) + '</div>' +
          '<div class="card-price">' + money(p.price) + '</div>' +
          '<div class="card-foot">' +
            '<input type="number" min="1" class="qty-input" data-qty-for="' + p.id + '" value="' + qty + '">' +
            '<button class="add-btn' + (isAdded ? ' added' : '') + '" data-add="' + p.id + '">' + (isAdded ? 'Added \u2713' : 'Add') + '</button>' +
          '</div>' +
        '</div></div>'
      );
    }).join('');

    grid.querySelectorAll('[data-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.dataset.add, 10);
        var qtyInput = grid.querySelector('[data-qty-for="' + id + '"]');
        cart[id] = Math.max(1, parseInt(qtyInput.value || '1', 10));
        renderGrid();
        renderSelectionPanel();
      });
    });
  }

  function productById(id) { return PRODUCTS.filter(function (p) { return p.id === parseInt(id, 10); })[0]; }

  function selectionPanelHtml() {
    return (
      '<aside class="selection-panel">' +
        '<h2 class="selection-title">Your Selection</h2>' +
        '<div id="cartLines"></div>' +
        '<div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--steel-800);">' +
          '<div class="cart-total-row"><span>Estimated Subtotal</span><span id="cartTotal">$0.00</span></div>' +
          '<div class="cart-note">Excl. shipping &amp; tariffs, confirmed by LMS after receiving your list.</div>' +
        '</div>' +
        '<div class="field"><label>Company Name</label><input type="text" id="custCompany"></div>' +
        '<div class="field"><label>Mailing Address</label><textarea id="custAddress" rows="2"></textarea></div>' +
        '<button class="generate-btn" id="generatePdfBtn">Download Selection PDF</button>' +
      '</aside>'
    );
  }

  function renderSelectionPanel() {
    var ids = Object.keys(cart).filter(function (id) { return cart[id] > 0; });
    var linesEl = document.getElementById('cartLines');
    if (ids.length === 0) {
      linesEl.innerHTML = '<div class="empty-state" style="padding:24px 0;">No parts selected yet — add some from the catalog.</div>';
      document.getElementById('cartTotal').textContent = money(0);
      document.getElementById('generatePdfBtn').disabled = true;
      return;
    }
    document.getElementById('generatePdfBtn').disabled = false;
    var total = 0;
    linesEl.innerHTML = ids.map(function (id) {
      var p = productById(id);
      if (!p) return '';
      var qty = cart[id];
      total += qty * p.price;
      return (
        '<div class="cart-line"><div style="flex:1;">' +
          '<div class="cart-line-name">' + esc(p.name) + '</div><div class="cart-line-sku">SKU: ' + esc(p.sku) + '</div>' +
          '<div class="cart-line-price">' + money(p.price) + ' each</div></div>' +
          '<input type="number" min="1" class="cart-line-qty" data-cart-qty="' + p.id + '" value="' + qty + '">' +
          '<button class="cart-line-remove" data-cart-remove="' + p.id + '">Remove</button></div>'
      );
    }).join('');
    document.getElementById('cartTotal').textContent = money(total);

    linesEl.querySelectorAll('[data-cart-qty]').forEach(function (input) {
      input.addEventListener('change', function () {
        cart[input.dataset.cartQty] = Math.max(1, parseInt(input.value || '1', 10));
        renderSelectionPanel();
      });
    });
    linesEl.querySelectorAll('[data-cart-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        delete cart[btn.dataset.cartRemove];
        renderSelectionPanel(); renderGrid();
      });
    });
  }

  function generateInvoicePdf() {
    var ids = Object.keys(cart).filter(function (id) { return cart[id] > 0; });
    if (ids.length === 0) return;
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { alert('PDF library failed to load. Please reload the page and try again.'); return; }

    supabase.rpc('next_invoice_number').then(function (res) {
      var invoiceNumber = (!res.error && res.data) ? res.data : ('DRAFT-' + Date.now());
      buildPdf(ids, invoiceNumber, jsPDFCtor);
    });
  }

  function buildPdf(ids, invoiceNumber, jsPDFCtor) {
    var doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var margin = 42;
    var y = margin;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('LMS Spare Parts — Selection List', margin, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110,110,110);
    doc.text('Reference: ' + invoiceNumber + '   Generated ' + new Date().toLocaleString(), margin, y); y += 22;

    doc.setTextColor(20,20,20); doc.setFont('helvetica','bold'); doc.setFontSize(10.5);
    doc.text('Customer', margin, y); y += 14;
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
    var company = document.getElementById('custCompany').value.trim() || '-';
    var address = document.getElementById('custAddress').value.trim();
    doc.text('Company: ' + company, margin, y); y += 13;
    if (address) {
      doc.text('Mailing Address:', margin, y); y += 13;
      var addrLines = doc.splitTextToSize(address, pageWidth - margin*2);
      doc.text(addrLines, margin, y); y += addrLines.length * 12;
    }
    y += 14;

    var colX = { sku: margin, name: margin+90, qty: pageWidth-margin-150, price: pageWidth-margin-100, total: pageWidth-margin-40 };
    doc.setDrawColor(210,210,210); doc.line(margin, y, pageWidth-margin, y); y += 14;
    doc.setFont('helvetica','bold'); doc.setFontSize(9);
    doc.text('SKU', colX.sku, y); doc.text('Item', colX.name, y); doc.text('Qty', colX.qty, y); doc.text('Unit', colX.price, y); doc.text('Total', colX.total, y);
    y += 8; doc.line(margin, y, pageWidth-margin, y); y += 14;

    doc.setFont('helvetica','normal');
    var grandTotal = 0;
    ids.forEach(function (id) {
      var p = productById(id); if (!p) return;
      var qty = cart[id]; var lineTotal = qty * p.price; grandTotal += lineTotal;
      if (y > 760) { doc.addPage(); y = margin; }
      var nameLines = doc.splitTextToSize(p.name, colX.qty - colX.name - 10);
      doc.text(p.sku, colX.sku, y); doc.text(nameLines, colX.name, y);
      doc.text(String(qty), colX.qty, y); doc.text(money(p.price), colX.price, y); doc.text(money(lineTotal), colX.total, y);
      y += Math.max(14, nameLines.length * 12);
    });

    y += 6; doc.line(margin, y, pageWidth-margin, y); y += 18;
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text('Estimated Subtotal: ' + money(grandTotal), colX.total - 130, y); y += 16;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(120,120,120);
    var disclaimer = 'Prices shown are estimates, excl. shipping & tariffs. Shipping is added by LMS after this list is received. Tariffs are the buyer\'s responsibility. Final pricing confirmed by LMS before order confirmation.';
    var discLines = doc.splitTextToSize(disclaimer, pageWidth - margin*2);
    doc.text(discLines, margin, y); y += discLines.length * 11 + 14;

    doc.setTextColor(20,20,20); doc.setFontSize(9);
    doc.text('Please send this PDF to your LMS contact: Wilson Mai (wilson@lmsmachinery.com)', margin, y);

    var filenameBase = (company !== '-' ? company : 'LMS-Selection').replace(/[^a-z0-9]+/gi, '-');
    doc.save(filenameBase + '-' + invoiceNumber + '.pdf');
  }

  // ==============================================================
  // ADMIN LOGIN (real Supabase Auth)
  // ==============================================================
  function renderAdminLogin() {
    shell(
      '<div class="login-view"><div class="login-card">' +
        '<h1 class="login-title">Admin Login</h1>' +
        '<p class="login-desc">Manage products, categories, machine models, and invoice numbering.</p>' +
        '<div class="login-error" id="loginErr">Incorrect email or password.</div>' +
        '<div class="field"><label>Email</label><input type="text" id="loginEmail" autocomplete="off"></div>' +
        '<div class="field"><label>Password</label><input type="password" id="loginPw" autocomplete="off"></div>' +
        '<button class="login-btn" id="loginBtn">Log In</button>' +
        '<button class="back-link" id="backToCatalog">&larr; Back to Catalog</button>' +
      '</div></div>',
      { subtitle: 'Admin' }
    );
    document.getElementById('backToCatalog').addEventListener('click', renderCatalog);
    function doLogin() {
      var email = document.getElementById('loginEmail').value.trim();
      var pw = document.getElementById('loginPw').value;
      var errEl = document.getElementById('loginErr');
      errEl.classList.remove('show');
      supabase.auth.signInWithPassword({ email: email, password: pw }).then(function (res) {
        if (res.error) { errEl.textContent = res.error.message; errEl.classList.add('show'); return; }
        renderAdminPanel();
      });
    }
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('loginPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  // ==============================================================
  // ADMIN PANEL
  // ==============================================================
  var adminData = { products: [], categories: [], models: [], invoice: { prefix: 'INV-', next_number: 1001 } };

  function renderAdminPanel() {
    shell(
      '<div class="main">' +
        '<h1 class="page-title">Catalog Admin</h1>' +
        '<p class="page-desc">Manage products, categories, machine models, and invoice numbering.</p>' +
        '<div class="tab-row">' +
          '<button class="tab-btn active" data-tab="products">Products</button>' +
          '<button class="tab-btn" data-tab="categories">Categories</button>' +
          '<button class="tab-btn" data-tab="models">Machine Models</button>' +
          '<button class="tab-btn" data-tab="invoice">Invoice Numbering</button>' +
        '</div>' +

        '<div class="tab-panel active" id="tabProducts">' +
          '<div class="panel-toolbar"><span class="hint"><span id="prodCount">0</span> products</span><button class="primary-btn" id="addProdBtn">+ New Product</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Name</th><th>Category / Model</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody id="prodBody"></tbody></table></div>' +
        '</div>' +

        '<div class="tab-panel" id="tabCategories">' +
          '<div class="panel-toolbar"><span class="hint"><span id="catCount">0</span> categories</span><button class="primary-btn" id="addCatBtn">+ New Category</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Products Using It</th><th></th></tr></thead><tbody id="catBody"></tbody></table></div>' +
        '</div>' +

        '<div class="tab-panel" id="tabModels">' +
          '<div class="panel-toolbar"><span class="hint"><span id="modelCount">0</span> machine models</span><button class="primary-btn" id="addModelBtn">+ New Model</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Products Using It</th><th></th></tr></thead><tbody id="modelBody"></tbody></table></div>' +
        '</div>' +

        '<div class="tab-panel" id="tabInvoice">' +
          '<div class="table-wrap" style="padding:22px; max-width:420px;">' +
            '<div class="field"><label>Invoice Number Prefix</label><input type="text" id="invPrefix"></div>' +
            '<div class="field"><label>Next Number</label><input type="number" id="invNext"></div>' +
            '<div class="field-note">The next customer PDF download will be numbered <span id="invPreview"></span>. Only change "Next Number" to realign numbering — it doesn\'t affect PDFs already sent.</div>' +
            '<button class="primary-btn" id="saveInvBtn" style="margin-top:10px;">Save</button>' +
          '</div>' +
        '</div>' +

        '<p class="footnote">Product images are entered as URLs only — this panel has no file-upload feature by design.</p>' +
      '</div>' +
      modalHtml(),
      { subtitle: 'Admin panel', topbarActions: '<button class="ghost-link-btn" id="logoutBtn">Log Out</button>' }
    );

    document.getElementById('logoutBtn').addEventListener('click', function () {
      supabase.auth.signOut().then(renderCatalog);
    });

    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var map = { products: 'tabProducts', categories: 'tabCategories', models: 'tabModels', invoice: 'tabInvoice' };
        document.getElementById(map[btn.dataset.tab]).classList.add('active');
      });
    });

    document.getElementById('addProdBtn').addEventListener('click', function () { openProductForm(null); });
    document.getElementById('addCatBtn').addEventListener('click', function () { openLookupForm('category', null); });
    document.getElementById('addModelBtn').addEventListener('click', function () { openLookupForm('model', null); });
    document.getElementById('saveInvBtn').addEventListener('click', saveInvoiceSettings);
    bindModalOverlay();

    loadAdminData();
  }

  function loadAdminData() {
    Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('machine_models').select('*').order('name'),
      supabase.rpc('get_invoice_settings')
    ]).then(function (res) {
      var productsRes = res[0], categoriesRes = res[1], modelsRes = res[2], invoiceRes = res[3];
      if (productsRes.error) throw new Error(productsRes.error.message);
      if (categoriesRes.error) throw new Error(categoriesRes.error.message);
      if (modelsRes.error) throw new Error(modelsRes.error.message);
      if (invoiceRes.error) throw new Error(invoiceRes.error.message);

      adminData.products = productsRes.data;
      adminData.categories = categoriesRes.data;
      adminData.models = modelsRes.data;
      adminData.invoice = (invoiceRes.data && invoiceRes.data[0]) ? invoiceRes.data[0] : { prefix: 'INV-', next_number: 1001 };

      renderProductsTable();
      renderCategoriesTable();
      renderModelsTable();
      renderInvoiceSettings();
    }).catch(function (e) {
      ['prodBody', 'catBody', 'modelBody'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = '<tr><td colspan="6" style="color:#c9583a; text-align:center; padding:26px;">Could not load data: ' + esc(e.message) + '</td></tr>';
      });
    });
  }

  // ---------------- Products ----------------
  function renderProductsTable() {
    document.getElementById('prodCount').textContent = adminData.products.length;
    document.getElementById('prodBody').innerHTML = adminData.products.map(function (p) {
      return '<tr><td class="owner-tag">' + esc(p.sku) + '</td><td>' + esc(p.name) + '</td>' +
        '<td class="owner-tag">' + esc(p.category || '-') + ' / ' + esc(p.machine_model || '-') + '</td>' +
        '<td class="owner-tag">' + money(p.price) + '</td>' +
        '<td>' + (p.active === false ? 'Hidden' : 'Visible') + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + p.id + '">Edit</button><button class="icon-btn danger" data-confirm="0" data-del="' + p.id + '">Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--steel-600); text-align:center; padding:26px;">No products yet</td></tr>';

    document.querySelectorAll('#prodBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openProductForm(parseInt(b.dataset.edit, 10)); }); });
    document.querySelectorAll('#prodBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        confirmThenDelete(b, function () { return supabase.from('products').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); });
      });
    });
  }

  function openProductForm(id) {
    var p = id ? adminData.products.filter(function (x) { return x.id === id; })[0] : null;
    var catOptions = adminData.categories.map(function (c) { return '<option value="' + esc(c.name) + '"' + (p && p.category === c.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    var modelOptions = adminData.models.map(function (m) { return '<option value="' + esc(m.name) + '"' + (p && p.machine_model === m.name ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('');
    var suggestedSku = p ? p.sku : generateSku();

    setModal(
      '<h2 class="modal-title">' + (p ? 'Edit Product' : 'New Product') + '</h2>' +
      '<div class="modal-grid">' +
        '<div class="field full"><label>SKU</label>' +
          '<div style="display:flex; gap:8px;">' +
            '<input id="mp_sku" value="' + esc(suggestedSku) + '"' + (p ? ' disabled' : '') + ' style="flex:1;">' +
            (p ? '' : '<button type="button" class="ghost-btn" id="mp_sku_regen" style="white-space:nowrap;">Regenerate</button>') +
          '</div>' +
          (p ? '' : '<div class="field-note">Auto-generated — you can overwrite it, or click Regenerate for a new one.</div>') +
        '</div>' +
        '<div class="field full"><label>Name</label><input id="mp_name" value="' + esc(p ? p.name : '') + '"></div>' +
        '<div class="field"><label>Category</label><select id="mp_cat"><option value="">-</option>' + catOptions + '</select></div>' +
        '<div class="field"><label>Machine Model</label><select id="mp_model"><option value="">-</option>' + modelOptions + '</select></div>' +
        '<div class="field"><label>Price (USD)</label><input type="text" inputmode="decimal" id="mp_price" value="' + (p ? p.price : '0') + '"></div>' +
        '<div class="field"><label>Visible in catalog?</label><select id="mp_active"><option value="true"' + (!p || p.active !== false ? ' selected' : '') + '>Visible</option><option value="false"' + (p && p.active === false ? ' selected' : '') + '>Hidden</option></select></div>' +
        '<div class="field full"><label>Product Photo</label>' +
          '<div id="mp_image_preview" style="margin-bottom:8px;">' + (p && p.image_url ? '<img src="' + esc(p.image_url) + '" style="max-width:120px; max-height:90px; border-radius:6px; display:block;">' : '') + '</div>' +
          '<input type="file" id="mp_image_file" accept="image/png,image/jpeg,image/webp,image/gif" style="margin-bottom:8px;">' +
          '<div class="field-note">Uploads to Supabase Storage automatically. Or paste a link below instead:</div>' +
          '<input id="mp_image" value="' + esc(p ? p.image_url : '') + '" placeholder="https://.../photo.jpg" style="margin-top:6px;">' +
          '<div id="mp_image_status" class="field-note"></div>' +
        '</div>' +
        '<div class="field full"><label>Description (optional)</label><textarea id="mp_desc" rows="3">' + esc(p ? p.description : '') + '</textarea></div>' +
      '</div>' +
      '<div class="modal-actions"><button class="ghost-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (p ? 'Save Changes' : 'Create Product') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    if (!p) {
      document.getElementById('mp_sku_regen').addEventListener('click', function () {
        document.getElementById('mp_sku').value = generateSku();
      });
    }
    document.getElementById('mp_image_file').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      uploadProductImage(file);
    });
    document.getElementById('mSave').addEventListener('click', function () {
      var priceVal = parseFloat(document.getElementById('mp_price').value.replace(/[^0-9.]/g, '') || '0');
      var payload = {
        sku: document.getElementById('mp_sku').value.trim(),
        name: document.getElementById('mp_name').value.trim(),
        category: document.getElementById('mp_cat').value || null,
        machine_model: document.getElementById('mp_model').value || null,
        price: isNaN(priceVal) ? 0 : priceVal,
        image_url: document.getElementById('mp_image').value.trim() || null,
        description: document.getElementById('mp_desc').value.trim() || null,
        active: document.getElementById('mp_active').value === 'true'
      };
      if (!payload.sku || !payload.name) { alert('SKU and name are required.'); return; }
      var req = p
        ? supabase.from('products').update(payload).eq('id', p.id)
        : supabase.from('products').insert(payload);
      req.then(function (r) {
        if (r.error) { alert(r.error.message); return; }
        closeModal(); loadAdminData();
      });
    });
  }

  function generateSku() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
    var code = '';
    for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'SP-' + code;
  }

  function uploadProductImage(file) {
    var statusEl = document.getElementById('mp_image_status');
    statusEl.textContent = 'Uploading…';
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    var path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

    supabase.storage.from('product-images').upload(path, file, { upsert: false }).then(function (res) {
      if (res.error) {
        statusEl.textContent = 'Upload failed: ' + res.error.message;
        return;
      }
      var pub = supabase.storage.from('product-images').getPublicUrl(path);
      var url = pub.data.publicUrl;
      document.getElementById('mp_image').value = url;
      document.getElementById('mp_image_preview').innerHTML = '<img src="' + esc(url) + '" style="max-width:120px; max-height:90px; border-radius:6px; display:block;">';
      statusEl.textContent = 'Uploaded.';
    });
  }

  // ---------------- Categories & Models ----------------
  function renderCategoriesTable() {
    document.getElementById('catCount').textContent = adminData.categories.length;
    document.getElementById('catBody').innerHTML = adminData.categories.map(function (c) {
      var useCount = adminData.products.filter(function (p) { return p.category === c.name; }).length;
      return '<tr><td>' + esc(c.name) + '</td><td class="owner-tag">' + useCount + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + c.id + '">Edit</button>' +
        '<button class="icon-btn danger" data-confirm="0" data-del="' + c.id + '"' + (useCount > 0 ? ' disabled' : '') + '>Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="3" style="color:var(--steel-600); text-align:center; padding:26px;">No categories yet</td></tr>';

    document.querySelectorAll('#catBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openLookupForm('category', parseInt(b.dataset.edit, 10)); }); });
    document.querySelectorAll('#catBody [data-del]').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () { confirmThenDelete(b, function () { return supabase.from('categories').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); }); });
    });
  }

  function renderModelsTable() {
    document.getElementById('modelCount').textContent = adminData.models.length;
    document.getElementById('modelBody').innerHTML = adminData.models.map(function (m) {
      var useCount = adminData.products.filter(function (p) { return p.machine_model === m.name; }).length;
      return '<tr><td>' + esc(m.name) + '</td><td class="owner-tag">' + useCount + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + m.id + '">Edit</button>' +
        '<button class="icon-btn danger" data-confirm="0" data-del="' + m.id + '"' + (useCount > 0 ? ' disabled' : '') + '>Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="3" style="color:var(--steel-600); text-align:center; padding:26px;">No machine models yet</td></tr>';

    document.querySelectorAll('#modelBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openLookupForm('model', parseInt(b.dataset.edit, 10)); }); });
    document.querySelectorAll('#modelBody [data-del]').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () { confirmThenDelete(b, function () { return supabase.from('machine_models').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); }); });
    });
  }

  function openLookupForm(kind, id) {
    var list = kind === 'category' ? adminData.categories : adminData.models;
    var table = kind === 'category' ? 'categories' : 'machine_models';
    var label = kind === 'category' ? 'Category' : 'Machine Model';
    var item = id ? list.filter(function (x) { return x.id === id; })[0] : null;

    setModal(
      '<h2 class="modal-title">' + (item ? 'Edit ' + label : 'New ' + label) + '</h2>' +
      '<div class="modal-grid"><div class="field full"><label>' + label + ' Name</label><input id="ml_name" value="' + esc(item ? item.name : '') + '"></div></div>' +
      '<div class="modal-actions"><button class="ghost-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (item ? 'Save Changes' : 'Create') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var name = document.getElementById('ml_name').value.trim();
      if (!name) { alert('Please enter a name.'); return; }
      var req = item
        ? supabase.from(table).update({ name: name }).eq('id', item.id)
        : supabase.from(table).insert({ name: name });
      req.then(function (r) {
        if (r.error) { alert(r.error.message); return; }
        closeModal(); loadAdminData();
      });
    });
  }

  // ---------------- Invoice settings ----------------
  function renderInvoiceSettings() {
    document.getElementById('invPrefix').value = adminData.invoice.prefix;
    document.getElementById('invNext').value = adminData.invoice.next_number;
    document.getElementById('invPreview').textContent = adminData.invoice.prefix + adminData.invoice.next_number;
    document.getElementById('invPrefix').oninput = document.getElementById('invNext').oninput = function () {
      document.getElementById('invPreview').textContent =
        document.getElementById('invPrefix').value + (document.getElementById('invNext').value || '');
    };
  }
  function saveInvoiceSettings() {
    var newPrefix = document.getElementById('invPrefix').value.trim();
    var newNext = parseInt(document.getElementById('invNext').value || '1', 10);
    supabase.rpc('update_invoice_settings', { new_prefix: newPrefix, new_next: newNext }).then(function (r) {
      if (r.error) { alert(r.error.message); return; }
      adminData.invoice = { prefix: newPrefix, next_number: newNext };
      alert('Invoice settings saved.');
    });
  }

  // ---------------- Shared modal ----------------
  function modalHtml() { return '<div class="modal-overlay" id="modalOverlay"><div class="modal-card" id="modalCard"></div></div>'; }
  function setModal(html) { document.getElementById('modalCard').innerHTML = html; }
  function openModal() { document.getElementById('modalOverlay').classList.add('open'); }
  function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
  function bindModalOverlay() {
    var overlay = document.getElementById('modalOverlay');
    var card = document.getElementById('modalCard');
    // Only close when the click both starts and ends on the overlay itself —
    // never when it originates inside the card (fixes an issue where
    // interacting with certain inputs, e.g. number spinners, could
    // register as a click on the overlay and close the modal unexpectedly).
    card.addEventListener('click', function (e) { e.stopPropagation(); });
    card.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  }

  // ==============================================================
  // Boot — check for an existing Supabase Auth session first
  // ==============================================================
  try {
    supabase.auth.getSession().then(function (res) {
      if (res.data && res.data.session) {
        renderAdminPanel();
      } else {
        renderCatalog();
      }
    });
  } catch (err) {
    root.innerHTML = '<div class="boot-msg" style="color:#c9583a;">Something went wrong loading the catalog: ' + esc(err.message) + '. Please refresh the page.</div>';
  }
})();
