import type {
  Message as MessageModel,
  MessageRepository,
} from '@adorsys-gis/message-service';
import type {
  DidIdentityWithDecryptedKeys,
  DidRepository,
  PrivateKeyJWK,
} from '@adorsys-gis/multiple-did-identities';
import { fetch } from 'cross-fetch';
import type { DIDCommMessagingService, Secret } from 'didcomm';
import { Message } from 'didcomm';
import {
  currentTimestampInSecs,
  generateUuid,
  isDIDCommMessagingServiceEndpoint,
  isHttpUrl,
  normalizeToArray,
  StableDIDResolver,
  StaticSecretsResolver,
} from '../utils';
import {
  BASIC_MESSAGE_TYPE_URI,
  DIDCOMM_MESSAGING_SERVICE_TYPE,
  ENCRYPTED_DIDCOMM_MESSAGE_TYPE,
  PLAIN_DIDCOMM_MESSAGE_TYPE,
} from './types/constants';
import type { MediatorServiceEndpoint } from './types/routing';

/**
 * Routes messages as governed by the DIDComm Routing Protocol.
 *
 * @see https://identity.foundation/didcomm-messaging/spec/#routing-protocol-20
 */
export class MessageRouter {
  /**
   * A DID resolver for resolving DID addresses
   */
  private readonly didResolver = new StableDIDResolver();

  /**
   * @param didRepository - A repository for retrieving wallet's secret keys.
   * @param messageRepository - A repository for persisting sent messages.
   * @param secretPinNumber - The secret PIN number for decrypting data from safe storage.
   */
  public constructor(
    private readonly didRepository: DidRepository,
    private readonly messageRepository: MessageRepository,
    private readonly secretPinNumber: number,
  ) {}

  /**
   * Sends a basic message to another party, routing it through its mediator.
   *
   * @param message - The textual content of the message to send.
   * @param recipientDid - The DID address of the receiving party.
   * @param senderDid - The DID address of the sending party.
   */
  public async routeForwardMessage(
    message: string,
    recipientDid: string,
    senderDid: string,
  ): Promise<MessageModel> {
    // Construct formal basic message
    const basicMessage = this.buildBasicMessage(
      message,
      recipientDid,
      senderDid,
    );

    // Pack into a forward message
    const packedMessage = await this.packForwardMessage(
      basicMessage,
      recipientDid,
      senderDid,
    );

    // Identify DIDComm endpoints of the recipient's mediator
    const mediatorEndpointUris = await this.recoverMediatorEndpointUris(
      packedMessage,
      recipientDid,
    );

    // Route message to mediator
    await this.postMessage(packedMessage, mediatorEndpointUris);

    // Save sent message
    const persistedMessage = await this.persistMessage(
      message,
      recipientDid,
      senderDid,
      basicMessage,
    );

    // Log and return persisted message
    console.log(`Message ${persistedMessage.id} successfully routed`);
    return persistedMessage;
  }

  /**
   * Wraps textual content into a basic message structure.
   *
   * @see https://didcomm.org/basicmessage/2.0
   */
  private buildBasicMessage(
    message: string,
    recipientDid: string,
    senderDid: string,
  ): Message {
    return new Message({
      id: generateUuid(),
      typ: PLAIN_DIDCOMM_MESSAGE_TYPE,
      type: BASIC_MESSAGE_TYPE_URI,
      from: senderDid,
      to: [recipientDid],
      created_time: currentTimestampInSecs(),
      body: { content: message },
    });
  }

  /**
   * Persists sent message.
   */
  private async persistMessage(
    message: string,
    recipientDid: string,
    senderDid: string,
    basicMessage: Message,
  ): Promise<MessageModel> {
    const { id, created_time } = basicMessage.as_value();

    // created_time is in SECONDS, so multiply by 1000 to convert to milliseconds
    const timestampSeconds = created_time ?? currentTimestampInSecs();
    const timestamp = new Date(timestampSeconds * 1000);

    const messageModel: MessageModel = {
      id,
      text: message,
      sender: senderDid,
      contactId: recipientDid,
      timestamp,
      direction: 'out',
    };

    return await this.messageRepository.create(messageModel);
  }

  /**
   * Packs forward messages.
   */
  private async packForwardMessage(
    basicMessage: Message,
    recipientDid: string,
    senderDid: string,
  ): Promise<string> {
    // Get a DID resolver that enforces the recipient's profile
    const didResolver =
      await this.didResolver.enforceProfileForParty(recipientDid);

    // Prepare secrets resolver
    const secrets = await this.retrieveSenderDidSecrets(senderDid);
    const secretsResolver = new StaticSecretsResolver(secrets);

    // Attempt packing the message
    try {
      const [packedMessage] = await basicMessage.pack_encrypted(
        recipientDid,
        senderDid,
        senderDid,
        didResolver,
        secretsResolver,
        {},
      );

      return packedMessage;
    } catch (e) {
      console.error(String(e));
      throw new Error('Forward message packing failed');
    }
  }

