import type {
  Secret,
  IMessage,
  SecretsResolver,
  Base64AttachmentData,
} from 'didcomm';
import { Message } from 'didcomm';
import { PeerDIDResolver } from 'did-resolver-lib';
import type {
  DidRepository,
  DidIdentityWithDecryptedKeys,
  PrivateKeyJWK,
} from '@adorsys-gis/multiple-did-identities';

import { currentTimestampInSecs, generateUuid } from '../utils/misc';
import {
  DELIVERY_REQUEST_TYPE_URI,
  ENCRYPTED_DIDCOMM_MESSAGE_TYPE,
  PLAIN_DIDCOMM_MESSAGE_TYPE,
  STATUS_REQUEST_TYPE_URI,
} from './types/constants';
import type {
  Message as MessageModel,
  MessageRepository,
} from '@adorsys-gis/message-service';

export class MessagePickup {
  private readonly didRepository: DidRepository;
  private readonly secretPinNumber: number;
  private readonly messageRepository: MessageRepository;

  constructor(
    didRepository: DidRepository,
    secretPinNumber: number,
    messageRepository: MessageRepository,
  ) {
    this.didRepository = didRepository;
    this.secretPinNumber = secretPinNumber;
    this.messageRepository = messageRepository;
  }

  public async processStatusRequest(
    mediatorDid: string,
    aliceDidForMediator: string,
  ) {
    const secrets = await this.retrieveSenderDidSecrets(aliceDidForMediator);

    const val: IMessage = {
      id: generateUuid(),
      typ: PLAIN_DIDCOMM_MESSAGE_TYPE,
      type: STATUS_REQUEST_TYPE_URI,
      body: {},
      from: aliceDidForMediator,
      to: [mediatorDid],
      created_time: Math.round(Date.now() / 1000),
      return_route: 'all',
    };

    const resolver = new PeerDIDResolver();
    const statusRequest = new Message(val);
    const secretsResolver = new DidcommSecretsResolver(secrets);

    const [packedStatusRequest] = await statusRequest.pack_encrypted(
      mediatorDid,
      aliceDidForMediator,
      aliceDidForMediator,
      resolver,
      secretsResolver,
      { forward: false },
    );

    const mediatorEndpoint = await this.resolveMediatorEndpoint(
      resolver,
      mediatorDid,
    );

    const statusRequestResponse = await fetch(mediatorEndpoint.uri, {
      method: 'POST',
      headers: { 'Content-Type': ENCRYPTED_DIDCOMM_MESSAGE_TYPE },
      body: packedStatusRequest,
    });

    const statusRequestResponseBody = await statusRequestResponse.text();

    if (!statusRequestResponse.ok) {
      throw new Error(
        `Failed to send message: ${statusRequestResponse.statusText} - ${statusRequestResponseBody}`,
      );
    }

    if (!statusRequestResponseBody) {
      throw new Error('Response body is empty');
    }

    const responseJson = JSON.parse(statusRequestResponseBody);

    const [unpackedMessage] = await Message.unpack(
      JSON.stringify(responseJson),
      resolver,
      secretsResolver,
      {},
    );

    return unpackedMessage.as_value().body.message_count;
  }

