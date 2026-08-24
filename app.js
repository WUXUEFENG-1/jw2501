/* ============================================================
 * 计算机网络技术2501班 班级工作台APP
 * 云南工业信息职业学院
 * 单页应用 - LocalStorage持久化
 * ============================================================ */

// ============== 常量 ==============
const CLASS_NAME = '计算机网络技术2501班';
const SCHOOL_NAME = '云南工业信息职业学院';
const LS_PREFIX = 'jw2501_';
const DEFAULT_BZ_PWD = 'bz2501';
const DEFAULT_BZR_PWD = 'bzr2501';

// ============== Supabase 客户端 ==============
// 请替换为你自己的项目 URL 和 publishable key（见文末说明）
const SUPABASE_URL = 'https://vvmnzyhbjcskyyofvemj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MsfALtjxliSa9kTv_cVdhw_x145_IA5';
// 注意：不要用 const supabase 命名，避免与 supabase-js 的全局 supabase 冲突
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
if (!sb) console.error('Supabase 客户端加载失败，请检查网络或CDN');

// ============== 工具函数 ==============
const $ = (sel, parent=document) => parent.querySelector(sel);
const $$ = (sel, parent=document) => [...parent.querySelectorAll(sel)];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function now() { return new Date().toISOString(); }
function fmtDate(iso, withTime=false) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const pad = n => String(n).padStart(2,'0');
  let s = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  if (withTime) s += ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return s;
}
function fmtDateShort(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function todayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function isExpired(deadline) {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}
function confirmDialog(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:340px;border-radius:14px;margin:auto;">
        <div class="modal-header"><span>确认</span><button class="modal-close">&times;</button></div>
        <div class="modal-body" style="text-align:center;font-size:0.9rem;">${msg}</div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" id="dlgCancel">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="dlgOk">确定</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#dlgOk').onclick = () => close(true);
    overlay.querySelector('#dlgCancel').onclick = () => close(false);
    overlay.querySelector('.modal-close').onclick = () => close(false);
    overlay.onclick = e => { if (e.target === overlay) close(false); };
  });
}
function promptDialog(title, placeholder='') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:340px;border-radius:14px;margin:auto;">
        <div class="modal-header"><span>${title}</span><button class="modal-close">&times;</button></div>
        <div class="modal-body"><input type="text" id="dlgInput" placeholder="${placeholder}" style="width:100%;padding:9px;border:1px solid var(--gray-3);border-radius:7px;"></div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" id="dlgCancel">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="dlgOk">确定</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const inp = overlay.querySelector('#dlgInput');
    inp.focus();
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#dlgOk').onclick = () => close(inp.value);
    overlay.querySelector('#dlgCancel').onclick = () => close(null);
    overlay.querySelector('.modal-close').onclick = () => close(null);
    inp.onkeydown = e => { if (e.key==='Enter') close(inp.value); };
  });
}
function encodeBase64(str) {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return str; }
}
function decodeBase64(str) {
  try { return decodeURIComponent(escape(atob(str))); } catch { return str; }
}
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fileToBase64(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

// ============== 数据存储（云端版） ==============
// 内存缓存：登录后从云端拉取全部数据到内存，之后读写走内存 + 异步推送
const Store = {
  cache: {},                 // { key: value }
  dirty: new Set(),          // 待推送的 key
  ready: false,              // 是否已从云端加载
  saving: Promise.resolve(), // 串行化推送队列

  get(key, def=null) {
    const v = this.cache[key];
    return v === undefined ? def : v;
  },
  set(key, val) {
    this.cache[key] = val;
    this.dirty.add(key);
    this.scheduleSave();
  },
  remove(key) { delete this.cache[key]; this.dirty.add(key); this.scheduleSave(); },

  // 从云端加载全部数据（登录后调用）
  async loadAll() {
    const data = await this.fetchAll();
    this.cache = {};
    for (const k in data) this.cache[k] = data[k];
    this.ready = true;
    return this.cache;
  },

  // 拉取 store_data 全部行
  async fetchAll() {
    try {
      const { data, error } = await sb
        .from('store_data')
        .select('key, value');
      if (error) throw error;
      const obj = {};
      (data || []).forEach(row => {
        try { obj[row.key] = JSON.parse(JSON.stringify(row.value)); }
        catch { obj[row.key] = row.value; }
      });
      return obj;
    } catch (e) {
      console.error('云端加载失败，使用本地缓存:', e);
      // 降级：读本地缓存
      const local = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) local[k.slice(LS_PREFIX.length)] = JSON.parse(localStorage.getItem(k));
      }
      return local;
    }
  },

  // 串行化推送脏数据到云端
  scheduleSave() {
    this.saving = this.saving.then(async () => {
      const keys = [...this.dirty];
      this.dirty.clear();
      for (const key of keys) {
        try {
          const val = this.cache[key] === undefined ? '{}' : this.cache[key];
          const { error } = await sb
            .from('store_data')
            .upsert({ key, value: val, updated_at: new Date().toISOString() }, { onConflict: 'key' });
          if (error) console.error(`推送 ${key} 失败:`, error);
          // 本地备份
          localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
        } catch (e) { console.error(`推送 ${key} 异常:`, e); }
      }
    }).catch(e => console.error('推送队列错误:', e));
  },

  // 等所有待推送完成（用于退出前兜底）
  async flush() { await this.saving; },

  // 配置
  getConfig() {
    return this.get('config', {
      className: CLASS_NAME,
      schoolName: SCHOOL_NAME,
      tuitionFull: 5800,
      tuitionFee: 5000,
      dormFee: 800,
    });
  },
  saveConfig(cfg) { this.set('config', cfg); },

  // 学生名单
  getStudents() { return this.get('students', []); },
  saveStudents(list) { this.set('students', list); },
  getStudent(id) { return this.getStudents().find(s => s.id === id); },
  getStudentByStuNo(stuNo) { return this.getStudents().find(s => s.stuNo === stuNo); },

  // 当前用户（存本地会话）
  getCurrentUser() {
    try { return JSON.parse(localStorage.getItem(LS_PREFIX + 'currentUser')); }
    catch { return null; }
  },
  setCurrentUser(u) { localStorage.setItem(LS_PREFIX + 'currentUser', JSON.stringify(u)); },
  logout() { localStorage.removeItem(LS_PREFIX + 'currentUser'); },

  // 操作日志
  getLogs() { return this.get('operationLogs', []); },
  addLog(actor, role, action, target='') {
    const logs = this.getLogs();
    logs.push({ id: uid(), actor, role, action, target, time: now() });
    if (logs.length > 2000) logs.splice(0, logs.length - 2000);
    this.set('operationLogs', logs);
  },
  getLogsByTarget(targetId) {
    return this.getLogs().filter(l => l.target === targetId);
  },
};

// ============== 认证（账号密码登录） ==============
const Auth = {
  current() { return Store.getCurrentUser(); },
  isStudent() { return this.current()?.role === 'student'; },
  isMonitor() { return this.current()?.role === 'monitor'; },
  isTeacher() { return this.current()?.role === 'teacher'; },
  canManage() { return this.isMonitor() || this.isTeacher(); },

  // 账号密码登录（学生/班长/班主任通用）
  async login(username, password) {
    const { data, error } = await sb
      .from('users')
      .select('*')
      .eq('username', username)
      .limit(1);
    if (error) { console.error('登录查询失败:', error); return { ok:false, msg:'登录失败，请检查网络' }; }
    const user = data?.[0];
    if (!user) return { ok:false, msg:'账号不存在' };
    // 密码比对（bcrypt）
    const { data: check } = await sb.rpc('check_password', {
      username_arg: username,
      password_arg: password
    });
    if (!check) return { ok:false, msg:'密码错误' };
    // 登录成功
    const sessionUser = {
      role: user.role,
      id: user.stu_no || user.username,
      stuNo: user.stu_no || user.username,
      name: user.name,
      dorm: user.dorm || '',
    };
    Store.setCurrentUser(sessionUser);
    Store.addLog(user.name, user.role, '登录');
    return { ok:true, user: sessionUser };
  },

  // 登录并加载数据后，用学生名单的 id 对齐业务关联（补助/考勤等用名单 id）
  syncUserWithStudents() {
    const u = this.current();
    if (!u || u.role !== 'student') return;
    const stu = Store.getStudentByStuNo(u.stuNo);
    if (stu) {
      const session = { ...u, id: stu.id, dorm: stu.dorm || u.dorm };
      Store.setCurrentUser(session);
    }
  },

  // 登出
  async logout() {
    const u = this.current();
    if (u) Store.addLog(u.name, u.role, '退出登录');
    Store.logout();
    location.hash = '';
    Router.go('');
  },
};

// ============== 路由 ==============
const Router = {
  routes: {},
  register(hash, handler) { this.routes[hash] = handler; },
  go(hash) { location.hash = hash; },
  init() {
    window.addEventListener('hashchange', () => this.dispatch());
    this.dispatch();
  },
  dispatch() {
    const hash = location.hash.slice(1) || '';
    const parts = hash.split('/');
    let handler = this.routes[''];
    let matchedLen = 0;
    // 最长前缀匹配，支持二级/三级路由
    for (let i = parts.length; i >= 0; i--) {
      const key = parts.slice(0, i).join('/');
      if (this.routes[key] !== undefined) { handler = this.routes[key]; matchedLen = i; break; }
    }
    handler(parts.slice(matchedLen));
    window.scrollTo(0,0);
  }
};

// ============== 渲染辅助 ==============
function renderTopbar(title, backHash='', action='') {
  const backBtn = backHash
    ? `<button class="btn-back" onclick="Router.go('${backHash}')">&lsaquo;</button>`
    : `<span class="btn-back"></span>`;
  return `<div class="topbar">${backBtn}<span class="title">${title}</span>${action}</div>`;
}

