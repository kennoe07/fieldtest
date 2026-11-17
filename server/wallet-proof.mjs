import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

// Deliberately support locally verifiable key signatures only in this first slice.
// zkLogin/passkey/multisig require their own explicit verification policy.
export async function verifyWalletProof(challenge, signature, now = Date.now()) {
  if (!challenge || typeof challenge.message !== 'string' || !/^0x[0-9a-f]{64}$/.test(challenge.address)) throw Error('Invalid challenge');
  if (!Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= now) throw Error('Challenge expired');
  if (typeof signature !== 'string' || signature.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw Error('Invalid signature');
  const flag = Buffer.from(signature, 'base64')[0];
  if (![0, 1, 2].includes(flag)) throw Error('This wallet signature type is not supported yet. Use an Ed25519, secp256k1, or secp256r1 wallet.');
  const key = await verifyPersonalMessageSignature(new TextEncoder().encode(challenge.message), signature);
  if (key.toSuiAddress() !== challenge.address) throw Error('Signature does not match the requested wallet');
}
