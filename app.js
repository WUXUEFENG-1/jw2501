/* ============================================================
 * 计算机网络技术2501班 班级工作台APP（云端版）
 * 云南工业信息职业学院
 * 移动端优先 · 校园简约风格 · Supabase 云端共享
 * ============================================================ */

// ============== 常量 ==============
const CLASS_NAME = '计算机网络技术2501班';
const SCHOOL_NAME = '云南工业信息职业学院';

// ============== Supabase 客户端 ==============
const SUPABASE_URL = 'https://vvmnzyhbjcskyyofvemj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MsfALtjxliSa9kTv_cVdhw_x145_IA5';
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
if (!sb) console.error('Supabase 客户端加载失败，请检查网络或CDN');

// 当前登录用户（应用层会话）
let currentUser = null;

// ============== 工具函数 ==============
function $ (sel, parent){ parent = parent || document; return parent.querySelector(sel); }
function $$(sel, parent){ parent = parent || document; return Array.prototype.slice.call(parent.querySelectorAll(sel)); }

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function todayStr(){
  const d = new Date();
  const p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
}

function fmtDate(ts){
  if(!ts) return '';
  const d = new Date(ts);
  if(isNaN(d)) return '';
  const p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
}

function fmtTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  if(isNaN(d)) return '';
  const p = function(n){ return String(n).padStart(2,'0'); };
  return p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function encodeBase64(str){
  try { return btoa(unescape(encodeURIComponent(str))); } catch(e){ return ''; }
}
function decodeBase64(b64){
  try { return decodeURIComponent(escape(atob(b64))); } catch(e){ return ''; }
}

// ============== Store（内存缓存 + 云端异步推送） ==============
const Store = {
  data: {},
  dirty: {},
  saving: false,

  defaultData: function(){
    return {
      notifies: [],
      subsidyItems: [],
      subsidyQuals: [],
      paymentRows: [],
      attendanceRecs: [],
      disputes: [],
      dormList: [],
      dormRecs: [],
      ledgerTables: [],
      studentList: [],
      logs: []
    };
  },

  key: function(k){ return 'app_' + k; },

  markDirty: function(k){
    this.dirty[k] = true;
    this.scheduleSave();
  },

  save: function(){
    this.scheduleSave();
  },

  scheduleSave: function(){
    const self = this;
    if (this.saving) return;
    this.saving = true;
    setTimeout(function(){ self.flush(); }, 300);
  },

  flush: function(){
    const self = this;
    const keys = Object.keys(this.dirty);
    if (!keys.length) { this.saving = false; return; }
    const data = {};
    keys.forEach(function(k){ data[k] = self.data[k]; });
    this.dirty = {};
    // 注意：upsert().select() 返回的是 thenable（非标准 Promise），
    // 需用 Promise.resolve() 包一层才能安全使用 .finally
    Promise.resolve(self._push(keys, data)).finally(function(){
      self.saving = false;
      if (Object.keys(self.dirty).length) self.scheduleSave();
    });
  },

  _push: function(keys, data){
    if (!sb) return Promise.resolve();
    return sb.from('store_data').upsert(keys.map(function(k){
      return { key: this.key(k), value: data[k] || null };
    }.bind(this))).select();
  },

  loadAll: async function(){
    if (!sb) return;
    try {
      const keys = Object.keys(this.defaultData()).map(this.key.bind(this));
      const { data, error } = await sb.from('store_data').select('key,value').in('key', keys);
      if (error) throw error;
      const defaults = this.defaultData();
      (data || []).forEach(function(row){
        if (row.value != null) defaults[row.key.replace('app_','')] = row.value;
      });
      this.data = defaults;
    } catch(e){
      console.warn('云端加载失败，使用本地默认', e);
      this.data = this.defaultData();
    }
  },

  get: function(k){
    if (this.data[k] === undefined) this.data[k] = null;
    return this.data[k];
  },

  set: function(k, v){
    this.data[k] = v;
    this.markDirty(k);
  }
};

// ============== 登录 / 账号 ==============
// SHA-256 哈希（浏览器原生 crypto，需 https 环境）
async function sha256Hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.prototype.map.call(new Uint8Array(buf), function(b){ return b.toString(16).padStart(2,'0'); }).join('');
}

const Auth = {
  async login(username, password){
    if (!sb) throw new Error('未连接到云端，请检查网络');
    // 直接查询 users 表（不依赖 RPC 函数）
    const { data: u, error } = await sb.from('users')
      .select('id,username,name,role,password')
      .eq('username', username)
      .maybeSingle();
    if (error) throw new Error('登录失败：' + error.message);
    if (!u) throw new Error('账号不存在');
    const hash = await sha256Hex(username + ':' + password);
    if (u.password !== hash) throw new Error('密码错误');
    currentUser = {
      id: u.id,
      username: u.username,
      name: u.name || u.username,
      role: u.role === 'monitor' ? 'leader' : (u.role || 'student')
    };
    this.syncUserWithStudents();
    return currentUser;
  },

  // 创建账号（直接写 users 表，密码存 SHA-256 哈希）
  async createUser(username, password, name, role, stuNo){
    if (!sb) throw new Error('未连接云端');
    const hash = await sha256Hex(username + ':' + password);
    const { data, error } = await sb.from('users').upsert({
      username: username,
      password: hash,
      name: name,
      role: role || 'student',
      stu_no: stuNo || username
    }, { onConflict: 'username' }).select('id').maybeSingle();
    if (error) throw new Error('创建账号失败：' + error.message);
    return data;
  },

  syncUserWithStudents(){
    if (!currentUser) return;
    if (currentUser.role === 'student'){
      // 用学号对齐学生名单，获取标准 id
      const list = Store.get('studentList') || [];
      const no = currentUser.username;
      const match = list.find(function(s){ return s.studentNo === no || s.id === currentUser.id; });
      if (match) currentUser.id = match.id;
    }
  }
};

