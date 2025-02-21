import { StorageFactory } from '@adorsys-gis/storage';
import type { DBSchema } from 'idb';
import type { JWK } from 'jose';
import type { DIDKeyPairVariants } from '../did-methods/DidMethodFactory';
import { DID2Type } from '../did-methods/DidMethodFactory';
import type {
  DidIdentity,
  DidIdentityWithDecryptedKeys,
  DidIdValue,
  PrivateKeyJWK,
} from '../did-methods/IDidMethod';
import type { SecurityService } from '../security/SecurityService';
import { sanitizeDidDoc } from '../utils/sanitizeDidDoc';
interface DidSchema extends DBSchema {
  dids: {
    key: string; // DID string
    value: DidIdValue;
    indexes: { 'by-method': string };
  };
}

export class DidRepository {
  private storageFactory: StorageFactory<DidSchema>;
  private readonly storeName = 'dids' as const;

  constructor(
    private securityService: SecurityService,
    dbName: string = 'did-storage',
    dbVersion: number = 1,
  ) {
    this.storageFactory = new StorageFactory<DidSchema>(dbName, dbVersion, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('dids')) {
          const store = db.createObjectStore('dids', { keyPath: 'did' });
          store.createIndex('by-method', 'method', { unique: true });
        }
      },
    });
  }

  /**
   * Creates and stores a new DID identity.
   * @param didDoc The DIDKeypair to store.
   * @param method The DID method ('key' or 'peer').
   * @returns The stored DIDIdentity.
   */
  async createDidId(didDoc: DIDKeyPairVariants): Promise<void> {
    // Replace private keys with encrypted keys in the document
    const sanitizedDidDoc = sanitizeDidDoc(didDoc);

    const payload: DidIdValue = {
      did: sanitizedDidDoc.did,
      document: sanitizedDidDoc,
      createdAt: Date.now(),
    };

    await this.storageFactory.insert('dids', {
      value: payload,
    });
  }

  /**
   * Deletes a DID identity by its DID string.
   * @param did The DID string to delete.
   * @returns void
   */
  async deleteDidId(did: string): Promise<void> {
    await this.storageFactory.delete('dids', did);
  }

  /**
   * Finds a DID identity by its DID string.
   * @param did The DID string to find.
   * @returns The corresponding DIDDocument or null if not found.
   */
  async getADidId(did: string): Promise<DidIdentity> {
    const record = await this.storageFactory.findOne('dids', did);

    const { did: storedDid, createdAt } = record.value;

    // Return the didIdentity directly
    return { did: storedDid, createdAt };
  }

  /**
   * Retrieves all stored DID identities.
   * @returns An array of objects containing did, method, and createdAt for each identity.
   */
  async getAllDidIds(): Promise<DidIdentity[]> {
    const records = await this.storageFactory.findAll('dids');
    return records.map((record) => {
      const { did, createdAt } = record.value;

      // Return an object including method_type if it exists for any DID
      return {
        did,
        createdAt,
      };
    });
  }

  /**
   * Retrieves all stored mediator DID identities.
   * These identities are intended for communication with a mediator
   * and will not be used for QR code generation on the frontend.
   *
   * @returns {Promise<DidIdentity[]>} A promise that resolves to an array of objects,
   * each containing the did, type, and createdAt properties for mediator identities.
   */
  async getMediatorDidIds(): Promise<DidIdentity[]> {
    const records = await this.storageFactory.findAll('dids');
    return records
      .map((record) => record.value)
      .filter((value) => value.document.type === DID2Type.Mediator)
      .map((value) => ({
        did: value.did,
        type: value.document.type,
        createdAt: value.createdAt,
      }));
  }

  /**
   * Retrieves all stored peer contact DID identities.
   * These identities include a routing key and are intended for use
   * where QR code generation is applicable on the frontend.
   *
   * @returns {Promise<DidIdentity[]>} A promise that resolves to an array of objects,
   * each containing the did, type, and createdAt properties for peer contact identities.
   */
  async getPeerContactDidIds(): Promise<DidIdentity[]> {
    const records = await this.storageFactory.findAll('dids');
    return records
      .map((record) => record.value)
      .filter((value) => value.document.type === DID2Type.PeerContact)
      .map((value) => ({
        did: value.did,
        type: value.document.type,
        createdAt: value.createdAt,
      }));
  }

  // /**
  //  * Finds a DID identity by its DID string and decrypts the private keys.
  //  * @param did The DID string to find.
  //  * @param pin The pin used for decryption after successful authentication
  //  * @returns The corresponding DIDDocument with decrypted private keys, or null if not found.
  //  */
  async getADidPrivateKeysMini(
    did: string,
  ): Promise<DidIdentityWithDecryptedKeys | null> {
    const record = await this.storageFactory.findOne('dids', did);
    if (!record) {
      console.error('No record found for DID:', did);
      return null;
    }

    const { did: storedDid, createdAt, document } = record.value;

    const decryptedPrivateKeys: Record<string, JWK | PrivateKeyJWK> = {};

    const keyMappings = [
      { documentKey: 'privateKeyV', resultKey: 'privateKeyV' },
      { documentKey: 'privateKeyE', resultKey: 'privateKeyE' },
    ];

    for (const { documentKey, resultKey } of keyMappings) {
      if (document[documentKey]) {
        decryptedPrivateKeys[resultKey] = document[documentKey];
      } else {
        console.warn(`Document key ${documentKey} not found.`);
      }
    }

    console.log('Decrypted private keys:', decryptedPrivateKeys);

    const didIdentityWithDecryptedKeys: DidIdentityWithDecryptedKeys = {
      did: storedDid,
      createdAt,
      decryptedPrivateKeys,
    };

    return didIdentityWithDecryptedKeys;
  }

  /**
   * Finds a DID identity by its DID string and decrypts the private keys.
   * @param did The DID string to find.
   * @param pin The pin used for decryption after successful authentication
   * @returns The corresponding DIDDocument with decrypted private keys, or null if not found.
   */
  async getADidWithDecryptedPrivateKeys(
    did: string,
    pin: number,
  ): Promise<DidIdentityWithDecryptedKeys | null> {
    const record = await this.storageFactory.findOne('dids', did);

    const { did: storedDid, createdAt, document } = record.value;

    // Helper function to decrypt an encrypted key
    const decryptKey = async (encryptedKey: {
      salt: Uint8Array;
      ciphertext: string;
      iv: Uint8Array;
    }) => {
      const { salt, ciphertext, iv } = encryptedKey;
      return await this.securityService.decrypt(pin, salt, iv, ciphertext);
    };

    // Initialize the decrypted private keys object
    const decryptedPrivateKeys: Record<string, JWK | PrivateKeyJWK> = {};

    // Define the mapping of document keys to decrypted keys
    const keyMappings = [
      { documentKey: 'encryptedPrivateKey', resultKey: 'privateKey' },
      { documentKey: 'encryptedPrivateKeyV', resultKey: 'privateKeyV' },
      { documentKey: 'encryptedPrivateKeyE', resultKey: 'privateKeyE' },
      { documentKey: 'encryptedPrivateKey1', resultKey: 'privateKey1' },
      { documentKey: 'encryptedPrivateKey2', resultKey: 'privateKey2' },
    ];

    // Iterate over the key mappings and decrypt if the key exists
    for (const { documentKey, resultKey } of keyMappings) {
      if (document[documentKey]) {
        decryptedPrivateKeys[resultKey] = await decryptKey(
          document[documentKey],
        );
      }
    }

    // Return the DID identity with decrypted private keys
    const didIdentityWithDecryptedKeys: DidIdentityWithDecryptedKeys = {
      did: storedDid,
      createdAt,
      decryptedPrivateKeys,
    };

    return didIdentityWithDecryptedKeys;
  }
}