function renderBottomNav(active='') {
  const u = Auth.current();
  if (!u) return '';
  if (!active) {
    const h = location.hash.slice(1) || '';
    if (h.startsWith('workbench')) active = 'workbench';
    else if (h.startsWith('notify')) active = 'notify';
    else if (h.startsWith('mine')) active = 'mine';
  }
  const items = [
    { key:'workbench', label:'工作台', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 13l9-9 9 9M5 11v10h4v-6h6v6h4V11"/></svg>' },
    { key:'notify', label:'通知', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 16v-5a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2zM10 19a2 2 0 004 0"/></svg>' },
    { key:'mine', label:'我的', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0112 0v1"/></svg>' },
  ];
  return `<div class="bottom-nav">${
    items.map(it => `
      <button class="nav-item ${active===it.key?'active':''}" onclick="Router.go('${it.key}')">
        ${it.icon}<span>${it.label}</span>
      </button>
    `).join('')
  }</div>`;
}

function emptyState(text='') {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 13h6M9 17h6M9 9h6M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1z"/></svg>
    <p>${text || '暂无数据'}</p>
  </div>`;
}

function downloadExcel(filename, data, sheetName='Sheet1') {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function downloadMultiSheet(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => {
    const ws = XLSX.utils.json_to_sheet(s.data);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  XLSX.writeFile(wb, filename);
}

// ============== 模块占位（后续注册） ==============
// 模块将在下方定义后注册到Router

// ============== 应用入口 ==============
document.addEventListener('DOMContentLoaded', () => {
  Router.init();
});

// ============== 角色入口页 ==============
Router.register('', () => {
  // 已登录：先加载云端数据再进工作台（支持刷新）
  if (Auth.current()) {
    (async () => {
      if (!Store.ready) {
        try { await Store.loadAll(); } catch (e) { console.error('加载数据失败', e); }
      }
      Auth.syncUserWithStudents();
      Router.go('workbench');
    })();
    return;
  }
  const app = $('#app');
  app.innerHTML = `
    <div class="role-page">
      <div class="role-logo">2501</div>
      <div class="role-title">${SCHOOL_NAME}</div>
      <div class="role-subtitle">${CLASS_NAME}<br>班级工作台</div>
      <div class="auth-form">
        <div class="form-group">
          <label>登录账号</label>
          <input type="text" id="loginUsername" placeholder="学生用学号 / 班长 / 班主任用账号" autocomplete="username">
        </div>
        <div class="form-group">
          <label>登录密码</label>
          <input type="password" id="loginPassword" placeholder="请输入密码" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-block" id="loginBtn">登 录</button>
        <p class="text-muted text-small text-center mt-12" style="margin-top:16px;">
          数据云端共享 · 全班账号由班长统一管理
        </p>
      </div>
    </div>
  `;
  const doLogin = async () => {
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    if (!username || !password) { toast('请输入账号和密码'); return; }
    const btn = $('#loginBtn');
    btn.disabled = true; btn.textContent = '登录中...';
    const res = await Auth.login(username, password);
    if (res.ok) {
      // 拉取云端全部数据
      try { await Store.loadAll(); } catch (e) { console.error('加载数据失败', e); }
      // 用学生名单 id 对齐（补助/考勤等业务关联）
      Auth.syncUserWithStudents();
      toast('登录成功');
      Router.go('workbench');
    } else {
      toast(res.msg || '登录失败');
      btn.disabled = false; btn.textContent = '登 录';
    }
  };
  $('#loginBtn').onclick = doLogin;
  $('#loginPassword').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
});

// 应用启动：若已登录则自动加载云端数据
Router.register('__boot__', () => {});

// ============== 工作台首页 ==============
Router.register('workbench', () => {
  const u = Auth.current();
  if (!u) { Router.go(''); return; }
  const app = $('#app');
  const reminderHtml = Reminder ? Reminder.renderDashboard(u) : '';
  app.innerHTML = `
    ${renderTopbar(`${CLASS_NAME} · 工作台`, '', `<button class="btn-action" onclick="Auth.logout()">退出</button>`)}
    <div class="page page-with-nav">
      <div class="workbench-header">
        <div class="wh-greeting">你好，${escapeHtml(u.name)}</div>
        <div class="wh-name">${u.role==='student' ? '学生' : u.role==='monitor' ? '班长' : '班主任'}</div>
        <div class="wh-role">${SCHOOL_NAME} · ${CLASS_NAME}</div>
      </div>

      ${reminderHtml}

      <div class="module-grid">
        ${renderModuleItem('notify', '班务通知', '<path d="M18 16v-5a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2zM10 19a2 2 0 004 0"/>')}
        ${renderModuleItem('subsidy', '补助签字', '<path d="M3 7l9-4 9 4M5 8v10h14V8M9 14l2 2 4-4"/>')}
        ${renderModuleItem('tuition', '缴费核对', '<path d="M3 7l9-4 9 4M5 8v10h14V8M9 14l2 2 4-4"/>')}
        ${renderModuleItem('attendance', '考勤管理', '<path d="M9 11l3 3L22 4M21 12v7H3v-7"/>')}
        ${renderModuleItem('leave', '请假审批', '<path d="M9 11H5a2 2 0 00-2 2v7h18v-7a2 2 0 00-2-2h-4M9 5h6v6H9z"/>')}
        ${renderModuleItem('dispute', '纠纷调解', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>')}
        ${renderModuleItem('dorm', '宿舍记录', '<path d="M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10"/>')}
        ${renderModuleItem('ledger', '台账表格', '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>')}
        ${renderModuleItem('log', '操作日志', '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6M8 13h8M8 17h5"/>')}
      </div>
    </div>
    ${renderBottomNav('workbench')}
  `;
  // 更新提醒红点
  if (Reminder) Reminder.updateBadges(u);
});

function renderModuleItem(key, label, iconPath) {
  const badge = getModuleBadge(key);
  return `<div class="module-item ${badge ? 'mi-badge':''}" data-badge="${badge}" onclick="Router.go('${key}')">
    <div class="mi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconPath}</svg></div>
    <div class="mi-label">${label}</div>
  </div>`;
}

function getModuleBadge(key) {
  const u = Auth.current();
  if (!u) return 0;
  switch(key) {
    case 'notify': return 0; // 通知已读红点逻辑后续处理
    case 'subsidy': {
      if (u.role === 'student') {
        const list = Store.get('subsidies', []);
        let cnt = 0;
        list.forEach(t => {
          if (isExpired(t.deadline)) return;
          const item = t.items.find(i => i.stuId === u.id);
          const sign = t.signs.find(s => s.stuId === u.id && s.valid !== false);
          if (item && !sign) cnt++;
        });
        return cnt;
      }
      return 0;
    }
    case 'tuition': {
      if (u.role === 'student') {
        const tuitions = Store.get('tuitions', []);
        const t = tuitions.find(x => x.stuId === u.id);
        if (t && t.payable > 0 && t.paidStatus !== 'confirmed') return 1;
      }
      return 0;
    }
    case 'leave': {
      if (u.role === 'teacher') {
        return Store.get('leaves', []).filter(l => l.status === 'pending').length;
      }
      return 0;
    }
    case 'dorm': {
      if (u.role === 'monitor' || u.role === 'teacher') {
        return Store.get('dorms', []).filter(d => !d.rectify).length;
      }
      return 0;
    }
    default: return 0;
  }
}

// ============== 我的页面 ==============
Router.register('mine', () => {
  const u = Auth.current();
  if (!u) { Router.go(''); return; }
  const app = $('#app');
  let infoHtml = '';
  if (u.role === 'student') {
    infoHtml = `
      <div class="card">
        <div class="card-body">
          <div class="detail-row"><span class="dr-label">姓名</span><span class="dr-value">${escapeHtml(u.name)}</span></div>
          <div class="detail-row"><span class="dr-label">学号</span><span class="dr-value">${escapeHtml(u.stuNo)}</span></div>
          <div class="detail-row"><span class="dr-label">宿舍</span><span class="dr-value">${escapeHtml(u.dorm || '未登记')}</span></div>
        </div>
      </div>`;
  } else {
    infoHtml = `
      <div class="card">
        <div class="card-body">
          <div class="detail-row"><span class="dr-label">身份</span><span class="dr-value">${u.role==='monitor'?'班长':'班主任'}</span></div>
          <div class="detail-row"><span class="dr-label">班级</span><span class="dr-value">${CLASS_NAME}</span></div>
        </div>
      </div>`;
  }
  app.innerHTML = `
    ${renderTopbar('我的', 'workbench')}
    <div class="page page-with-nav">
      <div class="workbench-header">
        <div class="wh-greeting">${escapeHtml(u.name)}</div>
        <div class="wh-name">${u.role==='student' ? '学生' : u.role==='monitor' ? '班长' : '班主任'}</div>
      </div>
      ${infoHtml}
      <div class="card">
        <div class="card-header">快捷功能</div>
        <div class="list-item" onclick="Router.go('notify')">
          <div class="li-main"><div class="li-title">班务通知</div><div class="li-desc">查看所有通知</div></div>
          <span class="li-arrow">&rsaquo;</span>
        </div>
        <div class="list-item" onclick="exportAllData()">
          <div class="li-main"><div class="li-title">导出数据备份</div><div class="li-desc">导出全部数据为Excel/JSON</div></div>
          <span class="li-arrow">&rsaquo;</span>
        </div>
        ${(u.role==='monitor'||u.role==='teacher') ? `
        <div class="list-item" onclick="Router.go('settings')">
          <div class="li-main"><div class="li-title">系统设置</div><div class="li-desc">账号管理、缴费规则、数据管理</div></div>
          <span class="li-arrow">&rsaquo;</span>
        </div>` : ''}
      </div>
      <div style="padding:0 12px;">
        <button class="btn btn-danger btn-block" onclick="Auth.logout()">退出登录</button>
      </div>
    </div>
    ${renderBottomNav('mine')}
  `;
});

function exportAllData() {
  const u = Auth.current();
  if (!u) return;
  const data = {
    config: Store.getConfig(),
    students: Store.getStudents(),
    notifications: Store.get('notifications', []),
    subsidies: Store.get('subsidies', []),
    tuitions: Store.get('tuitions', []),
    attendances: Store.get('attendances', []),
    leaves: Store.get('leaves', []),
    disputes: Store.get('disputes', []),
    dorms: Store.get('dorms', []),
    operationLogs: Store.getLogs(),
    exportTime: now(),
    exporter: u.name,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `计网2501班_数据备份_${todayStr()}.json`;
  a.click();
  toast('已导出备份文件');
}

// ============== 通知页占位（后续完整实现） ==============
Router.register('notify', () => Notifications.renderList());
Router.register('notify/detail', (p) => Notifications.renderDetail(p[0]));

// ============== 我的通知页（底部tab入口） ==============
// notify tab也跳转到通知列表

// ============================================================
// 模块1：班务通知
// ============================================================
const Notifications = {
  getList() { return Store.get('notifications', []); },
  save(list) { Store.set('notifications', list); },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    const list = this.getList().sort((a,b) => b.publishTime.localeCompare(a.publishTime));
    const app = $('#app');
    const canPublish = u.role === 'monitor' || u.role === 'teacher';
    app.innerHTML = `
      ${renderTopbar('班务通知', 'workbench', canPublish ? `<button class="btn-action" onclick="Notifications.showPublish()">发布</button>` : '')}
      <div class="page page-with-nav">
        <div class="search-bar"><input type="search" id="searchNotify" placeholder="搜索通知标题或内容" oninput="Notifications.filterList(this.value)"></div>
        <div id="notifyList">${this.renderListItems(list, u)}</div>
      </div>
      ${renderBottomNav('notify')}
    `;
  },

  renderListItems(list, u) {
    if (!list.length) return emptyState('暂无通知');
    return list.map(n => {
      const read = n.reads?.some(r => r.stuId === u.id);
      return `
        <div class="card" onclick="Router.go('notify/detail/${n.id}')">
          <div class="card-body">
            <div class="flex-between">
              <span class="li-title" style="font-weight:${read?400:600}">${escapeHtml(n.title)}</span>
              ${read ? '<span class="tag tag-gray">已读</span>' : '<span class="tag tag-primary">未读</span>'}
            </div>
            <div class="li-meta">${escapeHtml(n.publisher)} · ${fmtDateShort(n.publishTime)}</div>
            ${n.images?.length ? `<div class="text-small text-muted mt-8">[图片${n.images.length}]</div>`:''}
            ${n.files?.length ? `<div class="text-small text-muted">[附件${n.files.length}]</div>`:''}
            ${n.qr ? `<div class="text-small text-muted">[二维码]</div>`:''}
          </div>
        </div>`;
    }).join('');
  },

  filterList(kw) {
    const u = Auth.current();
    const list = this.getList().filter(n =>
      !kw || n.title.includes(kw) || n.content.includes(kw)
    ).sort((a,b) => b.publishTime.localeCompare(a.publishTime));
    $('#notifyList').innerHTML = this.renderListItems(list, u);
  },

  renderDetail(id) {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    const n = this.getList().find(x => x.id === id);
    if (!n) { toast('通知不存在'); Router.go('notify'); return; }
    // 自动标记已读（学生）
    if (u.role === 'student' && !n.reads?.some(r => r.stuId === u.id)) {
      n.reads = n.reads || [];
      n.reads.push({ stuId:u.id, name:u.name, time:now() });
      this.save(this.getList());
      Store.addLog(u.name, 'student', '查看通知', n.id);
    }
    const app = $('#app');
    const readCount = n.reads?.length || 0;
    const totalStudents = Store.getStudents().length;
    app.innerHTML = `
      ${renderTopbar('通知详情', 'notify')}
      <div class="page page-with-nav">
        <div class="card">
          <div class="card-body">
            <h2 style="font-size:1.1rem;margin-bottom:8px;">${escapeHtml(n.title)}</h2>
            <div class="text-muted text-small">发布人：${escapeHtml(n.publisher)}（${n.role==='monitor'?'班长':'班主任'}）</div>
            <div class="text-muted text-small">时间：${fmtDate(n.publishTime, true)}</div>
            ${canManage() ? `<div class="text-small mt-8"><span class="tag tag-info">已读 ${readCount}/${totalStudents}</span></div>`:''}
          </div>
        </div>
        <div class="card">
          <div class="card-body">
            <div style="white-space:pre-wrap;font-size:0.9rem;line-height:1.7;">${escapeHtml(n.content)}</div>
          </div>
        </div>
        ${n.images?.length ? `<div class="card"><div class="card-header">图片</div><div class="card-body"><div class="img-preview-list">${
          n.images.map((img,i) => `<div class="ip-item" onclick="previewImage('${img}')"><img src="${img}"></div>`).join('')
        }</div></div></div>`:''}
        ${n.qr ? `<div class="card"><div class="card-header">二维码</div><div class="card-body qr-display" id="qrBox"></div></div>`:''}
        ${n.files?.length ? `<div class="card"><div class="card-header">附件</div><div class="card-body">${
          n.files.map(f => `<div class="list-item" onclick="downloadFile('${f.data}','${escapeHtml(f.name)}')"><div class="li-main"><div class="li-title">${escapeHtml(f.name)}</div></div><span class="li-arrow">⬇</span></div>`).join('')
        }</div></div>`:''}
        <div class="card">
          <div class="card-header">已读确认</div>
          <div class="card-body">
            ${u.role === 'student' ? (n.reads?.some(r=>r.stuId===u.id)
              ? '<span class="tag tag-success">您已确认阅读</span>'
              : `<button class="btn btn-primary" onclick="Notifications.confirmRead('${n.id}')">确认已读</button>`)
              : `<div class="text-small text-muted">已确认 ${readCount} 人</div>${this.renderReadList(n.reads||[])}`}
          </div>
        </div>
      <        </div>
      </div>
    </div>
    ${renderBottomNav('notify')}
  `;
    if (n.qr) {
      // 生成二维码
      try {
        new QRCode($('#qrBox'), { text:n.qr, width:180, height:180 });
      } catch { $('#qrBox').innerHTML = `<div class="text-small">${escapeHtml(n.qr)}</div>`; }
    }
  },

  renderReadList(reads) {
    if (!reads.length) return '<div class="text-muted text-small">暂无已读记录</div>';
    return reads.map(r => `<div class="text-small">${escapeHtml(r.name||'')} · ${fmtDate(r.time, true)}</div>`).join('');
  },

  async confirmRead(id) {
    const list = this.getList();
    const n = list.find(x => x.id === id);
    if (!n) return;
    const u = Auth.current();
    n.reads = n.reads || [];
    if (n.reads.some(r => r.stuId === u.id)) { toast('您已确认过'); return; }
    n.reads.push({ stuId:u.id, name:u.name, time:now() });
    this.save(list);
    Store.addLog(u.name, 'student', '确认阅读通知', n.id);
    toast('已确认');
    this.renderDetail(id);
  },

  showPublish() {
    const u = Auth.current();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>发布通知</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>通知标题</label><input type="text" id="ntTitle" placeholder="请输入标题"></div>
          <div class="form-group"><label>通知内容</label><textarea id="ntContent" placeholder="请输入通知正文"></textarea></div>
          <div class="form-group"><label>二维码内容（可选）</label><input type="text" id="ntQr" placeholder="输入文字/链接生成二维码"></div>
          <div class="form-group"><label>图片（可选）</label><input type="file" id="ntImages" accept="image/*" multiple></div>
          <div class="form-group"><label>附件（可选）</label><input type="file" id="ntFiles" multiple></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="ntPublishBtn">发布</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#ntPublishBtn').onclick = async () => {
      const title = overlay.querySelector('#ntTitle').value.trim();
      const content = overlay.querySelector('#ntContent').value.trim();
      if (!title || !content) { toast('请填写标题和内容'); return; }
      const qr = overlay.querySelector('#ntQr').value.trim();
      const imgFiles = [...overlay.querySelector('#ntImages').files];
      const fileFiles = [...overlay.querySelector('#ntFiles').files];
      const images = [];
      for (const f of imgFiles) {
        if (f.size > 2*1024*1024) { toast(`图片${f.name}超过2MB`); return; }
        images.push(await fileToBase64(f));
      }
      const files = [];
      for (const f of fileFiles) {
        if (f.size > 5*1024*1024) { toast(`附件${f.name}超过5MB`); return; }
        files.push({ name:f.name, data: await fileToBase64(f) });
      }
      const list = this.getList();
      const n = {
        id: uid(), title, content, qr,
        images, files,
        publisher: u.name, role: u.role,
        publishTime: now(), reads: [],
      };
      list.push(n);
      this.save(list);
      Store.addLog(u.name, u.role, '发布通知', n.id);
      overlay.remove();
      toast('发布成功');
      this.renderList();
    };
  },
};

function previewImage(src) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.alignItems = 'center';
  overlay.innerHTML = `<div style="max-width:90%;max-height:80vh;"><img src="${src}" style="width:100%;border-radius:8px;"></div>`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function downloadFile(dataUrl, name) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}

function canManage() { return Auth.canManage(); }

// ============================================================
// 模块2：补助签字确认（防代签）
// ============================================================
const Subsidy = {
  getList() { return Store.get('subsidies', []); },
  save(list) { Store.set('subsidies', list); },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    const list = this.getList().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const app = $('#app');
    const canImport = u.role === 'monitor';
    app.innerHTML = `
      ${renderTopbar('补助签字', 'workbench', canImport ? `<button class="btn-action" onclick="Subsidy.showImport()">导入</button>` : '')}
      <div class="page page-with-nav">
        <div id="subsidyList">${this.renderListItems(list, u)}</div>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderListItems(list, u) {
    if (!list.length) return emptyState('暂无补助签字任务');
    return list.map(t => {
      const expired = isExpired(t.deadline);
      const total = t.items.length;
      const signed = t.signs.filter(s => s.valid !== false).length;
      const mySign = t.signs.find(s => s.stuId === u.id);
      const myItem = t.items.find(i => i.stuId === u.id);
      let myStatus = '';
      if (u.role === 'student' && myItem) {
        if (mySign?.valid === false) myStatus = '<span class="tag tag-danger">已作废</span>';
        else if (mySign) myStatus = '<span class="tag tag-success">已签字</span>';
        else if (expired) myStatus = '<span class="tag tag-gray">已截止</span>';
        else myStatus = '<span class="tag tag-warning">待签字</span>';
      }
      return `
        <div class="card" onclick="Router.go('subsidy/detail/${t.id}')">
          <div class="card-body">
            <div class="flex-between">
              <span class="li-title fw-600">${escapeHtml(t.title)}</span>
              ${expired ? '<span class="tag tag-gray">已截止</span>' : '<span class="tag tag-warning">进行中</span>'}
            </div>
            <div class="li-meta">截止：${fmtDate(t.deadline, true)}</div>
            <div class="li-meta">签字进度：${signed}/${total}</div>
            <div class="progress-bar"><div class="pb-fill" style="width:${total?signed/total*100:0}%"></div></div>
            ${myStatus ? `<div class="mt-8">${myStatus}</div>`:''}
          </div>
        </div>`;
    }).join('');
  },

  renderDetail(id) {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    const t = this.getList().find(x => x.id === id);
    if (!t) { toast('任务不存在'); Router.go('subsidy'); return; }
    const expired = isExpired(t.deadline);
    const signed = t.signs.filter(s => s.valid !== false);
    const signedCount = signed.length;
    const total = t.items.length;
    const mySign = t.signs.find(s => s.stuId === u.id);
    const myItem = t.items.find(i => i.stuId === u.id);

    let actionHtml = '';
    if (u.role === 'student' && myItem && !mySign && !expired) {
      actionHtml = `<button class="btn btn-primary btn-block mt-8" onclick="Subsidy.showSign('${t.id}')">电子签字</button>`;
    } else if (u.role === 'student' && myItem && mySign && mySign.valid !== false) {
      actionHtml = `<div class="text-center text-success text-small mt-8">您已签字 · ${fmtDate(mySign.time, true)}</div>`;
    } else if (u.role === 'student' && myItem && mySign?.valid === false) {
      actionHtml = `<div class="text-center text-danger text-small mt-8">您的签字已被判定无效（疑似代签）</div>`;
    }

    let manageHtml = '';
    if (u.role === 'monitor' || u.role === 'teacher') {
      manageHtml = `
        <div class="card">
          <div class="card-header">签字明细</div>
          <div class="card-body" style="padding:0;">
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>姓名</th><th>金额</th><th>状态</th><th>签字时间</th>${u.role==='monitor'?'<th>操作</th>':''}</tr></thead>
                <tbody>
                  ${t.items.map(item => {
                    const s = t.signs.find(x => x.stuId === item.stuId);
                    let st = '<span class="tag tag-gray">未签</span>';
                    let time = '-';
                    let op = '';
                    if (s?.valid === false) { st = '<span class="tag tag-danger">无效</span>'; time = fmtDate(s.time, true); }
                    else if (s) { st = '<span class="tag tag-success">已签</span>'; time = fmtDate(s.time, true); }
                    if (u.role === 'monitor' && s && s.valid !== false) {
                      op = `<button class="btn btn-sm btn-outline" onclick="Subsidy.invalidate('${t.id}','${item.stuId}')">作废(代签)</button>`;
                    }
                    const stu = Store.getStudent(item.stuId);
                    return `<tr><td>${escapeHtml(stu?.name || item.stuId)}</td><td>${item.amount}</td><td>${st}</td><td>${time}</td>${u.role==='monitor'?`<td>${op}</td>`:''}</tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        ${u.role === 'monitor' ? `<button class="btn btn-outline btn-block" style="margin:0 12px;max-width:calc(100% - 24px);" onclick="Subsidy.export('${t.id}')">导出Excel归档</button>`:''}
      `;
    }

    $('#app').innerHTML = `
      ${renderTopbar('补助签字详情', 'subsidy')}
      <div class="page page-with-nav">
        <div class="card">
          <div class="card-body">
            <h2 style="font-size:1.1rem;margin-bottom:6px;">${escapeHtml(t.title)}</h2>
            <div class="text-muted text-small">截止时间：${fmtDate(t.deadline, true)} ${expired?'(已截止)':''}</div>
            <div class="text-muted text-small">导入人：${escapeHtml(t.creator)} · ${fmtDate(t.createdAt, true)}</div>
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat-card"><div class="sc-num">${signedCount}</div><div class="sc-label">已签字</div></div>
          <div class="stat-card"><div class="sc-num">${total - signedCount}</div><div class="sc-label">未签字</div></div>
        </div>
        ${u.role === 'student' && myItem ? `
          <div class="card">
            <div class="card-header">我的补助明细</div>
            <div class="card-body">
              <div class="detail-row"><span class="dr-label">姓名</span><span class="dr-value">${escapeHtml(u.name)}</span></div>
              <div class="detail-row"><span class="dr-label">补助金额</span><span class="dr-value">¥${myItem.amount}</span></div>
              <div class="detail-row"><span class="dr-label">签字状态</span><span class="dr-value">${mySign?.valid===false?'<span class="text-danger">无效</span>':mySign?'<span class="text-success">已签字</span>':'<span class="text-warning">未签字</span>'}</span></div>
            </div>
          </div>
          ${actionHtml}
        `:''}
        ${manageHtml}
      </div>
      ${renderBottomNav()}
    `;
  },

  showImport() {
    const u = Auth.current();
    if (u.role !== 'monitor') { toast('无权限'); return; }
    const students = Store.getStudents();
    if (!students.length) { toast('请先导入学生名单'); Router.go('ledger'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>导入补助明细</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>任务标题</label><input type="text" id="sbTitle" placeholder="如：2025秋季补助发放签字"></div>
          <div class="form-group"><label>截止时间</label><input type="datetime-local" id="sbDeadline"></div>
          <div class="form-group">
            <label>导入方式</label>
            <div class="seg-control" style="margin:0;">
              <button class="seg-item active" data-mode="manual" onclick="Subsidy.toggleImportMode('manual')">手动录入</button>
              <button class="seg-item" data-mode="excel" onclick="Subsidy.toggleImportMode('excel')">Excel导入</button>
            </div>
          </div>
          <div id="sbManualBox">
            <p class="text-muted text-small mb-8">从学生名单中选择并填入金额</p>
            <div id="sbStudentList" style="max-height:300px;overflow-y:auto;">
              ${students.map(s => `
                <div class="flex gap-8 mb-8" style="align-items:center;">
                  <span style="width:90px;font-size:0.85rem;">${escapeHtml(s.name)}</span>
                  <input type="number" placeholder="金额" data-stuid="${s.id}" style="flex:1;padding:6px;border:1px solid var(--gray-3);border-radius:6px;">
                </div>
              `).join('')}
            </div>
          </div>
          <div id="sbExcelBox" class="hidden">
            <p class="text-muted text-small mb-8">Excel需包含列：学号/姓名/金额</p>
            <input type="file" id="sbExcelFile" accept=".xlsx,.xls" class="btn btn-outline btn-block">
            <div id="sbExcelPreview"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="sbImportBtn">创建签字任务</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    let importMode = 'manual';
    let excelData = null;
    window._subsidyImportMode = (m) => {
      importMode = m;
      overlay.querySelectorAll('.seg-item').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
      overlay.querySelector('#sbManualBox').classList.toggle('hidden', m !== 'manual');
      overlay.querySelector('#sbExcelBox').classList.toggle('hidden', m !== 'excel');
    };
    this.toggleImportMode = window._subsidyImportMode;
    overlay.querySelector('#sbExcelFile').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const data = await this.parseExcel(file);
      excelData = data;
      const preview = overlay.querySelector('#sbExcelPreview');
      preview.innerHTML = `<p class="text-small text-success">已解析 ${data.length} 条记录</p>`;
    };
    overlay.querySelector('#sbImportBtn').onclick = () => {
      const title = overlay.querySelector('#sbTitle').value.trim();
      const deadline = overlay.querySelector('#sbDeadline').value;
      if (!title) { toast('请填写标题'); return; }
      if (!deadline) { toast('请设置截止时间'); return; }
      let items = [];
      if (importMode === 'manual') {
        const inputs = overlay.querySelectorAll('#sbStudentList input');
        inputs.forEach(inp => {
          const val = parseFloat(inp.value);
          if (!isNaN(val) && val > 0) items.push({ stuId: inp.dataset.stuid, amount: val });
        });
        if (!items.length) { toast('请至少填入一条金额'); return; }
      } else {
        if (!excelData?.length) { toast('请先导入Excel'); return; }
        items = excelData;
      }
      const list = this.getList();
      const t = {
        id: uid(), title, deadline: new Date(deadline).toISOString(),
        items, signs: [], creator: u.name, createdAt: now(),
      };
      list.push(t);
      this.save(list);
      Store.addLog(u.name, u.role, '导入补助明细', t.id);
      overlay.remove();
      toast('签字任务已创建');
      this.renderList();
    };
  },

  async parseExcel(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target.result, { type:'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
        const items = [];
        rows.forEach(r => {
          const stuNo = String(r['学号'] || r['学号 '] || r.stuNo || '').trim();
          const name = String(r['姓名'] || r.name || '').trim();
          const amount = parseFloat(r['金额'] || r.amount || 0);
          if (!stuNo && !name) return;
          let stu = Store.getStudentByStuNo(stuNo);
          if (!stu && name) stu = Store.getStudents().find(s => s.name === name);
          if (stu && !isNaN(amount)) items.push({ stuId: stu.id, amount });
        });
        resolve(items);
      };
      reader.readAsArrayBuffer(file);
    });
  },

  showSign(taskId) {
    const u = Auth.current();
    if (u.role !== 'student') { toast('仅学生可签字'); return; }
    const t = this.getList().find(x => x.id === taskId);
    if (!t) return;
    if (isExpired(t.deadline)) { toast('已截止，无法签字'); return; }
    const myItem = t.items.find(i => i.stuId === u.id);
    if (!myItem) { toast('您不在本补助名单中'); return; }
    const mySign = t.signs.find(s => s.stuId === u.id);
    if (mySign && mySign.valid !== false) { toast('您已签字'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>电子签字</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="detail-row"><span class="dr-label">姓名</span><span class="dr-value">${escapeHtml(u.name)}</span></div>
          <div class="detail-row"><span class="dr-label">学号</span><span class="dr-value">${escapeHtml(u.stuNo)}</span></div>
          <div class="detail-row"><span class="dr-label">补助金额</span><span class="dr-value">¥${myItem.amount}</span></div>
          <div class="mt-8 text-small text-muted">请在下方手写签名确认（本人签字，禁止代签）：</div>
          <div class="sign-canvas-wrap">
            <canvas id="signCanvas" width="280" height="140" style="width:100%;background:#fafafa;border-radius:6px;"></canvas>
          </div>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-gray" onclick="clearSignCanvas()">清除重写</button>
          </div>
          <p class="text-small text-danger mt-8">⚠ 代签、冒签一经发现，记录直接作废</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="sbSignBtn">确认签字</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    initSignCanvas(overlay.querySelector('#signCanvas'));
    overlay.querySelector('#sbSignBtn').onclick = () => {
      const signData = getSignData();
      if (!signData) { toast('请先手写签名'); return; }
      const list = this.getList();
      const t2 = list.find(x => x.id === taskId);
      // 移除旧的作废签字（如果有）
      t2.signs = t2.signs.filter(s => s.stuId !== u.id);
      t2.signs.push({
        stuId: u.id, name: u.name,
        sign: signData, time: now(),
        device: getDeviceFingerprint(), valid: true,
      });
      this.save(list);
      Store.addLog(u.name, 'student', '补助电子签字', t2.id);
      overlay.remove();
      toast('签字成功');
      this.renderDetail(taskId);
    };
  },

  invalidate(taskId, stuId) {
    const u = Auth.current();
    if (u.role !== 'monitor') { toast('无权限'); return; }
    const list = this.getList();
    const t = list.find(x => x.id === taskId);
    const s = t.signs.find(x => x.stuId === stuId);
    if (!s) return;
    promptDialog('作废原因', '请输入作废原因（如代签）').then(reason => {
      if (!reason) return;
      s.valid = false;
      s.invalidReason = reason;
      s.invalidBy = u.name;
      s.invalidTime = now();
      this.save(list);
      const stu = Store.getStudent(stuId);
      Store.addLog(u.name, u.role, `作废签字(${reason})`, `${taskId}/${stuId}`);
      toast('已作废该签字');
      this.renderDetail(taskId);
    });
  },

  export(taskId) {
    const u = Auth.current();
    if (u.role !== 'monitor' && u.role !== 'teacher') { toast('无权限'); return; }
    const t = this.getList().find(x => x.id === taskId);
    if (!t) return;
    const data = t.items.map(item => {
      const stu = Store.getStudent(item.stuId);
      const sign = t.signs.find(s => s.stuId === item.stuId);
      return {
        '学号': stu?.stuNo || '',
        '姓名': stu?.name || '',
        '补助金额': item.amount,
        '签字状态': sign?.valid === false ? '无效' : (sign ? '已签' : '未签'),
        '签字时间': sign ? fmtDate(sign.time, true) : '',
        '作废原因': sign?.invalidReason || '',
        '作废人': sign?.invalidBy || '',
      };
    });
    downloadExcel(`补助签字_${t.title}_${todayStr()}.xlsx`, data, '补助签字');
    Store.addLog(u.name, u.role, '导出补助签字', t.id);
    toast('已导出');
  },
};

// 手写签字canvas
let _signCtx = null;
let _signDrawing = false;
let _signHasContent = false;
function initSignCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  _signCtx = ctx;
  _signHasContent = false;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#2c3e50';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let lastX = 0, lastY = 0;
  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const t = e.touches ? e.touches[0] : e;
    return { x:(t.clientX - rect.left)*scale, y:(t.clientY - rect.top)*scale };
  };
  const start = (e) => { e.preventDefault(); const p=getPos(e); lastX=p.x; lastY=p.y; _signDrawing=true; _signHasContent=true; };
  const move = (e) => {
    if (!_signDrawing) return; e.preventDefault();
    const p = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastX,lastY); ctx.lineTo(p.x,p.y); ctx.stroke();
    lastX=p.x; lastY=p.y;
  };
  const end = () => { _signDrawing = false; };
  canvas.onmousedown = start; canvas.onmousemove = move; canvas.onmouseup = end; canvas.onmouseleave = end;
  canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;
}
function clearSignCanvas() {
  const c = $('#signCanvas'); if (!c) return;
  c.getContext('2d').clearRect(0,0,c.width,c.height);
  _signHasContent = false;
}
function getSignData() {
  if (!_signHasContent) return null;
  const c = $('#signCanvas');
  return c.toDataURL('image/png');
}
function getDeviceFingerprint() {
  const nav = navigator;
  return btoa([
    nav.userAgent, nav.language, screen.width+'x'+screen.height,
    new Date().getTimezoneOffset(), nav.hardwareConcurrency||0,
  ].join('|')).slice(0,32);
}

// ============================================================
// 模块3：学费住宿费缴费核对
// ============================================================
const Tuition = {
  getList() { return Store.get('tuitions', []); },
  save(list) { Store.set('tuitions', list); },
  getRecord(stuId) { return this.getList().find(t => t.stuId === stuId); },

  // 缴费规则引擎
  calcPayable(loanAmount) {
    const cfg = Store.getConfig();
    const loan = Number(loanAmount) || 0;
    if (loan >= cfg.tuitionFull) return { payable: 0, type: '免缴', desc: '贷款≥5800，无需缴费' };
    if (loan <= 0) return { payable: cfg.tuitionFull, type: '全额', desc: '未申请贷款，全额缴费5800' };
    return { payable: cfg.tuitionFee, type: '可选', desc: '贷款<5800，可缴学费5000或住宿费800', optional: true };
  },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    const app = $('#app');
    if (u.role === 'student') {
      this.renderStudentView(u);
    } else {
      this.renderManageView(u);
    }
  },

  renderStudentView(u) {
    let t = this.getRecord(u.id);
    if (!t) {
      // 自动初始化（学生首次进入）
      t = { stuId:u.id, loanAmount:0, payable:this.calcPayable(0).payable, qrcode:'', paidProof:'', paidStatus:'unpaid', createdAt:now() };
      const list = this.getList();
      list.push(t);
      this.save(list);
    }
    const cfg = Store.getConfig();
    const rule = this.calcPayable(t.loanAmount);
    const qr = Store.get('tuitionQrcode', '');
    const app = $('#app');
    let statusTag = '';
    if (t.paidStatus === 'confirmed') statusTag = '<span class="tag tag-success">已确认</span>';
    else if (t.paidProof) statusTag = '<span class="tag tag-warning">待核对</span>';
    else if (rule.payable === 0) statusTag = '<span class="tag tag-info">无需缴费</span>';
    else statusTag = '<span class="tag tag-danger">未缴费</span>';

    app.innerHTML = `
      ${renderTopbar('缴费核对', 'workbench')}
      <div class="page page-with-nav">
        <div class="card">
          <div class="card-header">缴费状态 ${statusTag}</div>
          <div class="card-body">
            <div class="detail-row"><span class="dr-label">姓名</span><span class="dr-value">${escapeHtml(u.name)}</span></div>
            <div class="detail-row"><span class="dr-label">学号</span><span class="dr-value">${escapeHtml(u.stuNo)}</span></div>
            <div class="detail-row"><span class="dr-label">贷款金额</span><span class="dr-value">¥${t.loanAmount || 0}</span></div>
            <div class="detail-row"><span class="dr-label">应缴金额</span><span class="dr-value text-danger fw-600">¥${rule.payable}</span></div>
            <div class="detail-row"><span class="dr-label">缴费类型</span><span class="dr-value">${rule.desc}</span></div>
            ${t.paidProof ? `<div class="detail-row"><span class="dr-label">缴费凭证</span><span class="dr-value"><img src="${t.paidProof}" style="max-width:150px;border-radius:6px;"></span></div>`:''}
            ${t.checker ? `<div class="detail-row"><span class="dr-label">核对人</span><span class="dr-value">${escapeHtml(t.checker)} · ${fmtDate(t.checkTime,true)}</span></div>`:''}
            ${t.remark ? `<div class="detail-row"><span class="dr-label">备注</span><span class="dr-value">${escapeHtml(t.remark)}</span></div>`:''}
          </div>
        </div>
        ${rule.payable > 0 && t.paidStatus !== 'confirmed' ? `
          ${qr ? `<div class="card"><div class="card-header">缴费二维码</div><div class="card-body qr-display"><img src="${qr}" style="width:200px;"></div></div>`:''}
          <div class="card">
            <div class="card-header">提交缴费凭证</div>
            <div class="card-body">
              ${t.paidProof ? '<p class="text-small text-success mb-8">已提交凭证，等待班长核对</p>' : '<p class="text-small text-muted mb-8">请缴费后截图上传凭证</p>'}
              <input type="file" id="tuProof" accept="image/*" class="btn btn-outline btn-block mb-8">
              <button class="btn btn-primary btn-block" onclick="Tuition.uploadProof()">提交凭证</button>
            </div>
          </div>
        ` : (rule.payable === 0 ? '<div class="card"><div class="card-body text-center text-success">您无需缴费</div></div>' : '')}
      </div>
      ${renderBottomNav()}
    `;
  },

  async uploadProof() {
    const u = Auth.current();
    const file = $('#tuProof').files[0];
    if (!file) { toast('请选择凭证图片'); return; }
    if (file.size > 3*1024*1024) { toast('图片超过3MB'); return; }
    const data = await fileToBase64(file);
    const list = this.getList();
    let t = list.find(x => x.stuId === u.id);
    if (!t) { t = { stuId:u.id, loanAmount:0, payable:0, paidStatus:'unpaid', createdAt:now() }; list.push(t); }
    t.paidProof = data;
    t.paidStatus = 'pending';
    t.proofTime = now();
    this.save(list);
    Store.addLog(u.name, 'student', '提交缴费凭证', u.id);
    toast('凭证已提交');
    this.renderList();
  },

  renderManageView(u) {
    const students = Store.getStudents();
    const tuitions = this.getList();
    const qr = Store.get('tuitionQrcode', '');
    let stats = { total:students.length, confirmed:0, pending:0, unpaid:0, exempt:0 };
    students.forEach(s => {
      const t = tuitions.find(x => x.stuId === s.id);
      if (!t) { stats.unpaid++; return; }
      const rule = this.calcPayable(t.loanAmount);
      if (t.paidStatus === 'confirmed') stats.confirmed++;
      else if (t.paidProof) stats.pending++;
      else if (rule.payable === 0) stats.exempt++;
      else stats.unpaid++;
    });

    $('#app').innerHTML = `
      ${renderTopbar('缴费核对', 'workbench', `<button class="btn-action" onclick="Tuition.showManage()">管理</button>`)}
      <div class="page page-with-nav">
        <div class="stat-grid">
          <div class="stat-card"><div class="sc-num">${stats.confirmed}</div><div class="sc-label">已确认</div></div>
          <div class="stat-card"><div class="sc-num">${stats.pending}</div><div class="sc-label">待核对</div></div>
          <div class="stat-card"><div class="sc-num">${stats.unpaid}</div><div class="sc-label">未缴费</div></div>
          <div class="stat-card"><div class="sc-num">${stats.exempt}</div><div class="sc-label">免缴</div></div>
        </div>
        <div class="search-bar"><input type="search" id="searchTuition" placeholder="搜索学生姓名/学号" oninput="Tuition.filterManage(this.value)"></div>
        <div id="tuitionManageList">${this.renderManageItems(students, tuitions, '')}</div>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderManageItems(students, tuitions, kw) {
    const filtered = kw ? students.filter(s => s.name.includes(kw) || s.stuNo.includes(kw)) : students;
    if (!filtered.length) return emptyState('暂无学生');
    return filtered.map(s => {
      const t = tuitions.find(x => x.stuId === s.id) || { paidStatus:'unpaid', loanAmount:0 };
      const rule = this.calcPayable(t.loanAmount);
      let tag = '';
      if (t.paidStatus === 'confirmed') tag = '<span class="tag tag-success">已确认</span>';
      else if (t.paidProof) tag = '<span class="tag tag-warning">待核对</span>';
      else if (rule.payable === 0) tag = '<span class="tag tag-info">免缴</span>';
      else tag = '<span class="tag tag-danger">未缴费</span>';
      return `
        <div class="card" onclick="Tuition.showStudentDetail('${s.id}')">
          <div class="card-body">
            <div class="flex-between">
              <div>
                <div class="li-title">${escapeHtml(s.name)} <span class="text-muted text-small">${escapeHtml(s.stuNo)}</span></div>
                <div class="li-meta">贷款 ¥${t.loanAmount||0} · 应缴 ¥${rule.payable}</div>
              </div>
              ${tag}
            </div>
          </div>
        </div>`;
    }).join('');
  },

  filterManage(kw) {
    $('#tuitionManageList').innerHTML = this.renderManageItems(Store.getStudents(), this.getList(), kw);
  },

  showStudentDetail(stuId) {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const s = Store.getStudent(stuId);
    const list = this.getList();
    let t = list.find(x => x.stuId === stuId);
    if (!t) { t = { stuId, loanAmount:0, paidStatus:'unpaid', createdAt:now() }; list.push(t); this.save(list); }
    const rule = this.calcPayable(t.loanAmount);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>${escapeHtml(s.name)} - 缴费详情</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>助学贷款金额</label><input type="number" id="tdLoan" value="${t.loanAmount||0}" placeholder="0表示未申请"></div>
          <div class="detail-row"><span class="dr-label">应缴金额</span><span class="dr-value text-danger fw-600">¥${rule.payable}</span></div>
          <div class="detail-row"><span class="dr-label">缴费类型</span><span class="dr-value">${rule.desc}</span></div>
          <div class="detail-row"><span class="dr-label">凭证状态</span><span class="dr-value">${t.paidProof?'已提交':'未提交'}</span></div>
          ${t.paidProof ? `<div class="detail-row"><span class="dr-label">凭证图片</span><span class="dr-value"><img src="${t.paidProof}" style="max-width:150px;border-radius:6px;"></span></div>`:''}
          <div class="form-group"><label>备注（异常登记）</label><input type="text" id="tdRemark" value="${escapeHtml(t.remark||'')}" placeholder="如信息错误、贷款异常"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
          <button class="btn btn-outline" style="flex:1;" id="tdSaveLoan">保存贷款</button>
          ${t.paidProof && t.paidStatus !== 'confirmed' ? `<button class="btn btn-primary" style="flex:1;" id="tdConfirm">确认缴费</button>`:''}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#tdSaveLoan').onclick = () => {
      const loan = parseFloat(overlay.querySelector('#tdLoan').value) || 0;
      const remark = overlay.querySelector('#tdRemark').value.trim();
      const list2 = this.getList();
      const t2 = list2.find(x => x.stuId === stuId);
      t2.loanAmount = loan;
      t2.remark = remark;
      const r = this.calcPayable(loan);
      t2.payable = r.payable;
      this.save(list2);
      Store.addLog(u.name, u.role, '修改缴费信息', stuId);
      toast('已保存');
      overlay.remove();
      this.renderList();
    };
    if (overlay.querySelector('#tdConfirm')) {
      overlay.querySelector('#tdConfirm').onclick = () => {
        const list2 = this.getList();
        const t2 = list2.find(x => x.stuId === stuId);
        t2.paidStatus = 'confirmed';
        t2.checker = u.name;
        t2.checkTime = now();
        this.save(list2);
        Store.addLog(u.name, u.role, '确认缴费', stuId);
        toast('已确认');
        overlay.remove();
        this.renderList();
      };
    }
  },

  showManage() {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const qr = Store.get('tuitionQrcode', '');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>缴费管理</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>班级缴费二维码（学生可见）</label><input type="file" id="mgQr" accept="image/*"></div>
          ${qr ? `<div class="text-center mb-8"><img src="${qr}" style="max-width:180px;border-radius:6px;"></div>`:''}
          <button class="btn btn-outline btn-block mb-12" onclick="Tuition.uploadQr()">上传二维码</button>
          <button class="btn btn-primary btn-block" onclick="Tuition.export()">导出全班缴费台账</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    this._qrInput = overlay.querySelector('#mgQr');
  },

  async uploadQr() {
    const file = this._qrInput?.files[0];
    if (!file) { toast('请选择图片'); return; }
    const data = await fileToBase64(file);
    Store.set('tuitionQrcode', data);
    Store.addLog(Auth.current().name, Auth.current().role, '上传缴费二维码');
    toast('已上传');
    this.showManage();
    const overlay = $('.modal-overlay');
    if (overlay) overlay.remove();
  },

  export() {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const students = Store.getStudents();
    const tuitions = this.getList();
    const data = students.map(s => {
      const t = tuitions.find(x => x.stuId === s.id) || {};
      const rule = this.calcPayable(t.loanAmount);
      let status = '未缴费';
      if (t.paidStatus === 'confirmed') status = '已确认';
      else if (t.paidProof) status = '待核对';
      else if (rule.payable === 0) status = '免缴';
      return {
        '学号': s.stuNo,
        '姓名': s.name,
        '贷款金额': t.loanAmount || 0,
        '应缴金额': rule.payable,
        '缴费类型': rule.type,
        '缴费状态': status,
        '核对人': t.checker || '',
        '核对时间': t.checkTime ? fmtDate(t.checkTime, true) : '',
        '备注': t.remark || '',
      };
    });
    downloadExcel(`缴费台账_${todayStr()}.xlsx`, data, '缴费核对');
    Store.addLog(u.name, u.role, '导出缴费台账');
    toast('已导出');
  },
};

// 路由注册
Router.register('subsidy', () => Subsidy.renderList());
Router.register('subsidy/detail', (p) => Subsidy.renderDetail(p[0]));
Router.register('tuition', () => Tuition.renderList());

// ============================================================
// 模块4：考勤管理
// ============================================================
const Attendance = {
  getList() { return Store.get('attendances', []); },
  save(list) { Store.set('attendances', list); },
  STATUSES: {
    present: { label:'到课', tag:'tag-success' },
    absent: { label:'缺勤', tag:'tag-danger' },
    late: { label:'迟到', tag:'tag-warning' },
    early: { label:'早退', tag:'tag-warning' },
    leave: { label:'请假', tag:'tag-info' },
  },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    if (u.role === 'student') this.renderStudentView(u);
    else this.renderManageView(u);
  },

  renderStudentView(u) {
    const list = this.getList();
    const myRecords = [];
    list.forEach(d => {
      d.records.forEach(r => {
        if (r.stuId === u.id) myRecords.push({ date:d.date, type:d.type, ...r });
      });
    });
    myRecords.sort((a,b) => b.date.localeCompare(a.date));
    const stats = { present:0, absent:0, late:0, early:0, leave:0 };
    myRecords.forEach(r => { if (stats[r.status] !== undefined) stats[r.status]++; });

    $('#app').innerHTML = `
      ${renderTopbar('我的考勤', 'workbench')}
      <div class="page page-with-nav">
        <div class="stat-grid">
          <div class="stat-card"><div class="sc-num">${stats.absent}</div><div class="sc-label">缺勤</div></div>
          <div class="stat-card"><div class="sc-num">${stats.late}</div><div class="sc-label">迟到</div></div>
          <div class="stat-card"><div class="sc-num">${stats.early}</div><div class="sc-label">早退</div></div>
          <div class="stat-card"><div class="sc-num">${stats.leave}</div><div class="sc-label">请假</div></div>
        </div>
        <div class="card">
          <div class="card-header">考勤记录</div>
          <div class="card-body" style="padding:0;">
            ${myRecords.length ? myRecords.map(r => `
              <div class="list-item">
                <div class="li-main">
                  <div class="li-title">${r.date} ${r.type==='class'?'课堂':'晚自习'}</div>
                  <div class="li-meta">${this.STATUSES[r.status]?.label || r.status} ${r.remark?'· '+escapeHtml(r.remark):''}</div>
                </div>
                <span class="tag ${this.STATUSES[r.status]?.tag || ''}">${this.STATUSES[r.status]?.label || r.status}</span>
              </div>
            `).join('') : emptyState('暂无考勤记录')}
          </div>
        </div>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderManageView(u) {
    const list = this.getList().sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    $('#app').innerHTML = `
      ${renderTopbar('考勤管理', 'workbench', u.role==='monitor' ? `<button class="btn-action" onclick="Attendance.showRecord()">录入</button>` : '')}
      <div class="page page-with-nav">
        <div class="seg-control">
          <button class="seg-item active" data-type="all" onclick="Attendance.filterType('all')">全部</button>
          <button class="seg-item" data-type="class" onclick="Attendance.filterType('class')">课堂</button>
          <button class="seg-item" data-type="evening" onclick="Attendance.filterType('evening')">晚自习</button>
        </div>
        <div id="attList">${this.renderManageItems(list, 'all')}</div>
        ${u.role==='monitor' ? `<button class="btn btn-outline btn-block" style="margin:0 12px;max-width:calc(100% - 24px);" onclick="Attendance.export()">导出考勤表</button>`:''}
      </div>
      ${renderBottomNav()}
    `;
  },

  renderManageItems(list, type) {
    const filtered = type === 'all' ? list : list.filter(d => d.type === type);
    if (!filtered.length) return emptyState('暂无考勤记录');
    return filtered.map(d => {
      const stats = { present:0, absent:0, late:0, early:0, leave:0 };
      d.records.forEach(r => { if (stats[r.status] !== undefined) stats[r.status]++; });
      return `
        <div class="card" onclick="Attendance.showDetail('${d.id}')">
          <div class="card-body">
            <div class="flex-between">
              <span class="li-title fw-600">${d.date} ${d.type==='class'?'课堂考勤':'晚自习考勤'}</span>
              <span class="tag tag-gray">${d.records.length}人</span>
            </div>
            <div class="li-meta">缺勤${stats.absent} 迟到${stats.late} 早退${stats.early} 请假${stats.leave}</div>
            <div class="li-meta text-muted">录入人：${escapeHtml(d.recorder)}</div>
          </div>
        </div>`;
    }).join('');
  },

  filterType(type) {
    $$('.seg-item').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    const list = this.getList().sort((a,b) => b.date.localeCompare(a.date));
    $('#attList').innerHTML = this.renderManageItems(list, type);
  },

  showDetail(id) {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const d = this.getList().find(x => x.id === id);
    if (!d) return;
    const students = Store.getStudents();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>${d.date} ${d.type==='class'?'课堂':'晚自习'}考勤</span><button class="modal-close">&times;</button></div>
        <div class="modal-body" style="padding:0;">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>姓名</th><th>状态</th><th>备注</th></tr></thead>
              <tbody>
                ${d.records.map(r => {
                  const s = students.find(x => x.id === r.stuId);
                  return `<tr><td>${escapeHtml(s?.name || r.stuId)}</td><td><span class="tag ${this.STATUSES[r.status]?.tag||''}">${this.STATUSES[r.status]?.label||r.status}</span></td><td>${escapeHtml(r.remark||'')}</td></tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer"><button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">关闭</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
  },

  showRecord() {
    const u = Auth.current();
    if (u.role !== 'monitor') { toast('无权限'); return; }
    const students = Store.getStudents();
    if (!students.length) { toast('请先导入学生名单'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>录入考勤</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>日期</label><input type="date" id="attDate" value="${todayStr()}"></div>
          <div class="form-group"><label>类型</label>
            <select id="attType"><option value="class">课堂考勤</option><option value="evening">晚自习考勤</option></select>
          </div>
          <div class="form-group"><label>学生考勤（默认到课）</label>
            <div id="attStudents" style="max-height:300px;overflow-y:auto;">
              ${students.map(s => `
                <div class="flex gap-8 mb-8" style="align-items:center;">
                  <span style="width:90px;font-size:0.85rem;">${escapeHtml(s.name)}</span>
                  <select data-stuid="${s.id}" style="flex:1;padding:6px;border:1px solid var(--gray-3);border-radius:6px;">
                    <option value="present">到课</option>
                    <option value="absent">缺勤</option>
                    <option value="late">迟到</option>
                    <option value="early">早退</option>
                    <option value="leave">请假</option>
                  </select>
                  <input type="text" data-stuid="${s.id}" class="att-remark" placeholder="备注" style="flex:1;padding:6px;border:1px solid var(--gray-3);border-radius:6px;">
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="attSaveBtn">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#attSaveBtn').onclick = () => {
      const date = overlay.querySelector('#attDate').value;
      const type = overlay.querySelector('#attType').value;
      if (!date) { toast('请选择日期'); return; }
      const records = [];
      const selects = overlay.querySelectorAll('#attStudents select');
      const remarks = overlay.querySelectorAll('#attStudents .att-remark');
      selects.forEach(sel => {
        const stuId = sel.dataset.stuid;
        const remark = [...remarks].find(r => r.dataset.stuid === stuId)?.value?.trim() || '';
        records.push({ stuId, status: sel.value, remark });
      });
      const list = this.getList();
      const d = { id:uid(), date, type, records, recorder:u.name, createdAt:now() };
      list.push(d);
      this.save(list);
      Store.addLog(u.name, u.role, '录入考勤', d.id);
      overlay.remove();
      toast('已保存');
      this.renderList();
    };
  },

  export() {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const students = Store.getStudents();
    const list = this.getList().sort((a,b) => a.date.localeCompare(b.date));
    // 横向表：学生 × 日期
    const dates = [...new Set(list.map(d => `${d.date}(${d.type==='class'?'课':'晚'})`))];
    const data = students.map(s => {
      const row = { '学号': s.stuNo, '姓名': s.name };
      dates.forEach(dt => {
        const [date, typeMark] = [dt.slice(0,10), dt.slice(-2)];
        const type = typeMark === '课' ? 'class' : 'evening';
        const d = list.find(x => x.date === date && x.type === type);
        const r = d?.records.find(x => x.stuId === s.id);
        row[dt] = r ? this.STATUSES[r.status]?.label : '';
      });
      // 统计
      let absent=0, late=0, early=0, leave=0;
      list.forEach(d => {
        const r = d.records.find(x => x.stuId === s.id);
        if (r?.status === 'absent') absent++;
        if (r?.status === 'late') late++;
        if (r?.status === 'early') early++;
        if (r?.status === 'leave') leave++;
      });
      row['缺勤次数'] = absent;
      row['迟到次数'] = late;
      row['早退次数'] = early;
      row['请假次数'] = leave;
      return row;
    });
    downloadExcel(`考勤表_${todayStr()}.xlsx`, data, '考勤');
    Store.addLog(u.name, u.role, '导出考勤表');
    toast('已导出');
  },
};

// ============================================================
// 模块5：请假审批
// ============================================================
const Leave = {
  getList() { return Store.get('leaves', []); },
  save(list) { Store.set('leaves', list); },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    if (u.role === 'student') this.renderStudentView(u);
    else this.renderManageView(u);
  },

  renderStudentView(u) {
    const list = this.getList().filter(l => l.stuId === u.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    $('#app').innerHTML = `
      ${renderTopbar('我的请假', 'workbench', `<button class="btn-action" onclick="Leave.showApply()">申请</button>`)}
      <div class="page page-with-nav">
        <div id="leaveList">${this.renderItems(list, u)}</div>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderManageView(u) {
    const list = this.getList().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    $('#app').innerHTML = `
      ${renderTopbar('请假审批', 'workbench')}
      <div class="page page-with-nav">
        <div class="seg-control">
          <button class="seg-item active" data-filter="all" onclick="Leave.filter('all')">全部</button>
          <button class="seg-item" data-filter="pending" onclick="Leave.filter('pending')">待审批</button>
          <button class="seg-item" data-filter="approved" onclick="Leave.filter('approved')">已通过</button>
          <button class="seg-item" data-filter="rejected" onclick="Leave.filter('rejected')">已驳回</button>
        </div>
        <div id="leaveList">${this.renderItems(list, u)}</div>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderItems(list, u) {
    const filtered = list.filter(l => u.role !== 'student' || l.stuId === u.id);
    if (!filtered.length) return emptyState('暂无请假申请');
    return filtered.map(l => {
      const s = Store.getStudent(l.stuId);
      let tag = '';
      if (l.status === 'pending') tag = '<span class="tag tag-warning">待审批</span>';
      else if (l.status === 'approved') tag = '<span class="tag tag-success">已通过</span>';
      else if (l.status === 'rejected') tag = '<span class="tag tag-danger">已驳回</span>';
      return `
        <div class="card" onclick="Leave.showDetail('${l.id}')">
          <div class="card-body">
            <div class="flex-between">
              <span class="li-title">${escapeHtml(s?.name || l.stuName)} · ${l.start} 至 ${l.end}</span>
              ${tag}
            </div>
            <div class="li-meta">原因：${escapeHtml(l.reason)}</div>
            <div class="li-meta">申请时间：${fmtDateShort(l.createdAt)}</div>
            ${l.approver ? `<div class="li-meta">审批人：${escapeHtml(l.approver)} · ${fmtDate(l.approveTime, true)}</div>`:''}
          </div>
        </div>`;
    }).join('');
  },

  filter(f) {
    $$('.seg-item').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
    const u = Auth.current();
    let list = this.getList().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    if (f !== 'all') list = list.filter(l => l.status === f);
    $('#leaveList').innerHTML = this.renderItems(list, u);
  },

  showDetail(id) {
    const u = Auth.current();
    const l = this.getList().find(x => x.id === id);
    if (!l) return;
    const s = Store.getStudent(l.stuId);
    const isTeacher = u.role === 'teacher';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>请假详情</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="detail-row"><span class="dr-label">申请人</span><span class="dr-value">${escapeHtml(s?.name || l.stuName)}</span></div>
          <div class="detail-row"><span class="dr-label">起止时间</span><span class="dr-value">${l.start} 至 ${l.end}</span></div>
          <div class="detail-row"><span class="dr-label">原因</span><span class="dr-value">${escapeHtml(l.reason)}</span></div>
          <div class="detail-row"><span class="dr-label">申请时间</span><span class="dr-value">${fmtDate(l.createdAt, true)}</span></div>
          <div class="detail-row"><span class="dr-label">状态</span><span class="dr-value">${l.status==='pending'?'<span class="text-warning">待审批</span>':l.status==='approved'?'<span class="text-success">已通过</span>':'<span class="text-danger">已驳回</span>'}</span></div>
          ${l.approver ? `<div class="detail-row"><span class="dr-label">审批人</span><span class="dr-value">${escapeHtml(l.approver)} · ${fmtDate(l.approveTime, true)}</span></div>`:''}
          ${l.approveRemark ? `<div class="detail-row"><span class="dr-label">审批意见</span><span class="dr-value">${escapeHtml(l.approveRemark)}</span></div>`:''}
        </div>
        ${isTeacher && l.status === 'pending' ? `
        <div class="modal-footer">
          <button class="btn btn-danger" style="flex:1;" id="lvReject">驳回</button>
          <button class="btn btn-success" style="flex:1;" id="lvApprove">通过</button>
        </div>` : `<div class="modal-footer"><button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">关闭</button></div>`}
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    if (isTeacher && l.status === 'pending') {
      overlay.querySelector('#lvApprove').onclick = () => this.approve(id, true);
      overlay.querySelector('#lvReject').onclick = () => this.approve(id, false);
    }
  },

  async approve(id, ok) {
    const u = Auth.current();
    if (u.role !== 'teacher') { toast('仅班主任可审批'); return; }
    const remark = await promptDialog('审批意见', ok ? '同意请假' : '说明驳回原因');
    if (remark === null) return;
    const list = this.getList();
    const l = list.find(x => x.id === id);
    l.status = ok ? 'approved' : 'rejected';
    l.approver = u.name;
    l.approveTime = now();
    l.approveRemark = remark;
    this.save(list);
    Store.addLog(u.name, u.role, ok ? '批准请假' : '驳回请假', id);
    toast(ok ? '已通过' : '已驳回');
    $('.modal-overlay')?.remove();
    this.renderList();
  },

  showApply() {
    const u = Auth.current();
    if (u.role !== 'student') { toast('仅学生可申请'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>请假申请</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>开始时间</label><input type="datetime-local" id="lvStart"></div>
          <div class="form-group"><label>结束时间</label><input type="datetime-local" id="lvEnd"></div>
          <div class="form-group"><label>请假原因</label><textarea id="lvReason" placeholder="请详细说明请假原因"></textarea></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="lvSubmitBtn">提交</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#lvSubmitBtn').onclick = () => {
      const start = overlay.querySelector('#lvStart').value;
      const end = overlay.querySelector('#lvEnd').value;
      const reason = overlay.querySelector('#lvReason').value.trim();
      if (!start || !end) { toast('请填写时间'); return; }
      if (!reason) { toast('请填写原因'); return; }
      if (start > end) { toast('开始时间不能晚于结束'); return; }
      const list = this.getList();
      const l = {
        id: uid(), stuId: u.id, stuName: u.name,
        start: start.replace('T',' '), end: end.replace('T',' '),
        reason, status: 'pending', createdAt: now(),
      };
      list.push(l);
      this.save(list);
      Store.addLog(u.name, 'student', '提交请假申请', l.id);
      overlay.remove();
      toast('已提交');
      this.renderList();
    };
  },
};

// ============================================================
// 模块6：矛盾纠纷调解登记（隐私保护）
// ============================================================
const Dispute = {
  getList() { return Store.get('disputes', []); },
  save(list) { Store.set('disputes', list); },

  // 学生可见的列表（仅自己上报的）
  renderStudentView(u) {
    const list = this.getList().filter(d => d.reporterId === u.id || d.involvedIds?.includes(u.id));
    const app = $('#app');
    app.innerHTML = `
      ${renderTopbar('纠纷调解', 'workbench', `<button class="btn-action" onclick="Dispute.showReport()">上报</button>`)}
      <div class="page page-with-nav">
        <div class="card">
          <div class="card-body text-center">
            <p class="text-small text-muted">纠纷调解记录涉及隐私，仅可见本人上报/参与的记录</p>
            <p class="text-small text-muted">完整档案由班主任、班长管理</p>
          </div>
        </div>
        <div id="disputeList">${this.renderItems(list, u, true)}</div>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderManageView(u) {
    const list = this.getList().sort((a,b) => (b.time||'').localeCompare(a.time||''));
    $('#app').innerHTML = `
      ${renderTopbar('纠纷调解档案', 'workbench', u.role==='monitor' ? `<button class="btn-action" onclick="Dispute.showRecord()">登记</button>` : '')}
      <div class="page page-with-nav">
        <div id="disputeList">${this.renderItems(list, u, false)}</div>
        <button class="btn btn-outline btn-block" style="margin:0 12px;max-width:calc(100% - 24px);" onclick="Dispute.export()">导出调解档案</button>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    if (u.role === 'student') this.renderStudentView(u);
    else this.renderManageView(u);
  },

  renderItems(list, u, isStudent) {
    if (!list.length) return emptyState(isStudent ? '暂无相关记录' : '暂无调解档案');
    return list.map(d => {
      const info = isStudent ? (d.reporterId === u.id ? '我上报' : '涉及本人') : (d.involved || '匿名');
      const cause = decodeBase64(d.causeEnc || '');
      let tag = '<span class="tag tag-gray">待处理</span>';
      const result = decodeBase64(d.resultEnc || '');
      if (result) tag = '<span class="tag tag-success">已调解</span>';
      return `
        <div class="card" onclick="Dispute.showDetail('${d.id}')">
          <div class="card-body">
            <div class="flex-between">
              <span class="li-title">${escapeHtml(cause?.slice(0,20) || '纠纷事件')}</span>
              ${tag}
            </div>
            <div class="li-meta">涉及：${escapeHtml(info)}</div>
            <div class="li-meta">时间：${fmtDateShort(d.time || d.createdAt)}</div>
          </div>
        </div>`;
    }).join('');
  },

  showDetail(id) {
    const u = Auth.current();
    const d = this.getList().find(x => x.id === id);
    if (!d) return;
    // 学生权限校验
    if (u.role === 'student' && d.reporterId !== u.id && !d.involvedIds?.includes(u.id)) {
      toast('无权查看此档案'); return;
    }
    // 解密内容
    const cause = decodeBase64(d.causeEnc || '');
    const process = decodeBase64(d.processEnc || '');
    const mediation = decodeBase64(d.mediationEnc || '');
    const result = decodeBase64(d.resultEnc || '');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>纠纷调解详情</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="detail-row"><span class="dr-label">涉及人员</span><span class="dr-value">${escapeHtml(d.involved || '匿名')}</span></div>
          <div class="detail-row"><span class="dr-label">事件起因</span><span class="dr-value">${escapeHtml(cause)}</span></div>
          <div class="detail-row"><span class="dr-label">事件经过</span><span class="dr-value">${escapeHtml(process)}</span></div>
          <div class="detail-row"><span class="dr-label">调解过程</span><span class="dr-value">${escapeHtml(mediation)}</span></div>
          <div class="detail-row"><span class="dr-label">调解结果</span><span class="dr-value">${escapeHtml(result)}</span></div>
          <div class="detail-row"><span class="dr-label">处理人</span><span class="dr-value">${escapeHtml(d.handler || '-')}</span></div>
          <div class="detail-row"><span class="dr-label">处理时间</span><span class="dr-value">${fmtDate(d.time || d.createdAt, true)}</span></div>
        </div>
        <div class="modal-footer"><button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">关闭</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
  },

  showReport() {
    const u = Auth.current();
    if (u.role !== 'student') { toast('仅学生可上报'); return; }
    this.showForm(false, u);
  },

  showRecord() {
    const u = Auth.current();
    if (u.role !== 'monitor') { toast('无权限'); return; }
    this.showForm(true, u);
  },

  showForm(isManage, u) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>${isManage?'登记调解档案':'上报纠纷'}</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>涉及人员</label><input type="text" id="dsInvolved" placeholder="如：张三、李四（可匿名）"></div>
          <div class="form-group"><label>事件起因</label><textarea id="dsCause" placeholder="简述事件起因"></textarea></div>
          <div class="form-group"><label>事件经过</label><textarea id="dsProcess" placeholder="详细描述经过"></textarea></div>
          ${isManage ? `
            <div class="form-group"><label>调解过程</label><textarea id="dsMediation" placeholder="调解过程记录"></textarea></div>
            <div class="form-group"><label>调解结果</label><textarea id="dsResult" placeholder="调解结果"></textarea></div>
          ` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="dsSaveBtn">${isManage?'保存档案':'提交上报'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#dsSaveBtn').onclick = () => {
      const involved = overlay.querySelector('#dsInvolved').value.trim();
      const cause = overlay.querySelector('#dsCause').value.trim();
      const process = overlay.querySelector('#dsProcess').value.trim();
      if (!cause) { toast('请填写事件起因'); return; }
      const mediation = isManage ? overlay.querySelector('#dsMediation').value.trim() : '';
      const result = isManage ? overlay.querySelector('#dsResult').value.trim() : '';
      const list = this.getList();
      const d = {
        id: uid(),
        reporterId: u.id, reporter: u.name,
        involved,
        involvedIds: [],
        causeEnc: encodeBase64(cause),
        processEnc: encodeBase64(process),
        mediationEnc: encodeBase64(mediation),
        resultEnc: encodeBase64(result),
        cause: '', process: '', mediation: '', result: '', // 不存明文
        handler: isManage ? u.name : '',
        time: now(), createdAt: now(),
        encrypted: true,
      };
      list.push(d);
      this.save(list);
      Store.addLog(u.name, u.role, isManage ? '登记调解档案' : '上报纠纷', d.id);
      overlay.remove();
      toast(isManage ? '已保存' : '已上报');
      this.renderList();
    };
  },

  export() {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const list = this.getList();
    const data = list.map(d => ({
      '涉及人员': d.involved || '匿名',
      '事件起因': decodeBase64(d.causeEnc || ''),
      '事件经过': decodeBase64(d.processEnc || ''),
      '调解过程': decodeBase64(d.mediationEnc || ''),
      '调解结果': decodeBase64(d.resultEnc || ''),
      '处理人': d.handler || '',
      '处理时间': fmtDate(d.time || d.createdAt, true),
      '上报人': d.reporter || '',
    }));
    downloadExcel(`纠纷调解档案_${todayStr()}.xlsx`, data, '纠纷调解');
    Store.addLog(u.name, u.role, '导出调解档案');
    toast('已导出');
  },
};

// ============================================================
// 模块7：宿舍情况记录
// ============================================================
const Dorm = {
  getList() { return Store.get('dorms', []); },
  save(list) { Store.set('dorms', list); },
  TYPES: {
    hygiene: '卫生检查',
    late: '晚归',
    absent: '不归',
    violation: '违规违纪',
  },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    if (u.role === 'student') this.renderStudentView(u);
    else this.renderManageView(u);
  },

  renderStudentView(u) {
    const list = this.getList().filter(d => d.dormNo === u.dorm).sort((a,b) => b.date.localeCompare(a.date));
    $('#app').innerHTML = `
      ${renderTopbar('我的宿舍', 'workbench')}
      <div class="page page-with-nav">
        <div class="card">
          <div class="card-body">
            <div class="detail-row"><span class="dr-label">宿舍号</span><span class="dr-value">${escapeHtml(u.dorm || '未登记')}</span></div>
          </div>
        </div>
        <div id="dormList">${this.renderItems(list, true)}</div>
      </div>
      ${renderBottomNav()}
    `;
  },

  renderManageView(u) {
    const list = this.getList().sort((a,b) => b.date.localeCompare(a.date));
    const dorms = [...new Set(Store.getStudents().map(s => s.dorm).filter(Boolean))];
    $('#app').innerHTML = `
      ${renderTopbar('宿舍台账', 'workbench', u.role==='monitor' ? `<button class="btn-action" onclick="Dorm.showRecord()">录入</button>` : '')}
      <div class="page page-with-nav">
        ${dorms.length ? `<div class="seg-control">${dorms.map(d => `<button class="seg-item" data-dorm="${escapeHtml(d)}" onclick="Dorm.filterDorm('${escapeHtml(d)}')">${escapeHtml(d)}</button>`).join('')}<button class="seg-item active" data-dorm="all" onclick="Dorm.filterDorm('all')">全部</button></div>`:''}
        <div id="dormList">${this.renderItems(list, false)}</div>
        ${Auth.canManage() ? `<button class="btn btn-outline btn-block" style="margin:0 12px;max-width:calc(100% - 24px);" onclick="Dorm.export()">导出宿舍台账</button>`:''}
      </div>
      ${renderBottomNav()}
    `;
  },

  renderItems(list, isStudent) {
    if (!list.length) return emptyState('暂无宿舍记录');
    return list.map(d => `
      <div class="card" onclick="${isStudent?'':'Dorm.showDetail'}('${d.id}')">
        <div class="card-body">
          <div class="flex-between">
            <span class="li-title">${escapeHtml(d.dormNo)} · ${this.TYPES[d.type] || d.type}</span>
            ${d.deduct ? `<span class="tag tag-danger">扣${d.deduct}分</span>` : '<span class="tag tag-success">无扣分</span>'}
          </div>
          <div class="li-meta">${d.date}</div>
          <div class="li-meta">${escapeHtml(d.desc)}</div>
          ${d.rectify ? `<div class="li-meta text-success">已整改：${escapeHtml(d.rectify)}</div>` : '<div class="li-meta text-warning">待整改</div>'}
        </div>
      </div>
    `).join('');
  },

  filterDorm(dorm) {
    $$('.seg-item').forEach(b => b.classList.toggle('active', b.dataset.dorm === dorm));
    let list = this.getList().sort((a,b) => b.date.localeCompare(a.date));
    if (dorm !== 'all') list = list.filter(d => d.dormNo === dorm);
    $('#dormList').innerHTML = this.renderItems(list, false);
  },

  showDetail(id) {
    const d = this.getList().find(x => x.id === id);
    if (!d) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>宿舍记录详情</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="detail-row"><span class="dr-label">宿舍号</span><span class="dr-value">${escapeHtml(d.dormNo)}</span></div>
          <div class="detail-row"><span class="dr-label">类型</span><span class="dr-value">${this.TYPES[d.type] || d.type}</span></div>
          <div class="detail-row"><span class="dr-label">日期</span><span class="dr-value">${d.date}</span></div>
          <div class="detail-row"><span class="dr-label">扣分</span><span class="dr-value">${d.deduct || 0}</span></div>
          <div class="detail-row"><span class="dr-label">问题描述</span><span class="dr-value">${escapeHtml(d.desc)}</span></div>
          <div class="detail-row"><span class="dr-label">整改情况</span><span class="dr-value">${escapeHtml(d.rectify) || '待整改'}</span></div>
          <div class="detail-row"><span class="dr-label">记录人</span><span class="dr-value">${escapeHtml(d.recorder)}</span></div>
        </div>
        ${Auth.canManage() && !d.rectify ? `
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
          <button class="btn btn-primary" style="flex:1;" onclick="Dorm.markRectify('${d.id}')">登记整改</button>
        </div>` : `<div class="modal-footer"><button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">关闭</button></div>`}
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
  },

  async markRectify(id) {
    const remark = await promptDialog('整改情况', '说明整改结果');
    if (!remark) return;
    const u = Auth.current();
    const list = this.getList();
    const d = list.find(x => x.id === id);
    d.rectify = remark;
    d.rectifyTime = now();
    d.rectifyBy = u.name;
    this.save(list);
    Store.addLog(u.name, u.role, '登记宿舍整改', id);
    toast('已登记');
    $('.modal-overlay')?.remove();
    this.renderList();
  },

  showRecord() {
    const u = Auth.current();
    if (u.role !== 'monitor') { toast('无权限'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>录入宿舍记录</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <div class="form-group"><label>宿舍号</label><input type="text" id="dmDorm" placeholder="如：3-201"></div>
          <div class="form-group"><label>类型</label>
            <select id="dmType">
              <option value="hygiene">卫生检查</option>
              <option value="late">晚归</option>
              <option value="absent">不归</option>
              <option value="violation">违规违纪</option>
            </select>
          </div>
          <div class="form-group"><label>日期</label><input type="date" id="dmDate" value="${todayStr()}"></div>
          <div class="form-group"><label>扣分</label><input type="number" id="dmDeduct" value="0" placeholder="0表示不扣分"></div>
          <div class="form-group"><label>问题描述</label><textarea id="dmDesc" placeholder="详细描述问题"></textarea></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" style="flex:1;" id="dmSaveBtn">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#dmSaveBtn').onclick = () => {
      const dormNo = overlay.querySelector('#dmDorm').value.trim();
      const type = overlay.querySelector('#dmType').value;
      const date = overlay.querySelector('#dmDate').value;
      const deduct = parseFloat(overlay.querySelector('#dmDeduct').value) || 0;
      const desc = overlay.querySelector('#dmDesc').value.trim();
      if (!dormNo) { toast('请填写宿舍号'); return; }
      if (!date) { toast('请选择日期'); return; }
      const list = this.getList();
      const d = { id:uid(), dormNo, type, date, deduct, desc, rectify:'', recorder:u.name, createdAt:now() };
      list.push(d);
      this.save(list);
      Store.addLog(u.name, u.role, '录入宿舍记录', d.id);
      overlay.remove();
      toast('已保存');
      this.renderList();
    };
  },

  export() {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const list = this.getList().sort((a,b) => a.date.localeCompare(b.date));
    const data = list.map(d => ({
      '宿舍号': d.dormNo,
      '类型': this.TYPES[d.type] || d.type,
      '日期': d.date,
      '扣分': d.deduct || 0,
      '问题描述': d.desc,
      '整改情况': d.rectify || '待整改',
      '整改人': d.rectifyBy || '',
      '记录人': d.recorder,
      '记录时间': fmtDate(d.createdAt, true),
    }));
    downloadExcel(`宿舍台账_${todayStr()}.xlsx`, data, '宿舍检查');
    Store.addLog(u.name, u.role, '导出宿舍台账');
    toast('已导出');
  },
};

// ============================================================
// 模块8：台账表格
// ============================================================
const Ledger = {
  TEMPLATES: {
    signup: { name:'报名表', columns:['序号','姓名','学号','项目','联系电话','备注'] },
    score: { name:'赛事计分表', columns:['序号','姓名','项目','评委1','评委2','评委3','总分','排名'] },
    subsidy: { name:'补助明细表', columns:['序号','学号','姓名','补助类型','金额','签字状态','签字时间'] },
    attendance: { name:'考勤表', columns:['学号','姓名','日期','类型','状态','备注'] },
    dorm: { name:'宿舍检查表', columns:['宿舍号','日期','类型','扣分','问题描述','整改情况','记录人'] },
    dispute: { name:'纠纷调解登记表', columns:['序号','涉及人员','事件起因','调解结果','处理人','处理时间'] },
    student: { name:'学生名单', columns:['序号','学号','姓名','宿舍号','联系电话'] },
  },

  renderList() {
    const u = Auth.current();
    if (!u) { Router.go(''); return; }
    const canImport = Auth.canManage();
    $('#app').innerHTML = `
      ${renderTopbar('台账表格', 'workbench')}
      <div class="page page-with-nav">
        <div class="card">
          <div class="card-header">内置台账模板</div>
          <div class="card-body" style="padding:0;">
            ${Object.entries(this.TEMPLATES).map(([key,t]) => `
              <div class="list-item" onclick="Ledger.showTemplate('${key}')">
                <div class="li-main">
                  <div class="li-title">${t.name}</div>
                  <div class="li-desc text-small">${t.columns.length}列 · ${escapeHtml(t.columns.join('、'))}</div>
                </div>
                <span class="li-arrow">&rsaquo;</span>
              </div>
            `).join('')}
          </div>
        </div>
        ${canImport ? `
        <div class="card">
          <div class="card-header">学生名单管理</div>
          <div class="card-body">
            <p class="text-small text-muted mb-8">当前名单：${Store.getStudents().length} 人</p>
            <input type="file" id="studentImport" accept=".xlsx,.xls" class="btn btn-outline btn-block mb-8">
            <button class="btn btn-primary btn-block mb-8" onclick="Ledger.importStudents()">导入学生名单</button>
            <button class="btn btn-outline btn-block" onclick="Ledger.exportStudents()">导出学生名单</button>
          </div>
        </div>` : ''}
      </div>
      ${renderBottomNav()}
    `;
  },

  showTemplate(key) {
    const t = this.TEMPLATES[key];
    const u = Auth.current();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span>${t.name}</span><button class="modal-close">&times;</button></div>
        <div class="modal-body">
          <p class="text-small text-muted mb-12">模板列：${escapeHtml(t.columns.join('、'))}</p>
          <input type="file" id="tgFile" accept=".xlsx,.xls" class="btn btn-outline btn-block mb-8">
          <button class="btn btn-primary btn-block mb-8" onclick="Ledger.exportTemplate('${key}')">下载空白模板</button>
          ${Auth.canManage() ? `<button class="btn btn-outline btn-block" onclick="Ledger.importTemplate('${key}')">导入数据</button>`:''}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    this._tgFile = overlay.querySelector('#tgFile');
  },

  exportTemplate(key) {
    const t = this.TEMPLATES[key];
    const emptyRow = {};
    t.columns.forEach(c => emptyRow[c] = '');
    downloadExcel(`${t.name}_模板.xlsx`, [emptyRow], t.name);
    toast('已下载模板');
  },

  async importTemplate(key) {
    const file = this._tgFile?.files[0];
    if (!file) { toast('请选择Excel文件'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      // 按模板类型分发处理
      if (key === 'student') {
        this.processStudentRows(rows);
      } else if (key === 'subsidy') {
        this.processSubsidyRows(rows);
      } else {
        // 通用：直接导出预览
        const t = this.TEMPLATES[key];
        downloadExcel(`${t.name}_导入预览.xlsx`, rows, t.name);
        toast(`已导入${rows.length}条，已导出预览`);
      }
      $('.modal-overlay')?.remove();
    };
    reader.readAsArrayBuffer(file);
  },

  processStudentRows(rows) {
    const students = [];
    rows.forEach((r, i) => {
      const stuNo = String(r['学号'] || '').trim();
      const name = String(r['姓名'] || '').trim();
      const dorm = String(r['宿舍号'] || r['宿舍'] || '').trim();
      const phone = String(r['联系电话'] || r['电话'] || '').trim();
      if (name) students.push({ id:uid(), stuNo, name, dorm, phone, createdAt:now() });
    });
    if (!students.length) { toast('未解析到有效数据'); return; }
    Store.saveStudents(students);
    Store.addLog(Auth.current().name, Auth.current().role, '导入学生名单', `${students.length}人`);
    toast(`已导入${students.length}名学生`);
  },

  importStudents() {
    const file = $('#studentImport')?.files[0];
    if (!file) { toast('请选择Excel文件'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      this.processStudentRows(rows);
      this.renderList();
    };
    reader.readAsArrayBuffer(file);
  },

  exportStudents() {
    const students = Store.getStudents();
    if (!students.length) { toast('名单为空'); return; }
    const data = students.map((s, i) => ({
      '序号': i+1,
      '学号': s.stuNo,
      '姓名': s.name,
      '宿舍号': s.dorm || '',
      '联系电话': s.phone || '',
    }));
    downloadExcel(`学生名单_${todayStr()}.xlsx`, data, '学生名单');
    toast('已导出');
  },
};

// ============================================================
// 模块9：消息提醒看板
// ============================================================
const Reminder = {
  renderDashboard(u) {
    const items = this.getItems(u);
    if (!items.length) return '';
    return `
      <div class="reminder-section">
        <div class="flex-between mb-8" style="padding:0 4px;">
          <span class="fw-600 text-small">待办提醒</span>
          <span class="text-muted text-small">${items.length}项</span>
        </div>
        ${items.map(it => `
          <div class="reminder-item ${it.level === 'warning' ? 'r-warning' : it.level === 'info' ? 'r-info' : ''}" onclick="Router.go('${it.link}')">
            <div class="ri-title">${escapeHtml(it.title)}</div>
            <div class="ri-desc">${escapeHtml(it.desc)}</div>
          </div>
        `).join('')}
      </div>`;
  },

  getItems(u) {
    const items = [];
    if (u.role === 'student') {
      // 未签字补助
      Store.get('subsidies', []).forEach(t => {
        if (isExpired(t.deadline)) return;
        const item = t.items.find(i => i.stuId === u.id);
        const sign = t.signs.find(s => s.stuId === u.id && s.valid !== false);
        if (item && !sign) {
          items.push({ title:`补助签字待办：${t.title}`, desc:`截止 ${fmtDate(t.deadline, true)}`, level:'danger', link:'subsidy' });
        }
      });
      // 未缴费
      const t = Tuition.getRecord(u.id);
      if (t && t.payable > 0 && t.paidStatus !== 'confirmed' && !t.paidProof) {
        items.push({ title:'缴费待办', desc:`应缴 ¥${t.payable}，请上传凭证`, level:'danger', link:'tuition' });
      }
    } else if (u.role === 'teacher') {
      // 待审批请假
      const pending = Store.get('leaves', []).filter(l => l.status === 'pending');
      pending.forEach(l => {
        items.push({ title:`待审批请假：${l.stuName}`, desc:`${l.start} 至 ${l.end}`, level:'warning', link:'leave' });
      });
    }
    // 待整改宿舍（班长/班主任）
    if (u.role === 'monitor' || u.role === 'teacher') {
      const pending = Store.get('dorms', []).filter(d => !d.rectify);
      pending.forEach(d => {
        items.push({ title:`宿舍待整改：${d.dormNo}`, desc:`${d.desc}`, level:'warning', link:'dorm' });
      });
      // 待核对缴费
      if (u.role === 'monitor') {
        const pendingTuition = Store.get('tuitions', []).filter(t => t.paidProof && t.paidStatus === 'pending');
        if (pendingTuition.length) {
          items.push({ title:`缴费凭证待核对 ${pendingTuition.length} 条`, desc:'请尽快核对', level:'info', link:'tuition' });
        }
      }
    }
    return items;
  },

  updateBadges(u) {
    // 红点逻辑已嵌入getModuleBadge，无需额外处理
  },
};

// ============================================================
// 操作日志模块
// ============================================================
Router.register('log', () => {
  const u = Auth.current();
  if (!u) { Router.go(''); return; }
  if (u.role !== 'teacher' && u.role !== 'monitor') { toast('无权限'); Router.go('workbench'); return; }
  const logs = Store.getLogs().slice(-200).reverse();
  $('#app').innerHTML = `
    ${renderTopbar('操作日志', 'workbench', `<button class="btn-action" onclick="Log.export()">导出</button>`)}
    <div class="page page-with-nav">
      <div class="card">
        <div class="card-body" style="padding:0;">
          ${logs.length ? logs.map(l => `
            <div class="list-item">
              <div class="li-main">
                <div class="li-title">${escapeHtml(l.actor)} <span class="text-muted text-small">(${l.role==='student'?'学生':l.role==='monitor'?'班长':'班主任'})</span></div>
                <div class="li-desc">${escapeHtml(l.action)} ${l.target?`· 目标:${escapeHtml(l.target).slice(0,12)}`:''}</div>
              </div>
              <span class="li-meta">${fmtDateShort(l.time)}</span>
            </div>
          `).join('') : emptyState('暂无操作日志')}
        </div>
      </div>
    </div>
    ${renderBottomNav()}
  `;
});

const Log = {
  export() {
    const u = Auth.current();
    if (!Auth.canManage()) return;
    const data = Store.getLogs().map(l => ({
      '操作人': l.actor,
      '角色': l.role==='student'?'学生':l.role==='monitor'?'班长':'班主任',
      '操作': l.action,
      '目标': l.target || '',
      '时间': fmtDate(l.time, true),
    }));
    downloadExcel(`操作日志_${todayStr()}.xlsx`, data, '操作日志');
    Store.addLog(u.name, u.role, '导出操作日志');
    toast('已导出');
  },
};

// ============================================================
// 系统设置 + 账号管理
// ============================================================
const Account = {
  // 列出所有账号
  async list() {
    const { data, error } = await sb
      .from('users')
      .select('username, name, role, stu_no, dorm, phone')
      .order('role', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  // 新建账号（bcrypt 在数据库端完成）
  async create({ username, password, name, role='student', stuNo='', dorm='', phone='' }) {
    const { data, error } = await sb.rpc('create_user', {
      username_arg: username, password_arg: password,
      name_arg: name, role_arg: role,
      stu_no_arg: stuNo || null, dorm_arg: dorm || null, phone_arg: phone || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },
  // 重置密码
  async resetPassword(username, newPassword) {
    const { error } = await sb.rpc('reset_password', {
      username_arg: username, new_password: newPassword,
    });
    if (error) throw new Error(error.message);
  },
  // 从学生名单批量创建账号
  async batchCreate(students) {
    let created = 0, failed = 0;
    for (const s of students) {
      try {
        await this.create({
          username: s.stuNo, password: s.stuNo, // 初始密码=学号
          name: s.name, role: 'student', stuNo: s.stuNo, dorm: s.dorm || '',
        });
        created++;
      } catch (e) {
        if (String(e.message).includes('账号已存在')) { created++; }
        else { failed++; console.error(s.name, e); }
      }
    }
    return { created, failed };
  },
};

Router.register('settings', () => {
  const u = Auth.current();
  if (!Auth.canManage()) { toast('无权限'); Router.go('workbench'); return; }
  const cfg = Store.getConfig();
  $('#app').innerHTML = `
    ${renderTopbar('系统设置', 'workbench')}
    <div class="page page-with-nav">
      <div class="card">
        <div class="card-header">账号管理</div>
        <div class="card-body">
          <p class="text-small text-muted mb-8">为学生创建登录账号（账号=学号，初始密码=学号，学生登录后可改）</p>
          <button class="btn btn-primary btn-block mb-8" onclick="Account.showCreate()">+ 新建单个账号</button>
          <button class="btn btn-outline btn-block mb-8" onclick="Account.batchFromStudents()">从学生名单批量建号</button>
          <button class="btn btn-gray btn-block" onclick="Account.showList()">查看全部账号</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header">缴费规则</div>
        <div class="card-body">
          <div class="form-group"><label>全额缴费（元）</label><input type="number" id="cfgFull" value="${cfg.tuitionFull}"></div>
          <div class="form-group"><label>学费（元）</label><input type="number" id="cfgTuitionFee" value="${cfg.tuitionFee}"></div>
          <div class="form-group"><label>住宿费（元）</label><input type="number" id="cfgDormFee" value="${cfg.dormFee}"></div>
          <button class="btn btn-primary btn-block" onclick="saveTuition()">保存规则</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header">数据管理</div>
        <div class="card-body">
          <button class="btn btn-outline btn-block mb-8" onclick="exportAllData()">导出全部数据</button>
          <button class="btn btn-danger btn-block" onclick="clearAllData()">清空全部数据</button>
        </div>
      </div>
    </div>
    ${renderBottomNav()}
  `;
});

// 新建单个账号
Account.showCreate = function() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><span>新建账号</span><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div class="form-group"><label>账号</label><input type="text" id="acUsername" placeholder="学生用学号"></div>
        <div class="form-group"><label>姓名</label><input type="text" id="acName" placeholder="姓名"></div>
        <div class="form-group"><label>角色</label>
          <select id="acRole"><option value="student">学生</option><option value="monitor">班长</option><option value="teacher">班主任</option></select>
        </div>
        <div class="form-group"><label>宿舍号</label><input type="text" id="acDorm" placeholder="如 3-201"></div>
        <div class="form-group"><label>初始密码</label><input type="text" id="acPassword" placeholder="默认与账号相同"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">取消</button>
        <button class="btn btn-primary" style="flex:1;" id="acCreateBtn">创建</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').onclick = () => overlay.remove();
  overlay.querySelector('#acCreateBtn').onclick = async () => {
    const username = overlay.querySelector('#acUsername').value.trim();
    const name = overlay.querySelector('#acName').value.trim();
    if (!username || !name) { toast('请填写账号和姓名'); return; }
    const password = overlay.querySelector('#acPassword').value.trim() || username;
    const role = overlay.querySelector('#acRole').value;
    const dorm = overlay.querySelector('#acDorm').value.trim();
    try {
      await Account.create({ username, password, name, role, dorm });
      Store.addLog(Auth.current().name, Auth.current().role, '创建账号', username);
      overlay.remove();
      toast('创建成功');
    } catch (e) { toast('创建失败：' + (e.message || e)); }
  };
};

// 从学生名单批量建号
Account.batchFromStudents = async function() {
  const students = Store.getStudents();
  if (!students.length) { toast('请先导入学生名单'); Router.go('ledger'); return; }
  const ok = await confirmDialog(`将从学生名单为 ${students.length} 人批量创建账号（账号=学号，密码=学号）。确认？`);
  if (!ok) return;
  toast('正在创建，请稍候...');
  try {
    const res = await Account.batchCreate(students);
    Store.addLog(Auth.current().name, Auth.current().role, '批量创建学生账号', `${res.created}人`);
    toast(`完成：成功 ${res.created}${res.failed?`，失败 ${res.failed}`:''}`);
  } catch (e) {
    toast('批量建号失败：' + (e.message || e));
  }
};

// 查看全部账号 + 重置密码
Account.showList = async function() {
  const u = Auth.current();
  if (!Auth.canManage()) return;
  let accounts = [];
  try { accounts = await Account.list(); }
  catch { toast('加载账号失败'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><span>全部账号（${accounts.length}）</span><button class="modal-close">&times;</button></div>
      <div class="modal-body" style="padding:0;">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>宿舍</th><th>重置密码</th></tr></thead>
            <tbody>
              ${accounts.map(a => `
                <tr>
                  <td>${escapeHtml(a.username)}</td>
                  <td>${escapeHtml(a.name)}</td>
                  <td>${a.role==='monitor'?'班长':a.role==='teacher'?'班主任':'学生'}</td>
                  <td>${escapeHtml(a.dorm || '')}</td>
                  <td><button class="btn btn-sm btn-outline" onclick="Account.resetPwd('${escapeHtml(a.username)}')">重置</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer"><button class="btn btn-gray" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">关闭</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').onclick = () => overlay.remove();
  Account._accounts = accounts;
};

Account.resetPwd = async function(username) {
  const newPwd = await promptDialog(`重置 ${username} 的密码`, '输入新密码');
  if (!newPwd) return;
  try {
    await Account.resetPassword(username, newPwd);
    Store.addLog(Auth.current().name, Auth.current().role, '重置密码', username);
    toast('密码已重置');
    $('.modal-overlay')?.remove();
  } catch (e) { toast('重置失败：' + (e.message || e)); }
};

function saveTuition() {
  const cfg = Store.getConfig();
  cfg.tuitionFull = parseFloat($('#cfgFull').value) || 5800;
  cfg.tuitionFee = parseFloat($('#cfgTuitionFee').value) || 5000;
  cfg.dormFee = parseFloat($('#cfgDormFee').value) || 800;
  Store.saveConfig(cfg);
  Store.addLog(Auth.current().name, Auth.current().role, '修改缴费规则');
  toast('已保存');
}

async function clearAllData() {
  const ok = await confirmDialog('确认清空全部业务数据？此操作不可恢复！');
  if (!ok) return;
  const ok2 = await confirmDialog('再次确认！所有通知、签字、缴费、考勤等数据将被删除！');
  if (!ok2) return;
  ['config','students','notifications','subsidies','tuitions','tuitionQrcode',
    'attendances','leaves','disputes','dorms','operationLogs'
  ].forEach(k => Store.remove(k));
  toast('已清空');
}

// 注册剩余路由
Router.register('attendance', () => Attendance.renderList());
Router.register('leave', () => Leave.renderList());
Router.register('dispute', () => Dispute.renderList());
Router.register('dorm', () => Dorm.renderList());
Router.register('ledger', () => Ledger.renderList());
// settings 路由已在上方注册，此处不再重复



