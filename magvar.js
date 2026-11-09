'use strict';
/* Variazione magnetica (declinazione) con il World Magnetic Model WMM2025 (NOAA/BGS), valido dal 13/11/2024 al 13/11/2029.
   Calcolata sul dispositivo: funziona anche offline. Errore tipico del modello sotto 0,5°.
   Coefficienti pubblici WMM2025, indice n(n+1)/2+m. */
const WMM = { epoch: 2025,
  g: [0,-29351.8,-1410.8,-2556.6,2951.1,1649.3,1361,-2404.1,1243.8,453.6,895,799.5,55.7,-281.1,12.1,-233.2,368.9,187.2,-138.7,-142,20.9,64.4,63.8,76.9,-115.7,-40.9,14.9,-60.7,79.5,-77,-8.8,59.3,15.8,2.5,-11.1,14.2,23.2,10.8,-17.5,2,-21.7,16.9,15,-16.8,0.9,4.6,7.8,3,-0.2,-2.5,-13.1,2.4,8.6,-8.7,-12.9,-1.3,-6.4,0.2,2,-1,-0.6,-0.9,1.5,0.9,-2.7,-3.9,2.9,-1.5,-2.5,2.4,-0.6,-0.1,-0.6,-0.1,1.1,-1,-0.2,2.6,-2,-0.2,0.3,1.2,-1.3,0.6,0.6,0.5,-0.1,-0.4,-0.2,-1.3,-0.7],
  h: [0,0,4545.4,0,-3133.6,-815.1,0,-56.6,237.5,-549.5,0,278.6,-133.9,212,-375.6,0,45.4,220.2,-122.9,43,106.1,0,-18.4,16.8,48.8,-59.8,10.9,72.7,0,-48.9,-14.4,-1,23.4,-7.4,-25.1,-2.3,0,7.1,-12.6,11.4,-9.7,12.7,0.7,-5.2,3.9,0,-24.8,12.2,8.3,-3.3,-5.2,7.2,-0.6,0.8,10,0,3.3,0,2.4,5.3,-9.1,0.4,-4.2,-3.8,0.9,-9.1,0,0,2.9,-0.6,0.2,0.5,-0.3,-1.2,-1.7,-2.9,-1.8,-2.3,0,-1.3,0.7,1,-1.4,0,0.6,-0.1,0.8,0.1,-1,0.1,0.2],
  dg: [0,12,9.7,-11.6,-5.2,-8,-1.3,-4.2,0.4,-15.6,-1.6,-2.4,-6,5.6,-7,0.6,1.4,0,0.6,2.2,0.9,-0.2,-0.4,0.9,1.2,-0.9,0.3,0.9,0,-0.1,-0.1,0.5,-0.1,-0.8,-0.8,0.8,-0.1,0.2,0,0.5,-0.1,0.3,0.2,0,0.2,0,-0.1,0.1,0.3,-0.3,0,0.3,-0.1,0.1,-0.1,0.1,0,0.1,0.1,0,-0.3,0,-0.1,-0.1,0,0,0,0,0,0,0,-0.1,0,0,-0.1,-0.1,-0.1,-0.1,0,0,0,0,0,0,0.1,0,0,0,-0.1,0,-0.1],
  dh: [0,0,-21.5,0,-27.7,-12.1,0,4,-0.3,-4.1,0,-1.1,4.1,1.6,-4.4,0,-0.5,2.2,0.4,1.7,1.9,0,0.3,-1.6,-0.4,0.9,0.7,0.9,0,0.6,0.5,-0.8,0,-1,0.6,-0.2,0,-0.2,0.5,-0.4,0.4,-0.5,-0.6,0.3,0.2,0,-0.3,0.3,-0.3,0.3,0.2,-0.1,-0.2,0.4,0.1,0,0,0,-0.2,0.1,-0.1,0.1,0,-0.1,0.2,0,0,0,0.1,0,0.1,0,0,0.1,0,0,0,0,0,0,0,-0.1,0.1,0,0,0,0,0,0,0,-0.1] };
// declinazione in gradi, positiva = EST (nord magnetico a est del vero). altKm = quota in km sul livello del mare.
function magVar(lat, lon, when = Date.now(), altKm = 0) {
  const R = Math.PI / 180, yr = new Date(when).getUTCFullYear(), y0 = Date.UTC(yr, 0, 1), y1 = Date.UTC(yr + 1, 0, 1);
  const t = yr + (when - y0) / (y1 - y0) - WMM.epoch;
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), re = 6371.2;
  const ph = lat * R, lm = lon * R, sp = Math.sin(ph), cp = Math.cos(ph);
  const Rc = a / Math.sqrt(1 - e2 * sp * sp), p = (Rc + altKm) * cp, z = (Rc * (1 - e2) + altKm) * sp;
  const r = Math.hypot(p, z), phc = Math.asin(z / r), ct = Math.sin(phc), st = Math.max(Math.cos(phc), 1e-9);
  const N = 12, P = [], D = [];
  for (let n = 0; n <= N; n++) { P.push(new Array(n + 1).fill(0)); D.push(new Array(n + 1).fill(0)); }
  P[0][0] = 1;
  for (let n = 1; n <= N; n++) for (let m = 0; m <= n; m++) {
    if (m === n) {
      const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
      P[n][n] = k * st * P[n - 1][n - 1]; D[n][n] = k * (ct * P[n - 1][n - 1] + st * D[n - 1][n - 1]);
    } else {
      const k1 = (2 * n - 1) / Math.sqrt(n * n - m * m), k2 = n - 2 >= m ? Math.sqrt(((n - 1) ** 2 - m * m) / (n * n - m * m)) : 0;
      P[n][m] = k1 * ct * P[n - 1][m] - k2 * (n - 2 >= m ? P[n - 2][m] : 0);
      D[n][m] = k1 * (ct * D[n - 1][m] - st * P[n - 1][m]) - k2 * (n - 2 >= m ? D[n - 2][m] : 0);
    }
  }
  let X = 0, Y = 0, Z = 0;
  for (let n = 1; n <= N; n++) {
    const rr = (re / r) ** (n + 2);
    for (let m = 0; m <= n; m++) {
      const i = n * (n + 1) / 2 + m, g = WMM.g[i] + t * WMM.dg[i], h = WMM.h[i] + t * WMM.dh[i], c = Math.cos(m * lm), s = Math.sin(m * lm);
      X += rr * (g * c + h * s) * D[n][m];
      Y += rr * m * (g * s - h * c) * P[n][m] / st;
      Z -= rr * (n + 1) * (g * c + h * s) * P[n][m];
    }
  }
  const ps = phc - ph, Xg = X * Math.cos(ps) + Z * Math.sin(ps);
  return Math.atan2(Y, Xg) / R;
}
// "3° E" / "4° W"
const magVarTxt = v => `${Math.abs(Math.round(v))}° ${v >= 0 ? 'E' : 'W'}`;