  /**
   * Sends message payload over HTTP.
   */
  private async postMessage(
    packedMessage: string,
    mediatorEndpointUris: string[],
  ): Promise<void> {
    for (const mediatorEndpointUri of mediatorEndpointUris) {
      try {
        const response = await fetch(mediatorEndpointUri, {
          method: 'POST',
          headers: { 'Content-Type': ENCRYPTED_DIDCOMM_MESSAGE_TYPE },
          body: packedMessage,
        });

        if (response.status == 202) {
          return; // message was routed successfully
        } else {
          throw new Error(
            `${response.status} ${response.statusText} ${await response.text()}`,
          );
        }
      } catch (e) {
        console.warn(String(e));
      }
    }

    // message failed to be routed successfully
    throw new Error('Failed to route packed message to mediator');
  }

  /**
   * Recover mediator's endpoint URIs for routing packed message.
   */
  private async recoverMediatorEndpointUris(
    packedMessage: string,
    recipientDid: string,
  ): Promise<string[]> {
    const mediatorEndpoints = await this.extractMediatorEndpoints(recipientDid);

    const jwm = JSON.parse(packedMessage);
    const mediatorDid = jwm.recipients[0].header.kid;

    const uris = mediatorEndpoints
      .filter((e) => e.routingKeys.some((key) => mediatorDid.startsWith(key)))
      .map((e) => e.uri);

    if (uris.length == 0) {
      throw new Error(
        "No valid or supported mediator's endpoint URI was found",
      );
    }

    return uris;
  }

  /**
   * Retrieves the private keys of the sender DID.
   */
  private async retrieveSenderDidSecrets(senderDid: string): Promise<Secret[]> {
    let privateKeys: DidIdentityWithDecryptedKeys | null;

    try {
      privateKeys = await this.didRepository.getADidWithDecryptedPrivateKeys(
        senderDid,
        this.secretPinNumber,
      );
    } catch (e) {
      console.error(e);
      throw new Error(
        'Repository failure while retrieving private keys for senderDid',
      );
    }

    if (!privateKeys) {
      throw new Error('Inexistent private keys for senderDid');
    }

    const secrets = Object.values(privateKeys.decryptedPrivateKeys).filter(
      (key): key is PrivateKeyJWK => 'privateKeyJwk' in key,
    );

    if (secrets.length == 0) {
      throw new Error('Cannot proceed with no sender secrets');
    }

    return secrets;
  }

  /**
   * Extracts potential service endpoints (alongside corresponding routing keys)
   * for the next hop of the forward message route at the mediator.
   */
  private async extractMediatorEndpoints(
    recipientDid: string,
  ): Promise<MediatorServiceEndpoint[]> {
    // Collect exposed DIDComm services
    const serviceEndpoints =
      await this.resolveDIDCommServiceEndpoints(recipientDid);

    // Process service endpoints
    const mediatorEndpoints = await Promise.all(
      serviceEndpoints.map(async (serviceEndpoint) => {
        const uri = await this.normalizeServiceEndpointUri(serviceEndpoint.uri);
        const routingKeys = serviceEndpoint.routing_keys;

        if (serviceEndpoint.uri.startsWith('did:')) {
          routingKeys.unshift(serviceEndpoint.uri);
        }

        return uri.map((uri) => ({ uri, routingKeys }));
      }),
    );

    // Flatten and filter out entries with no URLs
    return mediatorEndpoints.flat().filter((e) => e.uri.length > 0);
  }

  /**
   * Normalize service endpoint URI as an array of URLs,
   * dereferencing or dismissing non-HTTP(S) endpoints.
   */
  private async normalizeServiceEndpointUri(
    serviceEndpointUri: string,
  ): Promise<string[]> {
    // If the URI is a DID, we dereference it in search of URL endpoints
    if (serviceEndpointUri.startsWith('did:')) {
      const serviceEndpoints =
        await this.resolveDIDCommServiceEndpoints(serviceEndpointUri);

      return serviceEndpoints
        .map((serviceEndpoint) => {
          const { uri } = serviceEndpoint;
          return isHttpUrl(uri) ? uri : null;
        })
        .filter((url) => url != null);
    }

    // If the URI is of a scheme not supported, silently dismiss it.
    if (!isHttpUrl(serviceEndpointUri)) {
      return [];
    }

    // Wrap HTTP URL into an array for convenience
    return [serviceEndpointUri];
  }

  /**
   * Resolves DID for DIDCommMessaging service endpoints.
   */
  private async resolveDIDCommServiceEndpoints(
    did: string,
  ): Promise<DIDCommMessagingService[]> {
    // Resolve DID to retrieve exposed services
    const diddoc = await this.didResolver.resolve(did);
    const services = normalizeToArray(diddoc?.service);

    // Filter only DIDComm services
    return services
      .filter((service) => service.type == DIDCOMM_MESSAGING_SERVICE_TYPE)
      .map((service) => service.serviceEndpoint)
      .filter(isDIDCommMessagingServiceEndpoint);
  }
}
