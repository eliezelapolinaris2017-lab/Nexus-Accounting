import {
  getAuth, onAuthStateChanged, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, addDoc, collection, query, orderBy, onSnapshot, getDocs
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
document.getElementById('btnSettings').onclick = ()=>{
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('show'));
  document.querySelector('#page-settings').classList.add('show');
};

/* ---------- Auth + PIN ---------- */
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const userPhoto = document.getElementById('userPhoto');

document.getElementById('btnGoogle').onclick = ()=> signInWithPopup(auth, FB.GoogleProvider);
document.getElementById('btnLogout').onclick = ()=> signOut(auth);

onAuthStateChanged(auth, (user)=>{
  if(!user){ userName.textContent='Invitado'; userEmail.textContent=''; userPhoto.src=''; return; }
  userName.textContent = user.displayName || 'Usuario';
  userEmail.textContent = user.email || '';
  userPhoto.src = user.photoURL || '';
});

const sha256 = async (text)=>{
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
};

async function seedChartOfAccountsIfNeeded(u){
  const uref = doc(db,'users',u.uid);
  const snap = await getDoc(uref);
  const seeded = snap.exists() && snap.data().coaSeeded;
  if(seeded) return;
  const base = [
    {code:'1000', name:'Caja',        type:'asset'},
    {code:'1100', name:'Bancos',      type:'asset'},
    {code:'1200', name:'Clientes',    type:'asset'},
    {code:'1400', name:'Inventario',  type:'asset'},
    {code:'2000', name:'Proveedores', type:'liability'},
    {code:'2100', name:'Impuestos por pagar', type:'liability'},
    {code:'3000', name:'Capital',     type:'equity'},
    {code:'3100', name:'Resultados acumulados', type:'equity'},
    {code:'4000', name:'Ingresos',    type:'revenue'},
    {code:'5000', name:'Gastos',      type:'expense'}
  ];
  for(const a of base){
    await setDoc(doc(db,'users',u.uid,'accounts',a.code), a, {merge:true});
  }
  await setDoc(uref, { coaSeeded:true }, { merge:true });
}

document.getElementById('btnPin').onclick = async ()=>{
  const u = auth.currentUser; if(!u) return alert('Primero inicia sesión con Google.');
  const pin = document.getElementById('pinInput').value.trim();
  if(!/^\d{4,8}$/.test(pin)) return alert('PIN 4–8 dígitos.');
  const refUser = doc(db, 'users', u.uid);
  const h = await sha256(pin);
  const snap = await getDoc(refUser);
  if(!snap.exists()){
    await setDoc(refUser, { pinHash:h, createdAt:Date.now() });
    await seedChartOfAccountsIfNeeded(u);
    alert('PIN creado. Acceso concedido.');
  }else{
    const ok = snap.data().pinHash===h;
    if(ok){ await seedChartOfAccountsIfNeeded(u); }
    alert(ok ? 'Acceso concedido.' : 'PIN incorrecto.');
  }
};

/* ---------- SETTINGS ---------- */
const themeSelect = document.getElementById('themeSelect');
themeSelect.onchange = ()=>{
  const t = themeSelect.value;
  if(t==='light') document.body.style.filter='invert(1) hue-rotate(180deg)';
  else if(t==='dark') document.body.style.filter='none';
  else document.body.style.filter='';
};

/* ---------- ACCOUNTING: catálogo validado + estados ---------- */
const linesBody = document.getElementById('linesBody');
const sumDebitEl = document.getElementById('sumDebit');
const sumCreditEl = document.getElementById('sumCredit');
const formTxn = document.getElementById('formTxn');
const txnList = document.getElementById('txnList');
const ledgerInfo = document.getElementById('ledgerInfo');