  public async processDeliveryRequest(
    mediatorDid: string,
    aliceDidForMediator: string,
  ): Promise<string> {
    const secrets = await this.retrieveSenderDidSecrets(aliceDidForMediator);

    const plainMessage: IMessage = {
      id: generateUuid(),
      typ: PLAIN_DIDCOMM_MESSAGE_TYPE,
      type: DELIVERY_REQUEST_TYPE_URI,
      body: { limit: 1 },
      from: aliceDidForMediator,
      to: [mediatorDid],
      created_time: Math.round(Date.now() / 1000),
      return_route: 'all',
    };

    const resolver = new PeerDIDResolver();
    const mediationRequest = new Message(plainMessage);
    const secretsResolver = new DidcommSecretsResolver(secrets);

    const [packedMediationRequest] = await mediationRequest.pack_encrypted(
      mediatorDid,
      aliceDidForMediator,
      aliceDidForMediator,
      resolver,
      secretsResolver,
      { forward: false },
    );

    const mediatorEndpoint = await this.resolveMediatorEndpoint(
      resolver,
      mediatorDid,
    );

    const deliveryRequestResponse = await fetch(mediatorEndpoint.uri, {
      method: 'POST',
      headers: { 'Content-Type': ENCRYPTED_DIDCOMM_MESSAGE_TYPE },
      body: packedMediationRequest,
    });

    const responseBody = await deliveryRequestResponse.text();

    if (!responseBody) {
      throw new Error('Response body is empty');
    }

    const responseJson = JSON.parse(responseBody);
    const [unpackedMessage] = await Message.unpack(
      JSON.stringify(responseJson),
      resolver,
      secretsResolver,
      {},
    );

    const messageContent: IMessage = unpackedMessage.as_value();

    const packetMessages = messageContent.attachments; // Get all attachments

    // Check if packetMessages is defined and handle accordingly
    if (packetMessages && packetMessages.length > 0) {
      for (const packetMessage of packetMessages) {
        // Iterate over each attachment
        if (typeof packetMessage.data === 'string') {
          // If it's already a string, you can use it directly
          const persistedMessage = await this.persistMessage(
            packetMessage.data,
            mediatorDid,
            aliceDidForMediator,
            packetMessage as unknown as Message,
          );
          console.log(`Message ${persistedMessage.id} successfully persisted`);
        } else if ('base64' in packetMessage.data) {
          // If it's a base64 encoded string, decode it
          const base64Data = (packetMessage.data as Base64AttachmentData)
            .base64;
          const decodedMessage = JSON.parse(
            Buffer.from(base64Data, 'base64').toString('utf-8'),
          );

          const [unpackedMessage] = await Message.unpack(
            JSON.stringify(decodedMessage),
            resolver,
            secretsResolver,
            {},
          );
          const messageContent = unpackedMessage.as_value().body.content;
          try {
            const persistedMessage = await this.persistMessage(
              messageContent,
              mediatorDid,
              aliceDidForMediator,
              unpackedMessage,
            );
            console.log(
              `Message ${persistedMessage.id} successfully persisted`,
            );
          } catch (error) {
            console.error('Error processing packet messages', error);
            throw error; // or return an error message if preferred
          }
        } else {
          console.error(
            'Unsupported packetMessage format:',
            packetMessage.data,
          );
        }
      }
      return 'Messages retrieved and stored successfully';
    } else {
      console.error('No packetMessages found in the attachments.');
      return 'No messages retrieved';
    }
  }

  private async retrieveSenderDidSecrets(senderDid: string): Promise<Secret[]> {
    let privateKeys: DidIdentityWithDecryptedKeys | null;
    try {
      privateKeys = await this.didRepository.getADidPrivateKeysMini(senderDid);
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

    if (secrets.length === 0) {
      throw new Error('Cannot proceed with no sender secrets');
    }

    return secrets;
  }

  private async resolveMediatorEndpoint(
    resolver: PeerDIDResolver,
    mediatorDid: string,
  ) {
    const mediatorDIDDoc = await resolver.resolve(mediatorDid);
    if (
      !mediatorDIDDoc ||
      !mediatorDIDDoc.service ||
      !mediatorDIDDoc.service[0].serviceEndpoint
    ) {
      throw new Error('Invalid mediator DID or service endpoint');
    }
    return mediatorDIDDoc.service[0].serviceEndpoint;
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

    try {
      return await this.messageRepository.create(messageModel);
    } catch (error) {
      console.error('Error processing packet messages', error);
      throw error; // or return an error message if preferred
    }
  }
}

export class DidcommSecretsResolver implements SecretsResolver {
  private knownSecrets: Secret[];

  constructor(knownSecrets: Secret[]) {
    this.knownSecrets = knownSecrets;
  }

  async get_secret(secretId: string): Promise<Secret> {
    const secret = this.knownSecrets.find((secret) => secret.id === secretId);
    if (!secret) {
      throw new Error(`Secret with ID '${secretId}' not found.`);
    }
    return secret;
  }

  async find_secrets(secretIds: string[]): Promise<string[]> {
    return secretIds.filter((id) =>
      this.knownSecrets.some((secret) => secret.id === id),
    );
  }
}
