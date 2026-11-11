import json, random, sys
from playwright.sync_api import sync_playwright
random.seed(1)
apts=['LIPE','HEMA','HESH','LIMC','LIRF','EGLL','KJFK','OMDB','HKJK','FMMI','MUHA','LIPZ','LEPA','GCTS']
regs=[('EI-NEO','B737-8'),('I-NEOS','B787-9'),('EI-GKS','B737-800'),('I-FXRA','P180')]
fl=[]
import datetime
d=datetime.date(2007,3,1); i=0
while d<datetime.date(2026,11,10):
    a,b=random.sample(apts,2); r=random.choice(regs); o=random.randint(300,1200); blk=random.randint(50,600)
    inn=(o+blk)%1440
    role=random.choice(['pic','sic'])
    f=dict(id=f'f{i}',kind='flight',date=d.isoformat(),dep=a,arr=b,out=f'{o//60:02d}:{o%60:02d}',inn=f'{inn//60:02d}:{inn%60:02d}',total=blk,reg=r[0],type=r[1],mp=blk,pic=blk if role=='pic' else 0,sic=blk if role=='sic' else 0,night=random.randint(0,blk//3),ifr=blk,toDay=1,ldgDay=1,picName='SELF' if role=='pic' else 'ROSSI',remarks='',src='app',locked=True,mt=1)
    fl.append(f); i+=1; d+=datetime.timedelta(days=random.choice([1,1,2,3]))
fl.append(dict(id='sim1',kind='sim',date='2026-05-02',simReg='SIM737',simType='B737-8',sim=240,out='08:00',inn='12:00',picName='SELF',src='app',mt=1))
fl.append(dict(id='pl1',kind='flight',date='2026-11-12',planned=True,dep='LIPE',arr='HEMA',out='08:00',inn='12:05',total=245,reg='',type='',mp=245,pic=245,picName='SELF',src='app',mt=1))
DATA=dict(version=1,pilot='BORTOLOT',flights=fl)
views=['riepilogo','voli','ftl','stat','mappa','aerei','stampa','dati','nuovo','modifica/f100','modifica/pl1','modifica/sim1']
sizes=[(1024,1366),(390,844),(1440,900)]
themes=['carta','neutro','cockpit']
with sync_playwright() as p:
    b=p.chromium.launch()
    for (w,h),th in zip(sizes,themes):
        ctx=b.new_context(viewport={'width':w,'height':h},service_workers='block'); pg=ctx.new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(('pageerror',str(e)[:200])))
        pg.on('console',lambda m:errs.append(('console',m.text[:200])) if m.type=='error' else None)
        pg.goto('http://localhost:8765/#dati'); pg.wait_for_timeout(1500)
        pg.evaluate("async d=>{localStorage.setItem('theme','%s');await idb.set('data',d)}"%th, DATA)
        for v in views:
            errs.clear()
            pg.goto('http://localhost:8765/#'+v); pg.reload(); pg.wait_for_timeout(2500)
            crash=pg.evaluate("!!document.querySelector('.crash')")
            ow=pg.evaluate("document.documentElement.scrollWidth>innerWidth+1")
            pg.screenshot(path=f'/tmp/qa_{w}_{v.replace("/","_")}.png')
            real=[e for e in errs if 'net::' not in e[1] and 'Failed to load resource' not in e[1]]
            print(w,th,v,'CRASH' if crash else 'ok','HSCROLL' if ow else '',real[:3])
        ctx.close()
    b.close()