function addLineRow(){
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input placeholder="Código (ej. 1100) o nombre" class="acc"></td>
    <td><input type="number" step="0.01" class="debit"></td>
    <td><input type="number" step="0.01" class="credit"></td>
    <td><button type="button" class="btn ghost rm">✕</button></td>`;
  tr.querySelector('.rm').onclick = ()=>{ tr.remove(); recalcSums(); };
  ['input','change'].forEach(ev=>{
    tr.querySelector('.debit').addEventListener(ev, ()=>{ if(tr.querySelector('.debit').value) tr.querySelector('.credit').value=''; recalcSums(); });
    tr.querySelector('.credit').addEventListener(ev, ()=>{ if(tr.querySelector('.credit').value) tr.querySelector('.debit').value=''; recalcSums(); });
  });
  linesBody.appendChild(tr);
}
document.getElementById('btnAddLine').onclick = addLineRow;
addLineRow(); addLineRow();

function recalcSums(){
  let d=0,c=0;
  linesBody.querySelectorAll('tr').forEach(tr=>{
    d += Number(tr.querySelector('.debit').value||0);
    c += Number(tr.querySelector('.credit').value||0);
  });
  sumDebitEl.textContent=d.toFixed(2);
  sumCreditEl.textContent=c.toFixed(2);
}

async function accountsMap(){
  const u = auth.currentUser; if(!u) throw new Error('Login requerido');
  const snap = await getDocs(collection(db,'users',u.uid,'accounts'));
  const map = new Map();
  snap.forEach(d=>map.set(d.id, d.data()));
  // también mapear por nombre en mayúsculas
  snap.forEach(d=>map.set(d.data().name.toUpperCase(), d.data()));
  return map;
}

formTxn.addEventListener('submit', async(e)=>{
  e.preventDefault();
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const accMap = await accountsMap();

  const fd = new FormData(formTxn);
  const date = fd.get('date'); const memo = fd.get('memo') || '';
  const lines = [];
  linesBody.querySelectorAll('tr').forEach(tr=>{
    const raw = tr.querySelector('.acc').value.trim();
    const accKey = accMap.get(raw) ? raw : accMap.get(raw.toUpperCase()) ? raw.toUpperCase() : null;
    const account = accKey ? (accMap.get(accKey).code || accKey) : raw;
    const debit  = Number(tr.querySelector('.debit').value||0);
    const credit = Number(tr.querySelector('.credit').value||0);
    if(raw && (debit>0 || credit>0)) lines.push({account, debit, credit});
  });

  // Validar cuentas contra catálogo
  for(const l of lines){
    const exists = accMap.has(l.account) || accMap.has(l.account.toUpperCase());
    if(!exists) return alert(`Cuenta inexistente: ${l.account}. Agrega al catálogo antes de usarla.`);
  }

  const totalD = lines.reduce((s,l)=>s+l.debit,0);
  const totalC = lines.reduce((s,l)=>s+l.credit,0);
  if(lines.length<2 || totalD<=0 || totalC<=0 || totalD.toFixed(2)!==totalC.toFixed(2))
    return alert('Asiento inválido: Debe y Haber deben ser > 0 e iguales.');

  await addDoc(collection(db,'users',u.uid,'transactions'), {date, memo, lines, ts:Date.now()});
  formTxn.reset(); linesBody.innerHTML=''; addLineRow(); addLineRow(); recalcSums();
});

function ledgerFromTransactions(trans, accMapObj){
  // accMapObj puede venir vacío; inferimos por tipo por código
  const map = new Map();
  const findType = (code)=> {
    const a = accMapObj.get(code) || accMapObj.get(code.toUpperCase());
    return a ? a.type : 'asset';
  };
  for(const t of trans){
    for(const l of t.lines){
      if(!map.has(l.account)) map.set(l.account,{code:l.account, name:l.account, type:findType(l.account), debit:0, credit:0});
      const acc = map.get(l.account);
      acc.debit  += Number(l.debit||0);
      acc.credit += Number(l.credit||0);
      map.set(l.account, acc);
    }
  }
  return Array.from(map.values());
}
function trialBalance(rows){
  const totalD = rows.reduce((s,r)=>s+r.debit,0);
  const totalC = rows.reduce((s,r)=>s+r.credit,0);
  return { totalD, totalC, ok: totalD.toFixed(2)===totalC.toFixed(2) };
}
function financialStatements(rows){
  const bal = {assets:0, liabilities:0, equity:0};
  let revenue=0, expense=0;
  for(const r of rows){
    const mov = r.debit - r.credit;
    if(r.type==='asset') bal.assets += mov;
    if(r.type==='liability') bal.liabilities -= mov;
    if(r.type==='equity') bal.equity -= mov;
    if(r.type==='revenue') revenue += (r.credit - r.debit);
    if(r.type==='expense') expense += (r.debit - r.credit);
  }
  const netIncome = revenue - expense;
  const balanceOk = (bal.assets).toFixed(2) === (bal.liabilities + bal.equity + netIncome).toFixed(2);
  return { revenue, expense, netIncome, balance:bal, balanceOk };
}

onAuthStateChanged(auth, async(u)=>{
  if(!u) return;
  const accMapObj = await accountsMap();
  const qTx = query(collection(db,'users',u.uid,'transactions'), orderBy('date','desc'));
  onSnapshot(qTx, snap=>{
    const trans = snap.docs.map(d=>({id:d.id, ...d.data()}));
    txnList.innerHTML='';
    trans.forEach(t=>{
      const li = document.createElement('li');
      li.textContent = `${t.date} · ${t.memo || 'Asiento'} · líneas: ${t.lines.length}`;
      txnList.appendChild(li);
    });
    const ledger = ledgerFromTransactions(trans, accMapObj);
    const tb = trialBalance(ledger);
    const fs = financialStatements(ledger);
    ledgerInfo.innerHTML = `
      <b>Comprobación</b> — Debe ${tb.totalD.toFixed(2)} / Haber ${tb.totalC.toFixed(2)} ${tb.ok?'✅':'❌'}<br>
      <b>PyG</b> — Ingresos ${fs.revenue.toFixed(2)} · Gastos ${fs.expense.toFixed(2)} · <b>Resultado</b> ${fs.netIncome.toFixed(2)}<br>
      <b>Balance</b> — Activos ${fs.balance.assets.toFixed(2)} = Pasivos+Patrimonio+Resultado ${(fs.balance.liabilities+fs.balance.equity+fs.netIncome).toFixed(2)} ${fs.balanceOk?'✅':'❌'}
    `;
  });
});

/* ---------- INVOICING: PDF + Gmail adjunto ---------- */
const formInvoice = document.getElementById('formInvoice');
const invoiceList = document.getElementById('invoiceList');

async function generateInvoicePDF(inv){
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  doc.setFontSize(18); doc.text('Factura', 14, 18);
  doc.setFontSize(11);
  doc.text(`Cliente: ${inv.customer}`, 14, 28);
  doc.text(`Email: ${inv.email}`, 14, 34);
  doc.text(`Fecha: ${new Date(inv.createdAt).toLocaleDateString()}`, 14, 40);
  doc.text(`Vence: ${inv.due}`, 14, 46);
  const total = Number(inv.qty)*Number(inv.price);
  doc.autoTable({
    startY: 54,
    head:[['Concepto','Cant.','Precio','Total']],
    body:[[inv.concept, inv.qty, Number(inv.price).toFixed(2), total.toFixed(2)]],
    theme:'grid'
  });
  doc.text(`Total a pagar: ${total.toFixed(2)}`, 150, doc.lastAutoTable.finalY + 10);
  return doc.output('arraybuffer');
}
async function gmailFetch(path, method='GET', body){
  if(!window.googleAccessToken) throw new Error('Conecta Gmail primero.');
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method, headers:{ 'Authorization':`Bearer ${window.googleAccessToken}`, 'Content-Type':'application/json' },
    body: body? JSON.stringify(body): undefined
  });
  if(!res.ok) throw new Error('Gmail API error');
  return res.json();
}
async function sendGmailWithAttachment(to, subject, text, filename, arrayBuffer){
  const base64file = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const boundary = 'mix_'+Date.now();
  const body =
`To: ${to}
Subject: ${subject}
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundary}"

