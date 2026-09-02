// genera preds completos (2015→, retiros incluidos y marcados) con las constantes congeladas, por circuito
const P = require('./pass.js'); const fs = require('fs');
for (const tour of [0, 1]) {
  const cfg = { ...P.frozen(tour), needComp: true, scoreRet: true };
  const t0 = Date.now();
  const all = P.runPass(tour, cfg, 20150101, 99999999);
  fs.writeFileSync(__dirname + `/preds_${tour === 0 ? 'atp' : 'wta'}.json`, JSON.stringify(all));
  console.log(tour, 'n', all.length, 'ret', all.filter((p) => p.isRet).length, 'ms', Date.now() - t0);
}
