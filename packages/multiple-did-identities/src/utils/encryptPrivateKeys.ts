import { DIDKeyPairVariants } from '../did-methods/DidMethodFactory';
import { SecurityService } from '../security/SecurityService';
import {
  hasPrivateKey,
  hasPrivateKey1and2,
  hasPrivateKeyVandE,
} from './typeGuards';

export async function encryptPrivateKeys(
  didDocument: DIDKeyPairVariants,
  pin: number,
  keys: string[],
  securityService: SecurityService, // Pass securityService as a parameter
): Promise<void> {
  for (const key of keys) {
    if (
      hasPrivateKey(didDocument) &&
      key === 'privateKey' &&
      didDocument.privateKey
    ) {
      const encryptedKey = await securityService.encrypt(
        pin,
        didDocument.privateKey,
      );
      didDocument.encryptedPrivateKey = encryptedKey;
    }

    if (
      hasPrivateKeyVandE(didDocument) &&
      key === 'privateKeyV' &&
      didDocument.privateKeyV &&
      didDocument.privateKeyE
    ) {
      const encryptedKeyV = await securityService.encrypt(
        pin,
        didDocument.privateKeyV,
      );
      const encryptedKeyE = await securityService.encrypt(
        pin,
        didDocument.privateKeyE,
      );
      didDocument.encryptedPrivateKeyV = encryptedKeyV;
      didDocument.encryptedPrivateKeyE = encryptedKeyE;
    }

    if (
      hasPrivateKey1and2(didDocument) &&
      key === 'privateKey1' &&
      didDocument.privateKey1 &&
      didDocument.privateKey2
    ) {
      const encryptedKey1 = await securityService.encrypt(
        pin,
        didDocument.privateKey1,
      );
      const encryptedKey2 = await securityService.encrypt(
        pin,
        didDocument.privateKey2,
      );
      didDocument.encryptedPrivateKey1 = encryptedKey1;
      didDocument.encryptedPrivateKey2 = encryptedKey2;
    }
  }
}