--${boundary}
Content-Type: text/plain; charset="UTF-8"

${text}

--${boundary}
Content-Type: application/pdf; name="${filename}"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="${filename}"

${base64file}
--${boundary}--`;
  const raw = btoa(body).replace(/\+/g,'-').replace(/\//g,'_');
  return gmailFetch('messages/send','POST',{ raw });
}
formInvoice.addEventListener('submit', async(e)=>{
  e.preventDefault();
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const fd = Object.fromEntries(new FormData(formInvoice).entries());
  const data = {
    customer:fd.customer, email:fd.email, concept:fd.concept,
    qty:Number(fd.qty), price:Number(fd.price), due:fd.due,
    createdAt:Date.now(), status:'sent'
  };
  await addDoc(collection(db,'users',u.uid,'invoices'), data);
  const pdf = await generateInvoicePDF(data);
  const r = ref(storage, `users/${u.uid}/invoices/${data.createdAt}.pdf`);
  await uploadBytes(r, new Blob([pdf], {type:'application/pdf'}));
  await sendGmailWithAttachment(
    data.email, `Factura ${data.createdAt}`, `Hola ${data.customer}, adjuntamos tu factura.`,
    'invoice.pdf', pdf
  );
  alert('Factura creada y enviada.');
  formInvoice.reset();
});
onAuthStateChanged(auth, (u)=>{
  if(!u) return;
  const q = query(collection(db,'users',u.uid,'invoices'), orderBy('createdAt','desc'));
  onSnapshot(q, snap=>{
    invoiceList.innerHTML='';
    snap.forEach(d=>{
      const inv = d.data();
      const total = inv.qty*inv.price;
      const li = document.createElement('li');
      li.innerHTML = `<b>${inv.customer}</b> · ${inv.concept} · ${total.toFixed(2)} · vence ${inv.due} · <i>${inv.status}</i>`;
      invoiceList.appendChild(li);
    });
  });
});

/* ---------- TAX: tramos progresivos + PDF ---------- */
const TAX_BRACKETS = [
  { upTo: 10000, rate: 0.00 },
  { upTo: 40000, rate: 0.10 },
  { upTo: 80000, rate: 0.20 },
  { upTo: Infinity, rate: 0.30 }
];
function progressiveTax(taxable){
  let remaining = taxable, last=0, total=0, lines=[];
  for(const b of TAX_BRACKETS){
    const slice = Math.max(0, Math.min(remaining, b.upTo - last));
    const tax = slice * b.rate;
    if(slice>0) lines.push({base:slice, rate:b.rate, tax});
    total += tax; remaining -= slice; last=b.upTo;
    if(remaining<=0) break;
  }
  return { total, lines };
}
async function taxToPDF(tax){
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  doc.setFontSize(18); doc.text('Resumen Fiscal', 14, 18);
  doc.setFontSize(11);
  doc.text(`Año: ${tax.year}`, 14, 28);
  doc.text(`Ingresos: ${tax.income.toFixed(2)}`, 14, 34);
  doc.text(`Gastos: ${tax.expenses.toFixed(2)}`, 14, 40);
  doc.text(`Base imponible: ${tax.taxable.toFixed(2)}`, 14, 46);
  doc.autoTable({
    startY: 54,
    head:[['Tramo','Tasa','Impuesto']],
    body: tax.lines.map(l=>[l.base.toFixed(2), (l.rate*100).toFixed(0)+'%', l.tax.toFixed(2)]),
    theme:'grid'
  });
  doc.text(`Total impuesto: ${tax.total.toFixed(2)}`, 150, doc.lastAutoTable.finalY + 10);
  return doc.output('arraybuffer');
}
const formTax = document.getElementById('formTax');
const taxResult = document.getElementById('taxResult');
const taxList = document.getElementById('taxList');
formTax.addEventListener('submit', async(e)=>{
  e.preventDefault();
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const fd = Object.fromEntries(new FormData(formTax).entries());
  const income = Number(fd.income), expenses=Number(fd.expenses);
  const taxable = Math.max(0, income-expenses);
  const prog = progressiveTax(taxable);
  const rec = { ein:fd.ein, year:Number(fd.year), income, expenses, taxable, total:prog.total, lines:prog.lines, ts:Date.now() };
  taxResult.textContent = `Base: ${taxable.toFixed(2)} · Impuesto: ${prog.total.toFixed(2)}`;
  await addDoc(collection(db,'users',u.uid,'tax'), rec);
  const pdf = await taxToPDF(rec);
  const r = ref(storage, `users/${u.uid}/tax/${rec.year}_${rec.ts}.pdf`);
  await uploadBytes(r, new Blob([pdf], {type:'application/pdf'}));
  alert('Cálculo fiscal guardado y PDF generado.');
  formTax.reset();
});
onAuthStateChanged(auth, (u)=>{
  if(!u) return;
  const q = query(collection(db,'users',u.uid,'tax'), orderBy('ts','desc'));
  onSnapshot(q, snap=>{
    taxList.innerHTML='';
    snap.forEach(d=>{
      const t = d.data();
      const li = document.createElement('li');
      li.textContent = `Año ${t.year} · Base ${t.taxable.toFixed(2)} · Impuesto ${t.total.toFixed(2)}`;
      taxList.appendChild(li);
    });
  });
});

/* ---------- VIRTUAL MAILROOM (Gmail API) ---------- */
let tokenClient = null; window.googleAccessToken = null;
function initGis(){
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: 'TU_CLIENT_ID_OAUTH', // <-- pon aquí tu OAuth Web Client ID
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    callback: (resp)=>{ window.googleAccessToken = resp.access_token; alert('Gmail conectado'); }
  });
}
window.onload = initGis;

document.getElementById('btnGmailConnect').onclick = ()=>{
  if(!tokenClient) return alert('Cargando Google…');
  tokenClient.requestAccessToken({ prompt:'consent' });
};

document.getElementById('btnFetchMail').onclick = async()=>{
  try{
    const data = await gmailFetch('messages?maxResults=10');
    const list = document.getElementById('mailList'); list.innerHTML='';
    if(!data.messages){ list.innerHTML='<li>No hay correos.</li>'; return; }
    for(const m of data.messages){
      const full = await gmailFetch(`messages/${m.id}`);
      const s = (full.payload.headers.find(h=>h.name==='Subject')||{}).value || '(sin asunto)';
      const f = (full.payload.headers.find(h=>h.name==='From')||{}).value || '';
      const li = document.createElement('li'); li.innerHTML=`<b>${s}</b><br><span class="muted">${f}</span>`;
      list.appendChild(li);
    }
  }catch(e){ alert(e.message); }
};

document.getElementById('formSendMail').addEventListener('submit', async(e)=>{
  e.preventDefault();
  try{
    const fd = new FormData(e.target);
    const to=fd.get('to'), subject=fd.get('subject'), body=fd.get('body');
    const file = fd.get('attach');
    if(file && file.size>0){
      const buf = await file.arrayBuffer();
      await sendGmailWithAttachment(to, subject, body, file.name, buf);
    }else{
      const raw = btoa(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`).replace(/\+/g,'-').replace(/\//g,'_');
      await gmailFetch('messages/send','POST',{ raw });
    }
    alert('Correo enviado'); e.target.reset();
  }catch(err){ alert(err.message); }
});

/* ---------- REGISTERED AGENT (Storage) ---------- */
document.getElementById('btnUploadAgent').onclick = async()=>{
  const u = auth.currentUser; if(!u) return alert('Login requerido');
  const f = document.getElementById('fileAgent').files[0]; if(!f) return;
  const r = ref(storage, `users/${u.uid}/agent/${Date.now()}_${f.name}`);
  await uploadBytes(r, f); alert('Archivo subido'); loadAgentFiles();
};
async function loadAgentFiles(){
  const u = auth.currentUser; if(!u) return;
  const listRef = ref(storage, `users/${u.uid}/agent`);
  const { items } = await listAll(listRef);
  const ul = document.getElementById('agentFiles'); ul.innerHTML='';
  for(const i of items){
    const url = await getDownloadURL(i);
    const li = document.createElement('li');
    li.innerHTML = `<a href="${url}" target="_blank" rel="noopener">${i.name}</a>`;
    ul.appendChild(li);
  }
}
onAuthStateChanged(auth, loadAgentFiles);
