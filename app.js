import {
  getAuth, onAuthStateChanged, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, addDoc, collection, query, orderBy, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const auth = FB.auth, db = FB.db;

/* ------------ Navegación ------------ */
document.querySelectorAll('.nav-item[data-page]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('show'));
    document.getElementById('page-'+btn.dataset.page).classList.add('show');
  });
});
document.querySelectorAll('[data-jump]').forEach(b=>{
  b.onclick = ()=> document.querySelector(`.nav-item[data-page="${b.dataset.jump}"]`).click();
});

/* ------------ Auth ------------ */
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const userPhoto = document.getElementById('userPhoto');
document.getElementById('btnGoogle').onclick = ()=> signInWithPopup(auth, FB.GoogleProvider);
document.getElementById('btnLogout').onclick = ()=> signOut(auth);

onAuthStateChanged(auth, async(user)=>{
  if(!user){ userName.textContent='Invitado'; userEmail.textContent=''; userPhoto.src=''; return; }
  userName.textContent = user.displayName || 'Usuario';
  userEmail.textContent = user.email || '';
  userPhoto.src = user.photoURL || '';
  await seedCOAIfNeeded(user.uid);
  attachLive();
});

/* ------------ Catálogo de cuentas ------------ */
async function seedCOAIfNeeded(uid){
  const uref = doc(db,'users',uid);
  const snap = await getDoc(uref);
  if(snap.exists() && snap.data().coaSeeded) return;
  const base = [
    {code:'1000', name:'Caja', type:'asset'},
    {code:'1100', name:'Bancos', type:'asset'},
    {code:'1200', name:'Clientes', type:'asset'},
    {code:'1400', name:'Inventario', type:'asset'},
    {code:'2000', name:'Proveedores', type:'liability'},
    {code:'2100', name:'Impuestos por pagar', type:'liability'},
    {code:'3000', name:'Capital', type:'equity'},
    {code:'3100', name:'Resultados acumulados', type:'equity'},
    {code:'4000', name:'Ingresos', type:'revenue'},
    {code:'5000', name:'Gastos', type:'expense'}
  ];
  for(const a of base){
    await setDoc(doc(db,'users',uid,'accounts',a.code), a, {merge:true});
  }
  await setDoc(uref, { coaSeeded:true }, { merge:true });
}
const formAccount = document.getElementById('formAccount');
const accountList = document.getElementById('accountList');

if(formAccount){
  formAccount.addEventListener('submit', async(e)=>{
    e.preventDefault();
    const u = auth.currentUser; if(!u) return alert('Inicia sesión');
    const data = Object.fromEntries(new FormData(formAccount).entries());
    if(!/^\d{3,6}$/.test(data.code)) return alert('Código numérico 3-6 dígitos');
    await setDoc(doc(db,'users',u.uid,'accounts',data.code), data, {merge:true});
    formAccount.reset();
  });
}

/* ------------ Asientos (doble partida) ------------ */
const linesBody = document.getElementById('linesBody');
const sumDebitEl = document.getElementById('sumDebit');
const sumCreditEl = document.getElementById('sumCredit');
const formTxn = document.getElementById('formTxn');
const txnList = document.getElementById('txnList');

function addLineRow(){
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="acc" placeholder="Código ej. 1100" /></td>
    <td><input class="debit" type="number" step="0.01" /></td>
    <td><input class="credit" type="number" step="0.01" /></td>
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
  sumDebitEl.textContent = d.toFixed(2);
  sumCreditEl.textContent = c.toFixed(2);
}

async function getAccountsMap(){
  const u = auth.currentUser; if(!u) throw new Error('Login requerido');
  const snap = await getDocs(collection(db,'users',u.uid,'accounts'));
  const map = new Map();
  snap.forEach(d=>map.set(d.id, d.data()));
  return map;
}

if(formTxn){
  formTxn.addEventListener('submit', async(e)=>{
    e.preventDefault();
    const u = auth.currentUser; if(!u) return alert('Inicia sesión');
    const accMap = await getAccountsMap();

    const fd = new FormData(formTxn);
    const date = fd.get('date'); const memo = fd.get('memo') || '';
    const lines = [];
    linesBody.querySelectorAll('tr').forEach(tr=>{
      const acc = (tr.querySelector('.acc').value||'').trim();
      const debit = Number(tr.querySelector('.debit').value||0);
      const credit= Number(tr.querySelector('.credit').value||0);
      if(acc && (debit>0 || credit>0)) lines.push({account:acc, debit, credit});
    });

    // Validaciones
    for(const l of lines){
      if(!accMap.has(l.account)) return alert(`Cuenta inexistente: ${l.account}`);
    }
    const totalD = lines.reduce((s,l)=>s+l.debit,0);
    const totalC = lines.reduce((s,l)=>s+l.credit,0);
    if(lines.length<2 || totalD<=0 || totalC<=0 || totalD.toFixed(2)!==totalC.toFixed(2))
      return alert('Asiento inválido: Debe y Haber > 0 y deben ser iguales.');

    await addDoc(collection(db,'users',u.uid,'transactions'), { date, memo, lines, ts:Date.now() });
    formTxn.reset(); linesBody.innerHTML=''; addLineRow(); addLineRow(); recalcSums();
  });
}

