'use strict';

// Minimal Authenticode verification for Samsung's Watch Face Studio installer.
//
// Checks that
//   1. the file's Authenticode hash (PE image hash) matches the hash in the signature,
//   2. the PKCS#7 signature over that hash is valid for the signer certificate,
//   3. the signer certificate is a code-signing certificate issued to the expected
//      publisher and chains up to a root in Node's built-in Mozilla trust store.
// Not checked: certificate revocation and expiry (the signature carries a timestamp;
// expired-but-timestamped signatures stay valid, as on Windows).

const fs = require('fs');
const crypto = require('crypto');
const tls = require('tls');

const EXPECTED_PUBLISHER = 'Samsung Electronics Co., Ltd.';

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  spcIndirectData: '1.3.6.1.4.1.311.2.1.4',
  messageDigest: '1.2.840.113549.1.9.4',
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  codeSigning: '1.3.6.1.5.5.7.3.3',
};
const HASH_NAMES = { [OID.sha1]: 'sha1', [OID.sha256]: 'sha256', [OID.sha384]: 'sha384', [OID.sha512]: 'sha512' };

// ---- tiny DER reader ------------------------------------------------------

function readNode(buf, pos) {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('unsupported DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos + 2 + i];
    hdr += n;
  }
  const start = pos + hdr;
  const end = start + len;
  if (end > buf.length) throw new Error('truncated DER');
  return { tag, start, end, hdrStart: pos, raw: buf.subarray(pos, end), content: buf.subarray(start, end) };
}

