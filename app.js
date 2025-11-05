import { 
  getAuth, onAuthStateChanged, signInWithPopup, signOut 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, addDoc, collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, listAll, getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

const auth = FB.auth, db = FB.db, storage = FB.storage;

/* ---------- Navegación ---------- */
document.querySelectorAll('.nav-item[data-page]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('show'));
    document.querySelector('#page-'+btn.dataset.page).classList.add('show');
  });
});
document.getElementById('btnSettings').onclick = ()=> {
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('show'));
  document.querySelector('#page-settings').classList.add('show');
};

/* ---------- Auth (Google + PIN) ---------- */
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const userPhoto = document.getElementById('userPhoto');

document.getElementById('btnGoogle').onclick = async()=>{
  await signInWithPopup(auth, FB.GoogleProvider);
};
document.getElementById('btnLogout').onclick = ()=> signOut(auth);

onAuthStateChanged(auth, async(user)=>{
  if(!user){ userName.textContent='Invitado'; userEmail.textContent=''; userPhoto.src=''; return; }
  userName.textContent = user.displayName || 'Usuario';
  userEmail.textContent = user.email || '';
  userPhoto.src = user.photoURL || '';
});

/* PIN gate: guarda un hash del PIN por usuario (demo) */
const sha256 = async (text)=> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
};

document.getElementById('btnPin').onclick = async ()=>{
  const u = auth.currentUser;
  if(!u){ alert('Primero inicia sesión con Google.'); return; }
  const pin = document.getElementById('pinInput').value.trim();
  if(pin.length<4){ alert('PIN muy corto.'); return; }
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref);
  const h = await sha256(pin);
  if(!snap.exists()){
    await setDoc(ref, { pinHash:h, createdAt:Date.now() });
    alert('PIN creado. Acceso concedido.');
  }else{
    const ok = snap.data().pinHash===h;
    alert(ok ? 'Acceso concedido.' : 'PIN incorrecto.');
  }
};

/* ---------- Accounting (asientos + balance) ---------- */
const formEntry = document.getElementById('formEntry');
const journalList = document.getElementById('journalList');
const balanceBox = document.getElementById('balanceBox');

formEntry.addEventListener('submit', async(e)=>{
  e.preventDefault();
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const data = Object.fromEntries(new FormData(formEntry).entries());
  data.debit = Number(data.debit||0); data.credit = Number(data.credit||0);
  await addDoc(collection(db, 'users', u.uid, 'journal'), data);
  formEntry.reset();
});

const renderBalance = (rows)=>{
  const debit = rows.reduce((s,r)=>s+Number(r.debit||0),0);
  const credit= rows.reduce((s,r)=>s+Number(r.credit||0),0);
  const diff = (debit-credit).toFixed(2);
  balanceBox.textContent = `Debe: ${debit.toFixed(2)} | Haber: ${credit.toFixed(2)} | Diferencia: ${diff}`;
};

onAuthStateChanged(auth, (u)=>{
  if(!u) return;
  const q = query(collection(db, 'users', u.uid, 'journal'), orderBy('date','desc'));
  onSnapshot(q, (snap)=>{
    const rows = [];
    journalList.innerHTML='';
    snap.forEach(d=>{
      const r = d.data(); rows.push(r);
      const li = document.createElement('li');
      li.textContent = `${r.date} · ${r.account} · D:${r.debit||0} H:${r.credit||0}`;
      journalList.appendChild(li);
    });
    renderBalance(rows);
  });
});

/* ---------- Invoicing ---------- */
const formInvoice = document.getElementById('formInvoice');
const invoiceList = document.getElementById('invoiceList');

formInvoice.addEventListener('submit', async(e)=>{
  e.preventDefault();
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const data = Object.fromEntries(new FormData(formInvoice).entries());
  data.status='draft'; data.createdAt=Date.now();
  await addDoc(collection(db, 'users', u.uid, 'invoices'), data);
  formInvoice.reset();
});
onAuthStateChanged(auth, (u)=>{
  if(!u) return;
  const q = query(collection(db, 'users', u.uid, 'invoices'), orderBy('createdAt','desc'));
  onSnapshot(q, (snap)=>{
    invoiceList.innerHTML='';
    snap.forEach(d=>{
      const inv = d.data();
      const li = document.createElement('li');
      li.innerHTML = `<b>${inv.customer}</b> — ${Number(inv.amount).toFixed(2)} · vence ${inv.due} · <i>${inv.status}</i>`;
      invoiceList.appendChild(li);
    });
  });
});

