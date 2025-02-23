import type { ServiceResponse } from '@adorsys-gis/status-service';
import { ServiceResponseStatus } from '@adorsys-gis/status-service';
import { EventEmitter } from 'eventemitter3';
import {
  DidMethodFactory,
  DIDMethodName,
  PeerGenerationMethod,
} from '../did-methods/DidMethodFactory';
import type { DidIdentity, DIDKeyPair } from '../did-methods/IDidMethod';
import { DIDIdentityService } from '../lib/DIDIdentityService';
import { SecurityService } from '../security/SecurityService';
import { DidEventChannel } from '../utils/DidEventChannel';
import { mockDIDPeer3Fixture } from './testFixtures';

describe('DIDIdentityService', () => {
  let didIdentityService: DIDIdentityService;
  let eventBus: EventEmitter;
  let securityService: SecurityService;

  beforeEach(() => {
    eventBus = new EventEmitter();
    securityService = new SecurityService();
    didIdentityService = new DIDIdentityService(eventBus, securityService);
  });

  afterEach(async () => {
    // Clear all DIDs after each test
    const deleteAllDIDsEvent = new Promise<void>((resolve) => {
      eventBus.once(
        DidEventChannel.GetAllDidIdentities,
        async (response: ServiceResponse<DidIdentity[]>) => {
          if (response.status === ServiceResponseStatus.Success) {
            const dids = response.payload;
            if (Array.isArray(dids)) {
              for (const did of dids) {
                await didIdentityService.deleteDidIdentity(did.did);
              }
            }
          }
          resolve();
        },
      );

      didIdentityService.findAllDidIdentities();
    });

    await deleteAllDIDsEvent;
  });

  const waitForEvent = <T>(channel: DidEventChannel) => {
    return new Promise<ServiceResponse<T>>((resolve) => {
      eventBus.once(channel, (data: ServiceResponse<T>) => resolve(data));
    });
  };

  // test pin for the user
  const pin = 28364781;

  it('should create a DID identity with did:peer:3 and emit the event', async () => {
    const method = DIDMethodName.Peer;
    const methodType = PeerGenerationMethod.Method3;

    const mockDIDPeer3 = mockDIDPeer3Fixture;

    jest
      .spyOn(DidMethodFactory, 'generateDid')
      .mockResolvedValueOnce(mockDIDPeer3);

    const createEvent = waitForEvent(DidEventChannel.CreateDidIdentity);
    await didIdentityService.createDidIdentity(method, pin, methodType);
    const createdDid = await createEvent;

    expect(createdDid).toEqual(
      expect.objectContaining({
        status: ServiceResponseStatus.Success,
        payload: expect.objectContaining({
          did: mockDIDPeer3.did,
        }),
      }),
    );
  });

  it('should delete a DID identity with did:peer:3 and emit the event', async () => {
    const method = DIDMethodName.Peer;
    const methodType = PeerGenerationMethod.Method3;

    const mockDIDPeer3 = mockDIDPeer3Fixture;

    jest
      .spyOn(DidMethodFactory, 'generateDid')
      .mockResolvedValueOnce(mockDIDPeer3);

    const createEvent = waitForEvent(DidEventChannel.CreateDidIdentity);
    await didIdentityService.createDidIdentity(method, pin, methodType);
    await createEvent;

    // Delete the DID
    const deleteEvent = waitForEvent(DidEventChannel.DeleteDidIdentity);
    await didIdentityService.deleteDidIdentity(mockDIDPeer3.did);

    const response = await deleteEvent;

    expect(response).toEqual(
      expect.objectContaining({
        status: ServiceResponseStatus.Success,
        payload: expect.objectContaining({
          deletedDid: mockDIDPeer3.did,
          message: `DID identity with ID ${mockDIDPeer3.did} was successfully deleted.`,
        }),
      }),
    );
  });

  it('should find a DID identity with did:peer:3 and emit the event', async () => {
    const method = DIDMethodName.Peer;
    const methodType = PeerGenerationMethod.Method3;

    const mockDIDPeer3 = mockDIDPeer3Fixture;

    jest
      .spyOn(DidMethodFactory, 'generateDid')
      .mockResolvedValueOnce(mockDIDPeer3);

    const createEvent = waitForEvent(DidEventChannel.CreateDidIdentity);
    await didIdentityService.createDidIdentity(method, pin, methodType);
    await createEvent;

    const findEvent = waitForEvent(DidEventChannel.GetSingleDidIdentity);
    await didIdentityService.findDidIdentity(mockDIDPeer3.did);

    const response = await findEvent;

    const expectedPayload = {
      did: mockDIDPeer3.did,
      createdAt: expect.any(Number),
    };

    expect(response).toEqual(
      expect.objectContaining({
        status: ServiceResponseStatus.Success,
        payload: expect.objectContaining(expectedPayload),
      }),
    );
  });

  it('should find all DID identities and emit the event', async () => {
    // MOCK DID PEER:3
    const method = DIDMethodName.Peer;
    const methodType = PeerGenerationMethod.Method3;

    const mockDIDPeer3 = mockDIDPeer3Fixture;

    jest
      .spyOn(DidMethodFactory, 'generateDid')
      .mockResolvedValueOnce(mockDIDPeer3);

    const createEvent = waitForEvent(DidEventChannel.CreateDidIdentity);
    await didIdentityService.createDidIdentity(method, pin, methodType);
    await createEvent;

    // MOCK DID KEY
    const methodDidKey = DIDMethodName.Key;
    const mockDIDKeyPair: DIDKeyPair = {
      did: 'did:key:z1234567890',
      privateKey: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: 'mockPublicKey',
        d: 'mockPrivateKey',
      },
      publicKey: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: 'mockPublicKey',
      },
    };

    jest
      .spyOn(DidMethodFactory, 'generateDid')
      .mockResolvedValueOnce(mockDIDKeyPair);

    const createEventDidKey = waitForEvent(DidEventChannel.CreateDidIdentity);
    await didIdentityService.createDidIdentity(methodDidKey, pin);
    await createEventDidKey;

    const didRecords = [
      {
        did: 'did:peer:3z1234567890',
        createdAt: expect.any(Number),
      },
      {
        did: 'did:key:z1234567890',
        createdAt: expect.any(Number),
      },
    ];

    jest
      .spyOn(didIdentityService['didRepository'], 'getAllDidIds')
      .mockResolvedValueOnce(didRecords);

    // Invoke the method to find all DIDs
    const findAllEvent = waitForEvent(DidEventChannel.GetAllDidIdentities);
    await didIdentityService.findAllDidIdentities();

    const response = await findAllEvent;

    // Validate the response
    expect(response).toEqual(
      expect.objectContaining({
        status: ServiceResponseStatus.Success,
        payload: expect.arrayContaining(didRecords),
      }),
    );
  });
});
