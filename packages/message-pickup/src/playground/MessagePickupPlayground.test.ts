import { DidService } from '@adorsys-gis/contact-exchange/src/services/MediatorCoordination';
import { EventEmitter } from 'eventemitter3';
import { MessagePickup } from '../protocols/MessagePickup'; // Import the class
import { DidEventChannel } from '@adorsys-gis/contact-exchange/src/services/MediatorCoordination'; // Import event channels
import {
  DidRepository,
  SecurityService,
} from '@adorsys-gis/multiple-did-identities';
import { mediatorDidTest, aliceDidTest, secretsTest } from '../utils/helpers';
import { MessageRepository } from '@adorsys-gis/message-service';
import { vi } from 'vitest';
// Define the EventData interface
interface EventData {
  payload: {
    from: string;
    to: string;
    body: {
      updated: {
        recipient_did: string;
      }[];
    };
  };
}

describe.skip('StatusRequest', () => {
  // Create instances of dependencies
  const eventBus = new EventEmitter();
  const securityService = new SecurityService();
  const didRepository = new DidRepository(securityService); // Ensure this is correctly initialized
  const messageRepository = new MessageRepository();

  // Create an instance of DidService
  const didService = new DidService(eventBus, securityService);
  const messagePickup = new MessagePickup(
    didRepository,
    1234,
    messageRepository,
  );

  beforeEach(() => {});

  // Helper function to wait for an event
  const waitForEvent = (channel: DidEventChannel): Promise<EventData> => {
    return new Promise((resolve) => {
      eventBus.once(channel, (data: EventData) => resolve(data));
    });
  };

  // To use the playground you have to manually load the secrets inside MessagePickup
  it('processStatusRequest - local values - flow', async () => {
    // (1/2) Perform the mediation coordination:
    const oobString =
      'https://mediator.socious.io?_oob=eyJpZCI6IjI4MTgwZTM2LWM2YzYtNGVkOC04YTUyLTNlMjBmMTA4MWE2YyIsInR5cGUiOiJodHRwczovL2RpZGNvbW0ub3JnL291dC1vZi1iYW5kLzIuMC9pbnZpdGF0aW9uIiwiZnJvbSI6ImRpZDpwZWVyOjIuRXo2TFNrcDkyV2JRUThzQW5mSGJ5cGZVWHVUNkM3OHpWUnBOc0F6cFE3SE5rdHRpMy5WejZNa2pUTkRLbkV2Y3gyRXl0Zkw4QmVadmRHVWZFMTUzU2JlNFU3MjlNMnhkSDVILlNleUowSWpvaVpHMGlMQ0p6SWpwN0luVnlhU0k2SW1oMGRIQnpPaTh2YldWa2FXRjBiM0l1YzI5amFXOTFjeTVwYnlJc0ltRWlPbHNpWkdsa1kyOXRiUzkyTWlKZGZYMC5TZXlKMElqb2laRzBpTENKeklqcDdJblZ5YVNJNkluZHpjem92TDIxbFpHbGhkRzl5TG5OdlkybHZkWE11YVc4dmQzTWlMQ0poSWpwYkltUnBaR052YlcwdmRqSWlYWDE5IiwiYm9keSI6eyJnb2FsX2NvZGUiOiJyZXF1ZXN0LW1lZGlhdGUiLCJnb2FsIjoiUmVxdWVzdE1lZGlhdGUiLCJhY2NlcHQiOlsiZGlkY29tbS92MiJdfSwidHlwIjoiYXBwbGljYXRpb24vZGlkY29tbS1wbGFpbitqc29uIn0';
    const processEvent = waitForEvent(
      DidEventChannel.MediationResponseReceived,
    );
    await didService.processMediatorOOB(oobString);
    const eventData = await processEvent;
    console.log('Event Data:', eventData.payload); // Log the event data

    // (2/2) Perform status request
    const mediatorDid = eventData.payload.from;
    const aliceDidForMediator = eventData.payload.to[0];
    const aliceRecipientDid = eventData.payload.body.updated[0].recipient_did;

    console.log('mediatorDid:', mediatorDid);
    console.log('aliceDidForMediator:', aliceDidForMediator);
    console.log('aliceRecipientDid:', aliceRecipientDid);

    await messagePickup.processStatusRequest(
      mediatorDid,
      aliceDidForMediator,
      false,
      aliceRecipientDid,
    );
  });

  it('processStatusRequest - local values', async () => {
    //Injecting secrets
    const mockSomeMethod = vi
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (messagePickup as any)['messagePickup'],
        'retrieveSenderDidSecrets',
      )
      .mockResolvedValue(secretsTest);

    const mediatorDid = mediatorDidTest;
    const aliceDidForMediator = aliceDidTest;

    console.log('mediatorDid:', mediatorDid);
    console.log('aliceDidForMediator:', aliceDidForMediator);

    const messageCount = await messagePickup.processStatusRequest(
      mediatorDid,
      aliceDidForMediator,
      true,
    );
    console.log('messageCount: ', messageCount);
  });

  it('processDeliveryRequest', async () => {
    const mediatorDid = mediatorDidTest;
    const aliceDidForMediator = aliceDidTest;

    console.log('mediatorDid:', mediatorDid);
    console.log('aliceDidForMediator:', aliceDidForMediator);

    await messagePickup.processDeliveryRequest(
      mediatorDid,
      aliceDidForMediator,
    );
  });
});