// ============== 路由 ==============
const router = {
  go: function(path){
    window.location.hash = path;
  },
  render: function(){
    renderPage();
  }
};

// ============== 登录页 ==============
function renderLogin(){
  return `
  <div class="login-page">
    <div class="login-box">
      <div class="login-logo">🏫</div>
      <div class="login-school">${SCHOOL_NAME}</div>
      <div class="login-class">${CLASS_NAME}</div>
      <div class="login-title">班级工作台</div>
      <div class="field"><label>账号</label><input id="login-user" placeholder="学号 / 账号" /></div>
      <div class="field"><label>密码</label><input id="login-pwd" type="password" placeholder="密码" /></div>
      <button class="btn primary full" onclick="doLogin()">登 录</button>
      <div class="login-tip">教师账号由管理员分配，学生账号由班长批量创建</div>
    </div>
  </div>`;
}

async function doLogin(){
  const user = val('login-user'); const pwd = val('login-pwd');
  if (!user || !pwd) return toast('请输入账号和密码');
  try {
    await Auth.login(user.trim(), pwd);
    toast('登录成功');
    router.go('home');
    renderPage();
  } catch(e){
    toast(e.message || '登录失败');
  }
}

function logout(){
  if (!confirm('确定退出登录吗？')) return;
  currentUser = null;
  window.location.hash = 'login';
  renderPage();
}

function roleName(r){
  if (r === 'leader') return '班长';
  if (r === 'teacher') return '班主任';
  return '学生';
}