/* ---------- Tax Filing (cálculo simple demo) ---------- */
const formTax = document.getElementById('formTax');
const taxResult = document.getElementById('taxResult');
formTax.addEventListener('submit', async(e)=>{
  e.preventDefault();
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const data = Object.fromEntries(new FormData(formTax).entries());
  const income = Number(data.income||0), expenses = Number(data.expenses||0);
  const taxable = Math.max(0, income - expenses);
  const estimate = taxable * 0.21; // tasa plana DEMO
  taxResult.textContent = `Base: ${taxable.toFixed(2)} | Impuesto estimado: ${estimate.toFixed(2)}`;
  await addDoc(collection(db, 'users', u.uid, 'tax'), { ...data, taxable, estimate, ts:Date.now() });
});

/* ---------- Virtual Mailroom (Gmail API) ---------- */
/* Requiere: habilitar Gmail API en Google Cloud, OAuth con orígenes de tu hosting,
   scopes mínimos: https://www.googleapis.com/auth/gmail.readonly, https://www.googleapis.com/auth/gmail.send
*/
let googleAccessToken = null;

function initGis(){
  /* Usando el nuevo Token Client (GSI) */
  window.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: 'TU_CLIENT_ID_OAUTH', // desde Google Cloud
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    callback: (resp)=> { googleAccessToken = resp.access_token; alert('Gmail conectado'); }
  });
}
window.onload = initGis;

document.getElementById('btnGmailConnect').onclick = ()=>{
  if(!tokenClient){ return alert('Cargando Google…'); }
  tokenClient.requestAccessToken({ prompt: 'consent' });
};

async function gmailFetch(path, method='GET', body){
  if(!googleAccessToken) throw new Error('Sin token Gmail');
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method,
    headers:{ 'Authorization':`Bearer ${googleAccessToken}`, 'Content-Type':'application/json' },
    body: body? JSON.stringify(body): undefined
  });
  return res.json();
}

document.getElementById('btnFetchMail').onclick = async()=>{
  try{
    const data = await gmailFetch('messages?maxResults=10');
    const list = document.getElementById('mailList');
    list.innerHTML='';
    if(!data.messages){ list.innerHTML='<li>No hay correos.</li>'; return; }
    for(const m of data.messages){
      const full = await gmailFetch(`messages/${m.id}`);
      const subject = (full.payload.headers.find(h=>h.name==='Subject')||{}).value || '(sin asunto)';
      const from = (full.payload.headers.find(h=>h.name==='From')||{}).value || '';
      const li = document.createElement('li');
      li.innerHTML = `<b>${subject}</b><br><span class="muted">${from}</span>`;
      list.appendChild(li);
    }
  }catch(err){ alert(err.message); }
};

document.getElementById('formSendMail').addEventListener('submit', async(e)=>{
  e.preventDefault();
  try{
    const fd = new FormData(e.target);
    const to = fd.get('to'), subject=fd.get('subject'), body=fd.get('body');
    const raw = btoa(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`
    ).replace(/\+/g,'-').replace(/\//g,'_'); // base64url
    await gmailFetch('messages/send', 'POST', { raw });
    alert('Correo enviado');
    e.target.reset();
  }catch(err){ alert(err.message); }
});

/* ---------- Registered Agent (Storage) ---------- */
document.getElementById('btnUploadAgent').onclick = async()=>{
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const f = document.getElementById('fileAgent').files[0];
  if(!f) return;
  const r = ref(storage, `users/${u.uid}/agent/${Date.now()}_${f.name}`);
  await uploadBytes(r, f);
  alert('Archivo subido');
  loadAgentFiles();
};
async function loadAgentFiles(){
  const u = auth.currentUser; if(!u) return;
  const listRef = ref(storage, `users/${u.uid}/agent`);
  const { items } = await listAll(listRef);
  const ul = document.getElementById('agentFiles');
  ul.innerHTML='';
  for(const i of items){
    const url = await getDownloadURL(i);
    const li = document.createElement('li');
    li.innerHTML = `<a href="${url}" target="_blank">${i.name}</a>`;
    ul.appendChild(li);
  }
}
onAuthStateChanged(auth, loadAgentFiles);

/* ---------- Configuración (tema + tono) ---------- */
const themeSelect = document.getElementById('themeSelect');
const hueRange = document.getElementById('hueRange');
hueRange.oninput = ()=> document.documentElement.style.setProperty('--hue', hueRange.value);
themeSelect.onchange = ()=>{
  const t = themeSelect.value;
  if(t==='light') document.body.style.filter='invert(1) hue-rotate(180deg)';
  else if(t==='dark') document.body.style.filter='none';
  else document.body.style.filter=''; // auto
};
