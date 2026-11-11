// estrae le funzioni di unione da app.js e le prova
const fs=require('fs'); const src=fs.readFileSync(require('path').join(__dirname,'..','app.js'),'utf8');
const grab=(start,end)=>{const i=src.indexOf(start);const j=src.indexOf(end,i);return src.slice(i,j)};
const code=grab('function mergeRoster','async function syncNow')+'\n'+grab('let snap = new Map();','// copie sul dispositivo');
let data=null; const assert=require('assert');
eval(code+'; global.T={mergeData,mergeFlight,sig,takeSnap,stampFields,setData:d=>{data=d},getData:()=>data};');
const M=T.mergeData,S=T.sig,TS=T.takeSnap,SF=T.stampFields,SD=T.setData;
// 1. copia vecchia che reimporta il roster non svuota i remarks scritti sull'iPad
const base={id:'a',date:'2026-11-12',dep:'LIPE',arr:'HEMA',out:'08:00',remarks:'',picName:'',mt:100};
const ipad={version:1,flights:[{...base}],deleted:{}}; SD(ipad); TS();
ipad.flights[0].remarks='WX DIVERSION'; ipad.flights[0].picName='SELF'; SF();
const T1=ipad.flights[0].mt;
const mac={version:1,flights:[{...base}],deleted:{}}; SD(mac); TS();
const busy=Date.now()+5; while(Date.now()<busy);
mac.flights[0].out='08:10'; SF();   // reimport roster dopo, sul Mac non aggiornato
const m=M(mac,ipad); const f=m.flights[0];
assert.equal(f.remarks,'WX DIVERSION'); assert.equal(f.picName,'SELF'); assert.equal(f.out,'08:10');
assert.notEqual(S(m),S(ipad)); assert.notEqual(S(m),S(mac));
const m2=M(ipad,mac); assert.deepEqual(m2.flights[0].remarks,f.remarks); assert.equal(m2.flights[0].out,'08:10');
// 2. dati vecchi senza fmt: vince il record più recente come prima
const r=M({flights:[{id:'x',date:'2026-01-01',remarks:'old',mt:1}]},{flights:[{id:'x',date:'2026-01-01',remarks:'new',mt:2}]});
assert.equal(r.flights[0].remarks,'new');
// 3. cancellazioni restano cancellate
const d=M({flights:[],deleted:{x:5}},{flights:[{id:'x',date:'2026-01-01',mt:2}]}); assert.equal(d.flights.length,0);
// 4. chiavi sconosciute conservate, acModel: vince il lato con metaMt più recente (anche le cancellazioni)
const k=M({flights:[],metaMt:10,acModel:{}},{flights:[],metaMt:5,acModel:{'I-NEOS':'X'},futureKey:42});
assert.equal(k.futureKey,42); assert.deepEqual(k.acModel,{});
// 5. un campo svuotato di proposito resta vuoto
const A={flights:[{id:'z',date:'2026-01-01',remarks:'x',mt:1}]}; SD(A); TS(); const B=JSON.parse(JSON.stringify(A));
A.flights[0].remarks=''; SF(); assert.equal(M(B,A).flights[0].remarks,'');
console.log('merge tests ok');
