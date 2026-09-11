(function () {
  'use strict';

  var root = document.getElementById('app-root');
  if (!root) return;

  var supabase = window.supabase.createClient(window.LMS_SUPABASE_URL, window.LMS_SUPABASE_ANON_KEY, {
    auth: { storageKey: 'sb-quotation-auth' }
  });

  function adminEmail(id) { return id.toLowerCase() + '@sales.maitool.internal'; }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function confirmThenDelete(btn, action) {
    if (btn.dataset.confirm === '0') {
      btn.dataset.confirm = '1'; btn.textContent = 'Confirm'; btn.classList.add('confirming');
      setTimeout(function () { if (btn.dataset.confirm === '1') { btn.dataset.confirm = '0'; btn.textContent = 'Delete'; btn.classList.remove('confirming'); } }, 3000);
    } else {
      action().catch(function (e) { alert(e.message); });
    }
  }
  function getSlugFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get('q');
  }

  // ==============================================================
  // Shell
  // ==============================================================
  function shell(bodyHtml, opts) {
    opts = opts || {};
    var topbarRight = '<a class="ghost-link-btn" href="/">&larr; Home</a>';
    if (opts.userLabel) {
      topbarRight += '<span class="user-chip">' + esc(opts.userLabel) + '</span>';
    }
    if (opts.topbarActions) topbarRight += opts.topbarActions;
    root.innerHTML =
      '<div class="app">' +
        '<div class="hazard-bar"></div>' +
        '<div class="topbar">' +
          '<div class="brand">' +
            '<div class="brand-mark"><span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span><img src="/assets/logo-icon.png" alt="FrameMac"></div>' +
            '<div><div class="brand-text">FrameMac &amp; LMS Quotation</div><div class="brand-sub">' + (opts.subtitle || '') + '</div></div>' +
          '</div>' +
          '<div class="topbar-right">' + topbarRight + '</div>' +
        '</div>' +
        bodyHtml +
      '</div>';
  }

  // ==============================================================
  // CUSTOMER: unlock screen
  // ==============================================================
  var currentSlug = null;
  var currentPassword = null;
  var quoteData = null;
  var selections = {}; // { category_id: option_id } for open categories
  var addonSelections = {}; // { addon_id: true }

  function renderUnlockScreen(slug) {
    var hasSlug = !!slug;
    shell(
      '<div class="login-view"><div class="login-card">' +
        '<span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
        '<div class="login-eyebrow">' + (hasSlug ? 'Password Required' : 'Find Your Quotation') + '</div>' +
        '<h1 class="login-title">View Your Quotation</h1>' +
        '<p class="login-desc">' + (hasSlug
          ? 'This link was prepared specifically for you by FrameMac &amp; LMS. Enter the password we provided to view your configuration and pricing.'
          : 'Enter the quotation reference number and password provided by your FrameMac &amp; LMS contact.') + '</p>' +
        '<div class="login-error" id="unlockErr">Incorrect details. Please check and try again.</div>' +
        (hasSlug ? '' : '<div class="field"><label>Quotation Reference Number</label><input type="text" id="refInput" autocomplete="off" placeholder="e.g. cu300-x7f2a"></div>') +
        '<div class="field"><label>Password</label><input type="password" id="pwInput" autocomplete="off"></div>' +
        '<button class="login-btn" id="unlockBtn">View Quotation</button>' +
        '<p class="login-note">Don\'t have a password? Contact Wilson Mai &mdash; wilson@lmsmachinery.com</p>' +
        (hasSlug ? '' : '<button class="back-link" id="toAdminLogin">Staff: Admin Login &rarr;</button>') +
      '</div></div>',
      { subtitle: hasSlug ? 'Shared quote link' : 'Customer Access' }
    );

    if (!hasSlug) {
      document.getElementById('toAdminLogin').addEventListener('click', renderAdminLogin);
    }

    function doUnlock() {
      var refSlug = hasSlug ? slug : document.getElementById('refInput').value.trim();
      var pw = document.getElementById('pwInput').value;
      var errEl = document.getElementById('unlockErr');
      errEl.classList.remove('show');
      if (!hasSlug && !refSlug) { errEl.textContent = 'Please enter your quotation reference number.'; errEl.classList.add('show'); return; }
      if (!pw) { errEl.textContent = 'Please enter the password.'; errEl.classList.add('show'); return; }

      supabase.rpc('get_quote_details', { p_slug: refSlug, p_password: pw }).then(function (res) {
        if (res.error || !res.data) {
          errEl.textContent = 'Incorrect details. Please check and try again.';
          errEl.classList.add('show');
          return;
        }
        currentSlug = refSlug;
        currentPassword = pw;
        quoteData = res.data;
        selections = {};

        addonSelections = {};
        (quoteData.open_categories || []).forEach(function (cat) {
          if (cat.default_option_id) selections[cat.category_id] = cat.default_option_id;
        });
        renderQuoteView();
      });
    }
    document.getElementById('unlockBtn').addEventListener('click', doUnlock);
    document.getElementById('pwInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doUnlock(); });
  }

  // ==============================================================
  // CUSTOMER: quote view
  // ==============================================================
  function calcTotal() {
    var total = quoteData.machine.base_price;
    (quoteData.locked_selections || []).forEach(function (l) { total += Number(l.price_delta) || 0; });
    (quoteData.open_categories || []).forEach(function (cat) {
      var selId = selections[cat.category_id];
      var opt = (cat.options || []).filter(function (o) { return o.id === selId; })[0];
      if (opt) total += Number(opt.price_delta) || 0;
    });
    Object.keys(addonSelections).forEach(function (id) {
      if (!addonSelections[id]) return;
      var addon = (quoteData.addons || []).filter(function (a) { return a.id === parseInt(id, 10); })[0];
      if (addon) total += Number(addon.price) || 0;
    });
    return total;
  }

  function renderQuoteView() {
    var m = quoteData.machine;

    var lockedHtml = '';
    if (quoteData.locked_selections && quoteData.locked_selections.length) {
      lockedHtml = quoteData.locked_selections.map(function (l) {
        return '<div class="spec-row"><span>' + esc(l.category_name) + '</span><span>' + esc(l.option_name) + '</span></div>';
      }).join('');
    }

    var sectionsHtml = (m.sections || []).map(function (s) {
      return '<div class="spec-row" style="display:block; padding:12px 0;"><div style="font-weight:600; color:var(--ink-900); margin-bottom:4px;">' + esc(s.name) + '</div><div style="color:var(--ink-600); font-size:12.5px; line-height:1.6;">' + esc(s.description || '') + '</div></div>';
    }).join('');

    var termsRows = [];
    termsRows.push('<div class="spec-row"><span>Trade Terms</span><span>' + esc(quoteData.trade_terms || 'FOB') + '</span></div>');
    if (quoteData.payment_terms) termsRows.push('<div class="spec-row"><span>Payment Terms</span><span>' + esc(quoteData.payment_terms) + '</span></div>');
    if (quoteData.lead_time) termsRows.push('<div class="spec-row"><span>Lead Time</span><span>' + esc(quoteData.lead_time) + '</span></div>');

    var openCategoriesHtml = (quoteData.open_categories || []).map(function (cat) {
      var optionsHtml = (cat.options || []).map(function (o) {
        var isSelected = selections[cat.category_id] === o.id;
        var priceLabel = o.price_delta == 0 ? '<span class="option-price free">Included</span>' : '<span class="option-price">+' + money(o.price_delta) + '</span>';
        return '<div class="option' + (isSelected ? ' selected' : '') + '" data-cat="' + cat.category_id + '" data-opt="' + o.id + '">' +
          '<div class="option-radio"></div>' +
          '<div class="option-body"><div class="option-name">' + esc(o.name) + '</div><div class="option-specs">' + esc(o.specs || '') + '</div></div>' +
          priceLabel +
        '</div>';
      }).join('');
      return '<div class="card"><span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
        '<h3 class="card-heading">' + esc(cat.category_name) + ' <span class="open-badge">YOUR CHOICE</span></h3>' +
        '<p class="card-sub">Select the option that fits your requirements</p>' +
        '<div class="option-list">' + optionsHtml + '</div></div>';
    }).join('');

    var addonsHtml = '';
    if (quoteData.addons && quoteData.addons.length) {
      addonsHtml = '<div class="card"><span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
        '<h3 class="card-heading">Optional Add-ons</h3><p class="card-sub">Add these if you\'d like &mdash; entirely up to you</p>' +
        quoteData.addons.map(function (a) {
          var isSel = !!addonSelections[a.id];
          return '<div class="addon' + (isSel ? ' selected' : '') + '" data-addon="' + a.id + '">' +
            '<div class="addon-check"></div>' +
            '<div class="addon-body"><div class="addon-name">' + esc(a.name) + '</div><div class="addon-desc">' + esc(a.description || '') + '</div></div>' +
            '<div class="addon-price">+' + money(a.price) + '</div></div>';
        }).join('') +
        '</div>';
    }

    shell(
      '<div class="main">' +
        '<div class="quote-head">' +
          '<div class="quote-eyebrow">Your Quotation</div>' +
          '<h1 class="quote-title">' + esc(m.name) + '</h1>' +
          '<p class="quote-desc">Review your configuration below. Some sections are open for you to choose from &mdash; everything else has already been set for your requirements.</p>' +
        '</div>' +
        '<div class="layout">' +
          '<div>' +
            '<div class="card"><span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
              '<h3 class="card-heading">Base Machine <span class="lock-badge">FIXED</span></h3>' +
              (m.description ? '<p class="card-sub" style="color:var(--ink-600); line-height:1.6; margin-bottom:16px;">' + esc(m.description) + '</p>' : '<p class="card-sub">Confirmed for your order &mdash; not adjustable here</p>') +
              (sectionsHtml ? '<div style="border-top:1px solid #f2f3f5;">' + sectionsHtml + '</div>' : '') +
            '</div>' +
            (lockedHtml ? '<div class="card"><span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
              '<h3 class="card-heading">Confirmed Configuration <span class="lock-badge">FIXED</span></h3>' +
              '<p class="card-sub">Set for your requirements &mdash; not adjustable here</p>' +
              '<div class="spec-grid">' + lockedHtml + '</div></div>' : '') +
            openCategoriesHtml +
            addonsHtml +
            '<div class="card"><span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
              '<h3 class="card-heading">Terms</h3>' +
              '<div class="spec-grid">' + termsRows.join('') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="summary card" id="summaryCard"><span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
            '<h3 class="summary-title">Price Summary</h3>' +
            '<div id="summaryLines"></div>' +
            '<div class="summary-total"><span class="label">Total</span><span class="value" id="totalVal">$0</span></div>' +
            '<div class="shipping-notice">Excludes shipping &amp; tariffs. Quoted ' + esc(quoteData.trade_terms || 'FOB') + '.</div>' +
            '<button class="dl-btn" id="dlBtn">Download PDF Quote</button>' +
            '<p class="dl-note">For your records. This is a cost &amp; feature reference, subject to final confirmation.</p>' +
          '</div>' +
        '</div>' +
        '<p class="footnote">FRAMEMAC &amp; LMS MACHINERY &middot; WILSON MAI &mdash; WILSON@LMSMACHINERY.COM</p>' +
      '</div>',
      { subtitle: 'Your Quotation' }
    );

    document.querySelectorAll('.option').forEach(function (el) {
      el.addEventListener('click', function () {
        selections[el.dataset.cat] = parseInt(el.dataset.opt, 10);
        renderQuoteView();
      });
    });
    document.querySelectorAll('.addon').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.addon;
        addonSelections[id] = !addonSelections[id];
        renderQuoteView();
      });
    });
    document.getElementById('dlBtn').addEventListener('click', downloadQuotePdf);

    renderSummary();
  }

  function renderSummary() {
    var m = quoteData.machine;
    var lines = ['<div class="summary-line"><span>Base machine</span><b>' + money(m.base_price) + '</b></div>'];
    (quoteData.locked_selections || []).forEach(function (l) {
      if (Number(l.price_delta)) lines.push('<div class="summary-line"><span>' + esc(l.category_name) + '</span><b>+' + money(l.price_delta) + '</b></div>');
    });
    (quoteData.open_categories || []).forEach(function (cat) {
      var opt = (cat.options || []).filter(function (o) { return o.id === selections[cat.category_id]; })[0];
      if (opt) lines.push('<div class="summary-line"><span>' + esc(cat.category_name) + ': ' + esc(opt.name) + '</span><b>' + (opt.price_delta == 0 ? 'Incl.' : '+' + money(opt.price_delta)) + '</b></div>');
    });
    (quoteData.addons || []).forEach(function (a) {
      if (addonSelections[a.id]) lines.push('<div class="summary-line"><span>' + esc(a.name) + '</span><b>+' + money(a.price) + '</b></div>');
    });
    document.getElementById('summaryLines').innerHTML = lines.join('');
    document.getElementById('totalVal').textContent = money(calcTotal());
  }


  // ==============================================================
  // PDF generation (matches the original configurator's navy/orange branding)
  // ==============================================================
  function downloadQuotePdf() {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { alert('PDF library failed to load. Please reload the page and try again.'); return; }

    var doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
    var m = quoteData.machine;
    var quoteNo = 'Q-' + Date.now().toString().slice(-6);
    var quoteDate = new Date().toISOString().slice(0, 10);
    var navy = [22, 50, 79], orange = [214, 98, 10], soft = [90, 100, 110];
    var y;

    doc.setFillColor.apply(doc, navy); doc.rect(0, 0, 612, 90, 'F');
    doc.setFillColor.apply(doc, orange); doc.rect(0, 90, 612, 4, 'F');
    doc.setTextColor.apply(doc, orange); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text('FRAMEMAC & LMS', 40, 24);
    doc.setTextColor(255, 255, 255); doc.setFontSize(18);
    var titleLines = doc.splitTextToSize(m.name, 330);
    doc.text(titleLines, 40, 44);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('QUOTATION — FOR YOUR REFERENCE', 40, 44 + titleLines.length * 16 + 10);
    doc.text('Quote #: ' + quoteNo, 400, 30);
    doc.text('Date: ' + quoteDate, 400, 44);

    y = 118;
    doc.setTextColor.apply(doc, navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('BASE MACHINE', 40, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor.apply(doc, soft);
    if (m.description) {
      var descLines = doc.splitTextToSize(m.description, 532);
      doc.text(descLines, 40, y); y += 13 * descLines.length + 4;
    }
    (m.sections || []).forEach(function (s) {
      if (y > 700) { doc.addPage(); y = 60; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 38, 48);
      doc.text(s.name, 40, y); y += 12;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, soft);
      var secLines = doc.splitTextToSize(s.description || '', 522);
      doc.text(secLines, 48, y); y += 12 * secLines.length + 6;
    });
    y += 6;

    doc.setDrawColor(200, 206, 214); doc.line(40, y, 572, y); y += 20;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor.apply(doc, navy);
    doc.text('DESCRIPTION', 40, y); doc.text('AMOUNT', 500, y, { align: 'right' }); y += 8;
    doc.setDrawColor(230, 233, 238); doc.line(40, y, 572, y); y += 16;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 38, 48);
    var baseLines = doc.splitTextToSize(m.name + ' — base configuration', 400);
    doc.text(baseLines, 40, y); doc.text('USD ' + money(m.base_price), 500, y, { align: 'right' });
    y += 14 * baseLines.length + 10;

    function lineItem(label, sub, delta) {
      if (y > 680) { doc.addPage(); y = 60; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor.apply(doc, navy);
      doc.text(label, 40, y); y += 13;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 38, 48);
      var priceLabel = delta === 0 ? 'included' : 'USD ' + money(delta);
      doc.text(sub, 50, y); doc.text(priceLabel, 500, y, { align: 'right' }); y += 15;
    }

    (quoteData.locked_selections || []).forEach(function (l) {
      lineItem(l.category_name, l.option_name, Number(l.price_delta) || 0);
    });
    (quoteData.open_categories || []).forEach(function (cat) {
      var opt = (cat.options || []).filter(function (o) { return o.id === selections[cat.category_id]; })[0];
      if (opt) lineItem(cat.category_name, opt.name, Number(opt.price_delta) || 0);
    });
    (quoteData.addons || []).forEach(function (a) {
      if (addonSelections[a.id]) lineItem('Add-on', a.name, Number(a.price) || 0);
    });

    y += 10;
    if (y > 640) { doc.addPage(); y = 60; }
    doc.setDrawColor(200, 206, 214); doc.line(40, y, 572, y); y += 26;
    doc.setFillColor.apply(doc, navy); doc.rect(340, y - 20, 232, 34, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('TOTAL', 355, y);
    doc.setTextColor.apply(doc, orange); doc.setFontSize(15);
    doc.text('USD ' + money(calcTotal()), 560, y, { align: 'right' });

    y += 36;
    if (y > 680) { doc.addPage(); y = 60; }

    doc.setFillColor(253, 243, 224); doc.rect(40, y - 12, 532, 22, 'F');
    doc.setTextColor(180, 120, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Excludes shipping & tariffs. Quoted ' + (quoteData.trade_terms || 'FOB') + '.', 46, y + 3);
    y += 30;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor.apply(doc, navy);
    doc.text('Trade Terms: ', 40, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 38, 48);
    doc.text(quoteData.trade_terms || 'FOB', 100, y); y += 14;
    if (quoteData.payment_terms) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor.apply(doc, navy); doc.text('Payment Terms: ', 40, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 38, 48);
      var payLines = doc.splitTextToSize(quoteData.payment_terms, 420);
      doc.text(payLines, 118, y); y += 14 * payLines.length;
    }
    if (quoteData.lead_time) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor.apply(doc, navy); doc.text('Lead Time: ', 40, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 38, 48); doc.text(quoteData.lead_time, 100, y); y += 14;
    }
    y += 12;

    if (y > 700) { doc.addPage(); y = 60; }
    doc.setTextColor.apply(doc, soft); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    var closing = doc.splitTextToSize('This is a cost & feature reference only, in USD, subject to final confirmation by our sales team.', 532);
    doc.text(closing, 40, y);

    var filename = 'FrameMac_Quote_' + quoteNo.replace(/[^a-zA-Z0-9-]/g, '') + '.pdf';
    doc.save(filename);

    supabase.rpc('record_quote_download', { p_slug: currentSlug, p_password: currentPassword }).catch(function () {});
  }


  // ==============================================================
  // ADMIN: login
  // ==============================================================
  function renderAdminLogin() {
    shell(
      '<div class="login-view"><div class="login-card">' +
        '<span class="rivet tl"></span><span class="rivet tr"></span><span class="rivet bl"></span><span class="rivet br"></span>' +
        '<div class="login-eyebrow">Admin</div>' +
        '<h1 class="login-title">Quotation Admin</h1>' +
        '<p class="login-desc">Manage machines, options, add-ons, and customer quote links. Uses the same login as Order Tracking.</p>' +
        '<div class="login-error" id="adminErr">Incorrect login ID or password.</div>' +
        '<div class="field"><label>Login ID</label><input type="text" id="adminId" autocomplete="off"></div>' +
        '<div class="field"><label>Password</label><input type="password" id="adminPw" autocomplete="off"></div>' +
        '<button class="login-btn" id="adminLoginBtn">Log In</button>' +
      '</div></div>',
      { subtitle: 'Admin' }
    );
    function doLogin() {
      var id = document.getElementById('adminId').value.trim();
      var pw = document.getElementById('adminPw').value;
      var errEl = document.getElementById('adminErr');
      errEl.classList.remove('show');
      supabase.auth.signInWithPassword({ email: adminEmail(id), password: pw }).then(function (res) {
        if (res.error) { errEl.classList.add('show'); return; }
        renderAdminPanel();
      });
    }
    document.getElementById('adminLoginBtn').addEventListener('click', doLogin);
    document.getElementById('adminPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  // ==============================================================
  // ADMIN: panel
  // ==============================================================
  var adminData = { machines: [], categories: [], options: [], addons: [], quotes: [], downloadCounts: {} };

  function renderAdminPanel() {
    shell(
      '<div class="main">' +
        '<h1 class="page-title">Quotation Admin</h1>' +
        '<p class="page-desc">Manage machines, configuration options, add-ons, and customer quote links.</p>' +
        '<div class="tab-row">' +
          '<button class="tab-btn active" data-tab="quotes">Quotes</button>' +
          '<button class="tab-btn" data-tab="machines">Machines</button>' +
          '<button class="tab-btn" data-tab="options">Categories &amp; Options</button>' +
          '<button class="tab-btn" data-tab="addons">Add-ons</button>' +
        '</div>' +

        '<div class="tab-panel active" id="tabQuotes">' +
          '<div class="panel-toolbar"><span class="hint"><span id="quoteCount">0</span> quotes</span><button class="primary-btn" id="addQuoteBtn">+ New Quote</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Machine</th><th>Link</th><th>Downloads</th><th>Created</th><th></th></tr></thead><tbody id="quotesBody"></tbody></table></div>' +
        '</div>' +

        '<div class="tab-panel" id="tabMachines">' +
          '<div class="panel-toolbar"><span class="hint"><span id="machineCount">0</span> machines</span><button class="primary-btn" id="addMachineBtn">+ New Machine</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Base Price</th><th>Specs</th><th></th></tr></thead><tbody id="machinesBody"></tbody></table></div>' +
        '</div>' +

        '<div class="tab-panel" id="tabOptions">' +
          '<div class="panel-toolbar"><span class="hint">Shared across all quotes</span><button class="primary-btn" id="addCategoryBtn">+ New Category</button></div>' +
          '<div id="categoriesWrap"></div>' +
        '</div>' +

        '<div class="tab-panel" id="tabAddons">' +
          '<div class="panel-toolbar"><span class="hint"><span id="addonCount">0</span> add-ons</span><button class="primary-btn" id="addAddonBtn">+ New Add-on</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Price</th><th>Description</th><th></th></tr></thead><tbody id="addonsBody"></tbody></table></div>' +
        '</div>' +

        '<p class="footnote">Quote links have no login — the link plus the password is what grants access.</p>' +
      '</div>' + modalHtml(),
      { userLabel: 'Loading…', subtitle: 'Admin', topbarActions: '<button class="ghost-btn" id="logoutBtn" style="margin-left:10px;">Log Out</button>' }
    );

    document.getElementById('logoutBtn').addEventListener('click', function () { supabase.auth.signOut().then(function () { window.location.href = '/quotation/'; }); });

    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var map = { quotes: 'tabQuotes', machines: 'tabMachines', options: 'tabOptions', addons: 'tabAddons' };
        document.getElementById(map[btn.dataset.tab]).classList.add('active');
      });
    });

    document.getElementById('addMachineBtn').addEventListener('click', function () { openMachineForm(null); });
    document.getElementById('addCategoryBtn').addEventListener('click', function () { openCategoryForm(null); });
    document.getElementById('addAddonBtn').addEventListener('click', function () { openAddonForm(null); });
    document.getElementById('addQuoteBtn').addEventListener('click', function () { openQuoteForm(); });
    bindModalOverlay();

    supabase.auth.getUser().then(function (res) {
      var chip = document.querySelector('.user-chip');
      if (chip && res.data.user) chip.textContent = res.data.user.email.split('@')[0];
    });

    loadAdminData();
  }

  function loadAdminData() {
    Promise.all([
      supabase.from('quote_machines').select('*').order('name'),
      supabase.from('quote_categories').select('*').order('name'),
      supabase.from('quote_options').select('*').order('name'),
      supabase.from('quote_addons').select('*').order('name'),
      supabase.from('quotes').select('*').order('created_at', { ascending: false }),
      supabase.from('quote_downloads').select('quote_id')
    ]).then(function (res) {
      for (var i = 0; i < res.length; i++) { if (res[i].error) throw new Error(res[i].error.message); }
      adminData.machines = res[0].data;
      adminData.categories = res[1].data;
      adminData.options = res[2].data;
      adminData.addons = res[3].data;
      adminData.quotes = res[4].data;
      adminData.downloadCounts = {};
      res[5].data.forEach(function (d) { adminData.downloadCounts[d.quote_id] = (adminData.downloadCounts[d.quote_id] || 0) + 1; });

      renderMachinesTable();
      renderCategoriesBlocks();
      renderAddonsTable();
      renderQuotesTable();
    }).catch(function (e) {
      alert('Could not load admin data: ' + e.message);
    });
  }


  // ---------------- Machines ----------------
  function renderMachinesTable() {
    document.getElementById('machineCount').textContent = adminData.machines.length;
    document.getElementById('machinesBody').innerHTML = adminData.machines.map(function (m) {
      return '<tr><td style="color:#fff; font-weight:500;">' + esc(m.name) + '</td><td class="owner-tag">' + money(m.base_price) + '</td>' +
        '<td class="owner-tag">' + (m.sections || []).length + ' section(s)</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + m.id + '">Edit</button><button class="icon-btn danger" data-confirm="0" data-del="' + m.id + '">Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="4" style="color:var(--steel-500); text-align:center; padding:26px;">No machines yet</td></tr>';

    document.querySelectorAll('#machinesBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openMachineForm(parseInt(b.dataset.edit, 10)); }); });
    document.querySelectorAll('#machinesBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        confirmThenDelete(b, function () { return supabase.from('quote_machines').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); });
      });
    });
  }

  function openMachineForm(id) {
    var m = id ? adminData.machines.filter(function (x) { return x.id === id; })[0] : null;
    var sections = m ? (m.sections || []).slice() : [];

    function sectionsRowsHtml() {
      return sections.map(function (s, i) {
        return '<div style="border:1px solid var(--steel-700); border-radius:4px; padding:10px; margin-bottom:8px;">' +
          '<div style="display:flex; gap:8px; margin-bottom:6px;">' +
          '<input data-sec-name="' + i + '" value="' + esc(s.name) + '" placeholder="Section name (e.g. Uncoiler)" style="flex:1;">' +
          '<button type="button" class="ghost-modal-btn" data-sec-remove="' + i + '">&times;</button></div>' +
          '<textarea data-sec-desc="' + i + '" placeholder="Description / specs for this section" rows="2" style="width:100%; background:var(--steel-950); border:1.5px solid var(--steel-700); border-radius:4px; color:#fff; padding:8px 10px; font-family:var(--f-body); font-size:13px;">' + esc(s.description || '') + '</textarea>' +
        '</div>';
      }).join('');
    }

    setModal(
      '<h2 class="modal-title">' + (m ? 'Edit Machine' : 'New Machine') + '</h2>' +
      '<div class="field"><label>Machine Name</label><input id="mm_name" value="' + esc(m ? m.name : '') + '" placeholder="e.g. CU300 Roll Forming Machine"></div>' +
      '<div class="field"><label>Base Price (USD)</label><input id="mm_price" value="' + (m ? m.base_price : '0') + '" inputmode="decimal"></div>' +
      '<div class="field"><label>Description (shown to the customer as an overview)</label><textarea id="mm_desc" rows="3" placeholder="A high-precision roll forming line built for...">' + esc(m ? m.description : '') + '</textarea></div>' +
      '<div class="field"><label>Sub-assembly Sections (e.g. Uncoiler, Punching, Controller — shown as fixed reference)</label><div id="sectionsRows">' + sectionsRowsHtml() + '</div>' +
      '<button type="button" class="ghost-modal-btn" id="addSectionRow">+ Add section</button></div>' +
      '<div class="modal-actions"><button class="ghost-modal-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (m ? 'Save Changes' : 'Create Machine') + '</button></div>'
    );
    openModal();

    function bindSectionEvents() {
      document.querySelectorAll('[data-sec-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          sections.splice(parseInt(btn.dataset.secRemove, 10), 1);
          document.getElementById('sectionsRows').innerHTML = sectionsRowsHtml();
          bindSectionEvents();
        });
      });
    }
    bindSectionEvents();
    document.getElementById('addSectionRow').addEventListener('click', function () {
      sections.push({ name: '', description: '' });
      document.getElementById('sectionsRows').innerHTML = sectionsRowsHtml();
      bindSectionEvents();
    });
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      document.querySelectorAll('[data-sec-name]').forEach(function (inp) { sections[parseInt(inp.dataset.secName, 10)].name = inp.value.trim(); });
      document.querySelectorAll('[data-sec-desc]').forEach(function (ta) { sections[parseInt(ta.dataset.secDesc, 10)].description = ta.value.trim(); });
      var cleanSections = sections.filter(function (s) { return s.name; });

      var name = document.getElementById('mm_name').value.trim();
      var price = parseFloat(document.getElementById('mm_price').value.replace(/[^0-9.]/g, '') || '0');
      if (!name) { alert('Please enter a machine name.'); return; }
      var payload = { name: name, base_price: price, description: document.getElementById('mm_desc').value.trim(), sections: cleanSections };
      var req = m ? supabase.from('quote_machines').update(payload).eq('id', m.id) : supabase.from('quote_machines').insert(payload);
      req.then(function (r) { if (r.error) { alert(r.error.message); return; } closeModal(); loadAdminData(); });
    });
  }

  // ---------------- Categories & Options ----------------
  function renderCategoriesBlocks() {
    var wrap = document.getElementById('categoriesWrap');
    if (!adminData.categories.length) { wrap.innerHTML = '<div class="empty-state">No categories yet — add one to start building option groups (e.g. "Security System").</div>'; return; }

    wrap.innerHTML = adminData.categories.map(function (cat) {
      var opts = adminData.options.filter(function (o) { return o.category_id === cat.id; });
      var optRows = opts.map(function (o) {
        return '<tr><td style="color:#fff;">' + esc(o.name) + '</td><td class="owner-tag">' + (o.price_delta == 0 ? 'Included' : '+' + money(o.price_delta)) + '</td><td class="owner-tag">' + esc(o.specs || '-') + '</td>' +
          '<td><div class="row-actions"><button class="icon-btn" data-edit-opt="' + o.id + '" data-cat="' + cat.id + '">Edit</button><button class="icon-btn danger" data-confirm="0" data-del-opt="' + o.id + '">Delete</button></div></td></tr>';
      }).join('') || '<tr><td colspan="4" style="color:var(--steel-500); text-align:center; padding:14px;">No options yet</td></tr>';

      return '<div class="table-wrap" style="margin-bottom:16px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid var(--steel-700);">' +
          '<div><span style="color:#fff; font-weight:600; font-family:var(--f-display); text-transform:uppercase; font-size:13px;">' + esc(cat.name) + '</span></div>' +
          '<div class="row-actions"><button class="icon-btn" data-add-opt="' + cat.id + '">+ Option</button><button class="icon-btn" data-edit-cat="' + cat.id + '">Rename</button><button class="icon-btn danger" data-confirm="0" data-del-cat="' + cat.id + '"' + (opts.length ? ' disabled title="Remove options first"' : '') + '>Delete</button></div>' +
        '</div>' +
        '<table><thead><tr><th>Option</th><th>Price</th><th>Specs</th><th></th></tr></thead><tbody>' + optRows + '</tbody></table>' +
      '</div>';
    }).join('');

    wrap.querySelectorAll('[data-add-opt]').forEach(function (b) { b.addEventListener('click', function () { openOptionForm(null, parseInt(b.dataset.addOpt, 10)); }); });
    wrap.querySelectorAll('[data-edit-opt]').forEach(function (b) { b.addEventListener('click', function () { openOptionForm(parseInt(b.dataset.editOpt, 10), parseInt(b.dataset.cat, 10)); }); });
    wrap.querySelectorAll('[data-del-opt]').forEach(function (b) {
      b.addEventListener('click', function () { confirmThenDelete(b, function () { return supabase.from('quote_options').delete().eq('id', b.dataset.delOpt).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); }); });
    });
    wrap.querySelectorAll('[data-edit-cat]').forEach(function (b) { b.addEventListener('click', function () { openCategoryForm(parseInt(b.dataset.editCat, 10)); }); });
    wrap.querySelectorAll('[data-del-cat]').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () { confirmThenDelete(b, function () { return supabase.from('quote_categories').delete().eq('id', b.dataset.delCat).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); }); });
    });
  }

  function openCategoryForm(id) {
    var cat = id ? adminData.categories.filter(function (c) { return c.id === id; })[0] : null;
    setModal(
      '<h2 class="modal-title">' + (cat ? 'Rename Category' : 'New Category') + '</h2>' +
      '<div class="field"><label>Category Name</label><input id="mc_name" value="' + esc(cat ? cat.name : '') + '" placeholder="e.g. Security System"></div>' +
      '<div class="modal-actions"><button class="ghost-modal-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (cat ? 'Save' : 'Create') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var name = document.getElementById('mc_name').value.trim();
      if (!name) { alert('Please enter a name.'); return; }
      var req = cat ? supabase.from('quote_categories').update({ name: name }).eq('id', cat.id) : supabase.from('quote_categories').insert({ name: name });
      req.then(function (r) { if (r.error) { alert(r.error.message); return; } closeModal(); loadAdminData(); });
    });
  }

  function openOptionForm(id, categoryId) {
    var opt = id ? adminData.options.filter(function (o) { return o.id === id; })[0] : null;
    setModal(
      '<h2 class="modal-title">' + (opt ? 'Edit Option' : 'New Option') + '</h2>' +
      '<div class="field"><label>Option Name</label><input id="mo_name" value="' + esc(opt ? opt.name : '') + '" placeholder="e.g. Light Curtain System"></div>' +
      '<div class="field"><label>Price Delta (USD, 0 = included)</label><input id="mo_price" value="' + (opt ? opt.price_delta : '0') + '" inputmode="decimal"></div>' +
      '<div class="field"><label>Specs / description</label><input id="mo_specs" value="' + esc(opt ? opt.specs : '') + '" placeholder="e.g. Photoelectric safety curtain, auto-stop"></div>' +
      '<div class="modal-actions"><button class="ghost-modal-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (opt ? 'Save' : 'Create') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var name = document.getElementById('mo_name').value.trim();
      if (!name) { alert('Please enter a name.'); return; }
      var payload = {
        name: name,
        price_delta: parseFloat(document.getElementById('mo_price').value.replace(/[^0-9.]/g, '') || '0'),
        specs: document.getElementById('mo_specs').value.trim()
      };
      if (!opt) payload.category_id = categoryId;
      var req = opt ? supabase.from('quote_options').update(payload).eq('id', opt.id) : supabase.from('quote_options').insert(payload);
      req.then(function (r) { if (r.error) { alert(r.error.message); return; } closeModal(); loadAdminData(); });
    });
  }

  // ---------------- Add-ons ----------------
  function renderAddonsTable() {
    document.getElementById('addonCount').textContent = adminData.addons.length;
    document.getElementById('addonsBody').innerHTML = adminData.addons.map(function (a) {
      return '<tr><td style="color:#fff; font-weight:500;">' + esc(a.name) + '</td><td class="owner-tag">' + money(a.price) + '</td><td class="owner-tag">' + esc(a.description || '-') + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + a.id + '">Edit</button><button class="icon-btn danger" data-confirm="0" data-del="' + a.id + '">Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="4" style="color:var(--steel-500); text-align:center; padding:26px;">No add-ons yet</td></tr>';

    document.querySelectorAll('#addonsBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openAddonForm(parseInt(b.dataset.edit, 10)); }); });
    document.querySelectorAll('#addonsBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () { confirmThenDelete(b, function () { return supabase.from('quote_addons').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); }); });
    });
  }

  function openAddonForm(id) {
    var a = id ? adminData.addons.filter(function (x) { return x.id === id; })[0] : null;
    setModal(
      '<h2 class="modal-title">' + (a ? 'Edit Add-on' : 'New Add-on') + '</h2>' +
      '<div class="field"><label>Add-on Name</label><input id="ma_name" value="' + esc(a ? a.name : '') + '" placeholder="e.g. Extended 3-Year Warranty"></div>' +
      '<div class="field"><label>Price (USD)</label><input id="ma_price" value="' + (a ? a.price : '0') + '" inputmode="decimal"></div>' +
      '<div class="field"><label>Description</label><input id="ma_desc" value="' + esc(a ? a.description : '') + '" placeholder="Shown to the customer"></div>' +
      '<div class="modal-actions"><button class="ghost-modal-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (a ? 'Save' : 'Create') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var name = document.getElementById('ma_name').value.trim();
      if (!name) { alert('Please enter a name.'); return; }
      var payload = { name: name, price: parseFloat(document.getElementById('ma_price').value.replace(/[^0-9.]/g, '') || '0'), description: document.getElementById('ma_desc').value.trim() };
      var req = a ? supabase.from('quote_addons').update(payload).eq('id', a.id) : supabase.from('quote_addons').insert(payload);
      req.then(function (r) { if (r.error) { alert(r.error.message); return; } closeModal(); loadAdminData(); });
    });
  }


  // ---------------- Quotes ----------------
  function renderQuotesTable() {
    document.getElementById('quoteCount').textContent = adminData.quotes.length;
    document.getElementById('quotesBody').innerHTML = adminData.quotes.map(function (q) {
      var machine = adminData.machines.filter(function (m) { return m.id === q.machine_id; })[0];
      var link = window.location.origin + '/quotation/?q=' + q.slug;
      var dlCount = adminData.downloadCounts[q.id] || 0;
      var createdDate = q.created_at ? q.created_at.slice(0, 10) : '-';
      return '<tr><td style="color:#fff;">' + esc(q.customer_label || '-') + '</td><td class="owner-tag">' + esc(machine ? machine.name : '-') + '</td>' +
        '<td><span class="link-tag" data-copy="' + esc(link) + '" style="cursor:pointer;" title="Click to copy">' + esc(link) + '</span></td>' +
        '<td class="owner-tag">' + dlCount + ' download(s)</td><td class="owner-tag">' + createdDate + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-copy-btn="' + esc(link) + '">Copy Link</button><button class="icon-btn danger" data-confirm="0" data-del="' + q.id + '">Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--steel-500); text-align:center; padding:26px;">No quotes yet</td></tr>';

    document.querySelectorAll('[data-copy-btn]').forEach(function (b) {
      b.addEventListener('click', function () {
        navigator.clipboard.writeText(b.dataset.copyBtn).then(function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = 'Copy Link'; }, 1500); });
      });
    });
    document.querySelectorAll('#quotesBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () { confirmThenDelete(b, function () { return supabase.from('quotes').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); }); });
    });
  }

  function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function openQuoteForm() {
    if (!adminData.machines.length) { alert('Please add a machine first (Machines tab).'); return; }

    var catState = {}; // { category_id: { mode: 'locked'|'open', optionId: N } }
    adminData.categories.forEach(function (c) { catState[c.id] = { mode: 'open', optionId: null }; });

    function categoryBlocksHtml() {
      return adminData.categories.map(function (cat) {
        var opts = adminData.options.filter(function (o) { return o.category_id === cat.id; });
        if (!opts.length) return '';
        var st = catState[cat.id];
        var optionsHtml = opts.map(function (o) {
          return '<option value="' + o.id + '"' + (st.optionId === o.id ? ' selected' : '') + '>' + esc(o.name) + (o.price_delta ? ' (+' + money(o.price_delta) + ')' : ' (included)') + '</option>';
        }).join('');
        return '<div class="category-block" data-cat-block="' + cat.id + '">' +
          '<div class="category-block-head"><span class="category-block-name">' + esc(cat.name) + '</span>' +
          '<div class="category-mode">' +
            '<label><input type="radio" name="mode-' + cat.id + '" value="locked"' + (st.mode === 'locked' ? ' checked' : '') + '> Locked</label>' +
            '<label><input type="radio" name="mode-' + cat.id + '" value="open"' + (st.mode === 'open' ? ' checked' : '') + '> Open (customer chooses)</label>' +
          '</div></div>' +
          '<select data-cat-option="' + cat.id + '" style="width:100%; background:var(--steel-900); border:1.5px solid var(--steel-700); border-radius:4px; color:#fff; padding:9px 11px;"><option value="">— select option —</option>' + optionsHtml + '</select>' +
        '</div>';
      }).join('') || '<p class="field-note">No categories with options yet — add some under "Categories &amp; Options" first, or skip this and just use the base machine.</p>';
    }

    var addonBoxes = adminData.addons.map(function (a) {
      return '<div class="addon-check-row"><input type="checkbox" data-addon-check="' + a.id + '" id="ad_' + a.id + '"><label for="ad_' + a.id + '">' + esc(a.name) + ' (+' + money(a.price) + ')</label></div>';
    }).join('') || '<p class="field-note">No add-ons defined yet.</p>';

    var machineOptions = adminData.machines.map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + '</option>'; }).join('');

    setModal(
      '<h2 class="modal-title">New Quote</h2>' +
      '<div class="field"><label>Machine</label><select id="qf_machine">' + machineOptions + '</select></div>' +
      '<div class="field"><label>Customer Reference (internal only — customer never sees this)</label><input id="qf_label" placeholder="e.g. ABC Corp — CU300 inquiry"></div>' +
      '<div class="field"><label>Password (share this with the customer along with the link)</label><input id="qf_password" placeholder="At least 8 characters"></div>' +
      '<div class="field"><label>Shareable link slug</label><input id="qf_slug" value="' + slugify(adminData.machines[0] ? adminData.machines[0].name : 'quote') + '-' + Math.random().toString(36).slice(2, 6) + '"></div>' +
      '<div class="modal-grid">' +
        '<div class="field"><label>Trade Terms</label><input id="qf_trade" value="FOB"></div>' +
        '<div class="field"><label>Lead Time</label><input id="qf_lead" placeholder="e.g. 8-10 weeks after deposit"></div>' +
      '</div>' +
      '<div class="field"><label>Payment Terms</label><input id="qf_payment" placeholder="e.g. 40% deposit, 60% balance before shipment"></div>' +
      '<div class="field"><label>Configuration categories</label><div id="catBlocks">' + categoryBlocksHtml() + '</div></div>' +
      '<div class="field"><label>Available add-ons for this quote</label>' + addonBoxes + '</div>' +
      '<div class="modal-actions"><button class="ghost-modal-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">Create Quote</button></div>'
    );
    openModal();

    function bindModeRadios() {
      document.querySelectorAll('#catBlocks input[type="radio"]').forEach(function (r) {
        r.addEventListener('change', function () {
          var catId = parseInt(r.name.replace('mode-', ''), 10);
          catState[catId].mode = r.value;
        });
      });
      document.querySelectorAll('#catBlocks select').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var catId = parseInt(sel.dataset.catOption, 10);
          catState[catId].optionId = sel.value ? parseInt(sel.value, 10) : null;
        });
      });
    }
    bindModeRadios();

    document.getElementById('qf_machine').addEventListener('change', function () {
      document.getElementById('qf_slug').value = slugify(this.options[this.selectedIndex].text) + '-' + Math.random().toString(36).slice(2, 6);
    });

    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var machineId = parseInt(document.getElementById('qf_machine').value, 10);
      var label = document.getElementById('qf_label').value.trim();
      var password = document.getElementById('qf_password').value;
      var slug = document.getElementById('qf_slug').value.trim();

      if (!password || password.length < 8) { alert('Please enter a password of at least 8 characters.'); return; }
      if (!slug) { alert('Please enter a link slug.'); return; }

      var lockedSelections = {};
      var openCategoryIds = [];
      var defaultOpenSelections = {};
      Object.keys(catState).forEach(function (catId) {
        var st = catState[catId];
        if (!st.optionId) return; // category has no options chosen, skip entirely
        if (st.mode === 'locked') {
          lockedSelections[catId] = st.optionId;
        } else {
          openCategoryIds.push(parseInt(catId, 10));
          defaultOpenSelections[catId] = st.optionId;
        }
      });

      var availableAddonIds = [];
      document.querySelectorAll('[data-addon-check]:checked').forEach(function (cb) { availableAddonIds.push(parseInt(cb.dataset.addonCheck, 10)); });

      var tradeTerms = document.getElementById('qf_trade').value.trim() || 'FOB';
      var leadTime = document.getElementById('qf_lead').value.trim();
      var paymentTerms = document.getElementById('qf_payment').value.trim();

      supabase.rpc('hash_quote_password', { plain: password }).then(function (hashRes) {
        if (hashRes.error) throw new Error(hashRes.error.message);
        return supabase.from('quotes').insert({
          slug: slug,
          password_hash: hashRes.data,
          machine_id: machineId,
          customer_label: label || null,
          trade_terms: tradeTerms,
          payment_terms: paymentTerms || null,
          lead_time: leadTime || null,
          locked_selections: lockedSelections,
          open_category_ids: openCategoryIds,
          default_open_selections: defaultOpenSelections,
          available_addon_ids: availableAddonIds
        });
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        closeModal();
        loadAdminData();
        var link = window.location.origin + '/quotation/?q=' + slug;
        alert('Quote created!\n\nLink: ' + link + '\nPassword: ' + password + '\n\nShare both with your customer — copy them now, the password won\'t be shown again.');
      }).catch(function (e) { alert(e.message); });
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
    card.addEventListener('click', function (e) { e.stopPropagation(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  }

  // ==============================================================
  // Boot
  // ==============================================================
  function boot() {
    var slug = getSlugFromUrl();
    if (slug) { renderUnlockScreen(slug); return; }

    supabase.auth.getSession().then(function (res) {
      if (res.data && res.data.session) { renderAdminPanel(); } else { renderUnlockScreen(null); }
    });
  }

  try {
    boot();
  } catch (err) {
    root.innerHTML = '<div class="boot-msg" style="color:#c1502e;">Something went wrong: ' + esc(err.message) + '. Please refresh the page.</div>';
  }
})();
