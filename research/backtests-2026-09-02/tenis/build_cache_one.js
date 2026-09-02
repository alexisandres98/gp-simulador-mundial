const P = require('./pass.js'); const fs = require('fs');
const tour = +process.argv[2]; const cfg = { ...P.frozen(tour), needComp: true, scoreRet: true };
const t0 = Date.now(); const all = P.runPass(tour, cfg, 20150101, 99999999);
fs.writeFileSync(__dirname + `/preds_${tour === 0 ? 'atp' : 'wta'}.json`, JSON.stringify(all));
console.log(tour, 'n', all.length, 'ret', all.filter((p) => p.isRet).length, 'tail bo5', all.filter((p) => p.date >= 20260526 && p.bo === 5).length, 'ms', Date.now() - t0);
