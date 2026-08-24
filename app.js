/* ============================================================
 * 计算机网络技术2501班 班级工作台APP（云端共享版）
 * 云南工业信息职业学院
 * 单页应用 - Supabase 云端数据 + 账号密码登录
 * ============================================================ */

// ============== 常量 ==============
const CLASS_NAME = '计算机网络技术2501班';
const SCHOOL_NAME = '云南工业信息职业学院';
const LS_PREFIX = 'jw2501_';
const DEFAULT_BZ_PWD = 'bz2501';
const DEFAULT_BZR_PWD = 'bzr2501';

// ============== Supabase 客户端 ==============
// 请替换为你自己的项目 URL 和 publishable key
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
        <div class="modal-header"><span>确认</span><button class="modal-close">×</button></div>
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
        <div class="modal-header"><span>${title}</span><button class="modal-close">×</button></div>
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
  return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'''}[c]));
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
    const { data: check } = await sb.rpc('check_password', {
      username_arg: username,
      password_arg: password
    });
    if (!check) return { ok:false, msg:'密码错误' };
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

  // 登录并加载数据后，用学生名单的 id 对齐业务关联
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
    ? `<button class="btn-back" onclick="Router.go('${backHash}')">‹</button>`
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
    <p>${text || '暂无数据'}</p >
  </div>`;
}

function downloadExcel(filename, data, sheetName='Sheet1') {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

// ============== 应用入口 ==============
document.addEventListener('DOMContentLoaded', () => {
  Router.init();
});

// ============== 角色登录页 ==============
Router.register('', () => {
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
        </p >
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
      try { await Store.loadAll(); } catch (e) { console.error('加载数据失败', e); }
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
    case 'notify': return 0;
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
          <span class="li-arrow">›</span>
        </div>
        <div class="list-item" onclick="exportAllData()">
          <div class="li-main"><div class="li-title">导出数据备份</div><div class="li-desc">导出全部数据为JSON</div></div>
          <span class="li-arrow">›</span>
        </div>
        ${(u.role==='monitor'||u.role==='teacher') ? `
        <div class="list-item" onclick="Router.go('settings')">
          <div class="li-main"><div class="li-title">系统设置</div><div class="li-desc">账号管理、缴费规则、数据管理</div></div>
          <span class="li-arrow">›</span>
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

// ============== 模块1：班务通知 ==============
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
          n.images.map((img,i) => `<div class="ip-item" onclick="previewImage('${img}')">< img src="${img}"></div>`).join('')
        }</div></div></div>`:''}
        ${n.qr ? `<div class="card"><div class="card-header">二维码</div><div class="card-body qr-display" id="qrBox"></div></div>`:''}
        <div class="card">
          <div class="card-header">已读确认</div>
          <div class="card-body">
            ${u.role === 'student' ? (n.reads?.some(r=>r.stuId===u.id)
              ? '<span class="tag tag-success">您已确认阅读</span>'
              : `<button class="btn btn-primary" onclick="Notifications.confirmRead('${n.id}')">确认已读</button>`)
              : `<div class="text-small text-muted">已确认 ${readCount} 人</div>${this.renderReadList(n.reads||[])}`}
          </div>
        </div>
      </div>
      ${renderBottomNav('notify')}
    `;
    if (n.qr) {
      try { new QRCode($('#qrBox'), { text:n.qr, width:180, height:180 }); }
      catch { $('#qrBox').innerHTML = `<div class="text-small">${escapeHtml(n.qr)}</div>`; }
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
        <div class="modal-header"><span>发布通知</span><button class="modal-close">×</button></div>
        <div class="modal-body">
          <div class="form-group"><label>通知标题</label><input type="text" id="ntTitle" placeholder="请输入标题"></div>
          <div class="form-group"><label>通知内容</label><textarea id="ntContent" placeholder="请输入通知正文"></textarea></div>
          <div class="form-group"><label>二维码内容（可选）</label><input type="text" id="ntQr" placeholder="输入文字/链接生成二维码"></div>
          <div class="form-group"><label>图片（可选）</label><input type="file" id="ntImages" accept="image/*" multiple></div>
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
      const images = [];
      for (const f of imgFiles) { if (f.size > 2*1024*1024) { toast('图片超过2MB'); return; } images.push(await fileToBase64(f)); }
      const list = this.getList();
      const n = {
        id: uid(), title, content, qr, images, files: [],
        publisher: u.name, role: u.role, publishTime: now(), reads: [],
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
  overlay.innerHTML = `<div style="max-width:90%;max-height:80vh;">< img src="${src}" style="width:100%;border-radius:8px;"></div>`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function canManage() { return Auth.canManage(); }

// 路由
Router.register('notify', () => Notifications.renderList());
Router.register('notify/detail', (p) => Notifications.renderDetail(p[0]));
Router.register('subsidy', () => Subsidy.renderList());
Router.register('subsidy/detail', (p) => Subsidy.renderDetail(p[0]));
/* ========== 补助签字确认模块 ========== */
function renderSubsidy() {
    const isStudent = currentUser && currentUser.role === 'student';
    const isLeader = currentUser && currentUser.role === 'leader';
    const isTeacher = currentUser && currentUser.role === 'teacher';
    
    if (isStudent) return renderSubsidyStudent();
    return renderSubsidyManager();
    
    function renderSubsidyStudent() {
        const my = getMySubsidy();
        const items = getSubsidyItems();
        const sid = currentUser ? currentUser.id : '';
        const myItems = items.filter(function(it){ return it.stuId === sid; });
        const totalAmt = myItems.reduce(function(s,it){ return s + (Number(it.amount)||0); }, 0);
        const signedCount = myItems.filter(function(it){ return it.signed; }).length;
        
        return `
        <div class="page subsidy-page">
            <div class="page-head">
                <h2>补助签字确认</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            
            ${my ? `<div class="card tip-card">
                <div class="card-title">我的补助资格</div>
                <p class="tip-text">${escapeHtml(my.reason || '暂无说明')}</p >
            </div>` : ''}
            
            <div class="card stat-card">
                <div class="stat-num">${myItems.length}</div>
                <div class="stat-label">我的补助项目</div>
                <div class="stat-sub">已签字 ${signedCount} / ${myItems.length} 项</div>
            </div>
            
            <div class="card">
                <div class="card-title">补助明细（合计 ¥${totalAmt.toFixed(2)}）</div>
                ${myItems.length === 0 ? `<p class="empty">暂无可签字的补助项目</p >` : myItems.map(function(it){
                    const signed = it.signed;
                    return `<div class="subsidy-item ${signed?'signed':''}">
                        <div class="subsidy-info">
                            <div class="subsidy-name">${escapeHtml(it.name)}</div>
                            <div class="subsidy-amount">¥${(Number(it.amount)||0).toFixed(2)}</div>
                            <div class="subsidy-meta">${escapeHtml(it.category||'')}${it.note?' · '+escapeHtml(it.note):''}</div>
                        </div>
                        <div class="subsidy-act">
                            ${signed 
                                ? `<span class="badge ok">已签字</span>
                                   <button class="btn mini ghost" onclick="confirmUnsignSubsidy('${it.id}')">撤销</button>`
                                : `<button class="btn mini primary" onclick="signSubsidy('${it.id}')">电子签字</button>`}
                        </div>
                    </div>`;
                }).join('')}
            </div>
            <div class="safe-note">🔒 每项补助需本人电子签字确认，防止代签冒签，操作全程留痕</div>
        </div>`;
    }
    
    function renderSubsidyManager() {
        const items = getSubsidyItems();
        const students = getStudentList();
        const stats = getSubsidyStats();
        return `
        <div class="page subsidy-page">
            <div class="page-head">
                <h2>补助签字确认</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            
            <div class="card stat-card">
                <div class="stat-num">${items.length}</div>
                <div class="stat-label">补助项目数</div>
                <div class="stat-sub">覆盖 ${stats.studentCount} 人，已签 ${stats.signedCount} 人次</div>
            </div>
            
            ${isLeader ? `<button class="btn primary full" onclick="showSubsidyForm()">＋ 发布补助项目</button>` : ''}
            
            <div class="card">
                <div class="card-title">补助项目列表</div>
                ${items.length === 0 ? `<p class="empty">暂无补助项目</p >` : items.map(function(it){
                    const signedNum = (it.signedStuIds||[]).length;
                    return `<div class="subsidy-item ${signedNum>=it.stuIds.length?'signed':''}">
                        <div class="subsidy-info">
                            <div class="subsidy-name">${escapeHtml(it.name)}</div>
                            <div class="subsidy-amount">¥${(Number(it.amount)||0).toFixed(2)}</div>
                            <div class="subsidy-meta">${escapeHtml(it.category||'')} · 需签 ${it.stuIds.length} 人 · 已签 ${signedNum} 人</div>
                        </div>
                        <button class="btn mini ghost" onclick="router.go('subsidy/detail/${it.id}')">详情</button>
                    </div>`;
                }).join('')}
            </div>
            <div class="safe-note">🔒 签字数据实时统计，未签学生可一键查看提醒</div>
        </div>`;
    }
}
/* 补助详情页（管理端） */
function renderSubsidyDetail(id) {
    const it = store.data.subsidyItems ? store.data.subsidyItems.find(function(x){ return x.id === id; }) : null;
    if (!it) return `<div class="page"><p class="empty">未找到该补助项目</p ></div>`;
    const students = getStudentList();
    const signedNum = (it.signedStuIds||[]).length;
    return `
    <div class="page subsidy-page">
        <div class="page-head">
            <h2>补助详情</h2>
            <button class="icon-btn" onclick="router.go('subsidy')">←</button>
        </div>
        <div class="card">
            <div class="card-title">${escapeHtml(it.name)}</div>
            <p class="detail-line">金额：¥${(Number(it.amount)||0).toFixed(2)}</p >
            <p class="detail-line">类别：${escapeHtml(it.category||'')}</p >
            <p class="detail-line">已签：${signedNum} / ${it.stuIds.length} 人</p >
            ${it.note?`<p class="detail-line">备注：${escapeHtml(it.note)}</p >`:''}
        </div>
        <div class="card">
            <div class="card-title">签字进度</div>
            ${it.stuIds.map(function(sid){
                const st = students.find(function(s){ return s.id === sid; });
                const name = st ? st.name : sid;
                const signed = (it.signedStuIds||[]).indexOf(sid) !== -1;
                const sig = it.signs && it.signs[sid];
                return `<div class="sign-row">
                    <span class="sign-name">${escapeHtml(name)}</span>
                    ${signed 
                        ? `<span class="badge ok">已签 ${sig && sig.time ? fmtTime(sig.time) : ''}</span>`
                        : `<span class="badge warn">未签</span>`}
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

function getMySubsidy() {
    if (!currentUser) return null;
    const list = store.data.subsidyQuals || [];
    return list.find(function(q){ return q.stuId === currentUser.id; }) || null;
}

function getSubsidyItems() {
    return store.data.subsidyItems || [];
}

function getSubsidyStats() {
    const items = getSubsidyItems();
    let studentCount = 0, signedCount = 0;
    items.forEach(function(it){
        studentCount += (it.stuIds||[]).length;
        signedCount += (it.signedStuIds||[]).length;
    });
    return { studentCount: studentCount, signedCount: signedCount };
}

function showSubsidyForm() {
    const students = getStudentList();
    openModal(`
        <h3>发布补助项目</h3>
        <div class="field"><label>项目名称</label><input id="sf-name" placeholder="如：国家助学金" /></div>
        <div class="field"><label>金额（元）</label><input id="sf-amount" type="number" step="0.01" placeholder="如：2000" /></div>
        <div class="field"><label>类别</label><select id="sf-cat">
            <option>国家助学金</option><option>校内补助</option><option>困难补助</option><option>其他</option>
        </select></div>
        <div class="field"><label>备注</label><input id="sf-note" placeholder="选填" /></div>
        <div class="field"><label>适用学生（${students.length}人，默认全选）</label>
            <div class="check-scroll">
                ${students.map(function(s,i){
                    return `<label class="check-row"><input type="checkbox" class="sf-stu" value="${s.id}" checked /> ${escapeHtml(s.name)}（${escapeHtml(s.studentNo||'')}）</label>`;
                }).join('')}
            </div>
        </div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveSubsidy()">发布</button>
        </div>
    `);
}

function saveSubsidy() {
    const name = val('sf-name'); const amount = Number(val('sf-amount'));
    if (!name || !amount) return toast('请填写项目名称和金额');
    const stuIds = Array.from(document.querySelectorAll('.sf-stu:checked')).map(function(c){ return c.value; });
    if (!stuIds.length) return toast('请至少选择一名学生');
    const item = {
        id: 'sub' + Date.now(),
        name: name, amount: amount,
        category: val('sf-cat'), note: val('sf-note'),
        stuIds: stuIds, signedStuIds: [], signs: {},
        createBy: currentUser ? currentUser.id : '', createName: currentUser ? currentUser.name : '',
        createTime: Date.now(), locked: false
    };
    store.data.subsidyItems = store.data.subsidyItems || [];
    store.data.subsidyItems.unshift(item);
    addLog('发布补助项目', name + ' ¥' + amount, 'subsidy');
    pushNotify('补助通知', '新补助项目「' + name + '」已发布，请相关同学签字确认', 'subsidy');
    closeModal();
    toast('补助项目已发布');
    router.render();
}

function signSubsidy(id) {
    if (!currentUser) return toast('请先登录');
    const item = (store.data.subsidyItems||[]).find(function(x){ return x.id === id; });
    if (!item) return toast('未找到该项目');
    if (item.locked) return toast('该项目已锁定，无法签字');
    if ((item.signedStuIds||[]).indexOf(currentUser.id) !== -1) return toast('您已签字');
    openSignModal(function(base64){
        item.signedStuIds = item.signedStuIds || [];
        item.signs = item.signs || {};
        item.signedStuIds.push(currentUser.id);
        item.signs[currentUser.id] = { sig: base64, time: Date.now(), name: currentUser.name };
        addLog('补助电子签字', item.name, 'subsidy', currentUser);
        pushNotify('补助签字', currentUser.name + ' 已对「' + item.name + '」签字确认', 'subsidy');
        store.save();
        toast('签字成功');
        router.render();
    });
}

function confirmUnsignSubsidy(id) {
    if (!currentUser) return;
    if (!confirm('确定撤销对「补助」的签字吗？')) return;
    const item = (store.data.subsidyItems||[]).find(function(x){ return x.id === id; });
    if (!item) return;
    if (item.locked) return toast('该项目已锁定，无法撤销');
    item.signedStuIds = (item.signedStuIds||[]).filter(function(s){ return s !== currentUser.id; });
    if (item.signs) delete item.signs[currentUser.id];
    addLog('撤销补助签字', item.name, 'subsidy');
    store.save(); toast('已撤销签字'); router.render();
}

/* 电子签字弹窗（通用） */
function openSignModal(cb) {
    const wrap = document.createElement('div');
    wrap.className = 'sign-modal';
    wrap.innerHTML = `
        <div class="sign-box">
            <h3>电子签字确认</h3>
            <p class="sign-tip">请在本区域手写签名（用手指或鼠标书写）</p >
            <canvas id="sign-canvas" width="300" height="120"></canvas>
            <div class="modal-btns">
                <button class="btn ghost" onclick="clearSign()">清除</button>
                <button class="btn primary" onclick="confirmSign()">确认签字</button>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
    const cv = wrap.querySelector('#sign-canvas');
    const ctx = cv.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a4d8f';
    let drawing = false, hasInk = false;
    function pos(e){ const r = cv.getBoundingClientRect(); return { x:(e.clientX||e.touches[0].clientX)-r.left, y:(e.clientY||e.touches[0].clientY)-r.top }; }
    cv.addEventListener('mousedown', function(e){ drawing = true; hasInk = true; ctx.beginPath(); ctx.moveTo(pos(e).x, pos(e).y); });
    cv.addEventListener('mousemove', function(e){ if(!drawing)return; ctx.lineTo(pos(e).x, pos(e).y); ctx.stroke(); });
    cv.addEventListener('mouseup', function(){ drawing = false; });
    cv.addEventListener('touchstart', function(e){ e.preventDefault(); drawing = true; hasInk = true; ctx.beginPath(); ctx.moveTo(pos(e).x, pos(e).y); });
    cv.addEventListener('touchmove', function(e){ e.preventDefault(); if(!drawing)return; ctx.lineTo(pos(e).x, pos(e).y); ctx.stroke(); });
    cv.addEventListener('touchend', function(){ drawing = false; });
    wrap.dataset.hasInk = 'false';
    window.__signCb = cb;
    window.__signCv = cv;
    window.__signHasInk = function(){ return hasInk; };
}

function clearSign() {
    const cv = window.__signCv;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    window.__signHasInk = function(){ return false; };
}

function confirmSign() {
    if (!window.__signHasInk || !window.__signHasInk()) return toast('请先手写签名');
    const cv = window.__signCv;
    const data = cv.toDataURL('image/png');
    document.querySelector('.sign-modal').remove();
    const cb = window.__signCb;
    window.__signCb = null; window.__signCv = null;
    if (cb) cb(data);
}
/* ========== 学费住宿费缴费核对模块 ========== */
function renderPayment() {
    const isStudent = currentUser && currentUser.role === 'student';
    const isLeader = currentUser && currentUser.role === 'leader';
    const isTeacher = currentUser && currentUser.role === 'teacher';
    
    if (isStudent) return renderPaymentStudent();
    return renderPaymentManager();
    
    function renderPaymentStudent() {
        const sid = currentUser ? currentUser.id : '';
        const rows = getPaymentRows().filter(function(r){ return r.stuId === sid; });
        const paidCount = rows.filter(function(r){ return r.paid; }).length;
        const total = rows.reduce(function(s,r){ return s + (Number(r.amount)||0); }, 0);
        const paidTotal = rows.filter(function(r){return r.paid;}).reduce(function(s,r){ return s + (Number(r.amount)||0); }, 0);
        return `
        <div class="page payment-page">
            <div class="page-head">
                <h2>缴费核对</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card stat-card">
                <div class="stat-num">${paidCount}/${rows.length}</div>
                <div class="stat-label">已缴费用项</div>
                <div class="stat-sub">已缴 ¥${paidTotal.toFixed(2)} / 合计 ¥${total.toFixed(2)}</div>
            </div>
            <div class="card">
                <div class="card-title">我的缴费记录</div>
                ${rows.length === 0 ? `<p class="empty">暂无可核对的缴费项目</p >` : rows.map(function(r){
                    return `<div class="pay-row ${r.paid?'paid':''}">
                        <div class="pay-info">
                            <div class="pay-name">${escapeHtml(r.type)}</div>
                            <div class="pay-amount">¥${(Number(r.amount)||0).toFixed(2)}</div>
                            <div class="pay-meta">${r.paid ? ('已缴' + (r.payTime?fmtTime(r.payTime):'') ) : '未缴'}</div>
                        </div>
                        ${r.paid ? `<span class="badge ok">已缴</span>` : `<button class="btn mini primary" onclick="confirmMyPay('${r.id}')">我已完成缴费</button>`}
                    </div>`;
                }).join('')}
            </div>
            <div class="safe-note">🔒 缴费确认由班长核实，全程留痕可查</div>
        </div>`;
    }
    
    function renderPaymentManager() {
        const rows = getPaymentRows();
        const students = getStudentList();
        const paidCount = rows.filter(function(r){ return r.paid; }).length;
        return `
        <div class="page payment-page">
            <div class="page-head">
                <h2>缴费核对</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card stat-card">
                <div class="stat-num">${rows.length}</div>
                <div class="stat-label">缴费记录</div>
                <div class="stat-sub">已确认 ${paidCount} 条</div>
            </div>
            ${isLeader ? `<button class="btn primary full" onclick="showPayForm()">＋ 录入缴费记录</button>` : ''}
            <div class="card">
                <div class="card-title">缴费记录列表</div>
                ${rows.length === 0 ? `<p class="empty">暂无缴费记录</p >` : rows.map(function(r){
                    const st = students.find(function(s){ return s.id === r.stuId; });
                    const name = st ? st.name : r.stuId;
                    return `<div class="pay-row ${r.paid?'paid':''}">
                        <div class="pay-info">
                            <div class="pay-name">${escapeHtml(r.type)} · ${escapeHtml(name)}</div>
                            <div class="pay-amount">¥${(Number(r.amount)||0).toFixed(2)}</div>
                            <div class="pay-meta">${r.paid ? '已确认 ' + fmtTime(r.payTime) : '未缴'}</div>
                        </div>
                        ${r.paid 
                            ? `<span class="badge ok">已缴</span>`
                            : (isLeader ? `<button class="btn mini primary" onclick="confirmPay('${r.id}')">确认已缴</button>` : `<span class="badge warn">未缴</span>`)}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }
}

function getPaymentRows() { return store.data.paymentRows || []; }

function showPayForm() {
    const students = getStudentList();
    openModal(`
        <h3>录入缴费记录</h3>
        <div class="field"><label>学生</label><select id="pf-stu">
            ${students.map(function(s){ return `<option value="${s.id}">${escapeHtml(s.name)}（${escapeHtml(s.studentNo||'')}）</option>`; }).join('')}
        </select></div>
        <div class="field"><label>费用类型</label><select id="pf-type">
            <option>学费</option><option>住宿费</option><option>教材费</option><option>其他</option>
        </select></div>
        <div class="field"><label>金额（元）</label><input id="pf-amount" type="number" step="0.01" /></div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="savePay()">保存</button>
        </div>
    `);
}

function savePay() {
    const stuId = val('pf-stu'); const type = val('pf-type'); const amount = Number(val('pf-amount'));
    if (!stuId || !amount) return toast('请选择学生并填写金额');
    store.data.paymentRows = store.data.paymentRows || [];
    store.data.paymentRows.unshift({
        id: 'pay' + Date.now(), stuId: stuId, type: type, amount: amount,
        paid: false, payTime: null, createBy: currentUser ? currentUser.id : '', createTime: Date.now()
    });
    addLog('录入缴费记录', type + ' ¥' + amount, 'payment');
    store.save(); closeModal(); toast('已录入'); router.render();
}

function confirmMyPay(id) {
    if (!currentUser) return;
    if (!confirm('请确认您已完成该费用缴纳？')) return;
    const row = (store.data.paymentRows||[]).find(function(r){ return r.id === id; });
    if (!row) return;
    if (row.paid) return toast('该记录已确认');
    row.paid = true; row.payTime = Date.now();
    addLog('学生确认缴费', row.type + ' ¥' + row.amount, 'payment');
    pushNotify('缴费确认', currentUser.name + ' 确认完成「' + row.type + '」缴纳，请班长核实', 'payment');
    store.save(); toast('已登记，待班长核实'); router.render();
}

function confirmPay(id) {
    const row = (store.data.paymentRows||[]).find(function(r){ return r.id === id; });
    if (!row) return;
    row.paid = true; row.payTime = Date.now();
    addLog('班长核实缴费', row.type + ' ¥' + row.amount, 'payment');
    store.save(); toast('已确认'); router.render();
}
/* ========== 考勤管理模块 ========== */
function renderAttendance() {
    const isStudent = currentUser && currentUser.role === 'student';
    const isLeader = currentUser && currentUser.role === 'leader';
    const isTeacher = currentUser && currentUser.role === 'teacher';
    
    if (isStudent) return renderAttendanceStudent();
    return renderAttendanceManager();
    
    function renderAttendanceStudent() {
        const sid = currentUser ? currentUser.id : '';
        const recs = getAttendanceRecs().filter(function(r){ return r.stuId === sid; });
        const absCount = recs.filter(function(r){ return r.status === '缺勤' || r.status === '迟到'; }).length;
        const present = recs.filter(function(r){ return r.status === '出勤'; }).length;
        return `
        <div class="page att-page">
            <div class="page-head">
                <h2>考勤管理</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card stat-card">
                <div class="stat-num">${present}/${recs.length}</div>
                <div class="stat-label">出勤记录</div>
                <div class="stat-sub">缺勤/迟到 ${absCount} 次</div>
            </div>
            <div class="card">
                <div class="card-title">我的考勤记录</div>
                ${recs.length === 0 ? `<p class="empty">暂无考勤记录</p >` : recs.map(function(r){
                    const cls = r.status==='出勤'?'ok':(r.status==='迟到'?'warn':'bad');
                    return `<div class="att-row">
                        <div class="att-date">${fmtDate(r.date)}</div>
                        <div class="att-course">${escapeHtml(r.course||'日常考勤')}</div>
                        <span class="badge ${cls}">${escapeHtml(r.status)}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }
    
    function renderAttendanceManager() {
        const recs = getAttendanceRecs();
        const students = getStudentList();
        const today = todayStr();
        const todayRecs = recs.filter(function(r){ return r.date === today; });
        const absToday = todayRecs.filter(function(r){ return r.status === '缺勤'; }).length;
        return `
        <div class="page att-page">
            <div class="page-head">
                <h2>考勤管理</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card stat-card">
                <div class="stat-num">${recs.length}</div>
                <div class="stat-label">累计考勤记录</div>
                <div class="stat-sub">今日缺勤 ${absToday} 人</div>
            </div>
            ${isLeader ? `<button class="btn primary full" onclick="showAttForm()">＋ 录入今日考勤</button>` : ''}
            <div class="card">
                <div class="card-title">考勤记录</div>
                ${recs.length === 0 ? `<p class="empty">暂无考勤记录</p >` : recs.map(function(r){
                    const st = students.find(function(s){ return s.id === r.stuId; });
                    const name = st ? st.name : r.stuId;
                    const cls = r.status==='出勤'?'ok':(r.status==='迟到'?'warn':'bad');
                    return `<div class="att-row">
                        <div class="att-date">${fmtDate(r.date)}</div>
                        <div class="att-course">${escapeHtml(name)} · ${escapeHtml(r.course||'日常考勤')}</div>
                        <span class="badge ${cls}">${escapeHtml(r.status)}</span>
                    </div>`;
                }).join('')}
            </div>
            <button class="btn ghost full" onclick="exportAll()">📤 导出全部数据</button>
        </div>`;
    }
}

function getAttendanceRecs() { return store.data.attendanceRecs || []; }

function showAttForm() {
    const students = getStudentList();
    const today = todayStr();
    openModal(`
        <h3>录入今日考勤</h3>
        <p class="sign-tip">日期：${today}（自动记录今日，可修改）</p >
        <div class="field"><label>日期</label><input id="af-date" type="date" value="${today}" /></div>
        <div class="field"><label>课程/事项</label><input id="af-course" value="日常考勤" /></div>
        <div class="field"><label>学生考勤（默认出勤，可点击修改）</label>
            <div class="check-scroll">
                ${students.map(function(s){
                    return `<div class="att-line">
                        <span class="att-name">${escapeHtml(s.name)}（${escapeHtml(s.studentNo||'')}）</span>
                        <select class="af-status" data-id="${s.id}">
                            <option value="出勤">出勤</option>
                            <option value="迟到">迟到</option>
                            <option value="缺勤">缺勤</option>
                            <option value="请假">请假</option>
                        </select>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveAtt()">保存</button>
        </div>
    `);
}

function saveAtt() {
    const date = val('af-date'); const course = val('af-course') || '日常考勤';
    if (!date) return toast('请选择日期');
    // 防重复：同一学生同一天同一课程只能一条
    store.data.attendanceRecs = (store.data.attendanceRecs||[]).filter(function(r){
        return !(r.date === date && r.course === course);
    });
    document.querySelectorAll('.af-status').forEach(function(sel){
        const stuId = sel.getAttribute('data-id');
        const status = sel.value;
        store.data.attendanceRecs.unshift({
            id: 'att' + Date.now() + Math.random().toString(36).slice(2,6),
            date: date, course: course, stuId: stuId, status: status,
            createBy: currentUser ? currentUser.id : '', createName: currentUser ? currentUser.name : '',
            createTime: Date.now()
        });
    });
    addLog('录入考勤', date + ' ' + course, 'attendance');
    pushNotify('考勤通知', date + ' 考勤已录入，请查看', 'attendance');
    store.save(); closeModal(); toast('考勤已保存'); router.render();
}

/* 通用工具补充 */
function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
/* ========== 考勤管理模块（完整） ========== */
function renderAttendance() {
    const isStudent = currentUser && currentUser.role === 'student';
    const isLeader = currentUser && currentUser.role === 'leader';
    const isTeacher = currentUser && currentUser.role === 'teacher';
    
    if (isStudent) return renderAttendanceStudent();
    return renderAttendanceManager();
    
    function renderAttendanceStudent() {
        const sid = currentUser ? currentUser.id : '';
        const recs = getAttendanceRecs().filter(function(r){ return r.stuId === sid; });
        const absCount = recs.filter(function(r){ return r.status === '缺勤' || r.status === '迟到'; }).length;
        const present = recs.filter(function(r){ return r.status === '出勤'; }).length;
        return `
        <div class="page att-page">
            <div class="page-head">
                <h2>考勤管理</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card stat-card">
                <div class="stat-num">${present}/${recs.length}</div>
                <div class="stat-label">出勤记录</div>
                <div class="stat-sub">缺勤/迟到 ${absCount} 次</div>
            </div>
            <div class="card">
                <div class="card-title">我的考勤记录</div>
                ${recs.length === 0 ? `<p class="empty">暂无考勤记录</p >` : recs.map(function(r){
                    const cls = r.status==='出勤'?'ok':(r.status==='迟到'?'warn':'bad');
                    return `<div class="att-row">
                        <div class="att-date">${fmtDate(r.date)}</div>
                        <div class="att-course">${escapeHtml(r.course||'日常考勤')}</div>
                        <span class="badge ${cls}">${escapeHtml(r.status)}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }
    
    function renderAttendanceManager() {
        const recs = getAttendanceRecs();
        const students = getStudentList();
        const today = todayStr();
        const todayRecs = recs.filter(function(r){ return r.date === today; });
        const absToday = todayRecs.filter(function(r){ return r.status === '缺勤'; }).length;
        return `
        <div class="page att-page">
            <div class="page-head">
                <h2>考勤管理</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card stat-card">
                <div class="stat-num">${recs.length}</div>
                <div class="stat-label">累计考勤记录</div>
                <div class="stat-sub">今日缺勤 ${absToday} 人</div>
            </div>
            ${isLeader ? `<button class="btn primary full" onclick="showAttForm()">＋ 录入今日考勤</button>` : ''}
            <div class="card">
                <div class="card-title">考勤记录</div>
                ${recs.length === 0 ? `<p class="empty">暂无考勤记录</p >` : recs.map(function(r){
                    const st = students.find(function(s){ return s.id === r.stuId; });
                    const name = st ? st.name : r.stuId;
                    const cls = r.status==='出勤'?'ok':(r.status==='迟到'?'warn':'bad');
                    return `<div class="att-row">
                        <div class="att-date">${fmtDate(r.date)}</div>
                        <div class="att-course">${escapeHtml(name)} · ${escapeHtml(r.course||'日常考勤')}</div>
                        <span class="badge ${cls}">${escapeHtml(r.status)}</span>
                    </div>`;
                }).join('')}
            </div>
            <button class="btn ghost full" onclick="exportAll()">📤 导出全部数据</button>
        </div>`;
    }
}

function getAttendanceRecs() { return store.data.attendanceRecs || []; }

function showAttForm() {
    const students = getStudentList();
    const today = todayStr();
    openModal(`
        <h3>录入今日考勤</h3>
        <p class="sign-tip">日期：${today}（自动记录今日，可修改）</p >
        <div class="field"><label>日期</label><input id="af-date" type="date" value="${today}" /></div>
        <div class="field"><label>课程/事项</label><input id="af-course" value="日常考勤" /></div>
        <div class="field"><label>学生考勤（默认出勤，可点击修改）</label>
            <div class="check-scroll">
                ${students.map(function(s){
                    return `<div class="att-line">
                        <span class="att-name">${escapeHtml(s.name)}（${escapeHtml(s.studentNo||'')}）</span>
                        <select class="af-status" data-id="${s.id}">
                            <option value="出勤">出勤</option>
                            <option value="迟到">迟到</option>
                            <option value="缺勤">缺勤</option>
                            <option value="请假">请假</option>
                        </select>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveAtt()">保存</button>
        </div>
    `);
}

function saveAtt() {
    const date = val('af-date'); const course = val('af-course') || '日常考勤';
    if (!date) return toast('请选择日期');
    // 防重复：同一学生同一天同一课程只能一条
    store.data.attendanceRecs = (store.data.attendanceRecs||[]).filter(function(r){
        return !(r.date === date && r.course === course);
    });
    document.querySelectorAll('.af-status').forEach(function(sel){
        const stuId = sel.getAttribute('data-id');
        const status = sel.value;
        store.data.attendanceRecs.unshift({
            id: 'att' + Date.now() + Math.random().toString(36).slice(2,6),
            date: date, course: course, stuId: stuId, status: status,
            createBy: currentUser ? currentUser.id : '', createName: currentUser ? currentUser.name : '',
            createTime: Date.now()
        });
    });
    addLog('录入考勤', date + ' ' + course, 'attendance');
    pushNotify('考勤通知', date + ' 考勤已录入，请查看', 'attendance');
    store.save(); closeModal(); toast('考勤已保存'); router.render();
}

/* 通用日期工具 */
function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
/* ========== 矛盾纠纷调解模块 ========== */
function renderDispute() {
    const isStudent = currentUser && currentUser.role === 'student';
    const isLeader = currentUser && currentUser.role === 'leader';
    const isTeacher = currentUser && currentUser.role === 'teacher';
    
    if (isStudent) return renderDisputeStudent();
    return renderDisputeManager();
    
    function renderDisputeStudent() {
        const sid = currentUser ? currentUser.id : '';
        const mine = getDisputes().filter(function(d){
            return (d.stuIds||[]).indexOf(sid) !== -1;
        });
        return `
        <div class="page dispute-page">
            <div class="page-head">
                <h2>矛盾纠纷调解</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="privacy-tip">🔒 纠纷内容仅本人、班长、班主任可见，他人无法查看，保护个人隐私</div>
            <button class="btn primary full" onclick="showDisputeForm()">＋ 提交纠纷调解申请</button>
            <div class="card">
                <div class="card-title">我的纠纷记录（${mine.length}）</div>
                ${mine.length === 0 ? `<p class="empty">暂无纠纷记录</p >` : mine.map(function(d){
                    const st = (d.status==='调解中'||!d.status)?'warn':(d.status==='已调解'?'ok':'bad');
                    return `<div class="dis-row" onclick="router.go('dispute/detail/${d.id}')">
                        <div class="dis-title">${escapeHtml(d.title||'纠纷')}</div>
                        <div class="dis-meta">${fmtDate(d.createTime)}</div>
                        <span class="badge ${st}">${escapeHtml(d.status||'调解中')}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }
    
    function renderDisputeManager() {
        const list = getDisputes();
        const pending = list.filter(function(d){ return d.status==='调解中'||!d.status; }).length;
        return `
        <div class="page dispute-page">
            <div class="page-head">
                <h2>矛盾纠纷调解</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="privacy-tip">🔒 纠纷内容仅本人、班长、班主任可见，保护个人隐私</div>
            <div class="card stat-card">
                <div class="stat-num">${pending}</div>
                <div class="stat-label">待调解纠纷</div>
                <div class="stat-sub">共 ${list.length} 条</div>
            </div>
            <div class="card">
                <div class="card-title">纠纷列表</div>
                ${list.length === 0 ? `<p class="empty">暂无纠纷记录</p >` : list.map(function(d){
                    const st = (d.status==='调解中'||!d.status)?'warn':(d.status==='已调解'?'ok':'bad');
                    return `<div class="dis-row" onclick="router.go('dispute/detail/${d.id}')">
                        <div class="dis-title">${escapeHtml(d.title||'纠纷')}</div>
                        <div class="dis-meta">${escapeHtml(d.stuNames||'')} · ${fmtDate(d.createTime)}</div>
                        <span class="badge ${st}">${escapeHtml(d.status||'调解中')}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }
}

function getDisputes() { return store.data.disputes || []; }

function showDisputeForm() {
    const students = getStudentList();
    openModal(`
        <h3>提交纠纷调解申请</h3>
        <div class="field"><label>标题</label><input id="dp-title" placeholder="简述纠纷事项" /></div>
        <div class="field"><label>涉及同学（可多选）</label>
            <div class="check-scroll">
                ${students.map(function(s){
                    return `<label class="check-row"><input type="checkbox" class="dp-stu" value="${s.id}" /> ${escapeHtml(s.name)}（${escapeHtml(s.studentNo||'')}）</label>`;
                }).join('')}
            </div>
        </div>
        <div class="field"><label>纠纷详细描述</label><textarea id="dp-cause" rows="4" placeholder="请描述纠纷经过，内容将加密保存，仅相关人员可见"></textarea></div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveDispute()">提交</button>
        </div>
    `);
}

function saveDispute() {
    if (!currentUser) return toast('请先登录');
    const title = val('dp-title'); const cause = val('dp-cause');
    if (!title || !cause) return toast('请填写标题和详细描述');
    const stuIds = Array.from(document.querySelectorAll('.dp-stu:checked')).map(function(c){ return c.value; });
    if (stuIds.indexOf(currentUser.id) === -1) stuIds.unshift(currentUser.id);
    const students = getStudentList();
    const stuNames = stuIds.map(function(id){ const s = students.find(function(x){return x.id===id;}); return s?s.name:id; }).join('、');
    const d = {
        id: 'dp' + Date.now(),
        title: title,
        causeEnc: encodeBase64(cause),
        stuIds: stuIds, stuNames: stuNames,
        status: '调解中',
        createBy: currentUser.id, createName: currentUser.name,
        createTime: Date.now(),
        logs: [{ time: Date.now(), who: currentUser.name, action: '提交纠纷申请' }]
    };
    store.data.disputes = store.data.disputes || [];
    store.data.disputes.unshift(d);
    addLog('提交纠纷申请', title, 'dispute');
    pushNotify('纠纷调解', currentUser.name + ' 提交了纠纷调解申请，请尽快处理', 'dispute');
    store.save(); closeModal(); toast('已提交，等待调解'); router.render();
}

function renderDisputeDetail(id) {
    const d = getDisputes().find(function(x){ return x.id === id; });
    if (!d) return `<div class="page"><p class="empty">未找到该纠纷</p ></div>`;
    const canView = currentUser && (currentUser.role !== 'student' || (d.stuIds||[]).indexOf(currentUser.id) !== -1);
    if (!canView) return `<div class="page"><p class="empty">无权查看该纠纷记录</p ></div>`;
    let cause = '';
    try { cause = decodeBase64(d.causeEnc); } catch(e) { cause = ''; }
    return `
    <div class="page dispute-page">
        <div class="page-head">
            <h2>纠纷详情</h2>
            <button class="icon-btn" onclick="router.go('dispute')">←</button>
        </div>
        <div class="card">
            <div class="card-title">${escapeHtml(d.title||'纠纷')}</div>
            <p class="detail-line">涉及同学：${escapeHtml(d.stuNames||'')}</p >
            <p class="detail-line">状态：${escapeHtml(d.status||'调解中')}</p >
            <p class="detail-line">提交：${escapeHtml(d.createName||'')} · ${fmtTime(d.createTime)}</p >
        </div>
        <div class="card">
            <div class="card-title">详细描述</div>
            <p class="detail-text">${escapeHtml(cause||'（无）')}</p >
        </div>
        ${currentUser && currentUser.role !== 'student' ? `
        <div class="card">
            <div class="card-title">调解处理</div>
            <div class="field"><label>处理结果</label><textarea id="dp-result" rows="3" placeholder="填写调解结果">${d.result?escapeHtml(d.result):''}</textarea></div>
            <div class="modal-btns">
                <button class="btn ghost" onclick="closeDispute('${id}')">标记已调解</button>
                <button class="btn primary" onclick="saveDisputeResult('${id}')">保存结果</button>
            </div>
        </div>` : ''}
        <div class="card">
            <div class="card-title">处理记录</div>
            ${(d.logs||[]).map(function(l){
                return `<div class="log-row"><span class="log-who">${escapeHtml(l.who)}</span><span class="log-act">${escapeHtml(l.action)}</span><span class="log-time">${fmtTime(l.time)}</span></div>`;
            }).join('') || `<p class="empty">暂无处理记录</p >`}
        </div>
    </div>`;
}

function saveDisputeResult(id) {
    const d = getDisputes().find(function(x){ return x.id === id; });
    if (!d) return;
    d.result = val('dp-result');
    d.logs = d.logs || [];
    d.logs.push({ time: Date.now(), who: currentUser.name, action: '保存调解结果' });
    addLog('保存调解结果', d.title, 'dispute');
    store.save(); toast('已保存'); router.render();
}

function closeDispute(id) {
    const d = getDisputes().find(function(x){ return x.id === id; });
    if (!d) return;
    if (!confirm('确认标记该纠纷为已调解吗？')) return;
    d.status = '已调解';
    d.logs = d.logs || [];
    d.logs.push({ time: Date.now(), who: currentUser.name, action: '标记已调解' });
    addLog('调解完成', d.title, 'dispute');
    pushNotify('纠纷调解', '纠纷「' + (d.title||'') + '」已调解完成', 'dispute');
    store.save(); toast('已标记调解完成'); router.render();
}

/* base64 编解码（用于纠纷隐私加密） */
function encodeBase64(str) {
    try { return btoa(unescape(encodeURIComponent(str))); }
    catch(e) { return ''; }
}

function decodeBase64(b64) {
    try { return decodeURIComponent(escape(atob(b64))); }
    catch(e) { return ''; }
}
/* ========== 宿舍情况记录模块 ========== */
function renderDorm() {
    const isStudent = currentUser && currentUser.role === 'student';
    const isLeader = currentUser && currentUser.role === 'leader';
    const isTeacher = currentUser && currentUser.role === 'teacher';
    
    if (isStudent) return renderDormStudent();
    return renderDormManager();
    
    function renderDormStudent() {
        const sid = currentUser ? currentUser.id : '';
        const myDorm = getDormList().find(function(r){ return r.room; });
        const recs = getDormRecs().filter(function(r){ return (r.stuIds||[]).indexOf(sid) !== -1 || r.room === (myDorm?myDorm.room:''); });
        return `
        <div class="page dorm-page">
            <div class="page-head">
                <h2>宿舍情况记录</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card">
                <div class="card-title">我的宿舍</div>
                ${myDorm ? `<p class="detail-line">宿舍：${escapeHtml(myDorm.room)}</p ><p class="detail-line">床位：${escapeHtml(myDorm.bed||'')}</p >` : `<p class="empty">暂未分配宿舍</p >`}
            </div>
            <div class="card">
                <div class="card-title">宿舍情况记录</div>
                ${recs.length === 0 ? `<p class="empty">暂无记录</p >` : recs.map(function(r){
                    return `<div class="dorm-row">
                        <div class="dorm-date">${fmtDate(r.date)}</div>
                        <div class="dorm-type">${escapeHtml(r.type||'日常检查')}</div>
                        <div class="dorm-note">${escapeHtml(r.note||'')}</div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }
    
    function renderDormManager() {
        const dorms = getDormList();
        const recs = getDormRecs();
        return `
        <div class="page dorm-page">
            <div class="page-head">
                <h2>宿舍情况记录</h2>
                <button class="icon-btn" onclick="router.go('home')">⌂</button>
            </div>
            <div class="card stat-card">
                <div class="stat-num">${dorms.length}</div>
                <div class="stat-label">宿舍间数</div>
                <div class="stat-sub">共 ${recs.length} 条记录</div>
            </div>
            ${isLeader ? `<button class="btn primary full" onclick="showDormRecordForm()">＋ 记录宿舍情况</button>` : ''}
            <div class="card">
                <div class="card-title">宿舍列表</div>
                ${dorms.length === 0 ? `<p class="empty">暂无宿舍信息</p >` : dorms.map(function(r){
                    const rec = recs.filter(function(x){ return x.room === r.room; }).pop();
                    return `<div class="dorm-row" onclick="router.go('dorm/detail/${encodeURIComponent(r.room)}')">
                        <div class="dorm-date">${escapeHtml(r.room)}</div>
                        <div class="dorm-note">${escapeHtml(r.memberNames||'')}</div>
                        ${rec ? `<span class="badge ok">${fmtDate(rec.date)}</span>` : `<span class="badge warn">无记录</span>`}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }
}

function getDormList() { return store.data.dormList || []; }
function getDormRecs() { return store.data.dormRecs || []; }

function showDormRecordForm() {
    const dorms = getDormList();
    openModal(`
        <h3>记录宿舍情况</h3>
        <div class="field"><label>宿舍</label><select id="dm-room">
            ${dorms.length === 0 ? `<option value="">（暂无宿舍，请先在台账录入）</option>` : dorms.map(function(r){ return `<option value="${r.room}">${escapeHtml(r.room)}</option>`; }).join('')}
        </select></div>
        <div class="field"><label>类型</label><select id="dm-type">
            <option>日常检查</option><option>卫生检查</option><option>安全检查</option><option>设施报修</option><option>其他</option>
        </select></div>
        <div class="field"><label>情况说明</label><textarea id="dm-note" rows="3" placeholder="填写宿舍情况说明"></textarea></div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveDormRecord()">保存</button>
        </div>
    `);
}

function saveDormRecord() {
    const room = val('dm-room'); const type = val('dm-type'); const note = val('dm-note');
    if (!room) return toast('请选择宿舍');
    if (!note) return toast('请填写情况说明');
    store.data.dormRecs = store.data.dormRecs || [];
    store.data.dormRecs.unshift({
        id: 'dm' + Date.now(), room: room, type: type, note: note,
        createBy: currentUser ? currentUser.id : '', createName: currentUser ? currentUser.name : '',
        createTime: Date.now()
    });
    addLog('记录宿舍情况', room + ' · ' + type, 'dorm');
    store.save(); closeModal(); toast('已记录'); router.render();
}

function renderDormDetail(room) {
    const r = room ? decodeURIComponent(room) : '';
    const recs = getDormRecs().filter(function(x){ return x.room === r; });
    const dorm = getDormList().find(function(x){ return x.room === r; });
    return `
    <div class="page dorm-page">
        <div class="page-head">
            <h2>宿舍 ${escapeHtml(r)}</h2>
            <button class="icon-btn" onclick="router.go('dorm')">←</button>
        </div>
        <div class="card">
            <div class="card-title">成员</div>
            <p class="detail-line">${dorm ? escapeHtml(dorm.memberNames||'') : '（未登记）'}</p >
        </div>
        <div class="card">
            <div class="card-title">情况记录（${recs.length}）</div>
            ${recs.length === 0 ? `<p class="empty">暂无记录</p >` : recs.map(function(x){
                return `<div class="dorm-row">
                    <div class="dorm-date">${fmtDate(x.date)}</div>
                    <div class="dorm-type">${escapeHtml(x.type||'')}</div>
                    <div class="dorm-note">${escapeHtml(x.note||'')}</div>
                    <div class="dorm-meta">${escapeHtml(x.createName||'')} · ${fmtTime(x.createTime)}</div>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}
/* ========== 台账表格模块 ========== */
function renderLedger() {
    const isLeader = currentUser && currentUser.role === 'leader';
    const tables = getLedgerTables();
    return `
    <div class="page ledger-page">
        <div class="page-head">
            <h2>台账表格</h2>
            <button class="icon-btn" onclick="router.go('home')">⌂</button>
        </div>
        ${isLeader ? `<button class="btn primary full" onclick="showLedgerForm()">＋ 新建台账表</button>` : ''}
        <div class="card">
            <div class="card-title">台账列表（${tables.length}）</div>
            ${tables.length === 0 ? `<p class="empty">暂无台账，请班长新建</p >` : tables.map(function(t){
                return `<div class="ledger-row" onclick="router.go('ledger/detail/${t.id}')">
                    <div class="ledger-name">${escapeHtml(t.name)}</div>
                    <div class="ledger-meta">${t.cols.length} 列 · ${(t.rows||[]).length} 行 · ${fmtDate(t.createTime)}</div>
                </div>`;
            }).join('')}
        </div>
        <button class="btn ghost full" onclick="exportAll()">📤 导出全部数据</button>
    </div>`;
}

function getLedgerTables() { return store.data.ledgerTables || []; }

function showLedgerForm() {
    openModal(`
        <h3>新建台账表</h3>
        <div class="field"><label>表名</label><input id="lg-name" placeholder="如：班费收支台账" /></div>
        <div class="field"><label>列名（用逗号分隔）</label><input id="lg-cols" placeholder="如：日期,事项,收入,支出,经手人" /></div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveLedgerTable()">创建</button>
        </div>
    `);
}

function saveLedgerTable() {
    const name = val('lg-name'); const cols = val('lg-cols');
    if (!name) return toast('请填写表名');
    if (!cols) return toast('请填写列名');
    const colArr = cols.split(/[,，]/).map(function(c){ return c.trim(); }).filter(Boolean);
    if (!colArr.length) return toast('列名无效');
    store.data.ledgerTables = store.data.ledgerTables || [];
    store.data.ledgerTables.unshift({
        id: 'lg' + Date.now(), name: name, cols: colArr, rows: [],
        createBy: currentUser ? currentUser.id : '', createTime: Date.now()
    });
    addLog('新建台账表', name, 'ledger');
    store.save(); closeModal(); toast('台账已创建'); router.render();
}

function renderLedgerDetail(id) {
    const t = getLedgerTables().find(function(x){ return x.id === id; });
    if (!t) return `<div class="page"><p class="empty">未找到该台账</p ></div>`;
    const isLeader = currentUser && currentUser.role === 'leader';
    return `
    <div class="page ledger-page">
        <div class="page-head">
            <h2>${escapeHtml(t.name)}</h2>
            <button class="icon-btn" onclick="router.go('ledger')">←</button>
        </div>
        ${isLeader ? `<button class="btn primary full" onclick="showLedgerRowForm('${id}')">＋ 新增一行</button>` : ''}
        <div class="card table-wrap">
            <table class="ledger-table">
                <thead><tr>${t.cols.map(function(c){ return `<th>${escapeHtml(c)}</th>`; }).join('')}</tr></thead>
                <tbody>
                    ${t.rows.length === 0 ? `<tr><td colspan="${t.cols.length}" class="empty">暂无数据</td></tr>` : t.rows.map(function(r){
                        return `<tr>${t.cols.map(function(c,ci){
                            const v = r[ci] !== undefined ? r[ci] : '';
                            return `<td>${escapeHtml(String(v))}</td>`;
                        }).join('')}</tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

function showLedgerRowForm(id) {
    const t = getLedgerTables().find(function(x){ return x.id === id; });
    if (!t) return;
    openModal(`
        <h3>新增台账行 - ${escapeHtml(t.name)}</h3>
        ${t.cols.map(function(c,i){
            return `<div class="field"><label>${escapeHtml(c)}</label><input id="lgr-${i}" /></div>`;
        }).join('')}
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveLedgerRow('${id}')">保存</button>
        </div>
    `);
}

function saveLedgerRow(id) {
    const t = getLedgerTables().find(function(x){ return x.id === id; });
    if (!t) return;
    const row = t.cols.map(function(c,i){ return val('lgr-' + i) || ''; });
    t.rows = t.rows || [];
    t.rows.push(row);
    addLog('新增台账记录', t.name, 'ledger');
    store.save(); closeModal(); toast('已保存'); router.render();
}
/* ========== 消息推送提醒模块 ========== */
function renderNotify() {
    const list = getNotifyList();
    const isLeader = currentUser && currentUser.role === 'leader';
    return `
    <div class="page notify-page">
        <div class="page-head">
            <h2>消息推送提醒</h2>
            <button class="icon-btn" onclick="router.go('home')">⌂</button>
        </div>
        ${isLeader ? `<button class="btn primary full" onclick="showNotifyForm()">＋ 推送新消息</button>` : ''}
        <div class="card">
            <div class="card-title">全部消息（${list.length}）</div>
            ${list.length === 0 ? `<p class="empty">暂无消息</p >` : list.map(function(m){
                return `<div class="notify-row ${m.read?'read':''}" onclick="router.go('notify/detail/${m.id}')">
                    <div class="notify-title">${escapeHtml(m.title)}${m.read?'':'<span class="dot"></span>'}</div>
                    <div class="notify-meta">${escapeHtml(m.fromName||'')} · ${fmtTime(m.createTime)}</div>
                    <div class="notify-preview">${escapeHtml(m.content||'').slice(0,40)}</div>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

function getNotifyList() { return store.data.notifies || []; }

function showNotifyForm() {
    openModal(`
        <h3>推送新消息</h3>
        <div class="field"><label>标题</label><input id="nf-title" placeholder="消息标题" /></div>
        <div class="field"><label>内容</label><textarea id="nf-content" rows="4" placeholder="消息内容"></textarea></div>
        <div class="field"><label>推送范围</label><select id="nf-scope">
            <option value="all">全班所有人</option>
            <option value="student">仅学生</option>
            <option value="leader">仅班长</option>
            <option value="teacher">仅班主任</option>
        </select></div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveNotify()">推送</button>
        </div>
    `);
}

function saveNotify() {
    const title = val('nf-title'); const content = val('nf-content'); const scope = val('nf-scope');
    if (!title || !content) return toast('请填写标题和内容');
    store.data.notifies = store.data.notifies || [];
    store.data.notifies.unshift({
        id: 'nf' + Date.now(), title: title, content: content, scope: scope,
        read: false,
        createBy: currentUser ? currentUser.id : '', fromName: currentUser ? currentUser.name : '',
        createTime: Date.now()
    });
    addLog('推送消息', title, 'notify');
    store.save(); closeModal(); toast('消息已推送'); router.render();
}

function renderNotifyDetail(id) {
    const m = getNotifyList().find(function(x){ return x.id === id; });
    if (!m) return `<div class="page"><p class="empty">未找到该消息</p ></div>`;
    if (currentUser && currentUser.role !== 'student') { m.read = true; store.save(); }
    return `
    <div class="page notify-page">
        <div class="page-head">
            <h2>消息详情</h2>
            <button class="icon-btn" onclick="router.go('notify')">←</button>
        </div>
        <div class="card">
            <div class="card-title">${escapeHtml(m.title)}</div>
            <p class="detail-line">发布：${escapeHtml(m.fromName||'')} · ${fmtTime(m.createTime)}</p >
        </div>
        <div class="card">
            <div class="card-title">消息内容</div>
            <p class="detail-text">${escapeHtml(m.content||'')}</p >
        </div>
    </div>`;
}

/* 推送通知辅助：统一入口，新增消息到列表并留痕 */
function pushNotify(title, content, type) {
    store.data.notifies = store.data.notifies || [];
    store.data.notifies.unshift({
        id: 'nf' + Date.now() + Math.random().toString(36).slice(2,6),
        title: title, content: content, type: type || 'notify', scope: 'all',
        read: false, fromName: currentUser ? currentUser.name : '系统',
        createTime: Date.now()
    });
    store.markDirty('notifies');
}
/* ========== 数据导出 ========== */
function exportAll() {
    const all = {
        notifies: getNotifyList(),
        subsidyItems: getSubsidyItems(),
        subsidyQuals: store.data.subsidyQuals || [],
        paymentRows: getPaymentRows(),
        attendanceRecs: getAttendanceRecs(),
        disputes: (getDisputes()||[]).map(function(d){
            return { id:d.id, title:d.title, stuNames:d.stuNames, status:d.status, result:d.result, createTime:d.createTime };
        }),
        dormList: getDormList(),
        dormRecs: getDormRecs(),
        ledgerTables: getLedgerTables(),
        logs: store.data.logs || []
    };
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '班级工作台全量数据_' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    addLog('导出全量数据', '导出JSON备份', 'export');
    toast('全量数据已导出为JSON');
}

function exportExcel() {
    // 简单 CSV 导出（可用 Excel 打开）
    const lines = [];
    lines.push(['模块','记录数'].join(','));
    lines.push(['通知',getNotifyList().length]);
    lines.push(['补助项目',getSubsidyItems().length]);
    lines.push(['缴费记录',getPaymentRows().length]);
    lines.push(['考勤记录',getAttendanceRecs().length]);
    lines.push(['纠纷',getDisputes().length]);
    lines.push(['宿舍记录',getDormRecs().length]);
    const csv = lines.join('\n');
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '班级工作台统计_' + todayStr() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('统计已导出为CSV');
}

/* ========== 路由 ========== */
const Router = {
    go: function(path) {
        window.location.hash = path;
    },
    render: function() {
        renderPage();
    }
};
const router = Router;

/* ========== 全局渲染 ========== */
function renderPage() {
    const hash = window.location.hash.replace(/^#/, '') || 'login';
    if (!currentUser) {
        // 未登录：仅渲染登录页
        if (hash !== 'login') window.location.hash = 'login';
        document.getElementById('app').innerHTML = renderLogin();
        document.title = '班级工作台';
        return;
    }
    // 已登录：底部导航
    document.getElementById('app').innerHTML = renderShell(hash);
}

function renderShell(hash) {
    const parts = hash.split('/');
    const main = parts[0];
    let content = '';
    switch(main) {
        case 'home': content = renderHome(); break;
        case 'mine': content = renderMine(); break;
        case 'notify': content = parts[1] ? renderNotifyDetail(parts[1]) : renderNotify(); break;
        case 'subsidy': content = parts[1] ? renderSubsidyDetail(parts[1]) : renderSubsidy(); break;
        case 'payment': content = renderPayment(); break;
        case 'attendance': content = renderAttendance(); break;
        case 'dispute': content = parts[1] ? renderDisputeDetail(parts[1]) : renderDispute(); break;
        case 'dorm': content = parts[1] ? renderDormDetail(parts[1]) : renderDorm(); break;
        case 'ledger': content = parts[1] ? renderLedgerDetail(parts[1]) : renderLedger(); break;
        default: content = renderHome();
    }
    const nav = (main === 'home' || main === 'mine') ? renderNav(main) : '';
    return `<div class="shell">${content}${nav}</div>`;
}

function renderNav(active) {
    return `
    <nav class="bottom-nav">
        <div class="nav-item ${active==='home'?'active':''}" onclick="router.go('home')">
            <span class="nav-ico">🏠</span><span class="nav-txt">工作台</span>
        </div>
        <div class="nav-item ${active==='mine'?'active':''}" onclick="router.go('mine')">
            <span class="nav-ico">👤</span><span class="nav-txt">我的</span>
        </div>
    </nav>`;
}

/* ========== 工作台 ========== */
function renderHome() {
    const isStudent = currentUser && currentUser.role === 'student';
    const isLeader = currentUser && currentUser.role === 'leader';
    const items = [];
    if (isStudent) {
        items.push({ icon:'📢', name:'班务通知', path:'notify' });
        items.push({ icon:'💳', name:'补助签字', path:'subsidy' });
        items.push({ icon:'💰', name:'缴费核对', path:'payment' });
        items.push({ icon:'📋', name:'我的考勤', path:'attendance' });
        items.push({ icon:'🏠', name:'宿舍情况', path:'dorm' });
        items.push({ icon:'⚖️', name:'纠纷调解', path:'dispute' });
        items.push({ icon:'📊', name:'台账表格', path:'ledger' });
    } else {
        items.push({ icon:'📢', name:'班务通知', path:'notify' });
        items.push({ icon:'💳', name:'补助管理', path:'subsidy' });
        items.push({ icon:'💰', name:'缴费核对', path:'payment' });
        items.push({ icon:'📋', name:'考勤管理', path:'attendance' });
        items.push({ icon:'⚖️', name:'纠纷调解', path:'dispute' });
        items.push({ icon:'🏠', name:'宿舍记录', path:'dorm' });
        items.push({ icon:'📊', name:'台账表格', path:'ledger' });
    }
    return `
    <div class="page home-page">
        <div class="home-head">
            <div class="home-welcome">
                <div class="home-school">云南工业信息职业学院</div>
                <div class="home-class">计算机网络技术2501班 · 工作台</div>
            </div>
        </div>
        <div class="home-user">
            <span class="home-name">${escapeHtml(currentUser ? currentUser.name : '')}</span>
            <span class="badge ${currentUser.role==='teacher'?'teacher':(currentUser.role==='leader'?'leader':'')}">${roleName(currentUser.role)}</span>
        </div>
        <div class="grid">
            ${items.map(function(it){
                return `<div class="grid-item" onclick="router.go('${it.path}')">
                    <span class="grid-ico">${it.icon}</span>
                    <span class="grid-name">${it.name}</span>
                </div>`;
            }).join('')}
        </div>
        <div class="safe-tip">🔒 操作全程留痕 · 防代签 · 纠纷隐私保护</div>
    </div>`;
}

function roleName(r) {
    if (r === 'leader') return '班长';
    if (r === 'teacher') return '班主任';
    return '学生';
}

/* ========== 我的页面 ========== */
function renderMine() {
    const u = currentUser;
    return `
    <div class="page mine-page">
        <div class="page-head">
            <h2>我的</h2>
            <button class="icon-btn" onclick="router.go('home')">⌂</button>
        </div>
        <div class="card mine-card">
            <div class="mine-avatar">${escapeHtml((u.name||'?').slice(0,1))}</div>
            <div class="mine-info">
                <div class="mine-name">${escapeHtml(u.name||'')}</div>
                <div class="mine-role">${roleName(u.role)}</div>
                <div class="mine-id">学号/账号：${escapeHtml(u.studentNo || u.username || u.id || '')}</div>
            </div>
        </div>
        <div class="card">
            <div class="card-title">数据管理</div>
            <button class="btn ghost full" onclick="exportAll()">📤 导出全量数据（JSON）</button>
            <button class="btn ghost full" onclick="exportExcel()">📊 导出统计（CSV/Excel）</button>
        </div>
        <div class="card">
            <div class="card-title">账号操作</div>
            ${u.role === 'leader' ? `<button class="btn ghost full" onclick="showManageStudents()">👥 管理学生名单</button>` : ''}
            <button class="btn ghost full" onclick="logout()">🚪 退出登录</button>
        </div>
    </div>`;
}

/* ========== 学生名单管理（班长） ========== */
function showManageStudents() {
    const list = getStudentList();
    openModal(`
        <h3>学生名单管理</h3>
        <p class="sign-tip">当前 ${list.length} 人。格式：姓名,学号（每行一人）</p >
        <div class="field"><label>学生名单</label><textarea id="stu-list" rows="10">${list.map(function(s){ return s.name + ',' + (s.studentNo||''); }).join('\n')}</textarea></div>
        <div class="modal-btns">
            <button class="btn ghost" onclick="closeModal()">取消</button>
            <button class="btn primary" onclick="saveStudentList()">保存</button>
        </div>
    `);
}

function saveStudentList() {
    const text = val('stu-list');
    const lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    const newList = lines.map(function(line){
        const parts = line.split(/[,，]/).map(function(p){ return p.trim(); });
        return { name: parts[0] || '未命名', studentNo: parts[1] || '', id: parts[1] || 's' + Math.random().toString(36).slice(2,8) };
    });
    store.data.studentList = newList;
    addLog('更新学生名单', newList.length + ' 人', 'student');
    store.save(); closeModal(); toast('学生名单已更新'); router.render();
}

function getStudentList() { return store.data.studentList || []; }

/* ========== 弹窗与提示 ========== */
function openModal(html) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-mask';
    wrap.innerHTML = `<div class="modal-box">${html}</div>`;
    document.body.appendChild(wrap);
}
function closeModal() {
    const m = document.querySelector('.modal-mask');
    if (m) m.remove();
}
function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

/* ========== 操作留痕 ========== */
function addLog(action, detail, module, who) {
    store.data.logs = store.data.logs || [];
    store.data.logs.push({
        time: Date.now(),
        who: (who && who.name) || (currentUser ? currentUser.name : '系统'),
        role: (who && who.role) || (currentUser ? currentUser.role : ''),
        action: action, detail: detail, module: module || ''
    });
    store.markDirty('logs');
}

/* ========== 登录状态检查 ========== */
function checkSession() {
    const s = sb.auth.getSession();
    currentUser = s && s.user ? { id: s.user.id, name: s.user.user_metadata.name || '', role: s.user.user_metadata.role || 'student' } : null;
}

/* ========== 退出登录 ========== */
function logout() {
    if (!confirm('确定退出登录吗？')) return;
    sb.auth.signOut();
    currentUser = null;
    window.location.hash = 'login';
    renderPage();
}

/* ========== 应用启动 ========== */
async function initApp() {
    // 1. 加载云端数据
    try {
        await Store.loadAll();
    } catch(e) { console.warn('云端加载失败', e); }
    // 2. 恢复登录会话
    checkSession();
    // 3. 首次渲染
    if (!window.location.hash || window.location.hash === '#') {
        window.location.hash = currentUser ? 'home' : 'login';
    }
    renderPage();
}

/* ========== 事件绑定 ========== */
window.addEventListener('hashchange', function() {
    renderPage();
});

window.addEventListener('DOMContentLoaded', function() {
    initApp();
});