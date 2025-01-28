import { JWK } from 'jose';
import { PrivateKeyJWK } from '../did-methods/IDidMethod';
import { base64ToArrayBuffer } from '../utils/base64ToArrayBuffer';

export class SecurityService {
  private encoder?: TextEncoder;
  private decoder?: TextDecoder;

  constructor(
    private iterations: number = 100000,
    private hash: string = 'SHA-256',
  ) {}

  private getEncoder(): TextEncoder {
    if (!this.encoder) {
      this.encoder = new TextEncoder();
    }
    return this.encoder;
  }

  private getDecoder(): TextDecoder {
    if (!this.decoder) {
      this.decoder = new TextDecoder();
    }
    return this.decoder;
  }

  private async deriveKey(pin: number, salt: Uint8Array): Promise<CryptoKey> {
    const passphraseBuffer = this.getEncoder().encode(JSON.stringify(pin));

    const key = await crypto.subtle.importKey(
      'raw',
      passphraseBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.iterations,
        hash: this.hash,
      },
      key,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  public async encrypt(
    pin: number,
    secrets: JWK | PrivateKeyJWK,
  ): Promise<{ salt: Uint8Array; ciphertext: string; iv: Uint8Array }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encryptionKey = await this.deriveKey(pin, salt);

    const encodedData = this.getEncoder().encode(JSON.stringify(secrets));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      encryptionKey,
      encodedData,
    );

    const ciphertext = btoa(
      String.fromCharCode(...new Uint8Array(ciphertextBuffer)),
    );
    return { salt, ciphertext, iv };
  }

  public async decrypt(
    pin: number,
    salt: Uint8Array,
    iv: Uint8Array,
    ciphertext: string,
  ): Promise<JWK | PrivateKeyJWK> {
    const decryptionKey = await this.deriveKey(pin, salt);
    const ciphertextBuffer = base64ToArrayBuffer(ciphertext);

    const decryptedData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      decryptionKey,
      ciphertextBuffer,
    );

    const decodedData = this.getDecoder().decode(decryptedData);
    return JSON.parse(decodedData);
  }
}
