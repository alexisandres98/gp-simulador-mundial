// lib/eip712.js — DATOS TIPADOS EIP-712 (13-sep-2026)
//
// Qué es. El estándar con el que una wallet firma un OBJETO en vez de un montón de bytes, para que quien
// firma pueda leer qué está firmando. Polymarket lo usa dos veces: para demostrar que controlas la wallet
// (dominio `ClobAuthDomain`) y para autorizar cada orden (dominio `Polymarket CTF Exchange`).
//
// La estructura, que es lo único que hay que acertar:
//
//     digest = keccak256( 0x19 0x01 ‖ separadorDeDominio ‖ hashDeLaEstructura(mensaje) )
//
// Tres sitios donde esto se tuerce en silencio, y cómo se evitan aquí:
//
//   · EL TIPO DEL DOMINIO SE CONSTRUYE CON LOS CAMPOS QUE HAY, no con los cinco del estándar. El dominio de
//     autenticación de Polymarket NO lleva `verifyingContract`; si se incluye vacío, el tipo cambia, el
//     separador cambia y la firma no vale. Aquí se enumeran los campos presentes en el objeto.
//   · LOS TIPOS ANIDADOS VAN ORDENADOS ALFABÉTICAMENTE detrás del principal. Con un solo tipo da igual,
//     pero la orden envuelta de las Deposit Wallet lleva dos y el orden importa.
//   · UNA CADENA SE CODIFICA COMO SU KECCAK, no como sus bytes. Confundirlo da un hash válido de otra cosa.
'use strict';

const { keccak256 } = require('./keccak');

const hex32 = (b) => Buffer.from(b.toString(16).padStart(64, '0'), 'hex');

// codificación de UN campo a sus 32 bytes
function codificaValor(tipo, valor, tipos) {
  if (tipo === 'string') return keccak256(String(valor));
  if (tipo === 'bytes') return keccak256(Buffer.from(String(valor).replace(/^0x/i, ''), 'hex'));
  if (tipo === 'address') {
    const h = String(valor).replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('dirección inválida: ' + valor);
    return Buffer.from(h.padStart(64, '0'), 'hex');
  }
  if (/^bytes(\d+)$/.test(tipo)) {
    const h = String(valor).replace(/^0x/i, '');
    return Buffer.from(h.padEnd(64, '0'), 'hex');            // bytesN van alineados a la IZQUIERDA
  }
  if (tipo === 'bool') return hex32(valor ? 1n : 0n);
  if (/^u?int(\d+)?$/.test(tipo)) {
    const v = typeof valor === 'bigint' ? valor : BigInt(String(valor));
    if (v < 0n) throw new Error('los enteros con signo negativos no se usan aquí');
    return hex32(v);
  }
  if (tipos && tipos[tipo]) return hashEstructura(tipo, valor, tipos);   // tipo anidado
  throw new Error('tipo EIP-712 no soportado: ' + tipo);
}

// "Order(uint256 salt,address maker,…)" más los tipos anidados, alfabéticos
function codificaTipo(principal, tipos) {
  const usados = new Set();
  (function busca(t) {
    if (usados.has(t) || !tipos[t]) return;
    usados.add(t);
    for (const c of tipos[t]) { const base = c.type.replace(/\[\d*\]$/, ''); if (tipos[base]) busca(base); }
  })(principal);
  const otros = [...usados].filter((t) => t !== principal).sort();
  return [principal, ...otros].map((t) => `${t}(${tipos[t].map((c) => `${c.type} ${c.name}`).join(',')})`).join('');
}
const hashTipo = (principal, tipos) => keccak256(codificaTipo(principal, tipos));

function hashEstructura(principal, valor, tipos) {
  const partes = [hashTipo(principal, tipos)];
  for (const campo of tipos[principal]) partes.push(codificaValor(campo.type, valor[campo.name], tipos));
  return keccak256(Buffer.concat(partes));
}

// EL SEPARADOR DE DOMINIO, con los campos que de verdad trae el dominio y en el orden del estándar.
const ORDEN_DOMINIO = [
  ['name', 'string'], ['version', 'string'], ['chainId', 'uint256'],
  ['verifyingContract', 'address'], ['salt', 'bytes32'],
];
function separadorDominio(dominio) {
  const campos = ORDEN_DOMINIO.filter(([k]) => dominio[k] !== undefined && dominio[k] !== null)
    .map(([name, type]) => ({ name, type }));
  if (!campos.length) throw new Error('dominio vacío');
  return hashEstructura('EIP712Domain', dominio, { EIP712Domain: campos });
}

// El digest de 32 bytes que se firma.
function digest({ domain, types, primaryType, message }) {
  const t = { ...types };
  delete t.EIP712Domain;                                      // el dominio se trata aparte, siempre
  return keccak256(Buffer.concat([
    Buffer.from([0x19, 0x01]),
    separadorDominio(domain),
    hashEstructura(primaryType, message, t),
  ]));
}
const digestHex = (td) => '0x' + digest(td).toString('hex');

module.exports = { digest, digestHex, separadorDominio, hashEstructura, hashTipo, codificaTipo, codificaValor };