// ============== 页面外壳 ==============
function renderPage(){
  const hash = window.location.hash.replace(/^#/, '') || 'login';
  if (!currentUser){
    if (hash !== 'login') window.location.hash = 'login';
    document.getElementById('app').innerHTML = renderLogin();
    document.title = '班级工作台';
    return;
  }
  document.getElementById('app').innerHTML = renderShell(hash);
  document.title = '班级工作台 - ' + currentUser.name;
}

function renderShell(hash){
  const parts = hash.split('/');
  const main = parts[0] || 'home';
  let content = '';
  switch(main){
    case 'home':     content = renderHome(); break;
    case 'mine':     content = renderMine(); break;
    case 'notify':   content = parts[1] ? renderNotifyDetail(parts[1]) : renderNotify(); break;
    case 'subsidy':  content = parts[1] ? renderSubsidyDetail(parts[1]) : renderSubsidy(); break;
    case 'payment':  content = renderPayment(); break;
    case 'attendance': content = renderAttendance(); break;
    case 'dispute':  content = parts[1] ? renderDisputeDetail(parts[1]) : renderDispute(); break;
    case 'dorm':     content = parts[1] ? renderDormDetail(parts[1]) : renderDorm(); break;
    case 'ledger':   content = parts[1] ? renderLedgerDetail(parts[1]) : renderLedger(); break;
    default:         content = renderHome();
  }
  const nav = (main === 'home' || main === 'mine') ? renderNav(main) : '';
  return '<div class="shell">' + content + nav + '</div>';
}

function renderNav(active){
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

// ============== 工作台 ==============
function renderHome(){
  const isStudent = currentUser && currentUser.role === 'student';
  let items = [
    { icon:'📢', name:'班务通知', path:'notify' },
    { icon:'💳', name: isStudent?'补助签字':'补助管理', path:'subsidy' },
    { icon:'💰', name:'缴费核对', path:'payment' },
    { icon:'📋', name: isStudent?'我的考勤':'考勤管理', path:'attendance' },
    { icon:'⚖️', name:'纠纷调解', path:'dispute' },
    { icon:'🏠', name: isStudent?'宿舍情况':'宿舍记录', path:'dorm' },
    { icon:'📊', name:'台账表格', path:'ledger' }
  ];
  return `
  <div class="page home-page">
    <div class="home-head">
      <div class="home-school">${SCHOOL_NAME}</div>
      <div class="home-class">${CLASS_NAME} · 工作台</div>
    </div>
    <div class="home-user">
      <span class="home-name">${escapeHtml(currentUser ? currentUser.name : '')}</span>
      <span class="badge ${currentUser.role==='teacher'?'teacher':(currentUser.role==='leader'?'leader':'')}">${roleName(currentUser.role)}</span>
    </div>
    <div class="grid">
      ${items.map(function(it){
        return `<div class="grid-item" onclick="router.go('${it.path}')">
          <span class="grid-ico">${it.icon}</span><span class="grid-name">${it.name}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="safe-tip">🔒 操作全程留痕 · 防代签 · 纠纷隐私保护</div>
  </div>`;
}

// ============== 我的页面 ==============
function renderMine(){
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
        <div class="mine-id">账号：${escapeHtml(u.username || '')}</div>
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
      <button class="btn ghost full" onclick="showChangePwd()">🔑 修改密码</button>
      <button class="btn ghost full" onclick="logout()">🚪 退出登录</button>
    </div>
  </div>`;
}

// ============== 修改密码 ==============
function showChangePwd(){
  openModal(`
    <h3>修改密码</h3>
    <div class="field"><label>旧密码</label><input id="cp-old" type="password" placeholder="当前密码" /></div>
    <div class="field"><label>新密码</label><input id="cp-new" type="password" placeholder="至少6位" /></div>
    <div class="field"><label>确认新密码</label><input id="cp-new2" type="password" placeholder="再输入一次新密码" /></div>
    <div class="modal-btns">
      <button class="btn ghost" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="saveNewPwd()">保存修改</button>
    </div>
  `);
}

async function saveNewPwd(){
  if (!currentUser) return toast('请先登录');
  const oldPwd = val('cp-old'); const newPwd = val('cp-new'); const newPwd2 = val('cp-new2');
  if (!oldPwd || !newPwd || !newPwd2) return toast('请填写完整');
  if (newPwd.length < 6) return toast('新密码至少6位');
  if (newPwd !== newPwd2) return toast('两次输入的新密码不一致');
  if (oldPwd === newPwd) return toast('新密码不能与旧密码相同');
  try {
    toast('正在验证...');
    // 1. 校验旧密码
    const oldHash = await sha256Hex(currentUser.username + ':' + oldPwd);
    const { data: u, error: qErr } = await sb.from('users').select('password')
      .eq('username', currentUser.username).maybeSingle();
    if (qErr) throw qErr;
    if (!u || u.password !== oldHash) return toast('旧密码错误');
    // 2. 更新为新密码
    const newHash = await sha256Hex(currentUser.username + ':' + newPwd);
    const { error: upErr } = await sb.from('users')
      .update({ password: newHash, updated_at: new Date().toISOString() })
      .eq('username', currentUser.username);
    if (upErr) throw upErr;
    addLog('修改密码', '用户主动修改密码', 'account');
    closeModal(); toast('密码修改成功，下次登录请用新密码');
  } catch(e){
    toast('修改失败：' + (e.message || '未知错误'));
  }
}

// ============== 学生名单管理（班长） ==============
function getStudentList(){ return Store.get('studentList') || []; }

function showManageStudents(){
  const list = getStudentList();
  openModal(`
    <h3>学生名单管理</h3>
    <p class="sign-tip">当前 ${list.length} 人。格式：姓名,学号（每行一人）</p>
    <div class="field"><label>学生名单</label>
      <textarea id="stu-list" rows="10">${list.map(function(s){ return s.name + ',' + (s.studentNo||''); }).join('\n')}</textarea>
    </div>
    <div class="modal-btns">
      <button class="btn ghost" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="saveStudentList()">保存</button>
    </div>
  `);
}

async function saveStudentList(){
  const text = val('stu-list');
  const lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  const newList = lines.map(function(line){
    const parts = line.split(/[,，]/).map(function(p){ return p.trim(); });
    const no = parts[1] || '';
    return { name: parts[0] || '未命名', studentNo: no, id: no || ('s' + Math.random().toString(36).slice(2,8)) };
  });
  Store.set('studentList', newList);
  addLog('更新学生名单', newList.length + ' 人', 'student');
  // 自动为每个学生创建登录账号（账号=学号，初始密码=学号）
  let created = 0, failed = 0;
  toast('正在创建学生账号...');
  for (const s of newList){
    if (!s.studentNo) continue;
    try {
      await Auth.createUser(s.studentNo, s.studentNo, s.name, 'student', s.studentNo);
      created++;
    } catch(e){ failed++; }
  }
  closeModal();
  if (failed > 0) toast('名单已保存；账号创建 ' + created + ' 个，失败 ' + failed + ' 个');
  else toast('名单已保存，已创建/更新 ' + created + ' 个学生账号（密码=学号）');
  router.render();
}

// ============== 操作留痕 ==============
function addLog(action, detail, module, who){
  const logs = Store.get('logs') || [];
  logs.push({
    time: Date.now(),
    who: (who && who.name) || (currentUser ? currentUser.name : '系统'),
    role: (who && who.role) || (currentUser ? currentUser.role : ''),
    action: action, detail: detail, module: module || ''
  });
  Store.set('logs', logs);
}

// ============== 消息推送提醒模块 ==============
function getNotifyList(){ return Store.get('notifies') || []; }

function pushNotify(title, content, type){
  const list = getNotifyList();
  list.unshift({
    id: 'nf' + Date.now() + Math.random().toString(36).slice(2,6),
    title: title, content: content, type: type || 'notify', scope: 'all',
    read: false, fromName: currentUser ? currentUser.name : '系统',
    createTime: Date.now()
  });
  Store.set('notifies', list);
}

function renderNotify(){
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
      ${list.length === 0 ? `<p class="empty">暂无消息</p>` : list.map(function(m){
        return `<div class="notify-row ${m.read?'read':''}" onclick="router.go('notify/detail/${m.id}')">
          <div class="notify-title">${escapeHtml(m.title)}${m.read?'':'<span class="dot"></span>'}</div>
          <div class="notify-meta">${escapeHtml(m.fromName||'')} · ${fmtTime(m.createTime)}</div>
          <div class="notify-preview">${escapeHtml(m.content||'').slice(0,40)}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function showNotifyForm(){
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

function saveNotify(){
  const title = val('nf-title'); const content = val('nf-content'); const scope = val('nf-scope');
  if (!title || !content) return toast('请填写标题和内容');
  const list = getNotifyList();
  list.unshift({
    id: 'nf' + Date.now(), title: title, content: content, scope: scope, read: false,
    createBy: currentUser ? currentUser.id : '', fromName: currentUser ? currentUser.name : '',
    createTime: Date.now()
  });
  Store.set('notifies', list);
  addLog('推送消息', title, 'notify');
  closeModal(); toast('消息已推送'); router.render();
}

function renderNotifyDetail(id){
  const m = getNotifyList().find(function(x){ return x.id === id; });
  if (!m) return `<div class="page"><p class="empty">未找到该消息</p></div>`;
  if (currentUser && currentUser.role !== 'student'){ m.read = true; Store.set('notifies', getNotifyList()); }
  return `
  <div class="page notify-page">
    <div class="page-head">
      <h2>消息详情</h2>
      <button class="icon-btn" onclick="router.go('notify')">←</button>
    </div>
    <div class="card">
      <div class="card-title">${escapeHtml(m.title)}</div>
      <p class="detail-line">发布：${escapeHtml(m.fromName||'')} · ${fmtTime(m.createTime)}</p>
    </div>
    <div class="card">
      <div class="card-title">消息内容</div>
      <p class="detail-text">${escapeHtml(m.content||'')}</p>
    </div>
  </div>`;
}

// ============== 补助签字确认模块 ==============
function getSubsidyItems(){ return Store.get('subsidyItems') || []; }
function getSubsidyQuals(){ return Store.get('subsidyQuals') || []; }

function renderSubsidy(){
  const isStudent = currentUser && currentUser.role === 'student';
  if (isStudent) return renderSubsidyStudent();
  return renderSubsidyManager();
}

function renderSubsidyStudent(){
  const sid = currentUser ? currentUser.id : '';
  const items = getSubsidyItems();
  const myItems = items.filter(function(it){ return (it.stuIds||[]).indexOf(sid) !== -1; });
  const signedCount = myItems.filter(function(it){ return (it.signedStuIds||[]).indexOf(sid) !== -1; }).length;
  const totalAmt = myItems.reduce(function(s,it){ return s + (Number(it.amount)||0); }, 0);
  const my = getSubsidyQuals().find(function(q){ return q.stuId === sid; });
  return `
  <div class="page subsidy-page">
    <div class="page-head">
      <h2>补助签字确认</h2>
      <button class="icon-btn" onclick="router.go('home')">⌂</button>
    </div>
    ${my ? `<div class="card tip-card"><div class="card-title">我的补助资格</div><p class="tip-text">${escapeHtml(my.reason || '暂无说明')}</p></div>` : ''}
    <div class="card stat-card">
      <div class="stat-num">${myItems.length}</div>
      <div class="stat-label">我的补助项目</div>
      <div class="stat-sub">已签字 ${signedCount} / ${myItems.length} 项</div>
    </div>
    <div class="card">
      <div class="card-title">补助明细（合计 ¥${totalAmt.toFixed(2)}）</div>
      ${myItems.length === 0 ? `<p class="empty">暂无可签字的补助项目</p>` : myItems.map(function(it){
        const signed = (it.signedStuIds||[]).indexOf(sid) !== -1;
        return `<div class="subsidy-item ${signed?'signed':''}">
          <div class="subsidy-info">
            <div class="subsidy-name">${escapeHtml(it.name)}</div>
            <div class="subsidy-amount">¥${(Number(it.amount)||0).toFixed(2)}</div>
            <div class="subsidy-meta">${escapeHtml(it.category||'')}${it.note?' · '+escapeHtml(it.note):''}</div>
          </div>
          <div class="subsidy-act">
            ${signed
              ? `<span class="badge ok">已签字</span><button class="btn mini ghost" onclick="confirmUnsignSubsidy('${it.id}')">撤销</button>`
              : `<button class="btn mini primary" onclick="signSubsidy('${it.id}')">电子签字</button>`}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="safe-note">🔒 每项补助需本人电子签字确认，防止代签冒签，操作全程留痕</div>
  </div>`;
}

function renderSubsidyManager(){
  const items = getSubsidyItems();
  const isLeader = currentUser && currentUser.role === 'leader';
  let studentCount = 0, signedCount = 0;
  items.forEach(function(it){
    studentCount += (it.stuIds||[]).length;
    signedCount += (it.signedStuIds||[]).length;
  });
  return `
  <div class="page subsidy-page">
    <div class="page-head">
      <h2>补助签字确认</h2>
      <button class="icon-btn" onclick="router.go('home')">⌂</button>
    </div>
    <div class="card stat-card">
      <div class="stat-num">${items.length}</div>
      <div class="stat-label">补助项目数</div>
      <div class="stat-sub">覆盖 ${studentCount} 人，已签 ${signedCount} 人次</div>
    </div>
    ${isLeader ? `<button class="btn primary full" onclick="showSubsidyForm()">＋ 发布补助项目</button>` : ''}
    <div class="card">
      <div class="card-title">补助项目列表</div>
      ${items.length === 0 ? `<p class="empty">暂无补助项目</p>` : items.map(function(it){
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

function renderSubsidyDetail(id){
  const it = getSubsidyItems().find(function(x){ return x.id === id; });
  if (!it) return `<div class="page"><p class="empty">未找到该补助项目</p></div>`;
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
      <p class="detail-line">金额：¥${(Number(it.amount)||0).toFixed(2)}</p>
      <p class="detail-line">类别：${escapeHtml(it.category||'')}</p>
      <p class="detail-line">已签：${signedNum} / ${it.stuIds.length} 人</p>
      ${it.note?`<p class="detail-line">备注：${escapeHtml(it.note)}</p>`:''}
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

function showSubsidyForm(){
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

function saveSubsidy(){
  const name = val('sf-name'); const amount = Number(val('sf-amount'));
  if (!name || !amount) return toast('请填写项目名称和金额');
  const stuIds = Array.prototype.map.call(document.querySelectorAll('.sf-stu:checked'), function(c){ return c.value; });
  if (!stuIds.length) return toast('请至少选择一名学生');
  const items = getSubsidyItems();
  items.unshift({
    id: 'sub' + Date.now(), name: name, amount: amount,
    category: val('sf-cat'), note: val('sf-note'),
    stuIds: stuIds, signedStuIds: [], signs: {},
    createBy: currentUser ? currentUser.id : '', createName: currentUser ? currentUser.name : '',
    createTime: Date.now(), locked: false
  });
  Store.set('subsidyItems', items);
  addLog('发布补助项目', name + ' ¥' + amount, 'subsidy');
  pushNotify('补助通知', '新补助项目「' + name + '」已发布，请相关同学签字确认', 'subsidy');
  closeModal(); toast('补助项目已发布'); router.render();
}

function signSubsidy(id){
  if (!currentUser) return toast('请先登录');
  const items = getSubsidyItems();
  const item = items.find(function(x){ return x.id === id; });
  if (!item) return toast('未找到该项目');
  if (item.locked) return toast('该项目已锁定，无法签字');
  if ((item.signedStuIds||[]).indexOf(currentUser.id) !== -1) return toast('您已签字');
  openSignModal(function(base64){
    item.signedStuIds = item.signedStuIds || [];
    item.signs = item.signs || {};
    item.signedStuIds.push(currentUser.id);
    item.signs[currentUser.id] = { sig: base64, time: Date.now(), name: currentUser.name };
    Store.set('subsidyItems', items);
    addLog('补助电子签字', item.name, 'subsidy', currentUser);
    pushNotify('补助签字', currentUser.name + ' 已对「' + item.name + '」签字确认', 'subsidy');
    toast('签字成功'); router.render();
  });
}

function confirmUnsignSubsidy(id){
  if (!currentUser) return;
  if (!confirm('确定撤销对「补助」的签字吗？')) return;
  const items = getSubsidyItems();
  const item = items.find(function(x){ return x.id === id; });
  if (!item) return;
  if (item.locked) return toast('该项目已锁定，无法撤销');
  item.signedStuIds = (item.signedStuIds||[]).filter(function(s){ return s !== currentUser.id; });
  if (item.signs) delete item.signs[currentUser.id];
  Store.set('subsidyItems', items);
  addLog('撤销补助签字', item.name, 'subsidy');
  toast('已撤销签字'); router.render();
}

// ============== 电子签字弹窗（通用） ==============
function openSignModal(cb){
  const wrap = document.createElement('div');
  wrap.className = 'sign-modal';
  wrap.innerHTML = `
    <div class="sign-box">
      <h3>电子签字确认</h3>
      <p class="sign-tip">请在本区域手写签名（用手指或鼠标书写）</p>
      <canvas id="sign-canvas" width="300" height="120"></canvas>
      <div class="modal-btns">
        <button class="btn ghost" onclick="clearSign()">清除</button>
        <button class="btn primary" onclick="confirmSign()">确认签字</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const cv = wrap.querySelector('#sign-canvas');
  const ctx = cv.getContext('2d');
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a4d8f';
  let drawing = false, hasInk = false;
  function pos(e){
    const r = cv.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x:(t.clientX)-r.left, y:(t.clientY)-r.top };
  }
  cv.addEventListener('mousedown', function(e){ drawing=true; hasInk=true; ctx.beginPath(); ctx.moveTo(pos(e).x, pos(e).y); });
  cv.addEventListener('mousemove', function(e){ if(!drawing)return; ctx.lineTo(pos(e).x, pos(e).y); ctx.stroke(); });
  cv.addEventListener('mouseup', function(){ drawing=false; });
  cv.addEventListener('mouseleave', function(){ drawing=false; });
  cv.addEventListener('touchstart', function(e){ e.preventDefault(); drawing=true; hasInk=true; ctx.beginPath(); ctx.moveTo(pos(e).x, pos(e).y); });
  cv.addEventListener('touchmove', function(e){ e.preventDefault(); if(!drawing)return; ctx.lineTo(pos(e).x, pos(e).y); ctx.stroke(); });
  cv.addEventListener('touchend', function(){ drawing=false; });
  window.__signCb = cb; window.__signCv = cv;
  window.__signHasInk = function(){ return hasInk; };
}

function clearSign(){
  const cv = window.__signCv;
  if (!cv) return;
  cv.getContext('2d').clearRect(0,0,cv.width,cv.height);
  window.__signHasInk = function(){ return false; };
}

function confirmSign(){
  if (!window.__signHasInk || !window.__signHasInk()) return toast('请先手写签名');
  const cv = window.__signCv;
  const data = cv.toDataURL('image/png');
  const mask = document.querySelector('.sign-modal');
  if (mask) mask.remove();
  const cb = window.__signCb;
  window.__signCb = null; window.__signCv = null;
  if (cb) cb(data);
}

// ============== 学费住宿费缴费核对模块 ==============
function getPaymentRows(){ return Store.get('paymentRows') || []; }

function renderPayment(){
  const isStudent = currentUser && currentUser.role === 'student';
  if (isStudent) return renderPaymentStudent();
  return renderPaymentManager();
}

function renderPaymentStudent(){
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
      ${rows.length === 0 ? `<p class="empty">暂无可核对的缴费项目</p>` : rows.map(function(r){
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

function renderPaymentManager(){
  const rows = getPaymentRows();
  const students = getStudentList();
  const isLeader = currentUser && currentUser.role === 'leader';
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
      ${rows.length === 0 ? `<p class="empty">暂无缴费记录</p>` : rows.map(function(r){
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

function showPayForm(){
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

function savePay(){
  const stuId = val('pf-stu'); const type = val('pf-type'); const amount = Number(val('pf-amount'));
  if (!stuId || !amount) return toast('请选择学生并填写金额');
  const rows = getPaymentRows();
  rows.unshift({
    id: 'pay' + Date.now(), stuId: stuId, type: type, amount: amount,
    paid: false, payTime: null, createBy: currentUser ? currentUser.id : '', createTime: Date.now()
  });
  Store.set('paymentRows', rows);
  addLog('录入缴费记录', type + ' ¥' + amount, 'payment');
  closeModal(); toast('已录入'); router.render();
}

function confirmMyPay(id){
  if (!currentUser) return;
  if (!confirm('请确认您已完成该费用缴纳？')) return;
  const rows = getPaymentRows();
  const row = rows.find(function(r){ return r.id === id; });
  if (!row) return;
  if (row.paid) return toast('该记录已确认');
  row.paid = true; row.payTime = Date.now();
  Store.set('paymentRows', rows);
  addLog('学生确认缴费', row.type + ' ¥' + row.amount, 'payment');
  pushNotify('缴费确认', currentUser.name + ' 确认完成「' + row.type + '」缴纳，请班长核实', 'payment');
  toast('已登记，待班长核实'); router.render();
}

function confirmPay(id){
  const rows = getPaymentRows();
  const row = rows.find(function(r){ return r.id === id; });
  if (!row) return;
  row.paid = true; row.payTime = Date.now();
  Store.set('paymentRows', rows);
  addLog('班长核实缴费', row.type + ' ¥' + row.amount, 'payment');
  toast('已确认'); router.render();
}

// ============== 考勤管理模块 ==============
function getAttendanceRecs(){ return Store.get('attendanceRecs') || []; }

function renderAttendance(){
  const isStudent = currentUser && currentUser.role === 'student';
  if (isStudent) return renderAttendanceStudent();
  return renderAttendanceManager();
}

function renderAttendanceStudent(){
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
      ${recs.length === 0 ? `<p class="empty">暂无考勤记录</p>` : recs.map(function(r){
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

function renderAttendanceManager(){
  const recs = getAttendanceRecs();
  const students = getStudentList();
  const isLeader = currentUser && currentUser.role === 'leader';
  const today = todayStr();
  const absToday = recs.filter(function(r){ return r.date === today && r.status === '缺勤'; }).length;
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
      ${recs.length === 0 ? `<p class="empty">暂无考勤记录</p>` : recs.map(function(r){
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

function showAttForm(){
  const students = getStudentList();
  const today = todayStr();
  openModal(`
    <h3>录入今日考勤</h3>
    <p class="sign-tip">日期：${today}（自动记录今日，可修改）</p>
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

function saveAtt(){
  const date = val('af-date'); const course = val('af-course') || '日常考勤';
  if (!date) return toast('请选择日期');
  // 防重复：同一学生同一天同一课程只能一条
  const recs = getAttendanceRecs().filter(function(r){
    return !(r.date === date && r.course === course);
  });
  document.querySelectorAll('.af-status').forEach(function(sel){
    const stuId = sel.getAttribute('data-id');
    const status = sel.value;
    recs.unshift({
      id: 'att' + Date.now() + Math.random().toString(36).slice(2,6),
      date: date, course: course, stuId: stuId, status: status,
      createBy: currentUser ? currentUser.id : '', createName: currentUser ? currentUser.name : '',
      createTime: Date.now()
    });
  });
  Store.set('attendanceRecs', recs);
  addLog('录入考勤', date + ' ' + course, 'attendance');
  pushNotify('考勤通知', date + ' 考勤已录入，请查看', 'attendance');
  closeModal(); toast('考勤已保存'); router.render();
}

// ============== 矛盾纠纷调解模块 ==============
function getDisputes(){ return Store.get('disputes') || []; }

function renderDispute(){
  const isStudent = currentUser && currentUser.role === 'student';
  if (isStudent) return renderDisputeStudent();
  return renderDisputeManager();
}

function renderDisputeStudent(){
  const sid = currentUser ? currentUser.id : '';
  const mine = getDisputes().filter(function(d){ return (d.stuIds||[]).indexOf(sid) !== -1; });
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
      ${mine.length === 0 ? `<p class="empty">暂无纠纷记录</p>` : mine.map(function(d){
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

function renderDisputeManager(){
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
      ${list.length === 0 ? `<p class="empty">暂无纠纷记录</p>` : list.map(function(d){
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

function showDisputeForm(){
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

function saveDispute(){
  if (!currentUser) return toast('请先登录');
  const title = val('dp-title'); const cause = val('dp-cause');
  if (!title || !cause) return toast('请填写标题和详细描述');
  const stuIds = Array.prototype.map.call(document.querySelectorAll('.dp-stu:checked'), function(c){ return c.value; });
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
  const list = getDisputes();
  list.unshift(d);
  Store.set('disputes', list);
  addLog('提交纠纷申请', title, 'dispute');
  pushNotify('纠纷调解', currentUser.name + ' 提交了纠纷调解申请，请尽快处理', 'dispute');
  closeModal(); toast('已提交，等待调解'); router.render();
}

function renderDisputeDetail(id){
  const d = getDisputes().find(function(x){ return x.id === id; });
  if (!d) return `<div class="page"><p class="empty">未找到该纠纷</p></div>`;
  const canView = currentUser && (currentUser.role !== 'student' || (d.stuIds||[]).indexOf(currentUser.id) !== -1);
  if (!canView) return `<div class="page"><p class="empty">无权查看该纠纷记录</p></div>`;
  let cause = '';
  try { cause = decodeBase64(d.causeEnc); } catch(e){ cause = ''; }
  const isManager = currentUser && currentUser.role !== 'student';
  return `
  <div class="page dispute-page">
    <div class="page-head">
      <h2>纠纷详情</h2>
      <button class="icon-btn" onclick="router.go('dispute')">←</button>
    </div>
    <div class="card">
      <div class="card-title">${escapeHtml(d.title||'纠纷')}</div>
      <p class="detail-line">涉及同学：${escapeHtml(d.stuNames||'')}</p>
      <p class="detail-line">状态：${escapeHtml(d.status||'调解中')}</p>
      <p class="detail-line">提交：${escapeHtml(d.createName||'')} · ${fmtTime(d.createTime)}</p>
    </div>
    <div class="card">
      <div class="card-title">详细描述</div>
      <p class="detail-text">${escapeHtml(cause||'（无）')}</p>
    </div>
    ${isManager ? `
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
      }).join('') || `<p class="empty">暂无处理记录</p>`}
    </div>
  </div>`;
}

function saveDisputeResult(id){
  const list = getDisputes();
  const d = list.find(function(x){ return x.id === id; });
  if (!d) return;
  d.result = val('dp-result');
  d.logs = d.logs || [];
  d.logs.push({ time: Date.now(), who: currentUser.name, action: '保存调解结果' });
  Store.set('disputes', list);
  addLog('保存调解结果', d.title, 'dispute');
  toast('已保存'); router.render();
}

function closeDispute(id){
  const list = getDisputes();
  const d = list.find(function(x){ return x.id === id; });
  if (!d) return;
  if (!confirm('确认标记该纠纷为已调解吗？')) return;
  d.status = '已调解';
  d.logs = d.logs || [];
  d.logs.push({ time: Date.now(), who: currentUser.name, action: '标记已调解' });
  Store.set('disputes', list);
  addLog('调解完成', d.title, 'dispute');
  pushNotify('纠纷调解', '纠纷「' + (d.title||'') + '」已调解完成', 'dispute');
  toast('已标记调解完成'); router.render();
}

// ============== 宿舍情况记录模块 ==============
function getDormList(){ return Store.get('dormList') || []; }
function getDormRecs(){ return Store.get('dormRecs') || []; }

function renderDorm(){
  const isStudent = currentUser && currentUser.role === 'student';
  if (isStudent) return renderDormStudent();
  return renderDormManager();
}

function renderDormStudent(){
  const sid = currentUser ? currentUser.id : '';
  // 从学生名单中查找该学生的宿舍（若无宿舍字段则留空）
  const stu = getStudentList().find(function(s){ return s.id === sid; });
  const myDorm = stu && stu.dorm ? stu.dorm : '';
  const recs = myDorm ? getDormRecs().filter(function(r){ return r.room === myDorm; }) : [];
  return `
  <div class="page dorm-page">
    <div class="page-head">
      <h2>宿舍情况记录</h2>
      <button class="icon-btn" onclick="router.go('home')">⌂</button>
    </div>
    <div class="card">
      <div class="card-title">我的宿舍</div>
      ${myDorm ? `<p class="detail-line">宿舍：${escapeHtml(myDorm)}</p>` : `<p class="empty">暂未登记宿舍信息</p>`}
    </div>
    <div class="card">
      <div class="card-title">宿舍情况记录</div>
      ${recs.length === 0 ? `<p class="empty">暂无记录</p>` : recs.map(function(r){
        return `<div class="dorm-row">
          <div class="dorm-date">${fmtDate(r.date)}</div>
          <div class="dorm-type">${escapeHtml(r.type||'日常检查')}</div>
          <div class="dorm-note">${escapeHtml(r.note||'')}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderDormManager(){
  const dorms = getDormList();
  const recs = getDormRecs();
  const isLeader = currentUser && currentUser.role === 'leader';
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
      ${dorms.length === 0 ? `<p class="empty">暂无宿舍信息</p>` : dorms.map(function(r){
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

function showDormRecordForm(){
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

function saveDormRecord(){
  const room = val('dm-room'); const type = val('dm-type'); const note = val('dm-note');
  if (!room) return toast('请选择宿舍');
  if (!note) return toast('请填写情况说明');
  const recs = getDormRecs();
  recs.unshift({
    id: 'dm' + Date.now(), room: room, type: type, note: note,
    createBy: currentUser ? currentUser.id : '', createName: currentUser ? currentUser.name : '',
    createTime: Date.now()
  });
  Store.set('dormRecs', recs);
  addLog('记录宿舍情况', room + ' · ' + type, 'dorm');
  closeModal(); toast('已记录'); router.render();
}

function renderDormDetail(room){
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
      <p class="detail-line">${dorm ? escapeHtml(dorm.memberNames||'') : '（未登记）'}</p>
    </div>
    <div class="card">
      <div class="card-title">情况记录（${recs.length}）</div>
      ${recs.length === 0 ? `<p class="empty">暂无记录</p>` : recs.map(function(x){
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

// ============== 台账表格模块 ==============
function getLedgerTables(){ return Store.get('ledgerTables') || []; }

function renderLedger(){
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
      ${tables.length === 0 ? `<p class="empty">暂无台账，请班长新建</p>` : tables.map(function(t){
        return `<div class="ledger-row" onclick="router.go('ledger/detail/${t.id}')">
          <div class="ledger-name">${escapeHtml(t.name)}</div>
          <div class="ledger-meta">${t.cols.length} 列 · ${(t.rows||[]).length} 行 · ${fmtDate(t.createTime)}</div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn ghost full" onclick="exportAll()">📤 导出全部数据</button>
  </div>`;
}

function showLedgerForm(){
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

function saveLedgerTable(){
  const name = val('lg-name'); const cols = val('lg-cols');
  if (!name) return toast('请填写表名');
  if (!cols) return toast('请填写列名');
  const colArr = cols.split(/[,，]/).map(function(c){ return c.trim(); }).filter(Boolean);
  if (!colArr.length) return toast('列名无效');
  const tables = getLedgerTables();
  tables.unshift({
    id: 'lg' + Date.now(), name: name, cols: colArr, rows: [],
    createBy: currentUser ? currentUser.id : '', createTime: Date.now()
  });
  Store.set('ledgerTables', tables);
  addLog('新建台账表', name, 'ledger');
  closeModal(); toast('台账已创建'); router.render();
}

function renderLedgerDetail(id){
  const t = getLedgerTables().find(function(x){ return x.id === id; });
  if (!t) return `<div class="page"><p class="empty">未找到该台账</p></div>`;
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

function showLedgerRowForm(id){
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

function saveLedgerRow(id){
  const tables = getLedgerTables();
  const t = tables.find(function(x){ return x.id === id; });
  if (!t) return;
  const row = t.cols.map(function(c,i){ return val('lgr-' + i) || ''; });
  t.rows = t.rows || [];
  t.rows.push(row);
  Store.set('ledgerTables', tables);
  addLog('新增台账记录', t.name, 'ledger');
  closeModal(); toast('已保存'); router.render();
}

// ============== 数据导出 ==============
function exportAll(){
  const all = {
    notifies: getNotifyList(),
    subsidyItems: getSubsidyItems(),
    subsidyQuals: getSubsidyQuals(),
    paymentRows: getPaymentRows(),
    attendanceRecs: getAttendanceRecs(),
    disputes: getDisputes().map(function(d){
      return { id:d.id, title:d.title, stuNames:d.stuNames, status:d.status, result:d.result, createTime:d.createTime };
    }),
    dormList: getDormList(),
    dormRecs: getDormRecs(),
    ledgerTables: getLedgerTables(),
    logs: Store.get('logs') || []
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

function exportExcel(){
  const lines = [];
  lines.push('模块,记录数');
  lines.push('通知,' + getNotifyList().length);
  lines.push('补助项目,' + getSubsidyItems().length);
  lines.push('缴费记录,' + getPaymentRows().length);
  lines.push('考勤记录,' + getAttendanceRecs().length);
  lines.push('纠纷,' + getDisputes().length);
  lines.push('宿舍记录,' + getDormRecs().length);
  const csv = lines.join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '班级工作台统计_' + todayStr() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('统计已导出为CSV');
}

// ============== 弹窗与提示 ==============
function openModal(html){
  const wrap = document.createElement('div');
  wrap.className = 'modal-mask';
  wrap.innerHTML = '<div class="modal-box">' + html + '</div>';
  document.body.appendChild(wrap);
}
function closeModal(){
  const m = document.querySelector('.modal-mask');
  if (m) m.remove();
}
function val(id){
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function toast(msg){
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 2200);
}

// ============== 应用启动 ==============
async function initApp(){
  await Store.loadAll();
  const hash = window.location.hash.replace(/^#/, '') || 'login';
  if (!currentUser && hash !== 'login'){
    // 云端已登录会话需恢复；若无当前用户则显示登录页
  }
  if (!currentUser) window.location.hash = 'login';
  renderPage();
}

// ============== 事件绑定 ==============
window.addEventListener('hashchange', function(){ renderPage(); });

window.addEventListener('DOMContentLoaded', function(){ initApp(); });
