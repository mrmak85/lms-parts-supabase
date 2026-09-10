(function () {
  'use strict';

  var root = document.getElementById('app-root');
  if (!root) return;

  var supabase = window.supabase.createClient(window.LMS_SUPABASE_URL, window.LMS_SUPABASE_ANON_KEY, {
    auth: { storageKey: 'sb-order-tracking-auth' }
  });

  var EDGE_FN = 'order-tracking-accounts';

  function customerEmail(id) { return id.toLowerCase() + '@customers.maitool.internal'; }
  function adminEmail(id) { return id.toLowerCase() + '@sales.maitool.internal'; }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isExpired(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  }
  function confirmThenDelete(btn, action) {
    if (btn.dataset.confirm === '0') {
      btn.dataset.confirm = '1'; btn.textContent = 'Confirm Delete'; btn.classList.add('confirming');
      setTimeout(function () { if (btn.dataset.confirm === '1') { btn.dataset.confirm = '0'; btn.textContent = 'Delete'; btn.classList.remove('confirming'); } }, 3000);
    } else {
      action().catch(function (e) { alert(e.message); });
    }
  }
  function invokeFn(payload) {
    return supabase.functions.invoke(EDGE_FN, { body: payload }).then(function (res) {
      if (res.error) {
        // In supabase-js v2, res.error.context is the raw fetch Response
        // from the Edge Function (not pre-parsed JSON) — we have to read
        // its body ourselves to see the actual error our function sent.
        if (res.error.context && typeof res.error.context.json === 'function') {
          return res.error.context.json().then(function (body) {
            throw new Error((body && body.error) || res.error.message || 'Request failed.');
          }, function () {
            throw new Error(res.error.message || 'Request failed.');
          });
        }
        throw new Error(res.error.message || 'Request failed.');
      }
      if (res.data && res.data.error) throw new Error(res.data.error);
      return res.data;
    });
  }

  var STATUS_LABEL = { production: 'In Production', qc: 'Quality Check', queued: 'Queued', completed: 'Completed' };

  // ==============================================================
  // Shell
  // ==============================================================
  function shell(bodyHtml, opts) {
    opts = opts || {};
    var topbarRight = '<a class="ghost-link-btn" href="/" style="text-decoration:none;">&larr; Home</a>';
    if (opts.userLabel) {
      topbarRight += '<div class="user-chip" style="margin-left:10px;"><span class="dot"></span><span>' + esc(opts.userLabel) + '</span></div>' +
        '<button class="logout-btn" id="logoutBtn" style="margin-left:10px;">Log Out</button>';
    }
    root.innerHTML =
      '<div class="app">' +
        '<div class="topbar">' +
          '<div class="brand">' +
            '<img class="brand-mark" src="/assets/logo-icon.png" alt="FrameMac">' +
            '<div><div class="brand-text">FRAMEMAC &amp; LMS Order Tracking</div><div class="brand-sub">' + (opts.subtitle || '') + '</div></div>' +
          '</div>' +
          '<div class="topbar-actions">' + topbarRight + '</div>' +
        '</div>' +
        bodyHtml +
      '</div>';
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        supabase.auth.signOut().then(renderCustomerLogin);
      });
    }
  }

  // ==============================================================
  // CUSTOMER: login & dashboard
  // ==============================================================
  function renderCustomerLogin() {
    shell(
      '<div class="login-view"><div class="login-card">' +
        '<h1 class="login-title">Customer Login</h1>' +
        '<p class="login-desc">Enter your customer ID and password to check the status of your orders currently in production.</p>' +
        '<div class="login-error" id="custErr">Incorrect customer ID or password.</div>' +
        '<div class="field"><label>Customer ID</label><input type="text" id="custId" autocomplete="off"></div>' +
        '<div class="field"><label>Password</label><input type="password" id="custPw" autocomplete="off"></div>' +
        '<button class="login-btn" id="custLoginBtn">Log In</button>' +
        '<button class="back-link" id="toAdminLogin">Sales / Admin Login &rarr;</button>' +
      '</div></div>',
      { subtitle: 'Customer Portal' }
    );
    document.getElementById('toAdminLogin').addEventListener('click', renderAdminLogin);

    function doLogin() {
      var id = document.getElementById('custId').value.trim();
      var pw = document.getElementById('custPw').value;
      var errEl = document.getElementById('custErr');
      errEl.classList.remove('show');
      supabase.auth.signInWithPassword({ email: customerEmail(id), password: pw }).then(function (res) {
        if (res.error) { errEl.classList.add('show'); return; }
        renderCustomerDashboard();
      });
    }
    document.getElementById('custLoginBtn').addEventListener('click', doLogin);
    document.getElementById('custPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  var custOrdersCache = [];
  var custCategoryFilter = 'all';
  var currentCustomer = null;

  function renderCustomerDashboard() {
    shell(
      '<div class="main">' +
        '<h1 class="page-title">Orders in Production</h1>' +
        '<p class="page-desc">Below are your company\'s orders currently in production. Completion dates are estimates and may shift with scheduling changes.</p>' +
        '<div class="stat-row" id="statRow"></div>' +
        '<div class="panel-toolbar"><div class="toolbar-left"><span class="hint">Filter by category</span>' +
        '<select class="filter-select" id="custCatFilter"><option value="all">All Categories</option></select></div></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Order No.</th><th>Category</th><th>Product</th><th>Start Date</th><th>Est. Completion</th><th>Progress</th><th>Status</th></tr></thead><tbody id="activeOrdersBody"></tbody></table></div>' +
        '<div class="history-section">' +
          '<button class="history-toggle" id="histToggle">' +
            '<svg class="chevron" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            'Order History<span class="count-badge" id="histCount">0</span>' +
          '</button>' +
          '<div class="history-body" id="histBody"><div class="table-wrap"><table><thead><tr><th>Order No.</th><th>Category</th><th>Product</th><th>Start Date</th><th>Completed</th><th>Warranty Expires</th><th>Status</th></tr></thead><tbody id="histOrdersBody"></tbody></table></div></div>' +
        '</div>' +
        '<p class="footnote">Completion dates are for reference only; the actual shipping notice is final. Contact: Wilson Mai (wilson@lmsmachinery.com)</p>' +
      '</div>',
      { userLabel: 'Loading…', subtitle: 'Customer Portal' }
    );

    document.getElementById('histToggle').addEventListener('click', function () {
      this.classList.toggle('open');
      document.getElementById('histBody').classList.toggle('open');
    });
    document.getElementById('custCatFilter').addEventListener('change', function (e) {
      custCategoryFilter = e.target.value;
      renderCustomerOrderTables();
    });

    supabase.auth.getUser().then(function (res) {
      var uid = res.data.user.id;
      return supabase.from('order_customers').select('customer_id, company_name').eq('user_id', uid).single();
    }).then(function (res) {
      if (res.error || !res.data) { supabase.auth.signOut().then(renderCustomerLogin); return; }
      currentCustomer = res.data;
      var chip = document.querySelector('.user-chip span:last-child');
      if (chip) chip.textContent = currentCustomer.customer_id + ' \u00b7 ' + currentCustomer.company_name;
      return supabase.from('orders').select('*').eq('customer_id', currentCustomer.customer_id).order('start_date', { ascending: false });
    }).then(function (res) {
      if (!res) return;
      if (res.error) throw new Error(res.error.message);
      custOrdersCache = res.data;
      populateCustCategoryFilter();
      renderCustomerOrderTables();
    }).catch(function (e) {
      document.getElementById('activeOrdersBody').innerHTML = '<tr><td colspan="7" style="color:#c23b23; text-align:center; padding:26px;">' + esc(e.message) + '</td></tr>';
    });
  }

  function populateCustCategoryFilter() {
    var cats = [];
    custOrdersCache.forEach(function (o) { if (o.category && cats.indexOf(o.category) === -1) cats.push(o.category); });
    cats.sort();
    var select = document.getElementById('custCatFilter');
    var existing = select.value || 'all';
    select.innerHTML = '<option value="all">All Categories</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    custCategoryFilter = cats.indexOf(existing) !== -1 ? existing : 'all';
    select.value = custCategoryFilter;
  }

  function renderCustomerOrderTables() {
    var orders = custOrdersCache;
    if (custCategoryFilter !== 'all') orders = orders.filter(function (o) { return o.category === custCategoryFilter; });
    var active = orders.filter(function (o) { return o.status !== 'completed'; });
    var history = orders.filter(function (o) { return o.status === 'completed'; });

    var inProd = active.filter(function (o) { return o.status === 'production'; }).length;
    var inQc = active.filter(function (o) { return o.status === 'qc'; }).length;
    var avg = active.length ? Math.round(active.reduce(function (s, o) { return s + o.progress; }, 0) / active.length) : 0;

    document.getElementById('statRow').innerHTML = [
      { num: active.length, label: 'Orders in Production' },
      { num: inProd, label: 'Currently Manufacturing', amber: true },
      { num: inQc, label: 'In Quality Check' },
      { num: avg + '%', label: 'Average Progress' }
    ].map(function (s) {
      return '<div class="stat-card"><div class="stat-num' + (s.amber ? ' amber' : '') + '">' + s.num + '</div><div class="stat-label">' + s.label + '</div></div>';
    }).join('');

    document.getElementById('activeOrdersBody').innerHTML = active.map(function (o) {
      return '<tr><td class="order-id">' + esc(o.order_no) + '</td><td class="owner-tag">' + esc(o.category || '-') + '</td><td class="product-name">' + esc(o.product_name) + '</td>' +
        '<td class="date-cell">' + esc(o.start_date) + '</td><td class="date-cell">' + esc(o.eta_date) + '</td>' +
        '<td><div class="progress-cell"><div class="progress-track"><div class="progress-fill" style="width:' + o.progress + '%"></div></div><div class="progress-pct">' + o.progress + '%</div></div></td>' +
        '<td><span class="status-badge status-' + o.status + '"><span class="dot"></span>' + STATUS_LABEL[o.status] + '</span></td></tr>';
    }).join('') || '<tr><td colspan="7" style="color:var(--ink-400); text-align:center; padding:26px;">No orders currently in production</td></tr>';

    document.getElementById('histCount').textContent = history.length;
    document.getElementById('histOrdersBody').innerHTML = history.map(function (o) {
      var expired = isExpired(o.warranty_date);
      return '<tr><td class="order-id">' + esc(o.order_no) + '</td><td class="owner-tag">' + esc(o.category || '-') + '</td><td class="product-name">' + esc(o.product_name) + '</td>' +
        '<td class="date-cell">' + esc(o.start_date) + '</td><td class="date-cell">' + esc(o.eta_date) + '</td>' +
        '<td class="date-cell warranty' + (expired ? ' expired' : '') + '">' + esc(o.warranty_date || '-') + (expired ? ' (expired)' : '') + '</td>' +
        '<td><span class="status-badge status-completed"><span class="dot"></span>Completed</span></td></tr>';
    }).join('') || '<tr><td colspan="7" style="color:var(--ink-400); text-align:center; padding:26px;">No order history yet</td></tr>';
  }

  // ==============================================================
  // ADMIN (sales rep): login
  // ==============================================================
  function renderAdminLogin() {
    shell(
      '<div class="login-view"><div class="login-card">' +
        '<h1 class="login-title">Sales / Admin Login</h1>' +
        '<p class="login-desc">For internal sales staff to manage order status, warranty information, and customer accounts.</p>' +
        '<div class="login-error" id="adminErr">Incorrect login ID or password.</div>' +
        '<div class="field"><label>Login ID</label><input type="text" id="adminId" autocomplete="off"></div>' +
        '<div class="field"><label>Password</label><input type="password" id="adminPw" autocomplete="off"></div>' +
        '<button class="login-btn" id="adminLoginBtn">Log In to Admin</button>' +
        '<button class="back-link" id="toCustomerLogin">&larr; Back to Customer Login</button>' +
      '</div></div>',
      { subtitle: 'Sales Admin' }
    );
    document.getElementById('toCustomerLogin').addEventListener('click', renderCustomerLogin);

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
  // ADMIN PANEL
  // ==============================================================
  var currentAdmin = null;
  var adminData = { orders: [], customers: [], categories: [] };
  var orderCustFilter = 'all';

  function renderAdminPanel() {
    shell(
      '<div class="main">' +
        '<h1 class="page-title">Sales Admin Panel</h1>' +
        '<p class="page-desc">Maintain order production status, warranty expiration dates, customer accounts, and admin accounts. Shared across the whole sales team — any admin can see and edit everything here.</p>' +
        '<div class="tab-row">' +
          '<button class="tab-btn active" data-tab="orders">Order Management</button>' +
          '<button class="tab-btn" data-tab="customers">Customer Account Management</button>' +
          '<button class="tab-btn" data-tab="categories">Order Categories</button>' +
          '<button class="tab-btn" data-tab="accounts">Admin Accounts</button>' +
        '</div>' +
        '<div class="tab-panel active" id="tabOrders">' +
          '<div class="panel-toolbar"><div class="toolbar-left"><span class="hint"><span id="orderCountHint">0</span> orders total</span>' +
          '<select class="filter-select" id="orderCustFilter"><option value="all">All Customers</option></select></div>' +
          '<button class="primary-btn" id="addOrderBtn">+ New Order</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Order No.</th><th>Customer</th><th>Category</th><th>Product</th><th>Start / Completion</th><th>Status</th><th>Warranty Expires</th><th></th></tr></thead><tbody id="adminOrdersBody"></tbody></table></div>' +
        '</div>' +
        '<div class="tab-panel" id="tabCustomers">' +
          '<div class="panel-toolbar"><span class="hint"><span id="custCountHint">0</span> customer accounts</span>' +
          '<button class="primary-btn" id="addCustBtn">+ New Customer Account</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Company Name</th><th>Customer ID</th><th>Linked Orders</th><th></th></tr></thead><tbody id="adminCustsBody"></tbody></table></div>' +
        '</div>' +
        '<div class="tab-panel" id="tabCategories">' +
          '<div class="panel-toolbar"><span class="hint">Shared across all admins</span>' +
          '<button class="primary-btn" id="addCatBtn">+ New Category</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Category</th><th>Orders Using It</th><th></th></tr></thead><tbody id="adminCatsBody"></tbody></table></div>' +
        '</div>' +
        '<div class="tab-panel" id="tabAccounts">' +
          '<div class="panel-toolbar"><span class="hint"><span id="acctCountHint">0</span> admin accounts</span>' +
          '<button class="primary-btn" id="addAcctBtn">+ New Admin Account</button></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Login ID</th><th></th></tr></thead><tbody id="acctsBody"></tbody></table></div>' +
        '</div>' +
        '<p class="footnote">Order categories and admin accounts are shared company-wide.</p>' +
      '</div>' + modalHtml(),
      { userLabel: 'Loading…', subtitle: 'Sales Admin' }
    );

    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var map = { orders: 'tabOrders', customers: 'tabCustomers', categories: 'tabCategories', accounts: 'tabAccounts' };
        document.getElementById(map[btn.dataset.tab]).classList.add('active');
      });
    });
    document.getElementById('addOrderBtn').addEventListener('click', function () { openOrderForm(null); });
    document.getElementById('addCustBtn').addEventListener('click', function () { openCustForm(null); });
    document.getElementById('addCatBtn').addEventListener('click', function () { openCatForm(null); });
    document.getElementById('addAcctBtn').addEventListener('click', function () { openAcctForm(null); });
    document.getElementById('orderCustFilter').addEventListener('change', function (e) { orderCustFilter = e.target.value; renderOrdersTable(); });
    bindModalOverlay();

    supabase.auth.getUser().then(function (res) {
      var uid = res.data.user.id;
      return supabase.from('order_admins').select('login_id, name').eq('user_id', uid).single();
    }).then(function (res) {
      if (res.error || !res.data) { supabase.auth.signOut().then(renderCustomerLogin); return; }
      currentAdmin = res.data;
      var chip = document.querySelector('.user-chip span:last-child');
      if (chip) chip.textContent = currentAdmin.name + ' (' + currentAdmin.login_id + ')';
      loadAdminData();
    });
  }

  function loadAdminData() {
    Promise.all([
      supabase.from('orders').select('*').order('start_date', { ascending: false }),
      supabase.from('order_customers').select('*').order('company_name'),
      supabase.from('order_categories').select('*').order('name'),
      supabase.from('order_admins').select('login_id, name').order('name')
    ]).then(function (res) {
      if (res[0].error) throw new Error(res[0].error.message);
      if (res[1].error) throw new Error(res[1].error.message);
      if (res[2].error) throw new Error(res[2].error.message);
      if (res[3].error) throw new Error(res[3].error.message);
      adminData.orders = res[0].data;
      adminData.customers = res[1].data;
      adminData.categories = res[2].data;
      salesAccounts = res[3].data;
      populateOrderCustFilter();
      renderOrdersTable();
      renderCustomersTable();
      renderCategoriesTable();
      renderAcctsTable();
    }).catch(function (e) {
      var msg = '<tr><td colspan="8" style="color:#c23b23; text-align:center; padding:26px;">Could not load data: ' + esc(e.message) + '</td></tr>';
      ['adminOrdersBody', 'adminCustsBody', 'adminCatsBody', 'acctsBody'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = msg;
      });
    });
  }

  function populateOrderCustFilter() {
    var select = document.getElementById('orderCustFilter');
    var existing = select.value || 'all';
    select.innerHTML = '<option value="all">All Customers</option>' +
      adminData.customers.map(function (c) { return '<option value="' + esc(c.customer_id) + '">' + esc(c.company_name) + ' (' + esc(c.customer_id) + ')</option>'; }).join('');
    orderCustFilter = adminData.customers.some(function (c) { return c.customer_id === existing; }) ? existing : 'all';
    select.value = orderCustFilter;
  }
  function custName(id) {
    var c = adminData.customers.filter(function (x) { return x.customer_id === id; })[0];
    return c ? c.company_name : id;
  }

  // ---------------- Orders ----------------
  function renderOrdersTable() {
    var rows = adminData.orders;
    if (orderCustFilter !== 'all') rows = rows.filter(function (o) { return o.customer_id === orderCustFilter; });
    document.getElementById('orderCountHint').textContent = rows.length;
    document.getElementById('adminOrdersBody').innerHTML = rows.map(function (o) {
      var expired = isExpired(o.warranty_date);
      return '<tr><td class="order-id">' + esc(o.order_no) + '</td>' +
        '<td>' + esc(custName(o.customer_id)) + '<br><span class="owner-tag">' + esc(o.customer_id) + '</span></td>' +
        '<td class="owner-tag">' + esc(o.category || '-') + '</td>' +
        '<td class="product-name">' + esc(o.product_name) + '</td>' +
        '<td class="date-cell">' + esc(o.start_date) + ' &rarr; ' + esc(o.eta_date) + '</td>' +
        '<td><span class="status-badge status-' + o.status + '"><span class="dot"></span>' + STATUS_LABEL[o.status] + '</span></td>' +
        '<td class="date-cell warranty' + (expired ? ' expired' : '') + '">' + esc(o.warranty_date || '-') + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + o.id + '">Edit</button><button class="icon-btn danger" data-confirm="0" data-del="' + o.id + '">Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="8" style="color:var(--ink-400); text-align:center; padding:26px;">' + (orderCustFilter === 'all' ? 'You have no orders yet' : 'No orders for this customer') + '</td></tr>';

    document.querySelectorAll('#adminOrdersBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openOrderForm(parseInt(b.dataset.edit, 10)); }); });
    document.querySelectorAll('#adminOrdersBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        confirmThenDelete(b, function () { return supabase.from('orders').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); });
      });
    });
  }

  function openOrderForm(id) {
    var myCusts = adminData.customers;
    if (myCusts.length === 0) {
      alert('You have no customer accounts yet. Please add a customer under "Customer Account Management" first, then create an order.');
      return;
    }
    var o = id ? adminData.orders.filter(function (x) { return x.id === id; })[0] : null;
    var custOptions = myCusts.map(function (c) { return '<option value="' + esc(c.customer_id) + '"' + (o && o.customer_id === c.customer_id ? ' selected' : '') + '>' + esc(c.company_name) + ' (' + esc(c.customer_id) + ')</option>'; }).join('');
    var catOptions = '<option value="">No category</option>' + adminData.categories.map(function (c) { return '<option value="' + esc(c.name) + '"' + (o && o.category === c.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    var statusOptions = Object.keys(STATUS_LABEL).map(function (k) { return '<option value="' + k + '"' + (o && o.status === k ? ' selected' : '') + '>' + STATUS_LABEL[k] + '</option>'; }).join('');

    setModal(
      '<h2 class="modal-title">' + (o ? 'Edit Order' : 'New Order') + '</h2>' +
      '<div class="modal-grid">' +
        '<div class="field full"><label>Order No.</label><input id="f_id" value="' + esc(o ? o.order_no : '') + '"' + (o ? ' disabled' : '') + ' placeholder="e.g. PO-20260902-01"></div>' +
        '<div class="field full"><label>Customer</label><select id="f_cust">' + custOptions + '</select></div>' +
        '<div class="field full"><label>Product Name</label><input id="f_product" value="' + esc(o ? o.product_name : '') + '"></div>' +
        '<div class="field full"><label>Category</label><select id="f_category">' + catOptions + '</select></div>' +
        '<div class="field"><label>Start Date</label><input type="date" id="f_start" value="' + esc(o ? o.start_date : '') + '"></div>' +
        '<div class="field"><label>Est. / Actual Completion</label><input type="date" id="f_eta" value="' + esc(o ? o.eta_date : '') + '"></div>' +
        '<div class="field"><label>Status</label><select id="f_status">' + statusOptions + '</select></div>' +
        '<div class="field"><label>Progress (%)</label><input type="number" min="0" max="100" id="f_progress" value="' + (o ? o.progress : 0) + '"></div>' +
        '<div class="field full"><label>Warranty Expires</label><input type="date" id="f_warranty" value="' + esc(o ? (o.warranty_date || '') : '') + '"></div>' +
      '</div>' +
      '<div class="modal-actions"><button class="ghost-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (o ? 'Save Changes' : 'Create Order') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var orderNo = document.getElementById('f_id').value.trim();
      if (!orderNo) { alert('Please enter an order number'); return; }
      var payload = {
        order_no: orderNo,
        customer_id: document.getElementById('f_cust').value,
        product_name: document.getElementById('f_product').value.trim(),
        category: document.getElementById('f_category').value || null,
        start_date: document.getElementById('f_start').value || null,
        eta_date: document.getElementById('f_eta').value || null,
        status: document.getElementById('f_status').value,
        progress: Math.max(0, Math.min(100, parseInt(document.getElementById('f_progress').value || '0', 10))),
        warranty_date: document.getElementById('f_warranty').value || null,
        owner_login_id: currentAdmin.login_id
      };
      var req = o
        ? supabase.from('orders').update(payload).eq('id', o.id)
        : supabase.from('orders').insert(payload);
      req.then(function (r) {
        if (r.error) { alert(r.error.message); return; }
        closeModal(); loadAdminData();
      });
    });
  }

  // ---------------- Customers ----------------
  function renderCustomersTable() {
    document.getElementById('custCountHint').textContent = adminData.customers.length;
    document.getElementById('adminCustsBody').innerHTML = adminData.customers.map(function (c) {
      var orderCount = adminData.orders.filter(function (o) { return o.customer_id === c.customer_id; }).length;
      return '<tr><td class="product-name">' + esc(c.company_name) + '</td><td class="order-id">' + esc(c.customer_id) + '</td>' +
        '<td class="owner-tag">' + orderCount + ' order(s)</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + esc(c.customer_id) + '">Edit</button>' +
        '<button class="icon-btn danger" data-confirm="0" data-del="' + esc(c.customer_id) + '"' + (orderCount > 0 ? ' disabled title="This customer still has orders"' : '') + '>Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="4" style="color:var(--ink-400); text-align:center; padding:26px;">You have no customer accounts yet</td></tr>';

    document.querySelectorAll('#adminCustsBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openCustForm(b.dataset.edit); }); });
    document.querySelectorAll('#adminCustsBody [data-del]').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () {
        confirmThenDelete(b, function () { return invokeFn({ action: 'delete_customer', customer_id: b.dataset.del }).then(loadAdminData); });
      });
    });
  }

  function openCustForm(customerId) {
    var c = customerId ? adminData.customers.filter(function (x) { return x.customer_id === customerId; })[0] : null;
    setModal(
      '<h2 class="modal-title">' + (c ? 'Edit Customer Account' : 'New Customer Account') + '</h2>' +
      '<div class="modal-grid">' +
        '<div class="field full"><label>Company Name</label><input id="c_name" value="' + esc(c ? c.company_name : '') + '" placeholder="e.g. Dacheng Machinery"></div>' +
        '<div class="field full"><label>Customer ID</label><input id="c_id" value="' + esc(c ? c.customer_id : '') + '"' + (c ? ' disabled' : '') + ' placeholder="e.g. CUST-4098"></div>' +
        '<div class="field full"><label>Password' + (c ? ' (leave blank to keep current)' : '') + '</label><input id="c_pw" placeholder="' + (c ? 'New password (optional)' : 'At least 8 chars, 1 letter + 1 number') + '"></div>' +
        '<div class="field full"><div class="field-note">This customer account will be visible and editable by any admin.</div></div>' +
      '</div>' +
      '<div class="modal-actions"><button class="ghost-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (c ? 'Save Changes' : 'Create Account') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var idVal = document.getElementById('c_id').value.trim();
      var name = document.getElementById('c_name').value.trim();
      var pw = document.getElementById('c_pw').value;
      if (!idVal || !name || (!c && !pw)) { alert('Please fill in company name, customer ID, and password'); return; }

      var chain;
      if (c) {
        // Company name can be updated directly (RLS allows it); password change goes through the edge function.
        chain = supabase.from('order_customers').update({ company_name: name }).eq('customer_id', c.customer_id).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          if (pw) return invokeFn({ action: 'update_customer_password', customer_id: c.customer_id, password: pw });
        });
      } else {
        chain = invokeFn({ action: 'create_customer', customer_id: idVal, company_name: name, password: pw });
      }
      chain.then(function () { closeModal(); loadAdminData(); }).catch(function (e) { alert(e.message); });
    });
  }

  // ---------------- Categories ----------------
  function renderCategoriesTable() {
    document.getElementById('adminCatsBody').innerHTML = adminData.categories.map(function (cat) {
      var useCount = adminData.orders.filter(function (o) { return o.category === cat.name; }).length;
      return '<tr><td class="product-name">' + esc(cat.name) + '</td><td class="owner-tag">' + useCount + ' order(s)</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + cat.id + '">Edit</button>' +
        '<button class="icon-btn danger" data-confirm="0" data-del="' + cat.id + '"' + (useCount > 0 ? ' disabled title="Still used by orders"' : '') + '>Delete</button></div></td></tr>';
    }).join('') || '<tr><td colspan="3" style="color:var(--ink-400); text-align:center; padding:26px;">No categories yet</td></tr>';

    document.querySelectorAll('#adminCatsBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openCatForm(parseInt(b.dataset.edit, 10)); }); });
    document.querySelectorAll('#adminCatsBody [data-del]').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () {
        confirmThenDelete(b, function () { return supabase.from('order_categories').delete().eq('id', b.dataset.del).then(function (r) { if (r.error) throw new Error(r.error.message); loadAdminData(); }); });
      });
    });
  }

  function openCatForm(catId) {
    var cat = catId ? adminData.categories.filter(function (x) { return x.id === catId; })[0] : null;
    setModal(
      '<h2 class="modal-title">' + (cat ? 'Edit Category' : 'New Category') + '</h2>' +
      '<div class="modal-grid"><div class="field full"><label>Category Name</label><input id="mcat_name" value="' + esc(cat ? cat.name : '') + '" placeholder="e.g. Machine, Spare Part"></div></div>' +
      '<div class="modal-actions"><button class="ghost-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (cat ? 'Save Changes' : 'Create Category') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var name = document.getElementById('mcat_name').value.trim();
      if (!name) { alert('Please enter a category name'); return; }
      var req = cat
        ? supabase.from('order_categories').update({ name: name }).eq('id', cat.id)
        : supabase.from('order_categories').insert({ name: name });
      req.then(function (r) {
        if (r.error) { alert(r.error.message); return; }
        closeModal(); loadAdminData();
      });
    });
  }

  // ==============================================================
  // ADMIN ACCOUNTS (a tab within the Admin Panel — any admin can
  // manage any other admin's account, no separate gate needed)
  // ==============================================================
  var salesAccounts = [];

  function renderAcctsTable() {
    document.getElementById('acctCountHint').textContent = salesAccounts.length;
    var disableDelete = salesAccounts.length <= 1;
    document.getElementById('acctsBody').innerHTML = salesAccounts.map(function (a) {
      return '<tr><td class="product-name">' + esc(a.name) + '</td><td class="order-id">' + esc(a.login_id) + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + esc(a.login_id) + '">Edit</button>' +
        '<button class="icon-btn danger" data-confirm="0" data-del="' + esc(a.login_id) + '"' + (disableDelete ? ' disabled title="At least one admin account must remain"' : '') + '>Delete</button></div></td></tr>';
    }).join('');

    document.querySelectorAll('#acctsBody [data-edit]').forEach(function (b) { b.addEventListener('click', function () { openAcctForm(b.dataset.edit); }); });
    document.querySelectorAll('#acctsBody [data-del]').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () {
        confirmThenDelete(b, function () { return invokeFn({ action: 'delete_admin', login_id: b.dataset.del }).then(loadAdminData); });
      });
    });
  }

  function openAcctForm(loginId) {
    var a = loginId ? salesAccounts.filter(function (x) { return x.login_id === loginId; })[0] : null;
    setModal(
      '<h2 class="modal-title">' + (a ? 'Edit Sales Account' : 'New Sales Account') + '</h2>' +
      '<div class="modal-grid">' +
        '<div class="field full"><label>Name</label><input id="a_name" value="' + esc(a ? a.name : '') + '" placeholder="e.g. John Smith"></div>' +
        '<div class="field full"><label>Login ID</label><input id="a_id" value="' + esc(a ? a.login_id : '') + '"' + (a ? ' disabled' : '') + ' placeholder="e.g. SALES-04"></div>' +
        '<div class="field full"><label>Password' + (a ? ' (leave blank to keep current)' : '') + '</label><input id="a_pw" placeholder="' + (a ? 'New password (optional)' : 'At least 8 chars, 1 letter + 1 number') + '"></div>' +
      '</div>' +
      '<div class="modal-actions"><button class="ghost-btn" id="mCancel">Cancel</button><button class="primary-btn" id="mSave">' + (a ? 'Save Changes' : 'Create Account') + '</button></div>'
    );
    openModal();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var idVal = document.getElementById('a_id').value.trim();
      var name = document.getElementById('a_name').value.trim();
      var pw = document.getElementById('a_pw').value;
      if (!idVal || !name || (!a && !pw)) { alert('Please fill in name, login ID, and password'); return; }

      var chain;
      if (a) {
        chain = supabase.from('order_admins').update({ name: name }).eq('login_id', a.login_id).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          if (pw) return invokeFn({ action: 'update_admin_password', login_id: a.login_id, password: pw });
        });
      } else {
        chain = invokeFn({ action: 'create_admin', login_id: idVal, name: name, password: pw });
      }
      chain.then(function () { closeModal(); loadAdminData(); }).catch(function (e) { alert(e.message); });
    });
  }

  // ==============================================================
  // Shared modal
  // ==============================================================
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
  // Boot — resume an existing session if present, and route to the
  // right view based on which role that session belongs to.
  // ==============================================================
  function boot() {
    supabase.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) { renderCustomerLogin(); return; }

      var user = session.user;
      supabase.from('order_admins').select('login_id').eq('user_id', user.id).maybeSingle().then(function (r) {
        if (r.data) { renderAdminPanel(); return; }
        supabase.from('order_customers').select('customer_id').eq('user_id', user.id).maybeSingle().then(function (r2) {
          if (r2.data) { renderCustomerDashboard(); return; }
          // Orphaned session (not in either table) — sign out and start fresh.
          supabase.auth.signOut().then(renderCustomerLogin);
        });
      });
    });
  }

  try {
    boot();
  } catch (err) {
    root.innerHTML = '<div class="boot-msg" style="color:#c23b23;">Something went wrong loading the portal: ' + esc(err.message) + '. Please refresh the page.</div>';
  }
})();
