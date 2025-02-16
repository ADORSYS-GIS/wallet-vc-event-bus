/**
 *
 * Each event channel has a unique string identifier, which is utilized
 * by the event bus to emit and listen to specific events.
 */
export enum DidEventChannel {
  CreateDidIdentity = 'did-identity-created',
  DeleteDidIdentity = 'did-identity-deleted',
  GetSingleDidIdentity = 'get-single-did-identity',
  GetAllDidIdentities = 'get-all-did-identities',
  GetDidWithDecryptedPrivateKeys = 'get-did-with-decrypted-private-keys',
  GetMediatorDidIdentities = 'get-mediator-did-identities',
  GetPeerContactDidIdentities = 'get-peer-contact-did-identities',
}