/* ------------ Reportes ------------ */
const trialBalanceBox = document.getElementById('trialBalanceBox');
const isBox = document.getElementById('isBox');
const bsBox = document.getElementById('bsBox');
const dashSummary = document.getElementById('dashSummary');

function ledgerFromTransactions(trans, accMap){
  const map = new Map();
  const findType = (code)=> accMap.get(code)?.type || 'asset';
  for(const t of trans){
    for(const l of t.lines){
      if(!map.has(l.account)) map.set(l.account,{code:l.account, type:findType(l.account), debit:0, credit:0});
      const a = map.get(l.account);
      a.debit += Number(l.debit||0);
      a.credit+= Number(l.credit||0);
      map.set(l.account,a);
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

/* ------------ Diario (lista) y live bindings ------------ */
const btnExportCSV = document.getElementById('btnExportCSV');
function toCSV(rows){
  const head = 'date,memo,account,debit,credit';
  const body = rows.flatMap(t=>t.lines.map(l=>`${t.date},"${t.memo||''}",${l.account},${l.debit||0},${l.credit||0}`)).join('\n');
  return head + '\n' + body;
}
if(btnExportCSV){
  btnExportCSV.onclick = async()=>{
    const u = auth.currentUser; if(!u) return alert('Inicia sesión');
    const snap = await getDocs(query(collection(db,'users',u.uid,'transactions'), orderBy('date','asc')));
    const trans = snap.docs.map(d=>d.data());
    const csv = toCSV(trans);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'diario.csv'; a.click();
  };
}

async function attachLive(){
  const u = auth.currentUser; if(!u) return;
  // Cuentas (listado)
  onSnapshot(query(collection(db,'users',u.uid,'accounts'), orderBy('code','asc')), snap=>{
    if(!accountList) return;
    accountList.innerHTML='';
    snap.forEach(d=>{
      const a = d.data();
      const li = document.createElement('li');
      li.innerHTML = `<b>${a.code}</b> — ${a.name} <i>(${a.type})</i>`;
      accountList.appendChild(li);
    });
  });

  // Asientos (lista y reportes)
  onSnapshot(query(collection(db,'users',u.uid,'transactions'), orderBy('date','desc')), async snap=>{
    const trans = snap.docs.map(d=>({id:d.id, ...d.data()}));
    if(txnList){
      txnList.innerHTML='';
      trans.forEach(t=>{
        const li = document.createElement('li');
        li.textContent = `${t.date} · ${t.memo||'Asiento'} · ${t.lines.length} líneas`;
        txnList.appendChild(li);
      });
    }
    // reportes
    const accSnap = await getDocs(collection(db,'users',u.uid,'accounts'));
    const accMap = new Map();
    accSnap.forEach(d=>accMap.set(d.id, d.data()));

    const ledger = ledgerFromTransactions(trans, accMap);
    const tb = trialBalance(ledger);
    const fs = financialStatements(ledger);

    if(trialBalanceBox) trialBalanceBox.textContent =
      `Debe ${tb.totalD.toFixed(2)} / Haber ${tb.totalC.toFixed(2)} ${tb.ok?'✅':'❌'}`;
    if(isBox) isBox.textContent =
      `Ingresos ${fs.revenue.toFixed(2)} · Gastos ${fs.expense.toFixed(2)} · Resultado ${fs.netIncome.toFixed(2)}`;
    if(bsBox) bsBox.textContent =
      `Activos ${fs.balance.assets.toFixed(2)} = Pasivos+Patrimonio+Resultado ${(fs.balance.liabilities+fs.balance.equity+fs.netIncome).toFixed(2)} ${fs.balanceOk?'✅':'❌'}`;
    if(dashSummary) dashSummary.innerHTML =
      `<b>Resultado</b>: ${fs.netIncome.toFixed(2)} · <b>Activo</b>: ${fs.balance.assets.toFixed(2)} · <b>Liab+Eq+NI</b>: ${(fs.balance.liabilities+fs.balance.equity+fs.netIncome).toFixed(2)}`;
  });
}

/* ------------ Banco: import CSV + conciliación ------------ */
const bankCsv = document.getElementById('bankCsv');
const btnImportBank = document.getElementById('btnImportBank');
const btnAutoMatch = document.getElementById('btnAutoMatch');
const bankList = document.getElementById('bankList');

function parseCsv(text){
  // Encabezados: date,description,amount
  const rows = text.trim().split(/\r?\n/).map(l=>l.split(','));
  const [h,...data] = rows;
  const hi = { date: h.indexOf('date'), description: h.indexOf('description'), amount: h.indexOf('amount') };
  return data.map(r=>({ date:r[hi.date], description:r[hi.description], amount:Number(r[hi.amount]) }));
}

if(btnImportBank){
  btnImportBank.onclick = async()=>{
    const u = auth.currentUser; if(!u) return alert('Inicia sesión');
    const f = bankCsv.files?.[0]; if(!f) return alert('Selecciona un CSV');
    const text = await f.text();
    const items = parseCsv(text);
    for(const it of items){
      await addDoc(collection(db,'users',u.uid,'bank','imports','lines'), { ...it, status:'unmatched', ts:Date.now() });
    }
    alert(`Importadas ${items.length} líneas`);
  };
}

if(btnAutoMatch){
  btnAutoMatch.onclick = async()=>{
    const u = auth.currentUser; if(!u) return alert('Inicia sesión');
    const linesSnap = await getDocs(collection(db,'users',u.uid,'bank','imports','lines'));
    const txSnap = await getDocs(collection(db,'users',u.uid,'transactions'));
    const tx = txSnap.docs.map(d=>d.data());
    let matched=0;
    for(const lineDoc of linesSnap.docs){
      const line = lineDoc.data();
      if(line.status==='matched') continue;
      const found = tx.find(t=>{
        const sameDate = t.date===line.date;
        const amount = Math.abs(line.amount);
        const bankLine = t.lines.find(l=>l.account==='1100' && (Number(l.debit||0)===amount || Number(l.credit||0)===amount));
        return sameDate && !!bankLine;
      });
      if(found){
        await setDoc(lineDoc.ref, { status:'matched', memo:found.memo||found.ts }, { merge:true });
        matched++;
      }
    }
    alert(`Conciliación automática: ${matched} coincidencias`);
  };
}

onAuthStateChanged(auth,(u)=>{
  if(!u || !bankList) return;
  onSnapshot(collection(db,'users',u.uid,'bank','imports','lines'), snap=>{
    bankList.innerHTML='';
    snap.forEach(d=>{
      const r = d.data();
      const li = document.createElement('li');
      li.textContent = `${r.date} · ${r.description} · ${r.amount.toFixed(2)} · ${r.status}`;
      bankList.appendChild(li);
    });
  });
});

/* ------------ Exportar / Importar JSON ------------ */
const btnExportJSON = document.getElementById('btnExportJSON');
const btnImportJSON = document.getElementById('btnImportJSON');
const importJsonFile = document.getElementById('importJsonFile');

async function exportAll(){
  const u = auth.currentUser; if(!u) return alert('Inicia sesión');
  const [acc, tx, bank] = await Promise.all([
    getDocs(collection(db,'users',u.uid,'accounts')),
    getDocs(collection(db,'users',u.uid,'transactions')),
    getDocs(collection(db,'users',u.uid,'bank','imports','lines'))
  ]);
  const data = {
    accounts: acc.docs.map(d=>d.data()),
    transactions: tx.docs.map(d=>d.data()),
    bankLines: bank.docs.map(d=>d.data())
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download = 'nexus-accounting-backup.json'; a.click();
}
if(btnExportJSON) btnExportJSON.onclick = exportAll;

if(btnImportJSON){
  btnImportJSON.onclick = async()=>{
    const u = auth.currentUser; if(!u) return alert('Inicia sesión');
    const f = importJsonFile.files?.[0]; if(!f) return alert('Selecciona un JSON');
    const data = JSON.parse(await f.text());
    if(Array.isArray(data.accounts)){
      for(const a of data.accounts) await setDoc(doc(db,'users',u.uid,'accounts',a.code), a, {merge:true});
    }
    if(Array.isArray(data.transactions)){
      for(const t of data.transactions) await addDoc(collection(db,'users',u.uid,'transactions'), t);
    }
    if(Array.isArray(data.bankLines)){
      for(const b of data.bankLines) await addDoc(collection(db,'users',u.uid,'bank','imports','lines'), b);
    }
    alert('Importación completada');
  };
}