function children(buf, node) {
  const out = [];
  for (let p = node.start; p < node.end; ) {
    const c = readNode(buf, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

function oidString(content) {
  const parts = [Math.floor(content[0] / 40), content[0] % 40];
  let v = 0;
  for (let i = 1; i < content.length; i++) {
    v = v * 128 + (content[i] & 0x7f);
    if (!(content[i] & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

// ---- PE / Authenticode hash ------------------------------------------------

function peLayout(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not a Windows executable');
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) throw new Error('not a PE file');
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  const checksum = opt + 64;
  const dataDirs = opt + (magic === 0x20b ? 112 : 96);
  const secDirEntry = dataDirs + 4 * 8;
  const certOffset = buf.readUInt32LE(secDirEntry);
  const certSize = buf.readUInt32LE(secDirEntry + 4);
  if (!certOffset || !certSize) throw new Error('the installer is not digitally signed');
  return { checksum, secDirEntry, certOffset, certSize };
}

function authenticodeHash(buf, layout, algorithm) {
  const h = crypto.createHash(algorithm);
  h.update(buf.subarray(0, layout.checksum));
  h.update(buf.subarray(layout.checksum + 4, layout.secDirEntry));
  h.update(buf.subarray(layout.secDirEntry + 8, layout.certOffset));
  h.update(buf.subarray(layout.certOffset + layout.certSize));
  return h.digest();
}

// ---- PKCS#7 ----------------------------------------------------------------

function parseSignedData(buf, layout) {
  // WIN_CERTIFICATE: dwLength(4) wRevision(2) wCertificateType(2) bCertificate[]
  const type = buf.readUInt16LE(layout.certOffset + 6);
  if (type !== 0x0002) throw new Error('unsupported signature type');
  const der = buf.subarray(layout.certOffset + 8, layout.certOffset + layout.certSize);
  const contentInfo = readNode(der, 0);
  const [ctOid, ctExplicit] = children(der, contentInfo);
  if (oidString(ctOid.content) !== OID.signedData) throw new Error('signature is not PKCS#7 SignedData');
  const signedData = children(der, ctExplicit)[0];
  const parts = children(der, signedData);

  const encap = parts[2];
  const [encOid, encExplicit] = children(der, encap);
  if (oidString(encOid.content) !== OID.spcIndirectData) throw new Error('not an Authenticode signature');
  const spc = children(der, encExplicit)[0]; // SpcIndirectDataContent
  const digestInfo = children(der, spc)[1];
  const [digestAlg, digestOctets] = children(der, digestInfo);
  const fileDigestAlg = HASH_NAMES[oidString(children(der, digestAlg)[0].content)];
  if (!fileDigestAlg) throw new Error('unsupported digest algorithm');

  const certs = [];
  let signerInfos = null;
  for (const p of parts.slice(3)) {
    if (p.tag === 0xa0) {
      for (const c of children(der, p)) certs.push(new crypto.X509Certificate(c.raw));
    } else if (p.tag === 0x31) {
      signerInfos = p;
    }
  }
  if (!signerInfos) throw new Error('signature has no signer');
  const signer = children(der, signerInfos)[0];
  const sParts = children(der, signer);
  const issuerAndSerial = sParts[1];
  const serial = children(der, issuerAndSerial)[1].content;
  const signerDigestAlg = HASH_NAMES[oidString(children(der, sParts[2])[0].content)];
  const authAttrs = sParts[3];
  if (authAttrs.tag !== 0xa0) throw new Error('signature has no authenticated attributes');
  const encryptedDigest = sParts[5].content;

  let messageDigest = null;
  for (const attr of children(der, authAttrs)) {
    const [aOid, aValues] = children(der, attr);
    if (oidString(aOid.content) === OID.messageDigest) messageDigest = children(der, aValues)[0].content;
  }

  // DER of the attributes as a SET (tag 0x31) is what was signed.
  const signedAttrs = Buffer.from(authAttrs.raw);
  signedAttrs[0] = 0x31;

  return {
    fileDigestAlg,
    fileDigest: digestOctets.content,
    spcContent: spc.content,
    certs,
    serialHex: Buffer.from(serial).toString('hex').replace(/^0+/, '').toUpperCase(),
    signerDigestAlg,
    messageDigest,
    signedAttrs,
    encryptedDigest,
  };
}

function subjectField(cert, field) {
  const m = cert.subject.split('\n').find((l) => l.startsWith(`${field}=`));
  // Node escapes special characters in RDN values ("Co.\\, Ltd.").
  return m ? m.slice(field.length + 1).replace(/\\(.)/g, '$1') : '';
}

function verifyChain(leaf, bag) {
  const roots = tls.rootCertificates.map((pem) => new crypto.X509Certificate(pem));
  let cur = leaf;
  for (let depth = 0; depth < 6; depth++) {
    const root = roots.find((r) => cur.checkIssued(r) && cur.verify(r.publicKey));
    if (root) return subjectField(root, 'CN') || root.subject;
    const next = bag.find((c) => c !== cur && cur.checkIssued(c) && cur.verify(c.publicKey));
    if (!next) break;
    cur = next;
  }
  throw new Error('the signing certificate is not issued by a trusted certificate authority');
}

// Returns { publisher, issuerRoot } or throws with a user-readable reason.
function verifyFile(file, expectedPublisher = EXPECTED_PUBLISHER) {
  const buf = fs.readFileSync(file);
  const layout = peLayout(buf);
  const sd = parseSignedData(buf, layout);

  // 1. file contents
  const actual = authenticodeHash(buf, layout, sd.fileDigestAlg);
  if (!actual.equals(Buffer.from(sd.fileDigest))) throw new Error('the file was modified after it was signed');

  // 2. signature
  const spcHash = crypto.createHash(sd.signerDigestAlg).update(sd.spcContent).digest();
  if (!sd.messageDigest || !spcHash.equals(Buffer.from(sd.messageDigest))) throw new Error('signature digest mismatch');
  const leaf = sd.certs.find((c) => c.serialNumber.replace(/^0+/, '').toUpperCase() === sd.serialHex);
  if (!leaf) throw new Error('signer certificate missing');
  const ok = crypto.verify(sd.signerDigestAlg, sd.signedAttrs, leaf.publicKey, Buffer.from(sd.encryptedDigest));
  if (!ok) throw new Error('invalid signature');

  // 3. who signed it
  if (!(leaf.keyUsage || []).includes(OID.codeSigning)) throw new Error('signer certificate is not for code signing');
  const publisher = subjectField(leaf, 'O');
  if (publisher !== expectedPublisher) {
    throw new Error(`the installer is signed by "${publisher || leaf.subject}", not by ${expectedPublisher}`);
  }
  const issuerRoot = verifyChain(leaf, sd.certs);
  return { publisher, issuerRoot };
}

module.exports = { verifyFile, EXPECTED_PUBLISHER };

if (require.main === module) {
  try {
    const r = verifyFile(process.argv[2]);
    console.log(`valid signature: ${r.publisher} (root: ${r.issuerRoot})`);
  } catch (e) {
    console.log(`INVALID: ${e.message}`);
    process.exit(1);
  }
}
